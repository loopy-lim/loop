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

import type { HerdrConversation } from "./wire";

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
