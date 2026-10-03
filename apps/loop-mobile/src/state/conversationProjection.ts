/**
 * Conversation projection — reduces the session event stream into display
 * state per the fixed rendering contract (decision 2026-xx-gui-conversation
 * D4). Pure state: no network, no React — the screen renders `snapshot()`.
 *
 * Contract rules implemented here (D4):
 * 1. Identity-keyed idempotent render: `message_id` / `tool_call_id` /
 *    `steer_id` are the keys; re-delivery (replay duplicates) never changes
 *    state. Ordering is the SSE cursor order; payloads carry no seq.
 * 2. Assistant text: deltas append to the per-`message_id` buffer;
 *    `assistant_message` REPLACES the buffer with the final text (loss and
 *    duplicate deltas converge). A delta arriving after the final is ignored.
 *    If the session ends without a final, the buffer is confirmed as-is.
 * 3. Tool cards: started → running, ended → done|error (is_error). An ended
 *    without a started synthesizes a closed card (no running phase). A
 *    started without an ended at session end stays running, marked
 *    interrupted ("중단") — never reported as an error.
 * 4. Steer markers: local pending marker on composer submit success →
 *    `steer_queued` confirms the OLDEST pending marker ("대기 중") → the next
 *    `user_message(source=steer)` pairs with the OLDEST un-delivered marker
 *    and folds it as "delivered" (order matching only, no text comparison).
 *    Without a marker, a steer user message renders standalone (uncorrelated
 *    sessions / restarts) as honest delivery evidence.
 * 6. Lifecycle frames are a UI axis (running badge), never timeline items.
 * 5/7/8. Fold state is app-local; unknown frames never reach this module
 *    (decoder drops them); no re-redaction happens in the app.
 */

import type {
  ConversationStreamEvent,
  RemoteSessionSummary,
  RustraEventPayloads,
} from "../gateway-client/conversation";

type UserMessageFrame = RustraEventPayloads["loop.user_message"];
type AssistantMessageFrame = RustraEventPayloads["loop.assistant_message"];
type ToolCallEndedFrame = RustraEventPayloads["loop.tool_call_ended"];
type SteerQueuedFrame = RustraEventPayloads["loop.steer_queued"];

/** Closed vocabulary of tool-card states (D4 §3). */
export type ToolCardState = "running" | "done" | "error";

/** Steer marker lifecycle (D4 §4): local → accepted → observed in-session. */
export type SteerMarkerStatus = "pending" | "queued" | "delivered";

/**
 * D4 §5 fold rule (app-local, no wire presence): a running card starts open,
 * its result collapses it, and the user's explicit toggle wins over both.
 */
export function toolCardExpanded(state: ToolCardState, userOverride: boolean | undefined): boolean {
  return userOverride ?? state === "running";
}

/** One timeline item. Fold state lives in the screen, not here (D4 §5). */
export type ConversationItem =
  | {
      kind: "user";
      messageId: string;
      text: string;
      source: UserMessageFrame["source"];
      imageCount: number;
      /** M2 (D5): reference-shaped attachment metadata; bodies are fetched
       * out-of-band by the app's attachment cache (never on the stream). */
      attachments: UserMessageFrame["attachments"];
      occurredAt: string;
    }
  | {
      kind: "assistant";
      messageId: string;
      text: string;
      /** False while streaming deltas; the final frame (or session end) sets it. */
      final: boolean;
      truncated: boolean;
      occurredAt: string;
    }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      argsJson: string;
      argsTruncated: boolean;
      state: ToolCardState;
      resultText: string | null;
      resultTruncated: boolean;
      /** Started but never ended when the session ended; never an error. */
      interrupted: boolean;
      occurredAt: string;
    }
  | {
      kind: "steer";
      steerId: string | null;
      text: string;
      status: SteerMarkerStatus;
      /** The folded in-session user message id (null until delivered); the
       * replay-duplicate guard for order-matched folds (D4 §1/§4). */
      foldedMessageId: string | null;
    };

export type ConversationViewState = {
  items: readonly ConversationItem[];
  /** True between turn_started and turn_ended (composer shows "running"). */
  running: boolean;
  /** A reset/transport gap is being recovered by replay. */
  stale: boolean;
  /** session_gone observed; the stream is closed. */
  ended: boolean;
  /** session_ended lifecycle observed (stream may still be open). */
  sessionEnded: boolean;
};

/** Mutable item view used while folding frames; frozen into the snapshot. */
type Draft = {
  items: ConversationItem[];
  running: boolean;
  stale: boolean;
  ended: boolean;
  sessionEnded: boolean;
};

export class ConversationProjection {
  readonly #sessionId: string;
  #state: Draft;

