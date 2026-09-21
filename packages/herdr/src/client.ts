import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import { assertWorktreeInsideProject } from "./worktree";
import type {
  HerdrExecution,
  HerdrWorkerHandle,
  HerdrWorkerInput,
  HerdrWorkerState,
} from "./worker";

export interface HerdrResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface HerdrRunner {
  run(command: string, args: string[]): Promise<HerdrResult>;
}

export interface HerdrWorkerRuntimeOptions {
  runner?: HerdrRunner;
  command?: string;
  promptTimeoutMs?: number;
}

interface WorkspaceRef {
  workspaceId: string;
  rootPaneId: string;
}

export class NodeHerdrRunner implements HerdrRunner {
  async run(command: string, args: string[]): Promise<HerdrResult> {
    return await new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        resolve({ exitCode: 1, stdout, stderr: stderr || error.message });
      });
      child.on("close", (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });
    });
  }
}

/**
 * Owns the Herdr-facing worker lifecycle. Loop persists only the returned opaque
 * identifiers; terminal sessions and provider processes remain Herdr-owned.
 */
export class HerdrWorkerRuntime {
  readonly #runner: HerdrRunner;
  readonly #command: string;
  readonly #promptTimeoutMs: number;
  readonly #workspaces = new Map<string, WorkspaceRef>();
  readonly #turns = new Map<string, Promise<void>>();

  constructor(options: HerdrWorkerRuntimeOptions = {}) {
    this.#runner = options.runner ?? new NodeHerdrRunner();
    this.#command = options.command ?? "herdr";
    this.#promptTimeoutMs = options.promptTimeoutMs ?? 300_000;
  }

  async start(input: HerdrWorkerInput): Promise<HerdrWorkerHandle> {
    assertWorktreeInsideProject(input.projectRoot, input.worktree);
    const parent = input.caller ?? (await this.#ensureWorkspace(input));
    const workerId = workerName(input.workerName ?? input.taskId);
    // Workers live in their own tab of the same workspace: same space,
    // one tab per worker, no split-screen clutter, no focus stealing.
    const tab = await this.#run([
      "tab",
      "create",
      "--workspace",
      parent.workspaceId,
      "--cwd",
      input.worktree,
      "--label",
      workerId,
      "--no-focus",
    ]);
    const paneId = requiredString(tab, ["result", "root_pane", "pane_id"]);
    const handle: HerdrWorkerHandle = {
      workerId,
      workspaceId: parent.workspaceId,
      paneId,
      taskId: input.taskId,
      ...(input.execution.type === "agent" ? { agentName: workerId } : {}),
    };

