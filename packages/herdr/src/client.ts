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

export interface CloseWorkspaceResult {
  closed: boolean;
  reason?: string;
}

interface WorkspaceRef {
  workspaceId: string;
  rootPaneId: string;
  tabIds: Set<string>;
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
    const tabId = requiredString(tab, ["result", "tab", "tab_id"]);
    if (this.#workspaces.has(input.runId)) {
      this.#workspaces.get(input.runId)!.tabIds.add(tabId);
    }
    const handle: HerdrWorkerHandle = {
      workerId,
      workspaceId: parent.workspaceId,
      tabId,
      paneId,
      taskId: input.taskId,
      ...(input.execution.type === "agent" ? { agentName: workerId } : {}),
    };

    try {
      await this.#launch(handle, input.execution, input.prompt, input.waitForPrompt === true);
      return handle;
    } catch (error) {
      await this.#run(["tab", "close", tabId]).catch(() => undefined);
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
      handle.agentName ? ["result", "agent", "agent_status"] : ["result", "pane", "agent_status"],
    )
      ?? optionalString(
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
    const args = handle.agentName
      ? [
          "agent",
          "read",
          handle.agentName,
          "--source",
          "recent-unwrapped",
          "--lines",
          String(lines),
        ]
      : ["pane", "read", handle.paneId, "--lines", String(lines)];
    // Unlike the other herdr verbs, `read` prints the raw pane text instead
    // of the JSON envelope, so parse it as plain output.
    const result = await this.#runner.run(this.#command, args);
    if (result.exitCode !== 0) {
      throw new Error(formatHerdrError(result));
    }
    return result.stdout;
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
    try {
      await this.#run(["tab", "close", handle.tabId]);
    } catch (error) {
      if (!isAlreadyGone(error)) {
        throw error;
      }
      // Already-gone surfaces count as cleaned.
    }
    this.#turns.delete(handle.workerId);
  }

  async closeWorkspace(runId: string): Promise<CloseWorkspaceResult> {
    const workspace = this.#workspaces.get(runId);
    if (!workspace) {
      try {
        const listPayload = await this.#run(["workspace", "list"]);
        const workspaces = optionalArray(listPayload, ["result", "workspaces"]) ?? [];
        const found = workspaces.find((w) =>
          typeof w === "object" && w !== null && "label" in w && (w as { label: unknown }).label === `loop-${runId}`
        );
        if (found && typeof found === "object" && "workspace_id" in found) {
          const wsId = String((found as { workspace_id: unknown }).workspace_id);
          return await this.#teardownWorkspace(runId, wsId, undefined, new Set());
        }
      } catch (error) {
        if (isAlreadyGone(error)) {
          return { closed: true, reason: "already_gone" };
        }
      }
      return { closed: true, reason: "already_gone" };
    }
    return await this.#teardownWorkspace(runId, workspace.workspaceId, workspace.rootPaneId, workspace.tabIds);
  }

  async #teardownWorkspace(
    runId: string,
    workspaceId: string,
    rootPaneId?: string,
    tabIds: Set<string> = new Set(),
  ): Promise<CloseWorkspaceResult> {
    try {
      await this.#run(["workspace", "close", workspaceId]);
      this.#workspaces.delete(runId);
      return { closed: true, reason: "workspace_closed" };
    } catch (wsError) {
      if (isAlreadyGone(wsError)) {
        this.#workspaces.delete(runId);
        return { closed: true, reason: "already_gone" };
      }

      // Tab-close fallback per docs/research/herdr-teardown-surface.md:
      // Closing tabs in the workspace; closing the last tab cascades to workspace destruction.
      try {
        const tabListPayload = await this.#run(["tab", "list", "--workspace", workspaceId]);
        const tabsFromList = optionalArray(tabListPayload, ["result", "tabs"]) ?? [];
        const allTabIds = new Set<string>(tabIds);
        for (const t of tabsFromList) {
          if (typeof t === "object" && t !== null && "tab_id" in t && typeof t.tab_id === "string") {
            allTabIds.add(t.tab_id);
          }
        }

        if (allTabIds.size === 0 && rootPaneId) {
          await this.#run(["pane", "close", rootPaneId]).catch((err) => {
            if (!isAlreadyGone(err)) throw err;
          });
        } else {
          for (const tabId of allTabIds) {
            await this.#run(["tab", "close", tabId]).catch((err) => {
              if (!isAlreadyGone(err)) throw err;
            });
          }
        }
        this.#workspaces.delete(runId);
        return { closed: true, reason: "tabs_closed" };
      } catch (tabError) {
        if (isAlreadyGone(tabError)) {
          this.#workspaces.delete(runId);
          return { closed: true, reason: "already_gone" };
        }
        throw wsError;
      }
    }
  }

  /**
   * Herdr can reject the first agent start while the freshly created pane is
   * still initializing ("agent_pane_busy: ... is not an available shell").
   * Retry briefly before giving up so a scheduler attempt is not burned.
   */
  async #startAgentWithRetry(args: string[], attempts = 3): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.#run(args);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("agent_pane_busy") && !message.includes("not an available shell")) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
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
      await this.#startAgentWithRetry(args);
      if (prompt.length > 0) {
        if (waitForPrompt) {
          // The turn must never reject: herdr may fail the wait CLI after a
          // timeout or a pane close (agent_not_running), and an unhandled
          // rejection kills the whole orchestrator process. Polling in the
          // provider is the source of truth for worker state.
          const turn = this.#run([
            "agent",
            "prompt",
            handle.workerId,
            prompt,
            "--wait",
            "--until",
            "done",
            "--timeout",
            String(this.#promptTimeoutMs),
          ]).then(
            () => undefined,
            () => undefined,
          );
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
    const rootTabId = optionalString(payload, ["result", "tab", "tab_id"]);
    const workspace: WorkspaceRef = {
      workspaceId: requiredString(payload, ["result", "workspace", "workspace_id"]),
      rootPaneId: requiredString(payload, ["result", "root_pane", "pane_id"]),
      tabIds: new Set<string>(rootTabId ? [rootTabId] : []),
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

function optionalArray(payload: unknown, path: string[]): unknown[] | undefined {
  let value = payload;
  for (const key of path) {
    if (typeof value !== "object" || value === null || !(key in value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return Array.isArray(value) ? value : undefined;
}

function isAlreadyGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("not_found") ||
    message.includes("not_running") ||
    message.includes("workspace_not_found") ||
    message.includes("tab_not_found") ||
    message.includes("pane_not_found")
  );
}
