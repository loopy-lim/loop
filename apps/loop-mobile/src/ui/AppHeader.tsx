import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DynText } from "./DynText";
import { COLUMN_MAX_WIDTH } from "./Screen";
import { colors, COLUMN_GUTTER, space, type } from "./tokens";

/**
 * Status-bar-substitute header (task `header-statusbar-redesign`, operator
 * directive): the top chrome lives IN the status-bar zone instead of below
 * it. The system Dynamic Island stays the only centered element; app
 * content flanks it — the title anchors left, action icons anchor right —
 * with no centered bar of our own. Nothing renders under the island: the
 * row reserves ISLAND_RESERVE in the middle, the title truncates inside its
 * flank, and both flanks ride the device's horizontal safe insets. Screens
 * with headers (chats, conversation) render exactly one of these; content
 * begins below the zone's single hairline (minimal-design-spec S5).
 */

/** Reserved middle width so no app content flows under the Dynamic Island
 * (~125pt on island devices; the small surplus keeps the flanks honest, and
 * on non-island devices the reserve is just breathing room between the
 * title and the actions). Display-geometry constant, not a theme token. */
export const ISLAND_RESERVE = 130;

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
        { height: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
      ]}
    >
      <View style={styles.bar}>
        <View style={styles.leading}>
          {props.leading}
          <DynText style={styles.title} numberOfLines={1}>
            {props.title}
          </DynText>
        </View>
        {/* The island's flank: reserved width, non-interactive — content
         * can end at its edges but never flow beneath it. */}
        <View style={styles.island} />
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
  // The bar rides the same centered column as the screens' content so the
  // title aligns with the surface below it.
  bar: {
    flex: 1,
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
  island: { width: ISLAND_RESERVE, flexShrink: 0 },
  actions: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
  },
  title: { ...type.title, color: colors.ink, flexShrink: 1 },
});
