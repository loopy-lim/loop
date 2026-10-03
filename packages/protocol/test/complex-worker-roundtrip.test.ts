import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimRunnableTasks,
  createRun,
  recordWorkerResult,
  recordWorkerStarted,
  rustra,
  submitPlan,
} from "@loop/protocol";

/**
 * Regression test for the dispatcher-stall bug (docs/findings/run-stall-diagnosis.md).
 *
 * `recordWorkerStarted`/`recordWorkerResult` are the bridge commands the
 * coordinator calls BEFORE spawning a herdr agent (coordinator.ts reserves
 * durable worker ownership ahead of the OS side effect). Their complex codecs
 * (`createComplexCodec`, Option-of-enum `state` field) failed with
 * "trailing bytes in complex response" because the Bun FFI transport returns
 * an over-allocated caller buffer (byteLength = capacity) while the
 * complex-codec decode rejected any trailing byte — the only decoder in the
 * codebase violating the platform's self-terminating-frame contract. Every
 * dispatch died there, so runs stalled with zero workers and never appeared
 * in herdr's agent list. Fixed by a local patchfile
 * (patches/@rustra%2Ftypes@0.12.0.patch); these round-trips must stay green.
 */
describe("complex worker command round-trips", () => {
  test("recordWorkerStarted / recordWorkerResult survive the FFI caller-buffer reuse", async () => {
    await rustra.ready();
    const databasePath = join(mkdtempSync(join(tmpdir(), "loop-worker-codec-")), "loop.sqlite");
    const runId = "worker-codec-regression";

    await createRun({ databasePath, runId });
    await submitPlan({
      databasePath,
      runId,
      tasks: [
        {
          id: "t1",
          title: "first",
          kind: "implementation",
          dependencies: [],
          readScope: [],
          writeScope: ["src/**"],
          requirements: [],
          completionChecks: [
            { id: "c1", command: "true", args: [], workingDirectory: null, timeoutMs: 5000 },
          ],
          preferredCompute: "fast",
          minimumCompute: "tiny",
          maximumCompute: "strong",
          maxAttempts: 2,
        },
        {
          id: "t2",
          title: "second",
          kind: "implementation",
          dependencies: [],
          readScope: [],
          writeScope: ["src/**"],
          requirements: [],
          completionChecks: [
            { id: "c2", command: "true", args: [], workingDirectory: null, timeoutMs: 5000 },
          ],
          preferredCompute: "fast",
          minimumCompute: "tiny",
          maximumCompute: "strong",
          maxAttempts: 2,
        },
      ],
    });
    // Claim semantics: one frontier batch per call, deterministic order.
    // Round 1: plain start + result on t1.
    const claimed1 = await claimRunnableTasks({
      databasePath,
      runId,
      runningTaskIds: [],
      maxWorkers: 2,
      maxFrontierWorkers: 2,
    });
    expect(claimed1.taskIds).toEqual(["t1"]);

    // Dispatch-path invocation of the complex-codec commands (through the
    // engine, not the raw frame), including the optional WorkerState field.
    const started = await recordWorkerStarted({
      databasePath,
      runId,
      taskId: "t1",
      workerId: "w1",
    });
    expect(started.accepted).toBe(true);

    const finished = await recordWorkerResult({
      databasePath,
      runId,
      taskId: "t1",
      workerId: "w1",
      success: true,
      summary: "regression round-trip",
    });
    expect(finished.accepted).toBe(true);

    // The dispatcher always passes executionOwner (coordinator reserves durable
    // worker ownership before spawning). With a non-matching owner the domain
    // layer must reject — what must never come back is the codec-level
    // "Option discriminant" error caused by the double presence/option tag.
    let ownerRoundTripError: string | undefined;
    try {
      await recordWorkerStarted({
        databasePath,
        runId,
        taskId: "t1",
        workerId: "w3",
        executionOwner: "not-the-current-owner",
      });
    } catch (error) {
      ownerRoundTripError = (error as Error).message;
    }
    expect(ownerRoundTripError).toBeDefined();
    expect(ownerRoundTripError).not.toContain("postcard decode");
    expect(ownerRoundTripError).not.toContain("trailing bytes");

    // Round 2: the optional WorkerState field (Option-of-enum) must decode on
    // the wire. t2 was not claimed by the frontier above, so the domain layer
    // rejects the Pending→Running transition — that is fine. What must NEVER
    // come back is the codec-level "trailing bytes in complex response" that
    // used to kill the dispatcher before this point.
    let stateRoundTripError: string | undefined;
    try {
      await recordWorkerStarted({
        databasePath,
        runId,
        taskId: "t2",
        workerId: "w2",
        state: "running",
      });
    } catch (error) {
      stateRoundTripError = (error as Error).message;
    }
    expect(stateRoundTripError).toBeDefined();
    expect(stateRoundTripError).not.toContain("trailing bytes");
    expect(stateRoundTripError).not.toContain("postcard decode");
  });
});
