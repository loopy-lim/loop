import { useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, TouchableOpacity, View } from "react-native";

import type { GatewayClient } from "../gateway-client/client";
import { countsText, runStatusColor, runStatusWord, shortRunId } from "../features/run-list";
import { relativeTime } from "../features/time-format";
import { RunProjection, type OutputEntry, type RunProjectionState } from "../state/runProjection";
import type { RemotePaneSummary } from "../gateway-client/wire";
import { DynText } from "../ui/DynText";
import { Icon } from "../ui/Icon";
import { glyph, type IconRole } from "../ui/glyphs";
import {
  ATTENTION_RESPONSE_PLACEHOLDER,
  RUN_ENDED_TITLE,
  RUN_FAILED_TITLE,
  RUN_FINISHED_TITLE,
  RUN_SUMMARY_HINT,
  RUN_TITLE,
  SUBMITTING_LABEL,
  SUBMIT_RESPONSE_LABEL,
  TERMINALS_HEADING,
  WAITING_FOR_PROJECTION_NOTICE,
  READOUT_STYLE,
  STREAM_DISCONNECTED_NOTICE,
  RUN_STALE_NOTICE,
  RESOLVE_FAILED_NOTICE,
  LIFECYCLE_ONLY_SUFFIX,
} from "../ui/copy";
import { colors, press, radius, space, type } from "../ui/tokens";

/**
 * Visibility contract (task `visibility-touch-ergonomics`): every text on
 * this screen rides the ui/tokens ink tiers — raw RN Text defaults to the
 * OS text color (near-black), which lands on the near-black background at
 * ~1:1 contrast and disappears. Pane rows are quiet tappable pills (same
 * pattern as the conversation PaneList), not stock Buttons (whose iOS tint
 * is off-palette), with the registered press opacity and a 44pt-class
 * touch target.
 */

/**
 * Screen 3 — live run status and bounded output (ADR §5.3).
 *
 * Subscribes to `GET /v1/runs/{runId}/events`, replaces the authoritative
 * `RemoteRun` on status/reset/terminal, dedupes output by `activityId`, and
 * stops observing after the terminal event. Reconnects after non-terminal
 * disconnects carry the last opaque cursor (Last-Event-ID). The client falls
 * back to 2s foreground polling of getRun only when SSE fails repeatedly;
 * polling is not implemented in this screen because the gateway contract test
 * covers the stream path and polling is an explicit degradation.
 */
