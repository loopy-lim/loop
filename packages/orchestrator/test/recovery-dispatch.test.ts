import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as protocol from "@loop/protocol";
import type { TaskSpecInput } from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";
import { Orchestrator } from "../src/coordinator";
import { CompletionVerifier } from "../src/completion";

beforeAll(() => protocol.rustra.ready());
const verifier = new CompletionVerifier({
  run: async () => ({ exitCode: 0, stdout: "verification evidence", stderr: "", timedOut: false }),
});

function fixture(id: string): TaskSpecInput {
  return {
    id,
    title: id,
    kind: "research",
    dependencies: [],
    readScope: ["docs/**"],
    writeScope: [],
    requirements: ["inspect evidence"],
    completionChecks: [
      { id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 },
    ],
    preferredCompute: "fast",
    minimumCompute: "fast",
    maximumCompute: "fast",
    maxAttempts: 3,
  };
}

interface Fixture {
  directory: string;
  input: { databasePath: string; runId: string };
  provider: FakeProvider;
  orchestrator: Orchestrator;
}

function setup(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "loop-recovery-dispatch-"));
  const input = { databasePath: join(directory, "run.db"), runId: "recovery" };
  const provider = new FakeProvider("fake", ["fast"]);
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 2,
    completionVerifier: verifier,
  });
  return { directory, input, provider, orchestrator };
}

/**
 * Simulate a dispatcher process that died without emitting an event: it
 * claimed the execution lease (short TTL) and recorded a worker, then went
 * silent. After the TTL elapses the lease is provably abandoned — no
 * heartbeat renewed it — while its claim stays `running` (or `verifying`).
 */
async function wedgeWithDeadOwner(
  input: Fixture["input"],
  mode: "running" | "verifying",
): Promise<void> {
  const owner = `dead-owner-${process.pid}`;
  const claimed = await protocol.claimExecution({
    ...input,
    owner,
    nowMs: Date.now(),
    ttlMs: 1_000,
  });
  expect(claimed.accepted).toBe(true);
  // The dead owner claimed the ready task before dying (Pending → Ready).
  await protocol.claimRunnableTasks({
    ...input,
    runningTaskIds: [],
    maxWorkers: 1,
    maxFrontierWorkers: 1,
    executionOwner: owner,
  });
  await protocol.recordWorkerStarted({
    ...input,
    taskId: "a",
    workerId: `${input.runId}:a:0:dead`,
    executionOwner: owner,
  });
  if (mode === "verifying")
    await protocol.recordWorkerResult({
      ...input,
      taskId: "a",
      workerId: `${input.runId}:a:0:dead`,
      executionOwner: owner,
      success: true,
      summary: "lost mid-verification",
    });
  // The dead owner cannot renew: wait out the lease so possession is free.
  await Bun.sleep(1_200);
}

for (const mode of ["running", "verifying"] as const) {
  test(`resume recycles a dead dispatcher's ${mode} claim and dispatches the ready task`, async () => {
    const { input, provider, orchestrator } = setup();
    await orchestrator.prepare({
      ...input,
      tasks: [fixture("a")],
      workingDirectory: mkdtempSync(join(tmpdir(), "loop-recovery-work-")),
    });
    await wedgeWithDeadOwner(input, mode);

    // D3: the user's recovery command must make real progress — the new
    // owner holds the lease, so the old claim is judged dead from durable
    // facts and the ready task is dispatched to completion.
    const result = await orchestrator.resume(input);

    expect(result.status).toBe("completed");
    const snapshot = await protocol.getSnapshot(input);
    expect(snapshot.state).toBe("completed");
    expect(snapshot.tasks.find((task) => task.id === "a")?.state).toBe("done");
    expect(snapshot.openAttentionIds).toEqual([]);
    // The recycled claim was actually re-executed by the new dispatcher.
    expect(provider.maxConcurrent).toBe(1);
  }, 60_000);
}

test("resume on a clean run is unaffected by recovery", async () => {
  const { input, provider, orchestrator } = setup();
  await orchestrator.prepare({
    ...input,
    tasks: [fixture("a")],
    workingDirectory: mkdtempSync(join(tmpdir(), "loop-recovery-work-")),
  });
  const result = await orchestrator.resume(input);
  expect(result.status).toBe("completed");
  expect(provider.maxConcurrent).toBe(1);
}, 60_000);
