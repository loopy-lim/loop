/**
 * Unit tests for the render-derived timeline rows (decision
 * 2026-xx-codex-detail-checklist C6/C7/C8/C9). These rows are presentation
 * derivatives: headers carry their own key prefix and never enter the
 * projection state (D4 §6/§8). Pure functions, no React, no network.
 */

import { describe, expect, test } from "bun:test";

import type { ConversationItem } from "../src/state/conversationProjection";
import {
  shouldRenderEmptyState,
  streamingBusyRowVisible,
  streamingCursorVisible,
  timelineRows,
} from "../src/features/timeline-rows";
import { dayKey } from "../src/features/time-format";

function localIso(year: number, month: number, day: number, hours = 0, minutes = 0): string {
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

function user(messageId: string, occurredAt: string): ConversationItem {
  return {
    kind: "user",
    messageId,
    text: `msg ${messageId}`,
    source: "interactive",
    imageCount: 0,
    attachments: [],
    occurredAt,
  };
}

function assistant(messageId: string, occurredAt: string, final = true): ConversationItem {
  return { kind: "assistant", messageId, text: "…", final, truncated: false, occurredAt };
}

function tool(toolCallId: string, occurredAt: string): ConversationItem {
  return {
    kind: "tool",
    toolCallId,
    toolName: "read",
    argsJson: "{}",
    argsTruncated: false,
    state: "done",
    resultText: null,
    resultTruncated: false,
    interrupted: false,
    occurredAt,
  };
}

function steer(): ConversationItem {
  return { kind: "steer", steerId: null, text: "go on", status: "pending", foldedMessageId: null };
}

describe("date headers between adjacent days (C8, AC8-1)", () => {
  test("yesterday 23:50 → today 00:05 yields exactly ONE boundary header", () => {
    const items = [
      user("m1", localIso(2026, 9, 25, 23, 50)),
      assistant("a1", localIso(2026, 9, 26, 0, 5)),
    ];
    const rows = timelineRows(items);
    const headers = rows.filter((row) => row.kind === "dateHeader");
    expect(headers).toHaveLength(1);
    expect(headers[0]?.kind === "dateHeader" && headers[0]?.rowKey.startsWith("hdr:")).toBe(true);
  });

  test("ten same-day items yield ZERO headers", () => {
    const items = Array.from({ length: 10 }, (_, i) => user(`m${i}`, localIso(2026, 9, 26, 8 + i)));
    expect(timelineRows(items).filter((row) => row.kind === "dateHeader")).toHaveLength(0);
  });

  test("the very first item gets no header (nothing changed before it)", () => {
    const rows = timelineRows([user("m1", localIso(2026, 9, 26, 9, 0))]);
    expect(rows.every((row) => row.kind !== "dateHeader")).toBe(true);
  });
});

describe("row keys stay idempotent and header-free (C8, AC8-2)", () => {
  test("headers use the hdr: prefix; item keys keep the D4 scheme", () => {
    const rows = timelineRows([
      user("m1", localIso(2026, 9, 25, 23, 50)),
      tool("t1", localIso(2026, 9, 26, 0, 5)),
    ]);
    const keys = rows.map((row) => row.rowKey);
    expect(keys.some((key) => key.startsWith("hdr:"))).toBe(true);
    expect(keys).toContain("u:m1");
    expect(keys).toContain("t:t1");
    expect(new Set(keys).size).toBe(keys.length); // no collisions
  });
});

describe("clock captions on the first row of a same-role run (C6, AC6-2)", () => {
  test("consecutive same-kind rows show the caption only on the first", () => {
    const items = [
      assistant("a1", localIso(2026, 9, 26, 9, 0)),
      assistant("a2", localIso(2026, 9, 26, 9, 1)),
      assistant("a3", localIso(2026, 9, 26, 9, 2)),
    ];
    const rows = timelineRows(items).filter((row) => row.kind === "item");
    expect(rows.map((row) => (row.kind === "item" ? row.showOccurredAt : null))).toEqual([
      true,
      false,
      false,
    ]);
  });

  test("a role change re-shows the caption", () => {
    const rows = timelineRows([
      user("m1", localIso(2026, 9, 26, 9, 0)),
      tool("t1", localIso(2026, 9, 26, 9, 1)),
    ]);
    const flags = rows.map((row) => (row.kind === "item" ? row.showOccurredAt : null));
    expect(flags).toEqual([true, true]);
  });

  test("steer markers never get captions and never reset the caption cursor", () => {
    const rows = timelineRows([
      assistant("a1", localIso(2026, 9, 26, 9, 0)),
      steer(),
      assistant("a2", localIso(2026, 9, 26, 9, 2)),
    ]);
    const flags = rows.map((row) => (row.kind === "item" ? row.showOccurredAt : null));
    expect(flags).toEqual([true, false, false]);
  });
});

describe("streaming cursor + busy row flags (C7, AC7-1)", () => {
  test("a non-final assistant message shows the cursor; a final one does not", () => {
    expect(streamingCursorVisible(false)).toBe(true);
    expect(streamingCursorVisible(true)).toBe(false);
  });

  test("an empty buffer mid-stream shows the busy row instead", () => {
    expect(streamingBusyRowVisible("", false)).toBe(true);
    expect(streamingBusyRowVisible("partial text", false)).toBe(false);
    expect(streamingBusyRowVisible("done text", true)).toBe(false);
  });
});

describe("empty-state decision (C9, AC9-2)", () => {
  test("zero items → the centered empty block renders", () => {
    expect(shouldRenderEmptyState(0)).toBe(true);
  });

  test("any items → it does not", () => {
    expect(shouldRenderEmptyState(1)).toBe(false);
    expect(shouldRenderEmptyState(42)).toBe(false);
  });
});

describe("dayKey contract used by the screen (C8)", () => {
  test("headers label from the boundary item's own day", () => {
    expect(dayKey(localIso(2026, 9, 26, 0, 5))).toBe("2026-09-26");
  });
});
