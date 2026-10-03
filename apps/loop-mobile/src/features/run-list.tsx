import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { GatewayClient } from "../gateway-client/client";
import type { RemoteSessionSummary } from "../gateway-client/conversation";
import type { RemoteRunPage, RemoteRunStatus, RemoteRunSummary } from "../gateway-client/wire";
import { sessionSubtitle, sessionTitles } from "./session-title";
import {
  splitSessions,
  type SessionNamingEvidence,
  type SessionNamingIndex,
} from "../state/sessionsView";
import { relativeTime } from "./time-format";
import { DynText } from "../ui/DynText";
import {
  CHATS_HEADING,
  EMPTY_RUNS_NOTICE,
  REFRESH_LABEL,
  REFRESHING_LABEL,
  SESSIONS_HEADING,
} from "../ui/copy";
import { glyph } from "../ui/glyphs";
import { colors, press, radius, space, type } from "../ui/tokens";

/**
 * Chats list (GUI conversation v1, decision D6; row redesign in task
 * `ui-codex-redesign`): the existing runs list is the entry point; run rows
 * carry their correlated session badge, and observed sessions WITHOUT a run
 * correlation get their own "Sessions" section with an honest `run_id = null`
 * mark. Rows open the conversation view; the list is fetched on mount and
 * refetches only on explicit refresh (no background polling surface in v1).
 *
 * Row anatomy (Codex-like): title (session title or compact run id) on the
 * first line with a status dot badge on the right, recent-activity meta on
 * the second line. The status dot is the closed status triad of
 * ui-ux-guidance §1 — one glyph, colored text only, never a surface fill.
 *
 * SESSIONS naming (operator-approved rule, task
 * `session-title-implementation`): a session the app has observed is titled
 * by its first user utterance (one line, 48-char ellipsis; `새 세션` + start
 * time without one; repeated titles carry a start stamp — see
 * features/session-title.ts), and its subtitle is the Korean relative time
 * plus a source badge (TUI/앱). Sessions the app never observed have no
 * honest utterance to show: the adapter label stands in, else the compact
 * id — never a fabricated "새 세션". Deterministic: the evidence fold is
 * app-local (state/sessionsView.ts), no model calls.
 *
 * Logout (task `header-statusbar-redesign`): the destructive action lives
 * in the chats header's right corner — NOT here. The bottom row this list
 * used to render rode the home-indicator corner, where the rounded screen
 * edges clip it; the list is high-frequency surface and carries no
 * destructive control at all now (App gates the handler behind the header
 * confirmation alert).
 */

/** Display-only truncation of the opaque run id (never parsed back). */
function shortRunId(runId: string): string {
  return runId.length <= 18 ? runId : `${runId.slice(0, 18)}…`;
}

function countsText(run: RemoteRunSummary): string {
  const c = run.taskCounts;
  const parts: string[] = [];
  if (c.pending > 0) parts.push(`${c.pending} pending`);
  if (c.running > 0) parts.push(`${c.running} running`);
  if (c.done > 0) parts.push(`${c.done} done`);
  if (c.failed > 0) parts.push(`${c.failed} failed`);
  return parts.length > 0 ? parts.join(", ") : "no tasks";
}

function sessionBadge(session: RemoteSessionSummary | undefined): string {
  if (session === undefined) return "";
  return ` · session ${session.state}`;
}

/** Closed status → dot color mapping (§1; anything unknown stays muted). */
function runStatusColor(status: RemoteRunStatus): string {
  switch (status) {
    case "running":
    case "planning":
      return colors.ok;
    case "attention":
      return colors.warn;
    case "failed":
      return colors.danger;
    default:
      return colors.inkFaint;
  }
}

function RunRow(props: {
  run: RemoteRunSummary;
  session: RemoteSessionSummary | undefined;
  onOpen?: () => void;
}) {
  const { run, session } = props;
  return (
    <TouchableOpacity
      style={[styles.row, props.onOpen === undefined && styles.rowDisabled]}
      disabled={props.onOpen === undefined}
      onPress={props.onOpen}
      activeOpacity={press.activeOpacity}
    >
      <View style={styles.rowTop}>
        <DynText style={styles.rowTitle} numberOfLines={1}>
          {session?.title ?? shortRunId(run.runId)}
        </DynText>
        <View style={styles.badge}>
          <DynText style={[styles.badgeDot, { color: runStatusColor(run.status) }]}>
            {glyph.statusDot}
          </DynText>
          <DynText style={[styles.badgeText, { color: runStatusColor(run.status) }]}>
            {run.status}
          </DynText>
        </View>
      </View>
      <DynText style={styles.rowMeta} numberOfLines={1}>
        {relativeTime(run.updatedAt)} · {countsText(run)}
        {run.terminal ? " · terminal" : ""}
        {sessionBadge(session)}
      </DynText>
    </TouchableOpacity>
  );
}

