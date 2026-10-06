import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ActionSheetIOS,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Composer } from "../features/composer";
import { TimelineItem } from "../features/conversation-timeline";
import { sessionTitle } from "../features/session-title";
import { shouldRenderEmptyState, timelineRows, type TimelineRow } from "../features/timeline-rows";
import type { GatewayClient } from "../gateway-client/client";
import type { RemoteSessionSummary } from "../gateway-client/conversation";
import type { RemotePaneSummary } from "../gateway-client/wire";
import { createNativePhotoPicker, readPhotoBlob, type PhotoSource } from "../features/photoPicker";
import { AttachmentCache } from "../state/attachmentCache";
import {
  appendPendingAttachment,
  removePendingAttachment,
  sendComposerWithAttachments,
  type PendingAttachment,
} from "../state/attachFlow";
import {
  ConversationProjection,
  toolCardExpanded,
  type ConversationViewState,
} from "../state/conversationProjection";
import { composerTarget, sendComposerText } from "../state/composer";
import { nextFollowState } from "../state/paneProjection";
import type { SessionNamingIndex } from "../state/sessionsView";
import {
  ACTION_CAMERA_LABEL,
  ACTION_CANCEL_LABEL,
  ACTION_PHOTO_LIBRARY_LABEL,
  ATTACH_LIMIT_NOTICE,
  ATTACH_SESSION_REQUIRED_NOTICE,
  CAMERA_DENIED_NOTICE,
  EMPTY_TIMELINE_HINT,
  EMPTY_TIMELINE_TITLE,
  JUMP_TO_BOTTOM_LABEL,
  PHOTO_LIBRARY_DENIED_NOTICE,
  PHOTOS_UNAVAILABLE_NOTICE,
  RECONNECTING_NOTICE,
  SESSION_ENDED_NOTICE,
  STREAM_DISCONNECTED_NOTICE,
  WAITING_FOR_SESSION_NOTICE,
  TERMINALS_HEADING,
  READOUT_STYLE,
} from "../ui/copy";
import { DynText } from "../ui/DynText";
import { AppHeader } from "../ui/AppHeader";
import { BackSwipeZone } from "../ui/BackSwipeZone";
import { Entrance, configureCardFold, useBlink } from "../ui/motion";
import { Icon } from "../ui/Icon";
import { glyph } from "../ui/glyphs";
import { COLUMN_MAX_WIDTH } from "../ui/Screen";
import { colors, elevation, motion, press, radius, space, type } from "../ui/tokens";
import { useKeyboardVisible } from "../ui/useKeyboardVisible";

/**
 * Conversation view (GUI conversation v1, decision 2026-xx-gui-conversation
 * D6): the primary chat surface for a session — user bubbles, assistant
 * text, collapsible tool cards, steer markers, and a composer that steers
 * mid-run (mailbox path) or submits a new run when idle.
 *
 * Rendering rules live in the timeline feature; the projection owns the D4
 * state contract. This screen keeps only app-local concerns: fold state
 * (D4 §5), autoscroll follow (terminal-view precedent), the raw terminal
 * toggle, and the honest notices (waiting / stale / ended). Owns its full
 * layout — App renders it without the shared Screen wrapper so the
 * timeline and composer scroll correctly.
 *
 * Safe area (task `ui-codex-redesign`; header became the status-bar
 * substitute in task `header-statusbar-redesign`): the ui/AppHeader zone
 * consumes the status-bar inset itself (title left flank, actions right
 * flank, Dynamic Island centered between), the column clears the landscape
 * notch, and the fixed bottom composer clears the home indicator — handing
 * that inset to KeyboardAvoidingView while the keyboard is up (iOS pads by
 * the keyboard's full overlap, which already includes the home-indicator
 * area).
 */

/** Display-only compaction of opaque ids (never parsed back). */
function shortId(id: string): string {
  return id.length <= 18 ? id : `${id.slice(0, 18)}…`;
}

