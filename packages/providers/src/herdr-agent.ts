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
  WorkerStatus,
} from "./types";

interface HerdrAgentProviderOptions {
  id: string;
  runtime: HerdrWorkerRuntime;
  kind: Extract<HerdrExecution, { type: "agent" }>["kind"];
  projectRoot: string;
  computeClasses: string[];
  args?: string[];
  available?: boolean;
  pollIntervalMs?: number;
}

interface Session {
  handle: HerdrWorkerHandle;
  status: WorkerStatus;
  result: Promise<WorkerResult>;
  listeners: Set<(event: ProviderEvent) => void>;
}

export class HerdrAgentProvider implements AgentProvider {
  readonly id: string;
  readonly #runtime: HerdrWorkerRuntime;
  readonly #kind: HerdrAgentProviderOptions["kind"];
  readonly #projectRoot: string;
  readonly #computeClasses: string[];
  readonly #args: string[];
  readonly #available: boolean;
  readonly #pollIntervalMs: number;
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
    const handle = await this.#runtime.start({
      projectRoot: this.#projectRoot,
      runId: input.runId,
      taskId: input.taskId,
      workerName: `${input.runId}-${input.taskId}-${input.attempt}`,
      worktree: input.workingDirectory ?? this.#projectRoot,
      execution: { type: "agent", kind: this.#kind, args: this.#args },
      prompt: workerPrompt(input),
      waitForPrompt: true,
    });
    const listeners = new Set<(event: ProviderEvent) => void>();
    const session: Session = {
      handle,
      status: "running",
      result: Promise.resolve({
        success: false,
        summary: "not started",
        failure: { kind: "process_error", retryable: true },
      }),
      listeners,
    };
    session.result = this.#wait(session).catch((error) => {
      session.status = "failed";
      this.#emit(session, { type: "lifecycle", status: "failed" });
      return {
        success: false,
        summary: redact(error instanceof Error ? error.message : String(error)),
        sessionId: session.handle.agentName,
        failure: { kind: "process_error" as const, retryable: true },
      };
    });
    this.#sessions.set(handle.workerId, session);
    this.#emit(session, { type: "lifecycle", status: "running" });
    return { id: handle.workerId, sessionId: handle.agentName };
  }

  async cancel(workerId: string): Promise<void> {
    const session = this.#require(workerId);
    await this.#runtime.cancel(session.handle);
    session.status = "cancelled";
    this.#emit(session, { type: "lifecycle", status: "cancelled" });
  }

  async status(workerId: string): Promise<WorkerStatus> {
    const session = this.#require(workerId);
    if (session.status !== "running") return session.status;
    const observed = await this.#runtime.status(session.handle);
    if (observed === "completed") session.status = "completed";
    else if (observed === "failed" || observed === "blocked" || observed === "unknown") {
      session.status = "failed";
    }
    return session.status;
  }

  result(workerId: string): Promise<WorkerResult> {
    return this.#require(workerId).result;
  }

  subscribe(workerId: string, listener: (event: ProviderEvent) => void): () => void {
    const listeners = this.#require(workerId).listeners;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async #wait(session: Session): Promise<WorkerResult> {
    // The prompt turn can reject even while the agent keeps working (e.g. the
    // herdr CLI hiccups mid-wait); fall back to polling the agent state
    // instead of failing the worker.
    await this.#runtime.wait(session.handle).catch(() => undefined);
    while (session.status === "running") {
      const observed = await this.#runtime.status(session.handle);
      if (observed === "running") {
        await delay(this.#pollIntervalMs);
        continue;
      }
      if (observed === "completed") {
        session.status = "completed";
        const summary = (await this.#runtime.read(session.handle)).trim();
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
      session.status = observed === "blocked" ? "failed" : "failed";
      const summary = (await this.#runtime.read(session.handle)).trim()
        || `Herdr worker became ${observed}`;
      this.#emit(session, { type: "lifecycle", status: "failed" });
      return {
        success: false,
        summary,
        sessionId: session.handle.agentName,
        failure: { kind: "process_error", retryable: observed !== "blocked" },
      };
    }
    return {
      success: false,
      summary: "cancelled",
      sessionId: session.handle.agentName,
      failure: { kind: "cancelled", retryable: false },
    };
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

function workerPrompt(input: StartWorkerInput): string {
  return [
    input.title,
    `kind=${input.kind}`,
    `attempt=${input.attempt}`,
    ...input.requirements,
  ].join("\n");
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function redact(value: string): string {
  return value
    .replace(/(?:api[_-]?key|token|authorization|password)\s*[:=]\s*\S+/gi, "[credential]=[redacted]")
    .slice(0, 4_000);
}
