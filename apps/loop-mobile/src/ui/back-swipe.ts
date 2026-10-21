/**
 * Edge-back gesture policy (task `mobile-ux-patterns`, iOS HIG
 * interactive pop) — the pure decision and interpolation math behind the
 * stack's left-edge swipe. No react-native import: ui/ScreenStack.tsx feeds
 * raw gesture values in; tests pin the decisions without a device.
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

/** How far the covered screen trails leftward at full cover, as a fraction
 * of the screen width — UINavigationController's under-travel parallax. */
export const BEHIND_PARALLAX = 0.3;

/** Opacity the covered screen loses at full cover (the quiet push dim). */
export const BEHIND_DIM = 0.2;

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

/** Drag delta → transition progress: 1:1 with the finger across the screen
 * width, clamped to [0, 1] (0 = at rest, 1 = fully covering). */
export function gestureProgress(dx: number, width: number): number {
  if (width <= 0) return 0;
  return Math.min(Math.max(dx / width, 0), 1);
}

/** The covering screen's offset at a progress: rides the finger rightward,
 * fully off-screen at progress 1. */
export function topOffset(progress: number, width: number): number {
  return (1 - progress) * width;
}

/** The covered screen's trailing offset at a progress (leftward parallax). */
export function behindOffset(progress: number, width: number): number {
  return -BEHIND_PARALLAX * progress * width;
}
