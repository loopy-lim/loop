import { rmSync } from "node:fs";

import { assertWorktreeInsideProject, type HerdrCaller, type HerdrWorkerRuntime } from "@loop/herdr";
import type { SkippedArtifactOutput, TaskSpecInput } from "@loop/protocol";
import type { AgentProvider, ProviderRegistry, WorkerResult } from "@loop/providers";

import { CompletionVerifier, NodeCompletionRunner } from "./completion";
import type { OrchestrationControl } from "./control";

interface OrchestratorOptions {
  control: OrchestrationControl;
  providers: ProviderRegistry;
  maxWorkers: number;
  maxFrontierWorkers?: number;
  completionVerifier?: CompletionVerifier;
  herdr?: HerdrWorkerRuntime;
}

export interface CleanupRunRequest {
  databasePath: string;
  runId: string;
  keepRecent?: number;
  dryRun?: boolean;
  projectRoot?: string;
  worktrees?: string[];
  worktree?: string;
  caller?: HerdrCaller;
  isLeadPane?: boolean;
  isMerged?: boolean;
  isClean?: boolean;
  herdr?: HerdrWorkerRuntime;
}

export interface CleanupRunReport {
  removedArtifacts: string[];
  skippedArtifacts: SkippedArtifactOutput[];
  reasons: Record<string, string>;
}

export interface RunRequest {
  databasePath: string;
  runId: string;
  tasks: TaskSpecInput[];
  workingDirectory?: string;
  signal?: AbortSignal;
}

export interface RunSummary {
  status: "completed" | "cancelled" | "attention";
  tasks: number;
  escalations: Array<{ taskId: string; from: string; to: string }>;
  providersByTask: Record<string, string[]>;
  startedAt: Record<string, number>;
  finishedAt: Record<string, number>;
}

interface ActiveWorker {
  taskId: string;
  workerId: string;
  provider: AgentProvider;
  result: Promise<WorkerResult>;
}

export class Orchestrator {
  readonly #control: OrchestrationControl;
  readonly #providers: ProviderRegistry;
  readonly #maxWorkers: number;
  readonly #maxFrontierWorkers: number;
  readonly #completionVerifier: CompletionVerifier;
  readonly #herdr?: HerdrWorkerRuntime;

  constructor(options: OrchestratorOptions) {
    this.#control = options.control;
    this.#providers = options.providers;
    this.#maxWorkers = Math.max(1, options.maxWorkers);
    this.#maxFrontierWorkers = Math.max(1, options.maxFrontierWorkers ?? 1);
    this.#completionVerifier =
      options.completionVerifier ?? new CompletionVerifier(new NodeCompletionRunner());
    this.#herdr = options.herdr;
  }

