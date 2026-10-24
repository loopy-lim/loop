/**
 * Chat-surface model contract (herdr/conversation.ts) — the pure gating
 * between structured turns, the agy summary card, and the ANSI transcript
 * fallback. No network, no React, no camera.
 */

import { describe, expect, test } from "bun:test";

import { chatBody, mergePendingTurns, nextConversation, planRefresh, summaryStatus, turnsEqual } from "../src/herdr/conversation";
import type { HerdrConversation, HerdrConversationTurn } from "../src/herdr/wire";

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

describe("turnsEqual", () => {
  test("rebuilt objects with equal content compare equal (the memo pin)", () => {
    const a: HerdrConversationTurn = { kind: "user", id: "u1", text: "실행해줘", at: null };
    const b: HerdrConversationTurn = { kind: "user", id: "u1", text: "실행해줘", at: null };
    expect(a).not.toBe(b);
    expect(turnsEqual(a, b)).toBe(true);
  });

  test("rendered-content drift is unequal", () => {
    const a: HerdrConversationTurn = { kind: "assistant", id: "a1", text: "됐", at: null };
    const b: HerdrConversationTurn = { kind: "assistant", id: "a1", text: "됐습니다", at: null };
    expect(turnsEqual(a, b)).toBe(false);
  });

  test("tool state and detail drift is unequal", () => {
    const a: HerdrConversationTurn = { kind: "tool", id: "t1", title: "Bash", detail: null, state: "running", at: null };
    const same: HerdrConversationTurn = { kind: "tool", id: "t1", title: "Bash", detail: null, state: "running", at: null };
    const done: HerdrConversationTurn = { kind: "tool", id: "t1", title: "Bash", detail: null, state: "done", at: null };
    expect(turnsEqual(a, same)).toBe(true);
    expect(turnsEqual(a, done)).toBe(false);
    expect(turnsEqual(a, { ...a, detail: "ls" })).toBe(false);
  });

  test("identity or kind drift is unequal", () => {
    const a: HerdrConversationTurn = { kind: "user", id: "u1", text: "실행해줘", at: null };
    const otherId: HerdrConversationTurn = { kind: "user", id: "u2", text: "실행해줘", at: null };
    const otherKind: HerdrConversationTurn = { kind: "assistant", id: "u1", text: "실행해줘", at: null };
    expect(turnsEqual(a, otherId)).toBe(false);
    expect(turnsEqual(a, otherKind)).toBe(false);
  });
});

describe("mergePendingTurns", () => {
  const fetchedUser: HerdrConversationTurn = { kind: "user", id: "u1", text: "첫 질문", at: null };

  test("no pending → the fetched list passes through untouched", () => {
    expect(mergePendingTurns([fetchedUser], [])).toEqual({ turns: [fetchedUser], remaining: [] });
  });

  test("unmatched pending renders as a trailing user bubble", () => {
    const merged = mergePendingTurns([fetchedUser], [{ id: "pending-0", text: "또 해줘", seen: [] }]);
    expect(merged.remaining).toEqual(["pending-0"]);
    expect(merged.turns[1]).toEqual({ kind: "user", id: "pending-0", text: "또 해줘", at: null });
  });

  test("a NEW user turn with the same trimmed text retires the pending", () => {
    const sent: HerdrConversationTurn = { kind: "user", id: "u2", text: "  실행해줘  ", at: null };
    const merged = mergePendingTurns(
      [fetchedUser, sent],
      [{ id: "pending-0", text: "실행해줘", seen: ["u1"] }],
    );
    expect(merged.remaining).toEqual([]);
    expect(merged.turns.length).toBe(2); // no duplicate bubble
  });

  test("an OLD turn with the same text never retires a resend (F-4)", () => {
    // "하나" was already on record (id u1, in seen) when the prompt attached.
    const resent = mergePendingTurns(
      [fetchedUser],
      [{ id: "pending-0", text: "첫 질문", seen: ["u1"] }],
    );
    expect(resent.remaining).toEqual(["pending-0"]);
    expect(resent.turns.map((turn) => turn.id)).toEqual(["u1", "pending-0"]);
  });

  test("identical resends retire one-for-one against fresh turns", () => {
    const first: HerdrConversationTurn = { kind: "user", id: "u2", text: "계속", at: null };
    const second: HerdrConversationTurn = { kind: "user", id: "u3", text: "계속", at: null };
    const both = mergePendingTurns(
      [fetchedUser, first, second],
      [
        { id: "pending-0", text: "계속", seen: ["u1"] },
        { id: "pending-1", text: "계속", seen: ["u1"] },
      ],
    );
    expect(both.remaining).toEqual([]);
    const one = mergePendingTurns(
      [fetchedUser, first],
      [
        { id: "pending-0", text: "계속", seen: ["u1"] },
        { id: "pending-1", text: "계속", seen: ["u1"] },
      ],
    );
    expect(one.remaining).toEqual(["pending-1"]);
  });
});

describe("planRefresh", () => {
  test("chat + turns surface skips the ANSI read", () => {
    expect(planRefresh("chat", "turns", false)).toEqual({
      transcript: false,
      conversation: true,
    });
  });

  test("terminal segment reads only the transcript", () => {
    expect(planRefresh("terminal", "turns", false)).toEqual({
      transcript: true,
      conversation: false,
    });
  });

  test("unknown/other surface keeps both reads until turns hold", () => {
    expect(planRefresh("chat", "unknown", false)).toEqual({
      transcript: true,
      conversation: true,
    });
    expect(planRefresh("chat", "other", false)).toEqual({
      transcript: true,
      conversation: true,
    });
  });

  test("forced transcript (segment switch) always reads the ANSI mirror", () => {
    expect(planRefresh("chat", "turns", true)).toEqual({
      transcript: true,
      conversation: true,
    });
  });
});
