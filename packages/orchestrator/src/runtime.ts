import type { HerdrWorkerRuntime } from "@loop/herdr";
import type { SnapshotOutput, TaskSpecInput } from "@loop/protocol";
import { onRustraEvent, type SubscribeFn } from "@loop/protocol";
import type { ProviderRegistry } from "@loop/providers";

import type { CompletionVerifier } from "./completion";
import type { OrchestrationControl } from "./control";
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
}

export interface StartRunInput {
  runId: string;
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
      workingDirectory: input.workingDirectory,
      signal: input.signal,
    });
  }

  snapshot(runId: string): Promise<SnapshotOutput> {
    return this.#control.getSnapshot({ databasePath: this.#databasePath, runId });
  }

  async cancel(runId: string): Promise<SnapshotOutput> {
    await this.#control.cancelRun({ databasePath: this.#databasePath, runId });
    return this.snapshot(runId);
  }

  async resume(runId: string): Promise<SnapshotOutput> {
    await this.#control.resumeRun({ databasePath: this.#databasePath, runId });
    return this.snapshot(runId);
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

  subscribe(runId: string, listener: (snapshot: SnapshotOutput) => void): (() => void) | Promise<() => void> {
    return onRustraEvent(
      this.#control.subscribeEvent as SubscribeFn,
      "loop.run_changed",
      (event) => {
        if (event.runId !== runId) return;
        void this.snapshot(runId).then(listener);
      },
    );
  }
}
