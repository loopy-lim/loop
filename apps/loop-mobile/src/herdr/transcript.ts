/**
 * Transcript model (rebuild brief §5) — the chat-style view of an agent
 * pane. Rule (§7): reads replace wholesale by `revision`; nothing is
 * patched, so no incremental error can accumulate. Scrolling back asks the
 * gateway for more lines; the buffer swaps again.
 */

import type { HerdrPaneReading } from "./wire";

export type Transcript = {
  paneId: string;
  revision: string;
  text: string;
  /** True when herdr could not return the full requested window. */
  truncated: boolean;
};

export const EMPTY_TRANSCRIPT: Transcript = {
  paneId: "",
  revision: "",
  text: "",
  truncated: false,
};

/** u64 decimal strings compare numerically, not lexicographically — the
 * gateway's synthesized revisions now actually advance ("9" → "10"), so a
 * string compare would drop every reading past the "9"/"10" boundary. */
function revisionMovesBackward(next: string, current: string): boolean {
  if (next.length !== current.length) return next.length < current.length;
  return next < current;
}

/** Merge one reading into the transcript. Returns the next transcript, or
 * null when the reading is stale (older pane, older revision). */
export function nextTranscript(current: Transcript, reading: HerdrPaneReading): Transcript | null {
  if (reading.paneId !== current.paneId && current.paneId !== "") return null;
  if (revisionMovesBackward(reading.revision, current.revision)) return null;
  if (
    reading.paneId === current.paneId &&
    reading.revision === current.revision &&
    reading.text === current.text
  ) {
    return current; // no-op
  }
  return {
    paneId: reading.paneId,
    revision: reading.revision,
    text: reading.text,
    truncated: reading.truncated,
  };
}
