import { describe, expect, test } from "bun:test";

import { FakeModelClient, SteerQueue, TurnLoopProvider, startTurnLoop } from "../src";
import type { ToolExecutionOutput, ToolRunner, TurnLoopMessage, TurnLoopOptions } from "../src";
import { Deferred, flush, GatedToolRunner, message, startInput, toolCalls } from "./fixtures";

function userTexts(messages: readonly TurnLoopMessage[]): string[] {
  return messages.filter((entry) => entry.role === "user").map((entry) => entry.text);
}

type Script = ConstructorParameters<typeof FakeModelClient>[0];

function scriptedLoop(script: Script, options: Partial<TurnLoopOptions>) {
  return startTurnLoop({
    modelClient: new FakeModelClient(script),
    system: "system",
    prompt: "original prompt",
    ...options,
  });
}

describe("turn-boundary steer injection (M-TL2)", () => {
  test("a steer delivered while tools are in flight enters at the very next turn boundary without waiting for outstanding tools", async () => {
    const queue = new SteerQueue();
    const slowGate = new Deferred<ToolExecutionOutput>();
    const runner: ToolRunner = {
      async run(call) {
        if (call.id === "fast") {
          // The mailbox hand-off lands mid-run, while "slow" is still in
          // flight — exactly the operator scenario the boundary rule covers.
          queue.push("change course");
          return { output: "ok", isError: false };
        }
        return slowGate.promise;
      },
    };
    const client = new FakeModelClient([
      toolCalls({ id: "slow", name: "long_task" }, { id: "fast", name: "quick_task" }),
      (request) => {
        // Turn 2 is woken by the fast completion — the first boundary after
        // the steer arrived. "slow" has NOT completed, yet the steer is
        // already in the transcript: no tool-completion wait, no re-claim.
        expect(userTexts(request.messages)).toEqual(["original prompt", "change course"]);
        expect(
          request.messages.some(
            (entry) =>
              entry.role === "tool_result" &&
              entry.callId === "slow" &&
              entry.status === "in_progress",
          ),
        ).toBe(true);
        return message("interim");
      },
      (request) => {
        // Applied exactly once: the later boundary must not repeat it.
        expect(userTexts(request.messages)).toEqual(["original prompt", "change course"]);
        return message("done");
      },
    ]);

    const pending = startTurnLoop({
      modelClient: client,
      toolRunner: runner,
      tools: [
        { name: "long_task", description: "slow" },
        { name: "quick_task", description: "fast" },
      ],
      system: "system",
      prompt: "original prompt",
      steerInbox: queue,
    });

    await flush(); // turn 1 served; both slots issued
    slowGate.resolve({ output: "ok", isError: false });

    const outcome = await pending;
    expect(outcome).toMatchObject({ status: "completed", finalText: "done" });
    // Turn 1 itself ran untouched by the steer (no interruption mid-turn).
    expect(
      client.requests[0]?.messages.some(
        (entry) => entry.role === "user" && entry.text === "change course",
      ),
    ).toBe(false);
  });

  test("a steer queued before the first turn lands in the first request", async () => {
    const queue = new SteerQueue();
    queue.push("early steer");
    const outcome = await scriptedLoop(
      [
        (request) => {
          expect(userTexts(request.messages)).toEqual(["original prompt", "early steer"]);
          return message("done");
        },
      ],
      { steerInbox: queue },
    );
    expect(outcome).toMatchObject({ status: "completed" });
  });

  test("several queued steers apply in order as separate user messages at one boundary", async () => {
    const queue = new SteerQueue();
    queue.push("first");
    queue.push("second");
    const outcome = await scriptedLoop(
      [
        (request) => {
          expect(userTexts(request.messages)).toEqual(["original prompt", "first", "second"]);
          return message("done");
        },
      ],
      { steerInbox: queue },
    );
    expect(outcome).toMatchObject({ status: "completed", finalText: "done" });
  });

  test("without an inbox the loop never observes steering and stays on the recorded-steer path", async () => {
    const outcome = await scriptedLoop(
      [
        (request) => {
          expect(userTexts(request.messages)).toEqual(["original prompt"]);
          return message("done");
        },
      ],
      {},
    );
    expect(outcome).toMatchObject({ status: "completed" });
  });

  test("an aborted boundary drops queued steers from the outcome so the mailbox fallback keeps them", async () => {
    const queue = new SteerQueue();
    queue.push("never applied");
    const controller = new AbortController();
    controller.abort(); // abort before the loop starts: the boundary check precedes every drain
    const client = new FakeModelClient([toolCalls({ id: "t1", name: "slow" })]);
    const pending = startTurnLoop({
      modelClient: client,
      system: "system",
      prompt: "original prompt",
      steerInbox: queue,
      signal: controller.signal,
    });
    const outcome = await pending;
    expect(outcome).toMatchObject({ status: "failed", reason: "aborted" });
    expect(
      outcome.messages.some((entry) => entry.role === "user" && entry.text === "never applied"),
    ).toBe(false);
  });

  test("SteerQueue drains FIFO and reports its depth", () => {
    const queue = new SteerQueue();
    expect(queue.pending).toBe(0);
    expect(queue.drain()).toEqual([]);
    queue.push("a");
    queue.push("b");
    expect(queue.pending).toBe(2);
    expect([...queue.drain()]).toEqual(["a", "b"]);
    expect(queue.pending).toBe(0);
    expect(queue.drain()).toEqual([]);
  });
});