export function RunScreen(props: {
  client: GatewayClient;
  runId: string;
  onOpenPane?: (paneId: string) => void;
  /** Optional foreground refresh for the pane inventory (split-viewer
   * settings §B: the app refresh-interval setting lands here). Undefined
   * keeps the v1 fetch-once behavior. */
  paneRefreshMs?: number;
  /** Showcase/demo: open this pane once the inventory loads (after delayMs). */
  autoOpenPaneId?: string;
  /** Showcase/demo: delay before the auto pane open (default 8000ms). */
  autoOpenPaneDelayMs?: number;
}) {
  const [state, setState] = useState<RunProjectionState | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [panes, setPanes] = useState<RemotePaneSummary[] | null>(null);
  const [resolution, setResolution] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedAttentionId, setResolvedAttentionId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const projectionRef = useRef<RunProjection | null>(null);
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    const projection = new RunProjection(props.runId);
    projectionRef.current = projection;

    const publish = () => setState(projection.snapshot());

    props.client
      .observeRun(
        props.runId,
        (event) => {
          switch (event.kind) {
            case "status":
              projection.applyStatus(event.frame);
              break;
            case "output":
              projection.applyOutput(event.frame);
              break;
            case "reset":
              projection.applyReset(event.frame);
              break;
            case "terminal":
              projection.applyTerminal(event.frame);
              break;
          }
          publish();
        },
        { signal: controller.signal, onRetryableError: (e) => setStreamError(String(e)) },
      )
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setStreamError(e instanceof Error ? e.message : String(e));
        }
      });

    return () => controller.abort();
  }, [props.client, props.runId]);

  // Terminal mirror v1: best-effort pane inventory for the run's terminals.
  // Failure (gateway without the pane surface) simply hides the section.
  useEffect(() => {
    const controller = new AbortController();
    props.client
      .listPanes()
      .then((page) => {
        if (!controller.signal.aborted) setPanes(page.panes);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [props.client]);

  // Settings-driven foreground refresh of the inventory (optional): the
  // same best-effort fetch, on the configured interval. Never runs when
  // no interval is configured (v1 default fetch-once).
  useEffect(() => {
    const intervalMs = props.paneRefreshMs;
    if (intervalMs === undefined) return;
    const timer = setInterval(() => {
      props.client
        .listPanes()
        .then((page) => {
          if (aliveRef.current) setPanes(page.panes);
        })
        .catch(() => undefined);
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.paneRefreshMs]);

  // Showcase/demo: fire the exact same open-handler a human tap would, once,
  // after the delay — only if the requested pane is in the loaded inventory.
  // The inventory is best-effort (a restarting gateway or a cold pane mirror
  // can serve an empty list), so poll until the pane shows up, bounded.
  const autoOpenFired = useRef(false);
  const autoOpenTries = useRef(0);
  useEffect(() => {
    if (autoOpenFired.current) return;
    const paneId = props.autoOpenPaneId;
    if (paneId === undefined) return;
    if (panes !== null && panes.some((pane) => pane.paneId === paneId)) {
      autoOpenFired.current = true;
      const timer = setTimeout(() => props.onOpenPane?.(paneId), props.autoOpenPaneDelayMs ?? 8000);
      return () => clearTimeout(timer);
    }
    if (autoOpenTries.current >= 10) return;
    autoOpenTries.current += 1;
    const timer = setTimeout(() => {
      props.client
        .listPanes()
        .then((page) => {
          if (aliveRef.current) setPanes(page.panes);
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearTimeout(timer);
    // Mirrors a human tapping the pane button once the inventory shows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes]);

  const run = state?.run ?? null;
  const outputs = state?.outputs ?? [];
  const resolutionEmpty = resolution.trim().length === 0;
  const resolveDisabled = resolving || resolutionEmpty;
  // Focus ring (canon §4): the response input's border rides the accent
  // while focused.
  const [inputFocused, setInputFocused] = useState(false);
  // Completion summary tone (S-13): the closed status triad decides glyph
  // and color; unknown terminal states stay muted.
  const summaryTone = !run?.terminal
    ? null
    : run.status === "completed"
      ? { role: "statusDone" as IconRole, color: colors.ok, title: RUN_FINISHED_TITLE }
      : run.status === "failed"
        ? { role: "statusError" as IconRole, color: colors.danger, title: RUN_FAILED_TITLE }
        : { role: "statusDot" as IconRole, color: colors.inkMute, title: RUN_ENDED_TITLE };
  const statusColor = run !== null ? runStatusColor(run.status) : colors.inkGhost;

  // Plain content column: App.tsx wraps this in the shared centered Screen.
  return (
    <View>
      {streamError !== null ? (
        // R-5: the stream failure is a one-line owned summary — the raw
        // transport message never reaches the surface (C10).
        <DynText style={styles.streamError}>{STREAM_DISCONNECTED_NOTICE}</DynText>
      ) : null}
      {run === null ? (
        <DynText style={styles.waiting}>{WAITING_FOR_PROJECTION_NOTICE}</DynText>
      ) : (
        <View>
          {/* S-11: the human word is the heading (display tier); the run id
           * rides a quiet caption — an internal identifier never fronts a
           * screen (canon §3 위계). */}
          <DynText style={styles.heading}>{RUN_TITLE}</DynText>
          <View style={styles.statusRow}>
            <Icon role="statusDot" size={type.captionStrong.fontSize} color={statusColor} />
            <DynText style={[styles.statusWord, { color: statusColor }]}>{runStatusWord(run.status)}</DynText>
            <DynText style={styles.statusCounts}>{countsText(run)}</DynText>
          </View>
          <DynText style={styles.runId} numberOfLines={1}>
            {shortRunId(run.runId)}
          </DynText>
          {run.attention !== null && run.attention.attentionId !== resolvedAttentionId ? (
            // Attention panel (S-12): warn edge + glyph — the QUESTION is
            // ink; color marks the state, it does not carry the text (canon
            // §2-3 색은 마지막 수단).
            <View style={styles.attentionCard}>
              <View style={styles.attentionRow}>
                <Icon role="attention" size={type.captionStrong.fontSize} color={colors.warn} />
                <DynText style={styles.attentionMessage} numberOfLines={0}>
                  {run.attention.message}
                </DynText>
              </View>
              <TextInput
                accessibilityLabel="Attention response"
                value={resolution}
                onChangeText={setResolution}
                placeholder={ATTENTION_RESPONSE_PLACEHOLDER}
                placeholderTextColor={colors.inkFaint}
                style={[styles.resolutionInput, inputFocused && styles.inputFocused]}
                multiline
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
              />
              <TouchableOpacity
                accessibilityRole="button"
                disabled={resolveDisabled}
                style={[styles.resolveButton, resolveDisabled && styles.resolveDisabled]}
                activeOpacity={press.activeOpacity}
                onPress={() => {
                  const attention = run.attention;
                  if (attention === null) return;
                  setResolving(true);
                  setResolveError(null);
                  void props.client.resolveAttention(run.runId, attention.attentionId, resolution)
                    .then(() => setResolvedAttentionId(attention.attentionId))
                    .catch((error: unknown) => setResolveError(error instanceof Error ? error.message : String(error)))
                    .finally(() => setResolving(false));
                }}
              >
                <DynText
                  style={[
                    styles.resolveButtonText,
                    resolveDisabled && styles.resolveTextDisabled,
                  ]}
                >
                  {resolving ? SUBMITTING_LABEL : SUBMIT_RESPONSE_LABEL}
                </DynText>
              </TouchableOpacity>
              {resolveError !== null ? (
                <DynText style={styles.resolveError}>{RESOLVE_FAILED_NOTICE}</DynText>
              ) : null}
            </View>
          ) : null}
          {/* Completion summary card (S-13): a terminal run is never a
           * blank screen — status, counts, and the next action. */}
          {summaryTone !== null ? (
            <View style={styles.summaryCard}>
              <Icon
                role={summaryTone.role}
                size={type.title.fontSize}
                color={summaryTone.color}
              />
              <View style={styles.summaryMain}>
                <DynText style={styles.summaryTitle}>{summaryTone.title}</DynText>
                <DynText style={styles.summaryMeta} numberOfLines={1}>
                  {countsText(run)} · {relativeTime(run.updatedAt)}
                </DynText>
                <DynText style={styles.summaryHint}>{RUN_SUMMARY_HINT}</DynText>
              </View>
            </View>
          ) : null}
          {state?.stale ? (
            <DynText style={styles.stale}>{RUN_STALE_NOTICE}</DynText>
          ) : null}
          {outputs.length > 0 ? (
            <View style={styles.outputs}>
              {outputs.map((entry: OutputEntry) => (
                <DynText key={entry.activityId} numberOfLines={0} style={styles.outputLine}>
                  [{entry.taskId}] {entry.text}
                </DynText>
              ))}
            </View>
          ) : null}
          {panes !== null && panes.length > 0 && props.onOpenPane !== undefined ? (
            <View style={styles.paneSection}>
              <DynText style={styles.paneHeading}>{TERMINALS_HEADING}</DynText>
              {panes.map((pane) => (
                <TouchableOpacity
                  key={pane.paneId}
                  style={styles.paneRow}
                  onPress={() => props.onOpenPane?.(pane.paneId)}
                  activeOpacity={press.activeOpacity}
                >
                  <DynText style={styles.paneRowText} numberOfLines={1}>
                    {glyph.foldClosed} {pane.label ?? pane.paneId}
                    {pane.state === "unknown" ? LIFECYCLE_ONLY_SUFFIX : ""}
                  </DynText>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // S-11 (direction A): the human word is the heading — display tier, one
  // per screen; the id and status ride quiet lines below (canon §3 위계).
  heading: { ...type.display, color: colors.ink, marginBottom: space.s },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    marginBottom: space.xxs,
  },
  statusWord: { ...type.captionStrong },
  statusCounts: { ...type.caption, color: colors.inkMute },
  runId: { ...type.caption, color: colors.inkFaint, marginBottom: space.m },
  // Attention panel (S-12): the hairline card + a warn LEFT EDGE — the
  // edge marks the state; the text stays ink.
  attentionCard: {
    marginTop: space.m,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderLeftWidth: 3,
    borderLeftColor: colors.warn,
    borderRadius: radius.m,
    padding: space.m,
    gap: space.s,
  },
  attentionRow: { flexDirection: "row", gap: space.s, alignItems: "flex-start" },
  attentionMessage: { ...type.bodyStrong, color: colors.ink, flexShrink: 1 },
  // Nested surface inside the card (§2: surfaceAlt is the in-card layer);
  // focus rides the accent ring (canon §4).
  resolutionInput: { ...type.body, color: colors.ink, backgroundColor: colors.surfaceAlt, borderColor: colors.hairline, borderWidth: 1, borderRadius: radius.s, padding: space.m, minHeight: 48 },
  inputFocused: { borderColor: colors.accent },
  // The screen's one strong emphasis — the primary button tier: white
  // fill, radius.m, dark ink (canon §3 버튼 위계).
  resolveButton: { alignItems: "center", justifyContent: "center", minHeight: 44, backgroundColor: colors.cta, borderRadius: radius.m, paddingVertical: space.m, paddingHorizontal: space.l },
  resolveDisabled: { backgroundColor: colors.ctaDisabled },
  resolveButtonText: { ...type.bodyStrong, color: colors.ctaInk },
  resolveTextDisabled: { color: colors.inkFaint },
  resolveError: { ...type.caption, color: colors.danger, marginTop: space.xs },
  // Completion summary card (S-13): the same card vocabulary, a readable
  // status line, and the next action — never a blank terminal screen.
  summaryCard: {
    marginTop: space.m,
    flexDirection: "row",
    gap: space.m,
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    padding: space.m,
  },
  summaryMain: { flex: 1, minWidth: 0, gap: space.xxs },
  summaryTitle: { ...type.bodyStrong, color: colors.ink },
  summaryMeta: { ...type.caption, color: colors.inkMute },
  summaryHint: { ...type.caption, color: colors.inkFaint },
  stale: { ...type.caption, color: colors.inkMute, marginTop: space.xs },
  outputs: { marginTop: space.m, gap: space.xxs },
  outputLine: {
    ...type.mono,
    fontFamily: "Menlo",
    color: colors.ink,
  },
  paneSection: { marginTop: space.l },
  // §2 system-readout section label: caption tier, uppercase, tracking.
  paneHeading: {
    ...type.captionStrong,
    color: colors.inkFaint,
    textTransform: "uppercase",
    ...READOUT_STYLE,
    marginBottom: space.s,
  },
  // Touch target (44pt-class): row like the conversation PaneList —
  // paddingVertical m puts this row at ~46pt tall.
  paneRow: {
    paddingVertical: space.m,
    paddingHorizontal: space.l,
    marginBottom: space.s,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
  },
  paneRowText: { ...type.body, color: colors.ink },
  streamError: { ...type.caption, color: colors.danger, marginBottom: space.xs },
  waiting: { ...type.body, color: colors.inkMute },
});
