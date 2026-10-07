/**
 * Chats-list grouping contract (task `main-screen-polish`): the list reads
 * as three sections — In progress (attention included), Today, Earlier —
 * with one simplified row anatomy (title + status glyph + relative time)
 * and no technical identifiers on any row.
 *
 * Two layers, same rule as the rest of the suites here (react-native does
 * not load under the test runtime):
 * 1. Pure: the session-groups fold (bucketing, attention-first ordering,
 *    status glyphs) is unit-tested directly.
 * 2. Source contract: run-list renders the grouped sections, replaces id
 *    fallbacks with the owned empty-state labels, and peeks the FIRST
 *    actionable row's swipe action open.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  attentionFirst,
  groupOfRun,
  groupOfSession,
  isSameLocalDay,
  statusMark,
} from "../src/state/session-groups";
import {
  ACTIVE_HEADING,
  EARLIER_HEADING,
  TODAY_HEADING,
  UNTITLED_RUN_LABEL,
  UNNAMED_SESSION_LABEL,
} from "../src/ui/copy";

const mobileRoot = join(import.meta.dir, "..");
const runListSource = readFileSync(join(mobileRoot, "src/features/run-list.tsx"), "utf8");

const NOW = new Date("2026-10-06T15:00:00");

function run(overrides: { updatedAt: string; terminal?: boolean; status?: string }) {
  return {
    runId: "r-" + overrides.updatedAt,
    status: (overrides.status ?? "running") as "running",
    terminal: overrides.terminal ?? false,
    createdAt: overrides.updatedAt,
    updatedAt: overrides.updatedAt,
    lastSequence: "1",
    taskCounts: { pending: 0, running: 1, attention: 0, done: 0, failed: 0, cancelled: 0 },
  };
}

function session(state: "live" | "ended" | "unobserved") {
  return { sessionId: "s-" + state, lane: "pi", state };
}

describe("isSameLocalDay — the Today/Earlier boundary is the local calendar day", () => {
  test("same instant and same local day are today", () => {
    expect(isSameLocalDay("2026-10-06T09:30:00", NOW)).toBe(true);
    expect(isSameLocalDay("2026-10-06T15:00:00", NOW)).toBe(true);
  });

  test("any earlier day (including yesterday) is not today", () => {
    expect(isSameLocalDay("2026-10-05T23:59:59", NOW)).toBe(false);
    expect(isSameLocalDay("2026-01-01T00:00:00", NOW)).toBe(false);
  });

  test("unparseable input is never today (no fabricated recency)", () => {
    expect(isSameLocalDay("garbage", NOW)).toBe(false);
  });
});

describe("groupOfRun — in progress while non-terminal, attention included", () => {
  test("a non-terminal run is in progress whatever its timestamp", () => {
    expect(groupOfRun(run({ updatedAt: "2026-01-01T00:00:00Z" }), NOW)).toBe("active");
    expect(groupOfRun(run({ updatedAt: "2026-10-06T14:00:00Z" }), NOW)).toBe("active");
  });

  test("a terminal run updated today reads Today", () => {
    expect(groupOfRun(run({ updatedAt: "2026-10-06T08:00:00Z", terminal: true }), NOW)).toBe(
      "today",
    );
  });

  test("a terminal run updated before today reads Earlier", () => {
    expect(groupOfRun(run({ updatedAt: "2026-10-05T08:00:00Z", terminal: true }), NOW)).toBe(
      "earlier",
    );
  });

  test("a terminal run with an unreadable timestamp reads Earlier (honest oldest bucket)", () => {
    expect(groupOfRun(run({ updatedAt: "garbage", terminal: true }), NOW)).toBe("earlier");
  });
});

describe("groupOfSession — live is in progress; recency needs proof", () => {
  test("a live session is in progress whatever its (missing) timestamp", () => {
    expect(groupOfSession(session("live"), null, NOW)).toBe("active");
  });

  test("an ended session proven started today reads Today", () => {
    expect(groupOfSession(session("ended"), "2026-10-06T10:00:00Z", NOW)).toBe("today");
  });

  test("an ended session with old or missing evidence reads Earlier", () => {
    expect(groupOfSession(session("ended"), "2026-10-01T10:00:00Z", NOW)).toBe("earlier");
    // the wire carries no session timestamp; unknown is never claimed as today
    expect(groupOfSession(session("ended"), null, NOW)).toBe("earlier");
    expect(groupOfSession(session("unobserved"), null, NOW)).toBe("earlier");
  });
});

describe("attentionFirst — the unanswered question leads In progress", () => {
  test("attention sorts before running; recency breaks the rest", () => {
    const attentionOld = run({ updatedAt: "2026-10-06T10:00:00Z", status: "attention" });
    const runningNew = run({ updatedAt: "2026-10-06T14:00:00Z" });
    const runningMid = run({ updatedAt: "2026-10-06T12:00:00Z" });
    const sorted = [runningNew, attentionOld, runningMid].toSorted(attentionFirst);
    expect(sorted.map((r) => r.runId)).toEqual([
      attentionOld.runId,
      runningNew.runId,
      runningMid.runId,
    ]);
  });

  test("stable for equal inputs and never mutates ordering promises", () => {
    const a = run({ updatedAt: "2026-10-06T10:00:00Z" });
    const b = run({ updatedAt: "2026-10-06T10:00:00Z" });
    expect([a, b].toSorted(attentionFirst).map((r) => r.runId)).toEqual([a.runId, b.runId]);
  });
});

describe("statusMark — one closed mark per state, quiet for unknown", () => {
  test("the action-worthy states get the loud marks", () => {
    expect(statusMark("attention")).toBe("attention");
    expect(statusMark("failed")).toBe("error");
  });

  test("frequent states stay quiet marks, never words (C-4)", () => {
    expect(statusMark("running")).toBe("running");
    expect(statusMark("planning")).toBe("running");
    expect(statusMark("completed")).toBe("done");
    expect(statusMark("cancelled")).toBe("dot");
    expect(statusMark("accepted")).toBe("dot");
  });
});

describe("run-list source contract — grouped sections, no ids, one peek", () => {
  test("the three section labels are owned copy and all render", () => {
    expect(runListSource).toContain("ACTIVE_HEADING");
    expect(runListSource).toContain("TODAY_HEADING");
    expect(runListSource).toContain("EARLIER_HEADING");
    expect(ACTIVE_HEADING.length).toBeGreaterThan(0);
    expect(TODAY_HEADING.length).toBeGreaterThan(0);
    expect(EARLIER_HEADING.length).toBeGreaterThan(0);
  });

  test("no technical identifier fronts a row — empty-state labels replace ids", () => {
    expect(runListSource).not.toContain("shortRunId(run.runId)");
    expect(runListSource).not.toContain("shortRunId(session.sessionId)");
    expect(runListSource).toContain("UNTITLED_RUN_LABEL");
    expect(runListSource).toContain("UNNAMED_SESSION_LABEL");
    expect(UNTITLED_RUN_LABEL).not.toMatch(/run[_ ]?id/i);
    expect(UNNAMED_SESSION_LABEL).not.toMatch(/session[_ ]?id/i);
  });

  test("the grouping fold feeds the sections (no ad-hoc time logic in the view)", () => {
    expect(runListSource).toContain("groupOfRun(");
    expect(runListSource).toContain("groupOfSession(");
    expect(runListSource).toContain(".slice().sort(attentionFirst)");
    // the mark→role lookup stays in the view, on the closed registry
    // (task `fab-icons`: rows render through ui/Icon by role)
    expect(runListSource).toContain('"statusRunning"');
    expect(runListSource).toContain('"statusDot"');
    expect(runListSource).toContain("statusMark(run.status)");
  });

  test("exactly one row — the first actionable one — peeks its swipe open", () => {
    expect(runListSource).toContain("peekKey");
    expect((runListSource.match(/peekKey/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(runListSource).toContain("peek={row.key === peekKey}");
  });

  test("attention stays the section anchor without its own inbox", () => {
    // the separate inbox section is gone; the anchor lives in the row edge
    expect(runListSource).not.toContain("inboxCard");
    expect(runListSource).toContain('edge: run.status === "attention"');
    expect(runListSource).toContain("rowEdge");
  });

  test("the row anatomy is title + status mark + relative time — no meta line", () => {
    expect(runListSource).toContain("glyphRole");
    expect(runListSource).toContain("<Icon");
    expect(runListSource).toContain("rowTime");
    expect(runListSource).toContain("relativeTime(row.timeIso)");
    expect(runListSource).not.toContain("rowMeta");
    expect(runListSource).not.toContain("countsText(run)");
  });
});
