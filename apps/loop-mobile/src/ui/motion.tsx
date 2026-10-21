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
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { BEHIND_DIM, BEHIND_PARALLAX } from "./back-swipe";
import { impactLight } from "./haptics";
import { motion as motionTokens, press } from "./tokens";

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

/** Spring back to rest (gesture cancellation, elastic transitions). */
export function springTo(
  value: MotionValue,
  to: number,
  opts: {
    speed?: number;
    bounciness?: number;
    velocity?: number;
    tension?: number;
    friction?: number;
  } = {},
): Promise<void> {
  value.stopAnimation();
  return new Promise((resolve) => {
    Animated.spring(value, {
      toValue: to,
      speed: opts.speed ?? 26,
      bounciness: opts.bounciness ?? 4,
      velocity: opts.velocity,
      tension: opts.tension,
      friction: opts.friction,
      useNativeDriver: true,
    }).start(() => resolve());
  });
}

// ——— PressableScale ————————————————————————————————————————————————————————

/** A pressable that presses DOWN: subtle scale + dim while the touch is active,
 * springs back on release. Used for cards, rows, FAB, and interactive keys. */
export function PressableScale(props: {
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
  targetScale?: number;
}) {
  const target = props.targetScale ?? 0.94;
  const scale = useMotionValue(1);
  const dim = useMotionValue(1);
  const pressIn = (): void => {
    void animateTo(scale, target, { duration: 100 });
    void animateTo(dim, press.activeOpacity, { duration: 100 });
  };
  const pressOut = (): void => {
    void springTo(scale, 1, { speed: 32, bounciness: 4 });
    void animateTo(dim, 1, { duration: 140 });
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

/** The live-status dot: a quiet synchronized opacity + scale pulse on the
 * registered `pulse` period (tokens.motion). Working is the one status that
 * may breathe — idle/blocked/done stay static. */
export function PulseDot(props: { color: string; size?: number }) {
  const size = props.size ?? 6;
  const progress = useMotionValue(0);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 450,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 450,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.45],
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.2],
  });

  return (
    <AnimatedView
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: props.color,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

// ——— TabScaleIcon ——————————————————————————————————————————————————————————

/** Tab icon with micro-bounce spring when activated (iOS 17/18 tab bar feel). */
export function TabScaleIcon(props: { active: boolean; children: ReactNode }) {
  const scale = useMotionValue(1);
  const prevActive = useRef(props.active);
  useEffect(() => {
    if (!prevActive.current && props.active) {
      scale.setValue(0.86);
      void springTo(scale, 1, { speed: 30, bounciness: 8 });
    }
    prevActive.current = props.active;
  }, [props.active, scale]);

  return (
    <AnimatedView style={{ transform: [{ scale }] }}>
      {props.children}
    </AnimatedView>
  );
}

// ——— Entrance ——————————————————————————————————————————————————————————————

/** One-time entrance fade + rise (tokens.motion.entrance, ≤4pt rise).
 * Used for chat turns, stream updates, and cards arriving. */
export function Entrance(props: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}) {
  const progress = useMotionValue(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      void animateTo(progress, 1, {
        duration: motionTokens.entrance,
        easing: easing.enter,
      });
    }, props.delay ?? 0);
    return () => clearTimeout(timer);
  }, [progress, props.delay]);

  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [motionTokens.entranceOffset, 0],
  });

  return (
    <AnimatedView style={[props.style, { opacity, transform: [{ translateY }] }]}>
      {props.children}
    </AnimatedView>
  );
}

// ——— AnimatedSheet —————————————————————————————————————————————————————————

/** Bottom sheet modal container with animated backdrop fade, spring slide-up,
 * and drag-down-to-dismiss gesture on the grabber / header. */
export function AnimatedSheet(props: {
  visible: boolean;
  onClose: () => void;
  children: (panHandlers: object) => ReactNode;
  backdropStyle?: StyleProp<ViewStyle>;
  panelStyle?: StyleProp<ViewStyle>;
}) {
  const [mounted, setMounted] = useState(props.visible);
  const backdropOpacity = useMotionValue(0);
  const translateY = useMotionValue(500);
  const closingRef = useRef(false);

  useEffect(() => {
    if (props.visible) {
      closingRef.current = false;
      setMounted(true);
      translateY.setValue(500);
      backdropOpacity.setValue(0);
      void animateTo(backdropOpacity, 1, { duration: 200, easing: easing.enter });
      void springTo(translateY, 0, { speed: 24, bounciness: 2 });
    } else if (mounted && !closingRef.current) {
      closingRef.current = true;
      void animateTo(backdropOpacity, 0, { duration: 180, easing: easing.exit });
      void animateTo(translateY, 500, { duration: 200, easing: easing.exit }).then(() => {
        setMounted(false);
        closingRef.current = false;
      });
    }
  }, [props.visible, mounted, backdropOpacity, translateY]);

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    impactLight();
    void animateTo(backdropOpacity, 0, { duration: 180, easing: easing.exit });
    void animateTo(translateY, 500, { duration: 200, easing: easing.exit }).then(() => {
      setMounted(false);
      closingRef.current = false;
      props.onClose();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 6,
      onPanResponderMove: (_, gesture) => {
        const offset = gesture.dy > 0 ? gesture.dy : gesture.dy * 0.2;
        translateY.setValue(offset);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 90 || (gesture.dy > 30 && gesture.vy > 0.5)) {
          requestClose();
        } else {
          void springTo(translateY, 0, { speed: 28, bounciness: 4 });
        }
      },
    }),
  ).current;

  if (!mounted) return null;

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={requestClose}>
      <View style={sheetContainerStyles.root}>
        <AnimatedView
          style={[
            StyleSheet.absoluteFill,
            sheetContainerStyles.backdrop,
            props.backdropStyle,
            { opacity: backdropOpacity },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} accessibilityLabel="닫기" />
        </AnimatedView>
        <AnimatedView style={[props.panelStyle, { transform: [{ translateY }] }]}>
          {props.children(panResponder.panHandlers)}
        </AnimatedView>
      </View>
    </Modal>
  );
}

const sheetContainerStyles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    backgroundColor: "rgba(4, 6, 10, 0.6)",
  },
});
