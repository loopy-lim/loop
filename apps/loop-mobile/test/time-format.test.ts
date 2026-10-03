/**
 * Unit tests for conversation time captions (decision
 * 2026-xx-codex-detail-checklist C6). Deterministic: a fixed `now` is
 * injected; dates are built in LOCAL time so no timezone can flake the
 * assertions. Pure functions, no React, no network.
 */

import { describe, expect, test } from "bun:test";

import { clockTime, dayKey, relativeTime } from "../src/features/time-format";

/** Local-time ISO builder — keeps the assertions timezone-independent. */
function localIso(year: number, month: number, day: number, hours = 0, minutes = 0): string {
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

const NOW = new Date(2026, 8, 26, 12, 0, 0, 0); // 2026-09-26 12:00 local

describe("clock caption (C6)", () => {
  test("renders an HH:MM caption for a row", () => {
    expect(clockTime(localIso(2026, 9, 26, 9, 41))).toMatch(/^\d{2}:\d{2}$/);
  });

  test("unparseable input degrades to an empty string", () => {
    expect(clockTime("not-a-time")).toBe("");
  });
});

describe("relative time for chat-list rows (C6, AC6-1)", () => {
  test("5 minutes ago → `5m`", () => {
    expect(relativeTime(localIso(2026, 9, 26, 11, 55), NOW)).toBe("5m");
  });

  test("2 hours ago → `2h`", () => {
    expect(relativeTime(localIso(2026, 9, 26, 10, 0), NOW)).toBe("2h");
  });

  test("3 days ago → `3d`", () => {
    expect(relativeTime(localIso(2026, 9, 23, 12, 0), NOW)).toBe("3d");
  });

  test("10 days ago → a date string, not a day count", () => {
    const text = relativeTime(localIso(2026, 9, 16, 12, 0), NOW);
    expect(text).not.toBe("10d");
    expect(text).toMatch(/\d{4}/); // a year appears — a date, per AC6-1
  });

  test("unparseable input degrades to an empty string (never crashes)", () => {
    expect(relativeTime("garbage", NOW)).toBe("");
  });
});

describe("calendar-day keying for date headers (C8, AC8-1)", () => {
  test("the key flips exactly at the local midnight boundary", () => {
    const before = dayKey(localIso(2026, 9, 25, 23, 50));
    const after = dayKey(localIso(2026, 9, 26, 0, 5));
    expect(before).not.toBe(after);
    expect(before).toBe("2026-09-25");
    expect(after).toBe("2026-09-26");
  });

  test("unparseable input yields an empty key (never renders a bogus header)", () => {
    expect(dayKey("garbage")).toBe("");
  });
});
