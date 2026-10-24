/**
 * Agent detail (rebuild brief §3 ②) — 대화 | 터미널 segments over one pane:
 * the chat side is the agent's transcript (ANSI preserved) with a composer
 * (agent.prompt) and quick keys (esc · ctrl+c); the terminal side is the
 * same text without chrome. The blocked banner routes approvals to the
 * desktop — the app never answers approval dialogs (rebuild brief §7).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { memo } from "react";
import {
  FlatList,
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

import { copy, statusLabel } from "../copy";
import { EmptyState, Hairline, PressableRow, StatusPill } from "../design/primitives";
import { TerminalText } from "../design/TerminalText";
import { kindLabel } from "../herdr/kinds";
import { nextTranscript, EMPTY_TRANSCRIPT, type Transcript } from "../herdr/transcript";
import {
  chatBody,
  mergePendingTurns,
  nextConversation,
  planRefresh,
  seenUserIds,
  summaryStatus,
  turnsEqual,
  type ChatBody,
  type PendingPrompt,
} from "../herdr/conversation";
import type { HerdrConversation, HerdrConversationTurn } from "../herdr/wire";
import { paneDisplayName } from "../herdr/store";
import type { HerdrAppState, HerdrStore } from "../herdr/store";
import { impactLight } from "../ui/haptics";
import { Icon } from "../ui/Icon";
import type { IconRole } from "../ui/glyphs";
import {
  AnimatedView,
  Entrance,
  PressableScale,
  springTo,
  TypingDots,
  useMotionValue,
} from "../ui/motion";
import { colors, radius, space, type as typeScale, COLUMN_GUTTER } from "../ui/tokens";
import { useFollowScroll } from "../ui/followScroll";
import { useKeyboardVisible } from "../ui/useKeyboardVisible";
import { useStore } from "../app/storeContext";
import { MarkdownView } from "../features/markdown-view";

const READ_LINES = 400;
/** ANSI read options for the transcript/terminal mirror (route defaults). */
const READ_OPTIONS = {
  lines: READ_LINES,
  source: "recent_unwrapped" as const,
  format: "ansi" as const,
};
/** An optimistic bubble retires on its match in the fetched history, or here
 * when the record never lands (agent restart, lost prompt) — the queue
 * self-heals either way. */
const PENDING_PROMPT_TIMEOUT_MS = 15_000;

