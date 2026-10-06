/**
 * Conversation timeline rows (GUI conversation v1, decision
 * 2026-xx-gui-conversation D4/D6; detail pass in decision
 * 2026-xx-codex-detail-checklist C1–C7): user bubbles (+ inline
 * attachments), assistant text through the lightweight markdown renderer
 * with a streaming cursor, collapsible tool cards with a one-line folded
 * summary, honest truncation, and clock captions supplied by the screen.
 *
 * Presentation only: fold state lives in the screen (D4 §5), state comes
 * from the projection, and every color/glyph/copy reference goes through
 * the ui/ vocabulary.
 */
import { Image, StyleSheet, TouchableOpacity, View } from "react-native";

import type { ConversationItem } from "../state/conversationProjection";
import {
  AttachmentCache,
  formatByteLen,
  isImageMime,
  type AttachmentView,
  type SessionAttachmentRef,
} from "../state/attachmentCache";
import { clockTime } from "./time-format";
import { MarkdownView } from "./markdown-view";
import { toolArgsSummary, toolResultView } from "./tool-summary";
import { DynText } from "../ui/DynText";
import { useBlink } from "../ui/motion";
import { Icon } from "../ui/Icon";
import { glyph, type IconRole } from "../ui/glyphs";
import { EMPTY_RESULT_NOTICE, TRUNCATED_NOTICE } from "../ui/copy";
import { colors, motion, press, radius, space, type } from "../ui/tokens";

/** Closed status vocabulary (D4 §3): role + text + color role. The state
 * word carries the same color as the mark (C4) — color removal still
 * leaves the word (ui-ux-guidance §5, color-independence). Marks render
 * through ui/Icon (task `fab-icons`); the word stays DynText. */
const TOOL_STATUS: Record<
  Extract<ConversationItem, { kind: "tool" }>["state"],
  { role: IconRole; text: string; color: string }
> = {
  running: { role: "statusRunning", text: "running…", color: colors.warn },
  done: { role: "statusDone", text: "done", color: colors.ok },
  error: { role: "statusError", text: "error", color: colors.danger },
};

const STEER_STATUS_TEXT = {
  pending: "pending",
  queued: "queued",
  delivered: "delivered",
} as const;

/** Streaming cursor (C7): a two-frame opacity blink from the shared motion
 * vocabulary — the mechanism (ui/motion useBlink) owns the timer; this
 * signal only registers its period (tokens.motion.blink) and intensity. */
function StreamingCursor() {
  const opacity = useBlink(motion.blink, 1, 0.15);
  return <DynText style={[styles.cursor, { opacity }]}>{glyph.cursor}</DynText>;
}

