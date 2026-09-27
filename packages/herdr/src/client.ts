import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { assertWorktreeInsideProject } from "./worktree";
import type {
  HerdrCaller,
  HerdrExecution,
  HerdrWorkerHandle,
  HerdrWorkerInput,
  HerdrWorkerState,
} from "./worker";

/**
 * Single source of the caller-anchoring rule (docs/decisions/2026-09-24-herdr-caller-anchoring.md):
 * a Herdr caller is derived from `HERDR_PANE_ID` in the `<workspaceId>:<paneId>` format.
 * Unset/empty values and malformed ids (no `:` separator, or an empty workspace
 * prefix) yield `undefined`, which selects the explicit per-run `loop-<runId>`
 * workspace fallback. `HERDR_WORKSPACE_ID` is deliberately not a placement
 * input; it only gates the mirror sink's activity.
 */
export function herdrCallerFromEnvironment(
  environment: Record<string, string | undefined>,
): HerdrCaller | undefined {
  const paneId = environment.HERDR_PANE_ID;
  if (!paneId) return undefined;
  const separator = paneId.indexOf(":");
  if (separator <= 0) return undefined;
  return { workspaceId: paneId.slice(0, separator), paneId };
}

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

/**
 * Per-run placement record. `owned` distinguishes the loop-<runId> workspace
 * Loop may tear down from a caller-anchored run, whose workspace, tabs, and
 * anchor pane always belong to the user: for those only the run's own
 * worker tabs are ever closed.
 */
