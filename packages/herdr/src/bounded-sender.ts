/**
 * Rate-limited pane publisher for the worker-visibility mirror
 * (docs/decisions/2026-09-23-worker-visibility.md D4): lines are coalesced and
 * flushed at a minimum interval; overflow beyond the queue bound is dropped
 * and reported once as a `… N lines suppressed` marker so a chatty worker can
 * never flood the Herdr pane (or the herdr CLI pipe).
 */
export interface PaneTextSender {
  sendText(paneId: string, text: string): Promise<void>;
}

export class BoundedPaneSender {
  readonly #runtime: PaneTextSender;
  readonly #paneId: string;
  readonly #intervalMs: number;
  readonly #queue: string[] = [];
  readonly #queueLimit: number;
  #timeout: ReturnType<typeof setTimeout> | null = null;
  #dropped = 0;
  #closed = false;

  constructor(runtime: PaneTextSender, paneId: string, intervalMs = 250, queueLimit = 100) {
    this.#runtime = runtime;
    this.#paneId = paneId;
    this.#intervalMs = intervalMs;
    this.#queueLimit = queueLimit;
  }

  send(line: string): void {
    if (this.#closed) return;
    if (this.#queue.length >= this.#queueLimit) {
      this.#dropped++;
      return;
    }
    this.#queue.push(line);
    this.#schedule();
  }

  /** Stops accepting lines and flushes whatever is pending (including the suppression marker). */
  close(): Promise<void> {
    this.#closed = true;
    if (this.#timeout) clearTimeout(this.#timeout);
    this.#timeout = null;
    return this.#flush();
  }

  #schedule(): void {
    if (this.#timeout || this.#queue.length === 0) return;
    this.#timeout = setTimeout(() => {
      this.#timeout = null;
      this.#flush();
    }, this.#intervalMs);
  }

  #flush(): Promise<void> {
    if (this.#queue.length === 0 && this.#dropped === 0) return Promise.resolve();
    const lines = this.#queue.splice(0, this.#queue.length);
    if (this.#dropped > 0) {
      lines.push(`… ${this.#dropped} lines suppressed`);
      this.#dropped = 0;
    }
    const text = lines.join("\n") + "\n";
    return this.#runtime.sendText(this.#paneId, text).catch(() => {
      // Pane write failures must never break the worker's machine path.
    });
  }
}
