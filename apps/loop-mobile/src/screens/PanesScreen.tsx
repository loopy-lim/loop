/**
 * Panes browser (rebuild brief §3 ③): every workspace → tab → pane,
 * including non-agent shells. A pane row opens the terminal view; the
 * header action creates a workspace.
 */

import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { copy } from "../copy";
import { EmptyState, PressableRow, StatusPill } from "../design/primitives";
import { kindLabel } from "../herdr/kinds";
import { panesOfTab, type HerdrAppState } from "../herdr/store";
import type { HerdrPane } from "../herdr/wire";
import { useStore } from "../app/storeContext";
import { Icon } from "../ui/Icon";
import { colors, radius, space, type as typeScale, COLUMN_GUTTER } from "../ui/tokens";
import { paneDisplayName } from "../herdr/store";

export function PanesScreen(props: {
  state: HerdrAppState;
  onOpenPane: (paneId: string) => void;
}) {
  const store = useStore();
  const insets = useSafeAreaInsets();
  const herdr = props.state.herdr;
  const workspaces = useMemo(
    () => (herdr === null ? [] : [...herdr.workspaces].sort((a, b) => a.number - b.number)),
    [herdr],
  );

  const createWorkspace = async () => {
    try {
      await store.client.createWorkspace(null, null);
      await store.refresh();
    } catch {
      // Offline: the next state frame re-renders honestly.
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.m }]}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>{copy.panesTitle}</Text>
        <Pressable
          onPress={() => void createWorkspace()}
          style={styles.createButton}
          accessibilityLabel={copy.newAgentWorkspaceNew}
        >
          <Icon role="spawn" size={typeScale.caption.fontSize} color={colors.ink} />
          <Text style={styles.createButtonText}>워크스페이스</Text>
        </Pressable>
      </View>

      {workspaces.length === 0 ? (
        <EmptyState role="tabPanes" title={copy.panesTitle} body={copy.panesEmpty} />
      ) : null}

      {workspaces.map((workspace) => {
        const tabs = herdr?.tabs
          .filter((tab) => tab.workspaceId === workspace.id)
          .sort((a, b) => a.number - b.number) ?? [];
        return (
          <View key={workspace.id}>
            <Text style={styles.workspaceTitle}>
              {workspace.label.length > 0 ? workspace.label : `워크스페이스 ${workspace.number}`}
            </Text>
            {tabs.map((tab) => {
              const panes = herdr === null ? [] : panesOfTab(herdr, tab.id);
              return (
                <View key={tab.id}>
                  {tabs.length > 1 ? (
                    <Text style={styles.tabTitle}>탭 {tab.number}</Text>
                  ) : null}
                  {panes.map((pane) => (
                    <PaneRow key={pane.id} pane={pane} onPress={() => props.onOpenPane(pane.id)} />
                  ))}
                </View>
              );
            })}
          </View>
        );
      })}
      <View style={{ height: 64 }} />
    </ScrollView>
  );
}

function PaneRow(props: { pane: HerdrPane; onPress: () => void }) {
  const isAgent = props.pane.agent !== null;
  const label = kindLabel(props.pane.agent);
  const name = paneDisplayName(props.pane, label);
  return (
    <PressableRow onPress={props.onPress} style={styles.row}>
      <Icon
        role={isAgent ? "agent" : "tabPanes"}
        size={typeScale.body.fontSize}
        color={isAgent ? colors.inkMute : colors.inkGhost}
      />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {isAgent ? label : copy.paneShell}
        </Text>
      </View>
      <StatusPill status={props.pane.status} />
    </PressableRow>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    paddingHorizontal: COLUMN_GUTTER,
    gap: space.m,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    ...typeScale.display,
    color: colors.ink,
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.m,
    paddingVertical: space.xs,
  },
  createButtonText: {
    ...typeScale.captionStrong,
    color: colors.ink,
  },
  workspaceTitle: {
    ...typeScale.title,
    color: colors.ink,
    paddingTop: space.m,
  },
  tabTitle: {
    ...typeScale.captionStrong,
    color: colors.inkFaint,
    paddingTop: space.s,
    paddingBottom: space.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: space.m,
    paddingVertical: space.m,
    marginBottom: space.s,
  },
  rowBody: { flex: 1, gap: space.xxs },
  rowTitle: {
    ...typeScale.bodyStrong,
    color: colors.ink,
  },
  rowSubtitle: {
    ...typeScale.caption,
    color: colors.inkFaint,
  },
});
