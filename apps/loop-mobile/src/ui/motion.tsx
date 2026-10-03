/**
 * Motion vocabulary (task `beauty-polish-pass`): every duration, distance,
 * and easing value lives in ui/tokens (`motion`); this module owns the only
 * registered mechanisms that consume them. Nothing else in the app animates
 * — call sites never hand-roll timers, durations, or LayoutAnimation
 * configs (ui-ux-guidance §8: variants are registered entries, and §8-4
 * asks whether the existing vocabulary can express the change first).
 *
 * Three mechanisms, closed:
 * - `useBlink`: two-frame opacity signal (streaming cursor, running-dot
 *   pulse) — a plain timer toggle; RN Animated is unnecessary for two
 *   frames, and the mechanism must stay honest about that.
 * - `useEntrance` / `Entrance`: one-time fade + rise when a row or overlay
 *   mounts — native-driven so streaming re-renders stay cheap (D4 §1:
 *   mounted rows are keyed and never remount, so existing rows never
 *   re-animate).
 * - `configureCardFold`: the tool-card expand/collapse transition (C16),
 *   rebuilt from the motion token instead of a stock preset duration.
 *
 * Degraded form (decision 2026-xx-minimal-design-spec S6): when the OS
 * Reduce Motion setting is on, the entrance is a no-op — the surface never
 * moves. No new timers or easings exist for this; honoring the setting
 * only skips the registered animation.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, LayoutAnimation } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { motion } from "./tokens";

/** The OS Reduce Motion setting, as reactive state. Plain subscription —
 * ui/motion.tsx stays the only consumer surface for motion concerns. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (live) setReduced(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

/** Two-frame opacity blink: returns the current frame's opacity, toggling
 * every `periodMs`. `onOpacity`/`offOpacity` let each signal register its
 * own intensity (the streaming cursor dives near-invisible; the running
 * badge only dims). */
export function useBlink(periodMs: number, onOpacity = 1, offOpacity = 0.15): number {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setOn((value) => !value), periodMs);
    return () => clearInterval(id);
  }, [periodMs]);
  return on ? onOpacity : offOpacity;
}

/** Entrance progress (0 → 1) that runs once when the calling component
 * mounts: the row fades in and rises `motion.entranceOffset` pt. Native
 * driven — the animation lives off the JS thread during streaming. */
export function useEntrance(): {
  opacity: Animated.Value;
  transform: { translateY: Animated.AnimatedInterpolation<number> }[];
} {
  const progress = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      // Reduced motion (S6): the entrance is a no-op — rows paint settled.
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.entrance,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    return () => progress.stopAnimation();
  }, [progress, reduced]);
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [motion.entranceOffset, 0],
  });
  return { opacity: progress, transform: [{ translateY }] };
}

/** Mount-time entrance wrapper for conditionally-mounted chrome (the
 * jump-to-bottom pill): fades and rises its children once. Timeline rows
 * call `useEntrance` directly; this component exists so a call site can
 * wrap an overlay without growing a component boundary. */
export function Entrance(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const entrance = useEntrance();
  return <Animated.View style={[props.style, entrance]}>{props.children}</Animated.View>;
}

/** Card fold/expand transition (C16): one shared config whose duration is
 * the motion token — replaces the stock preset so the fold pace is owned
 * by the design system. */
export function configureCardFold(): void {
  LayoutAnimation.configureNext({
    duration: motion.fold,
    update: { type: LayoutAnimation.Types.easeInEaseOut },
  });
}
