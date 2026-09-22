import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as protocol from "@loop/protocol";
import { Orchestrator } from "@loop/orchestrator";
import { FakeProvider, ProviderRegistry } from "@loop/providers";

test("detached owner completes the persisted graph after its UI observer exits", async () => {
  await protocol.rustra.ready();
  const directory = mkdtempSync(join(tmpdir(), "loop-detached-"));
  const input = { databasePath: join(directory, "run.db"), runId: "detached" };
  await new Orchestrator({ control: protocol, providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]), maxWorkers: 2 }).prepare({ ...input, workingDirectory: directory, intent: "Persist across UI exits", tasks: ["a", "b"].map(id => ({ id, title: id, kind: "research", dependencies: id === "b" ? ["a"] : [], readScope: [], writeScope: [], requirements: [], completionChecks: [{ id: "check", command: "true", args: [], timeoutMs: 1000 }], preferredCompute: "fast", minimumCompute: "fast", maximumCompute: "fast", maxAttempts: 1 })) });
  const observer = spawn(process.execPath, [join(import.meta.dir, "fixtures/detached-observer.ts"), input.databasePath], { cwd: resolve(import.meta.dir, "../../.."), stdio: ["ignore", "pipe", "pipe"] });
  let ownerPid = 0;
  try {
    ownerPid = await new Promise<number>((resolve, reject) => { observer.stdout.once("data", chunk => resolve(Number(String(chunk).trim()))); observer.once("error", reject); observer.once("exit", code => reject(new Error(`observer exited ${code}`))); });
    expect(ownerPid).toBeGreaterThan(0);
    const closed = new Promise<void>(resolve => observer.once("close", () => resolve()));
    observer.kill("SIGTERM");
    await closed;
    const deadline = Date.now() + 8000;
    while ((await protocol.getSnapshot(input)).state !== "completed") {
      if (Date.now() > deadline) throw new Error(JSON.stringify(await protocol.getSnapshot(input)));
      await Bun.sleep(50);
    }
    const snapshot = await protocol.getSnapshot(input);
    expect(snapshot.tasks.map(task => task.state)).toEqual(["done", "done"]);
    expect((await protocol.getTaskContext({ ...input, taskId: "b" })).dependencyResults[0]?.summary).toBe("a complete");
  } finally {
    observer.kill("SIGKILL");
    if (ownerPid) { try { process.kill(ownerPid, "SIGTERM"); } catch {} }
  }
}, 10000);

test("observer reports a dead execution owner instead of polling forever", async () => {
  const { observeRun } = await import("../src/dispatcher");
  await protocol.rustra.ready();
  const input = { databasePath: join(mkdtempSync(join(tmpdir(), "loop-owner-failed-")), "run.db"), runId: "failed-owner" };
  await protocol.createRun(input);
  const owner = spawn(process.execPath, ["--eval", "process.exit(2)"], { stdio: "ignore" });
  await new Promise<void>(resolve => owner.once("exit", () => resolve()));
  await expect(observeRun({ snapshot: () => protocol.getSnapshot(input), onSnapshot: () => {}, owner })).rejects.toThrow("Execution owner stopped");
});

test("watching an active run without any owner ends with actionable recovery", async () => {
  const { observeRun } = await import("../src/dispatcher");
  await protocol.rustra.ready();
  const input = { databasePath: join(mkdtempSync(join(tmpdir(), "loop-owner-missing-")), "run.db"), runId: "missing-owner" };
  await protocol.createRun(input);
  await expect(observeRun({ snapshot: () => protocol.getSnapshot(input), onSnapshot: () => {}, ownerGraceMs: 20 })).rejects.toThrow("Execution owner is not responding");
});
