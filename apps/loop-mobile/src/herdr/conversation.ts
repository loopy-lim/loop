/**
 * Chat-surface model (agent-session adapters) — the pure decision layer for
 * the agent detail's chat segment. The gateway normalizes each agent CLI's
 * session storage into structured turns (claude/codex) or a summary card
 * (agy); this module owns the gating: which surface renders, and when the
 * ANSI transcript stays the body. No network, no React.
 *
 * Rule (rebuild brief §7 spirit): structured data is additive, never a
 * replacement that can blank the screen — any miss (404, empty turns,
 * unsupported kind) falls back to the transcript the pane mirror provides.
 */

import type { HerdrConversation, HerdrConversationTurn } from "./wire";

/** The chat segment's body decision. */
export type ChatBody =
  | { view: "turns"; turns: Extract<HerdrConversation, { surface: "turns" }> }
  | { view: "summary"; summary: Extract<HerdrConversation, { surface: "summary" }> }
  | { view: "transcript" };

/** Gate a fetched conversation into a body. An unusable payload (wrong pane,
 * empty turns, unknown shape) degrades to the transcript, never an error. */
export function chatBody(paneId: string, conversation: HerdrConversation | null): ChatBody {
  if (conversation === null || conversation.paneId !== paneId) return { view: "transcript" };
  if (conversation.surface === "turns") {
    return conversation.turns.length > 0 ? { view: "turns", turns: conversation } : { view: "transcript" };
  }
  return { view: "summary", summary: conversation };
}

/** Fold an adapter summary status into herdr's five-state vocabulary —
 * unknown values are 1급 unknown, never guessed (rebuild brief §7). */
export function summaryStatus(status: string): "idle" | "working" | "blocked" | "done" | "unknown" {
  switch (status) {
    case "idle":
    case "working":
    case "blocked":
    case "done":
      return status;
    default:
      return "unknown";
  }
}

/** Replace-wholesale read rule (transcript.ts precedent): a fetched payload
 * becomes the pane's conversation only if it is current for the pane;
 * anything else keeps the previous value. */
export function nextConversation(
  paneId: string,
  current: HerdrConversation | null,
  fetched: HerdrConversation,
): HerdrConversation | null {
  if (fetched.paneId !== paneId) return current;
  return fetched;
}

/** Content equality for one conversation turn — the chat row memo
 * comparator's predicate. Every fetch rebuilds every turn object, so a
 * reference compare would re-render the whole list each streamed tick; this
 * compares only what a row renders (identity plus visible text/state). */
export function turnsEqual(a: HerdrConversationTurn, b: HerdrConversationTurn): boolean {
  if (a.id !== b.id || a.kind !== b.kind) return false;
  if (a.kind === "user" && b.kind === "user") return a.text === b.text;
  if (a.kind === "assistant" && b.kind === "assistant") return a.text === b.text;
  if (a.kind === "tool" && b.kind === "tool") {
    return a.title === b.title && a.detail === b.detail && a.state === b.state;
  }
  return false;
}

/** Which reads one refresh tick needs — the pure contract the screen's
 * refresh callback executes: the transcript rides the terminal segment and
 * every non-turns fallback, the structured conversation rides the chat
 * segment only. */
export type RefreshPlan = { transcript: boolean; conversation: boolean };

export function planRefresh(
  segment: "chat" | "terminal",
  surface: "turns" | "other" | "unknown",
  forceTranscript: boolean,
): RefreshPlan {
  const chatSegment = segment === "chat";
  return {
    transcript: forceTranscript || !chatSegment || surface !== "turns",
    conversation: chatSegment,
  };
}

/** A prompt delivered to the agent whose on-disk record has not been fetched
 * yet — renders as an optimistic trailing user bubble. `seen` holds the
 * user-turn ids already on record when the prompt was attached, so a resent
 * prompt can only retire against NEW history: an old turn with the same
 * text never stands in for this delivery. */
export type PendingPrompt = { id: string; text: string; seen: readonly string[] };

/** User-turn ids of the current conversation — the `seen` snapshot for a
 * pending prompt attached right now. */
export function seenUserIds(conversation: HerdrConversation | null): string[] {
  if (conversation === null || conversation.surface !== "turns") return [];
  const ids: string[] = [];
  for (const turn of conversation.turns) {
    if (turn.kind === "user") ids.push(turn.id);
  }
  return ids;
}

/** Fold optimistic pending prompts into fetched turns. A prompt leaves the
 * queue when the fetched history carries a user turn with the same trimmed
 * text that was NOT already on record at attach time (one new turn retires
 * one prompt, so identical resends retire one-for-one); the rest render as
 * trailing user turns. Returns the display list and the ids still pending —
 * the screen drops the matched ids from its pending state. */
export function mergePendingTurns(
  fetched: HerdrConversationTurn[],
  pending: readonly PendingPrompt[],
): { turns: HerdrConversationTurn[]; remaining: string[] } {
  if (pending.length === 0) return { turns: fetched, remaining: [] };
  const seenIds = new Set<string>();
  for (const item of pending) {
    for (const id of item.seen) seenIds.add(id);
  }
  const newText = new Map<string, string[]>();
  for (const turn of fetched) {
    if (turn.kind !== "user" || seenIds.has(turn.id)) continue;
    const key = turn.text.trim();
    const ids = newText.get(key);
    if (ids === undefined) newText.set(key, [turn.id]);
    else ids.push(turn.id);
  }
  const turns = [...fetched];
  const remaining: string[] = [];
  for (const item of pending) {
    const ids = newText.get(item.text.trim());
    if (ids !== undefined && ids.length > 0) {
      ids.shift(); // one fresh turn retires one pending prompt
      continue;
    }
    remaining.push(item.id);
    turns.push({ kind: "user", id: item.id, text: item.text, at: null });
  }
  return { turns, remaining };
}
