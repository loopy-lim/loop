import type {
  LifecycleHookOutcome,
  LifecycleHookPhase,
  RustraEventPayloads,
  SandboxCapabilityDeclaration,
} from "@loop/protocol";

/** Wire shape of one hook observation (G13): the `loop.lifecycle_hook` event payload. */
export type LifecycleHookEvent = RustraEventPayloads["loop.lifecycle_hook"];

import { defaultToolMediationPolicy, mediateToolCall, type ToolMediationPolicy } from "./mediation";
import { noSandboxDeclaration } from "./sandbox";
import { redactProviderText } from "./redact";
import { NodeProcessRunner, type ProcessResult } from "./process";
import type {
  AgentProvider,
  ProviderCapabilities,
  ProviderEvent,
  StartWorkerInput,
  WorkerHandle,
  WorkerResult,
  WorkerState,
} from "./types";

/**
 * Adapter lifecycle-hook event seam (gap analysis G13 — lifecycle 훅,
 * 부분도입).
 *
 * Hooks are a typed EMISSION seam: adapters map their own hook systems onto
 * the fixed v1 phase vocabulary and observe worker execution. Hook outcomes
 * are EVIDENCE, never gates — a failed hook is recorded and never overrides
 * run or task state, and completion checks remain the only completion gate
 * (core judgment invariant). Hook commands are user-supplied processes, so
 * they pass through the G5 tool mediation layer before execution; a denied
 * hook is `skipped` with the verdict recorded.
 */

export const HOOK_OUTPUT_LIMIT = 4_000;
const DEFAULT_HOOK_TIMEOUT_MS = 60_000;

export interface LifecycleHookDefinition {
  /** Adapter-assigned hook identity (its own hook-system name); opaque to the bridge. */
  hookId: string;
  phase: LifecycleHookPhase;
  command: string;
  args?: string[];
  timeoutMs?: number;
  cwd?: string;
}

export interface LifecycleHookContext {
  runId?: string;
  taskId?: string;
}

/** Execution seam for hook processes; injectable for deterministic tests. */
export interface HookExecutor {
  run(
    command: string,
    args: string[],
    options: { cwd?: string; timeoutMs: number },
  ): Promise<ProcessResult>;
}

export class ProcessHookExecutor implements HookExecutor {
  async run(
    command: string,
    args: string[],
    options: { cwd?: string; timeoutMs: number },
  ): Promise<ProcessResult> {
    const runner = new NodeProcessRunner({ runTimeoutMs: options.timeoutMs, cancelGraceMs: 500 });
    const running = runner.start(command, args, { cwd: options.cwd });
    const timedOut = await Promise.race([
      running.result.then(() => false),
      new Promise<true>((resolve) => setTimeout(() => resolve(true), options.timeoutMs + 1_000)),
    ]);
    const result = await running.result;
    if (timedOut || /timed out/i.test(result.stderr)) {
      return {
        ...result,
        stderr: `${result.stderr}\nhook timed out after ${options.timeoutMs}ms`.trim(),
      };
    }
    return result;
  }
}

export interface LifecycleHookRunnerOptions {
  definitions: readonly LifecycleHookDefinition[];
  executor?: HookExecutor;
  /** G5 policy vetting hook commands; defaults to `defaultToolMediationPolicy`. */
  mediation?: ToolMediationPolicy;
  clock?: () => Date;
}

export class LifecycleHookRunner {
  readonly #definitions: readonly LifecycleHookDefinition[];
  readonly #executor: HookExecutor;
  readonly #mediation: ToolMediationPolicy;
  readonly #clock: () => Date;
  readonly #events: LifecycleHookEvent[] = [];
  readonly #listeners = new Set<(event: LifecycleHookEvent) => void>();

  constructor(options: LifecycleHookRunnerOptions) {
    this.#definitions = [...options.definitions];
    this.#executor = options.executor ?? new ProcessHookExecutor();
    this.#mediation = options.mediation ?? defaultToolMediationPolicy();
    this.#clock = options.clock ?? (() => new Date());
  }