export function RunsList(props: {
  client: GatewayClient;
  /** App-local naming evidence fold; rows named by the operator-approved
   * rule read their first-utterance/start/source evidence from here. */
  naming?: SessionNamingIndex;
  /** Opens the conversation view of an existing run (omitted: rows are static). */
  onOpenRun?: (runId: string) => void;
  /** Opens the conversation view of an uncorrelated session. */
  onOpenSession?: (sessionId: string) => void;
}) {
  const [page, setPage] = useState<RemoteRunPage | null>(null);
  const [sessions, setSessions] = useState<RemoteSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    props.client
      .listRuns(20)
      .then(setPage)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // Session inventory is best-effort (a gateway without the conversation
    // surface simply hides the badges and the sessions section).
    props.client
      .listSessions()
      .then((list) => setSessions(list.sessions))
      .catch(() => setSessions(null));
  }, [props.client]);

  useEffect(() => {
    reload();
  }, [reload]);

  const runs = page?.runs ?? [];
  const openRun = props.onOpenRun;
  const openSession = props.onOpenSession;
  // The scroll tail clears the home indicator when the content ends above
  // it (same inset handoff the shared Screen applies to scrollable screens).
  const insets = useSafeAreaInsets();
  const { byRunId, uncorrelated } = splitSessions(sessions ?? []);
  // Naming rule (operator-approved): only OBSERVED sessions are named by
  // their first utterance; the rest keep the honest label/id fallbacks.
  const naming = props.naming;
  const namedTitles = sessionTitles(
    uncorrelated
      .map((session) => ({
        sessionId: session.sessionId,
        evidence: naming?.evidence(session.sessionId) ?? null,
      }))
      .filter(
        (row): row is { sessionId: string; evidence: SessionNamingEvidence } =>
          row.evidence !== null,
      ),
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + space.l }]}
      // Pull-to-refresh (C13): wired to the existing loading state and the
      // existing reload callback — no new loading state was introduced.
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.inkMute} />
      }
    >
      <View style={styles.headerRow}>
        <DynText style={styles.sectionLabel}>{CHATS_HEADING}</DynText>
        {/* Touch target (C14): the label alone is ~17pt tall, so the slop
         * lifts the tap area to ~45pt (44pt floor, ui-ux-guidance §8); the
         * disabled refresh dims (visibility contract: a disabled control
         * must read as disabled). */}
        <TouchableOpacity
          onPress={reload}
          disabled={loading}
          hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
          activeOpacity={press.activeOpacity}
        >
          <DynText style={[styles.refresh, loading && styles.refreshDisabled]}>
            {loading ? REFRESHING_LABEL : REFRESH_LABEL}
          </DynText>
        </TouchableOpacity>
      </View>
      {error !== null ? <DynText style={styles.error}>runs list: {error}</DynText> : null}
      {error === null && !loading && runs.length === 0 ? (
        <DynText style={styles.empty}>{EMPTY_RUNS_NOTICE}</DynText>
      ) : null}
      <View style={styles.rows}>
        {runs.map((run: RemoteRunSummary) => (
          <RunRow
            key={run.runId}
            run={run}
            session={byRunId.get(run.runId)}
            onOpen={openRun !== undefined ? () => openRun(run.runId) : undefined}
          />
        ))}
      </View>

      {uncorrelated.length > 0 ? (
        <View style={styles.sessionsSection}>
          <DynText style={styles.sectionLabel}>{SESSIONS_HEADING}</DynText>
          <View style={styles.rows}>
            {uncorrelated.map((session) => {
              const evidence = naming?.evidence(session.sessionId) ?? null;
              const title =
                (evidence !== null ? namedTitles.get(session.sessionId) : undefined) ??
                session.title ??
                shortRunId(session.sessionId);
              return (
                <TouchableOpacity
                  key={session.sessionId}
                  style={[styles.row, openSession === undefined && styles.rowDisabled]}
                  disabled={openSession === undefined}
                  onPress={
                    openSession !== undefined ? () => openSession(session.sessionId) : undefined
                  }
                  activeOpacity={press.activeOpacity}
                >
                  <View style={styles.rowTop}>
                    <DynText style={styles.rowTitle} numberOfLines={1}>
                      {title}
                    </DynText>
                    <View style={styles.badge}>
                      <DynText style={[styles.badgeDot, { color: colors.inkFaint }]}>
                        {glyph.statusDot}
                      </DynText>
                      <DynText style={[styles.badgeText, { color: colors.inkFaint }]}>
                        {session.state}
                      </DynText>
                    </View>
                  </View>
                  <DynText style={styles.rowMeta} numberOfLines={1}>
                    {sessionSubtitle(evidence, session.lane)}
                  </DynText>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: space.l },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.m,
  },
  // §2 system-readout section label: caption tier, uppercase, positive
  // tracking — hierarchy from weight + tracking, no color emphasis.
  sectionLabel: {
    ...type.captionStrong,
    color: colors.inkFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  refresh: { ...type.captionStrong, color: colors.inkMute },
  refreshDisabled: { opacity: 0.5 },
  rows: { gap: space.s },
  row: {
    backgroundColor: colors.surface,
    // Edge rule (decision 2026-xx-minimal-design-spec S5): the hairline
    // border carries the edge — no resting shadow on the near-black bg.
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    paddingVertical: space.m,
    paddingHorizontal: space.l,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.m,
  },
  rowTitle: { ...type.bodyStrong, color: colors.ink, flexShrink: 1 },
  badge: { flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 },
  badgeDot: { ...type.glyph },
  badgeText: { ...type.captionStrong },
  rowMeta: { ...type.caption, color: colors.inkMute, marginTop: space.xxs },
  error: { ...type.caption, color: colors.danger, marginBottom: space.s },
  empty: { ...type.body, color: colors.inkMute },
  sessionsSection: { marginTop: space.xl },
  // Visibility contract: a control that cannot fire reads as disabled —
  // static rows (no open handler) dim like the disabled refresh label.
  rowDisabled: { opacity: 0.5 },
});
