import { StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import { DynText } from "./DynText";
import { type IconRole } from "./glyphs";
import { colors, press, space, type } from "./tokens";

/**
 * Bottom tab bar (task `redesign-implement`, direction A "Quiet Accent" —
 * brief §4 재판정: the bottom ZONE was right, the pills were wrong; this is
 * the tab bar the verdict calls for — icon + label + an active state, the
 * Notion/Codex/Linear mobile convention). Three destinations only; detail
 * surfaces (conversation, raw pane, scanner) hide it and use the header's
 * back chevron instead.
 *
 * The active tab rides `accent` (canon §4: the accent is the active/
 * selected STATE color); inactive marks ride the ink ladder (ghost icons,
 * faint labels). No fills, no pills — the bar itself is chrome separated by
 * one hairline (§3: separation is one quiet rule).
 */

export type TabKey = "chats" | "files" | "settings";

const TABS: readonly { key: TabKey; role: IconRole; label: string }[] = [
  { key: "chats", role: "tabChats", label: "Chats" },
  { key: "files", role: "tabFiles", label: "Files" },
  { key: "settings", role: "tabSettings", label: "Settings" },
];

export function TabBar(props: { active: TabKey; onSelect: (key: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.s) }]}
      accessibilityRole="tablist"
    >
      {TABS.map((tab) => {
        const active = tab.key === props.active;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => props.onSelect(tab.key)}
            activeOpacity={press.activeOpacity}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Icon
              role={tab.role}
              size={type.title.fontSize}
              weight="medium"
              color={active ? colors.accent : colors.inkGhost}
            />
            <DynText style={[styles.label, { color: active ? colors.accent : colors.inkFaint }]}>
              {tab.label}
            </DynText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: space.xxs,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xxs,
  },
  label: { ...type.captionStrong },
});
