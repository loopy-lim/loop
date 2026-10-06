/**
 * Deterministic projection rules (ADR §4.1–§4.2, §4.5): RunState →
 * RemoteRunStatus mapping, TaskState → six buckets, decimal-string u64
 * serialization, UTF-8 truncation, and incremental activity projection.
 */

import { describe, expect, test } from "bun:test";

import type { RunState } from "@loop/protocol";

import {
  lastSequenceToString,
  projectNewActivities,
  projectSnapshot,
  submissionRun,
  truncateUtf8,
} from "../src/projection";
import type { RemoteRunStatus } from "../src/wire";
import { makeSnapshot, makeTask } from "./helpers";

describe("status mapping", () => {
  test("pausing and cancelling still project as running; paused needs attention", () => {
    const cases: [RunState, RemoteRunStatus][] = [
      ["active", "running"],
      ["pausing", "running"],
      ["cancelling", "running"],
      ["paused", "attention"],
      ["attention", "attention"],
      ["completed", "completed"],
      ["failed", "failed"],
      ["cancelled", "cancelled"],
    ];
    for (const [state, expected] of cases) {
      const run = projectSnapshot(makeSnapshot({ runId: "r", state }), 0);
      expect(run.status).toBe(expected);
    }
  });

  test("terminal statuses mark the run terminal", () => {
    for (const state of ["completed", "failed", "cancelled"] as const) {
      expect(projectSnapshot(makeSnapshot({ runId: "r", state }), 0).terminal).toBe(true);
    }
    expect(projectSnapshot(makeSnapshot({ runId: "r", state: "active" }), 0).terminal).toBe(false);
  });
});

describe("task buckets", () => {
  test("every task state lands in exactly one of the six buckets", () => {
    const tasks = [
      makeTask({ id: "t-pending", state: "pending" }),
      makeTask({ id: "t-ready", state: "ready" }),
      makeTask({ id: "t-blocked", state: "blocked" }),
      makeTask({ id: "t-running", state: "running" }),
      makeTask({ id: "t-verifying", state: "verifying" }),
      makeTask({ id: "t-attention", state: "attention" }),
      makeTask({ id: "t-done", state: "done" }),
      makeTask({ id: "t-failed", state: "failed" }),
      makeTask({ id: "t-cancelled", state: "cancelled" }),
    ];
    const run = projectSnapshot(makeSnapshot({ runId: "r", tasks }), 0);
    expect(run.taskCounts).toEqual({
      pending: 3,
      running: 2,
      attention: 1,
      done: 1,
      failed: 1,
      cancelled: 1,
    });
    expect(run.tasks).toHaveLength(9);
  });

  test("task summaries are bounded to 2 KiB", () => {
    const long = "x".repeat(3000);
    const run = projectSnapshot(
      makeSnapshot({ runId: "r", tasks: [makeTask({ id: "t", resultSummary: long })] }),
      0,
    );
    expect(Buffer.byteLength(run.tasks[0]?.summary ?? "", "utf8")).toBeLessThanOrEqual(2048);
  });
});

describe("u64 serialization", () => {
  test("sequences travel as decimal strings", () => {
    expect(lastSequenceToString(42n)).toBe("42");
    expect(lastSequenceToString(12345)).toBe("12345");
    expect(lastSequenceToString(null)).toBeNull();
    const run = projectSnapshot(
      makeSnapshot({ runId: "r", lastSequence: 18446744073709551615n }),
      0,
    );
    expect(run.lastSequence).toBe("18446744073709551615");
  });
});

describe("UTF-8 truncation", () => {
  test("ascii over the limit is cut and flagged", () => {
    const result = truncateUtf8("a".repeat(100), 10);
    expect(result).toEqual({ text: "a".repeat(10), truncated: true });
  });

  test("multibyte characters are not split", () => {
    const text = "한글테스트".repeat(10); // 3 bytes per char
    const result = truncateUtf8(text, 10); // fits 3 chars = 9 bytes
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(10);
    expect(result.text).toBe("한글테");
  });

  test("surrogate pairs survive the cut", () => {
    const text = "a\u{1F600}\u{1F600}\u{1F600}"; // emoji are 4 bytes, 2 code units
    const result = truncateUtf8(text, 6); // 'a' + one emoji (5 bytes) fits; half a pair does not
    expect(result.truncated).toBe(true);
    expect([...result.text].length).toBeLessThanOrEqual(3);
    expect(result.text.startsWith("a\u{1F600}")).toBe(true);
  });

  test("within the limit nothing changes", () => {
    expect(truncateUtf8("hello", 10)).toEqual({ text: "hello", truncated: false });
  });
});

describe("incremental activity projection", () => {
  test("emits each new activity once with a stable activityId", () => {
    const windows = new Map<string, string[]>();
    const first = makeSnapshot({
      runId: "r",
      lastSequence: 57n,
      tasks: [makeTask({ id: "t", activities: ["line one", "line two"] })],
    });
    const emitted1 = projectNewActivities(first, windows);
    expect(emitted1).toEqual([
      { taskId: "t", activityId: "57:t:0", text: "line one", truncated: false },
      { taskId: "t", activityId: "57:t:1", text: "line two", truncated: false },
    ]);

    // Same window again: nothing new.
    expect(projectNewActivities(first, windows)).toEqual([]);

    // Appended line: only the new index is emitted.
    const second = makeSnapshot({
      runId: "r",
      lastSequence: 58n,
      tasks: [makeTask({ id: "t", activities: ["line one", "line two", "line three"] })],
    });
    expect(projectNewActivities(second, windows)).toEqual([
      { taskId: "t", activityId: "58:t:2", text: "line three", truncated: false },
    ]);
  });

  test("oversized activities are truncated with the flag set", () => {
    const windows = new Map<string, string[]>();
    const snapshot = makeSnapshot({
      runId: "r",
      lastSequence: 1n,
      tasks: [makeTask({ id: "t", activities: ["y".repeat(9000)] })],
    });
    const emitted = projectNewActivities(snapshot, windows);
    expect(emitted[0]?.truncated).toBe(true);
    expect(Buffer.byteLength(emitted[0]?.text, "utf8")).toBeLessThanOrEqual(8 * 1024);
  });
});

describe("submission shapes", () => {
  test("pre-durable runs carry null sequence, zero counts, empty tasks", () => {
    const run = submissionRun({
      runId: "run-1",
      phase: "planning",
      createdAtMs: 0,
      updatedAtMs: 5,
    });
    expect(run).toMatchObject({
      status: "planning",
      terminal: false,
      lastSequence: null,
      tasks: [],
      attention: null,
      taskCounts: { pending: 0, running: 0, attention: 0, done: 0, failed: 0, cancelled: 0 },
    });
  });
});
