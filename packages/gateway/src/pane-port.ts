/**
 * Pane observation seam (decision 2026-xx-terminal-mirror D3).
 *
 * The gateway defines this herdr-agnostic port; implementations live at the
 * composition-root boundary (`herdr-pane-source.ts` speaks the herdr socket
 * protocol — the only module in this package allowed to carry that
 * knowledge). Pane concepts never enter loop-core, and pane frames never
 * enter the run event family.
 *
 * Fail-closed: a source that cannot answer returns `null`, which the pane
 * mirror renders as an empty inventory / no streams. The run machinery is
 * never affected.
 */

import type { RemotePaneSummary } from "@loop/protocol";

/** One pane screen-buffer reading (herdr `pane.read` projection). */
export type PaneReading = {
  /** Monotonic herdr snapshot counter, decimal string (ADR §4.1 u64 rule). */
  revision: string;
  /** Snapshot text (screen buffer; NOT yet redacted or byte-bounded). */
  text: string;
  /** True when the source itself cut the snapshot. */
  truncated: boolean;
};

export interface PaneObservationPort {
  /**
   * Current pane inventory; `null` when the source is unavailable
   * (socket down, protocol mismatch — fail-closed to an empty surface).
   */
  listPanes(): Promise<RemotePaneSummary[] | null>;
  /**
   * Read one pane's screen buffer; `null` when the pane no longer exists
   * or the source cannot answer.
   */
  readPane(paneId: string): Promise<PaneReading | null>;
}
