/**
 * Connection-level SSE writing (ADR §4.5) — framing, keepalive, and the
 * bounded per-connection outbound queue. When a droppable `output` frame no
 * longer fits, pending outputs are cleared and "dropped" is returned; the
 * owner of the latest run then converges the stream with one authoritative
 * `reset(reason: "slow_consumer")`. If a control frame cannot fit, the
 * connection closes. Runs are never affected.
 */

export const KEEPALIVE_COMMENT = ": keepalive\n\n";

/** Minimal wire shape accepted by the connection writer. Run frames
 * (`OutboundFrame`) and pane frames (pane-events `PaneOutboundFrame`) are
 * both structurally assignable; the event name stays opaque here. */
export type StreamFrame = {
  id: string;
  event: string;
  data: unknown;
};

/** Wire format: `id`, `event`, single JSON data line, blank line (ADR §4.5). */
export function encodeFrame(frame: StreamFrame): string {
  return `id: ${frame.id}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`;
}

type QueuedChunk = { text: string; kind: "control" | "output" | "keepalive" };

export type StreamLimits = {
  maxFrames: number;
  maxBytes: number;
};

export type WriteOutcome = "queued" | "dropped" | "closed";

export class SseClientStream {
  readonly #limits: StreamLimits;
  readonly #queue: QueuedChunk[] = [];
  #closed = false;
  #closeReason: string | null = null;

  constructor(limits: StreamLimits) {
    this.#limits = limits;
  }

  get closed(): boolean {
    return this.#closed;
  }

  get closeReason(): string | null {
    return this.#closeReason;
  }

  /**
   * Enqueue a contract frame. Droppable `output` frames that no longer fit
   * are answered with "dropped" after clearing every pending output; the
   * caller then converges the stream with one authoritative reset frame.
   * Control frames that cannot fit close the connection (ADR §4.5).
   */
  write(frame: StreamFrame, kind: "control" | "output"): WriteOutcome {
    if (this.#closed) return "closed";
    const text = encodeFrame(frame);
    if (!this.#fits(text)) {
      if (kind === "output") {
        this.#dropPendingOutputs();
        return "dropped";
      }
      this.close("control_frame_unqueueable");
      return "closed";
    }
    this.#push({ text, kind });
    return "queued";
  }

  /** SSE comment keepalive; carries no cursor and bypasses frame caps. */
  keepalive(): void {
    if (this.#closed) return;
    this.#push({ text: KEEPALIVE_COMMENT, kind: "keepalive" });
  }

  /** Close after everything already queued (terminal flush, ADR §4.5). */
  close(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeReason = reason;
  }

  /** Bytes currently awaiting delivery (test/inspection seam). */
  get pendingFrames(): number {
    return this.#queue.filter((chunk) => chunk.kind !== "keepalive").length;
  }

  get pendingBytes(): number {
    return this.#queue.reduce((total, chunk) => total + Buffer.byteLength(chunk.text, "utf8"), 0);
  }

  /** Pull the next queued chunk for the transport, if any. */
  read(): string | null {
    return this.#queue.shift()?.text ?? null;
  }

  #fits(text: string): boolean {
    return (
      this.pendingFrames + 1 <= this.#limits.maxFrames &&
      this.pendingBytes + Buffer.byteLength(text, "utf8") <= this.#limits.maxBytes
    );
  }

  #dropPendingOutputs(): void {
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const chunk = this.#queue[index];
      if (chunk?.kind === "output") this.#queue.splice(index, 1);
    }
  }

  #push(chunk: QueuedChunk): void {
    this.#queue.push(chunk);
  }
}
