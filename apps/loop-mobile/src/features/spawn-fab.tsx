/**
 * Remote spawn FAB (task `fab-icons`, superseding the chats-home spawn
 * card of task `spawn-app-ui` — decision 2026-xx-session-spawn §D-D): the
 * spawn entry is now a "+" floating action button anchored
 * bottom-right above the tab bar (canon v3 §3 플로팅 액션 버튼 — a
 * SECONDARY-tier action: surface fill + hairline + float elevation; it
 * never competes with Submit, the screen's single strong CTA).
 *
 * The spawn flow's state contract is unchanged: POST /v1/sessions/spawn →
 * auto-open the discovered session in the conversation view. Thin state
 * wiring only — every unit-testable piece (discovery polling, problem
 * formatting, gate classification) lives in the react-free
 * `features/session-spawn.ts`. The busy → waiting → problem states stay
 * visible in the status pill directly ABOVE the button (생성 중 상태 유지):
 * the flow's feedback stays inline, no modal hops.
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
import { Icon } from "../ui/Icon";
import { DynText } from "../ui/DynText";
import { colors, elevation, press, radius, space, type, COLUMN_GUTTER } from "../ui/tokens";

export type SpawnFabProps = {
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

/** The chats-home spawn FAB: a 56pt circle (44pt touch floor exceeded)
 * floating bottom-right — the viewport's ONE floating emphasis. While
 * spawning, the "+" gives way to the busy mark; the status pill above the
 * button carries spawning/waiting/problem copy until it resolves. */
export function SpawnFab(props: SpawnFabProps) {
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
    // box-none: the host spans a strip above the button; taps on empty
    // areas fall through to the list underneath.
    <View pointerEvents="box-none" style={styles.host}>
      {status.kind !== "idle" ? (
        // Status pill (canon v3): the one floating companion of the FAB —
        // detached chrome like the button itself, so the whole flow's
        // feedback stays anchored to the tap point (no modal hops).
        <View style={styles.statusPill}>
          <DynText
            style={[styles.statusText, status.kind === "done" && status.error && styles.statusError]}
          >
            {status.text}
          </DynText>
        </View>
      ) : null}
      <TouchableOpacity
        style={[styles.fab, disabled && styles.fabDisabled]}
        onPress={spawn}
        disabled={disabled}
        activeOpacity={press.activeOpacity}
        accessibilityLabel={SPAWN_TUI_LABEL}
        accessibilityRole="button"
      >
        {/* Busy replaces the "+" while the spawn is in flight; problems
         * return the "+" so the action stays retryable (except when the
         * learned gate blocks it). */}
        <Icon
          role={status.kind === "busy" ? "busy" : "spawn"}
          size={type.title.fontSize}
          weight="medium"
          color={disabled ? colors.inkFaint : colors.inkMute}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // Anchored bottom-right, above the tab bar; the right offset clears the
  // landscape inset at the screen level (the host is absolute).
  host: {
    position: "absolute",
    right: COLUMN_GUTTER,
    bottom: space.l,
    alignItems: "flex-end",
    gap: space.s,
  },
  // Circular secondary-tier button: surface fill + hairline + float
  // elevation (detached chrome over the scrolling list). 56pt square with
  // a 50% radius — the pill radius's registered circular use (canon §3),
  // and the 44pt touch floor is exceeded.
  fab: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...elevation.float,
  },
  fabDisabled: { opacity: 0.5 },
  statusPill: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    maxWidth: 264,
    ...elevation.float,
  },
  statusText: { ...type.caption, color: colors.inkMute },
  statusError: { color: colors.danger },
});
