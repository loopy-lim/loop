/**
 * Bottom-sheet snap policy (split-viewer design §B) — the pure gesture
 * math behind the viewer bottom sheet. No react-native import: the
 * ViewerBottomSheet component feeds raw drag values in and renders the
 * decided snap; tests pin the decisions without a device.
 *
 * Two snap points (half, full) plus drag-down-to-dismiss, per §B.
 */

/** Snap points as fractions of the container height. `full` stays below
 * 1.0 so the sheet's grab handle remains reachable under the status area. */
export const SHEET_SNAPS = { half: 0.5, full: 0.92 } as const;

export type SheetSnap = keyof typeof SHEET_SNAPS;

export type SheetDecision = SheetSnap | "dismiss";

/** Y offset of the sheet's top edge from the container top, for a snap. */
export function sheetTopOffset(snap: SheetDecision, height: number): number {
  if (snap === "dismiss") return height; // fully translated off-screen
  return height * (1 - SHEET_SNAPS[snap]);
}

/**
 * Resolve the resting state when a drag ends. Inputs are raw gesture
 * values: the sheet's current top offset (px from container top), the
 * drag's per-second vertical velocity (positive = moving down), and the
 * last single-move delta (px, positive = downward).
 *
 * Policy:
 * - A decisive downward fling dismisses regardless of position (§B drag
 *   down to dismiss) — the fling, not the halfway line, is the intent.
 * - A decisive upward fling opens to full from anywhere below it.
 * - Otherwise the sheet falls to the NEAREST snap point; dismiss is only
 *   reachable by flinging or by dragging the top edge past 75% of the
 *   container height (a deliberate tug, not a missed snap).
 */
export function resolveSheetSnap(args: {
  topOffset: number;
  velocityY: number;
  deltaY: number;
  height: number;
}): SheetDecision {
  const { topOffset, velocityY, deltaY, height } = args;
  const flingDown = velocityY > 800 || deltaY > 30;
  const flingUp = velocityY < -800 || deltaY < -30;
  const dismissLine = height * 0.75;
  const fullLine = sheetTopOffset("full", height);

  if (flingDown) {
    // Flinging down from near-full snaps to half; from below the full
    // line the user is pulling the sheet away — dismiss.
    return topOffset > fullLine + height * 0.1 ? "dismiss" : "half";
  }
  if (flingUp) return topOffset > fullLine ? "full" : "half";
  if (topOffset >= dismissLine) return "dismiss";
  // Nearest of the two snap points.
  const halfTop = sheetTopOffset("half", height);
  const fullTop = sheetTopOffset("full", height);
  return Math.abs(topOffset - halfTop) <= Math.abs(topOffset - fullTop) ? "half" : "full";
}
