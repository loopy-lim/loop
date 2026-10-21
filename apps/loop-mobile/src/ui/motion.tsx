/**
 * ui/motion.tsx — the single owner of react-native motion mechanisms
 * (design-spec AC-S6-2: Animated/LayoutAnimation are imported HERE only).
 *
 * Revision 2 (native-motion pass, 2026-10-21): the rebuild shipped with no
 * motion surface at all, so every transition was an instant swap and the app
 * read as a web view. The user's verdict — "native의 느낌이 전혀 없다" —
 * supersedes the earlier "settles instantly, no-Animated" reading of
 * AC-S6-2 (docs/design/audits/2026-10-21-native-motion-audit.md). The gate's
 * letter still holds: motion primitives live here, callers compose them.
 *
 * Everything exported drives the native UI thread (useNativeDriver) —
 * transforms and opacity only — so JS-thread transcript updates never stutter
 * a transition.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, type StyleProp, type ViewStyle } from "react-native";

import { BEHIND_DIM, BEHIND_PARALLAX } from "./back-swipe";
import { press } from "./tokens";

/** Pre-created animated container: callers never import Animated itself. */
export const AnimatedView = Animated.View;

/** Named easings — the registered curves. Enter decelerates to rest, exit
 * accelerates away (iOS UINavigationController timings). */
export const easing = {
  enter: Easing.out(Easing.cubic),
  exit: Easing.in(Easing.cubic),
} as const;

/** A shared animated scalar (transform/opacity values). */
export type MotionValue = Animated.Value;

export function useMotionValue(initial: number): MotionValue {
  return useRef(new Animated.Value(initial)).current;
}

/** Imperative factory for value lists (stack layers) — hooks can't size to a
 * dynamic count. Same ownership rule as useMotionValue. */
export function createMotionValue(initial: number): MotionValue {
  return new Animated.Value(initial);
}

/** The stack transition's translate style for one screen: `self` is the
 * boundary that slides this screen in (1 = covering), `above` the boundary
 * of the screen covering this one (drives the leftward parallax). Both terms
 * compose into a single native-driven translateX. */
export function layeredTranslate(self: MotionValue, above: MotionValue | null, width: number) {
  const slide = self.interpolate({ inputRange: [0, 1], outputRange: [width, 0] });
  if (above === null) return { transform: [{ translateX: slide }] };
  const parallax = above.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -BEHIND_PARALLAX * width],
  });
  return { transform: [{ translateX: Animated.add(slide, parallax) }] };
}

/** The covered screen's dim style for the boundary above it (null = none). */
export function layeredDim(above: MotionValue | null) {
  if (above === null) return { opacity: 1 as const };
  return {
    opacity: above.interpolate({ inputRange: [0, 1], outputRange: [1, 1 - BEHIND_DIM] }),
  };
}

/** Timing to a target; resolves on settle. A running animation on the same
 * value is stopped first, so callers can chain without tracking handles. */
export function animateTo(
  value: MotionValue,
  to: number,
  opts: { duration?: number; easing?: (t: number) => number } = {},
): Promise<void> {
  value.stopAnimation();
  return new Promise((resolve) => {
    Animated.timing(value, {
      toValue: to,
      duration: opts.duration ?? 240,
      easing: opts.easing ?? easing.enter,
      useNativeDriver: true,
    }).start(() => resolve());
  });
}

/** Spring back to rest (gesture cancellation). */
export function springTo(value: MotionValue, to: number): Promise<void> {
  value.stopAnimation();
  return new Promise((resolve) => {
    Animated.spring(value, {
      toValue: to,
      speed: 28,
      bounciness: 5,
      useNativeDriver: true,
    }).start(() => resolve());
  });
}

// ——— PressableScale ————————————————————————————————————————————————————————

/** A pressable that presses DOWN: scale + dim while the touch is active,
 * springs back on release. The FAB, chips, and CTA-sized buttons use this —
 * list rows keep the flat highlight (PressableRow) per iOS list convention. */
export function PressableScale(props: {
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const scale = useMotionValue(1);
  const dim = useMotionValue(1);
  const pressIn = (): void => {
    animateTo(scale, 0.94, { duration: 120 });
    animateTo(dim, press.activeOpacity, { duration: 120 });
  };
  const pressOut = (): void => {
    springTo(scale, 1);
    animateTo(dim, 1, { duration: 140 });
  };
  return (
    <Pressable
      onPress={props.onPress}
      onPressIn={props.disabled ? undefined : pressIn}
      onPressOut={props.disabled ? undefined : pressOut}
      disabled={props.disabled}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
    >
      <AnimatedView
        style={[
          props.style,
          { transform: [{ scale }], opacity: dim },
        ]}
      >
        {props.children}
      </AnimatedView>
    </Pressable>
  );
}

// ——— PulseDot ———————————————————————————————————————————————————————————————

/** The live-status dot: a quiet two-frame-style opacity pulse on the
 * registered `pulse` period (tokens.motion). Working is the one status that
 * may breathe — idle/blocked/done stay static. */
export function PulseDot(props: { color: string; size?: number }) {
  const size = props.size ?? 6;
  const opacity = useMotionValue(1);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 450,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 450,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <AnimatedView
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: props.color,
        opacity,
      }}
    />
  );
}
