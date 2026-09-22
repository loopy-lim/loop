import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as protocol from "@loop/protocol";
import type { TaskSpecInput } from "@loop/protocol";
import { FakeProvider, ProviderRegistry, type StartWorkerInput } from "@loop/providers";
import { Orchestrator } from "../src/coordinator";
import { CompletionVerifier } from "../src/completion";

beforeAll(() => protocol.rustra.ready());
const verifier = new CompletionVerifier({ run: async () => ({ exitCode: 0, stdout: "verification evidence", stderr: "", timedOut: false }) });
function fixture(id: string, dependencies: string[] = []): TaskSpecInput {
  return { id, title: id, kind: "research", dependencies, readScope: ["docs/**"], writeScope: [], requirements: ["inspect evidence"], completionChecks: [{ id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 }], preferredCompute: "fast", minimumCompute: "fast", maximumCompute: "fast", maxAttempts: 2 };
}
function setup(provider: FakeProvider) {
  const directory = mkdtempSync(join(tmpdir(), "loop-intervention-"));
  const input = { databasePath: join(directory, "run.db"), runId: "run" };
  const orchestrator = new Orchestrator({ control: protocol, providers: new ProviderRegistry([provider]), maxWorkers: 2, completionVerifier: verifier });
  return { directory, input, orchestrator };
}
async function until(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 3000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition timed out");
    await Bun.sleep(5);
  }
}

test("external cancellation stops workers before reporting cancelled", async () => {
  const provider = new FakeProvider("fake", ["fast"], { delayMs: 500 });
  const { input, directory, orchestrator } = setup(provider);
  const pending = orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory });
  const observed = pending.then(value => value, error => ({ status: "error", error }));
  await until(async () => provider.active === 1);
  await protocol.cancelRun(input);
  expect((await observed).status).toBe("cancelled");
  expect(provider.active).toBe(0);
  expect(provider.cancelled).toBe(1);
  expect((await protocol.getSnapshot(input)).activeWorkers).toEqual([]);
});

test("pause drains current work and resume passes upstream results and new guidance", async () => {
  const received: StartWorkerInput[] = [];
  class CapturingProvider extends FakeProvider {
    override async start(input: StartWorkerInput) { received.push(input); return super.start(input); }
  }
  const provider = new CapturingProvider("fake", ["fast"], { delayMs: 60 });
  const { input, directory, orchestrator } = setup(provider);
  const pending = orchestrator.run({ ...input, tasks: [fixture("a"), fixture("b", ["a"])], workingDirectory: directory, intent: "Improve graph" });
  const observed = pending.then(value => value, error => ({ status: "error", error }));
  await until(async () => provider.active === 1);
  await protocol.pauseRun(input);
  expect((await observed).status).toBe("paused");
  expect(received).toHaveLength(1);
  await protocol.steerRun({ ...input, taskId: "b", message: "Preserve compatibility" });
  const result = await orchestrator.resume(input);
  expect(result.status).toBe("completed");
  expect(received).toHaveLength(2);
  expect(received[1]?.context?.dependencyResults[0]?.summary).toBe("a complete");
  expect(received[1]?.context?.guidance).toEqual(["Preserve compatibility"]);
  expect(received[1]?.context?.task.readScope).toEqual(["docs/**"]);
  const context = await protocol.getTaskContext({ ...input, taskId: "b" });
  expect(context.previousChecks[0]?.stdout).toBe("verification evidence");
});

test("cancel during verification waits for its process to stop", async () => {
  const provider = new FakeProvider("fake", ["fast"], { delayMs: 5 });
  const { input, directory } = setup(provider);
  let verifying = false;
  let stopped = false;
  const completion = new CompletionVerifier({ run: async (_command, _args, options) => {
    verifying = true;
    await new Promise<void>(resolve => options.signal!.addEventListener("abort", () => setTimeout(() => { stopped = true; resolve(); }, 30), { once: true }));
    return { exitCode: 128, stdout: "", stderr: "stopped", timedOut: false };
  } });
  const orchestrator = new Orchestrator({ control: protocol, providers: new ProviderRegistry([provider]), maxWorkers: 1, completionVerifier: completion });
  const pending = orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory });
  await until(async () => verifying);
  await protocol.cancelRun(input);
  expect((await protocol.getSnapshot(input)).state).toBe("cancelling");
  expect((await pending).status).toBe("cancelled");
  expect(stopped).toBe(true);
});

test("a second execution owner cannot dispatch duplicate work", async () => {
  const provider = new FakeProvider("fake", ["fast"], { delayMs: 100 });
  const { input, directory, orchestrator } = setup(provider);
  const pending = orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory });
  await until(async () => provider.active === 1);
  expect(["running", "completed"]).toContain((await orchestrator.execute(input)).status);
  expect((await pending).status).toBe("completed");
  expect(provider.maxConcurrent).toBe(1);
  expect((await protocol.getTaskContext({ ...input, taskId: "a" })).attempt).toBe(0);
});

test("pause arriving during provider selection drains without inventing a failure", async () => {
  let selecting = false;
  let release!: () => void;
  class SelectingProvider extends FakeProvider {
    override async capabilities() {
      selecting = true;
      await new Promise<void>(resolve => { release = resolve; });
      return super.capabilities();
    }
  }
  const provider = new SelectingProvider("fake", ["fast"]);
  const { input, directory, orchestrator } = setup(provider);
  const pending = orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory });
  await until(async () => selecting);
  await protocol.pauseRun(input);
  release();
  expect((await pending).status).toBe("paused");
  expect((await protocol.getSnapshot(input)).openAttentionIds).toEqual([]);
  expect(provider.active).toBe(0);
});

