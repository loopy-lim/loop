import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";

import type { GatewayClient } from "../gateway-client/client";
import type { RemoteSessionSummary } from "../gateway-client/conversation";
import type { SubmitPromptAccepted } from "../gateway-client/wire";
import type { SessionNamingIndex } from "../state/sessionsView";
import { endedWindow, homeSections, sessionHomeRows } from "../state/session-home";
import { sessionTitles } from "../features/session-title";
import { SpawnFab } from "../features/spawn-fab";
import { RunsList } from "../features/run-list";
import { DynText } from "../ui/DynText";
import {
  ENDED_SESSIONS_COLLAPSE_LABEL,
  ENDED_SESSIONS_EXPAND_PREFIX,
  ENDED_SESSIONS_EXPAND_SUFFIX,
  ENDED_SESSIONS_HEADING,
  HISTORY_VIEW_LABEL,
  LIVE_SESSIONS_HEADING,
  NO_OPEN_SESSIONS_NOTICE,
  REMOTE_PROMPT_PLACEHOLDER,
  REMOTE_SUBMIT_LABEL,
  REMOTE_SUBMIT_NOTICE,
  SESSION_ROW_ENDED_LABEL,
  SESSION_ROW_LIVE_LABEL,
  SESSION_ROW_QUIET_LABEL,
  SESSIONS_LIST_ERROR_NOTICE,
  SESSIONS_VIEW_LABEL,
  SUBMITTING_LABEL,
  SUBMIT_FAILED_NOTICE,
  UNOBSERVED_SESSIONS_HEADING,
} from "../ui/copy";
import { colors, press, radius, space, type } from "../ui/tokens";

