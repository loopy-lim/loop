/**
 * Swipeable list row (task `mobile-ux-patterns`, iOS HIG row actions):
 * a horizontal drag on the row reveals one action — Open — behind the
 * right edge; a committed leftward fling quick-opens without stopping at
 * the reveal (the Mail full-swipe convention). The DECISIONS are pure
 * (ui/row-swipe.ts): this component only feeds raw gesture values
 * in and settles at the decided reveal — the sheet's no-Animated rule
 * applies here too (design-spec AC-S6-2: RN Animated is reserved to
 * ui/motion.tsx).
 *
 * One action only, by honesty: the mobile client contract owns exactly
 * one row verb (open the chat); there is no cancel/delete surface, so
 * the swipe invents nothing. Rows without an action render as plain
 * hosts — a control that cannot fire is never shown (guidance §1).
 *
 * The pan claims a touch only when the move is decisively horizontal,
 * so the vertical scroll and the list's pull-to-refresh control are
 * never stolen.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanResponder, StyleSheet, TouchableOpacity, View } from "react-native";

import { clampRowDrag, resolveRowSwipe, ROW_ACTION_WIDTH, ROW_PEEK_CLOSE_MS, ROW_PEEK_WIDTH } from "./row-swipe";
import { ROW_OPEN_ACTION_LABEL } from "./copy";
import { DynText } from "./DynText";
import { glyph } from "./glyphs";
import { colors, press, radius, type } from "./tokens";

export function SwipeableRow(props: {
  onAction?: () => void;
  /** Discoverability peek (task `main-screen-polish`): mount partially
   * revealed — the list hands this to its FIRST actionable row only. */
  peek?: boolean;
  children: ReactNode;
}) {
  // No action, no gesture: the row is a static host (showcase rows).
  if (props.onAction === undefined) {
    return <View style={styles.host}>{props.children}</View>;
  }
  return (
    <ActiveSwipeableRow onAction={props.onAction} peek={props.peek === true}>
      {props.children}
    </ActiveSwipeableRow>
  );
}

/** The gesture-bearing twin — separate so the static host above can
 * early-return without conditional hooks. */
function ActiveSwipeableRow(props: { onAction: () => void; peek: boolean; children: ReactNode }) {
  const [dragX, setDragX] = useState(0);
  // Discoverability peek: the row mounts partially revealed and settles
  // shut on its own — a hint is not a resting state. Any touch on the row
  // (pan grant) or on the action clears it sooner.
  const [peeked, setPeeked] = useState(props.peek);
  useEffect(() => {
    if (!props.peek) return;
    const timer = setTimeout(() => setPeeked(false), ROW_PEEK_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [props.peek]);
  const onActionRef = useRef(props.onAction);
  onActionRef.current = props.onAction;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4 && Math.abs(gesture.dx) > 6,
      onPanResponderGrant: () => setPeeked(false),
      onPanResponderMove: (_event, gesture) => setDragX(clampRowDrag(gesture.dx)),
      onPanResponderRelease: (_event, gesture) => {
        const decision = resolveRowSwipe({ dx: gesture.dx, vx: gesture.vx * 1000 });
        setDragX(0);
        // `commit` is the quick-open: the action fires exactly as the
        // revealed button's tap does — one verb, two paths.
        if (decision === "commit") onActionRef.current();
      },
      onPanResponderTerminate: () => setDragX(0),
    }),
  ).current;
  // The peek rides the same transform a drag does — one reveal mechanic,
  // two entrances (gesture vs hint).
  const offset = peeked ? -ROW_PEEK_WIDTH : dragX;
  return (
    <View style={styles.host}>
      <View style={styles.action}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => {
            setPeeked(false);
            onActionRef.current();
          }}
          activeOpacity={press.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={ROW_OPEN_ACTION_LABEL}
        >
          <DynText style={styles.actionLabel}>
            {ROW_OPEN_ACTION_LABEL} {glyph.forward}
          </DynText>
        </TouchableOpacity>
      </View>
      <View
        style={[styles.row, offset !== 0 && { transform: [{ translateX: offset }] }]}
        {...panResponder.panHandlers}
      >
        {props.children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The host clips: a dragged row slides INSIDE its cell (the leading
  // edge clips at the host bound, as on iOS), never over neighbors.
  host: { overflow: "hidden", borderRadius: radius.m },
  // The revealed strip behind the row's right edge. The row renders
  // above it, so at rest the strip is fully covered and untouchable.
  action: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: ROW_ACTION_WIDTH,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
  },
  actionButton: { flex: 1, alignItems: "center", justifyContent: "center" },
  // The action mark rides the accent over its registered wash — the
  // transient revealed state is the accent's one interactive moment
  // (canon §4: state color, never a second emphasis at rest).
  actionLabel: { ...type.captionStrong, color: colors.accent },
  row: { backgroundColor: colors.surface },
});
