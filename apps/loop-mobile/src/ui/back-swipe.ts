/**
 * Edge-back gesture policy (task `mobile-ux-patterns`, iOS HIG
 * interactive pop) — the pure decision math behind detail screens' left
 * edge swipe. No react-native import: ui/BackSwipeZone.tsx feeds raw
 * gesture values in; tests pin the decisions without a device.
 *
 * The app's navigation is JS-owned (no UINavigationController), so the
 * system pop gesture does not exist here — this module IS the pop
 * gesture's decision half, and the header back chevron's onBack is the
 * one handler both paths fire (brief §4: 액션은 헤더와 제스처로 흡수).
 */

/** Activation band from the left edge (pt): a gesture counts as a back
 * gesture only if its touch STARTED inside this band — content drags
 * (timeline scroll, composer, buttons) are never stolen. */
export const BACK_EDGE_WIDTH = 24;

/** Commit distance as a fraction of the screen width: past ~30% the pop
 * is committed — the band iOS interactive pop lands in. */
export const BACK_COMMIT_FRACTION = 0.3;

/** Floor under the fractional commit distance (pt): on a narrow screen
 * 30% is a twitch; the floor keeps the commit an honest drag. */
export const BACK_COMMIT_MIN_DISTANCE = 96;

/** Rightward fling speed (pt/s) that commits regardless of distance. */
export const BACK_FLING_VELOCITY = 900;

/** Minimum travel for a fling to count (pt): a fast twitch is a scroll
 * accident, not an intent. */
export const BACK_FLING_MIN_DISTANCE = 56;

export type BackSwipeDecision = "commit" | "cancel";

/** The gesture's birthright test: only a touch that started in the left
 * edge band may ever commit a back. */
export function isBackGestureStart(startX: number): boolean {
  return startX >= 0 && startX <= BACK_EDGE_WIDTH;
}

/** Resolve the gesture when the finger lifts. Inputs are raw gesture
 * values: the touch's start x (px from this screen's left), the drag
 * delta (px, positive = rightward), the per-second velocity (positive =
 * rightward), and the screen width.
 *
 * Policy:
 * - A start outside the edge band cancels before any math runs.
 * - A drag past the commit distance commits (fraction, with floor).
 * - A decisive rightward fling with real travel commits from closer.
 * - Everything else cancels — the screen springs back. */
export function resolveBackSwipe(args: {
  startX: number;
  dx: number;
  vx: number;
  width: number;
}): BackSwipeDecision {
  const { startX, dx, vx, width } = args;
  if (!isBackGestureStart(startX)) return "cancel";
  const commitDistance = Math.max(width * BACK_COMMIT_FRACTION, BACK_COMMIT_MIN_DISTANCE);
  if (dx >= commitDistance) return "commit";
  if (vx >= BACK_FLING_VELOCITY && dx >= BACK_FLING_MIN_DISTANCE) return "commit";
  return "cancel";
}

/** The screen's translation during an active drag: rides the finger 1:1
 * rightward, never left of rest, never past the screen width. */
export function backDragTranslate(dx: number, width: number): number {
  return Math.min(Math.max(0, dx), width);
}
