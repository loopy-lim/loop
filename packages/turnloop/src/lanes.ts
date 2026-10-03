import type {
  ToolCallRequest,
  ToolDeclaration,
  ToolExecutionMode,
  ToolExecutionOutput,
  ToolResultMessage,
  ToolRunner,
  TurnLoopEvent,
  TurnLoopMessage,
} from "./types";

/**
 * Default parallel lane width. Worst-case context suffix invalidation stays
 * bounded by cap × fixed slot size (decision M-TL1 캐시 제약 3), so the
 * default is conservative and every caller can tune it via configuration.
 */
export const DEFAULT_LANE_CAP = 4;

const ABORTED_WAIT = "aborted while waiting for tool progress";

/**
 * Fixed-shape in-progress slot appended the moment a tool call is issued
 * (decision M-TL1 캐시 제약 1): same keys as the final record, content derived
 * only from issuance-time data, so the slot size never changes during a turn
 * and the in-place substitution (캐시 제약 2) never reflows earlier items.
 */
export function inProgressToolResult(call: ToolCallRequest): ToolResultMessage {
  return {
    role: "tool_result",
    callId: call.id,
    name: call.name,
    output: `tool ${call.name} is running`,
    isError: false,
    status: "in_progress",
  };
}

interface Slot {
  readonly call: ToolCallRequest;
  /** Transcript index of the in-progress item; substitution target. */
  readonly index: number;
}

/** Final-only mode: one issued call waiting for its result to be recorded. */
interface PendingFinal {
  readonly slot: Slot;
  result?: ToolExecutionOutput;
}

/**
 * Per-turn parallel tool lanes (M-TL1). Issue is two-phase: phase one appends
 * a fixed-shape in-progress slot for every call synchronously in issuance
 * order, phase two starts executions that draw capacity from the lane cap.
 * A completion substitutes its slot in place (final order is therefore always
 * issuance order, never completion order), counts as loop progress, and wakes
 * the engine so the next model turn can start immediately — the model never
 * waits for the whole batch or polls. Tools declared `sequential` serialize
 * among themselves in a single-file lane and never block parallel lanes.
 *
 * Final-only mode (M-TL3 `recordInProgress: false`): phase one records no
 * in-progress rows; results are held until the whole batch is final and then
 * appended in issuance order. Execution stays fully parallel and per-completion
 * — only the transcript representation and the model-turn cadence change,
 * because a not-yet-final tool_call has no representable transcript row in
 * this mode (the strict providers the flag exists for would reject it).
 */
export class ToolLaneScheduler {
  readonly #runner: ToolRunner;
  readonly #modeByName: ReadonlyMap<string, ToolExecutionMode>;
  readonly #laneCap: number;
  readonly #messages: TurnLoopMessage[];
  readonly #emit: (event: TurnLoopEvent) => void;
  /**
   * Two-item pattern switch (M-TL3 capability flag): false records final-only
   * — no in-progress rows ever enter the transcript, and the next model turn
   * waits until the whole issued batch is final because a dangling tool_call
   * is not representable without an in-progress row.
   */
  readonly #recordInProgress: boolean;

  #issued = 0;
  #completed = 0;
  /** Number of final records actually appended to the transcript. */
  #visible = 0;
  #observed = 0;
  #activeLanes = 0;
  readonly #laneQueue: Array<() => void> = [];
  #sequentialTail: Promise<void> = Promise.resolve();
  #wake: (() => void) | null = null;
  #settled = false;
  /** Final-only mode: issued calls of the open batch in issuance order. */
  readonly #pendingFinals: PendingFinal[] = [];

