import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import { Type } from "typebox";
import type { RunSummary } from "@loop/orchestrator";
import type { SnapshotOutput, TaskSpecInput } from "@loop/protocol";

import { validateDecomposition } from "./lead/decompose";
import { decompositionPrompt } from "./lead/prompts";
import {
  HerdrLifecycleReporter,
  registerHerdrLifecycle,
  type HerdrLifecycleSink,
  type PiLifecycleEvent,
} from "./herdr-lifecycle";

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
  resume(runId: string, cwd: string): Promise<SnapshotOutput>;
  models(cwd: string): Promise<string[]>;
}

export function registerLoopExtension(
  pi: PiExtensionApi,
  backend: LoopLeadBackend = new DefaultLoopLeadBackend(),
  lifecycle: HerdrLifecycleSink = new HerdrLifecycleReporter(),
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
    ].join(" "),
    parameters: Type.Object({
      intent: Type.String({ description: "The user's complete engineering intent" }),
      tasksJson: Type.String({
        description: "JSON TaskSpecInput[] with dependencies, scopes, compute bounds, and completion checks",
      }),
      runId: Type.Optional(Type.String({ description: "Stable run id; omit to generate one" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, context) {
      const runId = params.runId?.trim() || `loop-${randomUUID()}`;
      const tasks = parseTasks(params.tasksJson);
      currentRunId = runId;
      onUpdate?.(result(`Run ${runId}\nStarting ${tasks.length} tasks`, { runId }));
      const summary = await backend.run({
        intent: params.intent,
        tasks,
        runId,
        cwd: context.cwd,
        signal,
        onProgress: (snapshot) => {
          onUpdate?.(result(renderSnapshot("status", snapshot), {
            runId,
            state: snapshot.state,
          }));
        },
      });
      const text = formatRunSummary(runId, summary);
      context.ui.notify(text, summary.status === "completed" ? "success" : "warning");
      return result(text, { runId, status: summary.status });
    },
  });

  pi.registerCommand("loop", {
    description: "Show or control the current durable Loop run",
    async handler(rawArgs, context) {
      const [command = "status", requestedRunId] = rawArgs.trim().split(/\s+/).filter(Boolean);
      const runId = requestedRunId ?? currentRunId;
      if (command === "models") {
        context.ui.notify((await backend.models(context.cwd)).join("\n") || "No models configured", "info");
        return;
      }
      if (!runId) {
        context.ui.notify("No Loop run yet. Submit an engineering request first.", "warning");
        return;
      }
      const snapshot = command === "cancel"
        ? await backend.cancel(runId, context.cwd)
        : command === "resume"
          ? await backend.resume(runId, context.cwd)
          : await backend.snapshot(runId, context.cwd);
      const rendered = renderSnapshot(command, snapshot);
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
    return this.#json(["cancel", runId, "--json"], cwd);
  }

  async resume(runId: string, cwd: string): Promise<SnapshotOutput> {
    return this.#json(["resume", runId, "--json"], cwd);
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

function runLoopPlan(input: {
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
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        try {
          const event = JSON.parse(line) as { type?: string; value?: unknown };
          if (event.type === "snapshot") input.onProgress?.(event.value as SnapshotOutput);
          if (event.type === "summary") summary = event.value as RunSummary;
        } catch {
          reject(new Error("Loop returned invalid progress JSON"));
        }
      }
    });
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && summary) resolve(summary);
      else reject(new Error((stderr || `Loop exited ${code} without a summary`).slice(-4_000)));
    });
    child.stdin.end(JSON.stringify({
      intent: input.intent,
      runId: input.runId,
      workingDirectory: input.cwd,
      tasks: input.tasks,
    }));
    const cancel = () => child.kill("SIGTERM");
    if (input.signal.aborted) cancel();
    else input.signal.addEventListener("abort", cancel, { once: true });
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

function leadInstructions(intent: string): string {
  return [
    "You are the interactive Lead for Loop.",
    "For an engineering execution request, inspect only enough context to create a small dependency DAG, then call loop_run exactly once.",
    "Every task must declare dependencies, readScope, writeScope, requirements, preferredCompute, minimumCompute, maximumCompute, maxAttempts, and at least one machine-verifiable completionChecks entry.",
    "Research tasks may run in parallel. Decision and integration tasks must be serialized. Do not claim completion yourself; Loop verifies it.",
    decompositionPrompt(intent),
  ].join("\n");
}

function formatRunSummary(runId: string, summary: RunSummary): string {
  return [
    `Run ${runId}`,
    `State: ${summary.status}`,
    `Tasks: ${summary.tasks}`,
    `Escalations: ${summary.escalations.length}`,
    summary.status === "completed" ? "Verification: passed" : "Verification: attention required",
  ].join("\n");
}

function renderSnapshot(command: string, snapshot: SnapshotOutput): string {
  if (command === "graph") {
    return snapshot.tasks.slice(0, 7).map((task) => `${task.id} · ${task.state}`).join("\n");
  }
  if (command === "workers") {
    return snapshot.activeWorkers.slice(0, 7).map((worker) => `${worker.id} · ${worker.taskId}`).join("\n")
      || "No active workers";
  }
  if (command === "attention") {
    return snapshot.openAttentionIds.slice(0, 5).join("\n") || "OK";
  }
  const done = snapshot.tasks.filter((task) => task.state === "done").length;
  return [
    `Run ${snapshot.runId}`,
    `State: ${snapshot.state}`,
    `Tasks: ${done}/${snapshot.tasks.length}`,
    `Workers: ${snapshot.activeWorkers.length}`,
    `Attention: ${snapshot.openAttentionIds.length}`,
  ].join("\n");
}

function result(text: string, details: Record<string, unknown>): PiToolResult {
  return { content: [{ type: "text", text }], details };
}

export default registerLoopExtension;