export function AgentScreen(props: { paneId: string; state: HerdrAppState; onBack: () => void }) {
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
  const paneGone = pane === null && props.state.herdr !== null && props.state.herdr.available;

  const [segment, setSegment] = useState<"chat" | "terminal">("chat");
  const [transcript, setTranscript] = useState<Transcript>({
    ...EMPTY_TRANSCRIPT,
    paneId: props.paneId,
  });
  const [conversation, setConversation] = useState<HerdrConversation | null>(null);
  const body: ChatBody =
    segment === "chat" ? chatBody(props.paneId, conversation) : { view: "transcript" };
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [pending, setPending] = useState<PendingPrompt[]>([]);
  const follow = useFollowScroll();
  const lastRevision = useRef<string>("");
  // Refresh reads the CURRENT segment without joining it into callback deps
  // (a dep would re-run the initial read on every switch); the segment
  // control below is the one writer that keeps it in sync.
  const segmentRef = useRef(segment);
  // What the last conversation fetch decided the chat surface is: while the
  // structured turns view holds, a tick's ANSI read renders nothing, so it
  // is skipped until a fallback flips this back to "other".
  const surfaceRef = useRef<"turns" | "other" | "unknown">("unknown");

  const applyReading = useCallback(
    (reading: Awaited<ReturnType<HerdrStore["client"]["readPane"]>>) => {
      setTranscript((current) => nextTranscript(current, reading) ?? current);
    },
    [],
  );

  const refresh = useCallback(
    async (forceTranscript = false) => {
      // Both reads run concurrently — a streamed tick used to pay them in
      // series, doubling the wait for new content. Which reads a tick needs
      // is the pure planRefresh contract (unit-pinned).
      const plan = planRefresh(segmentRef.current, surfaceRef.current, forceTranscript);
      const [reading, fetched] = await Promise.all([
        plan.transcript
          ? store.client.readPane(props.paneId, READ_OPTIONS).catch(() => null)
          : Promise.resolve(null),
        plan.conversation
          ? store.client
              .conversation(props.paneId)
              .then(
                (conversation) => conversation,
                () => "failed" as const,
              )
          : Promise.resolve(null),
      ]);
      if (reading !== null) applyReading(reading);
      if (fetched === "failed") {
        // 404 (no structured source for this kind) or offline: the ANSI
        // transcript stays the chat body — the structured layer is additive.
        setConversation((current) => (current?.paneId === props.paneId ? current : null));
        surfaceRef.current = "other";
      } else if (fetched !== null) {
        setConversation((current) => nextConversation(props.paneId, current, fetched));
        surfaceRef.current = chatBody(props.paneId, fetched).view === "turns" ? "turns" : "other";
      }
    },
    [applyReading, props.paneId, store],
  );

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

  // Optimistic send: an accepted prompt joins the tail as a pending bubble
  // and hands off to the agent's own record when a fetched turn carries it.
  const pendingSeq = useRef(0);
  const pendingTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const conversationRef = useRef<HerdrConversation | null>(null);
  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);
  useEffect(
    () => () => {
      for (const timer of pendingTimers.current) clearTimeout(timer);
    },
    [],
  );
  const attachPending = useCallback((text: string) => {
    const id = `pending-${pendingSeq.current}`;
    pendingSeq.current += 1;
    setPending((current) => [
      ...current,
      { id, text, seen: seenUserIds(conversationRef.current) },
    ]);
    const timer = setTimeout(() => {
      pendingTimers.current.delete(timer);
      setPending((current) => current.filter((item) => item.id !== id));
    }, PENDING_PROMPT_TIMEOUT_MS);
    pendingTimers.current.add(timer);
  }, []);

  // The turns list the FlatList renders: fetched turns with still-pending
  // prompts folded in as trailing user bubbles (null off the turns view).
  const chat = useMemo(() => {
    if (segment !== "chat") return null;
    const decided = chatBody(props.paneId, conversation);
    if (decided.view !== "turns") return null;
    return mergePendingTurns(decided.turns.turns, pending);
  }, [conversation, pending, props.paneId, segment]);

  // A fetched history that now carries a pending prompt retires it — the
  // optimistic bubble is replaced by the agent's own record.
  useEffect(() => {
    if (chat === null || chat.remaining.length === pending.length) return;
    setPending((current) => current.filter((item) => chat.remaining.includes(item.id)));
  }, [chat, pending]);

  // Follow the tail when new content lands while the user is at the bottom
  // (follow-scroll machine owns the verdict); detached users stay anchored
  // where they are — appended content grows below without moving the view.
  // Programmatic follows pin INSTANTLY (animated: false): a live session
  // lands new content every few hundred ms, and an animated scroll that
  // keeps restarting mid-flight read as up-down bouncing — its own onScroll
  // events could also momentarily read off-bottom and detach the follow
  // (live device finding, 2026-10-22). Touch scrolling stays the only
  // detach path.
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const listRef = useRef<FlatList<HerdrConversationTurn> | null>(null);
  useEffect(() => {
    if (!follow.following) return;
    if (body.view === "turns") listRef.current?.scrollToEnd({ animated: false });
    else scrollRef.current?.scrollToEnd({ animated: false });
  }, [transcript.text, chat, body.view, follow.following]);

  // Entering the screen lands on the newest content: the first non-empty
  // layout snaps to the bottom, no animation (re-render budget: once).
  const enteredRef = useRef(false);
  const snapToNewest = useCallback(() => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    follow.followNow();
    if (body.view === "turns") listRef.current?.scrollToEnd({ animated: false });
    else scrollRef.current?.scrollToEnd({ animated: false });
  }, [body.view, follow]);

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
      attachPending(text);
      void refresh();
      return;
    }
    setComposerValue(text);
    if (outcome.reason === "blocked") setNotice(copy.sendBlocked);
    else if (outcome.reason === "not_found") setNotice(copy.sendNotFound);
    else setNotice(copy.sendFailed);
  }, [attachPending, composerValue, props.paneId, refresh, sending, store]);

  const sendKeys = useCallback(
    async (keys: string[]) => {
      try {
        await store.client.sendKeys(props.paneId, keys);
        setNotice(null);
        void refresh();
      } catch {
        setNotice(copy.sendFailed);
      }
    },
    [props.paneId, refresh, store],
  );

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
            <Text style={styles.headerTitleText} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {[label, pane?.cwd].filter((part) => part != null && part.length > 0).join(" · ")}
            </Text>
          </View>
          {pane !== null ? <StatusPill status={pane.status} /> : null}
          <PressableScale
            onPress={() => void focusOnDesktop()}
            accessibilityLabel={copy.focusOnDesktop}
          >
            <Icon role="forward" size={typeScale.body.fontSize} color={colors.inkFaint} />
          </PressableScale>
        </View>
        <Segmented
          options={[copy.segmentChat, copy.segmentTerminal]}
          value={segment === "chat" ? 0 : 1}
          onChange={(value) => {
            impactLight();
            const next = value === 0 ? "chat" : "terminal";
            segmentRef.current = next; // the forced refresh below reads it synchronously
            setSegment(next);
            void refresh(true); // the newly shown body fetches now, not on the next tick
          }}
        />
      </View>

      {blocked ? (
        <Entrance>
          <View style={styles.blockedBanner}>
            <Icon role="attention" size={typeScale.caption.fontSize} color={colors.warn} />
            <Text style={styles.blockedText}>{copy.sendBlocked}</Text>
            <PressableScale
              onPress={() => void sendKeys(["enter"])}
              accessibilityLabel={copy.approveEnter}
            >
              <Text style={[styles.blockedAction, styles.blockedApprove]}>{copy.approveEnter}</Text>
            </PressableScale>
            <PressableScale
              onPress={() => void sendKeys(["esc"])}
              accessibilityLabel={copy.rejectEsc}
            >
              <Text style={styles.blockedAction}>{copy.rejectEsc}</Text>
            </PressableScale>
            <PressableScale onPress={() => void focusOnDesktop()}>
              <Text style={styles.blockedAction}>{copy.focusOnDesktop}</Text>
            </PressableScale>
          </View>
        </Entrance>
      ) : null}
      {notice !== null ? <Text style={styles.notice}>{notice}</Text> : null}

      {body.view === "turns" ? (
        <FlatList
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          data={chat !== null ? chat.turns : []}
          keyExtractor={(turn) => turn.id}
          renderItem={({ item }) => (
            <ChatTurnRow turn={item} pending={item.id.startsWith("pending-")} />
          )}
          onScroll={follow.onScroll}
          scrollEventThrottle={64}
          keyboardDismissMode="interactive"
          ref={listRef}
          onContentSizeChange={snapToNewest}
          maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
          ListFooterComponent={
            <>
              {pane?.status === "working" ? (
                <View style={styles.footerDots}>
                  <TypingDots accessibilityLabel={copy.workingIndicator} />
                </View>
              ) : null}
              <View style={{ height: keyboardVisible ? space.m : space.xxl }} />
            </>
          }
        />
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          onScroll={follow.onScroll}
          scrollEventThrottle={64}
          keyboardDismissMode="interactive"
          ref={scrollRef}
          onContentSizeChange={snapToNewest}
        >
          {body.view === "summary" ? (
            <>
              <AgySummaryCard summary={body.summary.summary} statusLabel={statusLabel} />
              <TerminalText text={transcript.text} />
            </>
          ) : (
            <TerminalText text={transcript.text} />
          )}
          {transcript.truncated ? (
            <Text style={styles.truncateNotice}>{copy.truncateNotice}</Text>
          ) : null}
          {pane?.status === "working" ? (
            <View style={styles.footerDots}>
              <TypingDots accessibilityLabel={copy.workingIndicator} />
            </View>
          ) : null}
          <View style={{ height: keyboardVisible ? space.m : space.xxl }} />
        </ScrollView>
      )}

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
          <PressableScale
            onPress={() => void send()}
            disabled={composerValue.trim().length === 0 || sending}
            style={[
              styles.sendButton,
              (composerValue.trim().length === 0 || sending) && styles.sendDisabled,
            ]}
            accessibilityLabel={copy.composerSend}
          >
            <Icon role="send" size={typeScale.body.fontSize} color={colors.ctaInk} />
          </PressableScale>
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
  const pos = useMotionValue(props.value);
  const [frames, setFrames] = useState<{ x: number; w: number }[] | null>(null);
  useEffect(() => {
    void springTo(pos, props.value, { speed: 22, bounciness: 3 });
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
    <PressableScale
      onPress={props.onPress}
      style={styles.quickKey}
      accessibilityLabel={props.label}
    >
      <Text style={styles.quickKeyText}>{props.label}</Text>
    </PressableScale>
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

/** One structured conversation turn: user bubble right, assistant text left,
 * tool calls as collapsed state rows — tokens only, no inline colors. */
const ChatTurnRow = memo(
  function ChatTurnRow(props: { turn: HerdrConversationTurn; pending?: boolean }) {
    const { turn } = props;
    if (turn.kind === "user") {
      const bubble = (
        <View style={[styles.turnUser, props.pending === true && styles.turnUserPending]}>
          <Text style={styles.turnUserText}>{turn.text}</Text>
        </View>
      );
      // An optimistic bubble skips the entrance — it must not replay the
      // fade when the agent's own record replaces it a beat later.
      return props.pending === true ? bubble : <Entrance>{bubble}</Entrance>;
    }
  if (turn.kind === "assistant") {
    return (
      <Entrance>
        <View style={styles.turnAssistant}>
          <MarkdownView text={turn.text} style={styles.turnAssistantText} />
        </View>
      </Entrance>
    );
  }
  const iconRole: IconRole =
    turn.state === "error"
      ? "statusError"
      : turn.state === "running"
        ? "statusRunning"
        : "statusDone";
  const iconColor =
    turn.state === "error" ? colors.danger : turn.state === "running" ? colors.accent : colors.ok;
  return (
    <Entrance>
      <View style={[styles.turnTool, turn.state === "error" && styles.turnToolError]}>
        <View style={styles.turnToolGlyphWrap}>
          <Icon role={iconRole} size={14} color={iconColor} />
        </View>
        <View style={styles.turnToolBody}>
          <Text style={styles.turnToolTitle} numberOfLines={1}>
            {turn.title}
          </Text>
          {turn.detail !== null ? (
            <Text style={styles.turnToolDetail} numberOfLines={2}>
              {turn.detail}
            </Text>
          ) : null}
        </View>
      </View>
    </Entrance>
  );
  },
  // Content compare, not reference: every fetch rebuilds the turn objects,
  // so only rows whose rendered content changed (the streaming tail)
  // re-render, and a long conversation no longer re-parses wholesale.
  (a, b) => turnsEqual(a.turn, b.turn) && a.pending === b.pending,
);

/** agy summary card (documented SQL summary only — the bodies are
 * undocumented blobs, so the ANSI transcript stays underneath). */
function AgySummaryCard(props: {
  summary: { title: string; status: string; stepCount: number; preview: string };
  statusLabel: (status: string) => string;
}) {
  return (
    <Entrance>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle} numberOfLines={2}>
          {props.summary.title}
        </Text>
        <View style={styles.summaryMeta}>
          <StatusPill status={summaryStatus(props.summary.status)} />
          <Text style={styles.summarySteps}>
            {`${copy.summarySteps} ${props.summary.stepCount}`}
          </Text>
        </View>
        {props.summary.preview.length > 0 ? (
          <Text style={styles.summaryPreview} numberOfLines={4}>
            {props.summary.preview}
          </Text>
        ) : null}
      </View>
    </Entrance>
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
  blockedApprove: { color: colors.ctaInk },
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
  turnUser: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.l,
    borderBottomRightRadius: radius.s,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    marginBottom: space.s,
  },
  turnUserPending: { opacity: 0.7 },
  footerDots: { paddingHorizontal: COLUMN_GUTTER },
  turnUserText: {
    ...typeScale.body,
    color: colors.ink,
  },
  turnAssistant: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    marginBottom: space.s,
  },
  turnAssistantText: {
    ...typeScale.body,
    color: colors.ink,
  },
  turnTool: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    alignSelf: "flex-start",
    maxWidth: "92%",
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.m,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    marginBottom: space.s,
  },
  turnToolError: { borderColor: colors.danger },
  turnToolGlyphWrap: { width: 16, alignItems: "center", justifyContent: "center" },
  turnToolGlyph: {
    ...typeScale.captionStrong,
    color: colors.inkMute,
    fontFamily: "Menlo",
  },
  turnToolGlyphError: { color: colors.danger },
  turnToolBody: { flexShrink: 1, gap: 2 },
  turnToolTitle: {
    ...typeScale.captionStrong,
    color: colors.ink,
    fontFamily: "Menlo",
  },
  turnToolDetail: {
    ...typeScale.caption,
    color: colors.inkFaint,
    fontFamily: "Menlo",
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.l,
    padding: space.m,
    gap: space.s,
    marginBottom: space.m,
  },
  summaryTitle: {
    ...typeScale.bodyStrong,
    color: colors.ink,
  },
  summaryMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
  },
  summarySteps: {
    ...typeScale.caption,
    color: colors.inkFaint,
  },
  summaryPreview: {
    ...typeScale.caption,
    color: colors.inkMute,
  },
});