/** Session inventory is the home; runs and remote submission live behind an explicit history action. */
export function SubmitScreen(props: {
  client: GatewayClient;
  onAccepted: (accepted: SubmitPromptAccepted) => void;
  initialPrompt?: string;
  autoSubmit?: boolean;
  submitDelayMs?: number;
  onOpenRun?: (runId: string) => void;
  onOpenSession?: (sessionId: string) => void;
  naming?: SessionNamingIndex;
  spawnBlocked?: boolean;
  onSpawnBlocked?: () => void;
}) {
  const [sessions, setSessions] = useState<RemoteSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [history, setHistory] = useState(false);
  const [prompt, setPrompt] = useState(props.initialPrompt ?? "");
  const [busy, setBusy] = useState(false);
  // Ended-list expand (home-cleanup): component-local, in place — the
  // full history never costs a navigation.
  const [endedExpanded, setEndedExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSubmitFired = useRef(false);

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    props.client.listSessions()
      .then((result) => setSessions(result.sessions))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [props.client]);
  useEffect(() => { reload(); }, [reload]);

  const submit = (text: string) => {
    if (busy || text.trim().length === 0) return;
    setBusy(true);
    setError(null);
    props.client.submitPrompt(text, undefined)
      .then(props.onAccepted)
      .catch(() => setError(SUBMIT_FAILED_NOTICE))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    if (autoSubmitFired.current || props.autoSubmit !== true || !props.initialPrompt?.trim()) return;
    autoSubmitFired.current = true;
    const timer = setTimeout(() => submit(props.initialPrompt!), props.submitDelayMs ?? 8000);
    return () => clearTimeout(timer);
    // Showcase launch options are immutable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titles = sessionTitles(sessions.flatMap((session) => {
    const evidence = props.naming?.evidence(session.sessionId);
    return evidence ? [{ sessionId: session.sessionId, evidence }] : [];
  }));
  const rows = sessionHomeRows(sessions, (id) => titles.get(id));
  const sections = homeSections(rows);
  const endedWindowView = endedWindow(sections.ended);
  const stateLabel = (state: RemoteSessionSummary["state"]) =>
    state === "live" ? SESSION_ROW_LIVE_LABEL : state === "unobserved" ? SESSION_ROW_QUIET_LABEL : SESSION_ROW_ENDED_LABEL;
  const renderRows = (items: typeof rows) => items.map((row) => (
    <TouchableOpacity key={row.sessionId} style={styles.row} onPress={() => props.onOpenSession?.(row.sessionId)} activeOpacity={press.activeOpacity}>
      <DynText style={styles.title} numberOfLines={1}>{row.title}</DynText>
      <DynText style={styles.state}>{stateLabel(row.state)}</DynText>
    </TouchableOpacity>
  ));

  return (
    <View style={styles.root}>
      <TouchableOpacity onPress={() => setHistory(!history)} style={styles.historyButton} activeOpacity={press.activeOpacity}>
        <DynText style={styles.link}>{history ? SESSIONS_VIEW_LABEL : HISTORY_VIEW_LABEL}</DynText>
      </TouchableOpacity>
      {history ? (
        <View style={styles.list}>
          <RunsList client={props.client} naming={props.naming} onOpenRun={props.onOpenRun} onOpenSession={props.onOpenSession} />
          <View style={styles.remoteSubmit}>
            <DynText style={styles.note}>{REMOTE_SUBMIT_NOTICE}</DynText>
            <TextInput style={styles.input} value={prompt} onChangeText={setPrompt} placeholder={REMOTE_PROMPT_PLACEHOLDER} placeholderTextColor={colors.inkFaint} multiline />
            {error ? <DynText style={styles.error}>{error}</DynText> : null}
            <TouchableOpacity onPress={() => submit(prompt)} disabled={busy || !prompt.trim()} style={styles.action} activeOpacity={press.activeOpacity}>
              <DynText style={styles.link}>{busy ? SUBMITTING_LABEL : REMOTE_SUBMIT_LABEL}</DynText>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView style={styles.list} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
          {loadError ? <TouchableOpacity onPress={reload} activeOpacity={press.activeOpacity}><DynText style={styles.error}>{SESSIONS_LIST_ERROR_NOTICE}</DynText></TouchableOpacity> : null}
          <DynText style={styles.heading}>{LIVE_SESSIONS_HEADING}</DynText>
          {!loading && !loadError && sections.live.length === 0 ? <DynText style={styles.note}>{NO_OPEN_SESSIONS_NOTICE}</DynText> : null}
          {renderRows(sections.live)}
          {sections.ended.length > 0 ? <DynText style={styles.heading}>{ENDED_SESSIONS_HEADING}</DynText> : null}
          {renderRows(endedExpanded ? sections.ended : endedWindowView.visible)}
          {endedExpanded || endedWindowView.hiddenCount > 0 ? (
            <TouchableOpacity onPress={() => setEndedExpanded(!endedExpanded)} style={styles.expandButton} activeOpacity={press.activeOpacity}>
              <DynText style={styles.link}>
                {endedExpanded ? ENDED_SESSIONS_COLLAPSE_LABEL : ENDED_SESSIONS_EXPAND_PREFIX + endedWindowView.hiddenCount + ENDED_SESSIONS_EXPAND_SUFFIX}
              </DynText>
            </TouchableOpacity>
          ) : null}
          {sections.unobserved.length > 0 ? <DynText style={styles.heading}>{UNOBSERVED_SESSIONS_HEADING}</DynText> : null}
          {renderRows(sections.unobserved)}
        </ScrollView>
      )}
      <SpawnFab client={props.client} blocked={props.spawnBlocked ?? false} onBlocked={() => props.onSpawnBlocked?.()} onOpened={(id) => props.onOpenSession?.(id)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { flex: 1 },
  historyButton: { alignSelf: "flex-end", padding: space.m },
  link: { ...type.bodyStrong, color: colors.ink },
  heading: { ...type.captionStrong, color: colors.inkMute, marginVertical: space.m },
  note: { ...type.body, color: colors.inkMute },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.m, padding: space.l, marginBottom: space.s, minHeight: 44 },
  title: { ...type.bodyStrong, color: colors.ink, flexShrink: 1 },
  state: { ...type.caption, color: colors.inkMute },
  error: { ...type.caption, color: colors.danger, marginVertical: space.s },
  remoteSubmit: { padding: space.m, borderTopWidth: 1, borderColor: colors.hairline },
  input: { ...type.body, color: colors.ink, minHeight: 44 },
  action: { padding: space.m, alignSelf: "flex-end" },
  expandButton: { padding: space.m, alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
});
