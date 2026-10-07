import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";

import type { GatewayClient } from "../gateway-client/client";
import type { SubmitPromptAccepted } from "../gateway-client/wire";
import type { SessionNamingIndex } from "../state/sessionsView";
import { SpawnFab } from "../features/spawn-fab";
import { DynText } from "../ui/DynText";
import { SUBMIT_FAILED_NOTICE } from "../ui/copy";
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
  // Focus ring (canon §4): the composer card's border rides the accent
  // while the prompt input is focused — the card is the input's surface.
  const [inputFocused, setInputFocused] = useState(false);
  const autoSubmitFired = useRef(false);

  const submit = () => {
    setBusy(true);
    setError(null);
    props.client
      .submitPrompt(prompt, undefined)
      .then(props.onAccepted)
      // R-6 (mechanical part): the failure notice is an owned constant —
      // the raw transport message never reaches the surface (C10).
      .catch(() => setError(SUBMIT_FAILED_NOTICE))
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
        .catch(() => setError(SUBMIT_FAILED_NOTICE))
        .finally(() => setBusy(false));
    }, props.submitDelayMs ?? 8000);
    return () => clearTimeout(timer);
    // Run once on mount with the launch-time prompt; mirrors a human tap on Submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screenRoot}>
      <View style={[styles.composerCard, inputFocused && styles.composerCardFocused]}>
        <TextInput
          style={styles.input}
          multiline
          value={prompt}
          onChangeText={setPrompt}
          placeholder="Describe the task for Loop"
          placeholderTextColor={colors.inkFaint}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
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
      {/* Real runs on the gateway (durable + transient), same list `loop runs` shows. */}
      <View style={styles.listSection}>
        <RunsList
          client={props.client}
          naming={props.naming}
          onOpenRun={props.onOpenRun}
          onOpenSession={props.onOpenSession}
        />
      </View>
      {/* Remote spawn (task `fab-icons`, superseding the inline card):
       * a floating "+" action button anchored bottom-right — the flow's
       * spawning/waiting/problem states stay visible in the status pill
       * directly above the button, without a modal. Last child: the FAB
       * floats OVER the list (touch + z-order). */}
      <SpawnFab
        client={props.client}
        blocked={props.spawnBlocked ?? false}
        onBlocked={() => props.onSpawnBlocked?.()}
        onOpened={(sessionId) => props.onOpenSession?.(sessionId)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  composerCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    padding: space.m,
  },
  // Focus ring (canon §4): the accent marks the focused composer only.
  composerCardFocused: { borderColor: colors.accent },
  input: {
    color: colors.ink,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    // Two visible lines at rest (restyle pass; was 72 — a 150pt card whose
    // empty state showed one placeholder line over 50pt of dead air).
    // Multiline growth is unchanged.
    minHeight: 48,
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
    // Primary tier: white fill, radius.m — the pill radius is retired for
    // buttons (task `redesign-implement`, canon §3 버튼 위계).
    backgroundColor: colors.cta,
    borderRadius: radius.m,
    // 44pt touch floor: paddingVertical m puts the button at ~46pt tall.
    paddingVertical: space.m,
    paddingHorizontal: space.l,
  },
  ctaDisabled: { backgroundColor: colors.ctaDisabled },
  ctaText: { ...type.bodyStrong, color: colors.ctaInk },
  ctaTextDisabled: { color: colors.inkFaint },
  screenRoot: { flex: 1 },
  listSection: { flex: 1, marginTop: space.xl },
});
