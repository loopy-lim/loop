/**
 * Single source of Loop's presentation vocabulary — design-foundations.md D1,
 * decided in docs/decisions/2026-09-25-improvement-cycle.md §결정-1.
 *
 * This is the "common module owns the screen grammar" mechanism the
 * live-agents comparison confirmed in three real implementations (pi standard
 * phrases, codex `popup_consts.rs`, agy `render/` gate): snapshot renderers
 * and CLI formatters compose these constants instead of hardcoding glyphs,
 * separators, empty states, and overflow phrases.
 *
 * Colorless by design. Color roles are the D2 decision and are deliberately
 * absent; when they land, role tokens join this layer without restructuring
 * call sites. Naming follows the dot-path direction (`separator.list`,
 * `statusGlyph.success`) reserved by design-foundations.md §6 D-1.
 */

/** Status glyphs for check/result lines (doctor, benchmark, cleanup skips). */
export const statusGlyph = {
  success: "✓",
  warning: "!",
} as const;

/**
 * Cleanup artifact bullet. Its shape (`-` versus a status glyph) stays frozen
 * to the current output until the D-3 glyph-unification decision
 * (design-foundations.md §6); this module extracts the constant only.
 */
export const cleanupBullet = "-";

/** Separators inside one logical line. */
export const separator = {
  /** Joins peer fields (`id · state`). */
  list: "·",
  /** Graph edge direction (`id ← dependency`). */
  depends: "←",
  /** Indent rail for continuation lines (`  │ activity`). */
  activity: "│",
} as const;

/** Single-line truncation marker — part of the `compactLines`/`singleLine` contract. */
export const ellipsis = "…";

/** Phrases shown instead of an empty list body. */
export const emptyState = {
  noRuns: "No runs",
  noTasks: "No tasks",
  noActiveWorkers: "No active workers",
  attentionOk: "OK",
  noModels: "No models configured",
  /** Placeholder for an empty scope or dependency list in task-context lines. */
  list: "-",
} as const;

/**
 * Overflow summary line — the `… {omitted} more {noun}` contract of
 * docs/decisions/ui-output-limits.md rule 2, single-sourced here. The optional
 * `detail` renders as a trailing parenthetical, e.g.
 * `… N more checks (F failed, P passed)`.
 */
export function moreItems(omitted: number, noun: string, detail?: string): string {
  return `${ellipsis} ${omitted} more ${noun}${detail === undefined ? "" : ` (${detail})`}`;
}