function ToolCard(props: {
  item: Extract<ConversationItem, { kind: "tool" }>;
  expanded: boolean;
  onToggle?: () => void;
}) {
  const { item, expanded } = props;
  const status = TOOL_STATUS[item.state];
  // Folded one-line argument summary (C3): derived at render time from
  // argsJson — never copied into state; one line, caption tier, muted ink.
  const summary = toolArgsSummary(item.argsJson);
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={props.onToggle}
      activeOpacity={press.activeOpacity}
    >
      <View style={styles.cardHeaderRow}>
        <Icon role={status.role} size={type.captionStrong.fontSize} color={status.color} />
        <DynText style={styles.cardName} numberOfLines={1}>
          {item.toolName.length > 0 ? item.toolName : "(tool)"}
        </DynText>
        {summary.length > 0 ? (
          <DynText style={styles.cardSummary} numberOfLines={1}>
            {summary}
          </DynText>
        ) : null}
        <DynText style={[styles.cardState, { color: status.color }]} numberOfLines={1}>
          {status.text}
          {item.interrupted ? " · interrupted" : ""}
        </DynText>
        <Icon
          role={expanded ? "foldOpen" : "foldClosed"}
          size={type.caption.fontSize}
          color={colors.inkFaint}
        />
      </View>
      {expanded ? (
        <View style={styles.cardBody}>
          {item.argsJson.length > 0 ? (
            <DynText style={styles.cardMono} numberOfLines={0}>
              args: {item.argsJson}
              {item.argsTruncated ? ` ${TRUNCATED_NOTICE}` : ""}
            </DynText>
          ) : null}
          {/* Honest result rendering (C5): decided by the pure helper — a
           * running card has no result area yet; a closed card with an
           * empty result says so explicitly. */}
          <ToolResultBody item={item} />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

/** Result area of an expanded tool card (C5): nothing while running, the
 * explicit empty notice, or the raw result text (truncation marked). */
function ToolResultBody(props: { item: Extract<ConversationItem, { kind: "tool" }> }) {
  const result = toolResultView(props.item);
  if (result.kind === "hidden") return null;
  if (result.kind === "empty") {
    return <DynText style={styles.cardResultEmpty}>{EMPTY_RESULT_NOTICE}</DynText>;
  }
  return (
    <DynText style={styles.cardMono} numberOfLines={0}>
      result: {result.text}
      {result.truncated ? ` ${TRUNCATED_NOTICE}` : ""}
    </DynText>
  );
}

/**
 * One attachment reference (M2, decision D5). Image refs resolve to inline
 * renders via the app-local AttachmentCache (body fetched out-of-band,
 * once); non-image refs render as file cards from the metadata alone. All
 * states are honest: loading, and unavailable (evicted/never-stored body)
 * included.
 */
function AttachmentItem(props: { attachment: SessionAttachmentRef; view: AttachmentView }) {
  const { attachment: ref, view } = props;
  if (!isImageMime(ref.mimeType)) {
    // File card: metadata-only render (D5 — files are card concerns; pi
    // surfaces file contents through read-tool tool cards instead).
    return (
      <View style={styles.attachmentFileCard}>
        <View style={styles.attachmentFileText}>
          <DynText style={styles.attachmentFileName} numberOfLines={1}>
            {ref.attachmentId}
          </DynText>
          <DynText style={styles.attachmentFileMeta} numberOfLines={1}>
            {ref.mimeType} · {formatByteLen(ref.byteLen)}
          </DynText>
        </View>
      </View>
    );
  }
  if (view.status === "ready") {
    return (
      <Image source={{ uri: view.dataUri }} style={styles.attachmentImage} resizeMode="contain" />
    );
  }
  return (
    <View style={styles.attachmentPlaceholder}>
      <DynText style={styles.attachmentFileMeta} numberOfLines={1}>
        {view.status === "loading" ? "photo loading…" : "photo unavailable"}
      </DynText>
    </View>
  );
}

function AttachmentList(props: {
  sessionId: string;
  imageCount: number;
  attachments: readonly SessionAttachmentRef[];
  cache: AttachmentCache;
}) {
  const { sessionId, attachments, cache } = props;
  return (
    <View style={styles.attachmentList}>
      {attachments.map((ref) => {
        cache.ensure(sessionId, ref);
        return <AttachmentItem key={ref.attachmentId} attachment={ref} view={cache.view(ref)} />;
      })}
      {/* Honesty (D5): the observed image count can exceed the servable
       * subset (unobservable bodies, per-message/store caps, eviction). */}
      {props.imageCount > attachments.length ? (
        <DynText style={styles.itemMeta}>
          {glyph.attach} {props.imageCount} observed · {attachments.length} available
        </DynText>
      ) : null}
    </View>
  );
}

/** Inline attachments of a user bubble (D5): the live list when the
 * session + cache are available, else the honest unavailable count. */
function UserAttachments(props: {
  sessionId?: string;
  attachmentCache?: AttachmentCache;
  item: Extract<ConversationItem, { kind: "user" }>;
}) {
  const { item } = props;
  if (
    props.sessionId !== undefined &&
    props.attachmentCache !== undefined &&
    item.attachments.length > 0
  ) {
    return (
      <AttachmentList
        sessionId={props.sessionId}
        imageCount={item.imageCount}
        attachments={item.attachments}
        cache={props.attachmentCache}
      />
    );
  }
  if (item.imageCount > 0) {
    return (
      <DynText style={styles.itemMeta}>
        {glyph.attach} {item.imageCount} (attachments unavailable)
      </DynText>
    );
  }
  return null;
}

/** One conversation timeline row: user bubble (+ inline attachments),
 * assistant text, collapsible tool card, or steer delivery marker (D4).
 * `showOccurredAt` (C6; S-06 minute groups in task `redesign-implement`)
 * is computed by the screen — first row only of a wall-clock minute
 * group. */
export function TimelineItem(props: {
  item: ConversationItem;
  expanded: boolean;
  onToggleTool?: () => void;
  sessionId?: string;
  attachmentCache?: AttachmentCache;
  showOccurredAt?: boolean;
}) {
  const { item } = props;
  const caption =
    props.showOccurredAt === true && "occurredAt" in item ? (
      <DynText style={styles.timeCaption}>{clockTime(item.occurredAt)}</DynText>
    ) : null;
  if (item.kind === "user") {
    return (
      <View>
        {caption}
        <View style={styles.userRow}>
          <View style={styles.userBubble}>
            <DynText style={styles.userText} numberOfLines={0}>
              {item.text}
            </DynText>
            <UserAttachments
              sessionId={props.sessionId}
              attachmentCache={props.attachmentCache}
              item={item}
            />
            {item.source === "api" ? <DynText style={styles.itemMeta}>source: api</DynText> : null}
          </View>
        </View>
      </View>
    );
  }
  if (item.kind === "assistant") {
    return (
      <View style={styles.assistantRow}>
        {caption}
        {/* Markdown render (C1) + streaming cursor/busy row (C7): an empty
         * buffer mid-stream shows the busy glyph, a non-empty one trails
         * the cursor; the final frame clears both. */}
        {item.final === false && item.text.length === 0 ? (
          <Icon role="busy" size={type.caption.fontSize} color={colors.inkFaint} />
        ) : (
          <View style={styles.assistantTextWrap}>
            <MarkdownView text={item.text} />
            {item.final === false ? <StreamingCursor /> : null}
          </View>
        )}
        {item.truncated ? <DynText style={styles.itemMeta}>{TRUNCATED_NOTICE}</DynText> : null}
      </View>
    );
  }
  if (item.kind === "tool") {
    return (
      <View>
        {caption}
        <ToolCard item={item} expanded={props.expanded} onToggle={props.onToggleTool} />
      </View>
    );
  }
  // Steer marker: a dim, centered delivery-evidence line, folded with the
  // steer user message once delivered (D4 §4).
  return (
    <View style={styles.steerRow}>
      <DynText style={styles.steerText} numberOfLines={0}>
        {glyph.steer} steer · {STEER_STATUS_TEXT[item.status]} · “{item.text}”
      </DynText>
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    marginTop: space.m,
  },
  userBubble: {
    maxWidth: "85%",
    backgroundColor: colors.userBubble,
    borderRadius: radius.l,
    // Bubble tail: the one 4pt corner (radius.xxs) gives the user bubble
    // its direction — a composite corner, not a new shape family.
    borderBottomRightRadius: radius.xxs,
    paddingHorizontal: space.l,
    paddingVertical: space.m,
  },
  userText: { ...type.body, color: colors.ink, flexShrink: 1 },
  timeCaption: {
    ...type.caption,
    color: colors.inkFaint,
    marginTop: space.m,
    alignSelf: "flex-start",
  },
  itemMeta: { ...type.caption, color: colors.inkMute, marginTop: space.xxs },
  cursor: { ...type.body, color: colors.ink },
  // M2 attachments (D5): inline images + metadata-only file cards.
  attachmentList: { marginTop: space.s, gap: space.s },
  attachmentImage: {
    width: 200,
    height: 150,
    // radius.m harmonizes with tool/code cards at the same nesting depth.
    borderRadius: radius.m,
    backgroundColor: colors.surfaceAlt,
  },
  attachmentPlaceholder: {
    width: 200,
    height: 60,
    borderRadius: radius.m,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentFileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.s,
    paddingHorizontal: space.s,
    paddingVertical: space.s,
  },
  attachmentFileText: { flexShrink: 1 },
  attachmentFileName: { ...type.captionStrong, color: colors.ink },
  attachmentFileMeta: { ...type.caption, color: colors.inkMute },
  assistantRow: { marginTop: space.m },
  assistantTextWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" },
  card: {
    marginTop: space.m,
    backgroundColor: colors.surface,
    // Edge rule (decision 2026-xx-minimal-design-spec S5): the hairline
    // border carries the edge — no resting shadow on the near-black bg.
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    paddingVertical: space.m,
    paddingHorizontal: space.m,
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: space.s },
  cardName: { ...type.bodyStrong, color: colors.ink, flexShrink: 1 },
  cardSummary: { ...type.caption, color: colors.inkMute, flexShrink: 1 },
  cardState: { ...type.caption, flexShrink: 0 },
  cardBody: {
    marginTop: space.s,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.s,
    padding: space.s,
    gap: space.xs,
  },
  cardMono: { ...type.mono, fontFamily: "Menlo", color: colors.inkMute },
  cardResultEmpty: { ...type.caption, color: colors.inkFaint, fontStyle: "italic" },
  steerRow: { alignItems: "center", marginTop: space.m },
  steerText: { ...type.caption, color: colors.inkFaint },
});
