/**
 * Terminal-view layout contract (decision 2026-xx-terminal-mirror D6) —
 * plain values, no react-native import, so the monospace + centered-column
 * contract is testable without the RN runtime. PaneScreen maps these into a
 * StyleSheet; the shared Screen wrapper keeps the page centered.
 */

import { colors } from "./tokens";

/** Width of the centered terminal column (same column as the shared Screen). */
export const TERMINAL_COLUMN_MAX_WIDTH = 480;

/** Monospace readout font — the pane is terminal text, not prose. iOS
 * resolves the generic "monospace" unreliably in RN Text; name the real
 * platform face (Menlo) so the monospace contract actually renders.
 * Size rides the registered mono step (type.mono 12/18): the readability
 * floor is 12pt — the readout is real content, not a caption smaller than
 * the scale (visibility contract, test/ergonomics.test.ts pins it). */
export const TERMINAL_FONT_FAMILY = "Menlo";
export const TERMINAL_FONT_SIZE = 12;
export const TERMINAL_LINE_HEIGHT = 18;

/** Terminal surface colors — dark screen, light glyphs (pi-terminal look,
 * decision D6: the pane reads as a terminal, not a paragraph). Single
 * source: ui/tokens (decision 2026-xx-minimal-design-spec M1 — no hex
 * duplicates outside the palette). */
export const TERMINAL_BACKGROUND = colors.bg;
export const TERMINAL_TEXT_COLOR = colors.ink;

/** Inner padding of the terminal surface. */
export const TERMINAL_PADDING = 12;

/** Minimum height of the terminal surface so short panes still read as a
 * screen rather than a paragraph. */
export const TERMINAL_MIN_HEIGHT = 320;

/** Fixed viewport height: a terminal is a bounded screen with internal
 * scrolling, and the meta line (rev / following) must stay visible below it. */
export const TERMINAL_VIEWPORT_HEIGHT = 430;

/** Upper bound on pane-view re-renders per second: pane frames are whole
 * screen-buffer snapshots, so only the latest one needs to reach the UI. */
export const TERMINAL_RENDER_INTERVAL_MS = 300;

/** Notice lines shown above the terminal surface (honest labeling, D6). */
export const SNAPSHOT_ORIGIN_NOTICE = "screen-buffer snapshots — not a lossless transcript";
export const LIFECYCLE_ONLY_NOTICE = "lifecycle only — this pane has no streaming source";
export const UNOBSERVED_NOTICE = "not observed — pane is above the gateway observation cap";
export const PANE_GONE_NOTICE = "pane closed — worker lifetime ended";
