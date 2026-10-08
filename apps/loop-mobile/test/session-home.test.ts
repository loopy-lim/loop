/**
 * Home session-list contract (task `home-cleanup`): the home list answers
 * "what is live, what just ended" without flooding. One ordering rule for
 * every state — sessionId descending (ULIDs sort by creation time, so the
 * descending id IS newest-first) — one section fold (live pinned on top,
 * ended and unobserved separated), and one honest cap on the ended flood
 * (the recent window renders; the rest exists behind an in-place expand).
 *
 * Two layers, same rule as the rest of the suites here (react-native does
 * not load under the test runtime):
 * 1. Pure: the session-home fold (ordering, sections, cap) is unit-tested
 *    directly — the policy is pinned, not incidental.
 * 2. Source contract: SubmitScreen renders the folded sections, keeps the
 *    expand state component-local, and speaks only in owned copy.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ENDED_SESSIONS_VISIBLE_COUNT,
  endedWindow,
  homeSections,
  sessionHomeRows,
  type SessionHomeRow,
} from "../src/state/session-home";

const mobileRoot = join(import.meta.dir, "..");
const submitSource = readFileSync(join(mobileRoot, "src/screens/SubmitScreen.tsx"), "utf8");

/** ULID-shaped ids sort lexicographically by creation time. */
function session(sessionId: string, state: SessionHomeRow["state"], title?: string) {
  return { sessionId, state, title: title ?? null, runId: null, lane: "pi" };
}

describe("sessionHomeRows — one ordering rule: sessionId descending (newest first)", () => {
  test("orders every state by descending sessionId, live or not", () => {
    const rows = sessionHomeRows([
      session("01HX000000000000000000000A", "ended", "Older ended"),
      session("01HX000000000000000000000D", "live", "Newest live"),
      session("01HX000000000000000000000B", "live", "Middle live"),
      session("01HX000000000000000000000C", "ended", "Newest ended"),
    ]);
    expect(rows.map((row) => row.sessionId)).toEqual([
      "01HX000000000000000000000D",
      "01HX000000000000000000000C",
      "01HX000000000000000000000B",
      "01HX000000000000000000000A",
    ]);
  });

  test("a stale-id live session does not jump ahead of newer ended rows", () => {
    const rows = sessionHomeRows([
      session("01HX000000000000000000000C", "ended"),
      session("01HX000000000000000000000A", "live"),
    ]);
    expect(rows.map((row) => [row.sessionId, row.state])).toEqual([
      ["01HX000000000000000000000C", "ended"],
      ["01HX000000000000000000000A", "live"],
    ]);
  });

  test("deduplicates session IDs and keeps the first sighting", () => {
    const rows = sessionHomeRows([
      session("01HX000000000000000000000A", "ended", "First title"),
      session("01HX000000000000000000000A", "live", "Duplicate"),
    ]);
    expect(rows.map((row) => row.title)).toEqual(["First title"]);
  });

  test("an unnamed session never fabricates a title", () => {
    const rows = sessionHomeRows([session("01HX000000000000000000000A", "live")]);
    expect(rows[0]?.title).toBe("Unnamed session");
  });

  test("empty inventory renders no rows", () => {
    expect(sessionHomeRows([])).toEqual([]);
  });
});

describe("homeSections — live pinned on top; ended and unobserved never mix", () => {
  test("splits the ordered rows into the three home sections", () => {
    const rows = sessionHomeRows([
      session("01HX000000000000000000000C", "ended"),
      session("01HX000000000000000000000B", "unobserved"),
      session("01HX000000000000000000000A", "live"),
    ]);
    const sections = homeSections(rows);
    expect(sections.live.map((row) => row.sessionId)).toEqual(["01HX000000000000000000000A"]);
    expect(sections.ended.map((row) => row.sessionId)).toEqual(["01HX000000000000000000000C"]);
    expect(sections.unobserved.map((row) => row.sessionId)).toEqual(["01HX000000000000000000000B"]);
  });

  test("each section keeps the descending-id order", () => {
    const rows = sessionHomeRows([
      session("01HX000000000000000000000A", "ended"),
      session("01HX000000000000000000000D", "ended"),
      session("01HX000000000000000000000B", "ended"),
    ]);
    expect(homeSections(rows).ended.map((row) => row.sessionId)).toEqual([
      "01HX000000000000000000000D",
      "01HX000000000000000000000B",
      "01HX000000000000000000000A",
    ]);
  });

  test("empty inventory renders empty sections", () => {
    expect(homeSections([])).toEqual({ live: [], ended: [], unobserved: [] });
  });
});

describe("endedWindow — the ended flood renders a recent window, the rest behind expand", () => {
  test("renders only the most recent rows and reports the hidden count", () => {
    const ids = Array.from({ length: 13 }, (_, i) => `01HX000000000000000000000${String.fromCharCode(65 + i)}`);
    const rows = sessionHomeRows(ids.map((id) => session(id, "ended")));
    const window = endedWindow(rows);
    expect(window.visible).toHaveLength(ENDED_SESSIONS_VISIBLE_COUNT);
    // descending id = newest first, so the window keeps ids[12]..ids[3]
    expect(window.visible[0]?.sessionId).toBe(ids[12]);
    expect(window.visible.at(-1)?.sessionId).toBe(ids[3]);
    expect(window.hiddenCount).toBe(3);
  });

  test("a list at or under the cap hides nothing", () => {
    const rows = sessionHomeRows(
      Array.from({ length: ENDED_SESSIONS_VISIBLE_COUNT }, (_, i) =>
        session(`01HX0000000000000000000${i}A`, "ended"),
      ),
    );
    expect(endedWindow(rows)).toEqual({ visible: rows, hiddenCount: 0 });
  });

  test("the cap is the owned constant (10)", () => {
    expect(ENDED_SESSIONS_VISIBLE_COUNT).toBe(10);
  });
});

describe("SubmitScreen source contract — the fold renders, the expand stays local", () => {
  test("the screen renders the folded sections (no ad-hoc filtering survives)", () => {
    expect(submitSource).toContain("homeSections(");
    expect(submitSource).toContain("endedWindow(");
    expect(submitSource).not.toContain('rows.filter((row) => row.state === "live")');
  });

  test("the expand control is component-local state with no navigation", () => {
    expect(submitSource).toContain("useState(false)");
    expect(submitSource).toContain("setEndedExpanded(!endedExpanded)");
    expect(submitSource).not.toContain("onOpenSession?.(ENDED_SESSIONS");
  });

  test("every new phrase is an owned copy constant", () => {
    expect(submitSource).toContain("UNOBSERVED_SESSIONS_HEADING");
    expect(submitSource).toContain("SESSION_ROW_QUIET_LABEL");
    expect(submitSource).toContain("ENDED_SESSIONS_EXPAND_PREFIX");
    expect(submitSource).toContain("ENDED_SESSIONS_EXPAND_SUFFIX");
    expect(submitSource).toContain("ENDED_SESSIONS_COLLAPSE_LABEL");
    expect(submitSource).not.toContain('"Show more');
  });
});
