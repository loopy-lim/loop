import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { HerdrWorkerRuntime } from "@loop/herdr";
import type { TaskSpecInput } from "@loop/protocol";
import type { AgentProvider, ProviderRegistry } from "@loop/providers";
import { CompletionVerifier, NodeCompletionRunner } from "./completion";
import { cleanupRun, type CleanupRunReport, type CleanupRunRequest } from "./cleanup";
import type { WorkerVisibility } from "./config";
import type { OrchestrationControl } from "./control";
import type { PersonaKindDefaults, PersonaRegistry } from "./persona";
import { executeTask, type TaskExecution } from "./task-execution";
import { redact } from "./redact";

export type { CleanupRunReport, CleanupRunRequest } from "./cleanup";
interface OrchestratorOptions {
  control: OrchestrationControl;
  providers: ProviderRegistry;
  maxWorkers: number;
  maxFrontierWorkers?: number;
  completionVerifier?: CompletionVerifier;
  herdr?: HerdrWorkerRuntime;
  personas?: PersonaRegistry;
  personaKindDefaults?: PersonaKindDefaults;
  workerVisibility?: WorkerVisibility;
}
export interface RunRequest {
  databasePath: string;
  runId: string;
  tasks: TaskSpecInput[];
  intent?: string;
  workingDirectory?: string;
  signal?: AbortSignal;
}
export interface ExistingRunRequest { databasePath: string; runId: string; signal?: AbortSignal }
export interface RunSummary {
  status: "completed" | "failed" | "cancelled" | "attention" | "paused" | "running";
  tasks: number;
  escalations: Array<{ taskId: string; from: string; to: string }>;
  providersByTask: Record<string, string[]>;
  startedAt: Record<string, number>;
  finishedAt: Record<string, number>;
}

