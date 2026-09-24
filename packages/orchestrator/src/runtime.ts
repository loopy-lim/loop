import type { HerdrWorkerRuntime } from "@loop/herdr";
import type { SnapshotOutput, TaskSpecInput } from "@loop/protocol";
import type { ProviderRegistry } from "@loop/providers";

import type { CompletionVerifier } from "./completion";
import type { WorkerVisibility } from "./config";
import type { OrchestrationControl } from "./control";
import type { PersonaKindDefaults, PersonaRegistry } from "./persona";
import { Orchestrator, type CleanupRunReport, type CleanupRunRequest, type RunSummary } from "./coordinator";

export type ObservedWorkerState = "running" | "completed" | "lost" | "unknown";

export interface WorkerReconciler {
  observe(workerId: string): Promise<ObservedWorkerState>;
}

export interface LoopRuntimeOptions {
  control: OrchestrationControl;
  databasePath: string;
  providers: ProviderRegistry;
  maxWorkers: number;
  maxFrontierWorkers?: number;
  completionVerifier?: CompletionVerifier;
  herdr?: HerdrWorkerRuntime;
  personas?: PersonaRegistry;
  personaKindDefaults?: PersonaKindDefaults;
  workerVisibility?: WorkerVisibility;
}

export interface StartRunInput {
  runId: string;
  intent?: string;
  tasks: TaskSpecInput[];
  workingDirectory: string;
  signal?: AbortSignal;
}

export class LoopRuntime {
  readonly #control: OrchestrationControl;
  readonly #databasePath: string;
  readonly #orchestrator: Orchestrator;

  constructor(options: LoopRuntimeOptions) {
    this.#control = options.control;
    this.#databasePath = options.databasePath;
    this.#orchestrator = new Orchestrator({
      control: options.control,
      providers: options.providers,
      maxWorkers: options.maxWorkers,
      maxFrontierWorkers: options.maxFrontierWorkers,
      completionVerifier: options.completionVerifier,
      herdr: options.herdr,
      personas: options.personas,
      personaKindDefaults: options.personaKindDefaults,
      workerVisibility: options.workerVisibility,
    });
  }

  cleanupRun(
    request: Omit<CleanupRunRequest, "databasePath"> & { databasePath?: string },
  ): Promise<CleanupRunReport> {
    return this.#orchestrator.cleanupRun({
      databasePath: request.databasePath ?? this.#databasePath,
      ...request,
    });
  }

  start(input: StartRunInput): Promise<RunSummary> {
    return this.#orchestrator.run({
      databasePath: this.#databasePath,
      runId: input.runId,
      tasks: input.tasks,
      intent: input.intent,
      workingDirectory: input.workingDirectory,
      signal: input.signal,
    });
  }

  prepare(input: StartRunInput): Promise<void> {
    return this.#orchestrator.prepare({ ...input, databasePath: this.#databasePath });
  }

  execute(runId: string, signal?: AbortSignal): Promise<RunSummary> {
    return this.#orchestrator.execute({ databasePath: this.#databasePath, runId, signal });
  }

  pause(runId: string): Promise<unknown> {
    return this.#control.pauseRun({ databasePath: this.#databasePath, runId });
  }

  snapshot(runId: string): Promise<SnapshotOutput> {
    return this.#control.getSnapshot({ databasePath: this.#databasePath, runId });
  }

  async cancel(runId: string): Promise<SnapshotOutput> {
    await this.#control.cancelRun({ databasePath: this.#databasePath, runId });
    return this.snapshot(runId);
  }

  resume(runId: string): Promise<RunSummary> {
    return this.#orchestrator.resume({ databasePath: this.#databasePath, runId });
  }

  async recover(runId: string, reconciler: WorkerReconciler): Promise<SnapshotOutput> {
    const snapshot = await this.snapshot(runId);
    for (const worker of snapshot.activeWorkers) {
      const observed = await reconciler.observe(worker.id);
      if (observed === "running") continue;
      await this.#control.requestAttention({
        databasePath: this.#databasePath,
        runId,
        attentionId: `recovery-${worker.id}`,
        kind: "failure",
        summary: `Worker ${worker.id} requires reconciliation after restart (${observed})`,
        taskId: worker.taskId,
      });
    }
    return this.snapshot(runId);
  }

  subscribe(runId: string, listener: (snapshot: SnapshotOutput) => void): () => void {
    let stopped = false;
    let busy = false;
    let sequence = -1;
    const poll = async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        const snapshot = await this.snapshot(runId);
        if (!stopped && Number(snapshot.lastSequence) !== sequence) {
          sequence = Number(snapshot.lastSequence);
          listener(snapshot);
        }
      } catch { /* The run may not exist until prepare commits. Retry on the next poll. */ }
      finally { busy = false; }
    };
    const timer = setInterval(() => { void poll(); }, 100);
    timer.unref();
    void poll();
    return () => { stopped = true; clearInterval(timer); };
  }
}
