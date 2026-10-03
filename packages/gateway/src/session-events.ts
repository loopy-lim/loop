/**
 * Per-session SSE event log (decision 2026-xx-gui-conversation D3) — the
 * THIRD log family, separate from the run `RunEventLog` and the pane
 * `PaneEventLog`; process memory only.
 *
 * Frames are numbered per session (seq starts at 1), ring-buffered up to the
 * configured capacity, and addressed with the same opaque generation-scoped
 * cursors as runs and panes (`cursor.ts`, sessionId in the runId slot).
 * Conversation frame payloads are the Rustra-generated shapes
 * (`@loop/protocol` `RustraEventPayloads["loop.*"]`, minus the `loop.` prefix
 * on the SSE event name) — this module is shape-agnostic: it sequences,
 * buffers, and fans out.
 *
 * Reset frames are connection-local EXCEPT `sessionGone`, which is a session
 * lifetime fact shared with every open stream and recorded so later
 * reconnects replay history and then converge on the same reset (the pane
 * `paneGone` precedent). The log owns no HTTP, no timers, and no session
 * lifecycle policy.
 */

import { decodeStreamCursor, encodeStreamCursor } from "./cursor";

/** Buffered conversation frame names (decision D2 vocabulary, `loop.` prefix
 * stripped, same rule as the pane family). `conversation_reset` is never
 * appended — see `markSessionGone`. */
export type ConversationFrameName =
  | "user_message"
  | "assistant_delta"
  | "assistant_message"
  | "tool_call_started"
  | "tool_call_ended"
  | "lifecycle"
  | "steer_queued";

export type SessionOutboundFrame = {
  /** Opaque cursor; clients never parse it. */
  id: string;
  event: ConversationFrameName | "conversation_reset";
  data: unknown;
};

type BufferedFrame = SessionOutboundFrame & { seq: number };

export class SessionEventLog {
  readonly #generation: number;
  readonly #capacity: number;
  readonly #buffers = new Map<string, BufferedFrame[]>();
  readonly #nextSeq = new Map<string, number>();
  readonly #subscribers = new Map<string, Set<(frame: SessionOutboundFrame) => void>>();
  readonly #goneResets = new Map<string, SessionOutboundFrame>();

  constructor(generation: number, capacity: number) {
    this.#generation = generation;
    this.#capacity = capacity;
  }

  get generation(): number {
    return this.#generation;
  }

  /** Append one conversation frame; assigns the next per-session sequence and fans out live. */
  append(sessionId: string, event: ConversationFrameName, data: unknown): SessionOutboundFrame {
    const seq = this.#bumpSeq(sessionId);
    const frame: BufferedFrame = {
      seq,
      id: encodeStreamCursor({ generation: this.#generation, runId: sessionId, seq }),
      event,
      data,
    };
    const buffer = this.#buffers.get(sessionId) ?? [];
    buffer.push(frame);
    while (buffer.length > this.#capacity) buffer.shift();
    this.#buffers.set(sessionId, buffer);

    const subscribers = this.#subscribers.get(sessionId);
    if (subscribers !== undefined) {
      // Snapshot: a subscriber may unsubscribe (mutate the set) during delivery.
      // oxlint-disable-next-line unicorn/no-useless-spread -- defensive copy, see above
      for (const subscriber of [...subscribers]) subscriber(frame);
    }
    return frame;
  }

  /** Cursor addressing "everything appended so far" (connection-local intros). */
  cursorAtHead(sessionId: string): string {
    const last = this.#nextSeq.get(sessionId) ?? 1;
    return encodeStreamCursor({ generation: this.#generation, runId: sessionId, seq: last - 1 });
  }

  /**
   * Replay after a `Last-Event-ID` cursor (identical semantics to the run and
   * pane logs — proven by the shared session-stream test suite):
   * - usable cursor → buffered frames after it (`reset: false`)
   * - malformed / foreign generation or session / evicted history / from the
   *   future → `reset: true`
   */
  replay(
    sessionId: string,
    lastEventId: string | null,
  ): { frames: SessionOutboundFrame[]; reset: boolean } {
    if (lastEventId === null) return { frames: [], reset: false };
    const cursor = decodeStreamCursor(lastEventId, this.#generation, sessionId);
    if (cursor === null) return { frames: [], reset: true };
    const buffer = this.#buffers.get(sessionId) ?? [];
    const oldestFrame = buffer[0];
    const oldest =
      oldestFrame !== undefined ? oldestFrame.seq : (this.#nextSeq.get(sessionId) ?? 1);
    if (cursor.seq + 1 < oldest) return { frames: [], reset: true }; // evicted history
    if (cursor.seq >= (this.#nextSeq.get(sessionId) ?? 1)) return { frames: [], reset: true }; // from the future
    return { frames: buffer.filter((frame) => frame.seq > cursor.seq), reset: false };
  }

  /** Subscribe to live frames; returns an unsubscribe thunk. */
  subscribe(sessionId: string, subscriber: (frame: SessionOutboundFrame) => void): () => void {
    const set = this.#subscribers.get(sessionId) ?? new Set();
    set.add(subscriber);
    this.#subscribers.set(sessionId, set);
    return () => {
      set.delete(subscriber);
    };
  }

  /** Buffered conversation frames in append order (fresh-connection intros).
   * The ring buffer bounds the result; this is a bounded projection, not a
   * lossless transcript. */
  bufferedFrames(sessionId: string): SessionOutboundFrame[] {
    return this.#buffers.get(sessionId) ?? [];
  }

  /** True when any frame for the session is buffered or its lifetime is known. */
  hasHistory(sessionId: string): boolean {
    return (this.#buffers.get(sessionId)?.length ?? 0) > 0 || this.#nextSeq.has(sessionId);
  }

  /**
   * Record session termination: build + fan out one
   * `conversation_reset(sessionGone)` frame to live subscribers and remember
   * it so reconnects converge identically. Shares `cursorAtHead` with the
   * last buffered frame (the run/pane terminal convention, so an id-based
   * dedupe does not drop it).
   */
  markSessionGone(sessionId: string, data: unknown): SessionOutboundFrame {
    const frame: SessionOutboundFrame = {
      id: this.cursorAtHead(sessionId),
      event: "conversation_reset",
      data,
    };
    this.#goneResets.set(sessionId, frame);
    const subscribers = this.#subscribers.get(sessionId);
    if (subscribers !== undefined) {
      // Snapshot: a subscriber may unsubscribe (mutate the set) during delivery.
      // oxlint-disable-next-line unicorn/no-useless-spread -- defensive copy, see above
      for (const subscriber of [...subscribers]) subscriber(frame);
    }
    return frame;
  }

  isGone(sessionId: string): boolean {
    return this.#goneResets.has(sessionId);
  }

  goneReset(sessionId: string): SessionOutboundFrame | null {
    return this.#goneResets.get(sessionId) ?? null;
  }

  forget(sessionId: string): void {
    this.#buffers.delete(sessionId);
    this.#subscribers.delete(sessionId);
    this.#nextSeq.delete(sessionId);
    this.#goneResets.delete(sessionId);
  }

  #bumpSeq(sessionId: string): number {
    const next = this.#nextSeq.get(sessionId) ?? 1;
    this.#nextSeq.set(sessionId, next + 1);
    return next;
  }
}
