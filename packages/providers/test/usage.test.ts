import { describe, expect, test } from "bun:test";
import type { UsageMetadata } from "@loop/protocol";

import { UsageCollector, UsageTrackingProvider, parseUsageMetadata } from "../src/usage";
import type {
  AgentProvider,
  ProviderEvent,
  StartWorkerInput,
  WorkerHandle,
  WorkerResult,
} from "../src/types";

/** noUncheckedIndexedAccess 아래에서 테스트 배열의 첫/n번째 요소를 좁힌다. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected item ${index} to be defined`);
  return item;
}

const observed: UsageMetadata = {
  inputTokens: 1_234,
  outputTokens: 567,
  cacheReadTokens: null,
  basis: "observed",
  cost: "0.0123",
  currency: "USD",
};

describe("usage metadata collection (G17)", () => {
  test("collector records correlation and never mixes bases in totals", () => {
    const collector = new UsageCollector();
    const seen: string[] = [];
    collector.onRecord((record) => seen.push(record.workerId ?? ""));
    collector.record(observed, {
      runId: "run-1",
      taskId: "task-1",
      workerId: "w-1",
      occurredAt: "2026-01-01T00:00:00Z",
    });
    collector.record(
      { ...observed, basis: "estimated", inputTokens: 10 },
      { runId: "run-1", workerId: "w-2" },
    );

    const totals = collector.totals();
    expect(totals.observed.inputTokens).toBe(1_234);
    expect(totals.observed.outputTokens).toBe(567);
    expect(totals.observed.costsByCurrency.USD).toEqual(["0.0123"]);
    expect(totals.estimated.inputTokens).toBe(10);
    expect(totals.estimated.outputTokens).toBe(567);
    // Mixed-basis aggregation never happens: the estimated bucket is its own.
    expect(totals.observed.records).toBe(1);
    expect(seen).toEqual(["w-1", "w-2"]);
    expect(collector.drain()).toHaveLength(2);
    expect(collector.events()).toHaveLength(0);
  });

  test("parseUsageMetadata reads token axes from JSON lines and ignores everything else", () => {
    expect(
      parseUsageMetadata(
        '{"type":"token_count","input_tokens":10,"output_tokens":4,"cache_read_input_tokens":2}',
      ),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 2,
      basis: "observed",
      cost: null,
      currency: null,
    });
    expect(
      parseUsageMetadata('{"usage":{"prompt_tokens":7,"completion_tokens":3,"total_cost":0.5}}'),
    ).toMatchObject({
      inputTokens: 7,
      outputTokens: 3,
      cost: "0.5",
    });
    expect(parseUsageMetadata('{"type":"item.completed"}')).toBeUndefined();
    expect(parseUsageMetadata("not json at all")).toBeUndefined();
    expect(parseUsageMetadata('{"input_tokens":-5}')).toBeUndefined();
    expect(parseUsageMetadata('{"currency":"usd"}')).toBeUndefined();
  });

  test("process adapters forward usage riding JSON lines as typed events (G17)", async () => {
    const { ProcessProvider } = await import("../src/process-provider");
    class StubProvider extends ProcessProvider {
      readonly id = "stub";
      protected runner = {
        probe: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        start: () => ({
          id: "p-1",
          result: Promise.resolve({
            exitCode: 0,
            stdout: '{"type":"result","usage":{"prompt_tokens":11,"completion_tokens":5}}\ndone',
            stderr: "",
          }),
          cancel: async () => {},
          subscribe: (
            listener: (event: { stream: "stdout" | "stderr"; chunk: string }) => void,
          ) => {
            listener({
              stream: "stdout",
              chunk: '{"type":"result","usage":{"prompt_tokens":11,"completion_tokens":5}}\n',
            });
            return () => {};
          },
        }),
      };
      capabilities() {
        return Promise.resolve({
          available: true,
          computeClasses: ["fast" as const],
          tools: true,
          vision: false,
          structuredOutput: true,
          resumableSession: false,
        });
      }
      protected launch() {
        return { command: "stub", args: [] };
      }
    }
    const provider = new StubProvider();
    const handle = await provider.start({
      runId: "run-1",
      taskId: "task-1",
      title: "t",
      kind: "implementation",
      computeClass: "fast",
      attempt: 0,
      requirements: [],
    });
    const events: ProviderEvent[] = [];
    provider.subscribe!(handle.id, (event) => events.push(event));
    const result = await provider.result(handle.id);
    expect(result.success).toBe(true);
    const usageEvent = events.find((event) => event.type === "usage");
    expect(usageEvent).toEqual({
      type: "usage",
      usage: {
        inputTokens: 11,
        outputTokens: 5,
        cacheReadTokens: null,
        basis: "observed",
        cost: null,
        currency: null,
      },
    });
  });

  test("UsageTrackingProvider funnels result-level usage into the collector with correlation", async () => {
    const inner: AgentProvider = {
      id: "inner",
      capabilities: async () => ({
        available: true,
        computeClasses: ["fast" as const],
        tools: true,
        vision: false,
        structuredOutput: true,
        resumableSession: false,
      }),
      start: async (input: StartWorkerInput): Promise<WorkerHandle> => {
        void input;
        return { id: "w-1" };
      },
      cancel: async () => {},
      status: async () => "completed",
      result: async (): Promise<WorkerResult> => ({
        success: true,
        summary: "done",
        usage: observed,
      }),
    };
    const tracking = new UsageTrackingProvider(inner);
    const handle = await tracking.start({
      runId: "run-42",
      taskId: "task-7",
      title: "t",
      kind: "implementation",
      computeClass: "fast",
      attempt: 0,
      requirements: [],
    });
    const result = await tracking.result(handle.id);
    expect(result.summary).toBe("done");
    const records = tracking.collector.events();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ runId: "run-42", taskId: "task-7", workerId: "w-1" });
    expect(at(records, 0).usage.inputTokens).toBe(1_234);
    expect(tracking.sandboxDeclaration().adapterId).toBe("inner");
  });
});
