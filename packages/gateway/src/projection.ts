/**
 * Deterministic wire projection (ADR §4.2, §D3).
 *
 * Maps the authoritative Loop snapshot (generated protocol types) plus the
 * adapter-local submission phase onto the Rust-owned wire payloads carried in
 * `wire.ts`. Pure functions only: no I/O, no state, no string branching in
 * handlers. `u64` values (`lastSequence`) serialize as decimal STRINGS.
 */

import type { RunState, SnapshotOutput, TaskState } from "@loop/protocol";

import {
  MAX_OUTPUT_BYTES,
  MAX_SUMMARY_BYTES,
  WIRE_VERSION,
  type RemoteAttention,
  type RemoteRun,
  type RemoteRunStatus,
  type RemoteRunSummary,
  type RemoteTask,
  type RemoteTaskStatus,
  type TaskCounts,
} from "./wire";

/** Adapter-local pre-durable phase of a submission (ADR §4.3). */
export type SubmissionPhase = "accepted" | "planning" | "planning_failed";

/** RunState → RemoteRunStatus (ADR §4.2). Pausing/cancelling still execute. */
const RUN_STATE_STATUS: Record<RunState, RemoteRunStatus> = {
  active: "running",
  pausing: "running",
  paused: "attention",
  cancelling: "running",
  attention: "attention",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

/** TaskState → six projection buckets; every task lands exactly once. */
const TASK_STATE_BUCKET: Record<TaskState, RemoteTaskStatus> = {
  pending: "pending",
  ready: "pending",
  blocked: "pending",
  running: "running",
  verifying: "running",
  attention: "attention",
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
};

export const TERMINAL_RUN_STATUSES: ReadonlySet<RemoteRunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalStatus(status: RemoteRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function emptyCounts(): TaskCounts {
  return { pending: 0, running: 0, attention: 0, done: 0, failed: 0, cancelled: 0 };
}

function bumpCounts(counts: TaskCounts, status: RemoteTaskStatus): void {
  counts[status] += 1;
}

/**
 * UTF-8 byte ceiling (ADR §4.5). Cuts on a UTF-8 code-point boundary and never
 * splits a surrogate pair, which keeps multi-byte graphemes intact in practice.
 */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) return { text, truncated: false };
  let cut = maxBytes;
  while (cut > 0 && (buffer[cut]! & 0xc0) === 0x80) cut -= 1; // back off continuation bytes
  const sliced = buffer.subarray(0, cut).toString("utf8");
  const last = sliced.charCodeAt(sliced.length - 1);
  const repaired = last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
  return { text: repaired, truncated: true };
}

/** Decimal-string form of the store's u64 sequence (ADR §4.1). */
export function lastSequenceToString(value: number | bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString(10);
}

export function submissionSummary(input: {
  runId: string;
  phase: "accepted" | "planning";
  createdAtMs: number;
  updatedAtMs: number;
}): RemoteRunSummary {
  return {
    runId: input.runId,
    status: input.phase,
    terminal: false,
    createdAt: iso(input.createdAtMs),
    updatedAt: iso(input.updatedAtMs),
    lastSequence: null,
    taskCounts: emptyCounts(),
  };
}

/** Pre-durable run shape: no plan yet, so empty tasks/attention (ADR §4.2). */
export function submissionRun(input: {
  runId: string;
  phase: "accepted" | "planning";
  createdAtMs: number;
  updatedAtMs: number;
}): RemoteRun {
  return { ...submissionSummary(input), tasks: [], attention: null };
}

/** Terminal run shape for a submission whose planning failed (ADR §4.3). */
export function failedSubmissionRun(input: {
  runId: string;
  createdAtMs: number;
  updatedAtMs: number;
}): RemoteRun {
  return {
    ...submissionSummary({ ...input, phase: "accepted" }),
    status: "failed",
    terminal: true,
    tasks: [],
    attention: null,
  };
}

/** Full projection of a durable Loop snapshot (ADR §4.2 `RemoteRun`). */
export function projectSnapshot(snapshot: SnapshotOutput, fetchedAtMs: number): RemoteRun {
  const tasks: RemoteTask[] = snapshot.tasks.map((task) => {
    const summary = task.resultSummary ?? null;
    const bounded = summary === null ? null : truncateUtf8(summary, MAX_SUMMARY_BYTES);
    return {
      taskId: task.id,
      status: TASK_STATE_BUCKET[task.state],
      attempt: task.attempt,
      summary: bounded === null || !bounded.truncated ? summary : bounded.text,
    };
  });

  const counts = emptyCounts();
  for (const task of tasks) bumpCounts(counts, task.status);

  const attention = projectAttention(snapshot.attention[0] ?? null);

  return {
    runId: snapshot.runId,
    status: RUN_STATE_STATUS[snapshot.state],
    terminal: isTerminalStatus(RUN_STATE_STATUS[snapshot.state]),
    createdAt: iso(fetchedAtMs),
    updatedAt: iso(fetchedAtMs),
    lastSequence: lastSequenceToString(snapshot.lastSequence),
    taskCounts: counts,
    tasks,
    attention,
  };
}

function projectAttention(
  entry: SnapshotOutput["attention"][number] | null,
): RemoteAttention | null {
  if (entry === null || entry === undefined) return null;
  return {
    attentionId: entry.id,
    taskId: entry.taskId ?? "",
    kind: entry.kind,
    message: entry.summary,
  };
}

/**
 * Incremental output projection: bounded `tasks[].activities` windows become
 * `output` events. Windows are compared per task index; entries new or changed
 * since the previous window are emitted once with a stable opaque activityId
 * (`<sequence>:<taskId>:<index>`, ADR §4.5 example shape).
 */
export function projectNewActivities(
  snapshot: SnapshotOutput,
  previousWindows: Map<string, string[]>,
): { taskId: string; activityId: string; text: string; truncated: boolean }[] {
  const sequence = lastSequenceToString(snapshot.lastSequence) ?? "0";
  const events: { taskId: string; activityId: string; text: string; truncated: boolean }[] = [];
  for (const task of snapshot.tasks) {
    const before = previousWindows.get(task.id);
    for (let index = 0; index < task.activities.length; index += 1) {
      const text = task.activities[index] ?? "";
      if (before !== undefined && before[index] === text) continue;
      const bounded = truncateUtf8(text, MAX_OUTPUT_BYTES);
      events.push({
        taskId: task.id,
        activityId: `${sequence}:${task.id}:${index}`,
        text: bounded.text,
        truncated: bounded.truncated,
      });
    }
    previousWindows.set(task.id, [...task.activities]);
  }
  return events;
}

/** Version-stamped SSE envelope prefix shared by every run event (ADR §4.5). */
export function envelope(
  runId: string,
  occurredAtMs: number,
): {
  version: typeof WIRE_VERSION;
  runId: string;
  occurredAt: string;
} {
  return { version: WIRE_VERSION, runId, occurredAt: iso(occurredAtMs) };
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}
