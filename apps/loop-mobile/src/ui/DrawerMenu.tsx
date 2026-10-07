/**
 * Side menu sheet (task `mobile-ux-patterns`): the hamburger's surface —
 * a left-anchored panel over a scrim. The item list is the closed
 * DRAWER_ITEMS model (ui/side-menu.ts): a second access path to
 * the SAME three destinations as the tab bar, never a third destination.
 * Drag-left or a scrim tap dismisses; the drag decisions are pure
 * (ui/side-menu.ts) and the panel settles directly on release
 * (the sheet's no-Animated rule, design-spec AC-S6-2).
 *
 * Footer: the gateway display line (§B settings display row) — the one
 * piece of auxiliary context an operator checks before spawning work.
 */
import { useEffect, useRef, useState } from "react";
import { PanResponder, StyleSheet, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  DRAWER_ITEMS,
  DRAWER_WIDTH_FRACTION,
  drawerDragTranslate,
  resolveDrawerDrag,
  type DrawerKey,
} from "./side-menu";
import { Icon } from "./Icon";
import { DynText } from "./DynText";
import { colors, press, radius, space, type } from "./tokens";

export type { DrawerKey };

export function DrawerMenu(props: {
  open: boolean;
  /** Currently selected destination — the active row rides the accent. */
  active: DrawerKey;
  /** Gateway display line (host:port) or null when unrecorded. */
  gatewayLine: string | null;
  onSelect: (key: DrawerKey) => void;
  onClose: () => void;
}) {
  const width = useWindowDimensions().width;
  const insets = useSafeAreaInsets();
  const [dragX, setDragX] = useState(0);
  const onCloseRef = useRef(props.onClose);
  // Latest-ref sync rides an effect (react-doctor no-ref-current-in-render):
  // the pan callbacks read the ref at event time, after commit.
  useEffect(() => {
    onCloseRef.current = props.onClose;
  });
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx < 0 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4 && gesture.dx < -6,
      onPanResponderMove: (_event, gesture) => setDragX(drawerDragTranslate(gesture.dx)),
      onPanResponderRelease: (_event, gesture) => {
        const decision = resolveDrawerDrag({ dx: gesture.dx, vx: gesture.vx * 1000, width });
        setDragX(0);
        if (decision === "close") onCloseRef.current();
      },
      onPanResponderTerminate: () => setDragX(0),
    }),
  ).current;

  if (!props.open) return null;
  return (
    <View style={styles.scrim}>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        onPress={props.onClose}
        activeOpacity={press.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
      />
      <View
        style={[
          styles.panel,
          {
            width: Math.round(width * DRAWER_PANEL_FRACTION_APPLIED),
            paddingTop: insets.top + space.l,
            paddingBottom: insets.bottom + space.l,
            paddingLeft: insets.left + space.l,
            transform: dragX !== 0 ? [{ translateX: dragX }] : undefined,
          },
        ]}
        {...panResponder.panHandlers}
        accessibilityRole="menu"
      >
        {DRAWER_ITEMS.map((item) => {
          const active = item.key === props.active;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.item, active && styles.itemActive]}
              onPress={() => props.onSelect(item.key)}
              activeOpacity={press.activeOpacity}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: active }}
            >
              <Icon
                role={item.icon}
                size={type.title.fontSize}
                color={active ? colors.accent : colors.inkGhost}
              />
              <DynText style={[styles.itemLabel, active && styles.itemActiveInk]}>
                {item.label}
              </DynText>
            </TouchableOpacity>
          );
        })}
        {props.gatewayLine !== null ? (
          <View style={styles.footer}>
            <DynText style={styles.footerLabel} numberOfLines={1}>
              {props.gatewayLine}
            </DynText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The panel width the component applies; kept in sync with the pure model. */
const DRAWER_PANEL_FRACTION_APPLIED = DRAWER_WIDTH_FRACTION;

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.hairline,
    gap: space.xs,
  },
  // Destination row: ghost icon + mute label at rest; the active
  // destination rides the accent over its registered wash (canon §4 —
  // selection is the accent's state).
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    minHeight: 44,
    paddingHorizontal: space.m,
    borderRadius: radius.m,
  },
  itemActive: { backgroundColor: colors.accentSoft },
  itemActiveInk: { color: colors.accent },
  itemLabel: { ...type.bodyStrong, color: colors.inkMute },
  footer: {
    marginTop: "auto",
    paddingTop: space.m,
    paddingHorizontal: space.m,
  },
  footerLabel: { ...type.caption, color: colors.inkFaint },
});
