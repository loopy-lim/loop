/**
 * Chat-surface model contract (herdr/conversation.ts) — the pure gating
 * between structured turns, the agy summary card, and the ANSI transcript
 * fallback. No network, no React, no camera.
 */

import { describe, expect, test } from "bun:test";

import { chatBody, nextConversation, summaryStatus } from "../src/herdr/conversation";
import type { HerdrConversation } from "../src/herdr/wire";

const PANE = "w1:p1";

const turnsConversation: HerdrConversation = {
  paneId: PANE,
  surface: "turns",
  kind: "claude",
  source: "/Users/loopy/.claude/projects/-tmp-proj/s.jsonl",
  turns: [
    { kind: "user", id: "u1", text: "실행해줘", at: null },
    { kind: "tool", id: "t1", title: "Bash", detail: null, state: "done", at: null },
    { kind: "assistant", id: "a1", text: "됐습니다", at: null },
  ],
  truncated: false,
};

const summaryConversation: HerdrConversation = {
  paneId: PANE,
  surface: "summary",
  kind: "agy",
  source: "/home/.gemini/antigravity-cli/conversation_summaries.db",
  summary: { title: "QR 스캐너 정리", status: "idle", stepCount: 106, preview: "미리보기", modifiedAt: null },
};

describe("chatBody", () => {
  test("null conversation → transcript fallback", () => {
    expect(chatBody(PANE, null)).toEqual({ view: "transcript" });
  });

  test("wrong-pane payload never renders (stale fetch guard)", () => {
    const other: HerdrConversation = { ...turnsConversation, paneId: "w1:p9" };
    expect(chatBody(PANE, other)).toEqual({ view: "transcript" });
  });

  test("turns render when non-empty", () => {
    const body = chatBody(PANE, turnsConversation);
    expect(body.view).toBe("turns");
    if (body.view !== "turns") throw new Error("unreachable");
    expect(body.turns.turns).toHaveLength(3);
  });

  test("empty turns degrade to the transcript, never a blank chat", () => {
    const empty: HerdrConversation = { ...turnsConversation, turns: [] };
    expect(chatBody(PANE, empty)).toEqual({ view: "transcript" });
  });

  test("summary surface renders the card", () => {
    const body = chatBody(PANE, summaryConversation);
    expect(body.view).toBe("summary");
  });

  test("agy with turns renders turns view", () => {
    const agyTurns: HerdrConversation = { ...turnsConversation, kind: "agy" };
    const body = chatBody(PANE, agyTurns);
    expect(body.view).toBe("turns");
  });
});

describe("nextConversation", () => {
  test("replace-wholesale on a current-pane payload", () => {
    expect(nextConversation(PANE, null, turnsConversation)).toEqual(turnsConversation);
  });

  test("a foreign-pane fetch keeps the previous value", () => {
    const other: HerdrConversation = { ...turnsConversation, paneId: "w1:p9" };
    expect(nextConversation(PANE, turnsConversation, other)).toEqual(turnsConversation);
  });
});

describe("summaryStatus", () => {
  test("mappable values pass through; everything else is unknown", () => {
    expect(summaryStatus("idle")).toBe("idle");
    expect(summaryStatus("working")).toBe("working");
    expect(summaryStatus("done")).toBe("done");
    expect(summaryStatus("cascade-running")).toBe("unknown");
    expect(summaryStatus("")).toBe("unknown");
  });
});
