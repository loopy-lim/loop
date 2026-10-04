import { useEffect, useRef, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import type { GatewayClient } from "../gateway-client/client";
import { countsText, shortRunId } from "../features/run-list";
import { RunProjection, type OutputEntry, type RunProjectionState } from "../state/runProjection";
import type { RemotePaneSummary } from "../gateway-client/wire";
import { DynText } from "../ui/DynText";
import { glyph } from "../ui/glyphs";
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

  // Plain content column: App.tsx wraps this in the shared centered Screen.
  return (
    <View>
      {streamError !== null ? (
        <DynText style={styles.streamError}>Stream: {streamError}</DynText>
      ) : null}
      {run === null ? (
        <DynText style={styles.waiting}>Waiting for run projection…</DynText>
      ) : (
        <View>
          <DynText style={styles.heading}>
            {shortRunId(run.runId)} — {run.status}
            {run.terminal ? " (terminal)" : ""}
          </DynText>
          {/* Non-zero counts only (quiet readout): zero rows are noise —
           * the same closed formatter the chats rows use. */}
          <DynText style={styles.taskCounts}>{countsText(run)}</DynText>
          {run.attention !== null ? (
            <DynText style={styles.attention}>⚠ {run.attention.message}</DynText>
          ) : null}
          {state?.stale ? (
            <DynText style={styles.stale}>reconnecting — recent output may be incomplete</DynText>
          ) : null}
          {(state?.outputs ?? []).map((entry: OutputEntry) => (
            <DynText key={entry.activityId} numberOfLines={0} style={styles.outputLine}>
              [{entry.taskId}] {entry.text}
            </DynText>
          ))}
          {panes !== null && panes.length > 0 && props.onOpenPane !== undefined ? (
            <View style={styles.paneSection}>
              <DynText style={styles.paneHeading}>Terminals</DynText>
              {panes.map((pane) => (
                <TouchableOpacity
                  key={pane.paneId}
                  style={styles.paneRow}
                  onPress={() => props.onOpenPane?.(pane.paneId)}
                  activeOpacity={press.activeOpacity}
                >
                  <DynText style={styles.paneRowText} numberOfLines={1}>
                    {glyph.foldClosed} {pane.label ?? pane.paneId}
                    {pane.state === "unknown" ? " (lifecycle only)" : ""}
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
  heading: { ...type.title, color: colors.ink, marginBottom: space.s },
  taskCounts: { ...type.caption, color: colors.inkMute, marginBottom: space.xs },
  // Attention is the one warn semantic on the run view (same as desktop).
  attention: { ...type.captionStrong, color: colors.warn, marginTop: space.xs },
  stale: { ...type.caption, color: colors.inkMute, marginTop: space.xs },
  outputLine: {
    ...type.mono,
    fontFamily: "Menlo",
    color: colors.ink,
    marginTop: space.xs,
  },
  paneSection: { marginTop: space.l },
  // §2 system-readout section label: caption tier, uppercase, tracking.
  paneHeading: {
    ...type.captionStrong,
    color: colors.inkFaint,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: space.s,
  },
  // Touch target (44pt-class): pill row like the conversation PaneList —
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
