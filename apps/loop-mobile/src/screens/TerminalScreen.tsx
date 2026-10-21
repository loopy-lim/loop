/**
 * Terminal pane view — the raw ANSI mirror for any pane (agent or shell),
 * reached from the Panes browser or the agent detail's 터미널 segment.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { copy } from "../copy";
import { EmptyState, PressableRow, StatusPill } from "../design/primitives";
import { TerminalText } from "../design/TerminalText";
import { kindLabel } from "../herdr/kinds";
import { EMPTY_TRANSCRIPT, nextTranscript, type Transcript } from "../herdr/transcript";
import { paneDisplayName, type HerdrAppState } from "../herdr/store";
import { Icon } from "../ui/Icon";
import { colors, radius, space, type as typeScale, COLUMN_GUTTER } from "../ui/tokens";
import { useFollowScroll } from "../ui/followScroll";
import { useStore } from "../app/storeContext";

const READ_LINES = 500;

export function TerminalScreen(props: {
  paneId: string;
  state: HerdrAppState;
  onBack: () => void;
}) {
  const store = useStore();
  const insets = useSafeAreaInsets();
  const follow = useFollowScroll();
  const pane = useMemo(
    () => props.state.herdr?.panes.find((entry) => entry.id === props.paneId) ?? null,
    [props.state.herdr, props.paneId],
  );
  const label = kindLabel(pane?.agent ?? null);
  const [transcript, setTranscript] = useState<Transcript>({ ...EMPTY_TRANSCRIPT, paneId: props.paneId });
  const lastRevision = useRef("");

  const refresh = useCallback(async () => {
    try {
      const reading = await store.client.readPane(props.paneId, {
        lines: READ_LINES,
        source: "recent_unwrapped",
        format: "ansi",
      });
      setTranscript((current) => nextTranscript(current, reading) ?? current);
    } catch {
      // Offline: keep the last text; the feed re-renders the header honestly.
    }
  }, [props.paneId, store]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (pane === null || pane.revision === lastRevision.current) return;
    lastRevision.current = pane.revision;
    void refresh();
  }, [pane, refresh]);

  const scrollRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    if (follow.following) scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript.text, follow.following]);

  const title = pane === null ? props.paneId : paneDisplayName(pane, label);
  const paneGone =
    pane === null && props.state.herdr !== null && props.state.herdr.available;

  if (paneGone) {
    return (
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + space.s }]}>
          <Pressable onPress={props.onBack} hitSlop={12} accessibilityLabel="뒤로">
            <Icon role="back" size={typeScale.title.fontSize} color={colors.ink} />
          </Pressable>
        </View>
        <View style={styles.goneBody}>
          <EmptyState role="attention" title={copy.paneGoneTitle} body={copy.paneGoneBody} />
          <PressableRow onPress={props.onBack} style={styles.goneBack}>
            <Text style={styles.goneBackText}>{copy.paneGoneBack}</Text>
          </PressableRow>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + space.s }]}>
        <Pressable onPress={props.onBack} hitSlop={12} accessibilityLabel="뒤로">
          <Icon role="back" size={typeScale.title.fontSize} color={colors.ink} />
        </Pressable>
        <View style={styles.headerTitle}>
          <Text style={styles.headerTitleText} numberOfLines={1}>{title}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {pane?.cwd ?? copy.settingsNotConnected}
          </Text>
        </View>
        {pane !== null ? <StatusPill status={pane.status} /> : null}
      </View>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        onScroll={follow.onScroll}
        scrollEventThrottle={64}
        keyboardDismissMode="interactive"
        ref={scrollRef}
      >
        <TerminalText text={transcript.text} />
        <View style={{ height: space.xxl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  goneBody: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: COLUMN_GUTTER,
    gap: space.l,
  },
  goneBack: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.m,
    paddingVertical: space.m,
  },
  goneBackText: {
    ...typeScale.bodyStrong,
    color: colors.ink,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    paddingHorizontal: COLUMN_GUTTER,
    paddingBottom: space.s,
  },
  headerTitle: { flex: 1, gap: space.xxs },
  headerTitleText: {
    ...typeScale.title,
    color: colors.ink,
  },
  headerSubtitle: {
    ...typeScale.caption,
    color: colors.inkFaint,
  },
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: COLUMN_GUTTER,
    paddingTop: space.m,
  },
});
