/**
 * Per-run SSE event log (ADR §4.5) — process memory only.
 *
 * Frames are numbered per run (seq starts at 1), ring-buffered up to the
 * configured capacity, and addressed with opaque generation-scoped cursors.
 * Reset frames are connection-local and never enter the shared log. The log
 * owns no HTTP, no timers, and no run lifecycle policy.
 */

import { decodeStreamCursor, encodeStreamCursor } from "./cursor";

export type SseFrameName = "status" | "output" | "reset" | "terminal";

export type OutboundFrame = {
  /** Opaque cursor; clients never parse it. */
  id: string;
  event: SseFrameName;
  data: unknown;
};

type BufferedFrame = OutboundFrame & { seq: number };

export class RunEventLog {
  readonly #generation: number;
  readonly #capacity: number;
  readonly #buffers = new Map<string, BufferedFrame[]>();
  readonly #nextSeq = new Map<string, number>();
  readonly #subscribers = new Map<string, Set<(frame: OutboundFrame) => void>>();

  constructor(generation: number, capacity: number) {
    this.#generation = generation;
    this.#capacity = capacity;
  }

  get generation(): number {
    return this.#generation;
  }

  /** Append one event; assigns the next per-run sequence and fans out live. */
  append(runId: string, event: Exclude<SseFrameName, "reset">, data: unknown): OutboundFrame {
    const seq = this.#bumpSeq(runId);
    const frame: BufferedFrame = {
      seq,
      id: encodeStreamCursor({ generation: this.#generation, runId, seq }),
      event,
      data,
    };
    const buffer = this.#buffers.get(runId) ?? [];
    buffer.push(frame);
    while (buffer.length > this.#capacity) buffer.shift();
    this.#buffers.set(runId, buffer);

    const subscribers = this.#subscribers.get(runId);
    if (subscribers !== undefined) {
      // Snapshot: a subscriber may unsubscribe (mutate the set) during delivery.
      // oxlint-disable-next-line unicorn/no-useless-spread -- defensive copy, see above
      for (const subscriber of [...subscribers]) subscriber(frame);
    }
    return frame;
  }

  /** Cursor addressing "everything appended so far" (connection-local intros). */
  cursorAtHead(runId: string): string {
    const last = this.#nextSeq.get(runId) ?? 1;
    return encodeStreamCursor({ generation: this.#generation, runId, seq: last - 1 });
  }

  /**
   * Replay after a `Last-Event-ID` cursor.
   * - usable cursor → buffered frames after it (`reset: false`)
   * - malformed / foreign generation or run / evicted history → `reset: true`
   */
  replay(runId: string, lastEventId: string | null): { frames: OutboundFrame[]; reset: boolean } {
    if (lastEventId === null) return { frames: [], reset: false };
    const cursor = decodeStreamCursor(lastEventId, this.#generation, runId);
    if (cursor === null) return { frames: [], reset: true };
    const buffer = this.#buffers.get(runId) ?? [];
    const oldestFrame = buffer[0];
    const oldest = oldestFrame !== undefined ? oldestFrame.seq : (this.#nextSeq.get(runId) ?? 1);
    if (cursor.seq + 1 < oldest) return { frames: [], reset: true }; // evicted history
    if (cursor.seq >= (this.#nextSeq.get(runId) ?? 1)) return { frames: [], reset: true }; // from the future
    return { frames: buffer.filter((frame) => frame.seq > cursor.seq), reset: false };
  }

  /** Subscribe to live frames; returns an unsubscribe thunk. */
  subscribe(runId: string, subscriber: (frame: OutboundFrame) => void): () => void {
    const set = this.#subscribers.get(runId) ?? new Set();
    set.add(subscriber);
    this.#subscribers.set(runId, set);
    return () => {
      set.delete(subscriber);
    };
  }

  /** Buffered `output` frames in append order (fresh-connection intros).
   * The ring buffer bounds the result; this is a bounded projection, not a
   * lossless transcript. */
  bufferedOutputs(runId: string): OutboundFrame[] {
    return (this.#buffers.get(runId) ?? []).filter((frame) => frame.event === "output");
  }

  forget(runId: string): void {
    this.#buffers.delete(runId);
    this.#subscribers.delete(runId);
    this.#nextSeq.delete(runId);
  }

  #bumpSeq(runId: string): number {
    const next = this.#nextSeq.get(runId) ?? 1;
    this.#nextSeq.set(runId, next + 1);
    return next;
  }
}