describe("TurnLoopProvider steer channel (M-TL2)", () => {
  test("provider.steer queues for the next boundary and resolves without waiting for tools", async () => {
    const tools = new GatedToolRunner();
    const client = new FakeModelClient([
      toolCalls({ id: "t1", name: "long_task" }),
      (request) => {
        // The worker prompt is the only user message; the steer appended at
        // the boundary is the second and last one.
        expect(userTexts(request.messages)).toHaveLength(2);
        expect(userTexts(request.messages).at(-1)).toBe("mid-run steer");
        return message("steered done");
      },
    ]);
    const provider = new TurnLoopProvider({
      modelClient: client,
      toolRunner: tools,
      tools: [{ name: "long_task", description: "slow" }],
      computeClasses: ["fast"],
    });
    const handle = await provider.start(startInput());

    await flush(); // turn 1 served; t1 in flight
    expect(tools.started).toEqual(["t1"]);

    // The inbox hand-off resolves before the tool completes — no tool wait,
    // no claim wait. Turn 2 runs once the tool settles.
    await provider.steer(handle.id, "mid-run steer");
    tools.settle("t1");

    const result = await provider.result(handle.id);
    expect(result).toMatchObject({ success: true, summary: "steered done" });
    await provider.release(handle.id);
  });

  test("steer on an unknown or settled worker rejects so the recorded-steer fallback applies", async () => {
    const provider = new TurnLoopProvider({
      modelClient: new FakeModelClient([message("done")]),
      computeClasses: ["fast"],
    });
    await expect(provider.steer("missing-worker", "hello")).rejects.toThrow("not accepting steer");

    const handle = await provider.start(startInput());
    await provider.cancel(handle.id);
    await expect(provider.steer(handle.id, "too late")).rejects.toThrow("not accepting steer");
    await provider.release(handle.id);
  });

  test("empty steer messages are rejected", async () => {
    const provider = new TurnLoopProvider({
      modelClient: new FakeModelClient([message("done")]),
      computeClasses: ["fast"],
    });
    const handle = await provider.start(startInput());
    await expect(provider.steer(handle.id, "   ")).rejects.toThrow("empty");
    await provider.cancel(handle.id);
    await provider.release(handle.id);
  });

  test("the provider declares turn-boundary steer delivery so the mailbox skips its window", () => {
    // Contract pin (decision TL2/M-TL2): the mailbox reads this capability
    // structurally (steerCoalescingOf) to hand steers off on every tap tick.
    // If the declaration is ever renamed or dropped, the mailbox falls back
    // to the conversation spam window and mid-run steers to fast turn-loop
    // workers start missing turn boundaries — this test fails first.
    const provider = new TurnLoopProvider({
      modelClient: new FakeModelClient([message("done")]),
      computeClasses: ["fast"],
    });
    expect(provider.steerDelivery).toBe("turn_boundary");
  });

  test("steer application is visible on the worker event stream", async () => {
    const tools = new GatedToolRunner();
    const client = new FakeModelClient([toolCalls({ id: "t1", name: "wait" }), message("done")]);
    const provider = new TurnLoopProvider({
      modelClient: client,
      toolRunner: tools,
      computeClasses: ["fast"],
    });
    const handle = await provider.start(startInput());
    const seen: string[] = [];
    const done = new Deferred<void>();
    provider.subscribe(handle.id, (event) => {
      if (event.type === "output" && event.text.startsWith("steer applied")) {
        seen.push(event.text);
        done.resolve();
      }
    });
    await provider.steer(handle.id, "visible steer");
    tools.settle("t1"); // the completion wakes turn 2, whose boundary applies the steer
    await done.promise;
    expect(seen).toEqual(["steer applied at turn boundary: visible steer"]);
    await provider.result(handle.id);
    await provider.release(handle.id);
  });
});
