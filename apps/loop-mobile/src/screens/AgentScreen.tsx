/**
 * Agent detail (rebuild brief §3 ②) — 대화 | 터미널 segments over one pane:
 * the chat side is the agent's transcript (ANSI preserved) with a composer
 * (agent.prompt) and quick keys (esc · ctrl+c); the terminal side is the
 * same text without chrome. The blocked banner routes approvals to the
 * desktop — the app never answers approval dialogs (rebuild brief §7).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { copy } from "../copy";
import { EmptyState, Hairline, PressableRow, StatusPill } from "../design/primitives";
import { TerminalText } from "../design/TerminalText";
import { kindLabel } from "../herdr/kinds";
import { nextTranscript, EMPTY_TRANSCRIPT, type Transcript } from "../herdr/transcript";
import { paneDisplayName } from "../herdr/store";
import type { HerdrAppState, HerdrStore } from "../herdr/store";
import { impactLight } from "../ui/haptics";
import { Icon } from "../ui/Icon";
import { animateTo, AnimatedView, useMotionValue } from "../ui/motion";
import { colors, radius, space, type as typeScale, COLUMN_GUTTER } from "../ui/tokens";
import { useFollowScroll } from "../ui/followScroll";
import { useKeyboardVisible } from "../ui/useKeyboardVisible";
import { useStore } from "../app/storeContext";

const READ_LINES = 400;

export function AgentScreen(props: {
  paneId: string;
  state: HerdrAppState;
  onBack: () => void;
}) {
  const store = useStore();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const pane = useMemo(
    () => props.state.herdr?.panes.find((entry) => entry.id === props.paneId) ?? null,
    [props.state.herdr, props.paneId],
  );
  const label = kindLabel(pane?.agent ?? null);
  const title = pane === null ? props.paneId : paneDisplayName(pane, label);
  // A converged, available state view without this pane means the pane was
  // closed elsewhere: render the honest closed state, never a stale screen.
  const paneGone =
    pane === null && props.state.herdr !== null && props.state.herdr.available;

  const [segment, setSegment] = useState<"chat" | "terminal">("chat");
  const [transcript, setTranscript] = useState<Transcript>({ ...EMPTY_TRANSCRIPT, paneId: props.paneId });
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const follow = useFollowScroll();
  const lastRevision = useRef<string>("");

  const applyReading = useCallback((reading: Awaited<ReturnType<HerdrStore["client"]["readPane"]>>) => {
    setTranscript((current) => nextTranscript(current, reading) ?? current);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const reading = await store.client.readPane(props.paneId, {
        lines: READ_LINES,
        source: "recent_unwrapped",
        format: "ansi",
      });
      applyReading(reading);
    } catch {
      // Offline or pane gone: keep the last transcript on screen; the state
      // feed re-renders the header honestly (pane disappears → 404 title).
    }
  }, [applyReading, props.paneId, store]);

  // Initial read, then read whenever the pane's revision advances.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (pane === null) return;
    if (pane.revision === lastRevision.current) return;
    lastRevision.current = pane.revision;
    void refresh();
  }, [pane, refresh]);

  // Follow the tail when new transcript text lands while the user is at the
  // bottom (follow-scroll machine owns the verdict).
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  useEffect(() => {
    if (follow.following) scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript.text, follow.following]);

  const send = useCallback(async () => {
    const text = composerValue.trim();
    if (text.length === 0 || sending) return;
    setComposerValue("");
    setSending(true);
    setNotice(null);
    const outcome = await store.client.prompt(props.paneId, text);
    setSending(false);
    if (outcome.accepted) {
      impactLight();
      setNotice(copy.sendQueued);
      void refresh();
      return;
    }
    if (outcome.reason === "blocked") setNotice(copy.sendBlocked);
    else if (outcome.reason === "not_found") setNotice(copy.sendNotFound);
    else setNotice(copy.sendFailed);
  }, [composerValue, props.paneId, refresh, sending, store]);

  const sendKeys = useCallback(async (keys: string[]) => {
    try {
      await store.client.sendKeys(props.paneId, keys);
      setNotice(null);
      void refresh();
    } catch {
      setNotice(copy.sendFailed);
    }
  }, [props.paneId, refresh, store]);

  const focusOnDesktop = useCallback(async () => {
    try {
      await store.client.focusPane(props.paneId);
    } catch {
      setNotice(copy.sendFailed);
    }
  }, [props.paneId, store]);

  const blocked = pane?.status === "blocked";

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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + space.s }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={props.onBack} hitSlop={12} accessibilityLabel="뒤로">
            <Icon role="back" size={typeScale.title.fontSize} color={colors.ink} />
          </Pressable>
          <View style={styles.headerTitle}>
            <Text style={styles.headerTitleText} numberOfLines={1}>{title}</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {[label, pane?.cwd].filter((part) => part != null && part.length > 0).join(" · ")}
            </Text>
          </View>
          {pane !== null ? <StatusPill status={pane.status} /> : null}
          <Pressable onPress={() => void focusOnDesktop()} hitSlop={8} accessibilityLabel={copy.focusOnDesktop}>
            <Icon role="forward" size={typeScale.body.fontSize} color={colors.inkFaint} />
          </Pressable>
        </View>
        <Segmented
          options={[copy.segmentChat, copy.segmentTerminal]}
          value={segment === "chat" ? 0 : 1}
          onChange={(value) => {
            impactLight();
            setSegment(value === 0 ? "chat" : "terminal");
          }}
        />
      </View>

      {blocked ? (
        <View style={styles.blockedBanner}>
          <Icon role="attention" size={typeScale.caption.fontSize} color={colors.warn} />
          <Text style={styles.blockedText}>{copy.sendBlocked}</Text>
          <Pressable onPress={() => void focusOnDesktop()} hitSlop={8}>
            <Text style={styles.blockedAction}>{copy.focusOnDesktop}</Text>
          </Pressable>
        </View>
      ) : null}
      {notice !== null ? (
        <Text style={styles.notice}>{notice}</Text>
      ) : null}

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        onScroll={follow.onScroll}
        scrollEventThrottle={64}
        keyboardDismissMode="interactive"
        ref={scrollRef}
      >
        <TerminalText text={transcript.text} />
        {transcript.truncated ? (
          <Text style={styles.truncateNotice}>{copy.truncateNotice}</Text>
        ) : null}
        <View style={{ height: keyboardVisible ? space.m : space.xxl }} />
      </ScrollView>

      <Hairline />
      <View style={[styles.composerRow, { paddingBottom: insets.bottom + space.s }]}>
        <View style={styles.quickKeys}>
          <QuickKey label="esc" onPress={() => void sendKeys(["esc"])} />
          <QuickKey label="ctrl+c" onPress={() => void sendKeys(["ctrl+c"])} />
        </View>
        <View style={styles.composer}>
          <TextInputStyled
            value={composerValue}
            onChange={setComposerValue}
            onSubmit={() => void send()}
          />
          <Pressable
            onPress={() => void send()}
            style={[styles.sendButton, (composerValue.trim().length === 0 || sending) && styles.sendDisabled]}
            accessibilityLabel={copy.composerSend}
          >
            <Icon role="send" size={typeScale.body.fontSize} color={colors.ctaInk} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Two-option segmented control with a sliding thumb — the iOS native
 * gesture: the highlight glides between options instead of swapping. */
