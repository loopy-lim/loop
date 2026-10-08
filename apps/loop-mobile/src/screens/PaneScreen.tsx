import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { GatewayClient } from "../gateway-client/client";
import { PaneProjection, type PaneViewState } from "../state/paneProjection";
import {
  LIFECYCLE_ONLY_NOTICE,
  PANE_GONE_NOTICE,
  SNAPSHOT_ORIGIN_NOTICE,
  UNOBSERVED_NOTICE,
} from "../ui/copy";
import {
  TERMINAL_BACKGROUND,
  TERMINAL_COLUMN_MAX_WIDTH,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_PADDING,
  TERMINAL_TEXT_COLOR,
  TERMINAL_VIEWPORT_HEIGHT,
} from "../ui/terminalLayout";
import { colors, radius, space, type } from "../ui/tokens";
import { STREAM_DISCONNECTED_NOTICE } from "../ui/copy";
import { useFollowScroll } from "../ui/followScroll";

/**
 * Screen 4 — live worker pane terminal view (terminal mirror v1, decision D6).
 *
 * Subscribes to `GET /v1/panes/{paneId}/events` through the shared client,
 * dedupes snapshots on `paneId + revision` (PaneProjection), and renders the
 * pane screen buffer as a monospace live feed inside the shared centered
 * column. Autoscroll follows the tail until the user scrolls up; reaching the
 * bottom re-attaches. Every view carries the snapshot-origin notice (pane
 * text is screen-buffer snapshots, not a lossless transcript), and panes
 * without a confident streaming source get the lifecycle-only badge.
 */
export function PaneScreen(props: { client: GatewayClient; paneId: string }) {
  const [view, setView] = useState<PaneViewState | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  // Follow-the-tail state lives in one shared hook (decision D6) — the
  // onScroll verdict rides a ref, the flush rides one scheduled frame.
  const { following, onScroll } = useFollowScroll();
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const projection = new PaneProjection(props.paneId);

    const publish = () => setView(projection.snapshot());

    // Inventory metadata pass (best effort): label + lifecycle state for the
    // honest badges. Failure never blocks the stream below.
    props.client
      .listPanes()
      .then((page) => {
        const summary = page.panes.find((pane) => pane.paneId === props.paneId);
        if (summary !== undefined) {
          projection.applySummary(summary);
          publish();
        }
      })
      .catch(() => undefined);

    props.client
      .observePane(
        props.paneId,
        (event) => {
          if (event.kind === "pane_text") {
            projection.applyText(event.frame);
          } else {
            projection.applyReset(event.frame);
          }
          publish();
        },
        {
          signal: controller.signal,
          onRetryableError: (e) => {
            projection.markStale(true);
            setStreamError(String(e));
            publish();
          },
        },
      )
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setStreamError(e instanceof Error ? e.message : String(e));
        }
      });

    return () => controller.abort();
  }, [props.client, props.paneId]);

  // Follow the tail while attached (decision D6).
  useEffect(() => {
    if (following && view !== null && view.text.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [following, view?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  const notices: string[] = [SNAPSHOT_ORIGIN_NOTICE];
  if (view?.state === "unknown") notices.push(LIFECYCLE_ONLY_NOTICE);
  if (view?.state === "unobserved") notices.push(UNOBSERVED_NOTICE);
  if (view?.gone === true) notices.push(PANE_GONE_NOTICE);

  // Plain content column: App.tsx wraps this in the shared centered Screen
  // (which applies the device safe-area insets).
  return (
    <View>
      <Text style={styles.heading}>{view?.label ?? props.paneId}</Text>
      {notices.map((notice) => (
        <Text key={notice} style={styles.notice}>
          {notice}
        </Text>
      ))}
      {streamError !== null ? (
        <Text style={styles.notice}>{STREAM_DISCONNECTED_NOTICE}</Text>
      ) : null}
      <View style={styles.screen}>
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.screenContent}
        >
          <Text style={styles.termText} numberOfLines={0}>
            {view?.text && view.text.length > 0 ? view.text : "…"}
          </Text>
        </ScrollView>
      </View>
      {/* Deviations only (quiet state, §1): a healthy attached tail says
       * nothing — rev/truncation/reconnect/scroll state appear when true. */}
      {view?.truncated === true || view?.stale === true || !following ? (
        <Text style={styles.meta}>
          {[
            view?.truncated === true ? "truncated" : null,
            view?.stale === true ? "reconnecting" : null,
            following ? null : "paused (scrolled up)",
          ]
            .filter((part): part is string => part !== null)
            .join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { ...type.title, color: colors.ink, marginBottom: space.xs },
  notice: { ...type.caption, color: colors.inkMute, marginBottom: 2 },
  screen: {
    width: "100%",
    maxWidth: TERMINAL_COLUMN_MAX_WIDTH,
    height: TERMINAL_VIEWPORT_HEIGHT,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    padding: TERMINAL_PADDING,
    marginTop: space.s,
    backgroundColor: TERMINAL_BACKGROUND,
  },
  screenContent: { flexGrow: 1, justifyContent: "flex-end" },
  termText: {
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: TERMINAL_FONT_SIZE,
    lineHeight: TERMINAL_LINE_HEIGHT,
    color: TERMINAL_TEXT_COLOR,
  },
  meta: { ...type.caption, color: colors.inkMute, marginTop: space.s },
});
