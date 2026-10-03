/**
 * PaneMirror — the gateway-side terminal-mirror engine (decision
 * 2026-xx-terminal-mirror D2/D5) and the pane SSE surface's state owner.
 *
 * Subscribes to a `PaneObservationPort` by REVISION POLLING (S1): one tick
 * lists the pane inventory and re-reads every observed pane; a frame is
 * appended only when the pane's `revision` changed. Multiple source changes
 * between ticks therefore COALESCE into the latest snapshot (honest snapshot
 * semantics — intermediate revisions are unrecoverable, D5(i)/(ii)).
 *
 * Bounds (all decision D5): per-pane ring buffer (`PANE_REPLAY_BUFFER_FRAMES`),
 * per-frame UTF-8 byte cap with `truncated: true` (`MAX_PANE_TEXT_BYTES`),
 * upstream observation cap (`maxObservedPanes`; over-cap panes are marked
 * `unobserved` in the inventory only), and slow consumers converge via one
 * connection-local `pane_reset(slowConsumer)` exactly like the run family.
 *
 * Every text passes the provider redaction gate (`redactProviderText`) before
 * framing — pane screen buffers can contain operator-pasted credentials.
 */

import { redactProviderText } from "@loop/providers";
import type { RemotePaneSummary, RustraEventPayloads } from "@loop/protocol";

import { ProblemError } from "./problem";
import { PaneEventLog, type PaneOutboundFrame } from "./pane-events";
import type { PaneObservationPort, PaneReading } from "./pane-port";
import { truncateUtf8 } from "./projection";

/** Generated pane frame payloads (Rust-owned: crates/loop-bridge/src/pane.rs,
 * schema-anchored as `loop.pane_*` events). The gateway never re-declares
 * these shapes. */
export type RemotePaneListOutput = RustraEventPayloads["loop.pane_list"];
export type RemotePaneTextPayload = RustraEventPayloads["loop.pane_text"];
export type RemotePaneResetPayload = RustraEventPayloads["loop.pane_reset"];

/** Wire form of the generated `loop.pane_text` payload. `revision` is a
 * decimal STRING on the HTTP/SSE wire (ADR §4.1 u64 rule); the generated TS
 * union `number | bigint` describes the bridge/FFI form, so frame
 * construction asserts through this single documented seam. */
export type RemotePaneTextWireEvent = {
  paneId: string;
  revision: string;
  text: string;
  truncated: boolean;
  occurredAt: string;
};

export type RemotePaneResetWireEvent = RemotePaneTextWireEvent & {
  reason: RemotePaneResetPayload["reason"];
};

export type PaneMirrorOptions = {
  port: PaneObservationPort;
  log: PaneEventLog;
  nowMs?: () => number;
  /** Poll interval in ms (decision D2 default 250 — the BoundedPaneSender axis). */
  pollMs?: number;
  /** Upstream bound on panes actually read per tick (decision D5). */
  maxObservedPanes?: number;
  /** Per-frame UTF-8 byte cap before `truncated: true`. */
  maxFrameBytes?: number;
};

type ObservedPane = { revision: string };

export class PaneMirror {
  readonly #port: PaneObservationPort;
  readonly #log: PaneEventLog;
  readonly #nowMs: () => number;
  readonly #pollMs: number;
  readonly #maxObservedPanes: number;
  readonly #maxFrameBytes: number;
  readonly #observed = new Map<string, ObservedPane>();
  /** Latest known snapshot per pane — reset-frame payload source. */
  readonly #latest = new Map<string, RemotePaneTextWireEvent>();
  /** Last good inventory (404 authority for observePane between ticks). */
  #inventory: RemotePaneSummary[] = [];
  #healthy = false;
  #timer: ReturnType<typeof setInterval> | null = null;
  #busy = false;

  constructor(options: PaneMirrorOptions) {
    this.#port = options.port;
    this.#log = options.log;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#pollMs = options.pollMs ?? 250;
    this.#maxObservedPanes = options.maxObservedPanes ?? 16;
    this.#maxFrameBytes = options.maxFrameBytes ?? 16 * 1024;
  }