function Segmented(props: {
  options: readonly [string, string];
  value: 0 | 1;
  onChange: (value: 0 | 1) => void;
}) {
  const pos = useMotionValue(0);
  const [frames, setFrames] = useState<{ x: number; w: number }[] | null>(null);
  useEffect(() => {
    animateTo(pos, props.value, { duration: 180 });
  }, [pos, props.value]);
  const track = frames !== null && frames.length === 2 ? frames : null;
  const origin = track?.[0];
  const target = track?.[1];
  const active = track?.[props.value];
  return (
    <View style={styles.segments}>
      {origin !== undefined && target !== undefined && active !== undefined ? (
        <AnimatedView
          style={[
            styles.segmentThumb,
            { width: active.w },
            {
              transform: [
                {
                  translateX: pos.interpolate({
                    inputRange: [0, 1],
                    outputRange: [origin.x, target.x],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
      {props.options.map((label, index) => (
        <Pressable
          key={label}
          onPress={() => props.onChange(index as 0 | 1)}
          style={styles.segment}
          accessibilityRole="button"
          accessibilityState={{ selected: props.value === index }}
          onLayout={(event) => {
            const { x, width: w } = event.nativeEvent.layout;
            setFrames((current) => {
              const next = [...(current ?? [])];
              next[index] = { x, w };
              return next;
            });
          }}
        >
          <Text style={[styles.segmentText, props.value === index && styles.segmentTextActive]}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function QuickKey(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.quickKey}>
      <Text style={styles.quickKeyText}>{props.label}</Text>
    </Pressable>
  );
}

/** Minimal controlled text input styled from tokens (RN TextInput). Enter
 * sends (the native chat contract); the composer stays multiline so pasted
 * text keeps its newlines. */
function TextInputStyled(props: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChange}
      onKeyPress={(event) => {
        if (event.nativeEvent.key === "Enter") props.onSubmit();
      }}
      returnKeyType="send"
      blurOnSubmit={false}
      placeholder={copy.composerPlaceholder}
      placeholderTextColor={colors.inkGhost}
      style={styles.input}
      multiline
    />
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
    paddingHorizontal: COLUMN_GUTTER,
    gap: space.m,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
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
  segments: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    padding: space.xxs,
  },
  segmentThumb: {
    position: "absolute",
    top: space.xxs,
    bottom: space.xxs,
    left: 0,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.s,
  },
  segment: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: radius.s,
    alignItems: "center",
  },
  segmentText: {
    ...typeScale.captionStrong,
    color: colors.inkFaint,
  },
  segmentTextActive: { color: colors.ink },
  blockedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    marginHorizontal: COLUMN_GUTTER,
    marginTop: space.s,
    backgroundColor: "rgba(210, 153, 34, 0.12)",
    borderColor: "rgba(210, 153, 34, 0.4)",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.m,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
  },
  blockedText: {
    ...typeScale.caption,
    color: colors.warn,
    flex: 1,
  },
  blockedAction: {
    ...typeScale.captionStrong,
    color: colors.warn,
  },
  notice: {
    ...typeScale.caption,
    color: colors.inkFaint,
    paddingHorizontal: COLUMN_GUTTER,
    paddingTop: space.s,
  },
  body: { flex: 1 },
  bodyContent: {
    paddingHorizontal: COLUMN_GUTTER,
    paddingTop: space.m,
  },
  truncateNotice: {
    ...typeScale.caption,
    color: colors.inkGhost,
    paddingTop: space.s,
  },
  composerRow: {
    paddingHorizontal: COLUMN_GUTTER,
    paddingTop: space.s,
    gap: space.s,
  },
  quickKeys: { flexDirection: "row", gap: space.s },
  quickKey: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.m,
    paddingVertical: space.xs,
  },
  quickKeyText: {
    ...typeScale.caption,
    color: colors.inkMute,
    fontFamily: "Menlo",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.s,
  },
  input: {
    ...typeScale.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.l,
    paddingHorizontal: space.m,
    paddingTop: space.s,
    paddingBottom: space.s,
    maxHeight: 120,
    flex: 1,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.cta,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { backgroundColor: colors.ctaDisabled },
});
