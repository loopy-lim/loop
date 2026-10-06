/**
 * Row swipe-action policy (task `mobile-ux-patterns`, iOS HIG row
 * actions) — the pure gesture math behind the list rows' swipe-to-reveal.
 * No react-native import: ui/SwipeableRow.tsx feeds raw gesture values in
 * and settles at the decided reveal; tests pin the decisions without a
 * device (same contract as features/bottom-sheet.ts).
 *
 * One action per row, by honesty (ui-ux-guidance §7): the mobile client
 * contract owns exactly one row verb — OPEN the chat. There is no
 * cancel/delete surface in the gateway client, so the swipe invents
 * nothing destructive; the gesture is a thumb-reachable alternative to
 * the row tap, not a new capability.
 */

/** Revealed action width (pt): two 44pt touch floors wide so the button
 * is an honest target, and the same number bounds the drag budget. */
export const ROW_ACTION_WIDTH = 88;

/** Release threshold as a fraction of the action width: past half, the
 * reveal was the intent (the iOS reveal line, expressed proportionally
 * so it scales with the bound). */
export const ROW_REVEAL_FRACTION = 0.5;

/** Leftward fling speed (pt/s) that commits the action outright — the
 * full-swipe quick-open (Mail convention): no stop at the reveal. */
export const ROW_FLING_VELOCITY = 600;

/** Minimum travel for a fling to count (pt): a resting tap release is
 * never a fling, however the sensor scores its velocity. */
export const ROW_FLING_MIN_DISTANCE = 12;

/** Discoverability peek (task `main-screen-polish`): the partial reveal
 * (pt) the list's first actionable row mounts with — a sliver of the
 * accent strip that says "this row drags" without covering the title.
 * A hint, never a resting state: the first touch or the close timer
 * settles the row shut. */
export const ROW_PEEK_WIDTH = 32;

/** How long the peek stays open before settling shut (ms): long enough
 * to be seen on a fresh screen, short enough to never read as stuck. */
export const ROW_PEEK_CLOSE_MS = 1200;

/** Rubber-band resistance past the reveal bound (0..1): displacement
 * beyond the bound is shrunk so the bound reads as a wall, not a cliff. */
export const ROW_RUBBER_BAND = 0.3;

export type RowSwipeDecision = "open" | "closed" | "commit";

/** Translate a raw drag into the row's x offset. Rightward is never a
 * reveal (the action lives behind the right edge); the drag rides 1:1 up
 * to the action width and rubber-bands beyond it. */
export function clampRowDrag(dx: number): number {
  if (dx >= 0) return 0;
  const over = -dx - ROW_ACTION_WIDTH;
  if (over <= 0) return dx;
  return -(ROW_ACTION_WIDTH + over * ROW_RUBBER_BAND);
}

/** Resolve the resting state when a drag ends. Inputs are raw gesture
 * values: the drag delta (px, negative = leftward) and the per-second
 * horizontal velocity (negative = leftward).
 *
 * Policy:
 * - A decisive leftward fling commits the action — quick-open, no stop.
 * - Otherwise a release past the reveal line rests OPEN; anything
 *   shallower snaps CLOSED. */
export function resolveRowSwipe(args: { dx: number; vx: number }): RowSwipeDecision {
  const { dx, vx } = args;
  if (vx <= -ROW_FLING_VELOCITY && dx <= -ROW_FLING_MIN_DISTANCE) return "commit";
  if (dx <= -ROW_ACTION_WIDTH * ROW_REVEAL_FRACTION) return "open";
  return "closed";
}
