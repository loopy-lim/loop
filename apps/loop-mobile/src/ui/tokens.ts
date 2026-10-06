/**
 * Design tokens — the closed vocabulary for the mobile GUI (task
 * `ui-codex-redesign`; v2 remapping in task `redesign-implement`, direction
 * A "Quiet Accent" — docs/design/audits/redesign-brief.md §5.0, revision
 * recorded in docs/design/design-system.md). Role names own meaning; hex
 * values are theme mappings (docs/design/ui-ux-guidance.md §5: 역할은
 * 테마가 바뀌어도 불변). The dark mapping is the default; a light mapping
 * can be added later without touching call sites.
 *
 * Rules applied from docs/design/ui-ux-guidance.md + canon §2/§4:
 * - §1/§4: status color is a closed triad (ok/warn/danger) used only as
 *   glyph + text accents, never as large surface fills; the CTA color is
 *   the only strong emphasis per viewport; the accent is a STATE color
 *   (active/selected/focus) — never a second emphasis.
 * - §2: hierarchy comes from position and weight first (ink tiers), color
 *   last.
 * - §5: colors are referenced by role name only; no hex at call sites.
 */

export const colors = {
  /** Screen background (near-black, GitHub-dark family so the terminal
   * mirror surface stays cohesive with ui/terminalLayout.ts). v2: one step
   * deeper than v1 so the surface ladder reads (brief C-1). */
  bg: "#0B0E13",
  /** Elevated surfaces: cards, list rows, inputs, the composer. */
  surface: "#12161E",
  /** Nested surfaces inside cards: code blocks, expanded tool output. */
  surfaceAlt: "#181D27",
  /** User bubble fill — one step brighter than surface, quiet. */
  userBubble: "#202734",
  hairline: "rgba(242, 245, 249, 0.16)",

  /** Ink tiers (§5: 무색 텍스트 계층이 위계를 먼저 만든다) — v2 is the
   * Linear-style four-step ladder. ink/inkMute/inkFaint are TEXT tiers:
   * faint rides the WCAG AA floor (4.5:1; 0.54 is the minimum alpha over
   * the brightest surface, userBubble, that still passes — pinned by
   * test/contrast.test.ts). inkGhost is the DECORATIVE tier: glyphs,
   * inactive icons, and other non-essential marks only — prose on it is
   * drift; it is pinned to the WCAG 1.4.11 non-text floor (3:1). */
  ink: "#F2F5F9",
  inkMute: "rgba(242, 245, 249, 0.72)",
  inkFaint: "rgba(242, 245, 249, 0.54)",
  inkGhost: "rgba(242, 245, 249, 0.40)",

  /** Primary CTA — the single strong emphasis per viewport (§4). */
  cta: "#F2F5F9",
  ctaInk: "#0B0E13",
  ctaDisabled: "rgba(242, 245, 249, 0.16)",

  /** The single accent (brief C-2, direction A): an on-dark indigo in the
   * Linear-lavender family. STATE color only — active tab, selection,
   * focus ring — never a second emphasis (canon §4; the CTA stays the one
   * strong emphasis). accentSoft is its registered wash: the selected
   * background behind accent marks, never a large surface fill. */
  accent: "#7C89E8",
  accentSoft: "rgba(124, 137, 232, 0.16)",

  /** Closed status triad (§1): glyph/text accents only. */
  ok: "#3FB950",
  warn: "#D29922",
  danger: "#F85149",

  /** Syntax-highlight token roles (code fences; task
   * `composer-attach-and-highlighting`). The scanner's closed token
   * vocabulary maps 1:1 onto these; `plain` stays uncolored (inherits
   * `ink`). A light theme swaps these values without touching call sites. */
  syntaxComment: "#8B949E",
  syntaxKeyword: "#FF7B72",
  syntaxString: "#A5D6FF",
  syntaxNumber: "#79C0FF",
  syntaxLiteral: "#79C0FF",
} as const;

/** Typography scale. Two families only: system sans for prose, Menlo for
 * terminal/code (same face as the terminal mirror). */
export const type = {
  display: { fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -0.5 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: "600", letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: "400", letterSpacing: 0.2 },
  captionStrong: { fontSize: 12, lineHeight: 17, fontWeight: "600", letterSpacing: 0.2 },
  mono: { fontSize: 12, lineHeight: 18, fontWeight: "400" },
  /** Registered micro-step for decorative glyphs only (status dots,
   * badges — decision 2026-xx-minimal-design-spec M2): the one size below
   * caption; prose never uses it. */
  glyph: { fontSize: 8, lineHeight: 17, fontWeight: "400" },
} as const;

/** Spacing scale on a 4pt base with one 2pt micro-step. Before this pass
 * the rhythm needed a half-step, call sites improvised off-scale values —
 * the drift §8-2 forbids. The named step keeps the
 * rhythm closed. */
export const space = {
  xxs: 2,
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Corner radii. `xxs` is the composite sub-step for bubble tails and
 * inner corners — a 16pt container with one 4pt corner reads as a chat
 * bubble without introducing a new shape family. */
export const radius = {
  xxs: 4,
  s: 8,
  m: 12,
  l: 16,
  pill: 999,
} as const;

/** Elevation levels (task `beauty-polish-pass`; reduced to one level by
 * decision 2026-xx-minimal-design-spec S5). On the near-black background a
 * resting shadow reads as pure decoration, so the hairline border carries
 * every edge (§3: separation is one quiet rule) and the single registered
 * shadow only LIFTS:
 *
 * - `float`: detached chrome (the jump-to-bottom pill) — the one element
 *   that hovers over scrolling content.
 *
 * `elevation` (the integer) is the Android counterpart; iOS uses the
 * shadow quad. Values are plain numbers/strings so this module stays
 * importable without the react-native runtime (same contract as
 * terminalLayout.ts). */
export const elevation = {
  float: {
    shadowColor: "#000000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

/** Motion durations (task `beauty-polish-pass`), in ms. Registered
 * mechanisms only — ui/motion.tsx is the single consumer surface:
 * - `fold`: tool-card expand/collapse (LayoutAnimation).
 * - `entrance` + `entranceOffset`: one-time fade+rise when a timeline row
 *   or overlay mounts (subtle by budget: ≤400ms, ≤4pt travel).
 * - `blink` / `pulse`: two-frame opacity signals (streaming cursor,
 *   running badge) — slow periods; the surface stays calm (§1: frequent
 *   states must stay quiet).
 */
export const motion = {
  fold: 220,
  entrance: 240,
  entranceOffset: 4,
  blink: 530,
  pulse: 900,
} as const;

/** Press state (§8-3: variants are registered entries). One shared touch
 * feedback opacity for every tappable surface. */
export const press = { activeOpacity: 0.7 } as const;

/** Horizontal gutter of the centered content column inside a screen. */
export const COLUMN_GUTTER = 16;