  constructor(input: {
    runner: ToolRunner;
    tools: readonly ToolDeclaration[];
    laneCap: number;
    messages: TurnLoopMessage[];
    emit: (event: TurnLoopEvent) => void;
    recordInProgress?: boolean;
  }) {
    this.#runner = input.runner;
    this.#modeByName = new Map(
      input.tools.map((tool) => [tool.name, tool.executionMode ?? "parallel"]),
    );
    this.#laneCap = input.laneCap;
    this.#messages = input.messages;
    this.#emit = input.emit;
    this.#recordInProgress = input.recordInProgress !== false;
  }

  /** True while any issued call has not produced its final record yet. */
  get hasOutstanding(): boolean {
    return this.#issued > this.#completed;
  }

  /**
   * Phase one + two for one model turn: synchronous in-progress appends in
   * issuance order, then lane scheduling. Queued calls already carry their
   * in-progress slot, so the context shape is complete before anything runs.
   */
  issue(calls: readonly ToolCallRequest[]): void {
    const slots: Slot[] = [];
    for (const call of calls) {
      const slot: Slot = { call, index: this.#recordInProgress ? this.#messages.length : -1 };
      if (this.#recordInProgress) this.#messages.push(inProgressToolResult(call));
      else this.#pendingFinals.push({ slot });
      this.#emit({ type: "tool_call", call });
      slots.push(slot);
      this.#issued += 1;
    }
    // #execute awaits its gate before touching the runner, so every slot
    // above exists before the first execution starts.
    for (const slot of slots) void this.#dispatch(slot);
  }

  /**
   * Resolves once at least one previously unobserved completion has been
   * recorded. Completions landing in the same drain coalesce into a single
   * wake — the aggregation window is one microtask drain, nothing timed.
   * Rejects only when the signal aborts first, so cancellation is prompt
   * instead of waiting on the slowest in-flight tool.
   */
  async waitForProgress(signal?: AbortSignal): Promise<void> {
    while (this.#visible === this.#observed) {
      const wake = new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
      if (signal === undefined) {
        await wake;
        continue;
      }
      await waitForWakeOrAbort(wake, signal);
    }
    this.#observed = this.#visible;
  }

  /**
   * Stops recording once the loop has produced its outcome: the returned
   * transcript snapshot is final and late completions must not mutate it.
   */
  settle(): void {
    this.#settled = true;
    this.#wake = null;
  }

  #modeOf(name: string): ToolExecutionMode {
    return this.#modeByName.get(name) ?? "parallel";
  }

  async #dispatch(slot: Slot): Promise<void> {
    if (this.#modeOf(slot.call.name) === "sequential") {
      this.#chainSequential(slot);
      return;
    }
    await this.#acquireLane();
    await this.#execute(slot, true);
  }

  #chainSequential(slot: Slot): void {
    const run = this.#sequentialTail.then(() => this.#execute(slot, false));
    this.#sequentialTail = run.then(
      () => undefined,
      () => undefined,
    );
  }

  async #acquireLane(): Promise<void> {
    if (this.#activeLanes < this.#laneCap) {
      this.#activeLanes += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.#laneQueue.push(resolve);
    });
  }

  #releaseLane(): void {
    const next = this.#laneQueue.shift();
    // A waiting call takes over the lane; the count only drops with no queue.
    if (next) next();
    else this.#activeLanes -= 1;
  }

  async #execute(slot: Slot, laneHeld: boolean): Promise<void> {
    let result: ToolExecutionOutput;
    try {
      result = await this.#runner.run(slot.call);
    } catch (error) {
      // A tool failure feeds back as an error result; it never kills the loop.
      result = {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
    this.#finish(slot, result);
    if (laneHeld) this.#releaseLane();
  }

  #finish(slot: Slot, result: ToolExecutionOutput): void {
    if (this.#settled) return;
    if (this.#recordInProgress) {
      // In-place substitution: the final record takes over the slot index the
      // in-progress item held, keeping final order identical to issuance order.
      this.#messages[slot.index] = {
        role: "tool_result",
        callId: slot.call.id,
        name: slot.call.name,
        output: result.output,
        isError: result.isError,
        status: "final",
      };
      this.#visible += 1;
    } else {
      // Final-only: hold the result until the whole issued batch is final,
      // then append every final in issuance order (M-TL1 determinism). No
      // dangling tool_call ever faces the model — that state is only
      // representable with an in-progress row, which this mode forbids.
      const pending = this.#pendingFinals.find((entry) => entry.slot === slot);
      if (pending) pending.result = result;
      if (this.#pendingFinals.every((entry) => entry.result !== undefined)) this.#flushFinals();
    }
    this.#completed += 1;
    this.#emit({
      type: "tool_result",
      callId: slot.call.id,
      name: slot.call.name,
      isError: result.isError,
    });
    const wake = this.#wake;
    this.#wake = null;
    wake?.();
  }

  #flushFinals(): void {
    for (const entry of this.#pendingFinals) {
      const result = entry.result!;
      this.#messages.push({
        role: "tool_result",
        callId: entry.slot.call.id,
        name: entry.slot.call.name,
        output: result.output,
        isError: result.isError,
        status: "final",
      });
      this.#visible += 1;
    }
    this.#pendingFinals.length = 0;
  }
}

function waitForWakeOrAbort(wake: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error(ABORTED_WAIT));
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new Error(ABORTED_WAIT));
    signal.addEventListener("abort", onAbort, { once: true });
    wake.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}
