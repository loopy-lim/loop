import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, COLUMN_GUTTER, space } from "./tokens";
/**
 * Shared screen layout (task `simulator-showcase-2`, safe area added in
 * task `ui-codex-redesign`).
 *
 * One centered content column inside the safe area: the screen applies the
 * device insets first — status-bar/notch at the top, home indicator at the
 * bottom, and the landscape notch as horizontal margin on the column — then
 * centers a bounded-width column in what remains. Text inside the column
 * keeps the left-alignment rhythm (docs/design/ui-ux-guidance.md §2 —
 * hierarchy comes from position and separation first). Every scroll-based
 * app screen is wrapped in exactly one of these by App.tsx;
 * ConversationScreen owns its full layout and applies insets itself.
 */

/** Width of the centered content column. */
export const COLUMN_MAX_WIDTH = 480;

/**
 * Shared screen layout (task `simulator-showcase-2`, safe area added in
 * task `ui-codex-redesign`). One centered content column inside the safe
 * area. `scrollable={false}` (used by the chats home so its own list owns
 * the pull-to-refresh scroll, C13) renders the same column as a plain
 * view — children manage their own scrolling.
 *
 * `header` (task `header-statusbar-redesign`): the status-bar-substitute
 * chrome (ui/AppHeader) renders above the column and consumes the top
 * inset itself, so the root drops its own paddingTop when one is present —
 * the column then starts just below the header's hairline.
 */
export function Screen(props: { children: ReactNode; scrollable?: boolean; header?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const insetsStyle = {
    paddingTop: props.header !== undefined ? 0 : insets.top,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  } as const;
  if (props.scrollable === false) {
    return (
      <View style={[styles.root, insetsStyle]}>
        {props.header}
        <View
          style={[
            styles.column,
            styles.columnFixed,
            props.header !== undefined && styles.columnAfterHeader,
          ]}
        >
          {props.children}
          {/* Bottom inset on non-scrollable columns too (task
           * `mobile-safearea-qr-scan`): screens that end in pinned controls
           * (chats footer pills, settings, raw pane) must clear the home
           * indicator even when their content manages its own scroll tail. */}
          <View style={{ height: insets.bottom }} />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.root, insetsStyle]}>
      {props.header}
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + space.xl }]}
      >
        <View style={styles.column}>{props.children}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flexGrow: 1,
    alignItems: "center",
    paddingVertical: space.xl,
    paddingHorizontal: COLUMN_GUTTER,
  },
  column: {
    width: "100%",
    maxWidth: COLUMN_MAX_WIDTH,
  },
  // The non-scrollable column carries the same 16pt gutter as the
  // scrollable one (restyle pass): chats-home cards/labels and the files
  // screen previously ran edge-to-edge — the horizontal collapse the
  // scrollable variant never had. Same compounding with the device's
  // landscape insets as the scrollable container above.
  columnFixed: {
    flex: 1,
    width: "100%",
    maxWidth: COLUMN_MAX_WIDTH,
    paddingHorizontal: COLUMN_GUTTER,
  },
  // Below a header the column needs no status-bar clearance — just the
  // small breathing gap under the header's hairline.
  columnAfterHeader: { paddingTop: space.s },
});
