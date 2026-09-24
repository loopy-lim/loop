import { expect, test } from "bun:test";

import {
  cleanupBullet,
  ellipsis,
  emptyState,
  moreItems,
  separator,
  statusGlyph,
} from "../src/tokens";

/**
 * Token-module integrity — the D3 mechanical-enforcement start decided in
 * docs/decisions/2026-09-25-improvement-cycle.md §결정-1: every overflow
 * phrase honors the `… {n} more {noun}` contract, empty-state phrases never
 * collide, and glyph/separator values stay frozen to the current screen
 * grammar (byte-identical output is the D1 principle).
 */

test("every moreItems surface output honors the … N more contract", () => {
  const nouns = [
    "runs",
    "task details",
    "tasks",
    "workers",
    "workers with activity",
    "attention items",
    "attention lines",
    "task findings",
    "status lines",
    "lines",
    "models",
  ];
  for (const noun of nouns) {
    expect(moreItems(1, noun)).toMatch(/^… \d+ more /);
    expect(moreItems(42, noun)).toMatch(/^… \d+ more /);
  }
});

test("moreItems renders exact phrases, including the parenthetical detail", () => {
  expect(moreItems(3, "runs")).toBe("… 3 more runs");
  expect(moreItems(2, "workers with activity")).toBe("… 2 more workers with activity");
  expect(moreItems(5, "checks", "1 failed, 4 passed")).toBe("… 5 more checks (1 failed, 4 passed)");
  expect(moreItems(7, "report lines", "use --json for the full report")).toBe(
    "… 7 more report lines (use --json for the full report)",
  );
});

test("empty-state phrases are mutually unique", () => {
  const values = Object.values(emptyState);
  expect(new Set(values).size).toBe(values.length);
});

test("glyphs and separators exist and are frozen to the current grammar", () => {
  expect(statusGlyph.success).toBe("✓");
  expect(statusGlyph.warning).toBe("!");
  expect(cleanupBullet).toBe("-");
  expect(separator.list).toBe("·");
  expect(separator.depends).toBe("←");
  expect(separator.activity).toBe("│");
  expect(ellipsis).toBe("…");
});
