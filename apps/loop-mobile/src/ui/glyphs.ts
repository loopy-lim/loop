/**
 * Text glyph vocabulary (docs/design/ui-ux-guidance.md §6): plain-text
 * glyphs, one codepoint per role, no icon fonts or images. Everything here
 * survives log capture and stays legible on any fallback font.
 */
export const glyph = {
  /** Navigation. */
  back: "‹",
  /** Header-corner logout (task `header-statusbar-redesign`): the power
   * mark — small, quiet, always behind the confirmation alert. */
  logout: "⏻",
  /** Fold state of a tool card. */
  foldClosed: "▸",
  foldOpen: "▾",
  /** Tool-card status triad — the closed vocabulary of §1. */
  statusRunning: "◐",
  statusDone: "✓",
  statusError: "✕",
  /** Run status dot (chats list badge). */
  statusDot: "●",
  /** Steer delivery marker. */
  steer: "↳",
  /** Composer send action. */
  send: "↑",
  busy: "···",
  /** Streaming cursor (C7) — one codepoint, vocabulary-owned. */
  cursor: "▍",
  /** Code-block copy control (C2) — the one glyph this decision adds. */
  copy: "⧉",
  /** Composer attach control (task `composer-attach-and-highlighting`). */
  attach: "▣",
  /** Attachment removal (thumbnail strip). */
  remove: "✕",
} as const;
