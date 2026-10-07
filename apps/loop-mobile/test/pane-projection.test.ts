/**
 * Pane terminal-view projection tests (decision 2026-xx-terminal-mirror D6):
 * revision dedupe (paneId + revision), reset convergence, pane_gone
 * termination, the autoscroll follow state machine, the honest-lifecycle
 * notices, and the monospace/centered layout contract (plain values — no RN
 * runtime). No paid model calls, no network.
 */

import { describe, expect, test } from "bun:test";

import { colors } from "../src/ui/tokens";
import {
  LIFECYCLE_ONLY_NOTICE,
  PANE_GONE_NOTICE,
  SNAPSHOT_ORIGIN_NOTICE,
  TERMINAL_BACKGROUND,
  TERMINAL_COLUMN_MAX_WIDTH,
  TERMINAL_FONT_FAMILY,
  TERMINAL_TEXT_COLOR,
} from "../src/ui/terminalLayout";
import {
  AUTOSCROLL_BOTTOM_EPSILON,
  nextFollowState,
} from "../src/ui/followScroll";
import { PaneProjection, isRevisionAfter } from "../src/state/paneProjection";
import {
  PANE_GONE,
  PANE_ID,
  PANE_LIST,
  PANE_RESET_CURSOR,
  PANE_TEXT_1,
  PANE_TEXT_2,
} from "./fixtures";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

describe("revision dedupe", () => {
  test("equal or older revisions never re-render; newer revisions apply once", () => {
    const projection = new PaneProjection(PANE_ID);
    expect(projection.applyText(PANE_TEXT_1)).toBe(true);
    expect(projection.applyText(PANE_TEXT_1)).toBe(false); // exact duplicate
    expect(projection.applyText(PANE_TEXT_2)).toBe(true);
    // A stale replay of revision 7 after 8 must not roll the view back.
    expect(projection.applyText(PANE_TEXT_1)).toBe(false);
    const view = projection.snapshot();
    expect(view.revision).toBe("8");
    expect(view.text).toBe(PANE_TEXT_2.text);
  });

  test("decimal-string revisions compare numerically (u64 rule)", () => {
    expect(isRevisionAfter("10", "9")).toBe(true);
    expect(isRevisionAfter("9", "10")).toBe(false);
    expect(isRevisionAfter("18446744073709551615", "18446744073709551614")).toBe(true);
    expect(isRevisionAfter("garbage", "1")).toBe(false);
  });

  test("frames for another pane are ignored", () => {
    const projection = new PaneProjection("other:pane");
    expect(projection.applyText(PANE_TEXT_1)).toBe(false);
  });
});

describe("reset convergence", () => {
  test("cursorUnavailable converges the view on the authoritative snapshot", () => {
    const projection = new PaneProjection(PANE_ID);
    projection.applyText(PANE_TEXT_1);
    projection.markStale(true);
    expect(projection.applyReset(PANE_RESET_CURSOR)).toBe("converged");
    const view = projection.snapshot();
    expect(view.revision).toBe("8");
    expect(view.text).toBe(PANE_TEXT_2.text);
    expect(view.stale).toBe(false);
    expect(view.gone).toBe(false);
  });

  test("paneGone terminates: view marks gone with the final snapshot", () => {
    const projection = new PaneProjection(PANE_ID);
    projection.applyText(PANE_TEXT_2);
    expect(projection.applyReset(PANE_GONE)).toBe("gone");
    const view = projection.snapshot();
    expect(view.gone).toBe(true);
    expect(view.revision).toBe("8");
  });
});

describe("lifecycle metadata", () => {
  test("summary attaches label/state for honest badges", () => {
    const projection = new PaneProjection(PANE_ID);
    projection.applySummary(must(PANE_LIST.panes[0]));
    expect(projection.snapshot()).toMatchObject({
      label: "pi worker — loop",
      state: "active",
    });
  });
});

describe("autoscroll follow state machine (decision D6)", () => {
  test("detaches when the user scrolls up; re-attaches at the bottom", () => {
    // At the bottom: keep following.
    expect(nextFollowState(true, 0)).toBe(true);
    expect(nextFollowState(true, AUTOSCROLL_BOTTOM_EPSILON)).toBe(true);
    // Scrolled up beyond the epsilon: detach.
    expect(nextFollowState(true, AUTOSCROLL_BOTTOM_EPSILON + 1)).toBe(false);
    expect(nextFollowState(false, AUTOSCROLL_BOTTOM_EPSILON + 100)).toBe(false);
    // Returned to the bottom: re-attach (this is the resume path).
    expect(nextFollowState(false, 0)).toBe(true);
    expect(nextFollowState(false, AUTOSCROLL_BOTTOM_EPSILON)).toBe(true);
  });
});

describe("layout contract (monospace + centered column, D6)", () => {
  test("terminal surface uses a monospace family inside the centered column", () => {
    // Named platform face: iOS RN does not reliably resolve generic
    // "monospace"; Menlo is the built-in monospace family.
    expect(TERMINAL_FONT_FAMILY).toBe("Menlo");
    expect(TERMINAL_COLUMN_MAX_WIDTH).toBe(480); // shared Screen column width
  });

  test("terminal surface reads as a terminal (dark screen, light glyphs)", () => {
    // Roles, not hex: the terminal mirror tracks the palette (v2 remap in
    // task `redesign-implement` darkened bg — the mirror follows).
    expect(TERMINAL_BACKGROUND).toBe(colors.bg);
    expect(TERMINAL_TEXT_COLOR).toBe(colors.ink);
  });

  test("honest-labeling notices exist for snapshot origin and status-only lanes", () => {
    expect(SNAPSHOT_ORIGIN_NOTICE).toContain("snapshot");
    expect(SNAPSHOT_ORIGIN_NOTICE).toContain("not a lossless transcript");
    expect(LIFECYCLE_ONLY_NOTICE).toContain("Status only");
    expect(LIFECYCLE_ONLY_NOTICE).toContain("no live output stream");
    expect(PANE_GONE_NOTICE).toContain("pane closed");
  });
});