test("independent workers and their verification use the same bounded parallel capacity", async () => {
  const provider = new FakeProvider("fake", ["fast"], { delayMs: 10 });
  const { input, directory } = setup(provider);
  let checking = 0;
  let maxChecking = 0;
  const completion = new CompletionVerifier({ run: async () => {
    checking += 1;
    maxChecking = Math.max(maxChecking, checking);
    await Bun.sleep(50);
    checking -= 1;
    return { exitCode: 0, stdout: "passed", stderr: "", timedOut: false };
  } });
  const runtime = new Orchestrator({ control: protocol, providers: new ProviderRegistry([provider]), maxWorkers: 2, completionVerifier: completion });
  expect((await runtime.run({ ...input, workingDirectory: directory, tasks: [fixture("a"), fixture("b"), fixture("c")] })).status).toBe("completed");
  expect(maxChecking).toBe(2);
  expect(provider.maxConcurrent).toBe(2);
});

test("cancellation can interrupt a provider capability lookup", async () => {
  class HangingProbe extends FakeProvider { override capabilities(): ReturnType<FakeProvider["capabilities"]> { return new Promise(() => {}); } }
  const provider = new HangingProbe("fake", ["fast"]);
  const { input, directory, orchestrator } = setup(provider);
  const pending = orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory });
  await until(async () => { try { return (await protocol.getSnapshot(input)).tasks[0]?.state === "ready"; } catch { return false; } });
  await protocol.cancelRun(input);
  expect((await pending).status).toBe("cancelled");
  expect(provider.active).toBe(0);
});

test("interrupted startup preserves unknown worker state for reconciliation", async () => {
  class HangingStart extends FakeProvider { override start(): ReturnType<FakeProvider["start"]> { return new Promise(() => {}); } }
  const provider = new HangingStart("fake", ["fast"]);
  const { input, directory, orchestrator } = setup(provider);
  const pending = orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory });
  await until(async () => { try { return (await protocol.getSnapshot(input)).activeWorkers.length === 1; } catch { return false; } });
  await protocol.cancelRun(input);
  expect((await pending).status).toBe("attention");
  const snapshot = await protocol.getSnapshot(input);
  expect(snapshot.state).toBe("cancelling");
  expect(snapshot.activeWorkers).toHaveLength(1);
  expect(snapshot.attention[0]?.summary).toContain("unknown");
});

test("worker resource release retries transient failures before completing", async () => {
  let attempts = 0;
  class RetryRelease extends FakeProvider { async release() { if (++attempts === 1) throw new Error("transient close error"); } }
  const { input, directory, orchestrator } = setup(new RetryRelease("fake", ["fast"]));
  expect((await orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory })).status).toBe("completed");
  expect(attempts).toBe(2);
});

test("unresolved resource cleanup remains actionable instead of completing", async () => {
  class FailedRelease extends FakeProvider { async release() { throw new Error("cannot close worker tab"); } }
  const { input, directory, orchestrator } = setup(new FailedRelease("fake", ["fast"]));
  expect((await orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory })).status).toBe("attention");
  expect((await protocol.getSnapshot(input)).attention[0]?.summary).toContain("cleanup requires attention");
});

test("replacement owner waits out a stale lease then resumes the graph", async () => {
  const { input, directory, orchestrator } = setup(new FakeProvider("fake", ["fast"]));
  await orchestrator.prepare({ ...input, tasks: [fixture("a")], workingDirectory: directory });
  await protocol.claimExecution({ ...input, owner: "dead-owner", nowMs: Date.now(), ttlMs: 1000 });
  expect((await orchestrator.execute(input)).status).toBe("completed");
});

test("cancel cannot report terminal success while worker cleanup still fails", async () => {
  class FailedRelease extends FakeProvider { async release() { throw new Error("worker tab cannot close"); } }
  const provider = new FailedRelease("fake", ["fast"], { delayMs: 500 });
  const { input, directory, orchestrator } = setup(provider);
  const pending = orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory });
  await until(async () => provider.active === 1);
  await protocol.cancelRun(input);
  expect((await pending).status).toBe("attention");
  const snapshot = await protocol.getSnapshot(input);
  expect(snapshot.state).toBe("cancelling");
  expect(snapshot.activeWorkers).toHaveLength(1);
  expect(snapshot.attention.some(item => item.summary.includes("cleanup requires attention"))).toBe(true);
});

test("a stale dispatcher cannot add attention to the replacement owner's run", async () => {
  class HangingProbe extends FakeProvider { override capabilities(): ReturnType<FakeProvider["capabilities"]> { return new Promise(() => {}); } }
  const { input, directory, orchestrator } = setup(new HangingProbe("fake", ["fast"]));
  const pending = orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory });
  await until(async () => { try { return (await protocol.getSnapshot(input)).tasks[0]?.state === "ready"; } catch { return false; } });
  const previous = await protocol.getSnapshot(input);
  await protocol.releaseExecution({ ...input, owner: previous.executionOwner! });
  await protocol.claimExecution({ ...input, owner: "replacement", nowMs: Date.now(), ttlMs: 5000 });
  await pending;
  const current = await protocol.getSnapshot(input);
  expect(current.executionOwner).toBe("replacement");
  expect(current.openAttentionIds).toEqual([]);
  expect(current.state).toBe("active");
});
