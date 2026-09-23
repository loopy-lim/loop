import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import { Type } from "typebox";
import type { RunSummary } from "@loop/orchestrator";
// Subpath import: the persona module is a leaf (no bridge dependency), so the
// Node-targeted pi extension bundle stays free of Bun-only imports (bun:ffi).
import {
  EXPLICIT_ONLY_PERSONA_IDS,
  KIND_DEFAULT_PERSONAS,
  PERSONA_IDS,
} from "@loop/orchestrator/persona";
import { loadLoopConfig } from "@loop/orchestrator/config";
import { compactLines, type OutputLimits, singleLine } from "@loop/presentation";
import type {
  RunListOutput,
  SnapshotOutput,
  TaskContextOutput,
  TaskSpecInput,
} from "@loop/protocol";

import { validateDecomposition } from "./lead/decompose";
import { decompositionPrompt, taskSpecInputDescription } from "./lead/prompts";

/**
 * Persona vocabulary is single-sourced from the orchestrator's persona
 * registry (@loop/orchestrator persona module); this adapter only renders it.
 */
const PERSONA_KIND_DEFAULTS_PROSE = `${Object.entries(KIND_DEFAULT_PERSONAS)
  .map(([kind, id]) => `${kind}→${id}`)
  .join(", ")}; ${EXPLICIT_ONLY_PERSONA_IDS.join(", ")} is explicit-request only`;
import {
  HerdrLifecycleReporter,
  registerHerdrLifecycle,
  type HerdrLifecycleSink,
  type PiLifecycleEvent,
} from "./herdr-lifecycle";
import { renderModels } from "./ui/models";
import { renderRuns, renderSnapshot, renderTaskContext } from "./ui/snapshot";
import { renderLoopRunSummary } from "./ui/summary";

interface PiContext {
  cwd: string;
  ui: { notify(message: string, level?: "info" | "success" | "warning" | "error"): void };
}

interface PiToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

export interface PiExtensionApi {
  registerCommand(
    name: string,
    options: {
      description: string;
      handler(args: string, context: PiContext): Promise<void> | void;
    },
  ): void;
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute(
      toolCallId: string,
      params: { intent: string; tasksJson: string; runId?: string },
      signal: AbortSignal,
      onUpdate: ((value: PiToolResult) => void) | undefined,
      context: PiContext,
    ): Promise<PiToolResult>;
  }): void;
  on(
    event: PiLifecycleEvent,
    handler: () => Promise<void> | void,
  ): void;
  on(
    event: "before_agent_start",
    handler: (
      event: { prompt: string; systemPrompt: string },
      context: PiContext,
    ) => Promise<{ systemPrompt: string }> | { systemPrompt: string },
  ): void;
}

export interface LoopLeadBackend {
  run(input: {
    intent: string;
    tasks: TaskSpecInput[];
    runId: string;
    cwd: string;
    signal: AbortSignal;
    onProgress?: (snapshot: SnapshotOutput) => void;
  }): Promise<RunSummary>;
  snapshot(runId: string, cwd: string): Promise<SnapshotOutput>;
  cancel(runId: string, cwd: string): Promise<SnapshotOutput>;
  pause(runId: string, cwd: string): Promise<SnapshotOutput>;
  resume(runId: string, cwd: string): Promise<SnapshotOutput>;
  steer(runId: string, taskId: string, message: string, cwd: string): Promise<SnapshotOutput>;
  resolve(
    runId: string,
    attentionId: string,
    resolution: string,
    cwd: string,
  ): Promise<SnapshotOutput>;
  task(runId: string, taskId: string, cwd: string): Promise<TaskContextOutput>;
  runs(cwd: string): Promise<RunListOutput[]>;
  models(cwd: string): Promise<string[]>;
}

