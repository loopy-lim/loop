import { NodeProcessRunner, type ProcessRunner } from "../process";
import type {
  AgentProvider,
  ProviderCapabilities,
  ProviderEvent,
  ResumeWorkerInput,
  StartWorkerInput,
  WorkerHandle,
  WorkerResult,
  WorkerStatus,
} from "../types";
import { buildWorkerPrompt } from "../prompt";
import { AgyStreamDriver } from "./driver";

interface AgyPersistentProviderOptions {
  id: string;
  cwd: string;
  command?: string;
  model?: string;
  computeClasses?: string[];
  turnTimeoutMs?: number;
  driverFactory?: (options: { cwd: string; model?: string; conversationId?: string }) => AgyStreamDriver;
  available?: boolean;
}

interface Session {
  driver: AgyStreamDriver;
  workerId: string;
  status: WorkerStatus;
  result: Promise<WorkerResult>;
}

/**
 * Antigravity worker backed by one persistent stream-json agy process per
 * session (in-house driver, see docs/research/2026-09-21-pi-antigravity-package-study.md).
 * The conversation survives across turns via agy's native conversation id and
 * `resume()` reattaches with `--conversation`. No key ever passes through here:
 * agy authenticates from its own native store.
 */
export class AgyPersistentProvider implements AgentProvider {
  readonly id: string;
  readonly #cwd: string;
  readonly #command: string;
  readonly #model?: string;
  readonly #computeClasses: string[];
  readonly #turnTimeoutMs: number;
  readonly #driverFactory: NonNullable<AgyPersistentProviderOptions["driverFactory"]>;
  readonly #available: boolean;
  readonly #sessions = new Map<string, Session>();

  constructor(options: AgyPersistentProviderOptions) {
    this.id = options.id ?? "antigravity-persistent";
    this.#cwd = options.cwd;
    this.#command = options.command ?? "agy";
    this.#model = options.model;
    this.#computeClasses = options.computeClasses ?? ["balanced", "strong", "frontier"];
    this.#turnTimeoutMs = options.turnTimeoutMs ?? 600_000;
    this.#available = options.available ?? true;
    this.#driverFactory =
      options.driverFactory ??
      ((factoryOptions) =>
        AgyStreamDriver.start({
          cwd: factoryOptions.cwd,
          binary: this.#command,
          model: this.#model,
          conversationId: factoryOptions.conversationId,
          turnTimeoutMs: this.#turnTimeoutMs,
        }));
  }

  async capabilities(): Promise<ProviderCapabilities> {
    let available = this.#available;
    if (available) {
      const probe = await new NodeProcessRunner().probe(this.#command, ["--version"]);
      available = probe.exitCode === 0;
    }
    return {
      available,
      models: this.#model ? [this.#model] : undefined,
      computeClasses: this.#computeClasses,
      tools: true,
      vision: true,
      structuredOutput: false,
      resumableSession: true,
    };
  }

  async start(input: StartWorkerInput): Promise<WorkerHandle> {
    // Worker ids are globally unique in the store, so retries of the same
    // task within one run need the attempt to avoid colliding.
    const workerId = `${input.runId}:${input.taskId}:${input.attempt}`;
    const driver = this.#driverFactory({ cwd: this.#cwd, model: this.#model });
    const session: Session = {
      driver,
      workerId,
      status: "running",
      result: this.#runTurn(driver, input),
    };
    this.#sessions.set(workerId, session);
    return { id: workerId, sessionId: driver.conversationId };
  }

  async resume(sessionId: string, input: ResumeWorkerInput): Promise<WorkerHandle> {
    const workerId = `${input.runId}:${input.taskId}:${input.attempt}`;
    const driver = this.#driverFactory({ cwd: this.#cwd, model: this.#model, conversationId: sessionId });
    const session: Session = {
      driver,
      workerId,
      status: "running",
      result: this.#runTurn(driver, input),
    };
    this.#sessions.set(workerId, session);
    return { id: workerId, sessionId };
  }

  #runTurn(driver: AgyStreamDriver, input: StartWorkerInput): Promise<WorkerResult> {
    const prompt = buildWorkerPrompt(input);
    return driver
      .turn(prompt)
      .then((turn): WorkerResult => ({
        success: turn.ok,
        summary: turn.ok ? turn.response : (turn.error ?? "agy turn failed."),
        sessionId: turn.conversationId,
        ...(turn.ok
          ? {}
          : {
              failure: {
                kind: turn.failure?.kind ?? "incomplete_output",
                retryable: turn.failure?.retryable ?? true,
              },
            }),
      }))
      .catch((error: unknown): WorkerResult => ({
        success: false,
        summary: error instanceof Error ? error.message : String(error),
        sessionId: driver.conversationId,
        failure: { kind: "incomplete_output", retryable: true },
      }));
  }

  #session(workerId: string): Session | undefined {
    return this.#sessions.get(workerId);
  }

  async cancel(workerId: string): Promise<void> {
    const session = this.#session(workerId);
    if (!session) throw new Error(`unknown worker: ${workerId}`);
    await session.driver.cancel();
    await session.result;
    session.status = "cancelled";
  }

  async status(workerId: string): Promise<WorkerStatus> {
    const session = this.#session(workerId);
    if (!session) throw new Error(`unknown worker: ${workerId}`);
    return session.status;
  }

  async result(workerId: string): Promise<WorkerResult> {
    const session = this.#session(workerId);
    if (!session) {
      return {
        success: false,
        summary: `unknown worker: ${workerId}`,
        failure: { kind: "unavailable", retryable: false },
      };
    }
    const result = await session.result;
    if (session.status !== "cancelled") {
      session.status = result.success ? "completed" : "failed";
    }
    return result;
  }

  async release(workerId: string): Promise<void> {
    const session = this.#session(workerId);
    if (!session) throw new Error(`unknown worker: ${workerId}`);
    await session.result;
    await session.driver.dispose();
    this.#sessions.delete(workerId);
  }

  subscribe(workerId: string, listener: (event: ProviderEvent) => void): () => void {
    // Events are folded into the terminal result for now; the driver's
    // activity stream can be surfaced here when a consumer needs progress.
    void workerId;
    void listener;
    return () => undefined;
  }

  /** Gracefully end every live agy process owned by this provider. */
  async disposeAll(): Promise<void> {
    await Promise.all([...this.#sessions.values()].map((session) => session.driver.dispose()));
    this.#sessions.clear();
  }
}
