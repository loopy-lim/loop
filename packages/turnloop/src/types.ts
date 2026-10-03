/**
 * Own-turn-loop adapter vocabulary (docs/decisions/2026-xx-own-turn-loop-and-subagent-steering.md,
 * TL1/M-TL0). This package owns a worker execution loop behind the existing
 * `AgentProvider` contract; it never imports loop-core/loop-store/loop-bridge,
 * never appends events or reads projections (recording stays with the
 * orchestrator), and receives model identity/endpoints only through
 * constructor/config so nothing provider-specific lands in the loop itself.
 */

/** A tool invocation issued by the model for the current turn. */
export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  /** Opaque JSON string; parsing belongs to the ToolRunner, not the loop. */
  readonly argumentsJson: string;
}

/**
 * How a declared tool draws execution capacity (M-TL1 parallel lanes):
 * "parallel" (default) occupies one of the configured lanes, "sequential"
 * serializes in its own single-file lane without blocking parallel lanes.
 */
export type ToolExecutionMode = "parallel" | "sequential";

/** Static tool description handed to the model client each turn. */
export interface ToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly executionMode?: ToolExecutionMode;
}

/** Outcome of running one tool call. */
export interface ToolExecutionOutput {
  readonly output: string;
  readonly isError: boolean;
}

/** Executes one tool call. Tool semantics (cwd, parsing, effects) live here. */
export interface ToolRunner {
  run(call: ToolCallRequest): Promise<ToolExecutionOutput>;
}

/** Lifecycle of a tool result slot in the transcript (M-TL1 two-item pattern). */
export type ToolResultStatus = "in_progress" | "final";

/**
 * Conversation transcript driving the loop. Messages are only ever appended
 * or substituted in place inside a fixed-shape in-progress tool slot — the
 * prefix before the earliest open slot never changes at a turn boundary.
 */
export type TurnLoopMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: readonly ToolCallRequest[] }
  | {
      role: "tool_result";
      callId: string;
      name: string;
      output: string;
      isError: boolean;
      status: ToolResultStatus;
    };

/** The `tool_result` variant on its own, for slot construction. */
export type ToolResultMessage = Extract<TurnLoopMessage, { role: "tool_result" }>;

/** One request to the model: the full transcript plus tool declarations. */
export interface ModelTurnRequest {
  readonly system: string;
  readonly messages: readonly TurnLoopMessage[];
  readonly tools: readonly ToolDeclaration[];
}

/** One model turn: either a final message or tool calls to execute. */
export type ModelTurnOutput =
  | { kind: "message"; text: string }
  | { kind: "tool_calls"; calls: readonly ToolCallRequest[] };

/**
 * Model boundary. Implementations own endpoints, model selection, and
 * credentials; the loop only sees scripted or real completions. Nothing here
 * may log credentials (decision TL1 금지 목록).
 */
export interface ModelClient {
  complete(request: ModelTurnRequest): Promise<ModelTurnOutput>;
}

/**
 * Steer hand-off boundary (decision TL2/M-TL2). The mailbox delivers a steer
 * by pushing it here; the loop owns consumption. Draining happens only at
 * turn boundaries — never mid-turn and never gated on tool completion or a
 * re-claim — so a steer issued while tools are in flight waits in the queue
 * (the queue is the coalescing point) and enters the transcript at the very
 * next model turn.
 */
export interface SteerInbox {
  /** Removes and returns every steer queued since the last boundary drain. */
  drain(): readonly string[];
}

/** Default inbox: FIFO, unbounded — the mailbox owns byte-budget coalescing. */
export class SteerQueue implements SteerInbox {
  readonly #pending: string[] = [];

  /** Queues one steer; consumed at the next turn boundary. */
  push(message: string): void {
    this.#pending.push(message);
  }

  /** Number of steers waiting for the next turn boundary (diagnostics). */
  get pending(): number {
    return this.#pending.length;
  }

  drain(): readonly string[] {
    return this.#pending.splice(0, this.#pending.length);
  }
}

/** Internal loop progress events; the provider renders them as ProviderEvent. */
export type TurnLoopEvent =
  | { type: "turn_start"; turn: number }
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; call: ToolCallRequest }
  | { type: "tool_result"; callId: string; name: string; isError: boolean }
  | { type: "steer_applied"; text: string }
  | { type: "turn_end"; turn: number };

export type TurnLoopFailureReason =
  /** Configured turn budget ran out before a final message. */
  | "max_turns_exhausted"
  /** Model client threw or returned a malformed turn. */
  | "model_client_error"
  /** AbortSignal fired at a turn or tool boundary. */
  | "aborted";

export type TurnLoopOutcome =
  | {
      status: "completed";
      finalText: string;
      turns: number;
      toolCallCount: number;
      messages: readonly TurnLoopMessage[];
    }
  | {
      status: "failed";
      reason: TurnLoopFailureReason;
      detail: string;
      turns: number;
      toolCallCount: number;
      messages: readonly TurnLoopMessage[];
    };

export interface TurnLoopOptions {
  /** Model boundary (endpoints/credentials live in the implementation). */
  readonly modelClient: ModelClient;
  /** Tool boundary; defaults to a runner that reports every tool unavailable. */
  readonly toolRunner?: ToolRunner;
  readonly system: string;
  readonly prompt: string;
  readonly tools?: readonly ToolDeclaration[];
  /** Hard cap on model turns; tuning values stay in adapter config. */
  readonly maxTurns?: number;
  /**
   * Maximum concurrently executing parallel tool lanes (M-TL1). The
   * worst-case context suffix invalidation is bounded by cap × fixed slot
   * size, so the cap is explicit configuration; sequential-declared tools
   * bypass the cap in their own single-file lane.
   */
  readonly laneCap?: number;
  readonly steerInbox?: SteerInbox;
  /**
   * Two-item pattern capability (M-TL3, decision 공급자 다양성): false →
   * final-only recording. Provider-specific acceptance lives ONLY here —
   * never in loop-core, events, or the protocol. Default true.
   */
  readonly inProgressToolResults?: boolean;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: TurnLoopEvent) => void;
}