  /** Begin interval polling. Test suites drive `tick()` manually instead. */
  start(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      void this.tick();
    }, this.#pollMs);
    this.#timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  get log(): PaneEventLog {
    return this.#log;
  }

  /**
   * One observation cycle: inventory diff + per-pane revision-deduped reads.
   * Errors never throw out of a tick — pane observation is fail-closed and
   * must never affect the run machinery.
   */
  async tick(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const inventory = await this.#port.listPanes();
      if (inventory === null) {
        this.#healthy = false;
        return;
      }
      this.#healthy = true;
      this.#inventory = inventory;

      // Sticky observation slots: already-observed panes keep their slot so a
      // growing inventory cannot starve an active stream (decision D5).
      for (const pane of inventory) {
        if (this.#observed.size >= this.#maxObservedPanes && !this.#observed.has(pane.paneId))
          break;
        if (!this.#observed.has(pane.paneId)) this.#observed.set(pane.paneId, { revision: "" });
      }

      const inventoryIds = new Set(inventory.map((pane) => pane.paneId));
      // Snapshot: #observeGone deletes from #observed while we iterate its keys.
      // oxlint-disable-next-line unicorn/no-useless-spread -- defensive copy, see above
      for (const paneId of [...this.#observed.keys()]) {
        if (!inventoryIds.has(paneId)) {
          this.#observeGone(paneId);
        }
      }

      for (const [paneId, observed] of this.#observed) {
        if (this.#log.isGone(paneId)) continue;
        let reading: PaneReading | null = null;
        try {
          reading = await this.#port.readPane(paneId);
        } catch {
          reading = null; // transient read failure: skip, retry next tick
        }
        if (reading === null) {
          this.#observeGone(paneId);
          continue;
        }
        if (reading.revision === observed.revision) continue; // revision dedupe (D2)
        observed.revision = reading.revision;
        this.#appendTextFrame(paneId, reading);
      }
    } catch {
      // Observation must never break the caller (interval) or the runs.
    } finally {
      this.#busy = false;
    }
  }

  /**
   * GET /v1/panes core: live inventory with observation marks. An unhealthy
   * source fails closed to an empty inventory (`panes: []`).
   */
  async listPanes(): Promise<RemotePaneListOutput> {
    let inventory: RemotePaneSummary[] | null = null;
    try {
      inventory = await this.#port.listPanes();
    } catch {
      inventory = null;
    }
    if (inventory === null) return { panes: [] };
    if (!this.#healthy) return { panes: [] };
    const observedIds = new Set(this.#observed.keys());
    const panes = inventory.map((pane) =>
      observedIds.has(pane.paneId) || this.#log.isGone(pane.paneId)
        ? pane
        : { ...pane, state: "unobserved" as const },
    );
    return { panes };
  }

  /**
   * SSE /v1/panes/{paneId}/events core. Intro computation and the live
   * subscription happen back-to-back so no frame can slip between them.
   */
  observePane(
    paneId: string,
    lastEventId: string | null,
  ): {
    intro: PaneOutboundFrame[];
    terminalAfterIntro: boolean;
    listen(listener: (frame: PaneOutboundFrame) => void): () => void;
  } {
    const known =
      this.#observed.has(paneId) ||
      this.#log.isGone(paneId) ||
      this.#log.bufferedText(paneId).length > 0 ||
      this.#inventory.some((pane) => pane.paneId === paneId);
    if (!known) throw new ProblemError(404, "pane_not_found");

    const replay = this.#log.replay(paneId, lastEventId);
    const intro: PaneOutboundFrame[] = [];
    if (replay.reset) {
      intro.push(this.#resetFrame(paneId, "cursorUnavailable"));
    } else if (lastEventId === null) {
      // Fresh connection: bounded projection of the pane's recent history.
      intro.push(...this.#log.bufferedText(paneId));
    } else {
      intro.push(...replay.frames);
    }

    let terminalAfterIntro = false;
    if (this.#log.isGone(paneId)) {
      // Always appended: the gone frame shares cursorAtHead with the last
      // buffered text frame (same convention as the run family's terminal
      // intro), so an id-based dedup would wrongly drop it.
      const gone = this.#log.goneReset(paneId);
      if (gone !== null) intro.push(gone);
      terminalAfterIntro = true;
    }

    return {
      intro,
      terminalAfterIntro,
      listen: (listener) => this.#log.subscribe(paneId, listener),
    };
  }

  /**
   * Authoritative reset frame for a slow consumer: latest known snapshot plus
   * a fresh cursor. The HTTP layer writes it after SseClientStream drops
   * pane_text frames; null when the pane has no known state.
   */
  slowConsumerReset(paneId: string): PaneOutboundFrame | null {
    if (this.#log.isGone(paneId)) return this.#log.goneReset(paneId);
    if (!this.#latest.has(paneId) && !this.#observed.has(paneId)) return null;
    return this.#resetFrame(paneId, "slowConsumer");
  }

  // ——— internals ———

  #observeGone(paneId: string): void {
    this.#observed.delete(paneId);
    if (this.#log.isGone(paneId)) return;
    const last = this.#latest.get(paneId);
    this.#log.markGone(paneId, {
      paneId,
      reason: "paneGone",
      revision: last?.revision ?? "0",
      text: last?.text ?? "",
      truncated: last?.truncated ?? false,
      occurredAt: new Date(this.#nowMs()).toISOString(),
    } satisfies RemotePaneResetWireEvent);
  }

  #appendTextFrame(paneId: string, reading: PaneReading): void {
    const data = this.#wireEvent(paneId, reading);
    this.#latest.set(paneId, data);
    this.#log.append(paneId, data);
  }

  /** Redact → byte-bound → wire event (revision as decimal string, ADR §4.1). */
  #wireEvent(paneId: string, reading: PaneReading): RemotePaneTextWireEvent {
    // No extra character slice here: the byte bound below is the frame cap.
    const redacted = redactProviderText(reading.text, Number.MAX_SAFE_INTEGER);
    const bounded = truncateUtf8(redacted, this.#maxFrameBytes);
    return {
      paneId,
      revision: reading.revision,
      text: bounded.text,
      truncated: bounded.truncated || reading.truncated,
      occurredAt: new Date(this.#nowMs()).toISOString(),
    };
  }

  /**
   * Connection-local reset frame: carries the pane's latest known snapshot so
   * the client converges immediately. Never buffered for replay (ADR §4.5).
   */
  #resetFrame(paneId: string, reason: "cursorUnavailable" | "slowConsumer"): PaneOutboundFrame {
    const last = this.#latest.get(paneId);
    return {
      id: this.#log.cursorAtHead(paneId),
      event: "pane_reset",
      data: {
        paneId,
        reason,
        revision: last?.revision ?? "0",
        text: last?.text ?? "",
        truncated: last?.truncated ?? false,
        occurredAt: new Date(this.#nowMs()).toISOString(),
      } satisfies RemotePaneResetWireEvent,
    };
  }
}
