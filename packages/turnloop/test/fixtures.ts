import type { ComputeClass, TaskContextOutput } from "@loop/protocol";
import type { StartWorkerInput } from "@loop/providers";

import type {
  ToolCallRequest,
  ToolExecutionOutput,
  ToolResultMessage,
  ToolRunner,
  TurnLoopMessage,
} from "../src";

export function taskContext(overrides: Partial<TaskContextOutput> = {}): TaskContextOutput {
  return {
    intent: "Ship the turn loop adapter",
    workingDirectory: "/repo",
    task: {
      id: "t-1",
      title: "Build the loop skeleton",
      kind: "implementation",
      dependencies: [],
      readScope: ["docs/"],
      writeScope: ["packages/turnloop/**"],
      requirements: ["No paid model calls", "Deterministic tests only"],
      completionChecks: [],
      preferredCompute: "fast",
      minimumCompute: "tiny",
      maximumCompute: "frontier",
      maxAttempts: 2,
    },
    decompositionContract: null,
    attempt: 0,
    dependencyResults: [],
    previousChecks: [],
    guidance: [],
    ...overrides,
  };
}

export function startInput(overrides: Partial<StartWorkerInput> = {}): StartWorkerInput {
  return {
    runId: "r-1",
    taskId: "t-1",
    title: "Build the loop skeleton",
    kind: "implementation",
    computeClass: "fast" as ComputeClass,
    attempt: 0,
    requirements: ["No paid model calls"],
    context: taskContext(),
    ...overrides,
  };
}

export function message(text: string) {
  return { kind: "message" as const, text };
}

/** `name` is optional in tests that only assert on call ids and ordering. */
export function toolCalls(...calls: Array<{ id: string; name?: string; args?: string }>) {
  return {
    kind: "tool_calls" as const,
    calls: calls.map((call) => ({
      id: call.id,
      name: call.name ?? "tool",
      argumentsJson: call.args ?? "{}",
    })),
  };
}

export class Deferred<T> {
  readonly promise: Promise<T>;
  #resolve!: (value: T) => void;
  #reject!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  resolve(value: T): void {
    this.#resolve(value);
  }

  reject(error: unknown): void {
    this.#reject(error);
  }
}

/**
 * Deterministic lane-test tool boundary: each call records its start, then
 * parks on a manual gate until `settle` releases it with a result. Lets a
 * test hold tools in flight, release them in any order, and read exactly
 * which calls started (lane concurrency evidence) and settled (completion
 * order evidence) — no timers involved.
 */
export class GatedToolRunner implements ToolRunner {
  readonly started: string[] = [];
  readonly settled: string[] = [];
  readonly #gates = new Map<string, Deferred<ToolExecutionOutput>>();
  readonly #calls = new Map<string, ToolCallRequest>();

  constructor(
    private readonly output: (call: ToolCallRequest) => ToolExecutionOutput = () => ({
      output: "ok",
      isError: false,
    }),
  ) {}

  run(call: ToolCallRequest): Promise<ToolExecutionOutput> {
    this.started.push(call.id);
    this.#calls.set(call.id, call);
    const gate = new Deferred<ToolExecutionOutput>();
    this.#gates.set(call.id, gate);
    return gate.promise.then((result) => {
      this.settled.push(call.id);
      return result;
    });
  }

  settle(callId: string, override?: Partial<ToolExecutionOutput>): void {
    const gate = this.#gates.get(callId);
    const call = this.#calls.get(callId);
    if (!gate || !call) throw new Error(`no gated call ${callId}`);
    gate.resolve({ ...this.output(call), ...override });
  }

  settleError(callId: string, message: string): void {
    this.settle(callId, { output: message, isError: true });
  }
}

/**
 * Drains every pending microtask (the loop's wakes, slot substitutions, lane
 * hand-offs) before the next test step, keeping async turns deterministic
 * without timing dependencies.
 */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function toolResults(messages: readonly TurnLoopMessage[]): ToolResultMessage[] {
  return messages.filter((entry): entry is ToolResultMessage => entry.role === "tool_result");
}
