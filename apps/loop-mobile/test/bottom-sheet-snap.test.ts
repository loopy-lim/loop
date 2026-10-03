/**
 * Bottom-sheet snap policy tests (split-viewer design §B, pure half).
 * The RN sheet feeds raw gesture values; these tests pin the decisions:
 * two snap points (half, full), drag-to-dismiss, fling overrides.
 */

import { describe, expect, test } from "bun:test";

import { SHEET_SNAPS, resolveSheetSnap, sheetTopOffset } from "../src/features/bottom-sheet";

const HEIGHT = 800;
const HALF_TOP = sheetTopOffset("half", HEIGHT);
const FULL_TOP = sheetTopOffset("full", HEIGHT);

describe("snap points", () => {
  test("exactly two snap points: half and full", () => {
    expect(Object.keys(SHEET_SNAPS).sort()).toEqual(["full", "half"]);
  });

  test("half is mid-screen, full stays below the top edge", () => {
    expect(HALF_TOP).toBe(HEIGHT * 0.5);
    expect(FULL_TOP).toBeGreaterThan(0);
    expect(FULL_TOP).toBeLessThan(HEIGHT * 0.1);
  });

  test("dismiss translates the sheet fully off-screen", () => {
    expect(sheetTopOffset("dismiss", HEIGHT)).toBe(HEIGHT);
  });
});

describe("resolveSheetSnap — resting decisions", () => {
  test("a gentle release near half rests at half", () => {
    expect(
      resolveSheetSnap({ topOffset: HALF_TOP + 10, velocityY: 0, deltaY: 0, height: HEIGHT }),
    ).toBe("half");
  });

  test("a gentle release near full rests at full", () => {
    expect(
      resolveSheetSnap({ topOffset: FULL_TOP + 10, velocityY: 0, deltaY: 0, height: HEIGHT }),
    ).toBe("full");
  });

  test("nearest snap wins for an undecided release", () => {
    const midpoint = (HALF_TOP + FULL_TOP) / 2;
    expect(
      resolveSheetSnap({ topOffset: midpoint - 1, velocityY: 0, deltaY: 0, height: HEIGHT }),
    ).toBe("full");
    expect(
      resolveSheetSnap({ topOffset: midpoint + 1, velocityY: 0, deltaY: 0, height: HEIGHT }),
    ).toBe("half");
  });
});

describe("resolveSheetSnap — drag to dismiss (§B)", () => {
  test("a decisive downward fling dismisses from anywhere in the lower half", () => {
    expect(
      resolveSheetSnap({ topOffset: HEIGHT * 0.6, velocityY: 1500, deltaY: 120, height: HEIGHT }),
    ).toBe("dismiss");
  });

  test("a downward fling from near full snaps back to half, not dismissed", () => {
    expect(
      resolveSheetSnap({ topOffset: FULL_TOP + 20, velocityY: 1200, deltaY: 80, height: HEIGHT }),
    ).toBe("half");
  });

  test("a slow drag past the 75% dismiss line dismisses without a fling", () => {
    expect(
      resolveSheetSnap({ topOffset: HEIGHT * 0.8, velocityY: 0, deltaY: 0, height: HEIGHT }),
    ).toBe("dismiss");
    // but the same slow drag stopping above the line snaps back
    expect(
      resolveSheetSnap({ topOffset: HEIGHT * 0.7, velocityY: 0, deltaY: 0, height: HEIGHT }),
    ).toBe("half");
  });

  test("a decisive upward fling opens to full from below the full line", () => {
    expect(
      resolveSheetSnap({ topOffset: HEIGHT * 0.6, velocityY: -1500, deltaY: -120, height: HEIGHT }),
    ).toBe("full");
  });
});
