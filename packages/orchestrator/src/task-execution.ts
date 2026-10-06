import type { GoalCriterionInput, TaskContextOutput } from "@loop/protocol";
import type {
  AgentProvider,
  RouteSelection,
  StartWorkerInput,
  WorkerHandle,
  WorkerResult,
} from "@loop/providers";
import type { ComputeClass } from "@loop/protocol";
import type { CompletionVerifier } from "./completion";
import type { OrchestrationControl } from "./control";
import {
  criteriaCheckIdsForTask,
  receiptsBlockCriteria,
  rerunCriteriaChecksOnStableSource,
} from "./criteria-self-heal";
import { resolvePersona, type PersonaKindDefaults, type PersonaRegistry } from "./persona";
import { redact } from "./redact";
import { storeCheckOutput } from "./evidence-artifact";
import { captureSourceState, changedSourcePaths, scopedFingerprint } from "./source-state";
import {
  summarizeTaskContext,
  DEFAULT_CONTEXT_LIFECYCLE_POLICY,
  type ContextLifecyclePolicy,
} from "./context-lifecycle";
import { withCodeMapEntry, type CodeMapProvider } from "./code-map";
import { DEFAULT_STALL_TIMEOUT_MS } from "./config";

export interface TaskExecution {
  done: Promise<void>;
  settled: boolean;
  error?: unknown;
  abort(): void;
  /**
   * Live steer channel bound to the CURRENT provider handle (set once the
   * handle exists, reassigned across quota fallbacks, cleared when no handle
   * is live). The coordinator's mailbox delegates here, so steering follows
   * the provider's own handle id rather than the durable worker id.
   */
  steer?: (message: string) => Promise<void>;
}
// PersonaWorkerStartInput 임시 구조 타입은 제거됨(2026-09): StartWorkerInput.personaInstructions 복원으로 상위 타입을 직접 사용한다.
interface Options {
  input: { databasePath: string; runId: string; executionOwner: string };
  context: TaskContextOutput;
  workerId: string;
  provider: AgentProvider;
  computeClass?: ComputeClass;
  /** Runs only after the failed handle is released; reservation stays owned. */
  selectFallback?: (
    excludedProviderIds: ReadonlySet<string>,
  ) => Promise<RouteSelection | undefined>;
  control: OrchestrationControl;
  verifier: CompletionVerifier;
  personas?: PersonaRegistry;
  /** Merged kind-default overrides (config over the compile-time floor); omitted = floor. */
  personaKindDefaults?: PersonaKindDefaults;
  /**
   * When worker visibility renders lines into the store via the mirror sink,
   * the raw 1 Hz recorder is suppressed so the history is not double-fed
   * (docs/decisions/2026-09-23-worker-visibility.md D1/D3).
   */
  recordRawActivity?: boolean;
  /**
   * G1 context-lifecycle thresholds; omitted = the compile-time defaults.
   * `advisoryByteBudget: 0` disables automatic summarization.
   */
  contextPolicy?: ContextLifecyclePolicy;
  /**
   * G2 code map injection; omitted (or returning undefined) injects nothing.
   * The map rides the start context as one bounded advisory entry.
   */
  codeMap?: CodeMapProvider;
  /**
   * §D run resilience: declared goal criteria for the run. When this task's
   * passing evidence would keep its criteria pending (unstable source,
   * out-of-scope observation), the verification flow re-runs the declared
   * checks once on stable source before recording verification.
   */
  goalCriteria?: GoalCriterionInput[];
  /**
   * Stall watchdog budget: when no progress signal (provider stream event,
   * lifecycle transition, completion-check milestone) arrives for this long,
   * the attempt fails with a stalled-timeout worker result so the existing
   * retry ladder and attention policy decide what happens next. Omitted =
   * the compile-time default.
   */
  stallTimeoutMs?: number;
}
export function executeTask(options: Options): TaskExecution {
  const controller = new AbortController();
  const execution: TaskExecution = {
    done: Promise.resolve(),
    settled: false,
    abort: () => controller.abort(),
  };
  execution.done = run(options, controller.signal, execution)
    .catch((error) => {
      execution.error = error;
    })
    .finally(() => {
      execution.settled = true;
    });
  return execution;
}
async function run(
  {
    input,
    context,
    workerId,
    provider,
    computeClass,
    selectFallback,
    control,
    verifier,
    personas,
    personaKindDefaults,
    recordRawActivity = true,
    contextPolicy,
    codeMap,
    goalCriteria,
    stallTimeoutMs,
  }: Options,
  signal: AbortSignal,
  execution: TaskExecution,
): Promise<void> {
  const taskId = context.task.id;
  const workerInput = { ...input, taskId, workerId };
  // Stall watchdog: a worker that produces no observable progress (stream
  // event, lifecycle transition, check milestone) for the whole budget fails
  // the attempt instead of hanging the run. Lease renewal and owner health
  // are deliberately NOT progress — a live coordinator awaiting a dead worker
  // stays silent here and is failed like any other stall.
  const stallThresholdMs = stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  let lastProgressAt = Date.now();
  let rejectStalled!: (error: WorkerStalled) => void;
  const stalled = new Promise<never>((_, reject) => {
    rejectStalled = reject;
  });
  // Keep the rejection observed even when no race is parked on it at fire time.
  void stalled.catch(() => {});
  const watchdog = setInterval(
    () => {
      const silentMs = Date.now() - lastProgressAt;
      if (silentMs >= stallThresholdMs)
        rejectStalled(new WorkerStalled(silentMs, stallThresholdMs));
    },
    Math.min(5_000, Math.max(25, Math.floor(stallThresholdMs / 4))),
  );
  watchdog.unref?.();
  const touchProgress = () => {
    lastProgressAt = Date.now();
  };
  const raceStall = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, stalled]);
  const persona = resolvePersona({
    requested: context.task.persona,
    kind: context.task.kind,
    registry: personas ?? {},
    defaults: personaKindDefaults,
  });
  const withPersonaWarning = (summary: string) =>
    persona.warning ? `${persona.warning}\n${summary}` : summary;
  let handleId: string | undefined;
  let workerFinished = false;
  let unsubscribe: (() => void) | undefined;
  let lastActivity = 0;
  let releaseAttempted = false;
  const release = async () => {
    if (releaseAttempted || !handleId || !provider.release) return;
    releaseAttempted = true;
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await bounded(provider.release(handleId), 5000, "Worker cleanup did not respond");
        return;
      } catch (error) {
        failure = error;
        if (error instanceof LifecycleTimeout) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const summary = `Worker cleanup requires attention (${provider.id}, ${handleId}): ${redact(failure, 500)}. Inspect and close only this worker's resources before reconciling.`;
    await control.requestAttention({
      ...input,
      taskId,
      attentionId: `cleanup-${workerId}`,
      kind: "failure",
      summary,
    });
    throw new CleanupFailed(summary);
  };
  /** Bounded best-effort cancel: a provider cancel that never settles must
   * not become a new hang path; the uncertain outcome goes to attention. */
  const cancelWorker = async () => {
    if (!handleId) return;
    try {
      await bounded(provider.cancel(handleId), 5_000, "Worker cancel did not respond");
    } catch (error) {
      if (!(error instanceof LifecycleTimeout)) throw error;
      await control
        .requestAttention({
          ...input,
          taskId,
          attentionId: `cancel-${workerId}`,
          kind: "failure",
          summary: `Worker cancel outcome is unknown (${provider.id}, ${handleId}): ${redact(error, 500)}. Confirm the worker process stopped before reconciling.`,
        })
        .catch(() => {});
    }
  };
  try {
    if (signal.aborted) {
      await control.recordWorkerStopped(workerInput);
      return;
    }
    // G1 context lifecycle: fold advisory history (passed-check bodies, retry
    // summary) once per dispatch when over budget. Preserved sets — completion
    // contract, guidance, failure evidence, dependency/decision results — pass
    // through verbatim. Opt out with `advisoryByteBudget: 0`. G2: the optional
    // code map rides the same start context as one bounded advisory entry.
    const summarized = summarizeTaskContext(
      context,
      contextPolicy ?? DEFAULT_CONTEXT_LIFECYCLE_POLICY,
    );
    if (summarized.fold) {
      const fold = summarized.fold;
      await control.recordActivity({
        ...input,
        taskId,
        activity: `[context] folded ${fold.summarizedEntryCount} advisory entries (${fold.advisoryBytesBefore} → ${fold.advisoryBytesAfter} bytes); preserved ${fold.preservedEntryCount} entries${fold.truncated ? "; summary truncated" : ""}`,
      });
    }
    // Limit guards (docs/defects/limits-inventory.md R1·R2·R4): the bridge
    // already clamped/compacted the assembled context under the prompt
    // bounds; surface that record as one bounded activity line. The adapter
    // only renders it — the policy and the reduction live in Rust.
    const reduction = summarized.context.contextReduction;
    if (reduction) {
      await control.recordActivity({
        ...input,
        taskId,
        activity: redact(
          `[context] bounded dispatch: ${reduction.fieldClamps} field clamp(s), ${reduction.bodyCompactions} body compaction(s), ${reduction.droppedChars} chars dropped; full text in the run store${reduction.retryCompaction ? "; retry continues on compacted context" : ""} (essential estimate ${reduction.estimatedEssentialChars} chars)`,
          300,
        ),
      });
    }
    const startContext = withCodeMapEntry(
      summarized.context,
      codeMap?.({ task: context.task, workingDirectory: context.workingDirectory }),
    );
    const sourceBeforeWorker = await captureSourceState(context.workingDirectory, [
      input.databasePath,
    ]);
    const startInput: StartWorkerInput = {
      runId: input.runId,
      taskId,
      title: context.task.title,
      kind: context.task.kind,
      computeClass: computeClass ?? context.task.preferredCompute,
      attempt: context.attempt,
      requirements: context.task.requirements,
      workingDirectory: context.workingDirectory,
      context: startContext,
      ...(persona.instructions ? { personaInstructions: persona.instructions } : {}),
    };
    const excludedProviderIds = new Set<string>();
    let result: WorkerResult;
    // One durable reservation spans these sequential handles. Never release
    // ownership or consume a scheduler attempt merely because the provider
    // lane failed: any retryable failure (quota exhaustion, transport fault,
    // process error, timeout) releases the handle and walks the routing
    // fallback chain (e.g. zai → openai-codex) before a scheduler retry
    // would rerun the same lane.
    while (true) {
      const starting = provider.start(startInput);
      let handle: WorkerHandle;
      try {
        handle = await startup(starting, signal);
      } catch (error) {
        if (error instanceof StartupUncertain) {
          // If startup eventually yields a handle while this owner remains alive,
          // stop it. The durable reservation remains until explicit reconciliation.
          void starting
            .then(async (late) => {
              await provider.cancel(late.id);
              await provider.release?.(late.id);
            })
            .catch(() => {});
        }
        throw error;
      }
      handleId = handle.id;
      // Bind the live steer channel to this handle so the mailbox (which
      // only knows the durable worker id) reaches the provider session.
      const steer = provider.steer;
      const activeHandleId = handleId;
      execution.steer =
        steer && activeHandleId !== undefined
          ? (message) => steer.call(provider, activeHandleId, message)
          : undefined;
      // The subscription must stay attached even when raw recording is
      // suppressed: the mirroring layer renders sink lines from these events.
      unsubscribe = provider.subscribe?.(handle.id, (event) => {
        // Any provider event is real worker progress for the stall watchdog,
        // even when the activity recorder is suppressed or throttled.
        touchProgress();
        if (event.type !== "output" && event.type !== "lifecycle") return;
        if (!recordRawActivity || Date.now() - lastActivity < 1000) return;
        const activity =
          event.type === "lifecycle"
            ? `[lifecycle] ${event.status}`
            : redact(
                event.text
                  // oxlint-disable-next-line eslint/no-control-regex -- intentional control-char match
                  .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
                  .trim()
                  .split(/\r?\n/)
                  .at(-1) ?? "",
                300,
              );
        if (!activity) return;
        lastActivity = Date.now();
        void control.recordActivity({ ...input, taskId, activity }).catch(() => {});
      });
      const received = await raceStall(untilAborted(provider.result(handle.id), signal));
      if (!received || signal.aborted) {
        await cancelWorker();
        await release();
        await control.recordWorkerStopped(workerInput);
        return;
      }
      result = received;
      touchProgress();
      const failureKind = result.failure?.kind;
      const fallbackEligible =
        result.failure !== undefined && (result.failure.retryable || failureKind === "quota");
      if (result.success || !fallbackEligible || !selectFallback) break;
      await release();
      unsubscribe?.();
      unsubscribe = undefined;
      excludedProviderIds.add(provider.id);
      await control.recordActivity({
        ...input,
        taskId,
        activity: redact(
          `Provider failure (${provider.id}, ${failureKind}); released worker and selecting an untried provider. ${result.summary}`,
          500,
        ),
      });
      let next: RouteSelection | undefined;
      try {
        next = await selectFallback(excludedProviderIds);
      } catch (error) {
        result = {
          ...result,
          summary: `${result.summary}\nProvider fallback exhausted or unavailable: ${redact(error)}`,
        };
        break;
      }
      if (!next || signal.aborted) {
        await control.recordWorkerStopped(workerInput);
        return;
      }
      provider = next.provider;
      startInput.computeClass = next.computeClass;
      handleId = undefined;
      execution.steer = undefined;
      releaseAttempted = false;
      lastActivity = 0;
    }
    const exhaustedTimeout =
      !result.success &&
      result.failure?.kind === "timeout" &&
      result.failure.retryable &&
      context.attempt + 1 >= context.task.maxAttempts;
    if (
      !result.success &&
      (exhaustedTimeout ||
        result.failure?.retryable === false ||
        ["authentication", "quota"].includes(result.failure?.kind ?? ""))
    ) {
      await control.requestAttention({
        ...input,
        taskId,
        attentionId: `failure-${input.runId}-${taskId}-${context.attempt}-${exhaustedTimeout ? "timeout-exhausted" : "environment"}`,
        kind: "failure",
        summary: exhaustedTimeout
          ? `Worker timeout retry budget exhausted: ${redact(result.summary)}`
          : redact(result.summary),
      });
    }
    await control.recordWorkerResult({
      ...workerInput,
      success: result.success,
      summary: withPersonaWarning(redact(result.summary)),
    });
    workerFinished = true;
    if (!result.success) {
      await release();
      return;
    }
    // §D: the self-heal pass fires at most once per task execution.
    let criteriaHealed = false;
    for (let focusedRepair = 0; focusedRepair <= 1; focusedRepair++) {
      const sourceBeforeChecks = await captureSourceState(context.workingDirectory, [
        input.databasePath,
      ]);
      const observedChangedPaths =
        sourceBeforeWorker && sourceBeforeChecks
          ? changedSourcePaths(sourceBeforeWorker, sourceBeforeChecks)
          : [];
      // Check runs are progress: announce the verification stage so the
      // persisted last-progress timestamp and the stall watchdog both stay
      // fed while checks execute (they can outlast any stream output).
      await control.recordActivity({
        ...input,
        taskId,
        activity: `Running ${context.task.completionChecks.length} completion check${context.task.completionChecks.length === 1 ? "" : "s"}`,
      });
      touchProgress();
      const evidence = await raceStall(
        verifier.verify(context.task.completionChecks, context.workingDirectory, signal),
      );
      touchProgress();
      if (signal.aborted) {
        await control.stopVerification({ ...input, taskId });
        return;
      }
      const sourceAfterChecks = await captureSourceState(
        context.workingDirectory,
        [input.databasePath],
        [...context.task.readScope, ...context.task.writeScope],
      );
      const source =
        sourceBeforeChecks && sourceAfterChecks
          ? {
              beforeFingerprint: scopedFingerprint(sourceBeforeChecks, [
                ...context.task.readScope,
                ...context.task.writeScope,
              ]),
              afterFingerprint: scopedFingerprint(sourceAfterChecks, [
                ...context.task.readScope,
                ...context.task.writeScope,
              ]),
              observedChangedPaths,
              observedOutsideWriteScope: [],
            }
          : undefined;
      const receipts = await Promise.all(
        evidence.map(async (check) => {
          const artifact = await storeCheckOutput(
            input.databasePath,
            input.runId,
            taskId,
            check.id,
            check.stdout,
            check.stderr,
          );
          return {
            id: check.id,
            command: check.command,
            args: check.args,
            workingDirectory: check.workingDirectory,
            exitCode: check.exitCode,
            stdout: redact(check.stdout),
            stderr: redact(check.stderr),
            timedOut: check.timedOut,
            durationMs: check.durationMs,
            ...(artifact ? { outputArtifact: artifact.path } : {}),
            ...(source ? { source } : {}),
          };
        }),
      );
      await control.recordCheckReceipts({ ...input, taskId, checks: receipts });
      touchProgress();
      const checks = evidence.map(({ id, passed }) => ({ id, passed }));
      const passed = checks.every((check) => check.passed);
      await control.recordActivity({
        ...input,
        taskId,
        activity: `Completion checks finished: ${checks.filter((check) => check.passed).length}/${checks.length} passed`,
      });
      let reason = evidence
        .filter((check) => !check.passed)
        .map(
          (check) =>
            `${check.id}: exit ${check.exitCode}${check.timedOut ? " (timeout)" : ""}\n${check.stderr || check.stdout}`,
        )
        .join("\n");
      if (passed && !criteriaHealed && !signal.aborted) {
        // §D self-heal: passing evidence that would still leave this task's
        // goal criteria pending gets exactly one stable-source re-run. A
        // clean replacement replaces the receipts; a failed or unstable pass
        // keeps the original evidence and the blocked-goal attention decides.
        const criteriaCheckIds = criteriaCheckIdsForTask(goalCriteria, taskId);
        if (
          criteriaCheckIds.length > 0 &&
          receiptsBlockCriteria(receipts, context.task.writeScope)
        ) {
          criteriaHealed = true;
          try {
            await rerunCriteriaChecksOnStableSource({
              input,
              control,
              verifier,
              taskId,
              checkIds: criteriaCheckIds,
              completionChecks: context.task.completionChecks,
              readScope: context.task.readScope,
              writeScope: context.task.writeScope,
              workingDirectory: context.workingDirectory,
              signal,
            });
          } catch {
            /* degrade to the blocked-goal attention with the original evidence */
          }
        }
      }
      if (!passed && focusedRepair === 0 && provider.repair && handleId && !signal.aborted) {
        try {
          await control.recordActivity({
            ...input,
            taskId,
            activity: "Focused checks failed; returning evidence to the same worker session once.",
          });
          const repaired = await raceStall(
            untilAborted(
              provider.repair(
                handleId,
                `Fix the failed completion checks, then report the change. Loop will rerun them independently.\n${redact(reason, 4_000)}`,
              ),
              signal,
            ),
          );
          if (signal.aborted || !repaired) {
            await provider.cancel(handleId);
            await control.stopVerification({ ...input, taskId });
            return;
          }
          if (repaired.success) {
            await control.recordTaskOutput({
              ...input,
              taskId,
              summary: withPersonaWarning(redact(repaired.summary)),
            });
            await control.recordActivity({
              ...input,
              taskId,
              activity: `Same-session repair returned: ${redact(repaired.summary, 300)}`,
            });
            continue;
          }
          reason += `\nSame-session repair failed: ${redact(repaired.summary)}`;
        } catch (error) {
          reason += `\nSame-session repair unavailable: ${redact(error)}`;
        }
      }
      await release();
      await control.recordVerification({
        ...input,
        taskId,
        checks,
        passed,
        reason: redact(reason),
      });
      break;
    }
  } catch (error) {
    if (error instanceof CleanupFailed) return;
    if (error instanceof StartupUncertain) {
      await control.requestAttention({
        ...input,
        taskId,
        attentionId: `startup-${workerId}`,
        kind: "failure",
        summary: `Worker startup outcome is unknown: ${redact(error)}. Confirm the worker stopped before using loop reconcile ${input.runId} ${taskId} stopped.`,
      });
      return;
    }
    // A failed start or check is durable evidence, not an unhandled owner exit.
    if (signal.aborted) {
      if (handleId) await cancelWorker();
      await release();
      if (!workerFinished) await control.recordWorkerStopped(workerInput);
      else await control.stopVerification({ ...input, taskId });
      return;
    }
    if (handleId && !workerFinished) await cancelWorker();
    await release();
    if (!workerFinished)
      await control.recordWorkerResult({
        ...workerInput,
        success: false,
        summary: withPersonaWarning(redact(error)),
      });
    else
      await control.recordVerification({
        ...input,
        taskId,
        passed: false,
        checks: [],
        reason: redact(error),
      });
  } finally {
    clearInterval(watchdog);
    execution.steer = undefined;
    unsubscribe?.();
    // Deliberate: swallow the idempotent-release CleanupFailed backstop, but
    // surface unexpected release() failures even from finally.
    try {
      await release();
    } catch (error) {
      // oxlint-disable-next-line eslint/no-unsafe-finally -- intentional rethrow, see above
      if (!(error instanceof CleanupFailed)) throw error;
    }
  }
}
async function untilAborted(
  result: Promise<WorkerResult>,
  signal: AbortSignal,
): Promise<WorkerResult | undefined> {
  if (signal.aborted) return undefined;
  let abort!: () => void;
  const cancelled = new Promise<undefined>((resolve) => {
    abort = () => resolve(undefined);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([result, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

class LifecycleTimeout extends Error {}
class StartupUncertain extends Error {}
class CleanupFailed extends Error {}

/** Silence budget for one worker attempt before the stall watchdog fails it.
 * Canonical value lives in config.ts (parsed policy `[recovery].stall_timeout_ms`
 * falls back to it); re-exported here for the execution-layer call sites. */
export { DEFAULT_STALL_TIMEOUT_MS };

/** Thrown by the stall watchdog when an attempt produced no progress signal
 * for the whole silence budget. The catch path records it as a failed worker
 * result, so the existing retry ladder and attention policy take over. */
class WorkerStalled extends Error {
  constructor(
    readonly silentMs: number,
    readonly thresholdMs: number,
  ) {
    super(
      `Worker stalled: no progress for ${Math.round(silentMs / 1000)}s (stall threshold ${Math.round(thresholdMs / 1000)}s); failing the attempt for the retry policy`,
    );
  }
}
async function bounded<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LifecycleTimeout(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function startup(promise: Promise<WorkerHandle>, signal: AbortSignal): Promise<WorkerHandle> {
  let abort!: () => void;
  let timer!: ReturnType<typeof setTimeout>;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () =>
      reject(new StartupUncertain("control interrupted startup before a handle was returned"));
    timer = setTimeout(() => reject(new StartupUncertain("worker startup timed out")), 30000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([promise, interrupted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
