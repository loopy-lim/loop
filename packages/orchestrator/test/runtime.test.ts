import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";
import { LoopRuntime } from "../src/runtime";

test("restart recovery creates attention for a persisted worker that is no longer observable", async () => {
  await protocol.rustra.ready();
  const databasePath = join(mkdtempSync(join(tmpdir(), "loop-recovery-")), "loop.sqlite");
  const runId = "recover-lost-worker";
  await protocol.createRun({ databasePath, runId });
  await protocol.submitPlan({ databasePath, runId, tasks: [task("implementation")] });
  await protocol.claimRunnableTasks({
    databasePath,
    runId,
    runningTaskIds: [],
    maxWorkers: 1,
    maxFrontierWorkers: 1,
  });
  await protocol.recordWorkerStarted({
    databasePath,
    runId,
    taskId: "implementation",
    workerId: "persisted-worker",
  });

  const runtime = new LoopRuntime({
    control: protocol,
    databasePath,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 1,
  });
  const recovered = await runtime.recover(runId, {
    observe: async () => "lost",
  });

  expect(recovered.state).toBe("attention");
  expect(recovered.openAttentionIds).toEqual(["recovery-persisted-worker"]);
});

test("restart recovery leaves an observed running worker active", async () => {
  await protocol.rustra.ready();
  const databasePath = join(mkdtempSync(join(tmpdir(), "loop-recovery-")), "loop.sqlite");
  const runId = "recover-running-worker";
  await protocol.createRun({ databasePath, runId });
  await protocol.submitPlan({ databasePath, runId, tasks: [task("implementation")] });
  await protocol.claimRunnableTasks({
    databasePath,
    runId,
    runningTaskIds: [],
    maxWorkers: 1,
    maxFrontierWorkers: 1,
  });
  await protocol.recordWorkerStarted({
    databasePath,
    runId,
    taskId: "implementation",
    workerId: "live-worker",
  });

  const runtime = new LoopRuntime({
    control: protocol,
    databasePath,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 1,
  });
  const recovered = await runtime.recover(runId, {
    observe: async () => "running",
  });

  expect(recovered.state).toBe("active");
  expect(recovered.activeWorkers).toEqual([
    { id: "live-worker", taskId: "implementation" },
  ]);
});

function task(id: string) {
  return {
    id,
    title: id,
    kind: "implementation" as const,
    dependencies: [],
    readScope: [],
    writeScope: ["src/**"],
    requirements: [],
    completionChecks: [
      {
        id: "tests",
        command: process.execPath,
        args: ["--eval", "process.exit(0)"],
        workingDirectory: null,
        timeoutMs: 5_000,
      },
    ],
    preferredCompute: "fast" as const,
    minimumCompute: "tiny" as const,
    maximumCompute: "strong" as const,
    maxAttempts: 2,
  };
}
