/**
 * Unit tests for the folded tool-card summary and honest result decision
 * (decision 2026-xx-codex-detail-checklist C3/C5). Pure functions, no
 * React, no network.
 */

import { describe, expect, test } from "bun:test";

import { toolArgsSummary, toolResultView } from "../src/features/tool-summary";

describe("folded tool-card one-line summary (C3, AC3-1)", () => {
  test("a path argument wins", () => {
    expect(toolArgsSummary(JSON.stringify({ path: "src/App.tsx" }))).toBe("src/App.tsx");
  });

  test("a command argument wins when no path-like key exists", () => {
    expect(toolArgsSummary(JSON.stringify({ command: "bun test" }))).toBe("bun test");
  });

  test("an empty args object renders an empty summary", () => {
    expect(toolArgsSummary("{}")).toBe("");
  });

  test("the first string value wins when only unknown keys exist", () => {
    expect(toolArgsSummary(JSON.stringify({ query: "loop runs", limit: 5 }))).toBe("loop runs");
  });

  test("malformed JSON degrades to the raw head — never throws", () => {
    expect(toolArgsSummary("{not json")).toBe("{not json");
  });

  test("newlines inside values collapse to one line", () => {
    expect(toolArgsSummary(JSON.stringify({ command: "bun\ntest\n--only" }))).toBe(
      "bun test --only",
    );
  });
});

describe("honest tool-result rendering decision (C5, AC5-2)", () => {
  test("(a) a running card with no result yet hides the result area", () => {
    const view = toolResultView({ state: "running", resultText: null, resultTruncated: false });
    expect(view).toEqual({ kind: "hidden" });
  });

  test("(a') a closed card that never got a result stays hidden, not '(no output)'", () => {
    const view = toolResultView({ state: "done", resultText: null, resultTruncated: false });
    expect(view).toEqual({ kind: "hidden" });
  });

  test("(b) a closed card with an empty result renders the explicit one-liner", () => {
    const view = toolResultView({ state: "done", resultText: "", resultTruncated: false });
    expect(view).toEqual({ kind: "empty" });
  });

  test("(c) a closed card with text carries it plus the truncation flag", () => {
    const view = toolResultView({ state: "error", resultText: "boom", resultTruncated: true });
    expect(view).toEqual({ kind: "text", text: "boom", truncated: true });
  });
});
