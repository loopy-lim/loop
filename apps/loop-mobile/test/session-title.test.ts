/**
 * Unit tests for the session naming rule (operator-approved, task
 * `session-title-implementation`): title = first user utterance as one
 * line (newlines → spaces, whitespace collapsed, 48-char ellipsis), no
 * utterance → `새 세션` + start time, repeated titles disambiguated by a
 * start stamp, subtitle = Korean relative time + source badge (TUI/앱).
 *
 * Deterministic: a fixed local-time `now` is injected; dates are built in
 * LOCAL time so no timezone can flake the assertions. Pure functions and
 * pure state only — no React, no network, no model calls.
 */

import { describe, expect, test } from "bun:test";

import { relativeTimeKo } from "../src/features/time-format";
import {
  SESSION_TITLE_MAX_CHARS,
  UNTITLED_SESSION_LABEL,
  clampUtterance,
  oneLine,
  sessionSubtitle,
  sessionTitle,
  sessionTitles,
  sourceBadgeLabel,
} from "../src/features/session-title";
import { SessionNamingIndex, type SessionNamingEvidence } from "../src/state/sessionsView";
import type { ConversationStreamEvent } from "../src/gateway-client/conversation";
import type { RustraEventPayloads } from "@loop/protocol";

/** Local-time ISO builder — keeps the assertions timezone-independent. */
function localIso(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
): string {
  return new Date(year, month - 1, day, hours, minutes, seconds, 0).toISOString();
}

const NOW = new Date(2026, 8, 26, 12, 0, 0, 0); // 2026-09-26 12:00 local

describe("one-line utterance cleanup", () => {
  test("newlines and whitespace runs collapse to single spaces", () => {
    expect(oneLine("fix  the\nflaky\tgateway\r\n  test ")).toBe("fix the flaky gateway test");
  });

  test("clamps past 48 code points with an ellipsis, never before", () => {
    const exactly = "가".repeat(SESSION_TITLE_MAX_CHARS);
    expect(clampUtterance(exactly)).toBe(exactly);
    const long = "가".repeat(SESSION_TITLE_MAX_CHARS + 10);
    const clamped = clampUtterance(long);
    expect(clamped).toBe(`${"가".repeat(SESSION_TITLE_MAX_CHARS)}…`);
    expect(Array.from(clamped)).toHaveLength(SESSION_TITLE_MAX_CHARS + 1);
  });
});

describe("session title rule", () => {
  test("first user utterance becomes the title, one line", () => {
    expect(
      sessionTitle({ utterance: "run  the\ntests\nplease", startedAt: null, source: "tui" }),
    ).toBe("run the tests please");
  });

  test("empty session (no evidence) → 새 세션 without a fabricated time", () => {
    expect(sessionTitle(null)).toBe(UNTITLED_SESSION_LABEL);
    expect(sessionTitle({ utterance: null, startedAt: null, source: null })).toBe(
      UNTITLED_SESSION_LABEL,
    );
  });

  test("utterance-less session with a start time → 새 세션 (stamp)", () => {
    expect(
      sessionTitle({ utterance: null, startedAt: localIso(2026, 9, 25, 14, 3), source: null }),
    ).toBe("새 세션 (2026-09-25 14:03)");
  });

  test("a whitespace-only utterance is no utterance", () => {
    expect(sessionTitle({ utterance: "  \n\t ", startedAt: null, source: null })).toBe(
      UNTITLED_SESSION_LABEL,
    );
  });

  test("an unparseable start time degrades to the bare fallback label", () => {
    expect(sessionTitle({ utterance: null, startedAt: "garbage", source: null })).toBe(
      UNTITLED_SESSION_LABEL,
    );
  });
});

describe("repeated-title disambiguation", () => {
  const utterance = { utterance: "run the tests", startedAt: null, source: "tui" } as const;

  test("two identical utterances get their distinct start stamps appended", () => {
    const titles = sessionTitles([
      { sessionId: "a", evidence: { ...utterance, startedAt: localIso(2026, 9, 25, 9, 0) } },
      { sessionId: "b", evidence: { ...utterance, startedAt: localIso(2026, 9, 26, 9, 0) } },
    ]);
    expect(titles.get("a")).toBe("run the tests (2026-09-25 09:00)");
    expect(titles.get("b")).toBe("run the tests (2026-09-26 09:00)");
  });

  test("a repeated title without a usable stamp stays bare (honest limit)", () => {
    const titles = sessionTitles([
      { sessionId: "a", evidence: { ...utterance, startedAt: null } },
      { sessionId: "b", evidence: { ...utterance, startedAt: "garbage" } },
    ]);
    expect(titles.get("a")).toBe("run the tests");
    expect(titles.get("b")).toBe("run the tests");
  });

  test("unique titles are untouched, and the result is order-independent", () => {
    const rows: ReadonlyArray<{ sessionId: string; evidence: SessionNamingEvidence }> = [
      { sessionId: "a", evidence: { ...utterance, startedAt: localIso(2026, 9, 25, 9, 0) } },
      { sessionId: "b", evidence: { ...utterance, startedAt: localIso(2026, 9, 26, 9, 0) } },
      { sessionId: "c", evidence: { utterance: "other topic", startedAt: null, source: "app" } },
    ];
    const forward = sessionTitles(rows);
    const reversed = sessionTitles([...rows].reverse());
    expect(forward.get("c")).toBe("other topic");
    expect(reversed.get("c")).toBe("other topic");
    expect(forward.get("a")).toBe(reversed.get("a"));
    expect(forward.get("b")).toBe(reversed.get("b"));
  });
});

