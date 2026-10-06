import { READOUT_STYLE } from "../ui/copy";
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { GatewayClient } from "../gateway-client/client";
import type { RemoteSessionSummary } from "../gateway-client/conversation";
import type { RemoteRunPage, RemoteRunStatus, RemoteRunSummary } from "../gateway-client/wire";
import { sessionTitles, type SessionNamingEvidence } from "./session-title";
import { activeFirst, isActiveRun, isActiveSession } from "../state/activeView";
import { attentionFirst, groupOfRun, groupOfSession, statusMark, type StatusMark } from "../state/session-groups";
import { splitSessions, type SessionNamingIndex } from "../state/sessionsView";
import { relativeTime } from "./time-format";
import { DynText } from "../ui/DynText";
import { SwipeableRow } from "../ui/SwipeableRow";
import { Icon } from "../ui/Icon";
import { type IconRole } from "../ui/glyphs";
import {
  ACTIVE_HEADING,
  EARLIER_HEADING,
  EMPTY_ACTIVE_NOTICE,
  EMPTY_RUNS_NOTICE,
  SHOW_ALL_LABEL,
  TODAY_HEADING,
  UNTITLED_RUN_LABEL,
  UNNAMED_SESSION_LABEL,
  ACTIVE_ONLY_LABEL,
} from "../ui/copy";
import { colors, press, radius, space, type } from "../ui/tokens";

/**
 * Chats list (GUI conversation v1, decision D6; grouped rows in task
 * `main-screen-polish`): the existing runs list is the entry point. The
 * list reads as THREE sections — In progress (non-terminal runs, attention
 * included, plus live sessions; attention leads the section), Today, and
 * Earlier — grouped by the pure fold in state/session-groups.ts from what
 * the Rust-owned projections proved. One unified row anatomy:
 * title + status glyph + relative time on a single line; an entry without
 * an honest name shows the owned empty-state label — a run id or session
 * id never fronts a row (brief S-11). Attention rows keep the warn left
 * edge, so the S-13 action anchor survives inside the section instead of
 * a separate inbox.
 *
 * Naming (operator-approved rule, task `session-title-implementation`):
 * observed sessions are titled by their first user utterance
 * (features/session-title.ts); never-observed sessions have no honest
 * utterance, so they read "Unnamed session" — never a fabricated title.
 *
 * Logout (task `main-screen-polish`): this surface is chrome-free — no
 * header, no destructive control anywhere. Logout lives on the bottom
 * Settings tab (App composes it behind the confirmation alert).
 *
 * Session focus (task `session-focus`): the default view is the ACTIVE
 * work only — in the grouped layout that is the In progress section alone;
 * Today/Earlier render only behind the explicit "Show all sessions"
 * toggle, which appears only when something is actually hidden.
 * Filtering/ordering live in the pure state folds (activeView.ts,
 * session-groups.ts); this component only renders them.
 */

/** Display-only truncation of the opaque run id (never parsed back). */
export function shortRunId(runId: string): string {
  return runId.length <= 18 ? runId : `${runId.slice(0, 18)}…`;
}

/** Non-zero task counts, closed readout vocabulary (§2 system readout):
 * quiet when nothing is pending — zero rows are never spelled out. */
export function countsText(run: { taskCounts: RemoteRunSummary["taskCounts"] }): string {
  const c = run.taskCounts;
  const parts: string[] = [];
  if (c.pending > 0) parts.push(`${c.pending} pending`);
  if (c.running > 0) parts.push(`${c.running} running`);
  if (c.attention > 0) parts.push(`${c.attention} attention`);
  if (c.done > 0) parts.push(`${c.done} done`);
  if (c.failed > 0) parts.push(`${c.failed} failed`);
  if (c.cancelled > 0) parts.push(`${c.cancelled} cancelled`);
  return parts.length > 0 ? parts.join(", ") : "no tasks";
}

/** Closed status → color mapping (§1; anything unknown stays muted).
 * Exported: the run screen's status line reuses the SAME mapping — one
 * status→color table for the app. */
