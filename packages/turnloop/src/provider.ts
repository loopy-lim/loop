import { randomUUID } from "node:crypto";

import type { ComputeClass } from "@loop/protocol";
import type {
  AgentProvider,
  ProviderCapabilities,
  ProviderEvent,
  StartWorkerInput,
  WorkerHandle,
  WorkerResult,
  WorkerState,
} from "@loop/providers";

import { buildSystemPrompt, buildTaskPrompt } from "./context";
import { startTurnLoop } from "./engine";
import { SteerQueue } from "./types";
import type {
  ModelClient,
  ToolDeclaration,
  ToolRunner,
  TurnLoopFailureReason,
  TurnLoopOutcome,
} from "./types";

export interface TurnLoopProviderOptions {
  /** Provider identity used by the orchestrator registry (e.g. "turnloop"). */
  readonly id?: string;
  /**
   * Model boundary. Endpoints, model selection, and credentials live inside
   * this implementation and are never logged or persisted here (decision TL1).
   */
  readonly modelClient: ModelClient;
  /** Tool boundary; defaults to reporting every tool as unavailable. */
  readonly toolRunner?: ToolRunner;
  /** Tools declared to the model each turn; declared here, not in the loop. */
  readonly tools?: readonly ToolDeclaration[];
  /** Compute-class stance comes from configuration at construction time. */
  readonly computeClasses: ComputeClass[];
  /** Reporting-only model identity from config; never used for requests. */
  readonly modelId?: string;
  readonly maxTurns?: number;
  /** Parallel tool lane width handed to the loop (M-TL1 tuning value). */
  readonly laneCap?: number;
  /**
   * Two-item pattern capability flag (M-TL3, decision 공급자 다양성):
   * false → the loop records final-only results for this provider profile.
   * Adapter-construction setting only — never persisted to events, the
   * protocol, or loop-core. Default true (in-progress + final items).
   */
  readonly inProgressToolResults?: boolean;
}

interface Session {
  status: WorkerState;
  settled: boolean;
  abort: AbortController;
  worker: Promise<WorkerResult>;
  resolveWorker: (result: WorkerResult) => void;
  listeners: Set<(event: ProviderEvent) => void>;
  /** Events emitted before the first subscribe(); replayed on attach. */
  replay: ProviderEvent[];
  /** Turn-boundary steer queue drained by the loop (M-TL2). */
  readonly steers: SteerQueue;
}

/**
 * Own-turn-loop worker adapter (decision TL1/M-TL0). Implements the same
 * `AgentProvider` contract as the CLI-harness providers, so the orchestrator
 * cannot tell this worker apart from a pi worker: start returns a handle
 * immediately, the loop runs in the background, result resolves with the
 * mapped outcome, and cancel aborts at the next turn/tool boundary.
 *
 * Steering (M-TL2): `steer` queues the message into the session's turn
 * boundary inbox and resolves immediately — it never waits for tool
 * completion or a re-claim. The loop applies the queue at the very next turn
 * boundary. Rejections follow the provider contract: an unknown, settled, or
 * empty steer throws so the caller's recorded-steer contract keeps the
 * message in the run history for the next claim context.
 *
 * Not implemented on purpose:
 * - `resume` — no resumable session yet (`resumableSession: false`).
 */
export class TurnLoopProvider implements AgentProvider {
  readonly id: string;
  /**
   * Steer-delivery declaration (M-TL2): the steer channel is a turn-boundary
   * inbox — it coalesces at its own boundaries, so the orchestrator's mailbox
   * hands steers off on every tap tick instead of applying its
   * conversation-spam window. Read structurally (steerCoalescingOf); the
   * orchestrator never learns a provider identity from it.
   */
  readonly steerDelivery = "turn_boundary" as const;
  readonly #modelClient: ModelClient;
  readonly #toolRunner?: ToolRunner;
  readonly #tools: readonly ToolDeclaration[];
  readonly #computeClasses: ComputeClass[];
  readonly #modelId?: string;
  readonly #maxTurns?: number;
  readonly #laneCap?: number;
  readonly #inProgressToolResults: boolean;
  readonly #sessions = new Map<string, Session>();

