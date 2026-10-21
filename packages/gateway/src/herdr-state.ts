/**
 * Herdr state monitor (rebuild brief docs/design/rebuild-brief-herdr-first.md
 * §4) — turns the herdr surface port into one observable state view for the
 * app: initial snapshot, prompt refresh on subscription events, and a slow
 * safety poll that converges any missed event.
 *
 * Contract:
 * - `current()` never throws: herdr unreachable → `{available: false}` with
 *   the last known entities cleared (fail-observer, same axis as the pane
 *   mirror).
 * - `version` increments only when the mapped view actually changes, so SSE
 *   clients and the app can ignore no-op frames.
 * - The monitor is the ONLY subscriber to the herdr feed; route handlers see
 *   the monitor alone. Structure events also restart the feed so per-pane
 *   state subscriptions track the current pane set.
 *
 * Not here: HTTP, SSE framing, cursors — those belong to the server layer.
 */

import type {
  HerdrControlClient,
  HerdrSnapshotView,
  HerdrSubscription,
  HerdrSurfaceEvent,
} from "./herdr-pane-source";

export type HerdrStateView = HerdrSnapshotView & {
  /** False when the last refresh could not reach herdr. */
  available: boolean;
  /** Monotonic change counter for the mapped view (starts at 1). */
  version: number;
};

export type HerdrStateMonitorOptions = {
  /** Safety poll interval (default 10s) — events stay the fast path. */
  pollMs?: number;
  /** Coalescing window for refresh bursts (default 200ms). */
  coalesceMs?: number;
};

const FEED_RESTART_COALESCE_MS = 400;

export class HerdrStateMonitor {
  readonly #client: HerdrControlClient;
  readonly #pollMs: number;
  readonly #coalesceMs: number;
  readonly #listeners = new Set<(state: HerdrStateView) => void>();
  #view: HerdrStateView = emptyView();
  #feed: HerdrSubscription | null = null;
  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #restartTimer: ReturnType<typeof setTimeout> | null = null;
  #refreshing = false;
  #refreshQueued = false;
  #started = false;

  constructor(client: HerdrControlClient, options: HerdrStateMonitorOptions = {}) {
    this.#client = client;
    this.#pollMs = options.pollMs ?? 10_000;
    this.#coalesceMs = options.coalesceMs ?? 200;
  }

  /** Begin observing: one immediate refresh, the feed, and the safety poll.
   * Idempotent; never throws (herdr may be absent at boot). */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#feed = this.#client.subscribe(
      () => this.#view.panes.map((pane) => pane.id),
      (event) => this.#onFeedEvent(event),
    );
    this.#pollTimer = setInterval(() => void this.#refresh(), this.#pollMs);
    void this.#refresh();
  }

  stop(): void {
    this.#started = false;
    this.#feed?.stop();
    this.#feed = null;
    if (this.#pollTimer !== null) clearInterval(this.#pollTimer);
    this.#pollTimer = null;
    if (this.#refreshTimer !== null) clearTimeout(this.#refreshTimer);
    this.#refreshTimer = null;
    if (this.#restartTimer !== null) clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
    this.#listeners.clear();
  }

  current(): HerdrStateView {
    return this.#view;
  }

  /** Push-based observation; returns the unsubscribe function. */
  subscribe(listener: (state: HerdrStateView) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#view);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Force one refresh now (used by tests and by prompt-adjacent flows that
   * want the state view to converge without waiting for events). */
  async refresh(): Promise<HerdrStateView> {
    return await this.#refresh();
  }

  #onFeedEvent(event: HerdrSurfaceEvent): void {
    if (event.kind === "structure") this.#scheduleFeedRestart();
    this.#scheduleRefresh();
  }

  /** Per-pane state subscriptions are pane-addressed, so structural changes
   * (panes created/closed) require re-opening the feed with the new set. */
  #scheduleFeedRestart(): void {
    if (this.#restartTimer !== null) return;
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      this.#feed?.restart();
    }, FEED_RESTART_COALESCE_MS);
  }

  #scheduleRefresh(): void {
    if (this.#refreshTimer !== null) return;
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      void this.#refresh();
    }, this.#coalesceMs);
  }

  async #refresh(): Promise<HerdrStateView> {
    if (!this.#started) return this.#view;
    if (this.#refreshing) {
      this.#refreshQueued = true;
      return this.#view;
    }
    this.#refreshing = true;
    try {
      let snapshot: HerdrSnapshotView | null = null;
      try {
        snapshot = await this.#client.snapshot();
      } catch {
        snapshot = null;
      }
      const next: HerdrStateView =
        snapshot === null
          ? { ...emptyView(), available: false, version: this.#view.version }
          : { ...snapshot, available: true, version: this.#view.version };
      if (viewUnchanged(this.#view, next)) return this.#view;
      next.version = this.#view.version + 1;
      this.#view = next;
      for (const listener of this.#listeners) listener(next);
      return next;
    } finally {
      this.#refreshing = false;
      if (this.#refreshQueued) {
        this.#refreshQueued = false;
        this.#scheduleRefresh();
      }
    }
  }
}

function emptyView(): HerdrStateView {
  return {
    available: false,
    version: 0,
    serverVersion: "",
    protocol: 0,
    focused: { workspaceId: null, tabId: null, paneId: null },
    workspaces: [],
    tabs: [],
    panes: [],
  };
}

/** Change detection ignores `version` and compares mapped content only. */
function viewUnchanged(a: HerdrStateView, b: HerdrStateView): boolean {
  return (
    JSON.stringify([
      a.available,
      a.serverVersion,
      a.protocol,
      a.focused,
      a.workspaces,
      a.tabs,
      a.panes,
    ]) ===
    JSON.stringify([
      b.available,
      b.serverVersion,
      b.protocol,
      b.focused,
      b.workspaces,
      b.tabs,
      b.panes,
    ])
  );
}
