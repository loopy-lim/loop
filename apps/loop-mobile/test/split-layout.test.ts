/**
 * Split-viewer layout policy tests (split-viewer design §B, pure half).
 * Deterministic: no react-native, no network, no device.
 */

import { describe, expect, test } from "bun:test";

import { SPLIT_BREAKPOINT, VIEWER_TARGETS, resolveSplitLayout } from "../src/features/split-layout";

describe("resolveSplitLayout — the §B container decision", () => {
  test("a phone-portrait width is narrow", () => {
    expect(resolveSplitLayout(390)).toBe("narrow");
  });

  test("a phone-landscape width around the floor stays narrow", () => {
    expect(resolveSplitLayout(SPLIT_BREAKPOINT - 1)).toBe("narrow");
  });

  test("the iPad-portrait floor and everything wider is wide", () => {
    expect(resolveSplitLayout(SPLIT_BREAKPOINT)).toBe("wide");
    expect(resolveSplitLayout(1024)).toBe("wide");
    expect(resolveSplitLayout(1366)).toBe("wide");
  });
});

describe("VIEWER_TARGETS — the §B seeded viewer entries", () => {
  test("exactly the three §B surfaces, in display order", () => {
    expect(VIEWER_TARGETS.map((target) => target.label)).toEqual([
      "Findings",
      "Diagnosis",
      "Check receipts",
    ]);
  });

  test("paths are repo-relative and traversal-free", () => {
    for (const target of VIEWER_TARGETS) {
      expect(target.path).not.toMatch(/(^|\/)\.\.($|\/)/);
      expect(target.path.startsWith("/")).toBe(false);
    }
    expect(VIEWER_TARGETS.map((target) => target.path)).toEqual([
      "docs/findings",
      "docs/diagnosis",
      "docs/checks",
    ]);
  });
});
