/**
 * ScreenStack — the app's UINavigationController stand-in (native-motion
 * pass, 2026-10-21; supersedes ui/BackSwipeZone per
 * docs/design/audits/2026-10-21-native-motion-audit.md — "settles instantly"
 * read a user verdict of "native 느낌이 전혀 없다" as overturned).
 *
 * One animated boundary sits under every screen: `bounds[i]` ∈ [0,1] is how
 * far screen i has slid in over what's beneath it (0 = off-screen right,
 * 1 = covering). A screen's translate composes TWO terms from the same
 * values — its own slide (bounds[i]) and the parallax of the screen above it
 * (bounds[i+1]) — so push, pop, and edge-gesture all move every screen from
 * one shared value and can never desync. The gesture drives the top boundary
 * directly; committing fires onBack and the SAME boundary animates on out,
 * so the screen departs from wherever the finger left it (the continuity the
 * old zone lacked). Cancellations spring back.
 *
 * Decisions stay pure in ui/back-swipe.ts; motion primitives come from
 * ui/motion.tsx (the AC-S6-2 Animated owner).
 */
import { useEffect, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, useWindowDimensions } from "react-native";
import type { ReactNode } from "react";

import { gestureProgress, isBackGestureStart, resolveBackSwipe } from "./back-swipe";
import { impactLight } from "./haptics";
import {
  animateTo,
  AnimatedView,
  createMotionValue,
  easing,
  layeredDim,
  layeredTranslate,
  springTo,
  type MotionValue,
} from "./motion";
import { colors } from "./tokens";

export type StackEntry = {
  /** Stable identity for the route's lifetime (e.g. "agent:<paneId>"). */
  key: string;
  backEnabled?: boolean;
  onBack?: () => void;
};

type Tracked = {
  uid: number;
  key: string;
  entry: StackEntry;
  exiting: boolean;
};

type Frame = {
  tracked: Tracked[];
  /** bounds[i] slides tracked[i] in over what's beneath it. */
  bounds: MotionValue[];
};

