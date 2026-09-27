import type { ComputeClass } from "@loop/protocol";

import { herdrCallerFromEnvironment } from "@loop/herdr";
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
import { classifyFailure } from "./process-provider";
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
  /**
   * Total wall-clock budget for one worker run while the herdr agent keeps
   * reporting "running". Mirrors the process runner's run deadline
   * (2026-09-25 network-stall-hang fix): a stalled lane must classify as a
   * retryable timeout so the orchestrator's fallback chain takes over
   * instead of the run waiting forever. `0` disables the deadline.
   */
  runDeadlineMs?: number;
  retainCompletedTabs?: boolean;
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
  readonly #runDeadlineMs: number;
  readonly #retainCompletedTabs: boolean;
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
    this.#runDeadlineMs = options.runDeadlineMs ?? DEFAULT_RUN_DEADLINE_MS;
    this.#retainCompletedTabs = options.retainCompletedTabs ?? false;
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
    // Single-source caller derivation (2026-09-24 caller-anchoring decision):
    // worker tabs land in the Lead's workspace when HERDR_PANE_ID is set,
    // with the loop-<runId> workspace as the documented fallback.
    const caller = herdrCallerFromEnvironment(process.env);
    const args = this.#kind === "pi" && input.context?.task.writeScope.length === 0
      ? [...this.#args, "--tools", "read,grep,find,ls"]
      : this.#args;

    const handle = await this.#runtime.start({
      projectRoot: this.#projectRoot,
      runId: input.runId,
      taskId: input.taskId,
      workerName: `${input.runId}-${input.taskId}`,
      label: { kind: input.kind, attempt: input.attempt, includeRunMarker: this.#retainCompletedTabs },
      worktree: input.workingDirectory ?? this.#projectRoot,
      execution: { type: "agent", kind: this.#kind, args },
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

  /**
   * Live-conversation steering (live-tabs ADR §4): the message goes through
   * the same `agent prompt` surface as the initial prompt, so the user sees
   * it typed into the conversation TUI exactly like direct input. Rejections
   * (e.g. `agent_blocked` while a blocking UI holds the agent) propagate —
   * the steer record stays in the run history per the recorded-steer
   * contract.
   */
  async steer(workerId: string, message: string): Promise<void> {
    const session = this.#require(workerId);
    if (session.status !== "running") {
      throw new Error(`worker ${workerId} is no longer running (${session.status})`);
    }
    await this.#runtime.steer(session.handle, message);
  }

  async release(workerId: string): Promise<void> {
    const session = this.#require(workerId);
    const result = await session.result;
    if (this.#retainCompletedTabs && result.success && !session.cancelRequested) {
      this.#runtime.detach(session.handle);
    } else {
      await this.#runtime.cleanup(session.handle);
    }
    this.#sessions.delete(workerId);
  }

  subscribe(workerId: string, listener: (event: ProviderEvent) => void): () => void {
    const listeners = this.#require(workerId).listeners;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async #wait(session: Session): Promise<WorkerResult> {
    const startDeadline = Date.now() + this.#startGraceMs;
    const runDeadline = this.#runDeadlineMs > 0 ? Date.now() + this.#runDeadlineMs : Number.POSITIVE_INFINITY;
    let observedWorking = false;
    for (;;) {
      const observed = await this.#runtime.status(session.handle);
      if (Date.now() >= runDeadline) {
        // An idle-looking Pi retry is still consuming the worker's deadline.
        // Return a retryable timeout so the orchestrator can select a fallback.
        session.cancelRequested = true;
        await this.#runtime.cancel(session.handle).catch(() => {});
        session.status = "lost";
        this.#emit(session, { type: "lifecycle", status: "lost" });
        return {
          success: false,
          summary: `herdr worker exceeded its ${this.#runDeadlineMs}ms run deadline without reporting a terminal state`,
          sessionId: session.handle.agentName,
          failure: { kind: "timeout", retryable: true },
        };
      }
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
        const summary = redact((await this.#runtime.read(session.handle)).trim());
        const lastLine = lastAgentContentLine(summary);
        if (/\bRetrying \(\d+\/\d+\)/i.test(lastLine)) {
          await delay(Math.max(this.#pollIntervalMs, 250));
          continue;
        }
        if (/^Error:\s*Retry failed after \d+ attempts:/i.test(lastLine)) {
          session.status = "lost";
          this.#emit(session, { type: "lifecycle", status: "lost" });
          return {
            success: false,
            summary,
            sessionId: session.handle.agentName,
            failure: { kind: classifyFailure(lastLine), retryable: true },
          };
        }
        session.status = "completed";
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

const DEFAULT_RUN_DEADLINE_MS = 30 * 60 * 1000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

function redact(value: string): string {
  return redactProviderText(value);
}

function lastAgentContentLine(transcript: string): string {
  return transcript.split(/\r?\n/).map(line => line.trim()).reverse().find(line =>
    line.length > 0
    && !/^[─━-]{4,}/.test(line)
    && !/^\//.test(line)
    && !/^🎭/.test(line)
    && !/^[↑↓]/.test(line)
    && !/^\d+(?:\.\d+)?%\//.test(line)
  ) ?? "";
}
