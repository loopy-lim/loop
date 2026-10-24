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
 * user-turn ids already on record when the prompt was attached (plus any
 * turns consumed on a later prompt's behalf), so a resent prompt can only
 * retire against NEW history: an old turn with the same text never stands in
 * for this delivery. `attachedAt` (phone wall clock) bounds that history by
 * time as well — see PENDING_ATTACH_SKEW_MS. */
export type PendingPrompt = {
  id: string;
  text: string;
  seen: readonly string[];
  attachedAt: number;
};

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

/** Wall-clock slack between the phone's attach stamp and the gateway host's
 * turn timestamps: 90s absorbs ordinary clock skew, and the 15s pending
 * timeout bounds any residual mismatch (plan 2026-10-24 A3). */
export const PENDING_ATTACH_SKEW_MS = 90_000;

/** Fold optimistic pending prompts into fetched turns. A prompt leaves the
 * queue when the fetched history carries a user turn that was NOT already on
 * record at attach time and is not stamped (reliably) before the prompt
 * attached — one new turn retires one prompt, so identical resends retire
 * one-for-one. Consumed turn ids are absorbed into the remaining prompts'
 * `seen`, so a later fetch cannot re-consume the same turn for the next
 * identical pending (the retire-cascade fix). Returns the display list and
 * the still-pending prompts — the screen replaces its pending state with
 * them. */
export function mergePendingTurns(
  fetched: HerdrConversationTurn[],
  pending: readonly PendingPrompt[],
): { turns: HerdrConversationTurn[]; remaining: PendingPrompt[] } {
  if (pending.length === 0) return { turns: fetched, remaining: [] };
  const seenIds = new Set<string>();
  for (const item of pending) {
    for (const id of item.seen) seenIds.add(id);
  }
  // Fresh-turn candidates by trimmed text. An absent or unparseable stamp
  // admits the seen guard only (plan 2026-10-24 A5).
  const stampOf = (turn: HerdrConversationTurn): number | null => {
    if (turn.at === null) return null;
    const parsed = Date.parse(turn.at);
    return Number.isNaN(parsed) ? null : parsed;
  };
  const fresh = new Map<string, Array<{ id: string; at: number | null }>>();
  for (const turn of fetched) {
    if (turn.kind !== "user" || seenIds.has(turn.id)) continue;
    const key = turn.text.trim();
    const candidate = { id: turn.id, at: stampOf(turn) };
    const list = fresh.get(key);
    if (list === undefined) fresh.set(key, [candidate]);
    else list.push(candidate);
  }
  const turns = [...fetched];
  const stillPending: PendingPrompt[] = [];
  const consumed: string[] = [];
  for (const item of pending) {
    const floor = item.attachedAt - PENDING_ATTACH_SKEW_MS;
    const list = fresh.get(item.text.trim());
    if (list !== undefined) {
      const index = list.findIndex((candidate) => candidate.at === null || candidate.at >= floor);
      if (index !== -1) {
        const match = list[index]!;
        list.splice(index, 1); // one fresh turn retires one pending prompt
        consumed.push(match.id);
        continue;
      }
    }
    stillPending.push(item);
  }
  // Durable 1:1: a turn consumed here is accounted for — remaining prompts
  // must not stand in for it on a later fetch.
  const remaining =
    consumed.length === 0
      ? stillPending
      : stillPending.map((item) => ({
          ...item,
          seen: [...new Set([...item.seen, ...consumed])],
        }));
  for (const item of remaining) {
    turns.push({ kind: "user", id: item.id, text: item.text, at: null });
  }
  return { turns, remaining };
}

/** Content equality for pending lists — same ids in order, same text and
 * attach stamp, same seen contents. The screen's retire effect leaves state
 * untouched when a merge produced nothing new: replacing with a
 * fresh-but-equal array would retrigger the memo and re-merge every fetch. */
export function pendingSame(a: readonly PendingPrompt[], b: readonly PendingPrompt[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    if (other === undefined) return false;
    if (other.id !== item.id || other.text !== item.text) return false;
    if (other.attachedAt !== item.attachedAt) return false;
    if (other.seen.length !== item.seen.length) return false;
    const ids = new Set(item.seen);
    return other.seen.every((id) => ids.has(id));
  });
}
