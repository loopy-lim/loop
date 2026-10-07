/**
 * Pane terminal-view projection (decision 2026-xx-terminal-mirror D6).
 *
 * Pure state: dedupes pane_text frames on `paneId + revision` (decimal-string
 * revisions compare numerically) and converges on pane_reset frames.
 * No network, no React — the screen renders `snapshot()`. The autoscroll-follow
 * machine lives in ui/followScroll.ts (decision D-B keeps `ui` leaf; the
 * machine is a scroll-UI concern with that hook as its only consumer).
 */

import type {
  RemotePaneState,
  RemotePaneResetEvent,
  RemotePaneSummary,
  RemotePaneTextEvent,
} from "../gateway-client/wire";

export type PaneViewState = {
  paneId: string;
  /** Last applied snapshot revision (decimal string); null before any frame. */
  revision: string | null;
  text: string;
  truncated: boolean;
  occurredAt: string | null;
  /** Pane inventory metadata, when known. */
  label: string | null;
  state: RemotePaneState | null;
  /** The pane no longer exists; the stream is closed. */
  gone: boolean;
  /** A retryable transport error is being retried. */
  stale: boolean;
};

const INITIAL: Omit<PaneViewState, "paneId"> = {
  revision: null,
  text: "",
  truncated: false,
  occurredAt: null,
  label: null,
  state: null,
  gone: false,
  stale: false,
};

export class PaneProjection {
  readonly #paneId: string;
  #view: PaneViewState;

  constructor(paneId: string) {
    this.#paneId = paneId;
    this.#view = { paneId, ...INITIAL };
  }

  /** Attach inventory metadata (label / lifecycle state) for honest labeling. */
  applySummary(summary: RemotePaneSummary): void {
    if (summary.paneId !== this.#paneId) return;
    this.#view = {
      ...this.#view,
      label: summary.label ?? null,
      state: summary.state,
    };
  }

  /**
   * Apply one snapshot frame; true when it advanced the view.
   * Dedupe key: paneId + revision — equal or older revisions are ignored.
   */
  applyText(frame: RemotePaneTextEvent): boolean {
    if (frame.paneId !== this.#paneId) return false;
    if (this.#view.revision !== null && !isRevisionAfter(frame.revision, this.#view.revision)) {
      return false; // duplicate or stale snapshot
    }
    this.#view = {
      ...this.#view,
      revision: frame.revision,
      text: frame.text,
      truncated: frame.truncated,
      occurredAt: frame.occurredAt,
      stale: false,
    };
    return true;
  }

  /** Apply a reset frame; "gone" terminates the pane stream. */
  applyReset(frame: RemotePaneResetEvent): "gone" | "converged" {
    if (frame.paneId !== this.#paneId) return "converged";
    if (frame.reason === "paneGone") {
      this.#view = {
        ...this.#view,
        gone: true,
        revision: frame.revision,
        text: frame.text,
        truncated: frame.truncated,
        stale: false,
      };
      return "gone";
    }
    // cursorUnavailable / slowConsumer: converge on the authoritative snapshot.
    this.#view = {
      ...this.#view,
      revision: frame.revision,
      text: frame.text,
      truncated: frame.truncated,
      stale: false,
    };
    return "converged";
  }

  markStale(stale: boolean): void {
    this.#view = { ...this.#view, stale };
  }

  snapshot(): PaneViewState {
    return this.#view;
  }
}

/** Numeric compare of decimal-string u64 revisions (no float drift). */
export function isRevisionAfter(candidate: string, current: string): boolean {
  try {
    return BigInt(candidate) > BigInt(current);
  } catch {
    return false; // malformed revisions never advance the view
  }
}
