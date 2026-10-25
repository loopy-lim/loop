/**
 * Chat-surface model contract (herdr/conversation.ts) — the pure gating
 * between structured turns, the agy summary card, and the ANSI transcript
 * fallback. No network, no React, no camera.
 */

import { describe, expect, test } from "bun:test";

import {
  chatBody,
  mergePendingTurns,
  nextConversation,
  pendingSame,
  planRefresh,
  summaryStatus,
  turnsEqual,
} from "../src/herdr/conversation";
import type { PendingPrompt } from "../src/herdr/conversation";
import { turnTimeMarks } from "../src/features/time-format";
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
  const attached = Date.parse("2026-10-24T00:00:00Z");
  // attachedAt: 0 → the floor is far in the past; the at:null-turn cases
  // below never touch it.
  const base = { attachedAt: 0 };

  test("no pending → the fetched list passes through untouched", () => {
    expect(mergePendingTurns([fetchedUser], [])).toEqual({ turns: [fetchedUser], remaining: [] });
  });

  test("unmatched pending renders as a trailing user bubble", () => {
    const merged = mergePendingTurns([fetchedUser], [
      { id: "pending-0", text: "또 해줘", seen: [], ...base },
    ]);
    expect(merged.remaining.map((item) => item.id)).toEqual(["pending-0"]);
    expect(merged.turns[1]).toEqual({ kind: "user", id: "pending-0", text: "또 해줘", at: null });
  });

  test("a NEW user turn with the same trimmed text retires the pending", () => {
    const sent: HerdrConversationTurn = { kind: "user", id: "u2", text: "  실행해줘  ", at: null };
    const merged = mergePendingTurns(
      [fetchedUser, sent],
      [{ id: "pending-0", text: "실행해줘", seen: ["u1"], ...base }],
    );
    expect(merged.remaining).toEqual([]);
    expect(merged.turns.length).toBe(2); // no duplicate bubble
  });

  test("an OLD turn with the same text never retires a resend (F-4)", () => {
    // "하나" was already on record (id u1, in seen) when the prompt attached.
    const resent = mergePendingTurns(
      [fetchedUser],
      [{ id: "pending-0", text: "첫 질문", seen: ["u1"], ...base }],
    );
    expect(resent.remaining.map((item) => item.id)).toEqual(["pending-0"]);
    expect(resent.turns.map((turn) => turn.id)).toEqual(["u1", "pending-0"]);
  });

  test("identical resends retire one-for-one against fresh turns", () => {
    const first: HerdrConversationTurn = { kind: "user", id: "u2", text: "계속", at: null };
    const second: HerdrConversationTurn = { kind: "user", id: "u3", text: "계속", at: null };
    const both = mergePendingTurns(
      [fetchedUser, first, second],
      [
        { id: "pending-0", text: "계속", seen: ["u1"], ...base },
        { id: "pending-1", text: "계속", seen: ["u1"], ...base },
      ],
    );
    expect(both.remaining).toEqual([]);
    const one = mergePendingTurns(
      [fetchedUser, first],
      [
        { id: "pending-0", text: "계속", seen: ["u1"], ...base },
        { id: "pending-1", text: "계속", seen: ["u1"], ...base },
      ],
    );
    expect(one.remaining.map((item) => item.id)).toEqual(["pending-1"]);
  });

  test("consumed turn ids absorb into remaining pendings' seen (no cascade, R-1)", () => {
    const first: HerdrConversationTurn = {
      kind: "user",
      id: "u2",
      text: "계속",
      at: "2026-10-24T00:00:10Z",
    };
    const pendings = [
      { id: "pending-0", text: "계속", seen: ["u1"], attachedAt: attached },
      { id: "pending-1", text: "계속", seen: ["u1"], attachedAt: attached },
    ];
    const one = mergePendingTurns([fetchedUser, first], pendings);
    expect(one.remaining.map((item) => item.id)).toEqual(["pending-1"]);
    // Durability: refetching the SAME history must not let pending-1
    // re-consume u2 — the cascade that retired both bubbles on one record.
    const again = mergePendingTurns([fetchedUser, first], one.remaining);
    expect(again.remaining.map((item) => item.id)).toEqual(["pending-1"]);
    expect(again.remaining[0]?.seen).toContain("u2");
    expect(again.turns.filter((turn) => turn.id === "pending-1")).toHaveLength(1);
  });

  test("a turn stamped before attach cannot retire a seen=[] pending (R-2)", () => {
    const old: HerdrConversationTurn = {
      kind: "user",
      id: "u9",
      text: "계속",
      at: "2026-10-23T23:00:00Z",
    };
    const merged = mergePendingTurns([old], [
      { id: "pending-0", text: "계속", seen: [], attachedAt: attached },
    ]);
    expect(merged.remaining.map((item) => item.id)).toEqual(["pending-0"]);
    expect(merged.turns.map((turn) => turn.id)).toEqual(["u9", "pending-0"]);
  });

  test("attach-time floor allows skew but blocks older stamps", () => {
    // 60s before attach: inside the 90s skew allowance → may retire.
    const skew: HerdrConversationTurn = {
      kind: "user",
      id: "u8",
      text: "계속",
      at: "2026-10-23T23:59:00Z",
    };
    expect(
      mergePendingTurns([skew], [{ id: "pending-0", text: "계속", seen: [], attachedAt: attached }])
        .remaining,
    ).toEqual([]);
    // 120s before attach: beyond the skew floor → cannot stand in.
    const older: HerdrConversationTurn = {
      kind: "user",
      id: "u7",
      text: "계속",
      at: "2026-10-23T23:58:00Z",
    };
    expect(
      mergePendingTurns([older], [{ id: "pending-0", text: "계속", seen: [], attachedAt: attached }])
        .remaining.map((item) => item.id),
    ).toEqual(["pending-0"]);
  });

  test("a turn without a timestamp falls back to the seen guard (A5)", () => {
    const noStamp: HerdrConversationTurn = { kind: "user", id: "u9", text: "계속", at: null };
    const merged = mergePendingTurns([noStamp], [
      { id: "pending-0", text: "계속", seen: [], attachedAt: attached },
    ]);
    expect(merged.remaining).toEqual([]); // the seen guard is the only gate
  });
});

