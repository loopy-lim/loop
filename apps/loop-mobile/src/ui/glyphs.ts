/**
 * Icon registry (docs/design/design-system.md §3 탐색과 아이콘, v3 — task
 * `fab-icons`, DP brief docs/design/audits/fab-icons-brief.md): the
 * closed, role-keyed icon vocabulary. ONE entry per role, each carrying
 * BOTH render paths so call sites never pick a rendering themselves:
 *
 * - `sf` — the SF Symbol name for the iOS render path (ui/Icon.tsx renders
 *   it through the LoopIcon native view, template-tinted with token
 *   colors). `null` marks inline-TEXT-only roles (markdown bullet, the
 *   streaming cursor) that live inside a text flow, where a native view
 *   cannot go.
 * - `text` — the unicode fallback, force-pinned to TEXT presentation
 *   (U+FE0E, VARIATION SELECTOR-15). This is the fix for the v2 emoji bug:
 *   a bare ⚠ (U+26A0) defaults to emoji presentation on iOS and rendered
 *   as its color-emoji variant; with VS15 pinned the glyph can never
 *   reach the emoji font.
 *
 * Everything here survives log capture and stays legible on any fallback
 * font. New icons register here only (DP 접수) — a call-site glyph is
 * drift. The derived `glyph` map (text-only) is the inline-flow view of
 * the same registry: DynText call sites read `glyph.role` and inherit the
 * VS15 pinning automatically.
 */

/** U+FE0E — force text presentation (never emoji) on the following char. */
export const TEXT_PRESENTATION = "\u{FE0E}";

/** Pin a unicode glyph to text presentation. The one place the selector
 * is attached — every exported text value goes through this. */
const pin = (chars: string): string => `${chars}${TEXT_PRESENTATION}`;

const ICON_ROLES = {
  /** Navigation chevrons (header back / row actions). */
  back: { sf: "chevron.left", text: "‹" },
  forward: { sf: "chevron.right", text: "›" },
  /** Header hamburger (task `mobile-ux-patterns`): opens the side menu
   * sheet — the one auxiliary surface reachable from every chrome screen. */
  menu: { sf: "line.3.horizontal", text: "☰" },
  /** Tab-bar marks (direction A 하단 탭 바) — the three destinations.
   * The drawer's destination rows reuse the SAME roles (canon §3). */
  tabChats: { sf: "house", text: "⌂" },
  tabFiles: { sf: "folder", text: "▭" },
  tabSettings: { sf: "gearshape", text: "⚙" },
  /** Herd rebuild (rebuild brief §3): the Panes tab and agent marks. */
  tabPanes: { sf: "rectangle.split.2x2", text: "▤" },
  agent: { sf: "sparkles", text: "✦" },
  /** Header/settings logout (destructive, behind the confirmation). */
  logout: { sf: "power", text: "⏻" },
  /** Attention status signal. */
  attention: { sf: "exclamationmark.triangle", text: "⚠" },
  /** File entry (viewer leaf rows). */
  file: { sf: "doc", text: "▭" },
  /** Markdown list item — inline text only. */
  bullet: { sf: null, text: "•" },
  /** Fold state of a tool card / pane row. */
  foldClosed: { sf: "chevron.right", text: "▸" },
  foldOpen: { sf: "chevron.down", text: "▾" },
  /** Tool-card / run status marks — the closed triad of §1. */
  statusRunning: { sf: "circle.lefthalf.filled", text: "◐" },
  statusDone: { sf: "checkmark", text: "✓" },
  statusError: { sf: "xmark", text: "✕" },
  /** Run status dot (chats-list badge, header pulse). */
  statusDot: { sf: "circle.fill", text: "●" },
  /** Steer delivery marker. */
  steer: { sf: "arrow.turn.down.right", text: "↳" },
  /** Composer send action. */
  send: { sf: "arrow.up", text: "↑" },
  /** Quiet busy mark (upload badge, stream wait, FAB while spawning). */
  busy: { sf: "ellipsis", text: "···" },
  /** Streaming cursor (C7) — inline text only. */
  cursor: { sf: null, text: "▍" },
  /** Code-block copy control (C2). */
  copy: { sf: "doc.on.doc", text: "⧉" },
  /** Composer attach control (task `composer-attach-and-highlighting`). */
  attach: { sf: "photo.badge.plus", text: "▣" },
  /** Attachment removal (thumbnail strip). */
  remove: { sf: "xmark", text: "✕" },
  /** Spawn FAB (task `fab-icons`): the chats-home "new TUI session"
   * entry — the plus is the only mark the button shows. */
  spawn: { sf: "plus", text: "+" },
} as const;

export type IconRole = keyof typeof ICON_ROLES;

export interface IconGlyph {
  /** SF Symbol name (iOS render path); null = inline-text-only role. */
  readonly sf: string | null;
  /** VS15-pinned unicode fallback (non-iOS + inline text flows). */
  readonly text: string;
}

/** The registry. View-level icons read `icon[role].sf` via ui/Icon.tsx. */
export const icon: Readonly<Record<IconRole, IconGlyph>> = Object.fromEntries(
  Object.entries(ICON_ROLES).map(([role, entry]) => [role, { sf: entry.sf, text: pin(entry.text) }]),
) as Readonly<Record<IconRole, IconGlyph>>;

/** The text-only view of the registry — the inline-flow rendering path.
 * Values are VS15-pinned, so a DynText reading `glyph.role` can never
 * render as emoji, on any platform. */
export const glyph: Readonly<Record<IconRole, string>> = Object.fromEntries(
  Object.entries(ICON_ROLES).map(([role, entry]) => [role, pin(entry.text)]),
) as Readonly<Record<IconRole, string>>;