  constructor(sessionId: string) {
    this.#sessionId = sessionId;
    this.#state = { items: [], running: false, stale: false, ended: false, sessionEnded: false };
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  snapshot(): ConversationViewState {
    return {
      items: this.#state.items,
      running: this.#state.running,
      stale: this.#state.stale,
      ended: this.#state.ended,
      sessionEnded: this.#state.sessionEnded,
    };
  }

  /** Attach inventory metadata (title/state badge); identity-checked. */
  applySummary(summary: RemoteSessionSummary): void {
    if (summary.sessionId !== this.#sessionId) return;
    if (summary.state === "ended" && !this.#state.sessionEnded) {
      // Inventory truth: the session is over even without a lifecycle frame.
      this.#state = { ...this.#state, sessionEnded: true, running: false };
      this.finalizeOpenItems();
    }
  }

  /** Apply one decoded stream event (unknown families never arrive here). */
  apply(event: ConversationStreamEvent): void {
    if (event.kind !== "conversation_reset") {
      this.markFrameApplied(); // any frame proves continuity after a reset gap
    }
    switch (event.kind) {
      case "user_message":
        this.applyUserMessage(event.frame);
        break;
      case "assistant_delta":
        this.applyAssistantDelta(event.frame);
        break;
      case "assistant_message":
        this.applyAssistantMessage(event.frame);
        break;
      case "tool_call_started":
        this.applyToolStarted(event.frame);
        break;
      case "tool_call_ended":
        this.applyToolEnded(event.frame);
        break;
      case "lifecycle":
        this.applyLifecycle(event.frame.phase);
        break;
      case "steer_queued":
        this.applySteerQueued(event.frame);
        break;
      case "conversation_reset":
        this.applyReset(event.frame.reason);
        break;
    }
  }

  /** App-local pending marker after a successful composer steer submit (D4 §4). */
  appendLocalSteer(text: string): void {
    this.#state = {
      ...this.#state,
      items: [
        ...this.#state.items,
        { kind: "steer", steerId: null, text, status: "pending", foldedMessageId: null },
      ],
    };
  }

  private applyUserMessage(frame: UserMessageFrame): void {
    if (frame.source === "steer") {
      // A replay duplicate of an already-folded steer message is a no-op:
      // the fold records the message identity on the marker (D4 §1/§4).
      if (
        this.#state.items.some(
          (item) => item.kind === "steer" && item.foldedMessageId === frame.messageId,
        )
      ) {
        return;
      }
      // Otherwise fold into the OLDEST un-delivered marker (order matching
      // only — no text comparison, D4 §4).
      const index = this.#state.items.findIndex(
        (item) => item.kind === "steer" && item.status !== "delivered",
      );
      if (index >= 0) {
        const items = [...this.#state.items];
        const marker = items[index] as Extract<ConversationItem, { kind: "steer" }>;
        items[index] = { ...marker, status: "delivered", foldedMessageId: frame.messageId };
        this.#state = { ...this.#state, items };
        return; // folded: the marker carries the delivery evidence
      }
      // No marker (uncorrelated session / app restart): standalone evidence.
    }
    // Idempotent on message_id (D4 §1).
    if (
      this.#state.items.some((item) => item.kind === "user" && item.messageId === frame.messageId)
    ) {
      return;
    }
    this.#state = {
      ...this.#state,
      items: [
        ...this.#state.items,
        {
          kind: "user",
          messageId: frame.messageId,
          text: frame.text,
          source: frame.source,
          imageCount: frame.imageCount,
          attachments: frame.attachments,
          occurredAt: frame.occurredAt,
        },
      ],
    };
  }

  private applyAssistantDelta(frame: RustraEventPayloads["loop.assistant_delta"]): void {
    const index = this.#state.items.findIndex(
      (item) => item.kind === "assistant" && item.messageId === frame.messageId,
    );
    if (index < 0) {
      this.#state = {
        ...this.#state,
        items: [
          ...this.#state.items,
          {
            kind: "assistant",
            messageId: frame.messageId,
            text: frame.delta,
            final: false,
            truncated: false,
            occurredAt: frame.occurredAt,
          },
        ],
      };
      return;
    }
    const existing = this.#state.items[index] as Extract<ConversationItem, { kind: "assistant" }>;
    if (existing.final) {
      return; // a delta after the authoritative final never changes state
    }
    const items = [...this.#state.items];
    items[index] = { ...existing, text: existing.text + frame.delta };
    this.#state = { ...this.#state, items };
  }

  private applyAssistantMessage(frame: AssistantMessageFrame): void {
    const index = this.#state.items.findIndex(
      (item) => item.kind === "assistant" && item.messageId === frame.messageId,
    );
    const next: Extract<ConversationItem, { kind: "assistant" }> = {
      kind: "assistant",
      messageId: frame.messageId,
      text: frame.text, // authoritative replacement (D4 §2)
      final: true,
      truncated: frame.truncated,
      occurredAt: frame.occurredAt,
    };
    const items = [...this.#state.items];
    if (index < 0) {
      items.push(next);
    } else {
      items[index] = next;
    }
    this.#state = { ...this.#state, items };
  }

  private applyToolStarted(frame: RustraEventPayloads["loop.tool_call_started"]): void {
    // Idempotent on tool_call_id (D4 §1).
    if (
      this.#state.items.some((item) => item.kind === "tool" && item.toolCallId === frame.toolCallId)
    ) {
      return;
    }
    this.#state = {
      ...this.#state,
      items: [
        ...this.#state.items,
        {
          kind: "tool",
          toolCallId: frame.toolCallId,
          toolName: frame.toolName,
          argsJson: frame.argsJson,
          argsTruncated: frame.argsTruncated,
          state: "running",
          resultText: null,
          resultTruncated: false,
          interrupted: false,
          occurredAt: frame.occurredAt,
        },
      ],
    };
  }

  private applyToolEnded(frame: ToolCallEndedFrame): void {
    const index = this.#state.items.findIndex(
      (item) => item.kind === "tool" && item.toolCallId === frame.toolCallId,
    );
    const closed: Extract<ConversationItem, { kind: "tool" }> = {
      kind: "tool",
      toolCallId: frame.toolCallId,
      toolName: "",
      argsJson: "",
      argsTruncated: false,
      state: frame.isError ? "error" : "done",
      resultText: frame.resultText,
      resultTruncated: frame.resultTruncated,
      interrupted: false,
      occurredAt: frame.occurredAt,
    };
    const items = [...this.#state.items];
    if (index < 0) {
      // started-less ended (replay eviction, collector loss): closed card
      // synthesized without ever passing through running (D4 §3).
      items.push(closed);
      this.#state = { ...this.#state, items };
      return;
    }
    const existing = items[index] as Extract<ConversationItem, { kind: "tool" }>;
    if (existing.state !== "running") {
      return; // duplicate ended is a no-op (idempotent, D4 §1)
    }
    items[index] = {
      ...existing,
      state: frame.isError ? "error" : "done",
      resultText: frame.resultText,
      resultTruncated: frame.resultTruncated,
    };
    this.#state = { ...this.#state, items };
  }

  private applyLifecycle(phase: RustraEventPayloads["loop.lifecycle"]["phase"]): void {
    if (phase === "turnStarted") {
      this.#state = { ...this.#state, running: true };
      return;
    }
    if (phase === "turnEnded") {
      this.#state = { ...this.#state, running: false };
      return;
    }
    if (phase === "sessionEnded") {
      this.#state = { ...this.#state, running: false, sessionEnded: true };
      this.finalizeOpenItems();
    }
    // sessionStarted: nothing to render (UI axis only, D4 §6).
  }

  private applySteerQueued(frame: SteerQueuedFrame): void {
    // Idempotent on steer_id (D4 §1): replay duplicates never re-confirm a
    // marker nor synthesize a second one.
    if (this.#state.items.some((item) => item.kind === "steer" && item.steerId === frame.steerId)) {
      return;
    }
    const index = this.#state.items.findIndex(
      (item) => item.kind === "steer" && item.status === "pending",
    );
    const items = [...this.#state.items];
    if (index >= 0) {
      // Confirm the OLDEST pending marker (order matching, D4 §4).
      const marker = items[index] as Extract<ConversationItem, { kind: "steer" }>;
      items[index] = { ...marker, steerId: frame.steerId, status: "queued" };
      this.#state = { ...this.#state, items };
      return;
    }
    // No local marker (steer submitted elsewhere / app restarted): the frame
    // is the acceptance evidence — render it honestly as queued.
    items.push({
      kind: "steer",
      steerId: frame.steerId,
      text: frame.text,
      status: "queued",
      foldedMessageId: null,
    });
    this.#state = { ...this.#state, items };
  }

  private applyReset(reason: RustraEventPayloads["loop.conversation_reset"]["reason"]): void {
    if (reason === "sessionGone") {
      // Shared-recorded termination: converge and close (pane paneGone axis).
      this.#state = { ...this.#state, ended: true, stale: false, running: false };
      this.finalizeOpenItems();
      return;
    }
    // cursorUnavailable / slowConsumer: replay re-syncs from a fresh frame;
    // the view stays marked stale until the next frame proves continuity.
    this.#state = { ...this.#state, stale: true };
  }

  /** Any decoded frame proves stream continuity after a reset gap. */
  markFrameApplied(): void {
    if (this.#state.stale) {
      this.#state = { ...this.#state, stale: false };
    }
  }

  markStale(stale: boolean): void {
    this.#state = { ...this.#state, stale };
  }

  /**
   * Session end without finals/ends: assistant buffers are confirmed as-is
   * (D4 §2); running tool cards keep state=running but are marked
   * interrupted — never reported as errors (D4 §3).
   */
  private finalizeOpenItems(): void {
    let changed = false;
    const items = this.#state.items.map((item): ConversationItem => {
      if (item.kind === "assistant" && !item.final) {
        changed = true;
        return { ...item, final: true };
      }
      if (item.kind === "tool" && item.state === "running" && !item.interrupted) {
        changed = true;
        return { ...item, interrupted: true };
      }
      return item;
    });
    if (changed) {
      this.#state = { ...this.#state, items };
    }
  }
}