describe("pendingSame", () => {
  const item = (seen: string[]): PendingPrompt => ({
    id: "pending-0",
    text: "계속",
    seen,
    attachedAt: 5,
  });

  test("content-equal lists compare equal regardless of array identity", () => {
    expect(pendingSame([item(["u1"])], [{ ...item(["u1"]) }])).toBe(true);
  });

  test("seen drift is unequal (the absorbed-consumption guard)", () => {
    expect(pendingSame([item(["u1"])], [item(["u1", "u2"])])).toBe(false);
  });

  test("id, stamp, or length drift is unequal", () => {
    expect(pendingSame([item(["u1"])], [])).toBe(false);
    expect(pendingSame([item(["u1"])], [{ ...item(["u1"]), id: "pending-1" }])).toBe(false);
    expect(pendingSame([item(["u1"])], [{ ...item(["u1"]), attachedAt: 6 }])).toBe(false);
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

// ——— plan 2026-10-25: time marks, thinking turns ————————————————

describe("turnTimeMarks (plan 2026-10-25 AC-1)", () => {
  test("first stamped turn carries a day header, same-day turns do not", () => {
    const marks = turnTimeMarks([
      { at: "2026-10-25T09:00:00Z" },
      { at: "2026-10-25T09:05:00Z" },
      { at: "2026-10-25T11:30:00Z" },
    ]);
    expect(marks[0]?.dateLabel).not.toBeNull();
    expect(marks[1]?.dateLabel).toBeNull();
    expect(marks[2]?.dateLabel).toBeNull();
    for (const mark of marks) expect(mark.clock).not.toBeNull();
  });

  test("a different calendar day flips the header again", () => {
    const marks = turnTimeMarks([
      { at: "2026-10-24T23:59:00Z" },
      { at: "2026-10-25T00:01:00Z" },
    ]);
    expect(marks[0]?.dateLabel).not.toBeNull();
    expect(marks[1]?.dateLabel).not.toBeNull();
  });

  test("unstamped turns carry null marks and never fabricate a header", () => {
    const marks = turnTimeMarks([{ at: null }, { at: "2026-10-25T09:00:00Z" }, { at: null }]);
    expect(marks[0]).toEqual({ dateLabel: null, clock: null });
    expect(marks[1]?.dateLabel).not.toBeNull();
    expect(marks[2]).toEqual({ dateLabel: null, clock: null });
  });

  test("unparseable stamps degrade to null marks", () => {
    const marks = turnTimeMarks([{ at: "not-a-date" }]);
    expect(marks[0]).toEqual({ dateLabel: null, clock: null });
  });
});

describe("thinking turns (plan 2026-10-25 AC-7)", () => {
  const thinking: HerdrConversationTurn = {
    kind: "thinking",
    id: "a1:k3",
    text: "도구를 먼저 확인해야지",
    at: "2026-10-25T09:00:00Z",
  };

  test("chatBody keeps a turns view that contains thinking turns", () => {
    const conversation: HerdrConversation = {
      ...turnsConversation,
      turns: [thinking],
    };
    const body = chatBody(PANE, conversation);
    expect(body.view).toBe("turns");
  });

  test("turnsEqual compares thinking turns by text", () => {
    expect(turnsEqual(thinking, { ...thinking })).toBe(true);
    expect(turnsEqual(thinking, { ...thinking, text: "다른 생각" })).toBe(false);
    expect(turnsEqual(thinking, { ...thinking, id: "other" })).toBe(false);
    expect(
      turnsEqual(thinking, { kind: "assistant", id: thinking.id, text: thinking.text, at: null }),
    ).toBe(false);
  });
});