  /** Emission seam: subscribers receive every hook event as it is recorded. */
  onEvent(listener: (event: LifecycleHookEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  events(): readonly LifecycleHookEvent[] {
    return [...this.#events];
  }

  /** Fires every hook registered for the phase. Never throws: hook failures are evidence only. */
  async run(
    phase: LifecycleHookPhase,
    context: LifecycleHookContext = {},
  ): Promise<LifecycleHookEvent[]> {
    const definitions = this.#definitions.filter((definition) => definition.phase === phase);
    const events = await Promise.all(
      definitions.map((definition) => this.#execute(definition, context)),
    );
    return events;
  }

  async #execute(
    definition: LifecycleHookDefinition,
    context: LifecycleHookContext,
  ): Promise<LifecycleHookEvent> {
    const occurredAt = this.#clock().toISOString();
    const mediation = mediateToolCall(this.#mediation, {
      tool: "hook",
      command: shellLine(definition),
    });
    if (mediation.effect === "deny") {
      return this.#record(definition, context, {
        outcome: "skipped",
        output: redactProviderText(`mediation denied: ${mediation.reason}`, HOOK_OUTPUT_LIMIT),
        truncated: false,
        exitCode: null,
        occurredAt,
      });
    }
    const timeoutMs = definition.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
    let result: ProcessResult;
    try {
      result = await this.#executor.run(definition.command, definition.args ?? [], {
        cwd: definition.cwd,
        timeoutMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const skipped = /enoent/i.test(message);
      return this.#record(definition, context, {
        outcome: skipped ? "skipped" : "failed",
        output: redactProviderText(
          skipped ? `hook not runnable: ${message}` : `hook error: ${message}`,
          HOOK_OUTPUT_LIMIT,
        ),
        truncated: false,
        exitCode: null,
        occurredAt,
      });
    }
    const timedOut = /hook timed out/i.test(result.stderr);
    const outcome: LifecycleHookOutcome =
      timedOut || result.exitCode !== 0 ? "failed" : "completed";
    const output = redactProviderText(
      [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
      HOOK_OUTPUT_LIMIT,
    );
    return this.#record(definition, context, {
      outcome,
      output,
      truncated: output.length >= HOOK_OUTPUT_LIMIT,
      exitCode: timedOut ? null : result.exitCode,
      occurredAt,
    });
  }

  #record(
    definition: LifecycleHookDefinition,
    context: LifecycleHookContext,
    event: Pick<LifecycleHookEvent, "outcome" | "output" | "truncated" | "exitCode" | "occurredAt">,
  ): LifecycleHookEvent {
    const typed: LifecycleHookEvent = {
      hookId: definition.hookId,
      phase: definition.phase,
      outcome: event.outcome,
      runId: context.runId,
      taskId: context.taskId,
      output: event.output,
      truncated: event.truncated,
      exitCode: event.exitCode,
      occurredAt: event.occurredAt,
    };
    this.#events.push(typed);
    for (const listener of this.#listeners) listener(typed);
    return typed;
  }
}

/**
 * Provider wrapper that emits worker-boundary hook events (G13): `workerStarted`
 * after a successful start and `workerEnded` once the result resolves. Hooks
 * observe; they never delay, fail, or alter the worker result.
 */
export class HookedProvider implements AgentProvider {
  readonly #inner: AgentProvider;
  readonly #hooks: LifecycleHookRunner;

  constructor(inner: AgentProvider, hooks: LifecycleHookRunner) {
    this.#inner = inner;
    this.#hooks = hooks;
  }

  get id(): string {
    return this.#inner.id;
  }

  /** G4a: declarations pass through the hook wrapper unchanged (absence stays declared). */
  sandboxDeclaration(): SandboxCapabilityDeclaration {
    return this.#inner.sandboxDeclaration?.() ?? noSandboxDeclaration(this.id);
  }

  capabilities(): Promise<ProviderCapabilities> {
    return this.#inner.capabilities();
  }

  async start(input: StartWorkerInput): Promise<WorkerHandle> {
    const handle = await this.#inner.start(input);
    void this.#hooks
      .run("workerStarted", { runId: input.runId, taskId: input.taskId })
      .catch(() => {});
    return handle;
  }

  async result(workerId: string): Promise<WorkerResult> {
    const result = await this.#inner.result(workerId);
    // Hooks observe: awaiting gives deterministic evidence, but a hook failure
    // (or a broken hook runner) is swallowed and never reaches the result.
    await this.#hooks.run("workerEnded").catch(() => {});
    return result;
  }

  cancel(workerId: string): Promise<void> {
    return this.#inner.cancel(workerId);
  }

  status(workerId: string): Promise<WorkerState> {
    return this.#inner.status(workerId);
  }

  subscribe?(workerId: string, listener: (event: ProviderEvent) => void): () => void {
    return this.#inner.subscribe?.(workerId, listener) ?? (() => {});
  }

  async release?(workerId: string): Promise<void> {
    await this.#inner.release?.(workerId);
  }
}

function shellLine(definition: LifecycleHookDefinition): string {
  return [definition.command, ...(definition.args ?? [])].join(" ");
}
