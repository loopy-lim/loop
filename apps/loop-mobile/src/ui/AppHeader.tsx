import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DynText } from "./DynText";
import { COLUMN_MAX_WIDTH } from "./Screen";
import { colors, COLUMN_GUTTER, space, type } from "./tokens";

/**
 * Top chrome header (task `header-statusbar-redesign`, revised by
 * `conversation-safearea-fix`): the status-bar zone is cleared first —
 * `paddingTop: insets.top` — and the chrome row (title left flank, action
 * icons right flank) renders BELOW it, so no app content ever sits inside
 * the status-bar/Dynamic-Island band. Both flanks still ride the device's
 * horizontal safe insets for the landscape notch. Screens with headers
 * (chats, conversation) render exactly one of these; content begins below
 * the zone's single hairline (minimal-design-spec S5).
 */

/** Chrome row height below the cleared status zone. The 44pt touch floor
 * (ui-ux-guidance §8) keeps the back chevron and corner actions honest.
 * Display-geometry constant, not a theme token. */
export const HEADER_BAR_HEIGHT = 44;

export function AppHeader(props: {
  title: string;
  /** Left flank, rendered before the title (back chevron on conversation). */
  leading?: ReactNode;
  /** Right flank: the corner action icons (logout on chats, Raw/Chat on
   * conversation). */
  actions?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.zone,
        { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      <View style={styles.bar}>
        <View style={styles.leading}>
          {props.leading}
          <DynText style={styles.title} numberOfLines={1}>
            {props.title}
          </DynText>
        </View>
        <View style={styles.actions}>{props.actions}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  zone: {
    width: "100%",
    backgroundColor: colors.bg,
    // One quiet separation rule (guidance §3): the hairline under the
    // status zone separates chrome from content on every header screen.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  bar: {
    height: HEADER_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    width: "100%",
    maxWidth: COLUMN_MAX_WIDTH,
    paddingHorizontal: COLUMN_GUTTER,
  },
  leading: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
  },
  actions: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
  },
  title: { ...type.title, color: colors.ink, flexShrink: 1 },
});
