import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SYSTEM_PROMPT,
  FakeModelClient,
  FakeToolRunner,
  startTurnLoop,
  TurnLoopProvider,
} from "../src";
import type { TurnLoopMessage } from "../src";
import { flush, GatedToolRunner, message, startInput, toolCalls, toolResults } from "./fixtures";

/** noUncheckedIndexedAccess 아래에서 스크립트된 fixture 인덱스를 좁힌다. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected scripted fixture value to be defined");
  return value;
}

function toolRows(messages: readonly TurnLoopMessage[]) {
  return toolResults(messages).map((row) => `${row.callId}:${row.status}`);
}

describe("worker capability gating (M-TL3)", () => {
  test("default keeps the two-item pattern: in-progress row issued and substituted in place", async () => {
    const tools = new GatedToolRunner();
    const midFlight: TurnLoopMessage[][] = [];
    const client = new FakeModelClient([
      toolCalls({ id: "a" }, { id: "b" }),
      (request) => {
        midFlight.push([...request.messages]);
        return message("observed");
      },
      message("done"),
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "build it",
    });
    await flush();
    // Out-of-order completion: b substitutes its slot first; a's in-progress
    // row remains until its own completion, so the wake-triggered request
    // shows the live two-item state.
    tools.settle("b");
    await flush();
    tools.settle("a");
    const outcome = await pending;

    expect(outcome.status).toBe("completed");
    expect(midFlight).toHaveLength(1);
    expect(toolRows(midFlight[0] ?? [])).toEqual(["a:in_progress", "b:final"]);
    // Substitution happens in place, so final order is issuance order even
    // though b completed first.
    expect(toolRows(outcome.messages)).toEqual(["a:final", "b:final"]);
  });

  test("inProgressToolResults: false records final-only — no in-progress rows ever enter the transcript", async () => {
    const tools = new GatedToolRunner();
    const midFlight: TurnLoopMessage[][] = [];
    const client = new FakeModelClient([
      toolCalls({ id: "a", name: "read_file" }, { id: "b", name: "read_file" }),
      (request) => {
        midFlight.push([...request.messages]);
        return message("done");
      },
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      inProgressToolResults: false,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "build it",
    });
    await flush();
    // Out-of-order completion: b finishes before a.
    tools.settle("b", { output: "b data", isError: false });
    await flush();
    tools.settle("a", { output: "a data", isError: false });
    const outcome = await pending;

    expect(outcome.status).toBe("completed");
    // Two-item pattern absent: not one in-progress row anywhere.
    expect(toolRows(outcome.messages)).toEqual(["a:final", "b:final"]);
    expect(
      outcome.messages.some(
        (entry) => entry.role === "tool_result" && entry.status === "in_progress",
      ),
    ).toBe(false);
    // The post-batch request carries the finals in issuance order (a then b),
    // even though b completed first.
    expect(midFlight).toHaveLength(1);
    expect(toolRows(midFlight[0] ?? [])).toEqual(["a:final", "b:final"]);
  });

  test("final-only mode still runs parallel lanes but the model turn waits for the whole batch", async () => {
    const tools = new GatedToolRunner();
    const client = new FakeModelClient([toolCalls({ id: "a" }, { id: "b" }), message("done")]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      laneCap: 2,
      inProgressToolResults: false,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "build it",
    });
    await flush();
    // Both lanes actually run concurrently before any settle.
    expect(tools.started).toEqual(["a", "b"]);
    // First completion alone triggers no model turn: without an in-progress
    // row there is no valid transcript for a dangling tool_call.
    tools.settle("b");
    await flush();
    expect(client.turnsServed).toBe(1);

    tools.settle("a");
    const outcome = await pending;
    expect(outcome.status).toBe("completed");
    expect(client.turnsServed).toBe(2);
    expect(toolRows(outcome.messages)).toEqual(["a:final", "b:final"]);
  });

  test("final-only mode keeps per-completion processing and turn-boundary steering", async () => {
    const tools = new GatedToolRunner();
    const steers: string[] = [];
    const steerInbox = {
      drain: () => {
        const drained = [...steers];
        steers.length = 0;
        return drained;
      },
    };
    const client = new FakeModelClient([
      toolCalls({ id: "a" }, { id: "b" }),
      (request) => {
        // The steer queued mid-batch lands right after the batch's finals at
        // the very next turn boundary.
        expect(request.messages.at(-1)).toMatchObject({ role: "user", text: "focus on a" });
        expect(toolRows(request.messages)).toEqual(["a:final", "b:final"]);
        return message("steered");
      },
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      inProgressToolResults: false,
      steerInbox,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "build it",
    });
    await flush();
    steers.push("focus on a");
    tools.settle("b");
    await flush();
    tools.settle("a", { output: "a data", isError: false });
    const outcome = await pending;

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") throw new Error(outcome.detail);
    expect(outcome.finalText).toBe("steered");
    expect(toolRows(outcome.messages)).toEqual(["a:final", "b:final"]);
  });

  test("final-only mode keeps issuance-order finals for error results too", async () => {
    const tools = new GatedToolRunner();
    const client = new FakeModelClient([
      toolCalls({ id: "a", name: "risky" }, { id: "b", name: "safe" }),
      message("handled"),
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: tools,
      inProgressToolResults: false,
      system: DEFAULT_SYSTEM_PROMPT,
      prompt: "build it",
    });
    await flush();
    tools.settle("b");
    await flush();
    tools.settleError("a", "permission denied");
    const outcome = await pending;

    expect(outcome.status).toBe("completed");
    expect(toolRows(outcome.messages)).toEqual(["a:final", "b:final"]);
    const rows = toolResults(outcome.messages);
    expect(rows[0]).toMatchObject({ callId: "a", isError: true, output: "permission denied" });
    expect(rows[1]).toMatchObject({ callId: "b", isError: false });
  });

  test("TurnLoopProvider forwards the capability flag; the default stays two-item", async () => {
    const script = [
      toolCalls({ id: "a", name: "read_file" }, { id: "b", name: "read_file" }),
      message("done"),
    ];
    const finalOnlyClient = new FakeModelClient(script);
    const finalOnly = new TurnLoopProvider({
      modelClient: finalOnlyClient,
      toolRunner: new FakeToolRunner(() => ({ output: "data", isError: false })),
      computeClasses: ["fast"],
      inProgressToolResults: false,
    });
    const handle = await finalOnly.start(startInput());
    const result = await finalOnly.result(handle.id);
    expect(result.success).toBe(true);
    // Final-only transcript: the post-batch request carries plain finals and
    // the issuance request carried no tool_result row at all.
    expect(toolRows(must(finalOnlyClient.requests[1]).messages)).toEqual(["a:final", "b:final"]);
    expect(
      must(finalOnlyClient.requests[0]).messages.some((entry) => entry.role === "tool_result"),
    ).toBe(false);

    const defaultClient = new FakeModelClient(script);
    const defaultLane = new TurnLoopProvider({
      modelClient: defaultClient,
      toolRunner: new FakeToolRunner(() => ({ output: "data", isError: false })),
      computeClasses: ["fast"],
    });
    const defaultHandle = await defaultLane.start(startInput());
    const defaultResult = await defaultLane.result(defaultHandle.id);
    expect(defaultResult.success).toBe(true);
    // Default transcript: the in-progress row issued at call time is
    // substituted in place, so the post-batch request carries finals.
    expect(toolRows(must(defaultClient.requests[1]).messages)).toEqual(["a:final", "b:final"]);
    // The default lane's issuance request carried the two-item in-progress
    // rows (engine default, already proven mid-flight above); the final-only
    // lane's never carried any tool_result row.
    expect(
      must(finalOnlyClient.requests[1]).messages.some(
        (entry) => entry.role === "tool_result" && entry.status === "in_progress",
      ),
    ).toBe(false);
  });
});
