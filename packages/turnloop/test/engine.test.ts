import { describe, expect, test } from "bun:test";

import { DEFAULT_SYSTEM_PROMPT, FakeModelClient, FakeToolRunner, startTurnLoop } from "../src";
import { flush, GatedToolRunner, message, toolCalls } from "./fixtures";

/** noUncheckedIndexedAccess 아래에서 스크립트된 fixture 인덱스를 좁힌다. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected scripted fixture value to be defined");
  return value;
}

describe("turn loop engine", () => {
  test("completes in one turn when the model returns a final message", async () => {
    const client = new FakeModelClient([message("all done")]);

    const outcome = await startTurnLoop({
      modelClient: client,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "do the thing",
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(outcome.finalText).toBe("all done");
    expect(outcome.turns).toBe(1);
    expect(outcome.toolCallCount).toBe(0);
    expect(outcome.messages).toEqual([
      { role: "user", text: "do the thing" },
      { role: "assistant", text: "all done" },
    ]);
    // The model saw the system stance and the initial prompt exactly once.
    expect(client.turnsServed).toBe(1);
    expect(must(client.requests[0]).system).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(must(client.requests[0]).messages).toEqual([{ role: "user", text: "do the thing" }]);
  });

  test("runs scripted tool calls, feeds results back, then completes", async () => {
    const client = new FakeModelClient([
      toolCalls({ id: "t1", name: "read_file", args: '{"path":"a.ts"}' }),
      message("file read"),
    ]);
    const tools = new FakeToolRunner((call) => ({
      output: call.name === "read_file" ? "contents of a.ts" : "unexpected",
      isError: false,
    }));

    const outcome = await startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "read a.ts",
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    expect(tools.calls).toEqual([
      { id: "t1", name: "read_file", argumentsJson: '{"path":"a.ts"}' },
    ]);
    expect(outcome.messages).toEqual([
      { role: "user", text: "read a.ts" },
      {
        role: "assistant",
        toolCalls: [{ id: "t1", name: "read_file", argumentsJson: '{"path":"a.ts"}' }],
      },
      {
        role: "tool_result",
        callId: "t1",
        name: "read_file",
        output: "contents of a.ts",
        isError: false,
        status: "final",
      },
      { role: "assistant", text: "file read" },
    ]);
    // Turn 2 was triggered by the tool completion and received the full
    // turn-1 transcript including the substituted final record.
    expect(must(client.requests[1]).messages).toEqual(outcome.messages.slice(0, 3));
  });

  test("appends multiple tool results in issuance order", async () => {
    const client = new FakeModelClient([
      toolCalls(
        { id: "t1", name: "first" },
        { id: "t2", name: "second" },
        { id: "t3", name: "third" },
      ),
      message("done"),
    ]);
    const tools = new FakeToolRunner((call) => ({
      output: `ran ${call.name}`,
      isError: false,
    }));

    const outcome = await startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "run three tools",
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error("unreachable");
    // Final context order is toolCall issuance order, never completion order.
    expect(tools.calls.map((call) => call.id)).toEqual(["t1", "t2", "t3"]);
    const results = outcome.messages.filter((entry) => entry.role === "tool_result");
    expect(results).toEqual([
      {
        role: "tool_result",
        callId: "t1",
        name: "first",
        output: "ran first",
        isError: false,
        status: "final",
      },
      {
        role: "tool_result",
        callId: "t2",
        name: "second",
        output: "ran second",
        isError: false,
        status: "final",
      },
      {
        role: "tool_result",
        callId: "t3",
        name: "third",
        output: "ran third",
        isError: false,
        status: "final",
      },
    ]);
    expect(outcome.toolCallCount).toBe(3);
    // The near-simultaneous completions coalesced into one wake, so the
    // follow-up turn already saw every final record.
    expect(must(client.requests[1]).messages).toEqual(outcome.messages.slice(0, 5));
  });

  test("feeds a thrown tool error back as an error result and continues", async () => {
    const client = new FakeModelClient([
      toolCalls({ id: "t1", name: "explode" }),
      message("recovered"),
    ]);
    const tools = new FakeToolRunner(() => {
      throw new Error("tool blew up");
    });

    const outcome = await startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "try the tool",
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.messages[2]).toEqual({
      role: "tool_result",
      callId: "t1",
      name: "explode",
      output: "tool blew up",
      isError: true,
      status: "final",
    });
  });

  test("reports unavailable tools as error results when no runner is configured", async () => {
    const client = new FakeModelClient([toolCalls({ id: "t1", name: "mystery" }), message("ok")]);

    const outcome = await startTurnLoop({
      modelClient: client,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "call a tool that does not exist",
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.messages[2]).toMatchObject({ role: "tool_result", isError: true });
    expect((outcome.messages[2] as { output: string }).output).toContain("mystery");
  });

  test("fails with max_turns_exhausted when the model never finishes", async () => {
    const client = new FakeModelClient(
      Array.from({ length: 5 }, () => toolCalls({ id: "loop", name: "spin" })),
    );
    const tools = new FakeToolRunner(() => ({ output: "spinning", isError: false }));

    const outcome = await startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "never ends",
      maxTurns: 3,
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("unreachable");
    expect(outcome.reason).toBe("max_turns_exhausted");
    expect(outcome.turns).toBe(3);
    expect(outcome.detail).toContain("3");
    expect(client.turnsServed).toBe(3);
  });

  test("maps a throwing model client to model_client_error", async () => {
    const failing = {
      complete: async () => {
        throw new Error("provider 500");
      },
    };

    const outcome = await startTurnLoop({
      modelClient: failing,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "boom",
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("unreachable");
    expect(outcome.reason).toBe("model_client_error");
    expect(outcome.detail).toBe("provider 500");
  });

  test("maps an empty tool_calls list to model_client_error", async () => {
    const client = new FakeModelClient([{ kind: "tool_calls", calls: [] }]);

    const outcome = await startTurnLoop({
      modelClient: client,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "degenerate turn",
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("unreachable");
    expect(outcome.reason).toBe("model_client_error");
    expect(outcome.detail).toContain("empty tool_calls");
  });

  test("aborts promptly at the lane boundary while a tool is in flight", async () => {
    const controller = new AbortController();
    const client = new FakeModelClient([
      toolCalls({ id: "t1", name: "first" }, { id: "t2", name: "second" }),
      message("never reached"),
    ]);
    const tools = new GatedToolRunner();

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      tools: [
        { name: "first", description: "" },
        { name: "second", description: "" },
      ],
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "abort midway",
      laneCap: 1,
      signal: controller.signal,
    });
    await flush();
    // Single lane: t1 executes, t2 sits queued with its in-progress slot.
    expect(tools.started).toEqual(["t1"]);
    controller.abort();
    const outcome = await pending;

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("unreachable");
    expect(outcome.reason).toBe("aborted");
    // The queued tool never started.
    expect(tools.started).toEqual(["t1"]);
    // The transcript snapshot keeps the open slots exactly as they were.
    expect(outcome.messages.filter((entry) => entry.role === "tool_result")).toEqual([
      {
        role: "tool_result",
        callId: "t1",
        name: "first",
        output: "tool first is running",
        isError: false,
        status: "in_progress",
      },
      {
        role: "tool_result",
        callId: "t2",
        name: "second",
        output: "tool second is running",
        isError: false,
        status: "in_progress",
      },
    ]);
  });

  test("emits a deterministic progress event sequence", async () => {
    const client = new FakeModelClient([
      toolCalls({ id: "t1", name: "read_file" }),
      message("finished"),
    ]);
    const tools = new FakeToolRunner(() => ({ output: "data", isError: false }));
    const events: Array<{ type: string; detail?: string }> = [];

    await startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "emit events",
      onEvent: (event) => {
        if (event.type === "tool_call") events.push({ type: event.type, detail: event.call.id });
        else if (event.type === "tool_result")
          events.push({ type: event.type, detail: event.callId });
        else if (event.type === "assistant_text")
          events.push({ type: event.type, detail: event.text });
        else
          events.push({ type: event.type, detail: `turn ${"turn" in event ? event.turn : "?"}` });
      },
    });

    expect(events).toEqual([
      { type: "turn_start", detail: "turn 1" },
      { type: "tool_call", detail: "t1" },
      { type: "turn_end", detail: "turn 1" },
      { type: "tool_result", detail: "t1" },
      { type: "turn_start", detail: "turn 2" },
      { type: "assistant_text", detail: "finished" },
      { type: "turn_end", detail: "turn 2" },
    ]);
  });
});
