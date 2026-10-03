import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";

import type { GatewayClient } from "../gateway-client/client";
import type { SubmitPromptAccepted } from "../gateway-client/wire";
import type { SessionNamingIndex } from "../state/sessionsView";
import { SpawnSessionCard } from "../features/spawn-card";
import { DynText } from "../ui/DynText";
import { colors, press, radius, space, type } from "../ui/tokens";
import { RunsList } from "../features/run-list";

/**
 * Screen 2 — chats home (ADR §5.2; Codex-like home for task
 * `ui-codex-redesign`): a "new run" composer card on top, the chats list
 * below. Submits the raw prompt and navigates to the conversation with the
 * accepted runId. v1 submit is not idempotent: on network failure the user
 * decides whether to resubmit; the client never retries automatically.
 * The screen's title lives in the status-bar-substitute header (task
 * `header-statusbar-redesign`: App composes it via the shared Screen's
 * header slot — title left, logout corner right); this surface is only
 * composer + list.
 */
export function SubmitScreen(props: {
  client: GatewayClient;
  onAccepted: (accepted: SubmitPromptAccepted) => void;
  /** Showcase/demo: prefill the prompt field. */
  initialPrompt?: string;
  /** Showcase/demo: fire the same Submit handler after `submitDelayMs`. */
  autoSubmit?: boolean;
  /** Showcase/demo: delay before auto-submit (default 8000ms). */
  submitDelayMs?: number;
  /** Opens the live view of a run selected from the real runs list. */
  onOpenRun?: (runId: string) => void;
  /** Opens the conversation of an uncorrelated session from the list. */
  onOpenSession?: (sessionId: string) => void;
  /** App-local naming evidence fold for the chats-list session rows. */
  naming?: SessionNamingIndex;
  /** Remote spawn (decision 2026-xx-session-spawn §D-D): learned gate is
   * App-owned (connection lifetime); the card only reports it. */
  spawnBlocked?: boolean;
  onSpawnBlocked?: () => void;
}) {
  const [prompt, setPrompt] = useState(props.initialPrompt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSubmitFired = useRef(false);

  const submit = () => {
    setBusy(true);
    setError(null);
    props.client
      .submitPrompt(prompt, undefined)
      .then(props.onAccepted)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "submit failed"))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (autoSubmitFired.current || props.autoSubmit !== true) return;
    const initial = props.initialPrompt;
    if (initial === undefined || initial.trim().length === 0) return;
    autoSubmitFired.current = true;
    const timer = setTimeout(() => {
      setBusy(true);
      setError(null);
      props.client
        .submitPrompt(initial, undefined)
        .then(props.onAccepted)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "submit failed"))
        .finally(() => setBusy(false));
    }, props.submitDelayMs ?? 8000);
    return () => clearTimeout(timer);
    // Run once on mount with the launch-time prompt; mirrors a human tap on Submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screenRoot}>
      <View style={styles.composerCard}>
        <TextInput
          style={styles.input}
          multiline
          value={prompt}
          onChangeText={setPrompt}
          placeholder="Describe the task for Loop"
          placeholderTextColor={colors.inkFaint}
        />
        <View style={styles.composerFooter}>
          {error !== null ? <DynText style={styles.error}>{error}</DynText> : <View />}
          <TouchableOpacity
            style={[styles.cta, (busy || prompt.trim().length === 0) && styles.ctaDisabled]}
            onPress={submit}
            disabled={busy || prompt.trim().length === 0}
            activeOpacity={press.activeOpacity}
          >
            <DynText
              style={[
                styles.ctaText,
                (busy || prompt.trim().length === 0) && styles.ctaTextDisabled,
              ]}
            >
              {busy ? "Submitting…" : "Submit"}
            </DynText>
          </TouchableOpacity>
        </View>
      </View>
      {/* Remote spawn (decision 2026-xx-session-spawn §D-D): a quiet
       * labeled action between the composer and the list — it never
       * competes with Submit, and its inline status line owns the whole
       * flow's feedback (spawning → waiting → problem) without a modal. */}
      <SpawnSessionCard
        client={props.client}
        blocked={props.spawnBlocked ?? false}
        onBlocked={() => props.onSpawnBlocked?.()}
        onOpened={(sessionId) => props.onOpenSession?.(sessionId)}
      />
      {/* Real runs on the gateway (durable + transient), same list `loop runs` shows. */}
      <View style={styles.listSection}>
        <RunsList
          client={props.client}
          naming={props.naming}
          onOpenRun={props.onOpenRun}
          onOpenSession={props.onOpenSession}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  composerCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.l,
    padding: space.m,
  },
  input: {
    color: colors.ink,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    minHeight: 72,
    textAlignVertical: "top",
    padding: 0,
  },
  composerFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.m,
    marginTop: space.s,
  },
  error: { ...type.caption, color: colors.danger, flexShrink: 1 },
  cta: {
    backgroundColor: colors.cta,
    borderRadius: radius.pill,
    // 44pt touch floor: paddingVertical m puts the pill at ~46pt tall
    // (was 10 → 42pt, under the floor in ui-ux-guidance §8).
    paddingVertical: space.m,
    paddingHorizontal: space.l,
  },
  ctaDisabled: { backgroundColor: colors.ctaDisabled },
  ctaText: { ...type.bodyStrong, color: colors.ctaInk },
  ctaTextDisabled: { color: colors.inkFaint },
  screenRoot: { flex: 1 },
  listSection: { flex: 1, marginTop: space.xl },
});
