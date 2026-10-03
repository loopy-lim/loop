/**
 * Viewer bottom sheet (split-viewer design §B, narrow screens): hosts the
 * SAME FileViewerPane the wide layout docks, inside a draggable sheet with
 * two snap points (half, full) and drag-down-to-dismiss.
 *
 * The gesture DECISIONS are pure (features/bottom-sheet.ts): this component
 * only feeds raw drag values in and settles at the decided snap. Motion
 * vocabulary note: the sheet deliberately does NOT animate — RN Animated
 * is reserved to ui/motion.tsx (design-spec AC-S6-2) and a snap is not a
 * registered motion variant — so the sheet tracks the finger and settles
 * directly on release.
 */
import { useEffect, useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { resolveSheetSnap, sheetTopOffset, type SheetDecision } from "./bottom-sheet";
import { colors, radius, space } from "../ui/tokens";

export function ViewerBottomSheet(props: {
  open: boolean;
  /** Container height the snap points are fractions of (window height). */
  containerHeight: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const height = props.containerHeight;
  /** Current top offset (px from container top); the sheet's position. */
  const [topOffset, setTopOffset] = useState<number>(() => sheetTopOffset("half", height));
  const restingSnap = useRef<SheetDecision>("half");
  const dragState = useRef({ startTop: 0 });

  // A newly opened sheet always presents at the half snap (§B).
  useEffect(() => {
    if (props.open) setTopOffset(sheetTopOffset("half", height));
  }, [props.open, height]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderGrant: (_event, gesture) => {
        dragState.current.startTop = (topOffset as number) - gesture.dy;
      },
      onPanResponderMove: (_event, gesture) => {
        setTopOffset(
          Math.min(
            height,
            Math.max(sheetTopOffset("full", height), dragState.current.startTop + gesture.dy),
          ),
        );
      },
      onPanResponderRelease: (_event, gesture) => {
        const decision = resolveSheetSnap({
          topOffset: dragState.current.startTop + gesture.dy,
          velocityY: gesture.vy * 1000,
          deltaY: gesture.dy,
          height,
        });
        if (decision === "dismiss") {
          props.onClose();
          return;
        }
        restingSnap.current = decision;
        setTopOffset(sheetTopOffset(decision, height));
      },
    }),
  ).current;

  if (!props.open || height <= 0) return null;
  return (
    <View style={styles.scrim} pointerEvents="box-none">
      <View style={[styles.sheet, { height, top: topOffset }]} {...panResponder.panHandlers}>
        <View style={styles.handle} />
        {props.children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    paddingHorizontal: space.l,
    paddingTop: space.s,
  },
  // The grab handle: the sheet's one decorative affordance.
  handle: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.inkFaint,
    marginBottom: space.s,
  },
});
