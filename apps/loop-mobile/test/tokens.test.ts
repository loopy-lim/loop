/**
 * Design-system invariants for ui/tokens (task `beauty-polish-pass`;
 * ui-ux-guidance §8 — consistency is enforced by machine, not by
 * discipline). These assert the STRUCTURE of the refined system: ladder
 * ordering, subtle-motion budget, level pairing — never literal hex
 * snapshots, so theme re-mappings (§5: values change, roles persist)
 * cannot break the suite.
 *
 * The tokens module is pure values with no react-native import; this test
 * keeps that contract honest (same importability as terminalLayout.ts).
 */
import { describe, expect, test } from "bun:test";

import { colors, elevation, motion, press, radius, space, type } from "../src/ui/tokens";

describe("spacing rhythm", () => {
  test("ascends in even steps (4pt base with the named 2pt micro-step)", () => {
    const values = Object.values(space);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
    for (const value of values) expect(value % 2).toBe(0);
  });
});

describe("radius ladder", () => {
  test("ascends strictly (composite xxs → pill extreme)", () => {
    const values = Object.values(radius);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });
});

describe("type scale", () => {
  test("every role's lineHeight exceeds its fontSize (no clipping)", () => {
    for (const role of Object.values(type)) {
      expect(role.lineHeight).toBeGreaterThan(role.fontSize);
    }
  });

  test("weights stay in the closed bold/regular dichotomy (§2-1)", () => {
    for (const role of Object.values(type)) {
      expect(["400", "600", "700"]).toContain(String(role.fontWeight));
    }
  });
});

describe("elevation levels", () => {
  test("float is the only registered level — the hairline carries every edge (decision 2026-xx-minimal-design-spec S5)", () => {
    expect(Object.keys(elevation)).toEqual(["float"]);
  });

  test("float carries both platform counterparts (iOS quad + Android int)", () => {
    expect(elevation.float.shadowColor.length).toBeGreaterThan(0);
    expect(elevation.float.elevation).toBeGreaterThanOrEqual(1);
    expect(elevation.float.shadowOffset.height).toBeGreaterThan(0);
  });
});

describe("motion budget", () => {
  test("transitions stay subtle (≤400ms, ≤8pt travel)", () => {
    expect(motion.fold).toBeGreaterThan(0);
    expect(motion.fold).toBeLessThanOrEqual(400);
    expect(motion.entrance).toBeGreaterThan(0);
    expect(motion.entrance).toBeLessThanOrEqual(400);
    expect(motion.entranceOffset).toBeGreaterThan(0);
    expect(motion.entranceOffset).toBeLessThanOrEqual(8);
  });

  test("two-frame signals are slow — the surface stays calm (§1)", () => {
    expect(motion.blink).toBeGreaterThanOrEqual(300);
    expect(motion.pulse).toBeGreaterThanOrEqual(300);
    expect(motion.pulse).toBeGreaterThan(motion.blink);
  });
});

describe("press + palette closure", () => {
  test("press feedback is visible but gentle", () => {
    expect(press.activeOpacity).toBeGreaterThan(0.4);
    expect(press.activeOpacity).toBeLessThanOrEqual(0.85);
  });

  test("every color role maps to a string value (roles at call sites, never hex)", () => {
    for (const value of Object.values(colors)) expect(typeof value).toBe("string");
  });
});
