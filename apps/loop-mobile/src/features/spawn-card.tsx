/**
 * Remote spawn surface (task `spawn-app-ui`, decision 2026-xx-session-spawn
 * §D-D): the chats-home "New TUI session" card → POST /v1/sessions/spawn →
 * auto-open the discovered session in the conversation view. Thin state
 * wiring only — every unit-testable piece (discovery polling, problem
 * formatting, gate classification) lives in the react-free
 * `features/session-spawn.ts` (a separate basename so the test runtime,
 * which cannot load react-native, imports the pure module unambiguously).
 */

import { useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import type { GatewayClient } from "../gateway-client/client";
import {
  awaitSpawnedSession,
  describeSpawnProblem,
  isSpawnGateProblem,
  sessionIdsOf,
} from "./session-spawn";
import {
  SPAWN_TUI_BLOCKED,
  SPAWN_TUI_FAILED_PREFIX,
  SPAWN_TUI_LIST_UNAVAILABLE,
  SPAWN_TUI_LABEL,
  SPAWN_TUI_SPAWNING,
  SPAWN_TUI_TIMEOUT_PREFIX,
  SPAWN_TUI_TIMEOUT_SUFFIX,
  SPAWN_TUI_WAITING,
} from "../ui/copy";
import { DynText } from "../ui/DynText";
import { colors, press, space, type } from "../ui/tokens";

export type SpawnCardProps = {
  client: GatewayClient;
  /** Learned gate (connection lifetime, App-owned): the action cannot fire
   * after the gateway said spawn is off — the disabled state is visible. */
  blocked: boolean;
  /** Learn the gate for the rest of this connection. */
  onBlocked(): void;
  /** Navigate to the discovered session (the conversation view). */
  onOpened(sessionId: string): void;
};

type SpawnStatus =
  | { kind: "idle" }
  | { kind: "busy"; text: string }
  | { kind: "done"; text: string; error: boolean };

/** The chats-home spawn card: a quiet labeled action under the composer —
 * it never competes with Submit (the screen's single strong CTA) and its
 * status line owns the whole flow's feedback inline (no modal hops). */
export function SpawnSessionCard(props: SpawnCardProps) {
  const [status, setStatus] = useState<SpawnStatus>({ kind: "idle" });
  const disabled = props.blocked || status.kind === "busy";

  const spawn = (): void => {
    setStatus({ kind: "busy", text: SPAWN_TUI_SPAWNING });
    void (async () => {
      // Snapshot BEFORE spawning: the discovery needs the pre-spawn set.
      let beforeIds: ReadonlySet<string>;
      try {
        beforeIds = sessionIdsOf(await props.client.listSessions());
      } catch {
        beforeIds = new Set();
      }
      let target: string;
      try {
        const outcome = await props.client.spawnTuiSession();
        target = outcome.tmuxTarget ?? outcome.launcher;
      } catch (error) {
        if (isSpawnGateProblem(error)) {
          props.onBlocked();
          setStatus({ kind: "done", text: SPAWN_TUI_BLOCKED, error: true });
        } else {
          setStatus({
            kind: "done",
            text: `${SPAWN_TUI_FAILED_PREFIX}${describeSpawnProblem(error)}`,
            error: true,
          });
        }
        return;
      }
      setStatus({ kind: "busy", text: SPAWN_TUI_WAITING });
      if (beforeIds.size === 0) {
        // The inventory was unreadable before the spawn — a before/after
        // correlation could open a PRE-EXISTING session by accident, so the
        // honest move is to stop and point at the Sessions list.
        setStatus({ kind: "done", text: SPAWN_TUI_LIST_UNAVAILABLE, error: false });
        return;
      }
      const discovery = await awaitSpawnedSession({
        listSessions: () => props.client.listSessions(),
        beforeIds,
      });
      if (discovery.kind === "found") {
        setStatus({ kind: "idle" });
        props.onOpened(discovery.sessionId);
        return;
      }
      // `target` is display-only per the spawn contract — naming it here is
      // exactly the evidence an operator checks in `tmux ls`.
      setStatus({
        kind: "done",
        text: `${SPAWN_TUI_TIMEOUT_PREFIX}${target}${SPAWN_TUI_TIMEOUT_SUFFIX}`,
        error: false,
      });
    })();
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={[styles.button, disabled && styles.buttonDisabled]}
        onPress={spawn}
        disabled={disabled}
        activeOpacity={press.activeOpacity}
        accessibilityLabel={SPAWN_TUI_LABEL}
      >
        <DynText style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>
          {SPAWN_TUI_LABEL}
        </DynText>
      </TouchableOpacity>
      {status.kind !== "idle" ? (
        <DynText
          style={[styles.status, status.kind === "done" && status.error && styles.statusError]}
        >
          {status.text}
        </DynText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.m },
  button: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 999,
    paddingVertical: space.s,
    paddingHorizontal: space.l,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { ...type.captionStrong, color: colors.inkMute },
  buttonTextDisabled: { color: colors.inkFaint },
  status: { ...type.caption, color: colors.inkMute, marginTop: space.s },
  statusError: { color: colors.danger },
});
