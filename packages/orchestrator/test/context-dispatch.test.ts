import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskContextOutput } from "@loop/protocol";
import { FakeProvider, type StartWorkerInput } from "@loop/providers";

import { CompletionVerifier } from "../src/completion";
import { executeTask } from "../src/task-execution";
import { CODE_MAP_ENTRY_ID } from "../src/code-map";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

const verifier = new CompletionVerifier({
  run: async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }),
});

class CapturingProvider extends FakeProvider {
  readonly startInputs: StartWorkerInput[] = [];
  override async start(input: StartWorkerInput) {
    this.startInputs.push(input);
    return super.start(input);
  }
}

function oversizedContext(directory: string): TaskContextOutput {
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
    attempt: 1,
    dependencyResults: [{ taskId: "t0", title: "decision", summary: "decision: keep core clean" }],
    resultSummary: "r".repeat(3_000),
    previousChecks: [
      {
        id: "big",
        command: "bun",
        args: ["test"],
        workingDirectory: directory,
        exitCode: 0,
        stdout: "x".repeat(8_000),
        stderr: "",
        timedOut: false,
        durationMs: 5,
      },
      {
        id: "broken",
        command: "bun",
        args: ["test"],
        workingDirectory: directory,
        exitCode: 1,
        stdout: "f".repeat(8_000),
        stderr: "e".repeat(8_000),
        timedOut: false,
        durationMs: 5,
      },
    ],
    guidance: ["guidance stays"],
  };
}

function fakeControl() {
  const activities: string[] = [];
  return {
    activities,
    control: {
      recordActivity: async (event: { activity: string }) => {
        activities.push(event.activity);
      },
      recordWorkerResult: async () => ({}),
      recordCheckReceipts: async () => ({}),
      recordVerification: async () => ({}),
      recordWorkerStopped: async () => ({}),
      requestAttention: async () => ({}),
      stopVerification: async () => ({}),
    },
  };
}

async function dispatch(
  provider: CapturingProvider,
  context: TaskContextOutput,
  options: Record<string, unknown> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "loop-context-dispatch-"));
  const { control, activities } = fakeControl();
  const execution = executeTask({
    input: { databasePath: join(directory, "run.db"), runId: "run-1", executionOwner: "owner" },
    context,
    workerId: "w1",
    provider,
    control: control as never,
    verifier,
    ...options,
  });
  await execution.done;
  expect(execution.error).toBeUndefined();
  return { startInputs: provider.startInputs, activities };
}

test("folding fires on oversized advisory context and preserved sets stay verbatim", async () => {
  const provider = new CapturingProvider("fake", ["fast"]);
  const context = oversizedContext("/tmp/loop-source");
  const { startInputs, activities } = await dispatch(provider, context, {
    contextPolicy: { advisoryByteBudget: 1_000, summaryEntryBytes: 400, summaryByteCap: 4_000 },
  });

  const sent = must(startInputs[0]?.context);
  // Preserved invariant sets pass through byte-identical.
  expect(sent.task.requirements).toEqual(context.task.requirements);
  expect(sent.guidance).toEqual(context.guidance);
  expect(sent.dependencyResults).toEqual(context.dependencyResults);
  expect(sent.previousChecks.find((check) => check.id === "broken")).toEqual(
    context.previousChecks[1],
  );
  // Advisory retry/activity history is folded.
  const big = must(sent.previousChecks.find((check) => check.id === "big"));
  expect(big.stdout.length).toBeLessThanOrEqual(400);
  expect(sent.resultSummary?.length).toBeLessThanOrEqual(400);
  // The fold is durably visible in the activity record.
  expect(activities.some((line) => line.startsWith("[context] folded 2 advisory entries"))).toBe(
    true,
  );
});

test("disabled policy and small contexts dispatch the context unchanged", async () => {
  const provider = new CapturingProvider("fake", ["fast"]);
  const context = oversizedContext("/tmp/loop-source");
  const { startInputs, activities } = await dispatch(provider, context, {
    contextPolicy: { advisoryByteBudget: 0, summaryEntryBytes: 400, summaryByteCap: 4_000 },
  });
  expect(startInputs[0]?.context).toBe(context);
  expect(activities.filter((line) => line.startsWith("[context]"))).toEqual([]);
});

test("code map provider injects one bounded advisory entry into the start context", async () => {
  const provider = new CapturingProvider("fake", ["fast"]);
  const context = oversizedContext("/tmp/loop-source");
  const { startInputs } = await dispatch(provider, context, {
    contextPolicy: { advisoryByteBudget: 0, summaryEntryBytes: 400, summaryByteCap: 4_000 },
    codeMap: () => "src/a.ts · Alpha",
  });
  const sent = must(startInputs[0]?.context);
  const entry = sent.dependencyResults.find((result) => result.taskId === CODE_MAP_ENTRY_ID);
  expect(entry?.summary).toBe("src/a.ts · Alpha");
  // Without a provider nothing is injected.
  const bare = new CapturingProvider("fake", ["fast"]);
  const plain = await dispatch(bare, context, {
    contextPolicy: { advisoryByteBudget: 0, summaryEntryBytes: 400, summaryByteCap: 4_000 },
  });
  expect(plain.startInputs[0]?.context?.dependencyResults).toEqual(context.dependencyResults);
});

test("bridge-reported context reduction surfaces as one bounded activity line", async () => {
  const provider = new CapturingProvider("fake", ["fast"]);
  const context: TaskContextOutput = {
    ...oversizedContext("/tmp/loop-source"),
    contextReduction: {
      fieldClamps: 1,
      bodyCompactions: 2,
      droppedChars: 24_100,
      retryCompaction: true,
      totalBudgetPasses: 0,
      estimatedEssentialChars: 9_400,
    },
  };
  const { activities } = await dispatch(provider, context, {
    contextPolicy: { advisoryByteBudget: 0, summaryEntryBytes: 400, summaryByteCap: 4_000 },
  });
  const lines = activities.filter((line) => line.startsWith("[context] bounded dispatch"));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("1 field clamp(s)");
  expect(lines[0]).toContain("24100 chars dropped");
  expect(lines[0]).toContain("retry continues on compacted context");
  expect(lines[0]?.length).toBeLessThanOrEqual(300);
});