  async cleanupRun(request: CleanupRunRequest): Promise<CleanupRunReport> {
    const dryRun = request.dryRun ?? true;
    const removedArtifacts: string[] = [];
    const skippedArtifacts: SkippedArtifactOutput[] = [];
    const reasons: Record<string, string> = {};

    // 1. Consult core policy and purge store records via the bridge
    const storeCleanup = await this.#control.cleanupRun({
      databasePath: request.databasePath,
      runId: request.runId,
      keepRecent: request.keepRecent ?? 0,
      dryRun,
    });
    removedArtifacts.push(...storeCleanup.removedArtifacts);
    skippedArtifacts.push(...storeCleanup.skippedArtifacts);

    // 2. Herdr surface teardown
    // ADR safety rule: never close caller-provided surfaces or the lead pane
    if (request.caller || request.isLeadPane) {
      const surfaceId = request.caller?.paneId ?? (request.caller?.workspaceId ? `caller:${request.caller.workspaceId}` : "lead-pane");
      const surfaceEval = await this.#control.evaluateSurfaceRemoval({
        surfaceId,
        isOwnedByLoop: false,
      });
      skippedArtifacts.push({
        artifact: surfaceId,
        reason: surfaceEval.reason ?? "caller-owned surface cannot be removed",
      });
    } else {
      const herdr = request.herdr ?? this.#herdr;
      if (herdr) {
        const surfaceId = `loop-${request.runId}`;
        const surfaceEval = await this.#control.evaluateSurfaceRemoval({
          surfaceId,
          isOwnedByLoop: true,
        });
        if (surfaceEval.allowed) {
          try {
            const closeResult = await herdr.closeWorkspace(request.runId);
            if (closeResult.closed) {
              removedArtifacts.push(surfaceId);
              if (closeResult.reason) {
                reasons[surfaceId] = closeResult.reason;
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            skippedArtifacts.push({
              artifact: surfaceId,
              reason: `failed to close surface: ${message}`,
            });
          }
        } else {
          skippedArtifacts.push({
            artifact: surfaceId,
            reason: surfaceEval.reason ?? "surface removal refused",
          });
        }
      }
    }

    // 3. Worktree directory removal
    // Only after assertWorktreeInsideProject validation and ADR safety rules
    const worktreeList = [
      ...(request.worktrees ?? []),
      ...(request.worktree ? [request.worktree] : []),
    ];
    const projectRoot = request.projectRoot ?? process.cwd();

    for (const worktreePath of worktreeList) {
      // Validation 1: assertWorktreeInsideProject invariant
      try {
        assertWorktreeInsideProject(projectRoot, worktreePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skippedArtifacts.push({
          artifact: worktreePath,
          reason: message,
        });
        continue;
      }

      // Validation 2: Consult core policy via the bridge (ADR safety rules: root match, clean, merged)
      const evaluation = await this.#control.evaluateWorktreeRemoval({
        projectRoot,
        worktreePath,
        isMerged: request.isMerged ?? true,
        isClean: request.isClean ?? true,
      });

      if (!evaluation.allowed) {
        skippedArtifacts.push({
          artifact: worktreePath,
          reason: evaluation.reason ?? "worktree removal refused",
        });
        continue;
      }

      // ADR safety rule: dry-run default for lossy records
      if (dryRun) {
        removedArtifacts.push(worktreePath);
        reasons[worktreePath] = "dry_run";
      } else {
        try {
          rmSync(worktreePath, { recursive: true, force: true });
          removedArtifacts.push(worktreePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          skippedArtifacts.push({
            artifact: worktreePath,
            reason: `failed to remove directory: ${message}`,
          });
        }
      }
    }

    return {
      removedArtifacts,
      skippedArtifacts,
      reasons,
    };
  }

  async run(request: RunRequest): Promise<RunSummary> {
    await this.#control.createRun(runInput(request));
    await this.#control.submitPlan({
      ...runInput(request),
      tasks: request.tasks,
    });
    const active = new Map<string, ActiveWorker>();
    const summary: RunSummary = {
      status: "completed",
      tasks: request.tasks.length,
      escalations: [],
      providersByTask: {},
      startedAt: {},
      finishedAt: {},
    };
    const missingRoute = await this.#missingRoute(request.tasks);
    if (missingRoute) {
      await this.#control.requestAttention({
        ...runInput(request),
        // Attention ids are globally unique in the store; scope by runId.
        attentionId: `provider-${request.runId}-${missingRoute.taskId}-${missingRoute.computeClass}`,
        kind: "failure",
        summary: `No available provider supports ${missingRoute.computeClass}`,
        taskId: missingRoute.taskId,
      });
      summary.status = "attention";
      return summary;
    }

    while (true) {
      if (request.signal?.aborted) return this.#cancel(request, active, summary);
      const snapshot = await this.#control.getSnapshot(runInput(request));
      if (snapshot.state === "completed") return summary;
      if (snapshot.state === "attention") {
        summary.status = "attention";
        return summary;
      }

      const claims = await this.#control.claimRunnableTasks({
        ...runInput(request),
        runningTaskIds: [...active.keys()],
        maxWorkers: this.#maxWorkers,
        maxFrontierWorkers: this.#maxFrontierWorkers,
      });
      let recordedStartFailure = false;
      for (const taskId of claims.taskIds) {
        const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
        const spec = request.tasks.find((candidate) => candidate.id === taskId);
        if (!task || !spec) throw new Error(`claimed task is absent from snapshot: ${taskId}`);
        const provider = await this.#providers.select(task.preferredCompute);
        const history = (summary.providersByTask[taskId] ??= []);
        const previous = history.at(-1);
        if (previous && previous !== provider.id) {
          summary.escalations.push({ taskId, from: previous, to: provider.id });
        }
        history.push(provider.id);
        let handle;
        try {
          handle = await provider.start({
            runId: request.runId,
            taskId,
            title: task.title,
            kind: task.kind,
            computeClass: task.preferredCompute,
            attempt: task.attempt,
            requirements: spec.requirements,
            workingDirectory: request.workingDirectory,
          });
        } catch (error) {
          // Worker ids are globally unique in the store, so the synthetic
          // start-failure id must carry the runId to survive re-runs of the
          // same task graph in a different run.
          const workerId = `start-failure-${request.runId}-${taskId}-${task.attempt}`;
          await this.#control.recordWorkerStarted({
            ...runInput(request),
            taskId,
            workerId,
          });
          await this.#control.recordWorkerResult({
            ...runInput(request),
            taskId,
            workerId,
            success: false,
            summary: `worker start failed: ${redactError(error)}`,
          });
          recordedStartFailure = true;
          continue;
        }
        summary.startedAt[taskId] = Date.now();
        await this.#control.recordWorkerStarted({
          ...runInput(request),
          taskId,
          workerId: handle.id,
        });
        active.set(taskId, {
          taskId,
          workerId: handle.id,
          provider,
          result: provider.result(handle.id),
        });
      }

      if (active.size === 0) {
        if (recordedStartFailure) continue;
        throw new Error("run is blocked with no active or runnable task");
      }
      const completed = await waitForOne(active, request.signal);
      if (!completed) return this.#cancel(request, active, summary);
      active.delete(completed.taskId);
      summary.finishedAt[completed.taskId] = Date.now();
      await this.#control.recordWorkerResult({
        ...runInput(request),
        taskId: completed.taskId,
        workerId: completed.workerId,
        success: completed.value.success,
        summary: completed.value.summary,
      });
      if (completed.value.success) {
        const spec = request.tasks.find((task) => task.id === completed.taskId)!;
        const evidence = await this.#completionVerifier.verify(
          spec.completionChecks,
          request.workingDirectory ?? process.cwd(),
        );
        const checks = evidence.map(({ id, passed }) => ({ id, passed }));
        const passed = checks.every((check) => check.passed);
        await this.#control.recordVerification({
          ...runInput(request),
          taskId: completed.taskId,
          passed,
          checks,
          reason: passed
            ? ""
            : `completion contract failed: ${checks
                .filter((check) => !check.passed)
                .map((check) => check.id)
                .join(", ")}`,
        });
      }
    }
  }

  async #missingRoute(
    tasks: TaskSpecInput[],
  ): Promise<{ taskId: string; computeClass: string } | undefined> {
    for (const task of tasks) {
      const requiredClasses = escalationRange(task.preferredCompute, task.maximumCompute)
        .slice(0, Math.max(1, task.maxAttempts));
      for (const computeClass of requiredClasses) {
        try {
          await this.#providers.select(computeClass);
        } catch {
          return { taskId: task.id, computeClass };
        }
      }
    }
    return undefined;
  }

  async #cancel(
    request: RunRequest,
    active: Map<string, ActiveWorker>,
    summary: RunSummary,
  ): Promise<RunSummary> {
    await Promise.all(
      [...active.values()].map((worker) => worker.provider.cancel(worker.workerId)),
    );
    await this.#control.cancelRun(runInput(request));
    summary.status = "cancelled";
    return summary;
  }
}

