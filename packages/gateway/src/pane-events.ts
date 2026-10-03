/**
 * Per-pane SSE event log (decision 2026-xx-terminal-mirror D4/D5) — process
 * memory only, and a SEPARATE frame family from the run event log (the run
 * `RunEventLog` keeps run seq semantics; panes dedupe on `paneId + revision`).
 *
 * Frames are numbered per pane (seq starts at 1), ring-buffered up to the
 * configured capacity, and addressed with the same opaque generation-scoped
 * cursors as runs (`cursor.ts`, paneId in the runId slot). Reset frames are
 * connection-local EXCEPT `paneGone`, which is a pane-lifecycle fact shared
 * with every open stream and recorded so later reconnects replay history and
 * then converge on the same reset. The log owns no HTTP, no timers, and no
 * pane lifecycle policy.
 */

import { decodeStreamCursor, encodeStreamCursor } from "./cursor";

export type PaneFrameName = "pane_text" | "pane_reset";

export type PaneOutboundFrame = {
  /** Opaque cursor; clients never parse it. */
  id: string;
  event: PaneFrameName;
  data: unknown;
};

type BufferedFrame = PaneOutboundFrame & { seq: number };

export class PaneEventLog {
  readonly #generation: number;
  readonly #capacity: number;
  readonly #buffers = new Map<string, BufferedFrame[]>();
  readonly #nextSeq = new Map<string, number>();
  readonly #subscribers = new Map<string, Set<(frame: PaneOutboundFrame) => void>>();
  readonly #goneResets = new Map<string, PaneOutboundFrame>();

  constructor(generation: number, capacity: number) {
    this.#generation = generation;
    this.#capacity = capacity;
  }

  get generation(): number {
    return this.#generation;
  }

  /** Append one text frame; assigns the next per-pane sequence and fans out live. */
  append(paneId: string, data: unknown): PaneOutboundFrame {
    const seq = this.#bumpSeq(paneId);
    const frame: BufferedFrame = {
      seq,
      id: encodeStreamCursor({ generation: this.#generation, runId: paneId, seq }),
      event: "pane_text",
      data,
    };
    const buffer = this.#buffers.get(paneId) ?? [];
    buffer.push(frame);
    while (buffer.length > this.#capacity) buffer.shift();
    this.#buffers.set(paneId, buffer);

    const subscribers = this.#subscribers.get(paneId);
    if (subscribers !== undefined) {
      // Snapshot: a subscriber may unsubscribe (mutate the set) during delivery.
      // oxlint-disable-next-line unicorn/no-useless-spread -- defensive copy, see above
      for (const subscriber of [...subscribers]) subscriber(frame);
    }
    return frame;
  }

  /** Cursor addressing "everything appended so far" (connection-local intros). */
  cursorAtHead(paneId: string): string {
    const last = this.#nextSeq.get(paneId) ?? 1;
    return encodeStreamCursor({ generation: this.#generation, runId: paneId, seq: last - 1 });
  }

  /**
   * Replay after a `Last-Event-ID` cursor (same semantics as the run log):
   * - usable cursor → buffered frames after it (`reset: false`)
   * - malformed / foreign generation or pane / evicted history / from the
   *   future → `reset: true`
   */
  replay(
    paneId: string,
    lastEventId: string | null,
  ): { frames: PaneOutboundFrame[]; reset: boolean } {
    if (lastEventId === null) return { frames: [], reset: false };
    const cursor = decodeStreamCursor(lastEventId, this.#generation, paneId);
    if (cursor === null) return { frames: [], reset: true };
    const buffer = this.#buffers.get(paneId) ?? [];
    const oldestFrame = buffer[0];
    const oldest = oldestFrame !== undefined ? oldestFrame.seq : (this.#nextSeq.get(paneId) ?? 1);
    if (cursor.seq + 1 < oldest) return { frames: [], reset: true }; // evicted history
    if (cursor.seq >= (this.#nextSeq.get(paneId) ?? 1)) return { frames: [], reset: true }; // from the future
    return { frames: buffer.filter((frame) => frame.seq > cursor.seq), reset: false };
  }

  /** Subscribe to live frames; returns an unsubscribe thunk. */
  subscribe(paneId: string, subscriber: (frame: PaneOutboundFrame) => void): () => void {
    const set = this.#subscribers.get(paneId) ?? new Set();
    set.add(subscriber);
    this.#subscribers.set(paneId, set);
    return () => {
      set.delete(subscriber);
    };
  }

  /** Buffered `pane_text` frames in append order (fresh-connection intros).
   * The ring buffer bounds the result; this is a bounded projection, not a
   * lossless transcript. */
  bufferedText(paneId: string): PaneOutboundFrame[] {
    return this.#buffers.get(paneId) ?? [];
  }

  /**
   * Record pane termination: build + fan out one `pane_reset(paneGone)` frame
   * to live subscribers and remember it so reconnects converge identically.
   * Returns the frame for intro use.
   */
  markGone(paneId: string, data: unknown): PaneOutboundFrame {
    const frame: PaneOutboundFrame = {
      id: this.cursorAtHead(paneId),
      event: "pane_reset",
      data,
    };
    this.#goneResets.set(paneId, frame);
    const subscribers = this.#subscribers.get(paneId);
    if (subscribers !== undefined) {
      // Snapshot: a subscriber may unsubscribe (mutate the set) during delivery.
      // oxlint-disable-next-line unicorn/no-useless-spread -- defensive copy, see above
      for (const subscriber of [...subscribers]) subscriber(frame);
    }
    return frame;
  }

  isGone(paneId: string): boolean {
    return this.#goneResets.has(paneId);
  }

  goneReset(paneId: string): PaneOutboundFrame | null {
    return this.#goneResets.get(paneId) ?? null;
  }

  forget(paneId: string): void {
    this.#buffers.delete(paneId);
    this.#subscribers.delete(paneId);
    this.#nextSeq.delete(paneId);
    this.#goneResets.delete(paneId);
  }

  #bumpSeq(paneId: string): number {
    const next = this.#nextSeq.get(paneId) ?? 1;
    this.#nextSeq.set(paneId, next + 1);
    return next;
  }
}
