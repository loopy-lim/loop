/**
 * Render-derived timeline rows (decision 2026-xx-codex-detail-checklist
 * C6/C8/C9). Date headers and per-row clock captions are presentation
 * derivatives: nothing here enters the projection state or the projection
 * item vocabulary (D4 §6), and header rows carry their own key prefix so
 * they never collide with the idempotent item keys (D4 §1).
 */

import type { ConversationItem } from "../state/conversationProjection";
import { dayKey, dayLabel } from "./time-format";

export type TimelineRow =
  | { kind: "dateHeader"; rowKey: string; label: string }
  | { kind: "item"; rowKey: string; item: ConversationItem; showOccurredAt: boolean };

/** True when the timeline shows the centered empty-state block (C9). */
export function shouldRenderEmptyState(itemCount: number): boolean {
  return itemCount === 0;
}

/** Streaming cursor flag (C7): the cursor shows exactly while the
 * assistant message is not yet final — the projection's `final` field is
 * the only input. */
export function streamingCursorVisible(final: boolean): boolean {
  return !final;
}

/** Busy-row flag (C7): a still-streaming assistant message with an EMPTY
 * buffer shows the busy glyph row (existing glyph.busy) instead of a
 * cursor on nothing. */
export function streamingBusyRowVisible(text: string, final: boolean): boolean {
  return !final && text.length === 0;
}

/** Idempotent item key — the exact scheme the screen rendered inline before
 * this module existed (markers are append-only, index is stable). */
function itemKey(item: ConversationItem, index: number): string {
  if (item.kind === "user") return `u:${item.messageId}`;
  if (item.kind === "assistant") return `a:${item.messageId}`;
  if (item.kind === "tool") return `t:${item.toolCallId}`;
  return `s:${index}`;
}

/**
 * Interleave date headers where the local calendar day changes BETWEEN
 * adjacent items (C8). The first item gets no header (nothing changed
 * before it): yesterday 23:50 → today 00:05 yields exactly one boundary,
 * ten same-day items yield none. Steer markers carry no occurredAt — they
 * never move the day cursor and never get clock captions (C6: captions sit
 * on the first row of a consecutive same-role run).
 */
export function timelineRows(items: readonly ConversationItem[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let lastDay: string | null = null;
  let lastCaptionKind: ConversationItem["kind"] | null = null;
  items.forEach((item, index) => {
    if ("occurredAt" in item) {
      const day = dayKey(item.occurredAt);
      if (lastDay !== null && day !== lastDay) {
        rows.push({
          kind: "dateHeader",
          rowKey: `hdr:${day}:${index}`,
          label: dayLabel(item.occurredAt),
        });
      }
      lastDay = day;
      rows.push({
        kind: "item",
        rowKey: itemKey(item, index),
        item,
        showOccurredAt: item.kind !== lastCaptionKind,
      });
      lastCaptionKind = item.kind;
      return;
    }
    rows.push({ kind: "item", rowKey: itemKey(item, index), item, showOccurredAt: false });
  });
  return rows;
}