export function runStatusColor(status: RemoteRunStatus): string {
  switch (status) {
    case "running":
    case "planning":
      return colors.ok;
    case "attention":
      return colors.warn;
    case "failed":
      return colors.danger;
    default:
      return colors.inkGhost;
  }
}

/** Mark → icon role (the closed ui/glyphs.ts registry, §1): the view owns
 * the registry lookup because the state fold may not import ui — the fold
 * decides WHICH mark, this table decides WHICH role renders it (the SF
 * Symbol / protected-text choice is ui/Icon's, task `fab-icons`). */
const MARK_ROLE: Record<StatusMark, IconRole> = {
  running: "statusRunning",
  attention: "attention",
  error: "statusError",
  done: "statusDone",
  dot: "statusDot",
};

/** Display model of one row (task `main-screen-polish`): title + status
 * glyph + relative time — one line. The glyph is the state carrier (the
 * closed vocabulary above); the word is gone (C-4: frequent states stay
 * quiet, and the ⚠/✕ marks read alone). */
interface RowModel {
  key: string;
  /** The registered icon role carrying the state (closed vocabulary). */
  glyphRole: IconRole;
  glyphColor: string;
  title: string;
  timeIso: string | null;
  /** Attention rows keep the warn left edge — the S-13 anchor now lives
   * in the row, not in a separate inbox section. */
  edge: boolean;
  onOpen?: () => void;
}

/** The one row component: run rows and session rows share the anatomy,
 * the swipe contract, and the 44pt-class touch floor. */
function ListRow(props: { row: RowModel; peek: boolean }) {
  const { row } = props;
  return (
    // Row actions (task `mobile-ux-patterns`, iOS HIG): a horizontal drag
    // reveals Open — the one verb the contract owns for a row. The FIRST
    // actionable row on the list mounts partially open (peek) so the
    // gesture is discoverable without a coach mark.
    <SwipeableRow onAction={row.onOpen} peek={props.peek}>
      <TouchableOpacity
        style={[styles.row, row.edge && styles.rowEdge, row.onOpen === undefined && styles.rowDisabled]}
        disabled={row.onOpen === undefined}
        onPress={row.onOpen}
        activeOpacity={press.activeOpacity}
      >
        <View style={styles.rowLeading}>
          <Icon role={row.glyphRole} size={type.captionStrong.fontSize} color={row.glyphColor} />
        </View>
        <DynText style={styles.rowTitle} numberOfLines={1}>
          {row.title}
        </DynText>
        {row.timeIso !== null ? (
          <DynText style={styles.rowTime}>{relativeTime(row.timeIso)}</DynText>
        ) : null}
      </TouchableOpacity>
    </SwipeableRow>
  );
}

