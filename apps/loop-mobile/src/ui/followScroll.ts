/**
 * Follow-the-tail scroll hook (decision D6, task `usability-and-quality-fixes`
 * — react-doctor rn-no-scroll-state): the onScroll handler only records the
 * follow verdict in a ref; the state flush rides ONE scheduled frame OUTSIDE
 * the handler's subtree, so steady scrolling re-renders nothing and the jump
 * pill still updates on the same tick the verdict flips. The DECISION stays
 * pure (`nextFollowState` below); this hook is the thin React carrier
 * ConversationScreen and PaneScreen share.
 *
 * The pure follow machine lives HERE, not in state/ (decision D-B keeps `ui`
 * leaf: ui imports no internal layer). It is a scroll-UI concern with a single
 * consumer — this hook — so ui is its home; state keeps domain projections.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/** Distance from the bottom (px) inside which the view counts as "at the
 * bottom" and auto-follow re-attaches. */
export const AUTOSCROLL_BOTTOM_EPSILON = 48;

/**
 * Autoscroll follow state machine: the view follows the tail while the user
 * is at (or near) the bottom; scrolling up detaches, returning to the bottom
 * re-attaches (decision D6).
 */
export function nextFollowState(currentFollowing: boolean, distanceFromBottom: number): boolean {
  return distanceFromBottom <= AUTOSCROLL_BOTTOM_EPSILON;
}

export function useFollowScroll() {
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const frame = useRef<number | null>(null);
  // Unmount mid-scroll: never flush into a dead screen.
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const flush = useCallback(() => {
    frame.current = null;
    setFollowing(followingRef.current);
  }, []);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
      const next = nextFollowState(followingRef.current, distanceFromBottom);
      if (next === followingRef.current) return;
      followingRef.current = next;
      if (frame.current !== null) return; // a flush is already scheduled
      frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );
  /** Explicit re-attach (the jump-to-bottom pill): follow NOW, and drop any
   * scheduled flush — the user's tap is the newer verdict. */
  const followNow = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    followingRef.current = true;
    setFollowing(true);
  }, []);
  return { following, onScroll, followNow };
}