/** Heading fallback: the run id when correlated, else the session id. */
function fallbackHeading(runId: string | undefined, sessionId: string | null): string {
  if (runId !== undefined) return shortId(runId);
  if (sessionId !== null) return shortId(sessionId);
  return "…";
}

export function ConversationScreen(props: {
  client: GatewayClient;
  /** Chat entry via a correlated run (chats list rows). */
  runId?: string;
  /** Direct entry via a session id (uncorrelated sessions section). */
  sessionId?: string;
  /** Opens the raw terminal view for a pane (header toggle target). */
  onOpenPane?: (paneId: string) => void;
  /** Opens the conversation of a newly submitted run. */
  onOpenRun?: (runId: string) => void;
  /** Returns to the chats list (omitted: no back control). */
  onBack?: () => void;
  /** Opens the app's side menu (task `mobile-ux-patterns`): detail
   * surfaces hide the tab bar, so this header button is the one path to
   * the Settings/Files destinations from inside a conversation. */
  onOpenMenu?: () => void;
  /** App-local naming evidence fold; observed frames feed it and the
   *  header applies the operator-approved session title rule. */
  naming?: SessionNamingIndex;
  /** Showcase/demo: submit this text as a mid-run steer once the session
   *  turn is running (same handler a human Steer tap invokes). */
  autoSteerText?: string;
  /** Delay after "running" before the auto steer fires (default 6000ms). */
  autoSteerDelayMs?: number;
  /** Showcase/demo (v8 jump pill): delay after mount before a scripted
   * scroll-up fires. The programmatic scroll drives the same onScroll
   * follow machine a human flick drives — no new scroll state (C11). */
  autoScrollUpDelayMs?: number;
  /** Showcase/demo (v9 attach): prefills the composer draft. */
  composerDraft?: string;
  /** Showcase/demo (v9 attach): M2 attachment ids whose demo bodies the
   * composer attaches after `autoAttachDelayMs`. The scripted attach enters
   * the flow at the SAME continuation the OS photo picker's "picked"
   * outcome feeds (appendPendingAttachment over the same pending state the
   * thumbnails render) — the locally generated demo bodies stand in for
   * photo-library picks, which cannot be driven headlessly. */
  autoAttachAssetIds?: string[];
  /** Delay after mount before the scripted attach fires (default 3000ms). */
  autoAttachDelayMs?: number;
  /** Delay after mount before the scripted Send fires — the same submit
   * handler the human send tap invokes, so the upload→input round trip is
   * the production path. Absent: no scripted send. */
  autoAttachSendDelayMs?: number;
  /** Showcase/demo (session-title capture): delay after mount before the
   *  scripted Back fires — the same back handler the human header tap
   *  invokes, so the chats list remounts and re-reads the naming evidence
   *  this conversation observed. Absent: no scripted back. */
  autoBackDelayMs?: number;
}) {
  const [sessionId, setSessionId] = useState<string | null>(props.sessionId ?? null);
  const [summary, setSummary] = useState<RemoteSessionSummary | null>(null);
  const [view, setView] = useState<ConversationViewState | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "raw">("chat");
  const [panes, setPanes] = useState<RemotePaneSummary[] | null>(null);
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState(props.composerDraft ?? "");
  const [busy, setBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  // Composer attachments (D5): local previews + uploaded refs. The ref
  // mirror keeps the async pick/upload callbacks honest without stale
  // closures; ids are app-local and never leave the process.
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const attachmentCounter = useRef(0);
  const applyPending = useCallback((next: PendingAttachment[]) => {
    pendingAttachmentsRef.current = next;
    setPendingAttachments(next);
  }, []);

  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const projectionRef = useRef<ConversationProjection | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const autoSteerFired = useRef(false);
  const autoBackFired = useRef(false);

  // Scripted back (session-title capture): fires the REAL back handler a
  // human taps, once, after the delay — the chats list then remounts and
  // re-reads the naming evidence this conversation observed. The handler
  // rides a ref: it is a fresh closure every render, and the timer must
  // not restart on re-renders.
  const onBackRef = useRef(props.onBack);
  onBackRef.current = props.onBack;
  useEffect(() => {
    if (autoBackFired.current || props.autoBackDelayMs === undefined) return;
    autoBackFired.current = true;
    const timer = setTimeout(() => onBackRef.current?.(), props.autoBackDelayMs);
    return () => clearTimeout(timer);
  }, [props.autoBackDelayMs]);

  // M2 attachments (D5): app-local body cache over the gateway client seam;
  // a cache change re-renders via a reducer bump (no external store).
  const attachmentCache = useMemo(
    () =>
      new AttachmentCache((fetchedSessionId, attachmentId) =>
        props.client.fetchSessionAttachment(fetchedSessionId, attachmentId),
      ),
    [props.client],
  );
  const [, bumpAttachments] = useReducer((count: number) => count + 1, 0);
  useEffect(
    () => attachmentCache.subscribe(() => bumpAttachments()),
    [attachmentCache, bumpAttachments],
  );

  const publish = useCallback(() => {
    setView(projectionRef.current?.snapshot() ?? null);
  }, []);

  // Session resolution: direct id, or find the session correlated to the
  // run (decision D1 adapter metadata). Honest retry while the inventory
  // does not know the run's session yet.
  useEffect(() => {
    if (props.sessionId !== undefined) {
      setSessionId(props.sessionId);
      return;
    }
    const runId = props.runId;
    if (runId === undefined) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const poll = () => {
      props.client
        .listSessions()
        .then((list) => {
          if (cancelled) return;
          const found = list.sessions.find((session) => session.runId === runId);
          if (found !== undefined) {
            setSessionId(found.sessionId);
          } else {
            timer = setTimeout(poll, 4000);
          }
        })
        .catch(() => {
          if (!cancelled) timer = setTimeout(poll, 4000);
        });
    };
    poll();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [props.client, props.runId, props.sessionId]);

  // Stream observation: identical cursor/retry semantics to the other
  // families; sessionGone closes the stream (client-side).
  useEffect(() => {
    if (sessionId === null) return;
    const controller = new AbortController();
    const projection = new ConversationProjection(sessionId);
    projectionRef.current = projection;
    publish();

    props.client
      .observeSession(
        sessionId,
        (event) => {
          projection.apply(event);
          // Naming evidence fold (operator-approved title rule): first
          // utterance / start time / source. Publish() re-renders, so the
          // header recomputes from the index on the same tick.
          props.naming?.observe(sessionId, event);
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

    // Best-effort inventory metadata (title / state badge).
    props.client
      .listSessions()
      .then((list) => {
        const found = list.sessions.find((session) => session.sessionId === sessionId);
        if (found !== undefined) {
          projection.applySummary(found);
          setSummary(found);
          publish();
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [sessionId, props.client, publish]);

  // Raw toggle target: best-effort terminal inventory when entering raw mode.
  useEffect(() => {
    if (mode !== "raw") return;
    const controller = new AbortController();
    props.client
      .listPanes()
      .then((page) => {
        if (!controller.signal.aborted) setPanes(page.panes);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [mode, props.client]);

  // Follow the tail while attached (D6; terminal-view precedent).
  useEffect(() => {
    if (following && mode === "chat" && (view?.items.length ?? 0) > 0) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [following, mode, view?.items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const next = nextFollowState(followingRef.current, distanceFromBottom);
    if (next !== followingRef.current) {
      followingRef.current = next;
      setFollowing(next);
    }
  };

  const sendText = (text: string) => {
    const target = composerTarget({ running: view?.running ?? false, runId: props.runId ?? null });
    setBusy(true);
    setComposerError(null);
    // First send and Resend (C10) share this one path: the draft is only
    // cleared on success, so a failure leaves it in place for the retry.
    void sendComposerText(props.client, {
      target,
      text,
      onSuccess: (result) => {
        if (target.kind === "steer") {
          // Local pending marker; steer_queued / source=steer frames confirm
          // and fold it (D4 §4).
          projectionRef.current?.appendLocalSteer(text);
          publish();
        } else if (result.runId !== null && props.onOpenRun !== undefined) {
          props.onOpenRun(result.runId);
        }
        setDraft("");
      },
      onFailure: (message) => setComposerError(message),
    }).finally(() => setBusy(false));
  };

  const submit = () => {
    if (busy) return;
    // Send lock (task `conversation-safearea-fix`): while the run's session
    // is not observed yet, a send here would route the draft to a brand-new
    // run and navigate away — reading as a silent failure. The composer's
    // send control is locked and the waiting notice above the timeline owns
    // the explanation; the lock lifts the moment the session appears.
    if (sessionId === null) return;
    if (pendingAttachmentsRef.current.length > 0) {
      submitWithAttachments();
      return;
    }
    const text = draft.trim();
    if (text.length === 0) return;
    sendText(text);
  };

  /** D5 send with images: upload every un-uploaded photo to THIS session,
   * then deliver {text, refs} over the live-session input endpoint (the
   * only wire path that carries refs — it bypasses the steer mailbox by
   * design; the observed user_message frame is the delivery evidence). */
  const submitWithAttachments = () => {
    const text = draft.trim();
    const target = sessionId;
    if (target === null) {
      // Unreachable while the attach control is disabled; kept honest.
      setComposerError(ATTACH_SESSION_REQUIRED_NOTICE);
      return;
    }
    setBusy(true);
    setComposerError(null);
    void sendComposerWithAttachments(props.client, {
      sessionId: target,
      text,
      pending: pendingAttachmentsRef.current,
      readBlob: readPhotoBlob,
      onUploaded: (localId, ref) => {
        applyPending(
          pendingAttachmentsRef.current.map((p) => (p.localId === localId ? { ...p, ref } : p)),
        );
      },
      onSuccess: () => {
        setDraft("");
        applyPending([]);
      },
      onFailure: (message) => setComposerError(message),
    }).finally(() => setBusy(false));
  };

  // Attach flow (D5): library or camera via the native module; every
  // non-picked outcome lands in the composer error line (honest state),
  // and the per-input cap refuses the appEND with its own notice.
  const pickPhoto = useCallback(
    async (source: PhotoSource) => {
      const outcome = await createNativePhotoPicker().pickPhoto(source);
      if (outcome.kind === "cancelled") return;
      if (outcome.kind === "denied") {
        setComposerError(
          outcome.source === "camera" ? CAMERA_DENIED_NOTICE : PHOTO_LIBRARY_DENIED_NOTICE,
        );
        return;
      }
      if (outcome.kind === "unavailable") {
        setComposerError(PHOTOS_UNAVAILABLE_NOTICE);
        return;
      }
      attachmentCounter.current += 1;
      const next = appendPendingAttachment(
        pendingAttachmentsRef.current,
        outcome.photo,
        `att_local_${attachmentCounter.current}`,
      );
      if (next === null) {
        setComposerError(ATTACH_LIMIT_NOTICE);
        return;
      }
      setComposerError(null);
      applyPending(next);
    },
    [applyPending],
  );

  const onAttach = () => {
    if (sessionId === null) return; // control is disabled without a session
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [ACTION_PHOTO_LIBRARY_LABEL, ACTION_CAMERA_LABEL, ACTION_CANCEL_LABEL],
        cancelButtonIndex: 2,
      },
      (buttonIndex) => {
        if (buttonIndex === 0) void pickPhoto("library");
        else if (buttonIndex === 1) void pickPhoto("camera");
      },
    );
  };

  // Showcase/demo (v9 attach): the scripted Send — the same submit the
  // human send tap fires, so pending thumbnails ride the production
  // upload→input path (nothing demo-specific on the wire). Fire-once per
  // mount; an empty composer at fire time is an honest no-op.
  const submitRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    submitRef.current = submit;
  });
  const autoAttachSendDelayMs = props.autoAttachSendDelayMs;
  const autoSendFired = useRef(false);
  useEffect(() => {
    if (autoAttachSendDelayMs === undefined || autoSendFired.current) return;
    autoSendFired.current = true;
    const timer = setTimeout(() => submitRef.current(), autoAttachSendDelayMs);
    return () => clearTimeout(timer);
  }, [autoAttachSendDelayMs]);

  // Showcase/demo (v4): fire the exact Steer path a human tap would invoke,
  // once the observed session turn is running. If the turn ended during the
  // delay, retry briefly, then skip honestly — firing while idle would
  // submit a new run instead of a steer, which is not this affordance's job.
  useEffect(() => {
    const text = props.autoSteerText;
    if (text === undefined || props.runId === undefined || autoSteerFired.current) return;
    if (view?.running !== true) return;
    autoSteerFired.current = true;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (projectionRef.current?.snapshot().running === true) {
        sendText(text);
        return;
      }
      if (retries >= 10) return;
      retries += 1;
      timer = setTimeout(fire, 3000);
    };
    timer = setTimeout(fire, props.autoSteerDelayMs ?? 6000);
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
    // Fire-once affordance keyed to the launch-time steer text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoSteerText, props.autoSteerDelayMs, props.runId, view?.running]);

  // Showcase/demo (v9 attach): one scripted scroll-up after mount. It
  // reuses scrollRef + the existing onScroll epsilon, so `following` flips
  // exactly as it does for a human flick and the pill renders from the
  // existing follow state alone. Absent the prop: no effect at all.
  const autoScrollUpDelayMs = props.autoScrollUpDelayMs;
  useEffect(() => {
    if (autoScrollUpDelayMs === undefined) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }, autoScrollUpDelayMs);
    return () => clearTimeout(timer);
  }, [autoScrollUpDelayMs]);

  // Showcase/demo (v9 attach): the scripted attach — feeds the SAME pending
  // state the picker's "picked" continuation feeds (appendPendingAttachment,
  // same counter, same honest cap refusal), with demo bodies fetched over
  // the M2 GET route standing in for photo-library picks. Fire-once per
  // mount, after the session is resolved (the preview/upload target).
  const autoAttachAssetIds = props.autoAttachAssetIds;
  const autoAttachDelayMs = props.autoAttachDelayMs;
  const autoAttachFired = useRef(false);
  useEffect(() => {
    if (sessionId === null || autoAttachAssetIds === undefined || autoAttachFired.current) return;
    autoAttachFired.current = true;
    const timer = setTimeout(() => {
      void (async () => {
        for (const attachmentId of autoAttachAssetIds) {
          try {
            const body = await props.client.fetchSessionAttachment(sessionId, attachmentId);
            attachmentCounter.current += 1;
            const next = appendPendingAttachment(
              pendingAttachmentsRef.current,
              {
                uri: props.client.sessionAttachmentUrl(sessionId, attachmentId),
                mimeType: body.mimeType,
                byteLen: body.bytes.byteLength,
              },
              `att_local_${attachmentCounter.current}`,
            );
            if (next !== null) applyPending(next); // null = cap reached: honest skip
          } catch {
            // A missing/unreadable demo body just doesn't attach.
          }
        }
      })();
    }, autoAttachDelayMs ?? 3000);
    return () => clearTimeout(timer);
  }, [sessionId, autoAttachAssetIds, autoAttachDelayMs, props.client, applyPending]);

  const running = view?.running === true;
  const steerMode = running && props.runId !== undefined;

  // Header naming (operator-approved rule): the first user utterance wins;
  // without one, `새 세션` + start time once ANY frame was observed. The
  // adapter label and the compact-id fallback cover sessions with no
  // observed evidence — never a fabricated title.
  const evidence = sessionId !== null ? (props.naming?.evidence(sessionId) ?? null) : null;
  const heading =
    (evidence !== null ? sessionTitle(evidence) : null) ??
    summary?.title ??
    fallbackHeading(props.runId, sessionId);

  // Honest notices (C10): kind-owned phrases with kind-owned tone — only
  // the reconnecting notice raises the visual temperature (warn triad);
  // ended/waiting stay at the muted baseline (§1, intensity proportional).
  const notices: { key: string; text: string; warn: boolean }[] = [];
  if (sessionId === null)
    notices.push({ key: "waiting", text: WAITING_FOR_SESSION_NOTICE, warn: false });
  if (view?.stale === true) notices.push({ key: "stale", text: RECONNECTING_NOTICE, warn: true });
  if (view?.ended === true || view?.sessionEnded === true)
    notices.push({ key: "ended", text: SESSION_ENDED_NOTICE, warn: false });

  const body = (
    <KeyboardAvoidingView behavior="padding" style={styles.root}>
      {/* Status-bar-substitute header (task `header-statusbar-redesign`):
       * back chevron + title in the LEFT flank, running signal + Raw/Chat
       * toggle in the RIGHT corner — the Dynamic Island stays the only
       * centered element. The insets the header does not consume (home
       * indicator, landscape notch) stay with the column below. */}
      <AppHeader
        title={heading}
        leading={
          props.onBack !== undefined ? (
            <TouchableOpacity
              onPress={props.onBack}
              hitSlop={12}
              style={styles.backButton}
              activeOpacity={press.activeOpacity}
            >
              <Icon role="back" size={type.title.fontSize} color={colors.inkMute} />
            </TouchableOpacity>
          ) : undefined
        }
        actions={
          <>
            {/* Side-menu hamburger (task `mobile-ux-patterns`): the
             * auxiliary surface for screens whose tab bar is hidden. */}
            {props.onOpenMenu !== undefined ? (
              <TouchableOpacity
                onPress={props.onOpenMenu}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.menuButton}
                activeOpacity={press.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Menu"
              >
                <Icon role="menu" size={type.title.fontSize} color={colors.inkMute} />
              </TouchableOpacity>
            ) : null}
            {running ? (
              <View style={styles.runningBadge}>
                <RunningDot />
                <DynText style={[styles.runningText, { color: colors.ok }]}>running</DynText>
              </View>
            ) : null}
            <TouchableOpacity
              onPress={() => setMode(mode === "chat" ? "raw" : "chat")}
              hitSlop={{ top: 14, bottom: 14, left: 16, right: 16 }}
              activeOpacity={press.activeOpacity}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === "raw" }}
            >
              {/* S-08: the toggle is a chip — hairline-bordered surface fill
               * marks it as a control, and the label names the DESTINATION. */}
              <View style={styles.toggleChip}>
                <DynText style={styles.toggle}>{mode === "chat" ? "Raw" : "Chat"}</DynText>
              </View>
            </TouchableOpacity>
          </>
        }
      />
      <View
        style={[
          styles.column,
          {
            paddingTop: space.s,
            marginLeft: insets.left,
            marginRight: insets.right,
          },
        ]}
      >
        {notices.map((notice) => (
          <DynText
            key={notice.key}
            style={[styles.notice, notice.warn === true && styles.noticeWarn]}
          >
            {notice.warn ? `${glyph.statusRunning} ${notice.text}` : notice.text}
          </DynText>
        ))}
        {/* Stream failures render as a one-line state summary — never a raw
         * transport dump (C10). */}
        {streamError !== null ? (
          <DynText style={styles.notice}>{STREAM_DISCONNECTED_NOTICE}</DynText>
        ) : null}

        {mode === "raw" ? (
          <ScrollView style={styles.timeline} contentContainerStyle={styles.timelineContent}>
            <DynText style={styles.rawHeading}>{TERMINALS_HEADING}</DynText>
            <PaneList panes={panes} onOpenPane={props.onOpenPane} />
          </ScrollView>
        ) : (
          <View style={styles.timelineWrap}>
            <ScrollView
              ref={scrollRef}
              onScroll={onScroll}
              scrollEventThrottle={16}
              style={styles.timeline}
              contentContainerStyle={styles.timelineContent}
            >
              {timelineRows(view?.items ?? []).map((row: TimelineRow) =>
                row.kind === "dateHeader" ? (
                  // Date headers (C8) are render-derived rows: their key is
                  // prefixed "hdr:" and never collides with the D4 item keys.
                  <DynText key={row.rowKey} style={styles.dateHeader}>
                    {row.label}
                  </DynText>
                ) : (
                  <Entrance key={row.rowKey}>
                    <TimelineItem
                      item={row.item}
                      expanded={
                        row.item.kind === "tool"
                          ? toolCardExpanded(row.item.state, expandedOverrides[row.item.toolCallId])
                          : false
                      }
                      onToggleTool={
                        row.item.kind === "tool"
                          ? () => {
                              const item = row.item;
                              if (item.kind !== "tool") return; // narrowed above; TS keeps honest
                              // Fold transition (C16): the shared motion config.
                              configureCardFold();
                              setExpandedOverrides((prev) => ({
                                ...prev,
                                [item.toolCallId]: !toolCardExpanded(
                                  item.state,
                                  prev[item.toolCallId],
                                ),
                              }));
                            }
                          : undefined
                      }
                      sessionId={sessionId ?? undefined}
                      attachmentCache={attachmentCache}
                      showOccurredAt={row.showOccurredAt}
                    />
                  </Entrance>
                ),
              )}
              {/* Empty state (C9): one centered block — what is empty + next
               * action; copy owned by ui/copy.ts. */}
              {shouldRenderEmptyState(view?.items.length ?? 0) && sessionId !== null ? (
                <View style={styles.emptyState}>
                  <Icon role="busy" size={type.display.fontSize} color={colors.inkFaint} />
                  <DynText style={styles.emptyTitle}>{EMPTY_TIMELINE_TITLE}</DynText>
                  <DynText style={styles.emptyHint}>{EMPTY_TIMELINE_HINT}</DynText>
                </View>
              ) : null}
            </ScrollView>
            {/* Jump-to-bottom pill (C11): visible only when the follow
             * machine (existing nextFollowState) says we left the tail; no
             * new scroll state. Re-entry reuses the same onScroll epsilon. */}
            {mode === "chat" && !following ? (
              <Entrance style={styles.jumpPillWrap}>
                <TouchableOpacity
                  style={styles.jumpPill}
                  activeOpacity={press.activeOpacity}
                  onPress={() => {
                    followingRef.current = true;
                    setFollowing(true);
                    scrollRef.current?.scrollToEnd({ animated: true });
                  }}
                >
                  <DynText style={styles.jumpPillText}>
                    {glyph.foldOpen} {JUMP_TO_BOTTOM_LABEL}
                  </DynText>
                </TouchableOpacity>
              </Entrance>
            ) : null}
          </View>
        )}

        {mode === "chat" ? (
          <Composer
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={submit}
            busy={busy}
            steerMode={steerMode}
            sendLocked={sessionId === null}
            error={composerError}
            onRetry={composerError !== null ? submit : undefined}
            attachments={pendingAttachments}
            attachAvailable={sessionId !== null}
            onAttach={onAttach}
            onRemoveAttachment={(localId) => {
              applyPending(removePendingAttachment(pendingAttachmentsRef.current, localId));
            }}
            paddingBottom={keyboardVisible ? space.s : Math.max(insets.bottom, space.s)}
          />
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
  // Edge-back gesture (task `mobile-ux-patterns`, iOS HIG interactive
  // pop): the swipe fires the SAME onBack the header chevron fires —
  // one verb, two paths. No back handler, no gesture (nothing to do).
  return props.onBack !== undefined ? (
    <BackSwipeZone onBack={props.onBack}>{body}</BackSwipeZone>
  ) : (
    body
  );
}

/** Raw-toggle pane list: loading, honest empty state, or the tappable
 * pane rows (the secondary "raw" surface, decision D6). */
function PaneList(props: {
  panes: RemotePaneSummary[] | null;
  onOpenPane?: (paneId: string) => void;
}) {
  if (props.panes === null) {
    return <DynText style={styles.notice}>loading terminals…</DynText>;
  }
  if (props.panes.length === 0) {
    return <DynText style={styles.notice}>No terminals observed.</DynText>;
  }
  return (
    <>
      {props.panes.map((pane) => (
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
    </>
  );
}

/** The header's running signal: the closed status dot in a slow two-frame
 * pulse (motion.pulse) — a frequent state stays quiet (guidance §1), and
 * the mechanism is the shared useBlink, not a bespoke timer. */
function RunningDot() {
  const opacity = useBlink(motion.pulse, 1, 0.35);
  return <Icon role="statusDot" size={type.glyph.fontSize} color={colors.ok} style={{ opacity }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  column: {
    flex: 1,
    width: "100%",
    maxWidth: COLUMN_MAX_WIDTH,
    alignSelf: "center",
    paddingHorizontal: space.l,
  },
  backButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  // Side-menu hamburger (task `mobile-ux-patterns`): same header-corner
  // grammar as the back chevron — quiet glyph on the 44pt touch floor.
  menuButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  runningBadge: { flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 0 },
  runningText: { ...type.captionStrong },
  // S-08: a chip affordance (surface fill + hairline, radius.m) — visible
  // control, not bare text.
  toggleChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    paddingHorizontal: space.s,
    paddingVertical: space.xxs,
  },
  toggle: { ...type.captionStrong, color: colors.inkMute },
  notice: { ...type.caption, color: colors.inkMute, marginBottom: space.xxs },
  timeline: { flex: 1 },
  timelineContent: { paddingBottom: space.l },
  // §2 system-readout section label (same readout tier as the run screen's
  // Terminals label and the chats list's section labels — one hierarchy
  // vocabulary across surfaces).
  rawHeading: {
    ...type.captionStrong,
    color: colors.inkFaint,
    textTransform: "uppercase",
    ...READOUT_STYLE,
    marginBottom: space.s,
    marginTop: space.m,
  },
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
  // C10: only the reconnect notice raises the tone (warn triad).
  noticeWarn: { ...type.captionStrong, color: colors.warn },
  // C8: centered date-section caption (render-derived row).
  dateHeader: {
    ...type.caption,
    color: colors.inkFaint,
    textAlign: "center",
    marginTop: space.l,
    marginBottom: space.xs,
  },
  // C11: jump-to-bottom pill, lower-right overlay inside the timeline area.
  timelineWrap: { flex: 1 },
  // Detached chrome gets the float elevation level: the wrapper owns the
  // anchor point; the pill owns the visuals and the shadow.
  jumpPillWrap: { position: "absolute", right: 0, bottom: space.s },
  jumpPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    backgroundColor: colors.surface,
    ...elevation.float,
    borderWidth: 1,
    borderColor: colors.hairline,
    // Radius.m: the pill radius is reserved for the send circle, status
    // badges, and the sheet handle (canon §3 pill 재판정) — floating
    // chrome is still a button.
    borderRadius: radius.m,
    paddingHorizontal: space.m,
    paddingVertical: space.m,
    minHeight: 44,
  },
  jumpPillText: { ...type.captionStrong, color: colors.ink },
  // C9: centered empty-state block — what is empty + the next action.
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    paddingVertical: space.xxl,
  },
  emptyTitle: { ...type.bodyStrong, color: colors.ink },
  emptyHint: { ...type.caption, color: colors.inkMute, textAlign: "center" },
});
