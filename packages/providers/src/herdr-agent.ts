import type { ComputeClass } from "@loop/protocol";

import type {
  HerdrExecution,
  HerdrWorkerHandle,
  HerdrWorkerRuntime,
} from "@loop/herdr";

import type {
  AgentProvider,
  ProviderCapabilities,
  ProviderEvent,
  StartWorkerInput,
  WorkerHandle,
  WorkerResult,
  WorkerState,
} from "./types";
import { buildWorkerPrompt } from "./prompt";
import { redactProviderText } from "./redact";

interface HerdrAgentProviderOptions {
  id: string;
  runtime: HerdrWorkerRuntime;
  kind: Extract<HerdrExecution, { type: "agent" }>["kind"];
  projectRoot: string;
  computeClasses: ComputeClass[];
  args?: string[];
  available?: boolean;
  pollIntervalMs?: number;
  startGraceMs?: number;
}

interface Session {
  handle: HerdrWorkerHandle;
  status: WorkerState;
  result: Promise<WorkerResult>;
  listeners: Set<(event: ProviderEvent) => void>;
  cancelRequested: boolean;
  resolveCancellation: (result: WorkerResult) => void;
}

export class HerdrAgentProvider implements AgentProvider {
  readonly id: string;
  readonly #runtime: HerdrWorkerRuntime;
  readonly #kind: HerdrAgentProviderOptions["kind"];
  readonly #projectRoot: string;
  readonly #computeClasses: ComputeClass[];
  readonly #args: string[];
  readonly #available: boolean;
  readonly #pollIntervalMs: number;
  readonly #startGraceMs: number;
  readonly #sessions = new Map<string, Session>();

