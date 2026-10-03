import { describe, expect, test } from "bun:test";

import {
  DEFAULT_LANE_CAP,
  DEFAULT_SYSTEM_PROMPT,
  FakeModelClient,
  inProgressToolResult,
  startTurnLoop,
} from "../src";
import type { ToolResultMessage, TurnLoopMessage } from "../src";
import { flush, GatedToolRunner, message, toolCalls, toolResults } from "./fixtures";

/** noUncheckedIndexedAccess 아래에서 스크립트된 fixture 인덱스를 좁힌다. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected scripted fixture value to be defined");
  return value;
}

function callWith(id: string, name: string) {
  return { id, name, argumentsJson: "{}" };
}

/**
 * Turns two consecutive transcripts into an append-only assertion: the pair
 * may only differ by an in-progress slot substituted in place by its own
 * final record, plus messages appended at the end. Anything else — reorder,
 * removal, mutation of a settled record — fails.
 */
function assertAppendOnlyWithSlotSubstitution(
  prev: readonly TurnLoopMessage[],
  next: readonly TurnLoopMessage[],
): void {
  expect(next.length).toBeGreaterThanOrEqual(prev.length);
  for (let index = 0; index < prev.length; index++) {
    if (JSON.stringify(prev[index]) === JSON.stringify(next[index])) continue;
    const before = prev[index];
    const after = next[index];
    expect(before).toMatchObject({ role: "tool_result", status: "in_progress" });
    expect(after).toMatchObject({
      role: "tool_result",
      callId: (before as ToolResultMessage).callId,
      status: "final",
    });
  }
}