export function ScreenStack(props: {
  entries: StackEntry[];
  render: (entry: StackEntry) => ReactNode;
}) {
  const { width } = useWindowDimensions();
  const [frame, setFrame] = useState<Frame>({ tracked: [], bounds: [] });
  const frameRef = useRef(frame);
  const uidRef = useRef(0);
  /** Uids whose slide-in is still animating — the gesture waits for them. */
  const enteringRef = useRef(new Set<number>());
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Latest-ref sync (react-doctor): pan handlers read state at event time.
  const liveRef = useRef({ frame, width, entries: props.entries });
  useEffect(() => {
    liveRef.current = { frame: frameRef.current, width, entries: props.entries };
  });

  const topAliveIndex = (f: Frame): number => {
    for (let i = f.tracked.length - 1; i >= 0; i -= 1) {
      const t = f.tracked[i];
      if (t !== undefined && !t.exiting) return i;
    }
    return -1;
  };

  const commitRemove = (uid: number): void => {
    if (!mountedRef.current) return;
    const cur = frameRef.current;
    const index = cur.tracked.findIndex((t) => t.uid === uid);
    if (index === -1) return;
    const next = {
      tracked: cur.tracked.filter((_, i) => i !== index),
      bounds: cur.bounds.filter((_, i) => i !== index),
    };
    frameRef.current = next;
    setFrame(next);
  };

  // Sync on the entry-key signature: pushes append (slide in), pops mark the
  // top exiting (slide on out, then unmount). Same-signature renders never
  // restart an animation; entry props flow fresh through `props.render`.
  const signature = props.entries.map((entry) => entry.key).join("\u0000");
  useEffect(() => {
    const cur = frameRef.current;
    const keys = props.entries.map((entry) => entry.key);
    const alive = cur.tracked.filter((t) => !t.exiting);
    const added = keys.filter((key) => !alive.some((t) => t.key === key));
    const removed = alive.filter((t) => !keys.includes(t.key));
    if (added.length === 0 && removed.length === 0) return;

    const entryByKey = new Map(props.entries.map((entry) => [entry.key, entry]));
    const initialMount = cur.tracked.length === 0 && props.entries.length > 0;

    // A push landing mid-enter snaps the in-flight slide to rest first, so
    // rapid taps never see the under-screen jump. A key that is itself being
    // removed keeps its mid-flight value — its exit reverses from there.
    for (const uid of enteringRef.current) {
      const index = cur.tracked.findIndex((t) => t.uid === uid);
      const tracked = index === -1 ? undefined : cur.tracked[index];
      if (tracked !== undefined && !removed.includes(tracked)) {
        cur.bounds[index]?.setValue(1);
      }
      enteringRef.current.delete(uid);
    }

    const nextAlive = keys
      .filter((key) => !removed.some((t) => t.key === key))
      .map((key) => {
        const oldIndex = cur.tracked.findIndex((t) => t.key === key && !t.exiting);
        const old = oldIndex === -1 ? undefined : cur.tracked[oldIndex];
        if (old !== undefined) {
          return {
            t: { ...old, entry: entryByKey.get(key) ?? old.entry },
            bound: cur.bounds[oldIndex] ?? createMotionValue(1),
          };
        }
        uidRef.current += 1;
        return {
          t: { uid: uidRef.current, key, entry: entryByKey.get(key)!, exiting: false },
          bound: createMotionValue(initialMount ? 1 : 0),
        };
      });
    // Exits keep their absolute position; pushes append after them.
    const nextExiting = cur.tracked
      .filter((t) => t.exiting)
      .map((t) => ({ t, bound: cur.bounds[cur.tracked.indexOf(t)] ?? createMotionValue(0) }));
    const next: Frame = {
      tracked: [...nextAlive.map((pair) => pair.t), ...nextExiting.map((pair) => pair.t)],
      bounds: [...nextAlive.map((pair) => pair.bound), ...nextExiting.map((pair) => pair.bound)],
    };
    frameRef.current = next;
    setFrame(next);

    for (const [index, t] of next.tracked.entries()) {
      const bound = next.bounds[index];
      if (bound === undefined) continue;
      if (t.exiting) {
        const curVal =
          typeof (bound as unknown as { _value?: number })._value === "number"
            ? Math.max(0, Math.min(1, (bound as unknown as { _value: number })._value))
            : 1;
        const duration = Math.max(80, Math.round(curVal * 200));
        void animateTo(bound, 0, { duration, easing: easing.exit }).then(() => {
          commitRemove(t.uid);
        });
        continue;
      }
      if (!added.includes(t.key) || initialMount) continue;
      enteringRef.current.add(t.uid);
      void animateTo(bound, 1, { duration: 280, easing: easing.enter }).then(() => {
        enteringRef.current.delete(t.uid);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => {
        if (enteringRef.current.size > 0) return false;
        const { frame: f, entries } = liveRef.current;
        const topIndex = topAliveIndex(f);
        const top = topIndex === -1 ? undefined : f.tracked[topIndex];
        if (top === undefined) return false;
        const live = entries.find((entry) => entry.key === top.key);
        if (live?.backEnabled === false) return false;
        return (
          isBackGestureStart(gesture.x0) &&
          gesture.dx > 8 &&
          gesture.dx > Math.abs(gesture.dy) * 1.5
        );
      },
      onPanResponderMove: (_event, gesture) => {
        const { frame: f, width: w } = liveRef.current;
        const topIndex = topAliveIndex(f);
        // Boundaries are 1 = covering; the finger's travel erodes coverage.
        const covering = 1 - gestureProgress(gesture.dx, w);
        f.bounds[topIndex]?.setValue(covering);
      },
      onPanResponderRelease: (_event, gesture) => {
        const { frame: f, width: w, entries } = liveRef.current;
        const topIndex = topAliveIndex(f);
        const bound = f.bounds[topIndex];
        if (bound === undefined) return;
        const decision = resolveBackSwipe({
          startX: gesture.x0,
          dx: gesture.dx,
          vx: gesture.vx * 1000,
          width: w,
        });
        const top = topIndex === -1 ? undefined : f.tracked[topIndex];
        const live =
          top === undefined ? undefined : entries.find((entry) => entry.key === top.key);
        if (decision === "commit" && live?.onBack !== undefined) {
          impactLight();
          live.onBack(); // the sync animates the SAME boundary on out
        } else {
          void springTo(bound, 1, { speed: 30, bounciness: 4 }); // back to covering
        }
      },
      onPanResponderTerminate: (_event, _gesture) => {
        const { frame: f } = liveRef.current;
        const topIndex = topAliveIndex(f);
        const bound = f.bounds[topIndex];
        if (bound !== undefined) void springTo(bound, 1, { speed: 30, bounciness: 4 });
      },
    }),
  ).current;

  return (
    // box-none: the stack root overlays its tab root and must never steal
    // touches meant for the content beneath — only the layers themselves are
    // touchable, and the edge-gesture pan negotiates through them.
    <View style={styles.fill} pointerEvents="box-none" {...panResponder.panHandlers}>
      {frame.tracked.map((t, index) => {
        const self = frame.bounds[index];
        if (self === undefined) return null; // bounds always parallel tracked
        const above = frame.bounds[index + 1] ?? null;
        return (
          <AnimatedView
            key={t.uid}
            style={[
              styles.layer,
              styles.layerEdge,
              layeredTranslate(self, above, width),
              layeredDim(above),
            ]}
            pointerEvents={index === topAliveIndex(frame) ? "auto" : "none"}
          >
            {props.render(t.entry)}
          </AnimatedView>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Absolute fill: the stack overlays its tab root — a flex child would
  // SPLIT the column with the tab screen (the bug where pushed screens
  // covered only half the stage).
  fill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
  },
  layerEdge: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
});