interface WorkspaceRef {
  workspaceId: string;
  rootPaneId: string;
  tabIds: Set<string>;
  owned: boolean;
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
        // Caller-anchored records point at the user's workspace: never close.
        if (!ws.owned) continue;
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
    // Identity and display stay separate: the tab/pane label follows the
    // taskId vocabulary while workerId/agentName keep the stable worker name.
    const label = input.label
      ? workerLabel({ taskId: input.taskId, kind: input.label.kind, attempt: input.label.attempt,
          ...(input.label.includeRunMarker ? { runId: input.runId } : {}) })
      : workerId;
    // One tab per worker (live-tabs ADR placement rule, reinstated
    // 2026-09-25): the worker's interactive conversation TUI runs inside its
    // own no-focus tab of the anchor workspace via `agent start --pane` +
    // `agent prompt`. No split-screen placement, no focus stealing.
    const tab = await this.#run([
      "tab",
      "create",
      "--workspace",
      parent.workspaceId,
      "--cwd",
      input.worktree,
      "--label",
      label,
      "--no-focus",
    ]);
    const paneId = requiredString(tab, ["result", "root_pane", "pane_id"]);
    const tabId = requiredString(tab, ["result", "tab", "tab_id"]);
    await this.#run(["pane", "rename", paneId, label]);
    this.#ensureRunRef(input.runId, parent).tabIds.add(tabId);
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
      this.#forgetTab(tabId);
      await this.#run(["tab", "close", tabId]).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Creates a passive pane for mirroring worker output, placed as its own
   * no-focus tab of the anchor workspace by the same rule as start(). The
   * pane hosts no process — it is a pure viewer surface whose lifetime is
   * owned by the caller (closePane on worker finish). The label is derived
   * from taskId (`mirror·<taskId>`) so mirror panes share the worker-tab
   * vocabulary; the caller-provided label is accepted for PaneMirrorHost
   * compatibility only.
   */
  async createPane(runId: string, taskId: string, projectRoot: string, worktree: string, _label?: string, caller?: HerdrCaller): Promise<HerdrWorkerHandle> {
    assertWorktreeInsideProject(projectRoot, worktree);
    const label = mirrorPaneLabel(taskId);
    // Same placement rule as start(): with a caller the mirror is a sibling
    // tab of the caller's workspace and no Loop-owned workspace is created or
    // tracked; without one, the per-run loop-<runId> workspace is the fallback.
    const parent = caller ?? await this.#ensureWorkspace({
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
    this.#ensureRunRef(runId, parent).tabIds.add(tabId);
    return { workerId: label, workspaceId: parent.workspaceId, tabId, paneId, taskId };
  }

  /**
   * Closes a mirror surface (its lifetime is the worker's): the mirror tab
   * this runtime created. Best-effort like the previous contract: failures
   * are swallowed.
   */
  async closePane(tabId: string): Promise<void> {
    await this.#run(["tab", "close", tabId]).catch(() => undefined);
    this.#forgetTab(tabId);
  }

  async sendText(paneId: string, text: string): Promise<void> {
    await this.#run(["pane", "send-text", paneId, text]);
  }

  /**
   * Hosts the steer relay as the pane's process (`herdr pane run`), so typed
   * lines reach the relay's stdin while its stdout lands on the pane display.
   * The relay's lifetime is the pane lifetime: closing the pane ends it.
   */
  async runInPane(paneId: string, command: string, args: string[]): Promise<void> {
    await this.#run(["pane", "run", paneId, command, ...args]);
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
    if (!handle.agentName) return await this.#paneStatus(handle.paneId);
    let payload: unknown;
    try {
      payload = await this.#run(["agent", "get", handle.agentName]);
    } catch (error) {
      if (!isAlreadyGone(error)) throw error;
      // Agent record already gone (herdr restart/prune): observe the pane
      // itself — live-tabs ADR §5 fallback surface.
      return await this.#paneStatus(handle.paneId);
    }
    const state = mapState(
      optionalString(payload, ["result", "agent", "agent_status"])
        ?? optionalString(payload, ["result", "agent", "state"]),
    );
    // Live-tab health signal (ADR §6): a live agent herdr does not consider
    // input-ready is the only observable form of the silent non-interactive
    // fallback (pi falls back to print mode with exit 0). Never judge by exit
    // codes or stdout — surface it as a failure instead.
    if (
      (state === "running" || state === "blocked" || state === "idle")
      && optionalBoolean(payload, ["result", "agent", "interactive_ready"]) === false
    ) {
      return "failed";
    }
    return state;
  }

  /**
   * Pane-level lifecycle observation. A gone pane/tab is termination
   * confirmed (ADR §5): report `completed` instead of throwing, so the
   * already-gone contract keeps holding for both agent and command workers.
   */
  async #paneStatus(paneId: string): Promise<HerdrWorkerState> {
    let payload: unknown;
    try {
      payload = await this.#run(["pane", "get", paneId]);
    } catch (error) {
      if (isAlreadyGone(error)) return "completed";
      throw error;
    }
    return mapState(
      optionalString(payload, ["result", "pane", "agent_status"])
        ?? optionalString(payload, ["result", "pane", "state"]),
    );
  }

  async read(handle: HerdrWorkerHandle, lines = 80): Promise<string> {
    validateHandle(handle);
    if (!Number.isInteger(lines) || lines < 1 || lines > 10_000) {
      throw new Error("lines must be an integer between 1 and 10000");
    }
    if (!handle.agentName) {
      return await this.#readSurface(["pane", "read", handle.paneId, "--lines", String(lines)]);
    }
    try {
      return await this.#readSurface([
        "agent",
        "read",
        handle.agentName,
        "--source",
        "recent-unwrapped",
        "--lines",
        String(lines),
      ]);
    } catch (error) {
      if (!isAlreadyGone(error)) throw error;
      // Agent record gone: the pane is the remaining snapshot surface. When
      // the pane is gone too, termination is confirmed and no transcript
      // exists (ADR §5) — an empty snapshot, not an error.
      try {
        return await this.#readSurface(["pane", "read", handle.paneId, "--lines", String(lines)]);
      } catch (paneError) {
        if (isAlreadyGone(paneError)) return "";
        throw paneError;
      }
    }
  }

  /**
   * Delivers a steer message into a live agent conversation (live-tabs ADR
   * §4): `agent prompt` is the only text surface — it types the message into
   * the TUI editor with bracketed-paste semantics, and herdr pre-rejects it
   * with `agent_blocked` while a blocking UI holds the agent. Raw key
   * injection (`send-keys`) stays cancel-only; command workers have no
   * conversation to steer. Empty messages carry no turn and are skipped,
   * mirroring the initial-prompt guard in `#launch`.
   */
  async steer(handle: HerdrWorkerHandle, message: string): Promise<void> {
    validateHandle(handle);
    if (!handle.agentName) {
      throw new Error(`Herdr worker ${handle.workerId} has no interactive agent conversation to steer`);
    }
    if (message.length === 0) return;
    await this.#run(["agent", "prompt", handle.agentName, message]);
  }

  /**
   * Runs a `read` verb. Unlike the other herdr verbs, `read` prints the raw
   * pane text instead of the JSON envelope, so it is parsed as plain output.
   */
  async #readSurface(args: string[]): Promise<string> {
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
      // The worker's own tab is the close surface. The Lead/caller pane and
      // its hosting tab are never close targets.
      await this.#run(["tab", "close", handle.tabId]);
    } catch (error) {
      if (!isAlreadyGone(error)) {
        throw error;
      }
      // Already-gone surfaces count as cleaned.
    }
    this.#forgetTab(handle.tabId);
    this.#turns.delete(handle.workerId);
  }

  /** Stop tracking a completed worker while leaving its conversation tab for review. */
  detach(handle: HerdrWorkerHandle): void {
    validateHandle(handle);
    this.#forgetTab(handle.tabId);
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
    if (!workspace.owned) {
      return await this.#sweepRunSurfaces(runId, workspace);
    }
    return await this.#teardownWorkspace(runId, workspace.workspaceId, workspace.rootPaneId, workspace.tabIds);
  }

  /**
   * End-of-run sweep for caller-anchored runs: the workspace, its tabs, and
   * the anchor pane belong to the user and are never touched — only this
   * run's leftover worker tabs close. Already-gone tabs count as swept; a
   * hard failure keeps the record so a retry can finish the sweep.
   */
  async #sweepRunSurfaces(runId: string, workspace: WorkspaceRef): Promise<CloseWorkspaceResult> {
    const tabIds = [...workspace.tabIds];
    for (const tabId of tabIds) {
      await this.#run(["tab", "close", tabId]).catch((error) => {
        if (!isAlreadyGone(error)) throw error;
      });
    }
    this.#workspaces.delete(runId);
    for (const tabId of tabIds) this.#forgetTab(tabId);
    return { closed: true, reason: "surfaces_closed" };
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
      const started = await this.#startAgentWithRetry(args);
      // Launch-time live-tab contract (ADR §6): herdr blocks `agent start`
      // until the agent is interactive-ready, so an explicit `interactive_ready:
      // false` acknowledgement means the conversation TUI never came up (pi
      // silently falls back to print mode with exit 0). Fail the launch
      // instead of letting a headless worker pass as a live tab.
      if (optionalBoolean(started, ["result", "agent", "interactive_ready"]) === false) {
        throw new Error(
          `agent_not_interactive: herdr started ${handle.workerId} without a ready conversation TUI`,
        );
      }
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
          owned: true,
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

  /**
   * Registers the run's placement record. Caller-anchored runs anchor to the
   * caller's workspace without owning it, so their worker tabs join a
   * sweep-only record; the loop-<runId> fallback records itself in
   * #ensureWorkspace instead.
   */
  #ensureRunRef(runId: string, parent: { workspaceId: string; paneId: string }): WorkspaceRef {
    const existing = this.#workspaces.get(runId);
    if (existing) return existing;
    const ref: WorkspaceRef = {
      workspaceId: parent.workspaceId,
      rootPaneId: parent.paneId,
      tabIds: new Set<string>(),
      owned: false,
    };
    this.#workspaces.set(runId, ref);
    return ref;
  }

  #forgetTab(tabId: string): void {
    for (const ref of this.#workspaces.values()) ref.tabIds.delete(tabId);
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

/** Herdr caps agent names at 32 characters; display labels share that budget. */
const LABEL_LIMIT = 32;

const KIND_ALIASES: Record<string, string> = {
  implementation: "impl",
  research: "research",
  decision: "decision",
  verification: "verify",
  integration: "integration",
};

export interface WorkerLabelInput {
  taskId: string;
  kind: string;
  attempt: number;
  runId?: string;
}

/** Short display discriminator for retained tabs from separate runs. */
export function workerRunMarker(runId: string): string {
  const readable = runId.replace(/^loop-/, "").replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase();
  return readable || createHash("sha256").update(runId).digest("hex").slice(0, 6);
}

/**
 * Single source of the worker display-label rule:
 * `<taskId>·<kind>·a<attempt>` — e.g. `impl-protocol-unify·impl·a0`,
 * `fact-simplify-audit·research·a1`. When the label exceeds Herdr's limit the
 * taskId is preserved first (truncated last); the kind alias and attempt
 * suffix always survive intact. Display-only: identity remains `workerName`.
 */
export function workerLabel(input: WorkerLabelInput): string {
  const taskId = input.taskId.trim() || "task";
  const suffix = `·${kindAlias(input.kind)}·a${Math.max(0, input.attempt)}${input.runId ? `·${workerRunMarker(input.runId)}` : ""}`;
  const head = taskId.length + suffix.length <= LABEL_LIMIT
    ? taskId
    : taskId.slice(0, Math.max(1, LABEL_LIMIT - suffix.length));
  return `${head}${suffix}`;
}

/**
 * Mirror passive panes carry the same taskId vocabulary as worker tabs:
 * `mirror·<taskId>`, capped at Herdr's label budget the same way.
 */
export function mirrorPaneLabel(taskId: string): string {
  const head = taskId.trim() || "task";
  const prefix = "mirror·";
  const trimmed = head.length + prefix.length <= LABEL_LIMIT
    ? head
    : head.slice(0, Math.max(1, LABEL_LIMIT - prefix.length));
  return `${prefix}${trimmed}`;
}

function kindAlias(kind: string): string {
  const canonical = kind.trim().toLowerCase();
  const alias = KIND_ALIASES[canonical];
  if (alias) return alias;
  const slug = canonical.replace(/[^a-z0-9_-]+/g, "").slice(0, 8);
  return slug || "work";
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

/** Boolean payload lens; absent fields stay `undefined` (tolerated, never false). */
function optionalBoolean(payload: unknown, path: string[]): boolean | undefined {
  let value = payload;
  for (const key of path) {
    if (typeof value !== "object" || value === null || !(key in value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "boolean" ? value : undefined;
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
