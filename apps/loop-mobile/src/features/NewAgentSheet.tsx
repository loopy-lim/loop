/**
 * New agent sheet (rebuild brief §3 ① FAB): pick an installed kind (from
 * herdr's integration inventory), a workspace, an optional name — then
 * POST /v1/herdr/agents/start. `agy`를 포함한 모든 herdr 종류가 이 한 경로로
 * 시작된다.
 */

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { copy } from "../copy";
import { Field, inputStyle, Sheet } from "../design/primitives";
import { kindLabel } from "../herdr/kinds";
import type { HerdrAppState, HerdrStore } from "../herdr/store";
import type { HerdrIntegration } from "../herdr/wire";
import { colors, radius, space, type as typeScale } from "../ui/tokens";

export function NewAgentSheet(props: {
  visible: boolean;
  onClose: () => void;
  state: HerdrAppState;
  store: HerdrStore;
  onStarted: (paneId: string) => void;
}) {
  const [integrations, setIntegrations] = useState<HerdrIntegration[] | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.visible) return;
    let cancelled = false;
    props.store.client
      .integrations()
      .then((list) => {
        if (cancelled) return;
        setIntegrations(list);
        setKind((current) => current ?? list.find((entry) => entry.state !== "not_installed")?.target ?? null);
      })
      .catch(() => {
        if (!cancelled) setIntegrations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.visible, props.store]);

  useEffect(() => {
    if (!props.visible) {
      setKind(null);
      setWorkspaceId(null);
      setName("");
      setError(null);
      setStarting(false);
    }
  }, [props.visible]);

  const workspaces = props.state.herdr?.workspaces ?? [];

  const start = async () => {
    if (kind === null || starting) return;
    setStarting(true);
    setError(null);
    try {
      const started = await props.store.client.startAgent({
        kind,
        name: name.trim().length > 0 ? name.trim() : null,
        workspaceId: workspaceId ?? null,
        createWorkspace: workspaceId === null,
      });
      await props.store.refresh();
      props.onStarted(started.paneId);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.sendFailed);
    } finally {
      setStarting(false);
    }
  };

  const installed = integrations?.filter((entry) => entry.state !== "not_installed") ?? [];
  const nameValid = name.trim().length === 0 || /^[a-z][a-z0-9_-]{0,31}$/.test(name.trim());

  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={copy.newAgentTitle} scrollable>
      {integrations !== null && installed.length === 0 ? (
        <Text style={styles.hint}>{copy.newAgentNoIntegrations}</Text>
      ) : null}
      <Field label={copy.newAgentKindLabel}>
        <View style={styles.kindWrap}>
          {installed.map((entry) => (
            <Pressable
              key={entry.target}
              onPress={() => setKind(entry.target)}
              style={[styles.kindChip, kind === entry.target && styles.kindChipActive]}
            >
              <Text style={[styles.kindChipText, kind === entry.target && styles.kindChipTextActive]}>
                {kindLabel(entry.target)}
              </Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label={copy.newAgentWorkspaceLabel}>
        <View style={styles.kindWrap}>
          <Pressable
            onPress={() => setWorkspaceId(null)}
            style={[styles.kindChip, workspaceId === null && styles.kindChipActive]}
          >
            <Text style={[styles.kindChipText, workspaceId === null && styles.kindChipTextActive]}>
              {copy.newAgentWorkspaceNew}
            </Text>
          </Pressable>
          {workspaces.map((workspace) => (
            <Pressable
              key={workspace.id}
              onPress={() => setWorkspaceId(workspace.id)}
              style={[styles.kindChip, workspaceId === workspace.id && styles.kindChipActive]}
            >
              <Text
                style={[styles.kindChipText, workspaceId === workspace.id && styles.kindChipTextActive]}
              >
                {workspace.label.length > 0 ? workspace.label : `#${workspace.number}`}
              </Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label={copy.newAgentNameLabel}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="reviewer-1"
          placeholderTextColor={colors.inkGhost}
          autoCapitalize="none"
          autoCorrect={false}
          style={[inputStyle, !nameValid && styles.nameInvalid]}
        />
      </Field>
      {!nameValid ? <Text style={styles.hint}>이름은 소문자·숫자·-·_ 만 사용할 수 있어요</Text> : null}
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        onPress={() => void start()}
        disabled={kind === null || starting || !nameValid}
        style={[styles.startButton, (kind === null || starting || !nameValid) && styles.startDisabled]}
        accessibilityLabel={copy.newAgentStart}
      >
        <Text style={[styles.startText, (kind === null || starting || !nameValid) && styles.startTextDisabled]}>
          {starting ? copy.agentStarting : copy.newAgentStart}
        </Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  kindWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.s,
  },
  kindChip: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
  },
  kindChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  kindChipText: {
    ...typeScale.captionStrong,
    color: colors.inkMute,
  },
  kindChipTextActive: { color: colors.ink },
  nameInvalid: { borderColor: colors.danger },
  hint: {
    ...typeScale.caption,
    color: colors.inkFaint,
  },
  error: {
    ...typeScale.caption,
    color: colors.danger,
  },
  startButton: {
    alignItems: "center",
    backgroundColor: colors.cta,
    borderRadius: radius.m,
    paddingVertical: space.m,
    marginTop: space.s,
  },
  startDisabled: { backgroundColor: colors.ctaDisabled },
  startText: { ...typeScale.bodyStrong, color: colors.ctaInk },
  startTextDisabled: { color: colors.inkFaint },
});
