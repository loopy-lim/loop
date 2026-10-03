/**
 * Ergonomics regression pins (task `visibility-touch-ergonomics`): the
 * visibility contract is machine-enforced, not discipline. Three gates
 * over the mobile sources:
 *
 * 1. Press feedback rides the registered token (`press.activeOpacity`) on
 *    every tappable — no numeric opacity literals at call sites, and the
 *    count of `activeOpacity=` props equals the count of TouchableOpacity
 *    elements (a new tappable without the token breaks the balance).
 * 2. The terminal readout rides the registered mono step: the pane is real
 *    content, so it may not live below the 12pt caption floor.
 * 3. The composer's steer affordance stays visible while typing: the copy
 *    constant exists and composer.tsx renders it from steerMode (the
 *    placeholder alone disappears once text is entered). UI modules are
 *    inspected as source — react-native does not load under the test
 *    runtime (same rule as every other suite here).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { STEER_MARK_LABEL } from "../src/ui/copy";
import { TERMINAL_FONT_SIZE, TERMINAL_LINE_HEIGHT } from "../src/ui/terminalLayout";
import { type as typeScale } from "../src/ui/tokens";

const mobileRoot = join(import.meta.dir, "..");

function filesUnder(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

const sources = filesUnder(join(mobileRoot, "src"), [".ts", ".tsx"]).map((file) => [
  file,
  readFileSync(file, "utf8"),
]) as [string, string][];

describe("press feedback — one registered token on every tappable", () => {
  test("no numeric activeOpacity literals at call sites", () => {
    for (const [file, content] of sources) {
      expect(/activeOpacity=\{\s*[0-9.]/.test(content), file).toBe(false);
    }
  });

  test("every TouchableOpacity carries the press token (count parity)", () => {
    for (const [file, content] of sources) {
      const tappables = (content.match(/<TouchableOpacity/g) ?? []).length;
      const pressProps = (content.match(/activeOpacity=/g) ?? []).length;
      expect(pressProps, `${file}: ${tappables} tappables vs ${pressProps} press props`).toBe(
        tappables,
      );
    }
  });
});

describe("minimum text size — the terminal readout rides the mono step", () => {
  test("TERMINAL_FONT_SIZE equals type.mono (12pt floor, no ad-hoc size)", () => {
    expect(TERMINAL_FONT_SIZE).toBe(typeScale.mono.fontSize);
    expect(TERMINAL_FONT_SIZE).toBeGreaterThanOrEqual(12);
    expect(TERMINAL_LINE_HEIGHT).toBe(typeScale.mono.lineHeight);
  });
});

describe("steer affordance — visible while the turn runs", () => {
  test("the mark label is a registered copy constant", () => {
    expect(STEER_MARK_LABEL.length).toBeGreaterThan(0);
  });

  test("composer.tsx renders the mark from steerMode, not only the placeholder", () => {
    const composer = readFileSync(join(mobileRoot, "src/features/composer.tsx"), "utf8");
    expect(composer).toContain("props.steerMode ? (");
    expect(composer).toContain("{glyph.steer} {STEER_MARK_LABEL}");
    // The placeholder tells the same story while the input is empty…
    expect(composer).toContain(
      'steerMode ? "Steer the running task…" : "Describe the task for Loop"',
    );
  });
});