  constructor(options: HerdrAgentProviderOptions) {
    this.id = options.id;
    this.#runtime = options.runtime;
    this.#kind = options.kind;
    this.#projectRoot = options.projectRoot;
    this.#computeClasses = [...options.computeClasses];
    this.#args = [...(options.args ?? [])];
    this.#available = options.available ?? true;
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
    this.#startGraceMs = options.startGraceMs ?? 5_000;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      available: this.#available,
      computeClasses: this.#computeClasses,
      tools: true,
      vision: this.#kind === "codex" || this.#kind === "agy",
      structuredOutput: false,
      resumableSession: true,
    };
  }

  async start(input: StartWorkerInput): Promise<WorkerHandle> {
    const callerPaneId = process.env.HERDR_PANE_ID;
    const callerWorkspaceId = callerPaneId ? callerPaneId.split(':')[0] : undefined;
    const caller = callerWorkspaceId && callerPaneId ? {
      workspaceId: callerWorkspaceId,
      paneId: callerPaneId,
    } : undefined;

    const handle = await this.#runtime.start({
      projectRoot: this.#projectRoot,
      runId: input.runId,
      taskId: input.taskId,
      workerName: `${input.runId}-${input.taskId}`,
      worktree: input.workingDirectory ?? this.#projectRoot,
      execution: { type: "agent", kind: this.#kind, args: this.#args },
      prompt: buildWorkerPrompt(input),
      waitForPrompt: true,
      caller,
    });
    const listeners = new Set<(event: ProviderEvent) => void>();
    let resolveCancellation!: (result: WorkerResult) => void;
    const cancellation = new Promise<WorkerResult>((resolve) => {
      resolveCancellation = resolve;
    });
    const session: Session = {
      handle,
      status: "running",
      result: Promise.resolve({
        success: false,
        summary: "not started",
        failure: { kind: "process_error", retryable: true },
      }),
      listeners,
      cancelRequested: false,
      resolveCancellation,
    };
    session.result = Promise.race([this.#wait(session), cancellation]).catch((error) => {
      session.status = session.cancelRequested ? "cancelled" : "lost";
      this.#emit(session, { type: "lifecycle", status: session.status });
      return {
        success: false,
        summary: session.cancelRequested
          ? "cancelled"
          : redact(error instanceof Error ? error.message : String(error)),
        sessionId: session.handle.agentName,
        failure: session.cancelRequested
          ? { kind: "cancelled" as const, retryable: false }
          : { kind: "process_error" as const, retryable: true },
      };
    });
    this.#sessions.set(handle.workerId, session);
    this.#emit(session, { type: "lifecycle", status: "running" });
    return { id: handle.workerId, sessionId: handle.agentName };
  }

  async cancel(workerId: string): Promise<void> {
    const session = this.#require(workerId);
    if (session.status !== "running") return;
    session.cancelRequested = true;
    await this.#runtime.cancel(session.handle);
    session.status = "cancelled";
    this.#emit(session, { type: "lifecycle", status: "cancelled" });
    session.resolveCancellation(cancelledResult(session));
    await session.result;
  }

  async status(workerId: string): Promise<WorkerState> {
    const session = this.#require(workerId);
    if (session.status !== "running") return session.status;
    const observed = await this.#runtime.status(session.handle);
    if (session.cancelRequested && observed !== "running") session.status = "cancelled";
    else if (observed === "completed") session.status = "completed";
    else if (observed === "failed" || observed === "blocked" || observed === "unknown") {
      session.status = "lost";
    }
    return session.status;
  }

  result(workerId: string): Promise<WorkerResult> {
    return this.#require(workerId).result;
  }

  async release(workerId: string): Promise<void> {
    const session = this.#require(workerId);
    await session.result;
    await this.#runtime.cleanup(session.handle);
    this.#sessions.delete(workerId);
  }

  subscribe(workerId: string, listener: (event: ProviderEvent) => void): () => void {
    const listeners = this.#require(workerId).listeners;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async #wait(session: Session): Promise<WorkerResult> {
    const startDeadline = Date.now() + this.#startGraceMs;
    let observedWorking = false;
    for (;;) {
      const observed = await this.#runtime.status(session.handle);
      if (observed === "running") {
        observedWorking = true;
        await delay(this.#pollIntervalMs);
        continue;
      }
      if (session.cancelRequested) {
        session.status = "cancelled";
        this.#emit(session, { type: "lifecycle", status: "cancelled" });
        return {
          success: false,
          summary: "cancelled",
          sessionId: session.handle.agentName,
          failure: { kind: "cancelled", retryable: false },
        };
      }
      if (observed === "idle" && !observedWorking) {
        if (Date.now() < startDeadline) {
          await delay(this.#pollIntervalMs);
          continue;
        }
        session.status = "lost";
        this.#emit(session, { type: "lifecycle", status: "lost" });
        return {
          success: false,
          summary: "Herdr acknowledged the prompt but never observed the worker start",
          sessionId: session.handle.agentName,
          failure: { kind: "incomplete_output", retryable: true },
        };
      }
      // Pi reports idle on agent_end. Only accept that transition after this
      // newly created worker was actually observed working on the prompt.
      if (observed === "completed" || (observed === "idle" && observedWorking)) {
        session.status = "completed";
        const summary = redact((await this.#runtime.read(session.handle)).trim());
        this.#emit(session, { type: "lifecycle", status: "completed" });
        if (!summary) {
          return {
            success: false,
            summary: "Herdr worker completed without readable output",
            sessionId: session.handle.agentName,
            failure: { kind: "incomplete_output", retryable: true },
          };
        }
        this.#emit(session, { type: "final", summary });
        return { success: true, summary, sessionId: session.handle.agentName };
      }
      session.status = "lost";
      const summary = redact((await this.#runtime.read(session.handle)).trim())
        || `Herdr worker became ${observed}`;
      this.#emit(session, { type: "lifecycle", status: "lost" });
      return {
        success: false,
        summary,
        sessionId: session.handle.agentName,
        failure: { kind: "process_error", retryable: observed !== "blocked" },
      };
    }
  }

  #require(workerId: string): Session {
    const session = this.#sessions.get(workerId);
    if (!session) throw new Error(`unknown worker ${workerId}`);
    return session;
  }

  #emit(session: Session, event: ProviderEvent): void {
    for (const listener of session.listeners) listener(event);
  }
}

function cancelledResult(session: Session): WorkerResult {
  return {
    success: false,
    summary: "cancelled",
    sessionId: session.handle.agentName,
    failure: { kind: "cancelled", retryable: false },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

function redact(value: string): string {
  return redactProviderText(value);
}