export function registerLoopExtension(
  pi: PiExtensionApi,
  backend: LoopLeadBackend = new DefaultLoopLeadBackend(),
  lifecycle: HerdrLifecycleSink = new HerdrLifecycleReporter(),
  limits: OutputLimits = loadLoopConfig().output,
): void {
  let currentRunId: string | undefined;

  registerHerdrLifecycle(pi, lifecycle);

  pi.registerTool({
    name: "loop_run",
    label: "Loop Run",
    description: [
      "Submit a dependency DAG to Loop after understanding an engineering request.",
      "Loop owns scheduling, worker dispatch, verification, retries, and durable state.",
      "Pass tasksJson as a JSON array using the generated Loop task fields.",
      `Each task may carry an optional persona id (${PERSONA_IDS.join(" | ")}). Kind defaults: ${PERSONA_KIND_DEFAULTS_PROSE}.`,
    ].join(" "),
    parameters: Type.Object({
      intent: Type.String({ description: "The user's complete engineering intent" }),
      tasksJson: Type.String({
        description: taskSpecInputDescription(),
      }),
      runId: Type.Optional(Type.String({ description: "Stable run id; omit to generate one" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, context) {
      const runId = params.runId?.trim() || `loop-${randomUUID()}`;
      const tasks = normalizePersonas(parseTasks(params.tasksJson));
      currentRunId = runId;
      onUpdate?.(result([
        singleLine(`Run ${runId}`, limits.lineTextLimit),
        singleLine(`Starting ${tasks.length} tasks`, limits.lineTextLimit),
      ].join("\n"), { runId }));
      const summary = normalizeRunSummary(await backend.run({
        intent: params.intent,
        tasks,
        runId,
        cwd: context.cwd,
        signal,
        onProgress: (snapshot) => {
          onUpdate?.(result(renderSnapshot("status", snapshot, limits), {
            runId,
            state: snapshot.state,
          }));
        },
      }), tasks.length);
      const text = renderLeadRunSummary(runId, summary, limits);
      context.ui.notify(text, summary.status === "completed" ? "success" : "warning");
      return result(text, { runId, status: summary.status });
    },
  });

  pi.registerCommand("loop", {
    description: "Show or control the current durable Loop run",
    async handler(rawArgs, context) {
      const parts = rawArgs.trim().split(/\s+/).filter(Boolean);
      const command = parts.shift() ?? "status";
      if (command === "models") {
        context.ui.notify(renderModels(await backend.models(context.cwd), limits), "info");
        return;
      }
      if (command === "runs") {
        context.ui.notify(renderRuns(await backend.runs(context.cwd), limits), "info");
        return;
      }
      if (command === "task") {
        const [runId, taskId] = parts;
        if (!runId || !taskId) {
          context.ui.notify("Usage: /loop task <run> <task>", "warning");
          return;
        }
        currentRunId = runId;
        context.ui.notify(
          renderTaskContext(await backend.task(runId, taskId, context.cwd), limits),
          "info",
        );
        return;
      }
      if (command === "steer" || command === "resolve") {
        const [runId, targetId, ...messageParts] = parts;
        const message = messageParts.join(" ");
        if (!runId || !targetId || !message) {
          const target = command === "steer" ? "<task|all> <message>" : "<id> <resolution>";
          context.ui.notify(`Usage: /loop ${command} <run> ${target}`, "warning");
          return;
        }
        currentRunId = runId;
        const snapshot = command === "steer"
          ? await backend.steer(runId, targetId, message, context.cwd)
          : await backend.resolve(runId, targetId, message, context.cwd);
        context.ui.notify(
          renderSnapshot("status", snapshot, limits),
          snapshot.state === "attention" ? "warning" : "info",
        );
        return;
      }
      if (!["status", "graph", "workers", "attention", "cancel", "pause", "resume"].includes(command)) {
        context.ui.notify("Unknown Loop command. Use status, graph, workers, attention, runs, task, pause, resume, steer, resolve, cancel, or models.", "warning");
        return;
      }
      const requestedRunId = parts[0];
      const runId = requestedRunId ?? currentRunId;
      if (!runId) {
        context.ui.notify("No Loop run yet. Submit an engineering request first.", "warning");
        return;
      }
      currentRunId = runId;
      const snapshot = command === "cancel"
        ? await backend.cancel(runId, context.cwd)
        : command === "pause"
          ? await backend.pause(runId, context.cwd)
          : command === "resume"
            ? await backend.resume(runId, context.cwd)
            : await backend.snapshot(runId, context.cwd);
      const rendered = renderSnapshot(command, snapshot, limits);
      context.ui.notify(rendered, snapshot.state === "attention" ? "warning" : "info");
    },
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${leadInstructions(event.prompt)}`,
  }));
}

class DefaultLoopLeadBackend implements LoopLeadBackend {
  async run(input: {
    intent: string;
    tasks: TaskSpecInput[];
    runId: string;
    cwd: string;
    signal: AbortSignal;
    onProgress?: (snapshot: SnapshotOutput) => void;
  }): Promise<RunSummary> {
    return runLoopPlan(input);
  }

  async snapshot(runId: string, cwd: string): Promise<SnapshotOutput> {
    return this.#json(["status", runId, "--json"], cwd);
  }

  async cancel(runId: string, cwd: string): Promise<SnapshotOutput> {
    await this.#json<unknown>(["cancel", runId, "--json"], cwd);
    return this.snapshot(runId, cwd);
  }

  async pause(runId: string, cwd: string): Promise<SnapshotOutput> {
    await this.#json<unknown>(["pause", runId, "--json"], cwd);
    return this.snapshot(runId, cwd);
  }

  async resume(runId: string, cwd: string): Promise<SnapshotOutput> {
    await this.#json<unknown>(["resume", runId, "--json"], cwd);
    return this.snapshot(runId, cwd);
  }

  async steer(
    runId: string,
    taskId: string,
    message: string,
    cwd: string,
  ): Promise<SnapshotOutput> {
    await this.#json<unknown>(["steer", runId, taskId, message, "--json"], cwd);
    return this.snapshot(runId, cwd);
  }

  async resolve(
    runId: string,
    attentionId: string,
    resolution: string,
    cwd: string,
  ): Promise<SnapshotOutput> {
    await this.#json<unknown>(["resolve", runId, attentionId, resolution, "--json"], cwd);
    return this.snapshot(runId, cwd);
  }

  async task(runId: string, taskId: string, cwd: string): Promise<TaskContextOutput> {
    return this.#json(["task", runId, taskId, "--json"], cwd);
  }

  async runs(cwd: string): Promise<RunListOutput[]> {
    return this.#json(["runs", "--json"], cwd);
  }

  async models(cwd: string): Promise<string[]> {
    const models = await this.#json<Array<{ computeClass: string; id: string }>>(
      ["models", "--json"],
      cwd,
    );
    return models.map((model) => `${model.computeClass} · ${model.id}`);
  }

  async #json<T>(
    args: string[],
    cwd: string,
    stdin?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const output = await runLoopCommand(args, cwd, stdin, signal);
    try {
      return JSON.parse(output) as T;
    } catch {
      throw new Error("Loop returned invalid JSON");
    }
  }
}

export function runLoopPlan(input: {
  intent: string;
  tasks: TaskSpecInput[];
  runId: string;
  cwd: string;
  signal: AbortSignal;
  onProgress?: (snapshot: SnapshotOutput) => void;
}): Promise<RunSummary> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.LOOP_BIN || "loop", ["__execute-plan", "--json", "--stream"], {
      cwd: input.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let stderr = "";
    let summary: RunSummary | undefined;
    let settled = false;
    let ownerObserved = false;
    let disconnectRequested = false;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const stopObserver = () => {
      if (child.exitCode !== null || child.signalCode !== null || stopTimer) return;
      child.kill("SIGTERM");
      stopTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      stopTimer.unref();
    };
    const runningSummary = (): RunSummary => ({
      status: "running",
      tasks: input.tasks.length,
      escalations: [],
      providersByTask: {},
      startedAt: {},
      finishedAt: {},
    });
    const cleanup = () => input.signal.removeEventListener("abort", disconnectObserver);
    const succeed = (value: RunSummary) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const disconnectObserver = () => {
      if (settled) return;
      if (!ownerObserved) {
        disconnectRequested = true;
        return;
      }
      stopObserver();
      succeed(runningSummary());
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdin.on("error", (error) => {
      if (!settled) fail(error);
    });
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        try {
          const event = JSON.parse(line) as { type?: string; value?: unknown };
          if (event.type === "snapshot") {
            ownerObserved = true;
            input.onProgress?.(event.value as SnapshotOutput);
          }
          if (event.type === "summary") {
            ownerObserved = true;
            summary = normalizeRunSummary(event.value, input.tasks.length);
            // A durable summary completes the tool protocol. Native handles or
            // inherited pipes must not keep Pi waiting for the observer's exit.
            succeed(summary);
            stopObserver();
          }
          if (disconnectRequested && ownerObserved) disconnectObserver();
        } catch {
          stopObserver();
          fail(new Error("Loop returned invalid progress JSON"));
        }
      }
    });
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", fail);
    child.on("close", (code) => {
      if (stopTimer) clearTimeout(stopTimer);
      if (settled) return;
      if (code === 0 && summary) succeed(summary);
      else fail(new Error((stderr || `Loop exited ${code} without a summary`).slice(-4_000)));
    });
    child.stdin.end(JSON.stringify({
      intent: input.intent,
      runId: input.runId,
      workingDirectory: input.cwd,
      tasks: input.tasks,
    }));
    if (input.signal.aborted) disconnectObserver();
    else input.signal.addEventListener("abort", disconnectObserver, { once: true });
  });
}

function runLoopCommand(
  args: string[],
  cwd: string,
  stdin?: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.LOOP_BIN || "loop", args, {
      cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error((stderr || `Loop exited ${code}`).slice(-4_000)));
    });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
    if (signal) {
      const cancel = () => child.kill("SIGTERM");
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    }
  });
}

function parseTasks(value: string): TaskSpecInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Loop plan must be valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("Loop plan must be a task array");
  return validateDecomposition(parsed as TaskSpecInput[]);
}

/**
 * Worker persona contract: unknown ids are rejected deterministically at
 * submission time (never silently diverge from the orchestrator's runtime
 * fallback), and blank/absent values forward as null so the orchestrator
 * applies its kind-based default.
 */
function normalizePersonas(tasks: TaskSpecInput[]): TaskSpecInput[] {
  return tasks.map((task) => {
    const persona = task.persona?.trim();
    if (persona && !PERSONA_IDS.includes(persona)) {
      throw new Error(
        `unknown persona '${persona}' in task ${task.id}. Valid persona ids: ${PERSONA_IDS.join(", ")}`,
      );
    }
    return { ...task, persona: persona || null };
  });
}

function leadInstructions(intent: string): string {
  return [
    "You are the interactive Lead for Loop.",
    "For an engineering execution request, inspect only enough context to create a small dependency DAG, then call loop_run exactly once.",
    "Every task must declare dependencies, exact read and write ownership, requirements, preferredCompute, minimumCompute, maximumCompute, maxAttempts, and at least one machine-verifiable completionChecks entry.",
    "Requirements must name the result and evidence the worker returns; downstream tasks receive dependency result summaries rather than implicit context.",
    "Research tasks may run in parallel. Decision and integration tasks must be serialized. Do not claim completion yourself; Loop verifies it.",
    decompositionPrompt(intent),
  ].join("\n");
}

function normalizeRunSummary(value: unknown, fallbackTasks: number): RunSummary {
  const summary = value && typeof value === "object" ? value as Partial<RunSummary> : {};
  return {
    status: summary.status ?? "running",
    tasks: summary.tasks ?? fallbackTasks,
    escalations: summary.escalations ?? [],
    providersByTask: summary.providersByTask ?? {},
    startedAt: summary.startedAt ?? {},
    finishedAt: summary.finishedAt ?? {},
  };
}

function renderLeadRunSummary(
  runId: string,
  summary: RunSummary,
  limits: OutputLimits,
): string {
  if (summary.status !== "running") return renderLoopRunSummary(runId, summary, limits);
  return compactLines([
    `Run ${runId}`,
    "State: running",
    `Tasks: ${summary.tasks}`,
    "Execution continues in the detached owner; this observer disconnected.",
    `Next: /loop status ${runId}`,
  ], {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more status lines`,
  }).join("\n");
}

function result(text: string, details: Record<string, unknown>): PiToolResult {
  return { content: [{ type: "text", text }], details };
}

export default registerLoopExtension;
