import { expect, test, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskContextOutput, TaskSpecInput } from "@loop/protocol";
import * as protocol from "@loop/protocol";
import {
  FakeProvider,
  ProviderRegistry,
  type ProviderEvent,
  type StartWorkerInput,
  type WorkerResult,
} from "@loop/providers";

import { CompletionVerifier } from "../src/completion";
import { Orchestrator } from "../src/coordinator";
import { executeTask } from "../src/task-execution";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

const verifier = new CompletionVerifier({
  run: async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }),
});

/** Provider whose worker never reports a result: the hang under test. */
class HangingProvider extends FakeProvider {
  readonly #listeners = new Set<(event: ProviderEvent) => void>();
  readonly #beats: number;
  #sent = 0;
  #emitTimer?: ReturnType<typeof setInterval>;
  readonly emittedAt: number[] = [];

  constructor(beats = 6) {
    super("hanging", ["fast"]);
    this.#beats = beats;
  }

  override async start(input: StartWorkerInput) {
    return super.start(input);
  }

  override async result(): Promise<WorkerResult> {
    return new Promise<WorkerResult>(() => {});
  }

  subscribe(_workerId: string, listener: (event: ProviderEvent) => void): () => void {
    this.#listeners.add(listener);
    // One output beat every 30ms up to the configured beat count, then silence.
    this.#emitTimer = setInterval(() => {
      if (this.#sent >= this.#beats) {
        clearInterval(this.#emitTimer);
        return;
      }
      this.#sent += 1;
      this.emittedAt.push(Date.now());
      for (const deliver of this.#listeners)
        deliver({ type: "output", stream: "stdout", text: `beat ${this.#sent}` });
    }, 30);
    return () => {
      if (this.#emitTimer) clearInterval(this.#emitTimer);
      this.#listeners.delete(listener);
    };
  }
}

function fakeControl() {
  const activities: string[] = [];
  const workerResults: Array<Record<string, unknown>> = [];
  const attentions: Array<Record<string, unknown>> = [];
  const recordedAt: number[] = [];
  return {
    activities,
    workerResults,
    attentions,
    recordedAt,
    control: {
      recordActivity: async (event: { activity: string }) => {
        activities.push(event.activity);
        return {};
      },
      recordWorkerResult: async (input: Record<string, unknown>) => {
        workerResults.push(input);
        recordedAt.push(Date.now());
        return {};
      },
      recordWorkerStopped: async () => ({}),
      requestAttention: async (input: Record<string, unknown>) => {
        attentions.push(input);
        return {};
      },
      recordCheckReceipts: async () => ({}),
      recordVerification: async () => ({}),
      recordTaskOutput: async () => ({}),
      stopVerification: async () => ({}),
    },
  };
}

function stallContext(directory: string): TaskContextOutput {
  return {
    intent: "intent",
    workingDirectory: directory,
    task: {
      id: "t1",
      title: "t1",
      kind: "implementation",
      dependencies: [],
      readScope: ["src/**"],
      writeScope: ["src/**"],
      requirements: ["completion contract line"],
      completionChecks: [
        { id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 },
      ],
      preferredCompute: "fast",
      minimumCompute: "fast",
      maximumCompute: "fast",
      maxAttempts: 2,
    },
    attempt: 0,
    dependencyResults: [],
    previousChecks: [],
    guidance: [],
  };
}

async function dispatch(
  provider: FakeProvider,
  options: Record<string, unknown> = {},
): Promise<ReturnType<typeof fakeControl>> {
  const directory = mkdtempSync(join(tmpdir(), "loop-stall-watchdog-"));
  const fake = fakeControl();
  const execution = executeTask({
    input: { databasePath: join(directory, "run.db"), runId: "run-1", executionOwner: "owner" },
    context: stallContext(directory),
    workerId: "w1",
    provider,
    control: fake.control as never,
    verifier,
    ...options,
  });
  await execution.done;
  expect(execution.error).toBeUndefined();
  return fake;
}

test("the stall watchdog fails a silent attempt with a stalled worker result", async () => {
  const provider = new HangingProvider(0);
  const { workerResults, attentions } = await dispatch(provider, {
    stallTimeoutMs: 60,
  });
  // The attempt fails durably through the existing worker-result path.
  expect(workerResults).toHaveLength(1);
  const summary = String(workerResults[0]?.summary);
  expect(workerResults[0]).toMatchObject({ success: false, taskId: "t1" });
  expect(summary).toContain("stalled");
  // Wording stays retry-class (no transport markers), so the Rust failure
  // classification keeps the attempt on the retry ladder instead of a
  // manual-reconciliation dead end.
  expect(summary).toContain("retry policy");
  // The hung worker handle is cancelled exactly once; no attention noise.
  expect(provider.cancelled).toBe(1);
  expect(attentions).toEqual([]);
});

test("fresh worker activity resets the stall watchdog", async () => {
  const provider = new HangingProvider(5);
  const { workerResults, recordedAt } = await dispatch(provider, { stallTimeoutMs: 150 });
  // All five beats (150ms of activity) outlived the 150ms silence threshold,
  // so the watchdog was reset by the stream events rather than firing early.
  expect(provider.emittedAt.length).toBeGreaterThanOrEqual(5);
  const lastEmit = must(provider.emittedAt.at(-1));
  expect(must(recordedAt[0]) - lastEmit).toBeGreaterThanOrEqual(110);
  expect(workerResults[0]).toMatchObject({ success: false });
  expect(String(workerResults[0]?.summary)).toContain("stalled");
});

test("check runs emit persisted progress around verification", async () => {
  const { activities } = await dispatch(new FakeProvider("fake", ["fast"], { delayMs: 5 }));
  expect(activities).toContain("Running 1 completion check");
  expect(activities).toContain("Completion checks finished: 1/1 passed");
});

beforeAll(() => protocol.rustra.ready());

function stallTaskSpec(_directory: string): TaskSpecInput {
  return {
    id: "t1",
    title: "t1",
    kind: "implementation",
    dependencies: [],
    readScope: ["src/**"],
    writeScope: ["src/**"],
    requirements: ["completion contract line"],
    completionChecks: [
      { id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 },
    ],
    preferredCompute: "fast",
    minimumCompute: "fast",
    maximumCompute: "fast",
    maxAttempts: 1,
  };
}

test("the orchestrator threads the configured stall timeout into the watchdog", async () => {
  const provider = new HangingProvider(0);
  const directory = mkdtempSync(join(tmpdir(), "loop-stall-config-"));
  const input = { databasePath: join(directory, "run.db"), runId: "stall-config" };
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 1,
    completionVerifier: verifier,
    // 1.5s configured budget: if the orchestrator dropped the option and the
    // watchdog fell back to the 15-minute default, this run could not finish.
    stallTimeoutMs: 1_500,
  });
  const startedAt = Date.now();
  const result = await orchestrator.run({
    ...input,
    tasks: [stallTaskSpec(directory)],
    workingDirectory: directory,
  });
  const elapsedMs = Date.now() - startedAt;

  // The single attempt was failed by the watchdog well inside the run.
  expect(elapsedMs).toBeLessThan(30_000);
  expect(provider.cancelled).toBe(1);
  expect(result.providersByTask.t1).toEqual(["hanging"]);
  expect(["failed", "attention"]).toContain(result.status);
  const snapshot = await protocol.getSnapshot(input);
  expect(snapshot.tasks.every((task) => task.state !== "done")).toBe(true);
});