export function RunsList(props: {
  client: GatewayClient;
  /** App-local naming evidence fold; rows named by the operator-approved
   * rule read their first-utterance/start/source evidence from here. */
  naming?: SessionNamingIndex;
  /** Opens the conversation view of an existing run (omitted: rows are static). */
  onOpenRun?: (runId: string) => void;
  /** Opens the conversation of an uncorrelated session. */
  onOpenSession?: (sessionId: string) => void;
}) {
  const [page, setPage] = useState<RemoteRunPage | null>(null);
  const [sessions, setSessions] = useState<RemoteSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Session focus (task `session-focus`): the default is the active view;
  // the full inventory is opt-in and never persists across mounts.
  const [showAll, setShowAll] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    props.client
      .listRuns(20)
      .then(setPage)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // Session inventory is best-effort (a gateway without the conversation
    // surface simply hides the sessions).
    props.client
      .listSessions()
      .then((list) => setSessions(list.sessions))
      .catch(() => setSessions(null));
  }, [props.client]);

  useEffect(() => {
    reload();
  }, [reload]);

  const runs = activeFirst(page?.runs ?? []);
  const openRun = props.onOpenRun;
  const openSession = props.onOpenSession;
  // The scroll tail clears the home indicator when the content ends above
  // it (same inset handoff the shared Screen applies to scrollable screens).
  const insets = useSafeAreaInsets();
  const { byRunId, uncorrelated } = splitSessions(sessions ?? []);
  // Default view: active work only (non-terminal runs, live sessions);
  // the toggle is the only surface the full inventory appears on.
  const visibleRuns = showAll ? runs : runs.filter(isActiveRun);
  const visibleUncorrelated = showAll ? uncorrelated : uncorrelated.filter(isActiveSession);
  // The toggle exists only while it can change something — nothing hidden,
  // nothing to reveal (§1 quiet state: no controls that do nothing).
  const hiddenCount = runs.length - visibleRuns.length + (uncorrelated.length - visibleUncorrelated.length);
  const toggleVisible = showAll || hiddenCount > 0;
  // Naming rule (operator-approved): only OBSERVED sessions are named by
  // their first utterance; the rest keep the honest label/empty-state
  // fallbacks.
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

  // Grouping fold (state/session-groups.ts, task `main-screen-polish`):
  // rows bucket by what the projections proved. In progress = non-terminal
  // runs (attention INCLUDED — an unanswered question is in-progress work)
  // plus live sessions; the rest read Today/Earlier off their last update
  // (sessions: the naming-evidence start time — the wire carries no session
  // timestamp, and an unprovable recency buckets honestly into Earlier).
  const now = new Date();
  const toRunRow = (run: RemoteRunSummary): RowModel => {
    const session = byRunId.get(run.runId);
    return {
      key: `run:${run.runId}`,
      glyphRole: MARK_ROLE[statusMark(run.status)],
      glyphColor: runStatusColor(run.status),
      title: session?.title ?? UNTITLED_RUN_LABEL,
      timeIso: run.updatedAt,
      edge: run.status === "attention",
      onOpen: openRun !== undefined ? () => openRun(run.runId) : undefined,
    };
  };
  const toSessionRow = (session: RemoteSessionSummary): RowModel => {
    const evidence = naming?.evidence(session.sessionId) ?? null;
    const title =
      (evidence !== null ? namedTitles.get(session.sessionId) : undefined) ??
      session.title ??
      UNNAMED_SESSION_LABEL;
    return {
      key: `session:${session.sessionId}`,
      glyphRole: "statusDot",
      glyphColor: colors.inkGhost,
      title,
      timeIso: evidence?.startedAt ?? null,
      edge: false,
      onOpen: openSession !== undefined ? () => openSession(session.sessionId) : undefined,
    };
  };
  const runGroup = (run: RemoteRunSummary) => groupOfRun(run, now);
  const sessionGroup = (session: RemoteSessionSummary) =>
    groupOfSession(session, naming?.evidence(session.sessionId)?.startedAt ?? null, now);
  const activeRows: RowModel[] = [
    // Attention leads the section (attentionFirst), then recency — the
    // action anchor survives the inbox's removal.
    ...visibleRuns.filter((run) => runGroup(run) === "active").toSorted(attentionFirst).map(toRunRow),
    ...visibleUncorrelated.filter((session) => sessionGroup(session) === "active").map(toSessionRow),
  ];
  const todayRows: RowModel[] = [
    ...visibleRuns.filter((run) => runGroup(run) === "today").map(toRunRow),
    ...visibleUncorrelated.filter((session) => sessionGroup(session) === "today").map(toSessionRow),
  ];
  const earlierRows: RowModel[] = [
    ...visibleRuns.filter((run) => runGroup(run) === "earlier").map(toRunRow),
    ...visibleUncorrelated.filter((session) => sessionGroup(session) === "earlier").map(toSessionRow),
  ];
  // Discoverability peek: exactly ONE row — the first actionable row of
  // the rendered list — mounts with the strip partially open.
  const peekKey =
    activeRows.find((row) => row.onOpen !== undefined)?.key ??
    todayRows.find((row) => row.onOpen !== undefined)?.key ??
    earlierRows.find((row) => row.onOpen !== undefined)?.key;

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
      {/* The In progress heading doubles as the focus-toggle row: the label
       * stays even when the section is empty, so the toggle always has a
       * stable home (§2 readout label; no chrome above this — the list is
       * the screen, task `main-screen-polish`). */}
      <View style={styles.headingRow}>
        <DynText style={styles.sectionLabel}>{ACTIVE_HEADING}</DynText>
        {toggleVisible ? (
          <TouchableOpacity
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setShowAll(!showAll)}
            activeOpacity={press.activeOpacity}
          >
            <DynText style={styles.toggleLabel}>
              {showAll ? ACTIVE_ONLY_LABEL : SHOW_ALL_LABEL}
            </DynText>
          </TouchableOpacity>
        ) : null}
      </View>
      {error !== null ? <DynText style={styles.error}>runs list: {error}</DynText> : null}
      {error === null && !loading && runs.length === 0 && uncorrelated.length === 0 ? (
        <DynText style={styles.empty}>{EMPTY_RUNS_NOTICE}</DynText>
      ) : null}
      {error === null &&
      !loading &&
      runs.length + uncorrelated.length > 0 &&
      activeRows.length === 0 ? (
        <DynText style={styles.empty}>{EMPTY_ACTIVE_NOTICE}</DynText>
      ) : null}
      <View style={styles.rows}>
        {activeRows.map((row) => (
          <ListRow key={row.key} row={row} peek={row.key === peekKey} />
        ))}
      </View>

      {/* Today / Earlier exist only behind the toggle (session-focus) and
       * only while non-empty — a labeled empty section is noise. */}
      {showAll && todayRows.length > 0 ? (
        <View style={styles.groupSection}>
          <DynText style={styles.sectionLabel}>{TODAY_HEADING}</DynText>
          <View style={styles.rows}>
            {todayRows.map((row) => (
              <ListRow key={row.key} row={row} peek={row.key === peekKey} />
            ))}
          </View>
        </View>
      ) : null}
      {showAll && earlierRows.length > 0 ? (
        <View style={styles.groupSection}>
          <DynText style={styles.sectionLabel}>{EARLIER_HEADING}</DynText>
          <View style={styles.rows}>
            {earlierRows.map((row) => (
              <ListRow key={row.key} row={row} peek={row.key === peekKey} />
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: space.l },
  // §2 system-readout section label: caption tier, uppercase, positive
  // tracking — hierarchy from weight + tracking, no color emphasis.
  sectionLabel: {
    ...type.captionStrong,
    color: colors.inkFaint,
    textTransform: "uppercase",
    ...READOUT_STYLE,
  },
  // Heading row carries the label + the session-focus toggle on one line.
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.m,
  },
  // Quiet caption action — same readout tier as the meta text, no fill,
  // no border: hierarchy from weight alone (§1).
  toggleLabel: { ...type.captionStrong, color: colors.inkMute },
  rows: { gap: space.s },
  groupSection: { marginTop: space.xl },
  row: {
    backgroundColor: colors.surface,
    // Edge rule (decision 2026-xx-minimal-design-spec S5): the hairline
    // border carries the edge — no resting shadow on the near-black bg.
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    // Row anatomy (task `main-screen-polish`): glyph · title · time on
    // ONE line — nothing else survives the simplification.
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    paddingVertical: space.m,
    paddingHorizontal: space.l,
  },
  // Attention edge (S-13): the warn strip marks the rows that ask for
  // the operator; every other row stays unmarked.
  rowEdge: { borderLeftWidth: 3, borderLeftColor: colors.warn },
  rowLeading: { flexShrink: 0 },
  rowTitle: { ...type.bodyStrong, color: colors.ink, flexShrink: 1 },
  rowTime: { ...type.caption, color: colors.inkMute, flexShrink: 0 },
  error: { ...type.caption, color: colors.danger, marginBottom: space.s },
  empty: { ...type.body, color: colors.inkMute },
  // Visibility contract: a control that cannot fire reads as disabled —
  // static rows (no open handler) dim like the disabled refresh label.
  rowDisabled: { opacity: 0.5 },
});
