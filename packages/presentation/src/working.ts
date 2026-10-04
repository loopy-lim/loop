import type { RunState, SnapshotOutput } from "@loop/protocol";

import { separator } from "./tokens";

/**
 * Run states where work is still in flight. Only these earn a working line;
 * terminal and attention states must not fake progress.
 */
export function isActiveRunState(state: RunState): boolean {
  return state === "active";
}

/**
 * Compact elapsed formatting for working lines: `42s`, `3m05s`, `2h07m`.
 * Callers supply elapsed milliseconds because SnapshotOutput (generated from
 * the Rust bridge) carries no run-start timestamp — long-lived callers
 * (Lead session, watch) measure it themselves and pass it in.
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * Working line for a run in flight: the running task's title (or the running
 * task count), the caller-supplied elapsed time when known, the persisted
 * last-progress age when the snapshot carries one, and the most recent
 * activity across running tasks — one compact line so an active run never
 * looks stalled behind a bare `0/1 verified` counter, and a dead worker's
 * growing progress age is visible instead of fake health. Undefined for
 * runs that are not actively working.
 */
export function workingLine(
  snapshot: SnapshotOutput,
  elapsedMs?: number,
  nowMs?: number,
): string | undefined {
  if (!isActiveRunState(snapshot.state)) return undefined;
  const running = snapshot.tasks.filter((task) => task.state === "running");
  const label =
    running.length === 1
      ? running[0]!.title || running[0]!.id
      : `${running.length} running task${running.length === 1 ? "" : "s"}`;
  const latestActivity = running.flatMap((task) => task.activities).at(-1);
  const progressAge = stalestProgressAgeMs(running, nowMs);
  return [
    `Working: ${label}`,
    ...(elapsedMs === undefined ? [] : [formatElapsed(elapsedMs)]),
    ...(progressAge === undefined ? [] : [`progress ${formatElapsed(progressAge)}`]),
    ...(latestActivity ? [latestActivity] : []),
  ].join(` ${separator.list} `);
}

/** Age in milliseconds of a task's persisted last-progress timestamp;
 * undefined when the snapshot predates progress tracking. Future timestamps
 * clamp to `0s` (clock corrections are not staleness). */
function progressAgeMs(
  lastProgressMs: number | bigint | null | undefined,
  nowMs: number,
): number | undefined {
  if (lastProgressMs === undefined || lastProgressMs === null) return undefined;
  return Math.max(0, nowMs - Number(lastProgressMs));
}

/**
 * Worst-case (oldest) last-progress age across the given tasks, in
 * milliseconds — the run-health reading: one silent worker makes the whole
 * run suspect. Snapshots without progress timestamps yield undefined so old
 * callers render exactly as before.
 */
function stalestProgressAgeMs(
  tasks: ReadonlyArray<{ lastProgressMs?: number | bigint | null }>,
  nowMs: number = Date.now(),
): number | undefined {
  const ages = tasks
    .map((task) => progressAgeMs(task.lastProgressMs, nowMs))
    .filter((age): age is number => age !== undefined);
  return ages.length === 0 ? undefined : Math.max(...ages);
}