  constructor(options: TurnLoopProviderOptions) {
    this.id = options.id ?? "turnloop";
    this.#modelClient = options.modelClient;
    this.#toolRunner = options.toolRunner;
    this.#tools = options.tools ?? [];
    this.#computeClasses = [...options.computeClasses];
    this.#modelId = options.modelId;
    this.#maxTurns = options.maxTurns;
    this.#laneCap = options.laneCap;
    this.#inProgressToolResults = options.inProgressToolResults !== false;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      available: true,
      models: this.#modelId ? [this.#modelId] : undefined,
      computeClasses: this.#computeClasses,
      tools: this.#tools.length > 0,
      vision: false,
      structuredOutput: false,
      resumableSession: false,
    };
  }

  async start(input: StartWorkerInput): Promise<WorkerHandle> {
    const id = `${this.id}-${randomUUID()}`;
    const abort = new AbortController();
    const listeners = new Set<(event: ProviderEvent) => void>();
    let resolveWorker!: (result: WorkerResult) => void;
    const worker = new Promise<WorkerResult>((resolve) => {
      resolveWorker = resolve;
    });
    const session: Session = {
      status: "running",
      settled: false,
      abort,
      worker,
      resolveWorker,
      listeners,
      replay: [],
      steers: new SteerQueue(),
    };
    this.#sessions.set(id, session);

    const emit = (event: ProviderEvent) => {
      if (session.listeners.size === 0) {
        session.replay.push(event);
        return;
      }
      for (const listener of session.listeners) listener(event);
    };
    emit({ type: "lifecycle", status: "running" });
    emit({ type: "session", sessionId: id });

    // The loop runs in the background; start stays synchronous like the
    // process-based providers. Recording (WorkerStarted/WorkerResult) is the
    // orchestrator's job — nothing here appends events.
    void startTurnLoop({
      modelClient: this.#modelClient,
      toolRunner: this.#toolRunner,
      system: buildSystemPrompt(),
      prompt: buildTaskPrompt(input),
      tools: this.#tools,
      maxTurns: this.#maxTurns,
      laneCap: this.#laneCap,
      inProgressToolResults: this.#inProgressToolResults,
      steerInbox: session.steers,
      signal: abort.signal,
      onEvent: (event) => {
        if (event.type === "assistant_text") {
          emit({ type: "output", stream: "stdout", text: event.text });
        } else if (event.type === "tool_call") {
          emit({
            type: "output",
            stream: "stdout",
            text: `tool call ${event.call.name} (${event.call.id})`,
          });
        } else if (event.type === "tool_result") {
          emit({
            type: "output",
            stream: "stdout",
            text: `tool ${event.name} ${event.isError ? "failed" : "completed"} (${event.callId})`,
          });
        } else if (event.type === "steer_applied") {
          emit({
            type: "output",
            stream: "stdout",
            text: `steer applied at turn boundary: ${event.text}`,
          });
        }
      },
    })
      .then((outcome) => this.#finish(id, session, outcome, emit))
      .catch((error: unknown) => {
        // startTurnLoop already maps its own errors; this guards the
        // post-outcome bookkeeping only.
        if (!session.settled) {
          session.settled = true;
          session.status = "lost";
          session.resolveWorker({
            success: false,
            summary: error instanceof Error ? error.message : String(error),
            failure: { kind: "process_error", retryable: true },
          });
        }
      });

    return { id, sessionId: id };
  }

  async cancel(workerId: string): Promise<void> {
    const session = this.#sessionFor(workerId);
    if (session.settled) return;
    session.settled = true;
    session.status = "cancelled";
    session.abort.abort();
    session.resolveWorker({
      success: false,
      summary: "cancelled",
      failure: { kind: "cancelled", retryable: false },
    });
    for (const listener of session.listeners) listener({ type: "lifecycle", status: "cancelled" });
  }

  /**
   * Queues one steer for the next turn boundary (M-TL2). Resolves as soon as
   * the message is in the inbox — application is the loop's job and happens
   * without waiting for tool completion or a re-claim. Throws when the
   * worker cannot receive it (unknown id, already settled, empty message) so
   * the caller falls back to the recorded-steer contract.
   */
  async steer(workerId: string, message: string): Promise<void> {
    if (message.trim().length === 0) throw new Error("steer message must not be empty");
    const session = this.#sessions.get(workerId);
    if (!session || session.settled) {
      throw new Error(`worker ${workerId} is not accepting steer`);
    }
    session.steers.push(message);
  }

  async release(workerId: string): Promise<void> {
    this.#sessions.delete(workerId);
  }

  async status(workerId: string): Promise<WorkerState> {
    return this.#sessionFor(workerId).status;
  }

  async result(workerId: string): Promise<WorkerResult> {
    return this.#sessionFor(workerId).worker;
  }

  subscribe(workerId: string, listener: (event: ProviderEvent) => void): () => void {
    const session = this.#sessionFor(workerId);
    const buffered = session.replay.splice(0, session.replay.length);
    for (const event of buffered) listener(event);
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  #finish(
    workerId: string,
    session: Session,
    outcome: TurnLoopOutcome,
    emit: (event: ProviderEvent) => void,
  ): void {
    if (session.settled) return;
    session.settled = true;
    if (outcome.status === "completed") {
      session.status = "completed";
      emit({ type: "final", summary: outcome.finalText });
      emit({ type: "lifecycle", status: "completed" });
      session.resolveWorker({ success: true, summary: outcome.finalText, sessionId: workerId });
      return;
    }
    session.status = "lost";
    emit({ type: "final", summary: outcome.detail });
    emit({ type: "lifecycle", status: "lost" });
    session.resolveWorker({
      success: false,
      summary: outcome.detail,
      failure: { kind: mapFailureKind(outcome.reason), retryable: outcome.reason !== "aborted" },
    });
  }

  #sessionFor(workerId: string): Session {
    const session = this.#sessions.get(workerId);
    if (!session) throw new Error(`unknown worker ${workerId}`);
    return session;
  }
}

function mapFailureKind(reason: TurnLoopFailureReason) {
  switch (reason) {
    case "max_turns_exhausted":
      return "incomplete_output" as const;
    case "aborted":
      return "cancelled" as const;
    case "model_client_error":
      return "process_error" as const;
  }
}
