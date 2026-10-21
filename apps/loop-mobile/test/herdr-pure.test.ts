/**
 * ANSI parser + transcript + router pure contracts (rebuild brief M2/M5).
 */

import { describe, expect, test } from "bun:test";

import {
  ansiColorHex,
  applySgr,
  MAX_RUNS,
  parseAnsi,
  paletteHex,
  PLAIN_STYLE,
} from "../src/design/ansi";
import { EMPTY_TRANSCRIPT, nextTranscript } from "../src/herdr/transcript";
import { initialRouterState, routerReducer, topRoute } from "../src/app/router";
import { behindOffset, gestureProgress, topOffset } from "../src/ui/back-swipe";

describe("parseAnsi", () => {
  test("plain text is one run", () => {
    expect(parseAnsi("hello")).toEqual([{ ...PLAIN_STYLE, text: "hello" }]);
  });

  test("SGR colors split runs and merge adjacent same-style runs", () => {
    const runs = parseAnsi("\u001b[32mgreen\u001b[0m plain \u001b[32mgreen2\u001b[0m");
    expect(runs).toHaveLength(3);
    expect(runs[0]?.text).toBe("green");
    expect(runs[0]?.fg).toEqual({ kind: "palette", index: 2 });
    expect(runs[1]?.text).toBe(" plain ");
    expect(runs[1]?.fg).toBeNull();
    expect(runs[2]?.text).toBe("green2");
  });

  test("bold, dim, underline, italic, inverse apply and reset", () => {
    const style = applySgr(PLAIN_STYLE, "1;2;3;4;7");
    expect(style.bold).toBe(true);
    expect(style.dim).toBe(true);
    expect(style.italic).toBe(true);
    expect(style.underline).toBe(true);
    expect(style.inverse).toBe(true);
    const reset = applySgr(style, "22;23;24;27");
    expect(reset).toEqual(PLAIN_STYLE);
  });

  test("256-color and truecolor forms parse", () => {
    expect(applySgr(PLAIN_STYLE, "38;5;196").fg).toEqual({ kind: "palette", index: 196 });
    expect(applySgr(PLAIN_STYLE, "48;2;10;20;30").bg).toEqual({ kind: "rgb", r: 10, g: 20, b: 30 });
  });

  test("non-SGR escapes are stripped, not rendered", () => {
    const runs = parseAnsi("a\u001b[2Kb\u001b]0;title\u0007c\u001b[?25h");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.text).toBe("abc");
  });

  test("a truncated escape tail at frame end is dropped", () => {
    const runs = parseAnsi("text\u001b[38;5");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.text).toBe("text");
  });

  test("the run budget bounds the tree", () => {
    const input = Array.from({ length: MAX_RUNS + 50 }, (_, i) => `\u001b[3${i % 7}mx`).join("");
    const runs = parseAnsi(input);
    expect(runs.length).toBeLessThanOrEqual(MAX_RUNS);
  });

  test("palette resolves the cube and grayscale ramp", () => {
    expect(paletteHex(0)).toBe("#000000");
    expect(paletteHex(196)).toMatch(/^#[0-9a-f]{6}$/);
    expect(paletteHex(255)).toMatch(/^#[0-9a-f]{6}$/);
    expect(ansiColorHex({ kind: "rgb", r: 1, g: 2, b: 3 })).toBe("#010203");
  });
});

describe("nextTranscript", () => {
  const reading = (revision: string, text: string, paneId = "w1:p1") => ({
    paneId,
    revision,
    text,
    truncated: false,
  });

  test("replaces wholesale on a newer revision", () => {
    const next = nextTranscript({ ...EMPTY_TRANSCRIPT, paneId: "w1:p1" }, reading("3", "new"));
    expect(next?.text).toBe("new");
    expect(next?.revision).toBe("3");
  });

  test("ignores stale and identical reads", () => {
    const current = { paneId: "w1:p1", revision: "5", text: "x", truncated: false };
    expect(nextTranscript(current, reading("4", "old"))).toBeNull();
    expect(nextTranscript(current, reading("5", "x"))).toBe(current);
  });

  test("compares revisions numerically across the 9→10 boundary", () => {
    const current = { paneId: "w1:p1", revision: "9", text: "x", truncated: false };
    // lexicographically "10" < "9"; the gateway's synthesized revisions
    // cross this boundary within the first streaming minute
    expect(nextTranscript(current, reading("10", "newer"))?.revision).toBe("10");
    expect(nextTranscript(current, reading("8", "older"))).toBeNull();
  });

  test("rejects a foreign pane", () => {
    const current = { paneId: "w1:p1", revision: "5", text: "x", truncated: false };
    expect(nextTranscript(current, reading("9", "y", "w2:p1"))).toBeNull();
  });
});

describe("router", () => {
  test("each tab owns its stack; switching preserves it", () => {
    let router = initialRouterState("herd");
    router = routerReducer(router, { type: "push", route: { name: "agent", paneId: "w1:p1" } });
    expect(topRoute(router)?.name).toBe("agent");
    router = routerReducer(router, { type: "switchTab", tab: "panes" });
    expect(router.tab).toBe("panes");
    expect(topRoute(router)).toBeNull();
    router = routerReducer(router, { type: "switchTab", tab: "herd" });
    expect(topRoute(router)).toEqual({ name: "agent", paneId: "w1:p1" });
  });

  test("push and pop ride the active tab's stack only", () => {
    let router = initialRouterState("herd");
    router = routerReducer(router, { type: "push", route: { name: "agent", paneId: "w1:p1" } });
    router = routerReducer(router, { type: "switchTab", tab: "panes" });
    router = routerReducer(router, { type: "push", route: { name: "terminal", paneId: "w2:p9" } });
    expect(topRoute(router)).toEqual({ name: "terminal", paneId: "w2:p9" });
    router = routerReducer(router, { type: "pop" });
    expect(topRoute(router)).toBeNull();
    router = routerReducer(router, { type: "switchTab", tab: "herd" });
    expect(topRoute(router)?.paneId).toBe("w1:p1");
  });

  test("pop at the root is a no-op", () => {
    const router = initialRouterState("herd");
    expect(routerReducer(router, { type: "pop" })).toBe(router);
    expect(topRoute(router)).toBeNull();
  });
});

describe("stack transition interpolation", () => {
  test("gesture progress rides the finger 1:1 and clamps", () => {
    expect(gestureProgress(0, 400)).toBe(0);
    expect(gestureProgress(100, 400)).toBe(0.25);
    expect(gestureProgress(400, 400)).toBe(1);
    expect(gestureProgress(-50, 400)).toBe(0);
    expect(gestureProgress(500, 400)).toBe(1);
    expect(gestureProgress(10, 0)).toBe(0);
  });

  test("the covering screen departs rightward; the covered trails leftward", () => {
    expect(topOffset(0, 400)).toBe(400);
    expect(topOffset(1, 400)).toBe(0);
    expect(behindOffset(0, 400) === 0).toBe(true);
    expect(behindOffset(1, 400)).toBe(-120); // 0.3 parallax fraction
  });
});