export class Orchestrator {
  readonly #control: OrchestrationControl;
  readonly #providers: ProviderRegistry;
  readonly #maxWorkers: number;
  readonly #maxFrontierWorkers: number;
  readonly #completionVerifier: CompletionVerifier;
  readonly #herdr?: HerdrWorkerRuntime;
  readonly #personas: PersonaRegistry;
  readonly #personaKindDefaults?: PersonaKindDefaults;
  readonly #workerVisibility: WorkerVisibility;
  constructor(options: OrchestratorOptions) {
    this.#control = options.control;
    this.#providers = options.providers;
    this.#maxWorkers = Math.max(1, options.maxWorkers);
    this.#maxFrontierWorkers = Math.max(1, options.maxFrontierWorkers ?? 1);
    this.#completionVerifier = options.completionVerifier ?? new CompletionVerifier(new NodeCompletionRunner());
    this.#herdr = options.herdr;
    this.#personas = options.personas ?? {};
    this.#personaKindDefaults = options.personaKindDefaults;
    this.#workerVisibility = options.workerVisibility ?? "off";
  }
  cleanupRun(request: CleanupRunRequest): Promise<CleanupRunReport> {
    return cleanupRun(this.#control, { ...request, herdr: request.herdr ?? this.#herdr });
  }
  async prepare(request: RunRequest): Promise<void> {
    const input = runInput(request);
    await this.#control.prepareRun({ ...input, intent: redact(request.intent ?? ""), workingDirectory: realpathSync(resolve(request.workingDirectory ?? process.cwd())), tasks: request.tasks });
  }
  async run(request: RunRequest): Promise<RunSummary> {
    await this.prepare(request);
    return this.execute(request);
  }
  async resume(request: ExistingRunRequest): Promise<RunSummary> {
    await this.#control.resumeRun(runInput(request));
    return this.execute(request);
  }
  async execute(request: ExistingRunRequest): Promise<RunSummary> {
    const input = runInput(request);
    const plan = await this.#control.getRunPlan(input);
    const summary: RunSummary = { status: "running", tasks: plan.tasks.length, escalations: [], providersByTask: {}, startedAt: {}, finishedAt: {} };
    const owner = `${process.pid}:${randomUUID()}`;
    const lease = () => this.#control.claimExecution({ ...input, owner, nowMs: Date.now(), ttlMs: 5000 });
    if (!(await lease()).accepted) {
      const initial = await this.#control.getSnapshot(input);
      const expires = Number(initial.executionExpiresAt ?? Date.now());
      // A lease can outlive a crashed process. Wait for expiry unless renewal
      // proves that another owner is still making progress.
      while (Date.now() <= expires + 250) {
        await delay(100);
        const current = await this.#control.getSnapshot(input);
        if (["completed", "failed", "cancelled", "paused", "attention"].includes(current.state)) {
          summary.status = current.state as RunSummary["status"];
          return summary;
        }
        if (Number(current.executionExpiresAt ?? 0) > expires) return summary;
        if ((await lease()).accepted) break;
      }
      if (!(await lease()).accepted) return summary;
    }
    const executionInput = { ...input, executionOwner: owner };
    // Options that never vary across scheduled tasks, assembled once.
    const taskExecutionOptions = {
      input: executionInput,
      control: this.#control,
      verifier: this.#completionVerifier,
      personas: this.#personas,
      personaKindDefaults: this.#personaKindDefaults,
      recordRawActivity: this.#workerVisibility === "off",
    };
    const active = new Map<string, TaskExecution>();
    let leaseLost = false;
    let heartbeatRunning = false;
    let heartbeatPending: Promise<void> = Promise.resolve();
    const heartbeat = setInterval(() => {
      if (!heartbeatRunning) heartbeatPending = renew();
    }, 1000);
    const renew = async () => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      try { if (!(await this.#control.renewExecution({ ...input, owner, nowMs: Date.now(), ttlMs: 5000 })).accepted) leaseLost = true; }
      catch { leaseLost = true; }
      finally { heartbeatRunning = false; }
    };
    heartbeat.unref();
    try {
      // A fresh process never guesses that old OS work has disappeared.
      const previous = await this.#control.getSnapshot(input);
      if (previous.activeWorkers.length > 0 || previous.tasks.some(task => task.state === "verifying")) {
        for (const task of previous.tasks.filter(task => task.state === "verifying")) {
          await this.#control.requestAttention({ ...executionInput, attentionId: `recovery-${request.runId}-${task.id}-verification`, kind: "failure", taskId: task.id, summary: `Verification was interrupted. Confirm its process stopped, then run: loop reconcile ${request.runId} ${task.id} stopped; loop resume ${request.runId}.` });
        }
        for (const worker of previous.activeWorkers) {
          const id = `recovery-${request.runId}-${worker.id}`;
          if (!previous.openAttentionIds.includes(id)) await this.#control.requestAttention({ ...executionInput, attentionId: id, kind: "failure", taskId: worker.taskId, summary: `Execution owner restarted. Confirm worker ${worker.id} has stopped, then run: loop reconcile ${request.runId} ${worker.taskId} stopped; loop resume ${request.runId}.` });
        }
        summary.status = "attention";
        return summary;
      }
      while (true) {
        if (leaseLost) throw new Error("execution ownership was lost; stopped local workers");
        if (request.signal?.aborted) await this.#control.cancelRun(input);
        let snapshot = await this.#control.getSnapshot(input);
        if (snapshot.state === "cancelling" || snapshot.state === "cancelled") {
          for (const task of active.values()) task.abort();
          await Promise.all([...active.values()].map(task => task.done));
          for (const task of active.values()) if (task.error) throw task.error;
          active.clear();
          await this.#control.cancelRun(input);
          summary.status = (await this.#control.getSnapshot(input)).state === "cancelled" ? "cancelled" : "attention";
          return summary;
        }
        for (const [id, task] of active) {
          if (!task.settled) continue;
          active.delete(id);
          if (task.error) throw task.error;
          summary.finishedAt[id] = Date.now();
        }
        if (snapshot.state === "completed" || snapshot.state === "failed") {
          summary.status = snapshot.state;
          return summary;
        }
        if (active.size === 0 && ["attention", "pausing", "paused"].includes(snapshot.state)) {
          if (snapshot.state === "pausing") await this.#control.confirmPaused(input);
          summary.status = snapshot.state === "attention" ? "attention" : "paused";
          return summary;
        }
        const claims = await this.#control.claimRunnableTasks({ ...executionInput, runningTaskIds: [...active.keys()], maxWorkers: this.#maxWorkers, maxFrontierWorkers: this.#maxFrontierWorkers });
        for (const taskId of claims.taskIds) {
          // Controls can arrive while earlier workers are being prepared.
          snapshot = await this.#control.getSnapshot(input);
          if (snapshot.state !== "active") break;
          const context = await this.#control.getTaskContext({ ...input, taskId });
          let provider: AgentProvider | undefined;
          try {
            const selection = this.#providers.select(context.task.preferredCompute);
            provider = await selectWhileActive(selection, async () => {
              if (request.signal?.aborted) await this.#control.cancelRun(input);
              return !leaseLost && (await this.#control.getSnapshot(input)).state === "active";
            });
            if (!provider) break;
          }
          catch (error) {
            await this.#control.requestAttention({ ...executionInput, attentionId: `provider-${request.runId}-${taskId}-${context.attempt}`, kind: "failure", taskId, summary: redact(error) });
            break;
          }
          const history = summary.providersByTask[taskId] ??= [];
          const previousProvider = history.at(-1);
          if (previousProvider && previousProvider !== provider.id) summary.escalations.push({ taskId, from: previousProvider, to: provider.id });
          history.push(provider.id);
          const workerId = `${request.runId}:${taskId}:${context.attempt}:${randomUUID()}`;
          // Reserve durable ownership BEFORE the OS side effect.
          try { await this.#control.recordWorkerStarted({ ...executionInput, taskId, workerId }); }
          catch (error) {
            if ((await this.#control.getSnapshot(input)).state !== "active") break;
            throw error;
          }
          summary.startedAt[taskId] = Date.now();
          active.set(taskId, executeTask({
            ...taskExecutionOptions, context, workerId, provider,
            selectFallback: async excluded => {
              const next = await selectWhileActive(this.#providers.select(context.task.preferredCompute, excluded), async () => {
                if (request.signal?.aborted) await this.#control.cancelRun(input);
                // Pause drains this already-reserved task; cancellation does not.
                return !leaseLost && ["active", "pausing"].includes((await this.#control.getSnapshot(input)).state);
              });
              if (next) {
                const previous = history.at(-1)!;
                summary.escalations.push({ taskId, from: previous, to: next.id });
                history.push(next.id);
              }
              return next;
            },
          }));
        }
        if (leaseLost) throw new Error("execution ownership was lost");
        if (active.size === 0) {
          snapshot = await this.#control.getSnapshot(input);
          if (snapshot.state !== "active") continue;
          await this.#control.requestAttention({ ...executionInput, attentionId: `blocked-${request.runId}-${snapshot.lastSequence}`, kind: "failure", taskId: null, summary: "No runnable task remains. Inspect dependencies and reconcile interrupted verification before retrying." });
          continue;
        }
        // Poll the durable control channel even when no worker has finished.
        await Promise.race([delay(50), ...[...active.values()].map(task => task.done)]);
      }
    } catch (error) {
      for (const task of active.values()) task.abort();
      await Promise.allSettled([...active.values()].map(task => task.done));
      const snapshot = await this.#control.getSnapshot(input);
      if (!leaseLost && snapshot.executionOwner === owner && Number(snapshot.executionExpiresAt ?? 0) > Date.now() && !["completed", "failed", "cancelled"].includes(snapshot.state)) {
        await this.#control.requestAttention({ ...executionInput, attentionId: `dispatcher-${owner}`, kind: "failure", taskId: null, summary: redact(error) });
      }
      summary.status = snapshot.state === "failed" ? "failed" : "attention";
      return summary;
    } finally {
      clearInterval(heartbeat);
      await heartbeatPending;
      await this.#control.releaseExecution({ ...input, owner });
    }
  }
}
function runInput(request: ExistingRunRequest) { return { databasePath: request.databasePath, runId: request.runId }; }
function delay(milliseconds: number) { return new Promise<void>(resolve => setTimeout(resolve, milliseconds)); }

async function selectWhileActive(selection: Promise<AgentProvider>, stillActive: () => Promise<boolean>): Promise<AgentProvider | undefined> {
  const pending = selection.then(provider => ({ provider }), error => ({ error }));
  const deadline = Date.now() + 30000;
  while (await stillActive()) {
    const result = await Promise.race([pending, delay(50).then(() => undefined)]);
    if (result) { if ("error" in result) throw result.error; return result.provider; }
    if (Date.now() > deadline) throw new Error("Provider capability lookup timed out; retry after checking the provider.");
  }
  return undefined;
}
