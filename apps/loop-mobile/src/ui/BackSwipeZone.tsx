/**
 * Edge-back gesture zone (task `mobile-ux-patterns`, iOS HIG interactive
 * pop): detail surfaces ride this wrapper so a left-edge swipe slides the
 * screen rightward and fires the SAME onBack the header chevron fires.
 * The app's navigation is JS-owned — there is no UINavigationController —
 * so this zone IS the pop gesture's presentation half; its decisions are
 * pure (ui/back-swipe.ts) and this component only feeds raw gesture
 * values in, settling directly on release (the sheet's no-Animated rule,
 * design-spec AC-S6-2).
 *
 * The pan claims a touch only when it STARTED in the left-edge band AND
 * moves decisively rightward — vertical scrolls, the composer, and every
 * control keep their touches (ui/back-swipe.ts isBackGestureStart
 * is the gate).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanResponder, StyleSheet, View, useWindowDimensions } from "react-native";

import { BACK_EDGE_WIDTH, backDragTranslate, resolveBackSwipe } from "./back-swipe";

export function BackSwipeZone(props: { onBack: () => void; children: ReactNode }) {
  const width = useWindowDimensions().width;
  const [dragX, setDragX] = useState(0);
  const onBackRef = useRef(props.onBack);
  // Latest-ref sync rides an effect (react-doctor no-ref-current-in-render):
  // the pan callbacks read the ref at event time, after commit.
  useEffect(() => {
    onBackRef.current = props.onBack;
  });
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.x0 <= BACK_EDGE_WIDTH && gesture.dx > 8 && gesture.dx > Math.abs(gesture.dy) * 1.5,
      onPanResponderMove: (_event, gesture) => setDragX(backDragTranslate(gesture.dx, width)),
      onPanResponderRelease: (_event, gesture) => {
        const decision = resolveBackSwipe({
          startX: gesture.x0,
          dx: gesture.dx,
          vx: gesture.vx * 1000,
          width,
        });
        setDragX(0);
        if (decision === "commit") onBackRef.current();
      },
      onPanResponderTerminate: () => setDragX(0),
    }),
  ).current;
  return (
    <View
      style={[styles.fill, dragX !== 0 && { transform: [{ translateX: dragX }] }]}
      {...panResponder.panHandlers}
    >
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
