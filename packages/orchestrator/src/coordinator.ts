import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { HerdrWorkerRuntime } from "@loop/herdr";
import type { GoalCriterionInput, TaskSpecInput } from "@loop/protocol";
import type { AgentProvider, ProviderRegistry } from "@loop/providers";
import { CompletionVerifier, NodeCompletionRunner } from "./completion";
import { cleanupRun, type CleanupRunReport, type CleanupRunRequest } from "./cleanup";
import type { WorkerVisibility } from "./config";
import type { OrchestrationControl } from "./control";
import type { PersonaKindDefaults, PersonaRegistry } from "./persona";
import { GuidanceMailbox, resolveMailboxOptions, steerCoalescingOf, type GuidanceMailboxOptions } from "./mailbox";
import { executeTask, type TaskExecution } from "./task-execution";
import { redact } from "./redact";
import { buildScopeCodeMap, type CodeMapProvider } from "./code-map";
import type { ContextLifecyclePolicy } from "./context-lifecycle";
import type { UsageLedger, UsageSummary } from "./usage";

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
  /** Async human-input mailbox (docs/research/async-human-input.md §6); enabled by default. */
  guidanceMailbox?: GuidanceMailboxOptions;
  /**
   * G1 context-lifecycle thresholds; omitted = compile-time defaults.
   * `advisoryByteBudget: 0` disables automatic summarization.
   */
  contextPolicy?: ContextLifecyclePolicy;
  /**
   * G2 code map provider; omitted = the built-in scope-derived map when
   * `codeMapInjection` is "scopes", nothing otherwise. An explicit provider
   * always wins (embedding apps can reuse the Lead `loop_code_map` tool).
   */
  codeMap?: CodeMapProvider;
  /** Enables the built-in scope-derived code map when no explicit provider is supplied. */
  codeMapInjection?: "off" | "scopes";
  /**
   * G17 usage recorder; the collecting surface (adapter) pushes reported
   * usage, the ledger aggregates basis-separated totals for the run summary.
   */
  usageLedger?: UsageLedger;
}
export interface RunRequest {
  databasePath: string;
  runId: string;
  tasks: TaskSpecInput[];
  criteria?: GoalCriterionInput[];
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
  /**
   * G17: present only when usage was actually reported during the run; a run
   * without records carries no usage field (never zero-filled guesses).
   */
  usage?: UsageSummary;
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
  readonly #guidanceMailbox: Required<GuidanceMailboxOptions>;
  readonly #contextPolicy?: ContextLifecyclePolicy;
  readonly #codeMap?: CodeMapProvider;
  readonly #usageLedger?: UsageLedger;
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
    this.#guidanceMailbox = resolveMailboxOptions(options.guidanceMailbox);
    this.#contextPolicy = options.contextPolicy;
    this.#codeMap = options.codeMap ?? (options.codeMapInjection === "scopes" ? buildScopeCodeMap : undefined);
    this.#usageLedger = options.usageLedger;
  }
  cleanupRun(request: CleanupRunRequest): Promise<CleanupRunReport> {
    return cleanupRun(this.#control, { ...request, herdr: request.herdr ?? this.#herdr });
  }
  /** G17: basis-separated usage totals for a run; undefined when never reported. */
  usage(runId: string): UsageSummary | undefined {
    const ledger = this.#usageLedger;
    if (!ledger) return undefined;
    const summary = ledger.summary(runId);
    return summary.recordCount === 0 ? undefined : summary;
  }
  async prepare(request: RunRequest): Promise<void> {
    const input = runInput(request);
    const prepared = { ...input, intent: redact(request.intent ?? ""), workingDirectory: realpathSync(resolve(request.workingDirectory ?? process.cwd())), tasks: request.tasks };
    if (request.criteria) await this.#control.prepareGoalRun({ ...prepared, criteria: request.criteria });
    else await this.#control.prepareRun(prepared);
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
    const summary = await this.#execute(request);
    // G17: attach usage totals only when something was actually reported.
    const usage = this.usage(request.runId);
    return usage ? { ...summary, usage } : summary;
  }
  async #execute(request: ExistingRunRequest): Promise<RunSummary> {
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
      ...(this.#contextPolicy ? { contextPolicy: this.#contextPolicy } : {}),
      ...(this.#codeMap ? { codeMap: this.#codeMap } : {}),
    };
    const active = new Map<string, TaskExecution>();
    let leaseLost = false;
    let mailbox: GuidanceMailbox | undefined;
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
      // Read-only GuidanceAdded tap filling per-worker mailboxes; drains only
      // happen at safe boundaries (mailbox.ts) and never touch run state.
      // The lease owner authorizes the mailbox's GuidanceDelivered appends.
      mailbox = this.#guidanceMailbox.enabled
        ? new GuidanceMailbox(this.#control, input.databasePath, input.runId, this.#guidanceMailbox, owner)
        : undefined;
      mailbox?.start();
      while (true) {
        if (leaseLost) throw new Error("execution ownership was lost; stopped local workers");
        if (request.signal?.aborted) await this.#control.cancelRun(input);
        let snapshot = await this.#control.getSnapshot(input);
        if (snapshot.state === "cancelling" || snapshot.state === "cancelled") {
          for (const task of active.values()) task.abort();
          await Promise.all([...active.values()].map(task => task.done));
          for (const task of active.values()) if (task.error) throw task.error;
          for (const id of active.keys()) mailbox?.release(id);
          active.clear();
          await this.#control.cancelRun(input);
          summary.status = (await this.#control.getSnapshot(input)).state === "cancelled" ? "cancelled" : "attention";
          return summary;
        }
        for (const [id, task] of active) {
          if (!task.settled) continue;
          active.delete(id);
          mailbox?.release(id);
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
          // Claim-context steering (M-TL2): the mailbox filters guidance the
          // delivery watermark already covered and appends ancestor-targeted
          // guidance for descendant sub-tasks. Without a mailbox the context
          // stays exactly as the bridge produced it.
          const claimGuidance = await mailbox?.claimContext(taskId, context.guidance);
          const startContext = claimGuidance ? { ...context, guidance: claimGuidance.guidance } : context;
          let provider: AgentProvider | undefined;
          let selectedComputeClass: TaskSpecInput["preferredCompute"] | undefined;
          let routeReason = "";
          try {
            const selection = this.#providers.selectForTask(context.task);
            const selected = await selectWhileActive(selection, async () => {
              if (request.signal?.aborted) await this.#control.cancelRun(input);
              return !leaseLost && (await this.#control.getSnapshot(input)).state === "active";
            });
            if (!selected) break;
            provider = selected.provider;
            selectedComputeClass = selected.computeClass;
            routeReason = selected.reason;
          }
          catch (error) {
            await this.#control.requestAttention({ ...executionInput, attentionId: `provider-${request.runId}-${taskId}-${context.attempt}`, kind: "failure", taskId, summary: redact(error) });
            break;
          }
          if (!provider) break;
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
          await this.#control.recordActivity({ ...executionInput, taskId, activity: `Route: ${routeReason}` });
          summary.startedAt[taskId] = Date.now();
          const execution = executeTask({
            ...taskExecutionOptions, context: startContext, workerId, provider, computeClass: selectedComputeClass!,
            selectFallback: async excluded => {
              const next = await selectWhileActive(this.#providers.selectForTask(context.task, excluded), async () => {
                if (request.signal?.aborted) await this.#control.cancelRun(input);
                // Pause drains this already-reserved task; cancellation does not.
                return !leaseLost && ["active", "pausing"].includes((await this.#control.getSnapshot(input)).state);
              });
              if (next) {
                const previous = history.at(-1)!;
                summary.escalations.push({ taskId, from: previous, to: next.provider.id });
                history.push(next.provider.id);
                await this.#control.recordActivity({ ...executionInput, taskId, activity: `Fallback route: ${next.reason}` });
              }
              return next;
            },
          });
          mailbox?.register({
            taskId,
            workerId,
            // Watermark: everything the assembled start context covered.
            // Guidance at/below it is already with this worker; later
            // guidance arrives through the tap instead.
            deliveredThroughSequence: claimGuidance ? claimGuidance.throughSequence : Number(snapshot.lastSequence ?? 0),
            // Live delivery follows the provider's current handle (the
            // execution binds it), not the durable worker id. The drain
            // policy reads the provider's steer-delivery capability: a
            // turn-boundary inbox self-coalesces and is handed off on every
            // tap tick, a conversation channel keeps the spam window.
            ...(provider.steer ? { steer: async message => {
              const live = execution.steer;
              if (!live) throw new Error("worker has no live steer channel yet");
              await live(message);
            }, steerCoalescing: steerCoalescingOf(provider) } : {}),
          });
          active.set(taskId, execution);
        }
        if (leaseLost) throw new Error("execution ownership was lost");
        if (active.size === 0) {
          snapshot = await this.#control.getSnapshot(input);
          if (snapshot.state !== "active") continue;
          const pendingCriteria = snapshot.goalCriteria.filter(item => item.state !== "verified");
          const blockedSummary = pendingCriteria.length > 0 && snapshot.tasks.every(task => task.state === "done")
            ? `Tasks passed, but goal criteria remain unverified: ${pendingCriteria.map(item => item.id).join(", ")}. Inspect check receipts and source-state evidence before closing the goal.`
            : "No runnable task remains. Inspect dependencies and reconcile interrupted verification before retrying.";
          await this.#control.requestAttention({ ...executionInput, attentionId: `blocked-${request.runId}-${snapshot.lastSequence}`, kind: "failure", taskId: null, summary: blockedSummary });
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
      await mailbox?.stop();
      await this.#control.releaseExecution({ ...input, owner });
    }
  }
}
function runInput(request: ExistingRunRequest) { return { databasePath: request.databasePath, runId: request.runId }; }
function delay(milliseconds: number) { return new Promise<void>(resolve => setTimeout(resolve, milliseconds)); }

async function selectWhileActive<T>(selection: Promise<T>, stillActive: () => Promise<boolean>): Promise<T | undefined> {
  const pending = selection.then(provider => ({ provider }), error => ({ error }));
  const deadline = Date.now() + 30000;
  while (await stillActive()) {
    const result = await Promise.race([pending, delay(50).then(() => undefined)]);
    if (result) { if ("error" in result) throw result.error; return result.provider; }
    if (Date.now() > deadline) throw new Error("Provider capability lookup timed out; retry after checking the provider.");
  }
  return undefined;
}