describe("relative time boundaries (Korean)", () => {
  test("under a minute → 방금", () => {
    expect(relativeTimeKo(localIso(2026, 9, 26, 11, 59, 30), NOW)).toBe("방금");
  });

  test("exactly a minute → 1분 전; 59 minutes still 분", () => {
    expect(relativeTimeKo(localIso(2026, 9, 26, 11, 59), NOW)).toBe("1분 전");
    expect(relativeTimeKo(localIso(2026, 9, 26, 11, 1), NOW)).toBe("59분 전");
  });

  test("exactly an hour → 1시간 전; 23 hours still 시간", () => {
    expect(relativeTimeKo(localIso(2026, 9, 26, 11, 0), NOW)).toBe("1시간 전");
    expect(relativeTimeKo(localIso(2026, 9, 25, 13, 0), NOW)).toBe("23시간 전");
  });

  test("the previous local calendar day (≥24h) → 어제", () => {
    expect(relativeTimeKo(localIso(2026, 9, 25, 11, 0), NOW)).toBe("어제");
  });

  test("two calendar days back → the date", () => {
    expect(relativeTimeKo(localIso(2026, 9, 24, 12, 0), NOW)).toBe("9월 24일");
  });

  test("a different year shows the year", () => {
    expect(relativeTimeKo(localIso(2025, 12, 31, 12, 0), NOW)).toBe("2025년 12월 31일");
  });

  test("future-skewed or unparseable input degrades to empty", () => {
    expect(relativeTimeKo(localIso(2026, 9, 26, 12, 0, 1), NOW)).toBe("");
    expect(relativeTimeKo("garbage", NOW)).toBe("");
  });
});

describe("source badge", () => {
  test("interactive is TUI; api/steer are 앱; unknown is no badge", () => {
    expect(sourceBadgeLabel("tui")).toBe("TUI");
    expect(sourceBadgeLabel("app")).toBe("앱");
    expect(sourceBadgeLabel(null)).toBe("");
  });
});

describe("row subtitle", () => {
  test("relative time + source badge, joined with ·", () => {
    expect(
      sessionSubtitle(
        { utterance: "hi", startedAt: localIso(2026, 9, 26, 11, 55), source: "tui" },
        "pi",
        NOW,
      ),
    ).toBe("5분 전 · TUI");
  });

  test("no observed evidence → the lane stands in (inventory truth)", () => {
    expect(sessionSubtitle(null, "pi", NOW)).toBe("pi");
  });

  test("evidence without a usable time shows the badge alone", () => {
    expect(
      sessionSubtitle({ utterance: "hi", startedAt: "garbage", source: "app" }, "pi", NOW),
    ).toBe("앱");
  });
});

// ——— Evidence fold (state/sessionsView.ts) ———

type UserMessageFrame = RustraEventPayloads["loop.user_message"];
type LifecycleFrame = RustraEventPayloads["loop.lifecycle"];

function userMessage(overrides: Partial<UserMessageFrame>): ConversationStreamEvent {
  return {
    kind: "user_message",
    frame: {
      messageId: "m-1",
      text: "hello",
      source: "interactive",
      imageCount: 0,
      attachments: [],
      occurredAt: localIso(2026, 9, 26, 10, 0),
      ...overrides,
    },
  };
}

function lifecycle(occurredAt: string): ConversationStreamEvent {
  return {
    kind: "lifecycle",
    frame: { phase: "sessionStarted", occurredAt } satisfies LifecycleFrame,
  };
}

describe("SessionNamingIndex fold", () => {
  test("first frame sets startedAt; first user message sets utterance + source", () => {
    const index = new SessionNamingIndex();
    index.observe("s1", lifecycle(localIso(2026, 9, 26, 9, 30)));
    index.observe(
      "s1",
      userMessage({ text: "  fix the\nflaky test  ", occurredAt: localIso(2026, 9, 26, 9, 31) }),
    );
    expect(index.evidence("s1")).toEqual({
      utterance: "  fix the\nflaky test  ",
      startedAt: localIso(2026, 9, 26, 9, 30),
      source: "tui",
    });
    // The rule renders the raw utterance clamped — cleanup is render-time.
    expect(sessionTitle(index.evidence("s1"))).toBe("fix the flaky test");
  });

  test("replay duplicates never replace earlier evidence (D4 §1)", () => {
    const index = new SessionNamingIndex();
    index.observe("s1", userMessage({ messageId: "m-1", text: "first" }));
    index.observe(
      "s1",
      userMessage({ messageId: "m-1", text: "first", occurredAt: "9999-01-01T00:00:00Z" }),
    );
    index.observe("s1", userMessage({ messageId: "m-2", text: "second" }));
    expect(index.evidence("s1")?.utterance).toBe("first");
    expect(index.evidence("s1")?.startedAt).toBe(localIso(2026, 9, 26, 10, 0));
  });

  test("api/steer sources badge as 앱; unknown sessions have no evidence", () => {
    const index = new SessionNamingIndex();
    expect(index.evidence("never")).toBeNull();
    index.observe("s1", userMessage({ source: "api" }));
    expect(index.evidence("s1")?.source).toBe("app");
    index.observe("s2", userMessage({ source: "steer", messageId: "m-9" }));
    expect(index.evidence("s2")?.source).toBe("app");
    // Default fixture time is 10:00 local — 2h before NOW.
    expect(sessionSubtitle(index.evidence("s2"), "pi", NOW)).toBe("2시간 전 · 앱");
  });
});
