/**
 * Settings — connection (host/port, stream status, logout), herdr server
 * facts (version · protocol), and the installed agent-kind inventory from
 * the gateway's integrations route.
 */

import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { copy, statusLabel } from "../copy";
import { SectionHeader } from "../design/primitives";
import { kindLabel } from "../herdr/kinds";
import type { HerdrAppState } from "../herdr/store";
import type { HerdrIntegration } from "../herdr/wire";
import { useStore } from "../app/storeContext";
import { Icon } from "../ui/Icon";
import { colors, radius, space, type as typeScale, COLUMN_GUTTER } from "../ui/tokens";

export function SettingsScreen(props: { state: HerdrAppState; onLogout: () => void }) {
  const store = useStore();
  const insets = useSafeAreaInsets();
  const [integrations, setIntegrations] = useState<HerdrIntegration[] | null>(null);
  const { connection } = props.state;

  useEffect(() => {
    let cancelled = false;
    store.client
      .integrations()
      .then((list) => {
        if (!cancelled) setIntegrations(list);
      })
      .catch(() => {
        if (!cancelled) setIntegrations(null);
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const confirmLogout = () => {
    Alert.alert(copy.logoutConfirmTitle, copy.logoutConfirmBody, [
      { text: "취소", style: "cancel" },
      { text: copy.logout, style: "destructive", onPress: props.onLogout },
    ]);
  };

  const herdr = props.state.herdr;
  const statusText: Record<string, string> = {
    idle: copy.settingsNotConnected,
    connecting: copy.connecting,
    live: copy.connectedTo,
    waiting: "재연결 중…",
    failed: copy.connectFailed,
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.m }]}
    >
      <Text style={styles.title}>{copy.settingsTitle}</Text>

      <SectionHeader title={copy.settingsConnection} />
      <View style={styles.card}>
        <FactRow label="호스트" value={connection.host ?? "—"} mono />
        <FactRow label="포트" value={connection.port === null ? "—" : String(connection.port)} mono />
        <FactRow
          label="스트림"
          value={statusText[connection.status] ?? connection.status}
          valueColor={connection.status === "live" ? colors.ok : connection.status === "failed" ? colors.danger : colors.inkMute}
        />
        {connection.failure !== null ? (
          <FactRow label="오류" value={connection.failure} valueColor={colors.danger} />
        ) : null}
      </View>

      <SectionHeader title={copy.settingsHerdr} />
      <View style={styles.card}>
        <FactRow label={copy.settingsServerVersion} value={herdr?.available === true ? herdr.serverVersion : "—"} mono />
        <FactRow label={copy.settingsProtocol} value={herdr?.available === true ? String(herdr.protocol) : "—"} mono />
        <FactRow
          label="집중 워크스페이스"
          value={workspaceLabel(herdr?.focused.workspaceId ?? null, herdr?.workspaces ?? [])}
        />
      </View>

      <SectionHeader title="에이전트 종류" />
      <View style={styles.card}>
        {integrations === null ? (
          <FactRow label="—" value={copy.settingsNotConnected} />
        ) : (
          integrations
            .filter((entry) => entry.state !== "not_installed")
            .map((entry) => (
              <FactRow key={entry.target} label={kindLabel(entry.target)} value={entry.state === "current" ? "설치됨" : "업데이트 필요"} />
            ))
        )}
        {integrations !== null && integrations.every((entry) => entry.state === "not_installed") ? (
          <Text style={styles.mutedBody}>{copy.newAgentNoIntegrations}</Text>
        ) : null}
      </View>

      <Pressable onPress={confirmLogout} style={styles.logout} accessibilityLabel={copy.logout}>
        <Icon role="logout" size={typeScale.body.fontSize} color={colors.danger} />
        <Text style={styles.logoutText}>{copy.logout}</Text>
      </Pressable>
      <View style={{ height: insets.bottom + space.xl }} />
    </ScrollView>
  );
}

function workspaceLabel(workspaceId: string | null, workspaces: { id: string; label: string; number: number; status: string }[]): string {
  if (workspaceId === null) return "—";
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  if (workspace === undefined) return workspaceId;
  return `${workspace.label} · ${statusLabel(workspace.status)}`;
}

function FactRow(props: { label: string; value: string; mono?: boolean; valueColor?: string }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{props.label}</Text>
      <Text
        style={[styles.factValue, props.mono === true && styles.factMono, props.valueColor !== undefined && { color: props.valueColor }]}
        numberOfLines={1}
      >
        {props.value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: COLUMN_GUTTER },
  title: {
    ...typeScale.display,
    color: colors.ink,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    gap: space.s,
  },
  factRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.m,
  },
  factLabel: {
    ...typeScale.caption,
    color: colors.inkFaint,
  },
  factValue: {
    ...typeScale.caption,
    color: colors.ink,
    flexShrink: 1,
    textAlign: "right",
  },
  factMono: { fontFamily: "Menlo" },
  mutedBody: {
    ...typeScale.caption,
    color: colors.inkFaint,
    paddingTop: space.xs,
  },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s,
    paddingVertical: space.m,
    marginTop: space.xl,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  logoutText: {
    ...typeScale.bodyStrong,
    color: colors.danger,
  },
});