describe("async tool lifecycle (M-TL1)", () => {
  test("issues a fixed-shape in-progress record immediately and substitutes it in place", async () => {
    const tools = new GatedToolRunner();
    const seen: TurnLoopMessage[][] = [];
    const client = new FakeModelClient([
      toolCalls({ id: "slow", name: "long_task" }, { id: "fast", name: "quick_task" }),
      (request) => {
        seen.push([...request.messages]);
        return message("interim");
      },
      (request) => {
        seen.push([...request.messages]);
        return message("done");
      },
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      tools: [
        { name: "long_task", description: "slow" },
        { name: "quick_task", description: "fast" },
      ],
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "run two tools",
    });

    await flush(); // turn 1 served; both slots issued; both tools executing
    expect(tools.started).toEqual(["slow", "fast"]);
    tools.settle("fast");
    await flush(); // fast final recorded; its completion triggered turn 2
    expect(seen).toHaveLength(1);

    const turn2 = must(seen[0]);
    // Slot 2: still in progress, fixed template derived from issuance data.
    expect(turn2[2]).toEqual(inProgressToolResult(callWith("slow", "long_task")));
    expect(turn2[2]).toEqual({
      role: "tool_result",
      callId: "slow",
      name: "long_task",
      output: "tool long_task is running",
      isError: false,
      status: "in_progress",
    });
    // Slot 3: already final.
    expect(turn2[3]).toEqual({
      role: "tool_result",
      callId: "fast",
      name: "quick_task",
      output: "ok",
      isError: false,
      status: "final",
    });

    tools.settle("slow");
    await flush(); // slow completion triggered turn 3
    expect(seen).toHaveLength(2);

    const turn3 = must(seen[1]);
    // Same index: the final record took over the in-progress slot.
    expect(turn3[2]).toEqual({
      role: "tool_result",
      callId: "slow",
      name: "long_task",
      output: "ok",
      isError: false,
      status: "final",
    });
    expect(turn3[3]).toEqual(turn2[3]); // settled fast record untouched

    const outcome = await pending;
    expect(outcome.status).toBe("completed");

    // Earlier model requests keep their issue-time view: snapshots are
    // immutable even though the live transcript moved on.
    const turn2Request = must(client.requests[1]).messages[2];
    expect(turn2Request).toMatchObject({ callId: "slow", status: "in_progress" });

    // Final context: both finals present, exactly once each.
    const finals = toolResults(outcome.messages);
    expect(finals.map((entry) => entry.callId)).toEqual(["slow", "fast"]);
    expect(finals.every((entry) => entry.status === "final")).toBe(true);
  });

  test("a fast tool's final lands first and the last completion triggers the next turn", async () => {
    const tools = new GatedToolRunner();
    const events: string[] = [];
    const client = new FakeModelClient([
      toolCalls({ id: "slow", name: "long_task" }, { id: "fast", name: "quick_task" }),
      message("fast one landed"),
      message("all landed"),
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      tools: [
        { name: "long_task", description: "slow" },
        { name: "quick_task", description: "fast" },
      ],
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "run slow and fast",
      onEvent: (event) => {
        if (event.type === "turn_start") events.push(`turn ${event.turn}`);
        else if (event.type === "tool_call") events.push(`issued ${event.call.id}`);
        else if (event.type === "tool_result") events.push(`final ${event.callId}`);
      },
    });

    await flush();
    tools.settle("fast");
    await flush();
    // Fast final recorded while slow is still executing; the completion —
    // not a batch boundary — triggered turn 2.
    expect(events).toEqual(["turn 1", "issued slow", "issued fast", "final fast", "turn 2"]);
    expect(client.turnsServed).toBe(2);

    tools.settle("slow");
    await flush();
    // The last completion triggered the next turn immediately.
    expect(events).toEqual([
      "turn 1",
      "issued slow",
      "issued fast",
      "final fast",
      "turn 2",
      "final slow",
      "turn 3",
    ]);

    const outcome = await pending;
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.finalText).toBe("all landed");
    // Both finals recorded, in issuance order.
    expect(toolResults(outcome.messages).map((entry) => entry.callId)).toEqual(["slow", "fast"]);
    expect(tools.settled).toEqual(["fast", "slow"]); // completion order
  });

  test("final context order follows issuance order even when completions reverse it", async () => {
    const tools = new GatedToolRunner();
    const client = new FakeModelClient([
      toolCalls({ id: "a" }, { id: "b" }, { id: "c" }),
      message("first wake"),
      message("second wake"),
      message("done"),
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "reverse completions",
    });

    await flush();
    tools.settle("c");
    await flush();
    tools.settle("b");
    await flush();
    tools.settle("a");
    await flush();

    const outcome = await pending;
    expect(outcome.status).toBe("completed");
    // Settled in reverse; the final context still reads in issuance order.
    expect(tools.settled).toEqual(["c", "b", "a"]);
    expect(toolResults(outcome.messages).map((entry) => entry.callId)).toEqual(["a", "b", "c"]);
    expect(toolResults(outcome.messages).every((entry) => entry.status === "final")).toBe(true);
  });

  test("parallel lanes run up to the configured cap and queue the rest", async () => {
    const tools = new GatedToolRunner();
    const client = new FakeModelClient([
      toolCalls({ id: "t1" }, { id: "t2" }, { id: "t3" }),
      message("lane freed once"),
      message("lane freed twice"),
      message("done"),
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "three tools, two lanes",
      laneCap: 2,
    });

    await flush();
    // Only cap-many lanes actually execute; t3 waits (its in-progress slot
    // was still appended at issue time).
    expect(tools.started).toEqual(["t1", "t2"]);
    tools.settle("t2");
    await flush();
    // A lane freed and the queued call started — queueing proven.
    expect(tools.started).toEqual(["t1", "t2", "t3"]);
    expect(tools.settled).toEqual(["t2"]);

    tools.settle("t1");
    await flush();
    tools.settle("t3");
    await flush();

    const outcome = await pending;
    expect(outcome.status).toBe("completed");
    expect(toolResults(outcome.messages).map((entry) => entry.callId)).toEqual(["t1", "t2", "t3"]);
  });

  test("the default lane cap bounds concurrency without configuration", async () => {
    expect(DEFAULT_LANE_CAP).toBe(4);
    const tools = new GatedToolRunner();
    const client = new FakeModelClient([
      toolCalls({ id: "t1" }, { id: "t2" }, { id: "t3" }, { id: "t4" }, { id: "t5" }),
      message("one lane freed"),
      message("done"),
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "five tools, default cap",
    });

    await flush();
    expect(tools.started).toEqual(["t1", "t2", "t3", "t4"]);
    tools.settle("t1");
    await flush();
    // t5 was queued and starts as soon as a lane frees.
    expect(tools.started).toEqual(["t1", "t2", "t3", "t4", "t5"]);

    // The remaining completions land in one drain and coalesce into a single
    // wake — the aggregation window is minimal, not timed.
    tools.settle("t2");
    tools.settle("t3");
    tools.settle("t4");
    tools.settle("t5");
    await flush();

    const outcome = await pending;
    expect(outcome.status).toBe("completed");
    expect(client.turnsServed).toBe(3);
    expect(toolResults(outcome.messages).map((entry) => entry.callId)).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
    ]);
  });

  test("sequential tools serialize in their own lane without blocking parallel lanes", async () => {
    const tools = new GatedToolRunner();
    const client = new FakeModelClient([
      toolCalls({ id: "s1", name: "lock_first" }, { id: "s2", name: "lock_second" }, { id: "p" }),
      message("sequential freed"),
      message("parallel freed"),
      message("done"),
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      tools: [
        {
          name: "lock_first",
          description: "must not overlap lock_second",
          executionMode: "sequential",
        },
        {
          name: "lock_second",
          description: "must not overlap lock_first",
          executionMode: "sequential",
        },
        { name: "p", description: "independent" },
      ],
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "serialize the locks only",
      laneCap: 2,
    });

    await flush();
    // s1 runs in the sequential lane, p runs in a parallel lane at the same
    // time; s2 waits behind s1 — the parallel lane was never blocked.
    expect(tools.started).toEqual(["s1", "p"]);
    tools.settle("s1");
    await flush();
    // Only after s1 settled did s2 start (single-file sequential lane).
    expect(tools.started).toEqual(["s1", "p", "s2"]);
    expect(tools.settled).toEqual(["s1"]);

    tools.settle("s2");
    await flush();
    tools.settle("p");
    await flush();

    const outcome = await pending;
    expect(outcome.status).toBe("completed");
    expect(toolResults(outcome.messages).map((entry) => entry.callId)).toEqual(["s1", "s2", "p"]);
  });

  test("turn boundaries keep the context append-only apart from in-place substitution", async () => {
    const tools = new GatedToolRunner();
    const client = new FakeModelClient([
      toolCalls({ id: "t1" }, { id: "t2" }),
      message("interim"),
      message("done"),
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "prefix stability",
    });

    await flush();
    tools.settle("t2");
    await flush();
    tools.settle("t1");
    await flush();
    const outcome = await pending;
    expect(outcome.status).toBe("completed");

    const first = must(client.requests[0]).messages;
    const second = must(client.requests[1]).messages;
    const third = must(client.requests[2]).messages;

    // Request 1 contained no slots, so request 2 is a strict extension of it.
    expect<readonly TurnLoopMessage[]>(second.slice(0, first.length)).toEqual(first);
    expect(second.length).toBeGreaterThan(first.length);

    // Request 2 -> 3: only t1's in-progress slot was substituted in place,
    // everything else is untouched or appended.
    assertAppendOnlyWithSlotSubstitution(second, third);
    expect(third[2]).toMatchObject({ callId: "t1", status: "final" });
    expect(third[3]).toEqual(second[3]); // t2's settled record untouched
    expect(third.length).toBe(second.length + 1); // interim assistant appended
    expect(third[4]).toEqual({ role: "assistant", text: "interim" });
  });

  test("a gated tool failure substitutes an error final in place and the loop continues", async () => {
    const tools = new GatedToolRunner();
    const client = new FakeModelClient([
      toolCalls({ id: "boom", name: "explode" }),
      message("recovered"),
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "fail a tool",
    });

    await flush();
    tools.settleError("boom", "exit code 1");
    await flush();

    const outcome = await pending;
    expect(outcome.status).toBe("completed");
    expect(toolResults(outcome.messages)).toEqual([
      {
        role: "tool_result",
        callId: "boom",
        name: "explode",
        output: "exit code 1",
        isError: true,
        status: "final",
      },
    ]);
  });
});
