import { describe, expect, test } from "bun:test";

import type { ModelTurnOutput } from "../src";
import { DEFAULT_SYSTEM_PROMPT, FakeModelClient, FakeToolRunner, TurnLoopProvider } from "../src";
import type { ProviderEvent } from "@loop/providers";
import { message, startInput, toolCalls } from "./fixtures";

/** noUncheckedIndexedAccess 아래에서 스크립트된 fixture 인덱스를 좁힌다. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected scripted fixture value to be defined");
  return value;
}

function collect(events: ProviderEvent[]): Array<[string, string]> {
  return events.map((event) => {
    if (event.type === "output") return [`output:${event.stream}`, event.text] as [string, string];
    if (event.type === "lifecycle") return ["lifecycle", event.status] as [string, string];
    if (event.type === "session") return ["session", event.sessionId] as [string, string];
    if (event.type === "usage")
      return ["usage", String(event.usage.inputTokens ?? 0)] as [string, string];
    return ["final", event.summary] as [string, string];
  });
}

describe("TurnLoopProvider (AgentProvider contract)", () => {
  test("start resolves a handle immediately and result carries the final summary", async () => {
    const client = new FakeModelClient([message("task finished cleanly")]);
    const provider = new TurnLoopProvider({ modelClient: client, computeClasses: ["fast"] });

    const handle = await provider.start(startInput());
    expect(handle.id.startsWith("turnloop-")).toBe(true);
    expect(handle.sessionId).toBe(handle.id);
    // No turn has been awaited yet, but the worker is already registered.
    expect(await provider.status(handle.id)).toBe("running");

    const result = await provider.result(handle.id);
    expect(result).toEqual({
      success: true,
      summary: "task finished cleanly",
      sessionId: handle.id,
    });
    expect(await provider.status(handle.id)).toBe("completed");
  });

  test("renders the orchestrator task context as the initial user prompt", async () => {
    const client = new FakeModelClient([message("ok")]);
    const provider = new TurnLoopProvider({ modelClient: client, computeClasses: ["fast"] });

    const handle = await provider.start(startInput({ personaInstructions: "You are meticulous." }));
    await provider.result(handle.id);

    const request = must(client.requests[0]);
    expect(request.system).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(request.tools).toEqual([]);
    const prompt = request.messages[0];
    if (prompt === undefined) throw new Error("expected scripted prompt");
    expect(prompt.role).toBe("user");
    if (prompt.role !== "user") throw new Error("unreachable");
    expect(prompt.text).toContain("Ship the turn loop adapter");
    expect(prompt.text).toContain("Build the loop skeleton");
    expect(prompt.text).toContain("No paid model calls");
    expect(prompt.text).toContain("You are meticulous.");
    expect(prompt.text).toContain("packages/turnloop/**");
  });

  test("declares configured tools to the model and runs them through the runner", async () => {
    const client = new FakeModelClient([
      toolCalls({ id: "t1", name: "list_files" }),
      message("listed"),
    ]);
    const tools = new FakeToolRunner(() => ({ output: "a.ts b.ts", isError: false }));
    const provider = new TurnLoopProvider({
      modelClient: client,
      toolRunner: tools,
      tools: [{ name: "list_files", description: "lists files" }],
      computeClasses: ["fast"],
    });
    expect((await provider.capabilities()).tools).toBe(true);

    const handle = await provider.start(startInput());
    const result = await provider.result(handle.id);

    expect(result.success).toBe(true);
    expect(tools.calls).toEqual([{ id: "t1", name: "list_files", argumentsJson: "{}" }]);
  });

  test("advertises capabilities from constructor config only", async () => {
    const withModel = new TurnLoopProvider({
      modelClient: new FakeModelClient([message("x")]),
      computeClasses: ["balanced", "strong"],
      modelId: "configured-model-id",
    });
    expect(await withModel.capabilities()).toEqual({
      available: true,
      models: ["configured-model-id"],
      computeClasses: ["balanced", "strong"],
      tools: false,
      vision: false,
      structuredOutput: false,
      resumableSession: false,
    });

    const withoutModel = new TurnLoopProvider({
      modelClient: new FakeModelClient([message("x")]),
      computeClasses: ["tiny"],
    });
    expect((await withoutModel.capabilities()).models).toBeUndefined();
  });

  test("maps max_turns_exhausted to a retryable incomplete_output failure", async () => {
    const client = new FakeModelClient(
      Array.from({ length: 4 }, () => toolCalls({ id: "t", name: "spin" })),
    );
    const provider = new TurnLoopProvider({
      modelClient: client,
      toolRunner: new FakeToolRunner(() => ({ output: "spinning", isError: false })),
      computeClasses: ["fast"],
      maxTurns: 2,
    });

    const handle = await provider.start(startInput());
    const result = await provider.result(handle.id);

    expect(result.success).toBe(false);
    expect(result.failure).toEqual({ kind: "incomplete_output", retryable: true });
    expect(await provider.status(handle.id)).toBe("lost");
  });

  test("maps a model client error to a retryable process_error failure", async () => {
    const provider = new TurnLoopProvider({
      modelClient: {
        complete: async () => {
          throw new Error("connection refused");
        },
      },
      computeClasses: ["fast"],
    });

    const handle = await provider.start(startInput());
    const result = await provider.result(handle.id);

    expect(result.success).toBe(false);
    expect(result.failure).toEqual({ kind: "process_error", retryable: true });
    expect(result.summary).toBe("connection refused");
  });

  test("cancel aborts a running worker and resolves a non-retryable cancelled result", async () => {
    const client = new FakeModelClient([
      () => new Promise<ModelTurnOutput>(() => {}),
      message("late"),
    ]);
    const provider = new TurnLoopProvider({ modelClient: client, computeClasses: ["fast"] });

    const handle = await provider.start(startInput());
    await provider.cancel(handle.id);

    const result = await provider.result(handle.id);
    expect(result).toEqual({
      success: false,
      summary: "cancelled",
      failure: { kind: "cancelled", retryable: false },
    });
    expect(await provider.status(handle.id)).toBe("cancelled");
    // Cancelling again is a no-op.
    await provider.cancel(handle.id);
    expect(await provider.status(handle.id)).toBe("cancelled");
  });

  test("cancel after completion does not overwrite the result", async () => {
    const client = new FakeModelClient([message("done first")]);
    const provider = new TurnLoopProvider({ modelClient: client, computeClasses: ["fast"] });

    const handle = await provider.start(startInput());
    const result = await provider.result(handle.id);
    await provider.cancel(handle.id);

    expect(result.success).toBe(true);
    expect(await provider.status(handle.id)).toBe("completed");
    expect(await provider.result(handle.id)).toEqual(result);
  });

  test("subscribe receives the full event stream via replay, unsubscribe stops it", async () => {
    const client = new FakeModelClient([
      toolCalls({ id: "t1", name: "read_file" }),
      message("final words"),
    ]);
    const provider = new TurnLoopProvider({
      modelClient: client,
      toolRunner: new FakeToolRunner(() => ({ output: "data", isError: false })),
      computeClasses: ["fast"],
    });

    const handle = await provider.start(startInput());
    const events: ProviderEvent[] = [];
    const unsubscribe = provider.subscribe(handle.id, (event) => events.push(event));
    const result = await provider.result(handle.id);
    unsubscribe();
    expect(result.success).toBe(true);

    // Replay covers everything emitted before (and during) the run; nothing
    // arrives after unsubscribe.
    const before = events.length;
    expect(collect(events)).toEqual([
      ["lifecycle", "running"],
      ["session", handle.id],
      ["output:stdout", "tool call read_file (t1)"],
      ["output:stdout", "tool read_file completed (t1)"],
      ["output:stdout", "final words"],
      ["final", "final words"],
      ["lifecycle", "completed"],
    ]);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(events.length).toBe(before);
  });

  test("release drops the session; unknown workers throw", async () => {
    const provider = new TurnLoopProvider({
      modelClient: new FakeModelClient([message("x")]),
      computeClasses: ["fast"],
    });
    const handle = await provider.start(startInput());
    await provider.result(handle.id);
    await provider.release?.(handle.id);

    expect(provider.status(handle.id)).rejects.toThrow("unknown worker");
    expect(provider.result(handle.id)).rejects.toThrow("unknown worker");
    expect(provider.cancel(handle.id)).rejects.toThrow("unknown worker");
  });

  test("many sequential workers stay isolated", async () => {
    const client = new FakeModelClient(
      Array.from({ length: 3 }, (_, index) => message(`summary ${index}`)),
    );
    const provider = new TurnLoopProvider({ modelClient: client, computeClasses: ["fast"] });

    const handles = await Promise.all([
      provider.start(startInput({ taskId: "t-1" })),
      provider.start(startInput({ taskId: "t-2" })),
      provider.start(startInput({ taskId: "t-3" })),
    ]);
    const results = await Promise.all(handles.map((handle) => provider.result(handle.id)));

    expect(results.map((result) => result.summary)).toEqual([
      "summary 0",
      "summary 1",
      "summary 2",
    ]);
    // Each worker consumed exactly one scripted turn, in start order.
    expect(client.turnsServed).toBe(3);
    expect(must(client.requests[0]).messages[0]).toMatchObject({ role: "user" });
  });
});
