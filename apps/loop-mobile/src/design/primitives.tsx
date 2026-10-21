/**
 * Shared primitives for the rebuilt UI (rebuild brief §5) — the one place
 * where list rows, section headers, status pills, empty states, and sheets
 * are composed from tokens. Screens assemble these; they never re-implement
 * row/card/pill patterns (the drift the old app's inline StyleSheets
 * produced).
 */

import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { statusLabel } from "../copy";
import { Icon } from "../ui/Icon";
import { PulseDot } from "../ui/motion";
import { colors, press, radius, space, type as typeScale } from "../ui/tokens";
import type { HerdrAgentStatus } from "../herdr/wire";

// ——— status pill ———————————————————————————————————————————————————————————

/** Herdr lifecycle → closed color roles (§1: 색은 상태 glyph/accent에만). */
export function statusColor(status: HerdrAgentStatus): string {
  switch (status) {
    case "working":
      return colors.accent;
    case "idle":
      return colors.inkMute;
    case "blocked":
      return colors.warn;
    case "done":
      return colors.ok;
    default:
      return colors.inkGhost;
  }
}

export function StatusPill(props: { status: HerdrAgentStatus; style?: StyleProp<ViewStyle> }) {
  const tint = statusColor(props.status);
  return (
    <View style={[pillStyles.root, props.style]}>
      {props.status === "working" ? (
        // Working is the one live status: a quiet opacity pulse (ui/motion).
        <PulseDot color={tint} />
      ) : (
        <View style={[pillStyles.dot, { backgroundColor: tint }]} />
      )}
      <Text style={[pillStyles.label, { color: tint }]}>{statusLabel(props.status)}</Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    ...typeScale.captionStrong,
  },
});

// ——— section header ———————————————————————————————————————————————————————

export function SectionHeader(props: { title: string; trailing?: ReactNode }) {
  return (
    <View style={headerStyles.root}>
      <Text style={headerStyles.title}>{props.title}</Text>
      {props.trailing}
    </View>
  );
}

const headerStyles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.xs,
    paddingTop: space.l,
    paddingBottom: space.s,
  },
  title: {
    ...typeScale.captionStrong,
    color: colors.inkFaint,
    textTransform: "uppercase",
  },
});

// ——— empty / offline states ———————————————————————————————————————————————

export function EmptyState(props: { role: Parameters<typeof Icon>[0]["role"]; title: string; body: string }) {
  return (
    <View style={emptyStyles.root}>
      <Icon role={props.role} size={typeScale.display.fontSize} color={colors.inkGhost} />
      <Text style={emptyStyles.title}>{props.title}</Text>
      <Text style={emptyStyles.body}>{props.body}</Text>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  root: {
    alignItems: "center",
    gap: space.m,
    paddingHorizontal: space.xl,
    paddingVertical: space.xxl,
  },
  title: {
    ...typeScale.bodyStrong,
    color: colors.ink,
    textAlign: "center",
  },
  body: {
    ...typeScale.caption,
    color: colors.inkFaint,
    textAlign: "center",
    lineHeight: 19,
  },
});

// ——— touchable —————————————————————————————————————————————————————————————

export function PressableRow(props: {
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      android_ripple={{ color: colors.surfaceAlt }}
      style={({ pressed }) => [pressStyle.base, props.style, pressed && pressStyle.pressed]}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
    >
      {props.children}
    </Pressable>
  );
}

const pressStyle = StyleSheet.create({
  base: {
    borderRadius: radius.m,
  },
  pressed: {
    opacity: press.activeOpacity,
    backgroundColor: colors.surfaceAlt,
  },
});

// ——— form field ————————————————————————————————————————————————————————————

export function Field(props: { label: string; children: ReactNode }) {
  return (
    <View style={fieldStyles.root}>
      <Text style={fieldStyles.label}>{props.label}</Text>
      {props.children}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  root: { gap: space.xs },
  label: {
    ...typeScale.captionStrong,
    color: colors.inkFaint,
  },
});

export const inputStyle = StyleSheet.create({
  root: {
    ...typeScale.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.m,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
  },
}).root;

// ——— bottom sheet ——————————————————————————————————————————————————————————

export function Sheet(props: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  scrollable?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <View style={sheetStyles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} accessibilityLabel="닫기" />
        <View style={[sheetStyles.panel, { paddingBottom: insets.bottom + space.l }]}>
          <View style={sheetStyles.grabber} />
          <Text style={sheetStyles.title}>{props.title}</Text>
          {props.scrollable === true ? (
            <ScrollView style={sheetStyles.body} keyboardShouldPersistTaps="handled">
              {props.children}
            </ScrollView>
          ) : (
            <View style={sheetStyles.body}>{props.children}</View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(4, 6, 10, 0.6)",
    justifyContent: "flex-end",
  },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    paddingHorizontal: space.l,
    paddingTop: space.s,
    maxHeight: "82%",
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.inkGhost,
    marginBottom: space.m,
  },
  title: {
    ...typeScale.title,
    color: colors.ink,
    marginBottom: space.m,
  },
  body: { gap: space.m },
});

// ——— hairline ——————————————————————————————————————————————————————————————

export function Hairline() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline }} />;
}

// ——— pull-to-refresh ———————————————————————————————————————————————————————

/** The pull-to-refresh spinner, tinted for the dark surface (the system
 * default is nearly invisible on the near-black background). */
export function NativeRefresh(props: { refreshing: boolean; onRefresh: () => void }) {
  return (
    <RefreshControl
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
      tintColor={colors.inkFaint}
      colors={[colors.inkFaint]}
      progressBackgroundColor={colors.surface}
    />
  );
}
