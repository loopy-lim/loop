/**
 * Session-focus default filter (task `session-focus`): the chats list shows
 * only the currently ACTIVE work by default — non-terminal runs, live
 * sessions — and the full inventory exists exclusively behind an explicit
 * "Show all sessions" toggle.
 *
 * Two layers, same rule as the rest of the suites here (react-native does
 * not load under the test runtime):
 * 1. Pure: the activeView fold (filter + recency ordering) is unit-tested
 *    directly — the filter semantics are pinned, not incidental.
 * 2. Source contract: run-list renders the default-filtered lists, seeds
 *    the toggle OFF, and exposes the toggle as the only path to the full
 *    list (and it appears only while something is actually hidden).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { activeFirst, isActiveRun, isActiveSession } from "../src/state/activeView";

const mobileRoot = join(import.meta.dir, "..");
const runListSource = readFileSync(join(mobileRoot, "src/features/run-list.tsx"), "utf8");

function run(overrides: { updatedAt: string; terminal?: boolean }) {
  return {
    runId: "r-" + overrides.updatedAt,
    status: "running" as const,
    terminal: overrides.terminal ?? false,
    createdAt: overrides.updatedAt,
    updatedAt: overrides.updatedAt,
    lastSequence: "1",
    taskCounts: { pending: 0, running: 1, attention: 0, done: 0, failed: 0, cancelled: 0 },
  };
}

describe("isActiveRun — active means non-terminal (Rust-owned flag, never re-derived)", () => {
  test("a non-terminal run is active", () => {
    expect(isActiveRun({ terminal: false })).toBe(true);
  });

  test("a terminal run is not active (completed/failed/cancelled)", () => {
    expect(isActiveRun({ terminal: true })).toBe(false);
  });
});

describe("isActiveSession — active means a live tap stream", () => {
  test("live is active", () => {
    expect(isActiveSession({ state: "live" })).toBe(true);
  });

  test("ended and unobserved are not active", () => {
    expect(isActiveSession({ state: "ended" })).toBe(false);
    expect(isActiveSession({ state: "unobserved" })).toBe(false);
  });
});

describe("activeFirst — the running loop leads the list (display-only ordering)", () => {
  test("sorts most-recently-updated first and never mutates the input", () => {
    const oldest = run({ updatedAt: "2026-01-01T00:00:00Z" });
    const newest = run({ updatedAt: "2026-01-03T00:00:00Z" });
    const middle = run({ updatedAt: "2026-01-02T00:00:00Z" });
    const input = [oldest, newest, middle];
    const sorted = activeFirst(input);
    expect(sorted.map((r) => r.updatedAt)).toEqual([
      newest.updatedAt,
      middle.updatedAt,
      oldest.updatedAt,
    ]);
    expect(input.map((r) => r.updatedAt)).toEqual([oldest.updatedAt, newest.updatedAt, middle.updatedAt]);
  });
});

describe("run-list source contract — the full list exists only behind the toggle", () => {
  test("the default view is active-only (showAll seeds false, lists are filtered)", () => {
    expect(runListSource).toContain("useState(false)");
    expect(runListSource).toContain("runs.filter(isActiveRun)");
    expect(runListSource).toContain("uncorrelated.filter(isActiveSession)");
  });

  test("the filtered lists are what renders (no unfiltered map survives)", () => {
    expect(runListSource).toContain("visibleRuns.map(");
    expect(runListSource).toContain("visibleUncorrelated.map(");
    expect(runListSource).not.toMatch(/\buncorrelated\.map\(/);
    expect(runListSource).not.toMatch(/\bruns\.map\(/);
  });

  test("the toggle is the only path to the full list and is copy-owned", () => {
    expect(runListSource).toContain("SHOW_ALL_LABEL");
    expect(runListSource).toContain("ACTIVE_ONLY_LABEL");
    expect(runListSource).toContain("setShowAll(!showAll)");
    // The toggle appears only while it can change something (quiet state).
    expect(runListSource).toContain("toggleVisible = showAll || hiddenCount > 0");
  });

  test("the default view keeps its own honest empty state", () => {
    expect(runListSource).toContain("EMPTY_ACTIVE_NOTICE");
    expect(runListSource).toContain("EMPTY_RUNS_NOTICE");
  });
});
