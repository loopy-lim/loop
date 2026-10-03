import { randomUUID } from "node:crypto";

import type { ComputeClass } from "@loop/protocol";

import { noSandboxDeclaration } from "./sandbox";
import type {
  AgentProvider,
  ProviderCapabilities,
  StartWorkerInput,
  WorkerHandle,
  WorkerResult,
  WorkerState,
} from "./types";

interface FakeOptions {
  delayMs?: number;
  failures?: Record<string, number>;
  alwaysFail?: boolean;
}

interface Session {
  status: WorkerState;
  promise: Promise<WorkerResult>;
  resolve: (result: WorkerResult) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class FakeProvider implements AgentProvider {
  readonly #sessions = new Map<string, Session>();
  readonly #failures: Record<string, number>;
  readonly #delayMs: number;
  readonly #alwaysFail: boolean;
  active = 0;
  maxConcurrent = 0;
  cancelled = 0;

  constructor(
    readonly id: string,
    readonly computeClasses: ComputeClass[],
    options: FakeOptions = {},
  ) {
    this.#delayMs = options.delayMs ?? 0;
    this.#failures = { ...options.failures };
    this.#alwaysFail = options.alwaysFail === true;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      available: true,
      computeClasses: this.computeClasses,
      tools: true,
      vision: false,
      structuredOutput: true,
      resumableSession: true,
    };
  }

  /** G4a: the fake executes nothing, so there is no isolation to declare. */
  sandboxDeclaration() {
    return noSandboxDeclaration(
      this.id,
      "fake provider executes no worker process; nothing to isolate",
    );
  }

  async start(input: StartWorkerInput): Promise<WorkerHandle> {
    const id = `${this.id}-${randomUUID()}`;
    let resolve!: (result: WorkerResult) => void;
    const promise = new Promise<WorkerResult>((done) => {
      resolve = done;
    });
    const session: Session = { status: "running", promise, resolve };
    this.#sessions.set(id, session);
    this.active += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
    session.timer = setTimeout(() => {
      const remaining = this.#failures[input.taskId] ?? 0;
      if (remaining > 0) this.#failures[input.taskId] = remaining - 1;
      const failed = this.#alwaysFail || remaining > 0;
      session.status = failed ? "lost" : "completed";
      this.active -= 1;
      resolve({
        success: !failed,
        summary: failed ? "scripted failure" : `${input.taskId} complete`,
        ...(failed ? { failure: { kind: "process_error" as const, retryable: true } } : {}),
      });
    }, this.#delayMs);
    return { id, sessionId: id };
  }

  async cancel(workerId: string): Promise<void> {
    const session = this.require(workerId);
    if (session.timer) clearTimeout(session.timer);
    if (session.status === "running") this.active -= 1;
    session.status = "cancelled";
    this.cancelled += 1;
    session.resolve({
      success: false,
      summary: "cancelled",
      failure: { kind: "cancelled", retryable: false },
    });
  }

  async status(workerId: string): Promise<WorkerState> {
    return this.require(workerId).status;
  }

  async result(workerId: string): Promise<WorkerResult> {
    return this.require(workerId).promise;
  }

  protected require(workerId: string): Session {
    const session = this.#sessions.get(workerId);
    if (!session) throw new Error(`unknown worker ${workerId}`);
    return session;
  }
}

export class FailingProvider extends FakeProvider {
  constructor(id = "failing", computeClasses: ComputeClass[] = ["fast"]) {
    super(id, computeClasses, { alwaysFail: true });
  }
}

export class SlowProvider implements AgentProvider {
  readonly #sessions = new Map<string, Session>();
  cancelled = 0;

  constructor(
    readonly id: string,
    readonly computeClasses: ComputeClass[],
  ) {}

  async capabilities(): Promise<ProviderCapabilities> {
    return {
      available: true,
      computeClasses: this.computeClasses,
      tools: true,
      vision: false,
      structuredOutput: true,
      resumableSession: false,
    };
  }

  async start(): Promise<WorkerHandle> {
    const id = `${this.id}-${randomUUID()}`;
    let resolve!: (result: WorkerResult) => void;
    const promise = new Promise<WorkerResult>((done) => {
      resolve = done;
    });
    this.#sessions.set(id, { status: "running", promise, resolve });
    return { id };
  }

  async cancel(workerId: string): Promise<void> {
    const session = this.#sessions.get(workerId);
    if (!session) return;
    session.status = "cancelled";
    this.cancelled += 1;
    session.resolve({
      success: false,
      summary: "cancelled",
      failure: { kind: "cancelled", retryable: false },
    });
  }

  async status(workerId: string): Promise<WorkerState> {
    return this.#sessions.get(workerId)?.status ?? "lost";
  }

  async result(workerId: string): Promise<WorkerResult> {
    const session = this.#sessions.get(workerId);
    if (!session) throw new Error(`unknown worker ${workerId}`);
    return session.promise;
  }
}
