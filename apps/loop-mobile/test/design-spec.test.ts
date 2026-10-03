/**
 * Minimal-design-spec acceptance gates (decision
 * 2026-xx-minimal-design-spec; task `design-spec-implementation`).
 * Consistency is enforced by machine, not discipline (ui-ux-guidance §8).
 * The desktop surface mirror (S1 desktop :root parity, S5/S6/S8 desktop
 * checks) was removed with the retired desktop app; these gates cover the
 * mobile surface:
 *
 * - S3: spacing only via the closed scale (no arithmetic at call sites).
 * - S5: elevation.card is gone; float stays the only level.
 * - S6: react-native motion mechanisms stay owned by ui/motion.tsx.
 * - M1/M2: single palette source; no raw font sizes outside the scale
 *   definition (QR scanner svg in ui/qr.ts is the one functional exemption).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { colors, motion, radius, space, type as typeScale } from "../src/ui/tokens";

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

const mobileSources = filesUnder(join(mobileRoot, "src"), [".ts", ".tsx"]).map((file) => [
  file,
  readFileSync(file, "utf8"),
]) as [string, string][];

describe("mobile regression greps — the vocabulary stays closed", () => {
  test("AC-S3-2: no spacing arithmetic at call sites", () => {
    for (const [file, source] of mobileSources) {
      expect(source, file).not.toMatch(/space\.[a-z]+\s*[+*]\s*\d/);
    }
  });

  test("AC-S5-1: elevation.card is gone; float stays the only level", () => {
    for (const [file, source] of mobileSources) {
      expect(source, file).not.toMatch(/elevation\.card/);
    }
  });

  test("AC-S6-2: react-native motion mechanisms are imported only by ui/motion.tsx", () => {
    for (const [file, source] of mobileSources) {
      if (file.endsWith("ui/motion.tsx")) continue;
      expect(source, file).not.toMatch(
        /import\s*\{[^}]*\b(Animated|LayoutAnimation)\b[^}]*\}\s*from\s*["']react-native["']/,
      );
    }
  });

  test("M1/M2: single palette source; no raw font sizes outside the scale definition", () => {
    for (const [file, source] of mobileSources) {
      if (file.endsWith("ui/tokens.ts")) continue; // the scale definition itself
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, file).not.toMatch(/fontSize:\s*\d/);
    }
  });
});

// The token scales themselves (colors, motion, radius, space, typeScale)
// remain the closed vocabulary the greps above enforce indirectly; keep a
// direct sanity check so the imports above never rot silently.
describe("closed token scales stay defined", () => {
  test("each scale is non-empty", () => {
    expect(Object.keys(colors).length).toBeGreaterThan(0);
    expect(Object.keys(space).length).toBeGreaterThan(0);
    expect(Object.keys(radius).length).toBeGreaterThan(0);
    expect(Object.keys(typeScale).length).toBeGreaterThan(0);
    expect(motion.entrance).toBeGreaterThan(0);
  });
});
