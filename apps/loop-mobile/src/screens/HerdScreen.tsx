/**
 * Herd home — the app's first surface (rebuild brief §3 ①): every agent in
 * the herd, grouped by workspace, live status pills, one tap into the agent
 * detail. The FAB is the only creation entry (새 에이전트). Offline and
 * disconnected states are honest first-class renderings.
 */

import { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useStore } from "../app/storeContext";

import { copy } from "../copy";
import { EmptyState, NativeRefresh, PressableRow, SectionHeader, StatusPill } from "../design/primitives";
import { kindLabel } from "../herdr/kinds";
import { paneDisplayName, workspaceGroups, type HerdrAppState } from "../herdr/store";
import type { HerdrPane } from "../herdr/wire";
import { Icon } from "../ui/Icon";
import { PressableScale } from "../ui/motion";
import { colors, elevation, radius, space, type as typeScale, COLUMN_GUTTER } from "../ui/tokens";

export function HerdScreen(props: {
  state: HerdrAppState;
  onOpenAgent: (paneId: string) => void;
  onNewAgent: () => void;
}) {
  const { state } = props;
  const store = useStore();
  const insets = useSafeAreaInsets();
  const groups = useMemo(
    () => (state.herdr === null ? [] : workspaceGroups(state.herdr)),
    [state.herdr],
  );
  const loading = state.connection.status === "connecting" && state.herdr === null;

  return (
    <View style={styles.root}>
      <FlatList
        style={styles.list}
        data={groups}
        keyExtractor={(group) => group.workspace.id}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space.m }]}
        renderItem={({ item }) => (
          <View>
            <SectionHeader
              title={`${item.workspace.label} · ${item.workspace.number}`}
            />
            {item.panes.map((pane) => (
              <AgentRow key={pane.id} pane={pane} onPress={() => props.onOpenAgent(pane.id)} />
            ))}
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            // First-connection loading: an honest quiet indicator instead of
            // a bare empty body (plan 2026-10-25 AC-8).
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.inkFaint} />
              <Text style={styles.loadingText}>{copy.connecting}</Text>
            </View>
          ) : (
            <HerdEmpty state={state} />
          )
        }
        // Android/Fabric (RN 0.88, live-verified 2026-10-22): mounting a
        // RefreshControl here blanks the ENTIRE Herd subtree — the JS renders
        // (rows, FAB in the tree) but no native view ever attaches. iOS keeps
        // the native pull-to-refresh; Android rides the live SSE stream.
        refreshControl={
          Platform.OS === "ios" ? (
            <NativeRefresh
              refreshing={state.connection.status === "connecting"}
              onRefresh={() => void store.refresh()}
            />
          ) : undefined
        }
      />
      <NewAgentFab onPress={props.onNewAgent} />
    </View>
  );
}

function AgentRow(props: { pane: HerdrPane; onPress: () => void }) {
  const label = kindLabel(props.pane.agent);
  return (
    <PressableRow onPress={props.onPress} style={styles.row} accessibilityLabel={label}>
      <View style={styles.rowIcon}>
        <Icon role="agent" size={typeScale.title.fontSize} color={colors.inkMute} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {paneDisplayName(props.pane, label)}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {[label, props.pane.cwd].filter((part) => part != null && part.length > 0).join(" · ")}
        </Text>
      </View>
      <StatusPill status={props.pane.status} />
      <Icon role="forward" size={typeScale.caption.fontSize} color={colors.inkGhost} />
    </PressableRow>
  );
}

function HerdEmpty(props: { state: HerdrAppState }) {
  if (props.state.connection.status === "failed") {
    return <EmptyState role="attention" title={copy.herdOfflineTitle} body={copy.herdFailedBody} />;
  }
  if (props.state.herdr !== null && !props.state.herdr.available) {
    return <EmptyState role="attention" title={copy.herdOfflineTitle} body={copy.herdOfflineBody} />;
  }
  return <EmptyState role="agent" title={copy.herdEmptyTitle} body={copy.herdEmptyBody} />;
}

function NewAgentFab(props: { onPress: () => void }) {
  // The FAB anchors to the stage bottom (the tab bar sits below the stage),
  // so no home-indicator inset here — one quiet gap, not two.
  return (
    <PressableScale
      onPress={props.onPress}
      accessibilityLabel={copy.newAgent}
      style={[styles.fab, elevation.float]}
    >
      <Icon role="spawn" size={typeScale.title.fontSize} color={colors.ctaInk} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { flex: 1 },
  content: {
    paddingHorizontal: COLUMN_GUTTER,
    paddingBottom: 96,
  },
  loadingRow: {
    alignItems: "center",
    gap: space.s,
    paddingTop: space.xxl,
  },
  loadingText: {
    ...typeScale.caption,
    color: colors.inkFaint,
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
  rowIcon: { width: typeScale.title.fontSize },
  rowBody: {
    flex: 1,
    gap: space.xxs,
  },
  rowTitle: {
    ...typeScale.bodyStrong,
    color: colors.ink,
  },
  rowSubtitle: {
    ...typeScale.caption,
    color: colors.inkFaint,
  },
  fab: {
    position: "absolute",
    right: space.l + COLUMN_GUTTER / 2,
    bottom: space.l,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.cta,
    alignItems: "center",
    justifyContent: "center",
  },
});