    try {
      await this.#launch(handle, input.execution, input.prompt, input.waitForPrompt === true);
      return handle;
    } catch (error) {
      await this.#run(["pane", "close", paneId]).catch(() => undefined);
      throw error;
    }
  }

  attach(handle: HerdrWorkerHandle): HerdrWorkerHandle {
    validateHandle(handle);
    return { ...handle };
  }

  async wait(handle: HerdrWorkerHandle): Promise<void> {
    validateHandle(handle);
    await (this.#turns.get(handle.workerId) ?? Promise.resolve());
  }

  async status(handle: HerdrWorkerHandle): Promise<HerdrWorkerState> {
    validateHandle(handle);
    const payload = handle.agentName
      ? await this.#run(["agent", "get", handle.agentName])
      : await this.#run(["pane", "get", handle.paneId]);
    const state = optionalString(
      payload,
      handle.agentName ? ["result", "agent", "state"] : ["result", "pane", "state"],
    );
    return mapState(state);
  }

  async read(handle: HerdrWorkerHandle, lines = 80): Promise<string> {
    validateHandle(handle);
    if (!Number.isInteger(lines) || lines < 1 || lines > 10_000) {
      throw new Error("lines must be an integer between 1 and 10000");
    }
    const payload = handle.agentName
      ? await this.#run([
          "agent",
          "read",
          handle.agentName,
          "--source",
          "recent-unwrapped",
          "--lines",
          String(lines),
        ])
      : await this.#run(["pane", "read", handle.paneId, "--lines", String(lines)]);
    return optionalString(payload, ["result", "output"]) ?? "";
  }

  async cancel(handle: HerdrWorkerHandle): Promise<void> {
    validateHandle(handle);
    if (handle.agentName) {
      await this.#run(["agent", "send-keys", handle.agentName, "ctrl+c"]);
      return;
    }
    await this.#run(["pane", "send-keys", handle.paneId, "ctrl+c"]);
  }

  async cleanup(handle: HerdrWorkerHandle): Promise<void> {
    validateHandle(handle);
    await this.#run(["pane", "close", handle.paneId]);
    this.#turns.delete(handle.workerId);
  }

  async #launch(
    handle: HerdrWorkerHandle,
    execution: HerdrExecution,
    prompt: string,
    waitForPrompt: boolean,
  ): Promise<void> {
    if (execution.type === "agent") {
      const args = [
        "agent",
        "start",
        handle.workerId,
        "--kind",
        execution.kind,
        "--pane",
        handle.paneId,
      ];
      if (execution.args.length > 0) args.push("--", ...execution.args);
      await this.#run(args);
      if (prompt.length > 0) {
        if (waitForPrompt) {
          const turn = this.#run([
            "agent",
            "prompt",
            handle.workerId,
            prompt,
            "--wait",
            "--timeout",
            String(this.#promptTimeoutMs),
          ]).then(() => undefined);
          this.#turns.set(handle.workerId, turn);
        } else {
          await this.#run(["agent", "prompt", handle.workerId, prompt]);
        }
      }
      return;
    }
    await this.#run(["pane", "run", handle.paneId, execution.command, ...execution.args]);
  }

  async #ensureWorkspace(input: HerdrWorkerInput): Promise<{ workspaceId: string; paneId: string }> {
    const cached = this.#workspaces.get(input.runId);
    if (cached) {
      return { workspaceId: cached.workspaceId, paneId: cached.rootPaneId };
    }
    const payload = await this.#run([
      "workspace",
      "create",
      "--cwd",
      input.projectRoot,
      "--label",
      `loop-${input.runId}`,
      "--no-focus",
    ]);
    const workspace = {
      workspaceId: requiredString(payload, ["result", "workspace", "workspace_id"]),
      rootPaneId: requiredString(payload, ["result", "root_pane", "pane_id"]),
    };
    this.#workspaces.set(input.runId, workspace);
    return { workspaceId: workspace.workspaceId, paneId: workspace.rootPaneId };
  }

  async #run(args: string[]): Promise<unknown> {
    const result = await this.#runner.run(this.#command, args);
    if (result.exitCode !== 0) {
      throw new Error(formatHerdrError(result));
    }
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      throw new Error("Herdr returned invalid JSON");
    }
  }
}

function workerName(taskId: string): string {
  const safe = taskId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe) throw new Error("task id cannot produce a Herdr worker name");
  const name = `loop-${safe}`;
  if (name.length <= 32) return name;
  const suffix = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return `${name.slice(0, 23)}-${suffix}`;
}

function validateHandle(handle: HerdrWorkerHandle): void {
  for (const [name, value] of Object.entries(handle)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`invalid Herdr worker handle field: ${name}`);
    }
  }
}

function requiredString(payload: unknown, path: string[]): string {
  const value = optionalString(payload, path);
  if (!value) throw new Error(`Herdr response is missing ${path.join(".")}`);
  return value;
}

function optionalString(payload: unknown, path: string[]): string | undefined {
  let value = payload;
  for (const key of path) {
    if (typeof value !== "object" || value === null || !(key in value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapState(state: string | undefined): HerdrWorkerState {
  switch (state) {
    case "working":
    case "running":
    case "starting":
      return "running";
    case "blocked":
    case "waiting":
      return "blocked";
    case "done":
    case "idle":
    case "completed":
    case "exited":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    default:
      return "unknown";
  }
}

function formatHerdrError(result: HerdrResult): string {
  const raw = result.stderr || result.stdout || `Herdr exited ${result.exitCode}`;
  try {
    const payload = JSON.parse(raw) as { error?: { code?: unknown; message?: unknown } };
    const code = typeof payload.error?.code === "string" ? payload.error.code : "herdr_error";
    const message = typeof payload.error?.message === "string" ? payload.error.message : raw;
    return redact(`${code}: ${message}`);
  } catch {
    return redact(raw);
  }
}

function redact(value: string): string {
  return value
    .replace(/(?:api[_-]?key|token|authorization)\s*[:=]\s*[^\s,}"']+/gi, "[credential]=[redacted]")
    .slice(0, 2_000);
}