function redactError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:api[_-]?key|token|authorization|password)\s*[:=]\s*\S+/gi, "[credential]=[redacted]")
    .slice(0, 2_000);
}

const computeLadder = [
  "deterministic",
  "typed_decision",
  "tiny",
  "fast",
  "balanced",
  "strong",
  "frontier",
];

function escalationRange(preferred: string, maximum: string): string[] {
  const aliases: Record<string, string> = {
    d0: "deterministic",
    d1: "typed_decision",
    s1: "tiny",
    s2: "fast",
    s3: "balanced",
    s4: "strong",
    s5: "frontier",
  };
  const start = computeLadder.indexOf(aliases[preferred] ?? preferred);
  const end = computeLadder.indexOf(aliases[maximum] ?? maximum);
  if (start < 0 || end < start) return [preferred];
  return computeLadder.slice(start, end + 1);
}

function runInput(request: RunRequest) {
  return { databasePath: request.databasePath, runId: request.runId };
}

async function waitForOne(
  active: Map<string, ActiveWorker>,
  signal?: AbortSignal,
): Promise<(ActiveWorker & { value: WorkerResult }) | undefined> {
  const workers = [...active.values()].map(async (worker) => ({
    ...worker,
    value: await worker.result,
  }));
  if (!signal) return Promise.race(workers);
  if (signal.aborted) return undefined;
  let onAbort!: () => void;
  const aborted = new Promise<undefined>((resolve) => {
    onAbort = () => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([...workers, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
