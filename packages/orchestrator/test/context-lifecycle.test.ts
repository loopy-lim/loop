import { expect, test } from "bun:test";

import type { TaskContextOutput } from "@loop/protocol";

import {
  DEFAULT_CONTEXT_LIFECYCLE_POLICY,
  byteHead,
  measureAdvisoryContext,
  summarizeTaskContext,
  toContextSummaryEvent,
} from "../src/context-lifecycle";
import { resolveContextPolicy } from "../src/config";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

function receipt(
  overrides: Partial<TaskContextOutput["previousChecks"][number]> = {},
): TaskContextOutput["previousChecks"][number] {
  return {
    id: "check-1",
    command: "bun",
    args: ["test"],
    workingDirectory: "/repo",
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 12,
    ...overrides,
  };
}

function context(overrides: Partial<TaskContextOutput> = {}): TaskContextOutput {
  return {
    intent: "ship it",
    workingDirectory: "/repo",
    task: {
      id: "t1",
      title: "t1",
      kind: "implementation",
      dependencies: [],
      readScope: ["src/**"],
      writeScope: ["src/**"],
      requirements: ["contract line"],
      completionChecks: [],
      preferredCompute: "fast",
      minimumCompute: "fast",
      maximumCompute: "fast",
      maxAttempts: 2,
    },
    attempt: 1,
    dependencyResults: [{ taskId: "t0", title: "decide", summary: "decision: use rust" }],
    resultSummary: null,
    previousChecks: [],
    guidance: ["keep the boundary"],
    ...overrides,
  };
}

test("advisory measurement counts passed-check bodies and result summary only", () => {
  const measured = context({
    previousChecks: [
      receipt({ stdout: "a".repeat(100) }),
      receipt({ id: "fail", exitCode: 1, stdout: "f".repeat(500) }),
    ],
    resultSummary: "r".repeat(50),
    guidance: ["g".repeat(500)],
  });
  expect(measureAdvisoryContext(measured)).toBe(150);
});

test("fold replaces passed-check bodies with bounded heads and keeps every preserved set verbatim", () => {
  const passed = receipt({ id: "big", stdout: "x".repeat(4_000) });
  const failed = receipt({
    id: "broken",
    exitCode: 1,
    stdout: "f".repeat(4_000),
    stderr: "e".repeat(4_000),
  });
  const source = context({
    previousChecks: [passed, failed],
    resultSummary: "attempt zero: wrote the wrong module".repeat(50),
    guidance: ["preserve guidance"],
    dependencyResults: [{ taskId: "d1", title: "decision", summary: "decision: keep rust core" }],
  });
  const policy = { advisoryByteBudget: 1_000, summaryEntryBytes: 400, summaryByteCap: 4_000 };
  const { context: folded, fold } = summarizeTaskContext(source, policy);

  // Preserved sets are invariant (same object content, byte-identical).
  expect(folded.task).toBe(source.task);
  expect(folded.guidance).toEqual(["preserve guidance"]);
  expect(folded.dependencyResults).toEqual(source.dependencyResults);
  expect(folded.previousChecks.find((check) => check.id === "broken")).toEqual(failed);

  // Advisory bodies are folded to bounded heads.
  const foldedPassed = must(folded.previousChecks.find((check) => check.id === "big"));
  expect(foldedPassed.stdout.length).toBeLessThanOrEqual(400);
  expect(foldedPassed.stdout).toBe("x".repeat(400));
  expect(folded.resultSummary?.length).toBeLessThanOrEqual(400);

  // The fold record counts honestly and never carries dropped content.
  expect(fold?.summarizedEntryCount).toBe(2);
  // Preserved: 1 failed receipt + 1 guidance + 1 dependency result.
  expect(fold?.preservedEntryCount).toBe(3);
  expect(fold?.summary).toContain("check big");
  expect(fold?.summary).toContain("previous attempt");
  expect(fold?.reason).toBe("budgetThreshold");
  expect(fold?.advisoryBytesAfter).toBeLessThan(must(fold).advisoryBytesBefore);
  expect(fold?.truncated).toBe(false);
});

test("within-budget and disabled policies return the context unchanged", () => {
  const source = context({ resultSummary: "small", previousChecks: [receipt({ stdout: "tiny" })] });
  expect(summarizeTaskContext(source, DEFAULT_CONTEXT_LIFECYCLE_POLICY).fold).toBeUndefined();
  expect(
    summarizeTaskContext(source, {
      advisoryByteBudget: 0,
      summaryEntryBytes: 400,
      summaryByteCap: 4_000,
    }).fold,
  ).toBeUndefined();
  expect(
    summarizeTaskContext(source, {
      advisoryByteBudget: 0,
      summaryEntryBytes: 400,
      summaryByteCap: 4_000,
    }).context,
  ).toBe(source);
});

test("oversized summary text is cut at the byte cap and flagged", () => {
  const receipts = Array.from({ length: 40 }, (_, index) =>
    receipt({ id: `check-${index}`, stdout: `out ${index} `.padEnd(600, "y") }),
  );
  const { context: folded, fold } = summarizeTaskContext(context({ previousChecks: receipts }), {
    advisoryByteBudget: 500,
    summaryEntryBytes: 100,
    summaryByteCap: 2_000,
  });
  expect(fold).toBeDefined();
  expect(fold?.truncated).toBe(true);
  for (const foldedReceipt of folded.previousChecks) {
    expect(foldedReceipt.stdout.length).toBeLessThanOrEqual(100);
  }
  const recorded = must(fold);
  expect(toContextSummaryEvent(recorded, { runId: "run", taskId: "t1", attempt: 2 })).toEqual({
    runId: "run",
    taskId: "t1",
    attempt: 2,
    reason: "budgetThreshold",
    summarizedEntryCount: recorded.summarizedEntryCount,
    preservedEntryCount: recorded.preservedEntryCount,
    summary: recorded.summary,
    truncated: true,
    occurredAt: recorded.occurredAt,
  });
});

test("byteHead never splits a multi-byte character", () => {
  const text = "가".repeat(10);
  expect(byteHead(text, 12)).toBe("가".repeat(4));
  expect(byteHead("abc", 2)).toBe("ab");
  expect(byteHead("abc", 0)).toBe("");
});

test("resolveContextPolicy falls back section-wide and knob-by-knob", () => {
  expect(resolveContextPolicy(undefined)).toEqual(DEFAULT_CONTEXT_LIFECYCLE_POLICY);
  expect(resolveContextPolicy({})).toEqual(DEFAULT_CONTEXT_LIFECYCLE_POLICY);
  expect(resolveContextPolicy({ advisory_byte_budget: 0 })).toEqual({
    advisoryByteBudget: 0,
    summaryEntryBytes: DEFAULT_CONTEXT_LIFECYCLE_POLICY.summaryEntryBytes,
    summaryByteCap: DEFAULT_CONTEXT_LIFECYCLE_POLICY.summaryByteCap,
  });
  expect(() => resolveContextPolicy({ advisory_byte_budget: -1 })).toThrow();
  expect(() => resolveContextPolicy({ summary_byte_cap: 1.5 })).toThrow();
});
