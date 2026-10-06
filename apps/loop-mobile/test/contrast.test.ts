/**
 * WCAG AA contrast gate over the closed palette (task
 * `visibility-touch-ergonomics`): the ink tiers, the status triad, and the
 * syntax roles are all rendered as TEXT on the palette's surfaces, so AA
 * (4.5:1 for normal text — every caption tier in the type scale is normal
 * size) is a property of the tokens themselves, not of any call site. This
 * test pins that property with pure math over `ui/tokens` — the same
 * machine-enforced style as design-spec.test.ts: roles may re-map (§5),
 * but no mapping may ship below the floor.
 *
 * The compositing model matches the DOM/RN alpha model: an rgba ink over a
 * surface hex produces the effective color the eye sees.
 */
import { describe, expect, test } from "bun:test";

import { colors } from "../src/ui/tokens";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

/** sRGB hex string → linear-light triple. */
function hexRgb(hex: string): [number, number, number] {
  const m = hex.match(/^#([0-9a-fA-F]{6})$/);
  if (m === null) throw new Error(`not a 6-digit hex color: ${hex}`);
  const n = Number.parseInt(must(m[1]), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** The palette's one rgba spelling: rgba(r, g, b, a) over 8-bit channels. */
function rgbaValue(value: string): { rgb: [number, number, number]; alpha: number } {
  const m = value.match(/^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/);
  if (m === null) throw new Error(`not the palette's rgba spelling: ${value}`);
  return {
    rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
    alpha: Number(m[4]),
  };
}

/** sRGB channel → linear light (WCAG 2.x). */
function linearSrgb(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** 8-bit channel → two-digit hex. */
function hexPart(c: number): string {
  return Math.round(c).toString(16).padStart(2, "0");
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * linearSrgb(r) + 0.7152 * linearSrgb(g) + 0.0722 * linearSrgb(b);
}

/** WCAG 2.x contrast ratio between two effective colors. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const ratios = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (must(ratios[0]) + 0.05) / (must(ratios[1]) + 0.05);
}

/** Effective color of an ink (solid or rgba) composited over a surface. */
function over(ink: string, surface: string): [number, number, number] {
  if (ink.startsWith("#")) return hexRgb(ink);
  const { rgb, alpha } = rgbaValue(ink);
  const bg = hexRgb(surface);
  return [
    alpha * rgb[0] + (1 - alpha) * bg[0],
    alpha * rgb[1] + (1 - alpha) * bg[1],
    alpha * rgb[2] + (1 - alpha) * bg[2],
  ];
}

/** 8-bit triple → hex string (inverse of over() for nested composites). */
function rgbHex([r, g, b]: [number, number, number]): string {
  return `#${hexPart(r)}${hexPart(g)}${hexPart(b)}`;
}

/** Every surface the app paints text on (the closed neutral set). */
const SURFACES: Record<string, string> = {
  bg: colors.bg,
  surface: colors.surface,
  surfaceAlt: colors.surfaceAlt,
  userBubble: colors.userBubble,
};

/** WCAG AA floor for normal text (the type scale's largest role is 26pt,
 * but every tier is used at caption sizes too — one floor for all). */
const AA_TEXT = 4.5;

describe("WCAG AA — ink tiers over every surface", () => {
  for (const tier of ["ink", "inkMute", "inkFaint"] as const) {
    test(`${tier} ≥ ${AA_TEXT}:1 on every surface`, () => {
      for (const [surfaceName, surfaceHex] of Object.entries(SURFACES)) {
        const ratio = contrast(over(colors[tier], surfaceHex), hexRgb(surfaceHex));
        expect(ratio, `${tier} on ${surfaceName} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          AA_TEXT,
        );
      }
    });
  }
});

describe("WCAG AA — status triad as text accents", () => {
  // The triad rides bg (notices, running badge), surface (tool cards, chat
  // rows) and surfaceAlt (expanded tool bodies). Never on userBubble.
  const textSurfaces = ["bg", "surface", "surfaceAlt"] as const;
  for (const role of ["ok", "warn", "danger"] as const) {
    test(`${role} ≥ ${AA_TEXT}:1 on the surfaces that carry status text`, () => {
      for (const name of textSurfaces) {
        const ratio = contrast(over(colors[role], must(SURFACES[name])), hexRgb(must(SURFACES[name])));
        expect(ratio, `${role} on ${name} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          AA_TEXT,
        );
      }
    });
  }
});

describe("WCAG AA — the accent is a text-grade state color", () => {
  // The accent (direction A) rides active-tab labels, selected chips, and
  // focus marks on the same surfaces the status triad texts sit on.
  const textSurfaces = ["bg", "surface", "surfaceAlt"] as const;
  test(`accent ≥ ${AA_TEXT}:1 on the surfaces that carry accent text`, () => {
    for (const name of textSurfaces) {
      const ratio = contrast(over(colors.accent, must(SURFACES[name])), hexRgb(must(SURFACES[name])));
      expect(ratio, `accent on ${name} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  test(`accent ≥ ${AA_TEXT}:1 on its own accentSoft selected wash (over bg)`, () => {
    const wash = over(colors.accentSoft, colors.bg);
    const ratio = contrast(hexRgb(colors.accent), wash);
    expect(ratio, `accent on accentSoft-over-bg is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  test(`ink ≥ ${AA_TEXT}:1 over the accentSoft wash (over surface)`, () => {
    const wash = over(colors.accentSoft, colors.surface);
    const ratio = contrast(over(colors.ink, rgbHex(wash)), wash);
    expect(ratio, `ink on accentSoft-over-surface is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });
});

describe("WCAG AA — CTA pairing", () => {
  test(`ctaInk on cta ≥ ${AA_TEXT}:1`, () => {
    const ratio = contrast(hexRgb(colors.ctaInk), hexRgb(colors.cta));
    expect(ratio, `ctaInk on cta is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("WCAG AA — syntax roles inside code cards (surfaceAlt)", () => {
  for (const role of [
    "syntaxComment",
    "syntaxKeyword",
    "syntaxString",
    "syntaxNumber",
    "syntaxLiteral",
  ] as const) {
    test(`${role} ≥ ${AA_TEXT}:1 on surfaceAlt`, () => {
      const ratio = contrast(over(colors[role], colors.surfaceAlt), hexRgb(colors.surfaceAlt));
      expect(ratio, `${role} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }
});

describe("WCAG AA — non-text ink floor (glyphs, icons)", () => {
  // WCAG 1.4.11: graphical objects need 3:1. The colored status glyphs and
  // the faint ink glyphs ride the same roles as text, so the text gate
  // above already covers them; this asserts the floor explicitly so a
  // future role re-map cannot quietly split text and icon behavior.
  // inkGhost (v2) is the DECORATIVE tier — inactive tab icons, idle dots —
  // pinned here at the non-text floor, never used for prose (canon §2).
  test("status triad ≥ 3:1 as glyphs on every surface it may mark", () => {
    for (const role of ["ok", "warn", "danger", "inkFaint", "inkGhost"] as const) {
      for (const [, surfaceHex] of Object.entries(SURFACES)) {
        const ratio = contrast(over(colors[role], surfaceHex), hexRgb(surfaceHex));
        expect(ratio, `${role} glyph is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("the ink ladder keeps its steps", () => {
  // Each tier must render STRICTLY dimmer than the one above on every
  // surface (§5: the tiers are the hierarchy), and every tier's effective
  // color must stay the ink hue (a tint, not a new color).
  const LADDER = ["ink", "inkMute", "inkFaint", "inkGhost"] as const;
  test("each tier renders dimmer than the previous on every surface", () => {
    for (const [, surfaceHex] of Object.entries(SURFACES)) {
      for (let i = 1; i < LADDER.length; i += 1) {
        const brighter = luminance(over(colors[must(LADDER[i - 1])], surfaceHex));
        const dimmer = luminance(over(colors[must(LADDER[i])], surfaceHex));
        expect(dimmer, `${must(LADDER[i])} on ${surfaceHex}`).toBeLessThan(brighter);
      }
    }
  });

  test("the faint tier keeps its legacy step over inkMute (regression)", () => {
    for (const [, surfaceHex] of Object.entries(SURFACES)) {
      const faint = luminance(over(colors.inkFaint, surfaceHex));
      const mute = luminance(over(colors.inkMute, surfaceHex));
      expect(faint, `on ${surfaceHex}`).toBeLessThan(mute);
    }
  });
});
