import { spawn, spawnSync } from "node:child_process";
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
  cancelGraceMs?: number;
  cancelPollMs?: number;
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
  readonly #timeoutMs: number;
  readonly #cancelGraceMs: number;

  constructor(options: { timeoutMs?: number; cancelGraceMs?: number } = {}) {
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#cancelGraceMs = options.cancelGraceMs ?? 1_000;
  }

  async run(command: string, args: string[]): Promise<HerdrResult> {
    return await new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const deadline = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), this.#cancelGraceMs);
      }, this.#timeoutMs);
      const finish = (result: HerdrResult) => {
        clearTimeout(deadline);
        if (killTimer) clearTimeout(killTimer);
        resolve(result);
      };
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        finish({ exitCode: 1, stdout, stderr: stderr || error.message });
      });
      child.on("close", (code) => {
        finish({ exitCode: timedOut ? 124 : code ?? 1, stdout,
          stderr: timedOut ? `Herdr command timed out after ${this.#timeoutMs}ms${stderr ? `: ${stderr}` : ""}` : stderr });
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
  readonly #cancelGraceMs: number;
  readonly #cancelPollMs: number;
  readonly #workspaces = new Map<string, WorkspaceRef>();
  readonly #turns = new Map<string, Promise<void>>();
  readonly #pendingWorkspaces = new Map<string, Promise<{ workspaceId: string; paneId: string }>>();

  constructor(options: HerdrWorkerRuntimeOptions = {}) {
    this.#runner = options.runner ?? new NodeHerdrRunner();
    this.#command = options.command ?? "herdr";
    this.#cancelGraceMs = options.cancelGraceMs ?? 2_000;
    this.#cancelPollMs = options.cancelPollMs ?? 50;

    process.on("exit", () => {
      for (const ws of this.#workspaces.values()) {
        try {
          spawnSync(this.#command, ["workspace", "close", ws.workspaceId], { stdio: "ignore" });
        } catch {
          // ignore
        }
      }
    });
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
    await this.#run(["pane", "rename", paneId, workerId]);
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

  /**
   * Creates a passive pane inside the run's workspace for mirroring worker
   * output. The pane hosts no process — it is a pure viewer surface whose
   * lifetime is owned by the caller (closePane on worker finish).
   */
  async createPane(runId: string, taskId: string, projectRoot: string, worktree: string, label: string): Promise<HerdrWorkerHandle> {
    assertWorktreeInsideProject(projectRoot, worktree);
    const parent = await this.#ensureWorkspace({
      runId,
      taskId,
      projectRoot,
      worktree,
      execution: { type: "command", command: "echo", args: [] },
      prompt: "",
    });
    const tab = await this.#run([
      "tab", "create",
      "--workspace", parent.workspaceId,
      "--cwd", worktree,
      "--label", label,
      "--no-focus",
    ]);
    const paneId = requiredString(tab, ["result", "root_pane", "pane_id"]);
    const tabId = requiredString(tab, ["result", "tab", "tab_id"]);
    await this.#run(["pane", "rename", paneId, label]);
    if (this.#workspaces.has(runId)) {
      this.#workspaces.get(runId)!.tabIds.add(tabId);
    }
    return { workerId: label, workspaceId: parent.workspaceId, tabId, paneId, taskId };
  }

  async closePane(tabId: string): Promise<void> {
    await this.#run(["tab", "close", tabId]).catch(() => undefined);
  }

  async sendText(paneId: string, text: string): Promise<void> {
    await this.#run(["pane", "send-text", paneId, text]);
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
    try {
      if (handle.agentName) {
        await this.#run(["agent", "send-keys", handle.agentName, "ctrl+c"]);
      } else {
        await this.#run(["pane", "send-keys", handle.paneId, "ctrl+c"]);
      }
    } catch (error) {
      if (isAlreadyGone(error)) return;
      throw error;
    }
    const deadline = Date.now() + this.#cancelGraceMs;
    do {
      const state = await this.#statusForCancel(handle);
      if (state !== "running") return;
      await delay(this.#cancelPollMs);
    } while (Date.now() < deadline);

    await this.cleanup(handle);
    const state = await this.#statusForCancel(handle);
    if (state === "running" || state === "unknown") {
      throw new Error(`Herdr worker ${handle.workerId} stop could not be confirmed`);
    }
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

  async purgeLeakedWorkspaces(dryRun: boolean): Promise<string[]> {
    const listPayload = await this.#run(["workspace", "list"]).catch(() => null);
    if (!listPayload) return [];
    const workspaces = optionalArray(listPayload, ["result", "workspaces"]);
    if (!workspaces) return [];
    const removed: string[] = [];
    for (const w of workspaces) {
      if (typeof w === "object" && w !== null && "label" in w) {
        const label = (w as { label: unknown }).label;
        if (typeof label === "string" && label.startsWith("loop-loop-")) {
          const wsId = optionalString(w, ["workspace_id"]);
          if (wsId) {
            if (!dryRun) {
              await this.#run(["workspace", "close", wsId]).catch(() => {});
            }
            removed.push(wsId);
          }
        }
      }
    }
    return removed;
  }

  async closeWorkspace(runId: string): Promise<CloseWorkspaceResult> {
    const workspace = this.#workspaces.get(runId);
    if (!workspace) {
      const listPayload = await this.#run(["workspace", "list"]);
      const workspaces = optionalArray(listPayload, ["result", "workspaces"]);
      if (!workspaces) {
        throw new Error("Herdr workspace list response is missing workspaces");
      }
      const found = workspaces.find((w) =>
        typeof w === "object" && w !== null && "label" in w && (w as { label: unknown }).label === `loop-${runId}`
      );
      if (found) {
        const wsId = optionalString(found, ["workspace_id"]);
        if (!wsId) {
          throw new Error("matching Herdr workspace is missing workspace_id");
        }
        return await this.#teardownWorkspace(runId, wsId, undefined, new Set());
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
        const tabsFromList = optionalArray(tabListPayload, ["result", "tabs"]);
        if (!tabsFromList) {
          throw new Error("Herdr tab list response is missing tabs");
        }
        const allTabIds = new Set<string>(tabIds);
        for (const t of tabsFromList) {
          const tabId = optionalString(t, ["tab_id"]);
          if (tabId) allTabIds.add(tabId);
        }
        if (allTabIds.size === 0 && !rootPaneId) {
          throw new Error("Herdr tab list did not identify any tabs");
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
        throw tabError;
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
    _waitForPrompt: boolean,
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
        // Submission acknowledgement and lifecycle observation are separate:
        // a non-wait prompt proves delivery, then the provider polls status.
        await this.#run(["agent", "prompt", handle.workerId, prompt]);
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
    const pending = this.#pendingWorkspaces.get(input.runId);
    if (pending) return pending;
    
    const promise = (async () => {
      try {
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
      } finally {
        this.#pendingWorkspaces.delete(input.runId);
      }
    })();
    this.#pendingWorkspaces.set(input.runId, promise);
    return promise;
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

  async #statusForCancel(handle: HerdrWorkerHandle): Promise<HerdrWorkerState> {
    try {
      return await this.status(handle);
    } catch (error) {
      if (isAlreadyGone(error)) return "completed";
      throw error;
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
    case "completed":
    case "exited":
      return "completed";
    case "idle":
      return "idle";
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
    .replace(
      /(?:--)?(?:api[_-]?key|token|authorization|password)\s*["']?\s*(?:[:=]\s*["']?|\s+)(?:(?:basic|bearer)\s+)?[^\s,;}"']+/gi,
      "[credential]=[redacted]",
    )
    .replace(/\bbearer\s+[^\s,;}"']+/gi, "[credential]=[redacted]")
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}
