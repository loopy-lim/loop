/**
 * Conversation composer (GUI conversation v1, decision D6): a multiline
 * input whose send is a steer while the session's turn is mid-flight and a
 * new prompt otherwise. The screen owns submit semantics (mailbox target,
 * pending steer markers); this widget owns only the input affordance and
 * its honest states: busy, empty-disabled, and the submit error line with
 * its Resend affordance (C10 — same submit route, preserved draft).
 *
 * Attachments (decision D5, task `composer-attach-and-highlighting`): an
 * attach control beside the input and a thumbnail strip above it. The
 * widget renders only — the picker, the upload pipeline, and the send
 * routing live in the screen; the strip is fed by PendingAttachment state
 * (local preview uri + optional uploaded ref), and removal is delegated
 * per thumbnail. Photos count as content: send enables on photos alone.
 */
import { Image, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import { useState } from "react";

import type { PendingAttachment } from "../state/attachFlow";
import { DynText, MAX_FONT_SCALE } from "../ui/DynText";
import { Icon } from "../ui/Icon";
import { glyph } from "../ui/glyphs";
import {
  ATTACH_PHOTO_LABEL,
  RESEND_BUTTON_LABEL,
  REMOVE_ATTACHMENT_LABEL,
  STEER_MARK_LABEL,
} from "../ui/copy";
import { colors, press, radius, space, type } from "../ui/tokens";

export function Composer(props: {
  draft: string;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  busy: boolean;
  /** True while the session turn is running AND a run targets the steer mailbox. */
  steerMode: boolean;
  /** True while the run's session is not observed yet — sends stay locked
   * (task `conversation-safearea-fix`): routing the draft to a brand-new
   * run while the surface is still connecting reads as a silent failure.
   * The waiting notice above the timeline owns the explanation. */
  sendLocked?: boolean;
  error: string | null;
  /** Present only after a submit failure (C10): re-invokes the screen's
   * submit handler with the preserved draft. */
  onRetry?: () => void;
  /** Bottom inset (keyboard up yields to KeyboardAvoidingView; otherwise the
   * home indicator, per task `ui-codex-redesign`). */
  paddingBottom: number;
  /** Pending composer attachments (local previews; refs once uploaded). */
  attachments: readonly PendingAttachment[];
  /** Attach needs a resolved session (the upload target) — honest disable. */
  attachAvailable: boolean;
  onAttach: () => void;
  onRemoveAttachment: (localId: string) => void;
}) {
  const hasText = props.draft.trim().length > 0;
  const empty = !hasText && props.attachments.length === 0;
  const disabled = props.busy || empty || props.sendLocked === true;
  // Focus ring (canon §4): the input wrap's border rides the accent while
  // the composer is focused — one state mark, no fill change.
  const [inputFocused, setInputFocused] = useState(false);
  return (
    <View style={[styles.composer, { paddingBottom: props.paddingBottom }]}>
      {props.attachments.length > 0 ? (
        <View style={styles.thumbnailRow}>
          {props.attachments.map((attachment) => (
            <View key={attachment.localId} style={styles.thumbnail}>
              <Image
                source={{ uri: attachment.uri }}
                style={styles.thumbnailImage}
                resizeMode="cover"
              />
              {attachment.ref === null ? (
                <View style={styles.uploadBadge}>
                  <Icon role="busy" size={type.caption.fontSize} color={colors.inkMute} />
                </View>
              ) : null}
              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => props.onRemoveAttachment(attachment.localId)}
                accessibilityLabel={`${REMOVE_ATTACHMENT_LABEL} ${props.attachments.indexOf(attachment) + 1}`}
                // Touch target (44pt) without neighbor overlap: 20pt visual +
                // asymmetric slop that extends INTO the thumbnail only (left
                // 24 = 44pt wide; right 0 keeps it off the 8pt gutter), so
                // adjacent thumbnails' remove targets never collide.
                hitSlop={{ top: 12, bottom: 12, left: 24, right: 0 }}
                activeOpacity={press.activeOpacity}
              >
                <Icon role="remove" size={type.caption.fontSize} color={colors.ink} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      {props.steerMode ? (
        // Visible steer affordance (visibility contract): while the turn
        // runs, the composer states its routing — one quiet caption line
        // above the input pill, glyph + word, never a status color (§4:
        // the CTA stays the one emphasis). The placeholder carries the
        // sentence only while the draft is empty; this mark stays while
        // typing.
        <View style={styles.steerRow}>
          <DynText style={styles.steerMark}>
            {glyph.steer} {STEER_MARK_LABEL}
          </DynText>
        </View>
      ) : null}
      <View style={[styles.inputWrap, inputFocused && styles.inputWrapFocused]}>
        <TouchableOpacity
          style={[styles.attachButton, !props.attachAvailable && styles.attachDisabled]}
          onPress={props.onAttach}
          disabled={!props.attachAvailable || props.busy}
          accessibilityLabel={ATTACH_PHOTO_LABEL}
          activeOpacity={press.activeOpacity}
        >
          <Icon
            role="attach"
            size={type.title.fontSize}
            color={!props.attachAvailable ? colors.inkFaint : colors.inkMute}
          />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          multiline
          value={props.draft}
          onChangeText={props.onDraftChange}
          placeholder={props.steerMode ? "Steer the running task…" : "Describe the task for Loop"}
          placeholderTextColor={colors.inkFaint}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
        />
        <TouchableOpacity
          style={[styles.sendButton, disabled && styles.sendDisabled]}
          onPress={props.onSubmit}
          disabled={disabled}
          activeOpacity={press.activeOpacity}
          accessibilityLabel={props.steerMode ? "Steer" : "Send"}
        >
          <Icon
            role={props.busy ? "busy" : "send"}
            size={type.bodyStrong.fontSize}
            color={colors.ctaInk}
          />
        </TouchableOpacity>
      </View>
      {props.error !== null ? (
        <View style={styles.errorRow}>
          <DynText style={styles.composerError}>{props.error}</DynText>
          {props.onRetry !== undefined ? (
            <TouchableOpacity
              onPress={props.onRetry}
              // Resend rides the caption line (~17pt), so vertical slop 14
              // lifts the target to ~45pt (44pt floor, ui-ux-guidance §8).
              hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
              activeOpacity={press.activeOpacity}
            >
              <DynText style={styles.retryText}>{RESEND_BUTTON_LABEL}</DynText>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    paddingTop: space.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  // Pending-attachment strip (D5): local previews with remove + upload badge.
  thumbnailRow: { flexDirection: "row", flexWrap: "wrap", gap: space.s, paddingBottom: space.s },
  thumbnail: { width: 64, height: 64 },
  thumbnailImage: {
    width: "100%",
    height: "100%",
    // radius.m harmonizes with cards at the same nesting depth.
    borderRadius: radius.m,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  // Honest upload badge: "···" marks the not-yet-uploaded thumbnail.
  uploadBadge: {
    position: "absolute",
    left: space.xs,
    bottom: space.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs + space.xxs,
    opacity: 0.9,
  },
  removeButton: {
    position: "absolute",
    top: -space.xs,
    right: -space.xs,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  // The composer is the surface's raised control: the hairline carries
  // the edge (decision 2026-xx-minimal-design-spec S5 — no resting shadow).
  // Focus ring (canon §4): the accent marks the focused composer only.
  inputWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.s,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.l,
    paddingLeft: space.xs,
    paddingRight: space.s,
    paddingVertical: space.s,
  },
  inputWrapFocused: { borderColor: colors.accent },
  // Attach control (D5): 44×44 touch target inside the input pill.
  attachButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  attachDisabled: { opacity: 0.35 },
  input: {
    flex: 1,
    minHeight: 24,
    maxHeight: 120,
    color: colors.ink,
    fontSize: type.body.fontSize,
    paddingVertical: 4,
    textAlignVertical: "top",
  },
  // Touch target (C14): a full 44×44 send control (was 32 — below the
  // 44pt floor in ui-ux-guidance §8).
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.cta,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sendDisabled: { backgroundColor: colors.ctaDisabled },
  // Steer affordance row (visibility contract): one quiet caption line
  // between the attachment strip and the input pill while sends route to
  // the steer mailbox.
  steerRow: { paddingBottom: space.xs, paddingLeft: space.xs },
  steerMark: { ...type.captionStrong, color: colors.inkMute },
  errorRow: { flexDirection: "row", alignItems: "center", gap: space.s, marginTop: space.xs },
  composerError: { ...type.caption, color: colors.danger, flexShrink: 1 },
  retryText: { ...type.captionStrong, color: colors.ink },
});
