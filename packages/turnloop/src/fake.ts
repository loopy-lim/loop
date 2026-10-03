import type {
  ModelClient,
  ModelTurnOutput,
  ModelTurnRequest,
  ToolCallRequest,
  ToolExecutionOutput,
  ToolRunner,
} from "./types";

/**
 * Scripted model boundary for deterministic tests (decision M-TL0: 유료 모델
 * 호출 금지 — all verification runs against this client). Each entry is a
 * canned `ModelTurnOutput` or a function of the request, so tests can assert
 * on the exact transcript the loop assembled. A request past the script end
 * throws, which surfaces as `model_client_error` instead of hanging a test.
 */
export type ScriptedTurn =
  | ModelTurnOutput
  | ((request: ModelTurnRequest) => ModelTurnOutput | Promise<ModelTurnOutput>);

export class FakeModelClient implements ModelClient {
  readonly #script: readonly ScriptedTurn[];
  readonly requests: ModelTurnRequest[] = [];

  constructor(script: readonly ScriptedTurn[]) {
    if (script.length === 0) throw new Error("FakeModelClient requires at least one scripted turn");
    this.#script = [...script];
  }

  get turnsServed(): number {
    return this.requests.length;
  }

  async complete(request: ModelTurnRequest): Promise<ModelTurnOutput> {
    const index = this.requests.length;
    const next = this.#script[index];
    this.requests.push(request);
    if (next === undefined) {
      throw new Error(`FakeModelClient script exhausted after ${this.#script.length} turn(s)`);
    }
    return typeof next === "function" ? next(request) : next;
  }
}

/**
 * Scripted tool boundary: a handler function plus a call log, so tests can
 * observe invocation order and drive completions (or errors) deterministically.
 */
export class FakeToolRunner implements ToolRunner {
  readonly calls: ToolCallRequest[] = [];

  constructor(
    private readonly handler: (
      call: ToolCallRequest,
    ) => ToolExecutionOutput | Promise<ToolExecutionOutput>,
  ) {}

  async run(call: ToolCallRequest): Promise<ToolExecutionOutput> {
    this.calls.push(call);
    return this.handler(call);
  }
}
