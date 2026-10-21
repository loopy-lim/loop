/**
 * Herdr socket adapter — the ONLY module in this package that knows the
 * herdr socket API (decision 2026-xx-terminal-mirror D2). Two port surfaces
 * live here:
 *
 * 1. `HerdrPaneSource` implements the herdr-agnostic `PaneObservationPort`
 *    over the herdr socket protocol (pinned: protocol 20) for the terminal
 *    mirror.
 * 2. `HerdrControlClient` is the herdr-surface port (rebuild brief
 *    docs/design/rebuild-brief-herdr-first.md §4): full-session snapshot,
 *    pane reads with format options, agent prompt/keys/focus/start,
 *    workspace creation, integration inventory, and the live subscription
 *    feed — all mapped into gateway vocabulary before they leave this file.
 *
 * Semantics (fail-closed, both surfaces):
 * - Any connect/read/timeout/protocol failure → `null`/`false`/`"unavailable"`
 *   from the port → callers degrade honestly instead of guessing.
 * - Revision polling: `pane.list` for inventory + `pane.read` per pane; the
 *   pane's monotonic `revision` is the change hook (S1 in decision D2).
 * - The wire `revision` (uint64) crosses this boundary as a DECIMAL STRING
 *   (ADR §4.1 u64 rule).
 * - herdr serves ONE request per connection and closes the socket after the
 *   response (verified live, herdr 0.8.2 and 0.9.5). Every request opens a
 *   fresh connection; only `events.subscribe` holds a long-lived one.
 *
 * Not here: pane event frames, SSE, cursors, redaction, state polling —
 * those belong to the gateway's mirror/log/state layers. Relocation note:
 * this module is destined for `@loop/herdr` once that package's write scope
 * opens; until then the pane-boundary test pins it as this package's single
 * herdr-protocol file.
 */

import { connect, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import type { RemotePaneSummary } from "@loop/protocol";

import type { PaneObservationPort, PaneReading } from "./pane-port";

/** herdr socket protocol this adapter speaks (herdr 0.8.2 → protocol 20). */
export const HERDR_PROTOCOL_VERSION = 20;

/** Default herdr socket path (herdr status reports this location). */
export function defaultHerdrSocketPath(): string {
  return join(homedir(), ".config", "herdr", "herdr.sock");
}

/** Mirror-pane label convention from the worker-visibility mirror
 * (`mirror·<taskId>`, docs/decisions/2026-09-23-worker-visibility.md). */
const MIRROR_LABEL_PREFIX = "mirror·";

type HerdrAgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

/** Wire form of one `agent.list` entry (herdr 0.8.x AgentInfo, subset). */
type HerdrAgentInfo = {
  name?: string | null;
  pane_id?: string | null;
  agent?: string | null;
  agent_session?: {
    source?: string | null;
    agent?: string | null;
    kind?: string | null;
    value?: string | null;
  } | null;
};

/** Agent inventory entry the registrar reconciles against (port-shaped:
 * `agent_session` is herdr's own record passthrough, null when absent). */
export type HerdrAgentSummary = {
  name: string;
  paneId: string;
  agent: string | null;
  agentSession: { source: string; agent: string; kind: string; value: string } | null;
};

type HerdrPaneInfo = {
  pane_id: string;
  workspace_id: string;
  label?: string | null;
  title?: string | null;
  agent_status?: HerdrAgentStatus;
};

type HerdrPaneReadResult = {
  pane_id: string;
  revision: number;
  text: string;
  truncated: boolean;
};

export type HerdrPaneSourceOptions = {
  socketPath?: string;
  requestTimeoutMs?: number;
  /** `pane.read` window in lines (Loop read precedent: 80). */
  readLines?: number;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class HerdrPaneSource implements PaneObservationPort {
  readonly #socketPath: string;
  readonly #requestTimeoutMs: number;
  readonly #readLines: number;
  #socket: Socket | null = null;
  #connectPromise: Promise<void> | null = null;
  readonly #pending = new Map<string, PendingRequest>();
  #nextId = 1;
  #buffer = "";

  constructor(options: HerdrPaneSourceOptions = {}) {
    this.#socketPath = options.socketPath ?? defaultHerdrSocketPath();
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 2_000;
    this.#readLines = options.readLines ?? 80;
  }

  /** Pane inventory; null when herdr is unreachable or speaks another protocol. */
  async listPanes(): Promise<RemotePaneSummary[] | null> {
    let result: unknown;
    try {
      result = await this.#request("pane.list", {});
    } catch {
      return null;
    }
    const panes = (result as { panes?: unknown } | null)?.panes;
    if (!Array.isArray(panes)) return null;
    const summaries: RemotePaneSummary[] = [];
    for (const entry of panes) {
      const info = entry as HerdrPaneInfo;
      if (typeof info?.pane_id !== "string" || typeof info?.workspace_id !== "string") {
        return null; // shape drift: fail closed rather than half-map
      }
      summaries.push({
        paneId: info.pane_id,
        label: info.label ?? info.title ?? null,
        taskId: taskIdFromLabel(info.label) ?? taskIdFromLabel(info.title),
        workspaceId: info.workspace_id,
        state: stateFromAgentStatus(info.agent_status),
      });
    }
    return summaries;
  }

  /** One pane screen-buffer reading; null when gone/unreachable. */
  async readPane(paneId: string): Promise<PaneReading | null> {
    let result: unknown;
    try {
      result = await this.#request("pane.read", {
        pane_id: paneId,
        source: "recent_unwrapped",
        lines: this.#readLines,
        format: "text",
        strip_ansi: true,
      });
    } catch {
      return null;
    }
    const read = (result as { read?: unknown } | null)?.read as HerdrPaneReadResult | undefined;
    if (
      read === undefined ||
      typeof read?.pane_id !== "string" ||
      typeof read?.revision !== "number" ||
      !Number.isSafeInteger(read.revision) ||
      read.revision < 0 ||
      typeof read?.text !== "string" ||
      typeof read?.truncated !== "boolean"
    ) {
      return null;
    }
    return { revision: read.revision.toString(10), text: read.text, truncated: read.truncated };
  }

  /**
   * Managed-agent inventory (`agent.list`): Loop's worker agents are herdr
   * agents, and Herdr's UI lists an agent only when its pane carries an
   * `agent_session` record — so the registrar reconciles from here. Null
   * when herdr is unreachable or speaks another protocol (fail-closed, same
   * axis as `listPanes`).
   */
  async listAgents(): Promise<HerdrAgentSummary[] | null> {
    let result: unknown;
    try {
      result = await this.#request("agent.list", {});
    } catch {
      return null;
    }
    const agents = (result as { agents?: unknown } | null)?.agents;
    if (!Array.isArray(agents)) return null;
    const summaries: HerdrAgentSummary[] = [];
    for (const entry of agents) {
      const info = entry as HerdrAgentInfo;
      // Herdr also lists panes it merely DETECTED an agent in; those carry no
      // managed name and are not reconciliation targets — skip, never reject
      // the whole inventory for them.
      if (typeof info?.name !== "string" || info.name.length === 0) continue;
      if (typeof info?.pane_id !== "string" || info.pane_id.length === 0) continue;
      const session = info.agent_session;
      summaries.push({
        name: info.name,
        paneId: info.pane_id,
        agent: typeof info?.agent === "string" ? info.agent : null,
        agentSession:
          session &&
          typeof session.source === "string" &&
          typeof session.agent === "string" &&
          typeof session.kind === "string" &&
          typeof session.value === "string"
            ? {
                source: session.source,
                agent: session.agent,
                kind: session.kind,
                value: session.value,
              }
            : null,
      });
    }
    return summaries;
  }

  /**
   * Report one pane's agent session identity (`pane.report_agent_session`).
   * Herdr persists the pane's `agent_session` — the only record its UI
   * treats as "an agent lives here" — when the report carries
   * `session_start_source`; reports without it are accepted but never
   * persisted (herdr 0.8.2, verified live). False when herdr is unreachable
   * (fail-observer: the caller retries on its next tick).
   */
  async reportAgentSession(report: {
    paneId: string;
    source: string;
    agent: string;
    agentSessionId: string;
    sessionStartSource: string;
    seq: number;
  }): Promise<boolean> {
    try {
      await this.#request("pane.report_agent_session", {
        pane_id: report.paneId,
        source: report.source,
        agent: report.agent,
        agent_session_id: report.agentSessionId,
        session_start_source: report.sessionStartSource,
        seq: report.seq,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Tear down the socket (composition-root shutdown). */
  close(): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("herdr pane source closed"));
    }
    this.#pending.clear();
    this.#socket?.destroy();
    this.#socket = null;
    this.#connectPromise = null;
  }

  // ——— socket plumbing ———

  async #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    try {
      await this.#ensureConnected();
    } catch {
      this.#dropSocket();
      throw new Error("herdr socket unavailable");
    }
    const socket = this.#socket;
    if (socket === null) throw new Error("herdr socket unavailable");
    const id = `pane-${this.#nextId}`;
    this.#nextId += 1;
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        this.#dropSocket(); // a timed-out socket is untrustworthy
        reject(new Error(`herdr request timed out: ${method}`));
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      socket.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) {
          this.#pending.delete(id);
          clearTimeout(timer);
          this.#dropSocket();
          reject(error);
        }
      });
    });
  }

  #ensureConnected(): Promise<void> {
    if (this.#socket !== null) return Promise.resolve();
    if (this.#connectPromise !== null) return this.#connectPromise;
    this.#connectPromise = new Promise<void>((resolve, reject) => {
      const socket = connect(this.#socketPath);
      const timer = setTimeout(() => {
        socket.destroy();
        this.#connectPromise = null;
        reject(new Error("herdr socket connect timed out"));
      }, this.#requestTimeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => this.#onData(chunk));
        socket.once("error", () => this.#dropSocket());
        socket.once("close", () => {
          this.#socket = null;
          this.#failAllPending(new Error("herdr socket closed"));
        });
        this.#socket = socket;
        this.#connectPromise = null;
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        this.#connectPromise = null;
        reject(error);
      });
    });
    return this.#connectPromise;
  }

  #onData(chunk: string): void {
    this.#buffer += chunk;
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline === -1) break;
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let message: {
        id?: unknown;
        result?: unknown;
        error?: { code?: unknown; message?: unknown };
      };
      try {
        message = JSON.parse(line);
      } catch {
        continue; // junk line: ignore, the request times out if unmatched
      }
      if (typeof message.id !== "string") continue;
      const pending = this.#pending.get(message.id);
      if (pending === undefined) continue;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      // herdr 0.8.2 serves ONE request per connection and closes the socket
      // after the response (verified live: a second request on the same
      // connection hits a broken pipe, and a report written into the closing
      // socket is accepted-then-dropped). Drop proactively so every request
      // opens a fresh connection instead of racing the server's close.
      this.#dropSocket();
      if (message.error !== undefined) {
        pending.reject(
          new Error(
            `herdr error: ${String(message.error.message ?? message.error.code ?? "unknown")}`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
    }
  }

  #failAllPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #dropSocket(): void {
    this.#socket?.destroy();
    this.#socket = null;
  }
}

function taskIdFromLabel(label: string | null | undefined): string | null {
  if (typeof label !== "string" || !label.startsWith(MIRROR_LABEL_PREFIX)) return null;
  const taskId = label.slice(MIRROR_LABEL_PREFIX.length);
  return taskId.length > 0 ? taskId : null;
}

function stateFromAgentStatus(status: HerdrAgentStatus | undefined): RemotePaneSummary["state"] {
  switch (status) {
    case "working":
      return "active";
    case "idle":
      return "idle";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    default:
      return "unknown"; // no confident streaming source → app renders lifecycle-only
  }
}

// ——— herdr surface port (rebuild brief §4) ————————————————————————————————
// Everything below maps herdr protocol-22 shapes into gateway vocabulary.
// Surface handlers must not re-derive any of it (single-protocol-file rule).

/** herdr's own five-state agent lifecycle; the app speaks these verbatim. */
export type HerdrAgentState = "idle" | "working" | "blocked" | "done" | "unknown";

export type HerdrWorkspaceView = {
  id: string;
  label: string;
  number: number;
  tabCount: number;
  paneCount: number;
  activeTabId: string;
  focused: boolean;
  status: HerdrAgentState;
};

export type HerdrTabView = {
  id: string;
  workspaceId: string;
  label: string;
  number: number;
  focused: boolean;
  paneCount: number;
};

export type HerdrPaneView = {
  id: string;
  workspaceId: string;
  tabId: string;
  /** Stripped terminal title (the app-facing display title). */
  title: string | null;
  status: HerdrAgentState;
  /** Detected/managed agent kind occupying the pane (e.g. "claude", "agy"). */
  agent: string | null;
  cwd: string | null;
  /** Decimal string (u64 rule). */
  revision: string;
  focused: boolean;
  /** herdr's agent_session record for the pane (integration-reported session
   * id/path) — the conversation adapter's deterministic key. Null when the
   * integration hasn't reported one. */
  agentSession: { kind: string; value: string } | null;
};

export type HerdrSnapshotView = {
  serverVersion: string;
  protocol: number;
  focused: { workspaceId: string | null; tabId: string | null; paneId: string | null };
  workspaces: HerdrWorkspaceView[];
  tabs: HerdrTabView[];
  panes: HerdrPaneView[];
};

/** Subscription feed, collapsed to the two signals the surface needs:
 * structural change (re-snapshot) and one pane's agent-state transition. */
export type HerdrSurfaceEvent =
  | { kind: "structure" }
  | { kind: "pane_state"; paneId: string; status: HerdrAgentState };

export type HerdrPaneReading = {
  paneId: string;
  revision: string;
  text: string;
  truncated: boolean;
};

export type HerdrReadOptions = {
  lines: number;
  /** herdr read source; the surface whitelist is enforced here so routes
   * never carry herdr wire literals (single-protocol-file rule). */
  source: HerdrReadSource;
  /** "ansi" keeps styling evidence; "text" is the plain fallback. */
  format: "text" | "ansi";
};

export type HerdrReadSource = "visible" | "recent" | "recent_unwrapped";

/** Route-facing whitelist for the read source query parameter. */
export const HERDR_READ_SOURCES: readonly HerdrReadSource[] = [
  "visible",
  "recent",
  "recent_unwrapped",
];

/** Route default for the read source query parameter. */
export const HERDR_DEFAULT_READ_SOURCE: HerdrReadSource = "recent_unwrapped";

export type HerdrAgentStartSpec = {
  kind: string;
  paneId: string;
  name?: string | null;
  args?: string[] | null;
  timeoutMs?: number | null;
};

export type HerdrAgentStartOutcome =
  | { ok: true; paneId: string; name: string | null; ready: boolean }
  | { ok: false; reason: "unavailable" | "rejected"; code: string | null; message: string | null };

export type HerdrWorkspaceCreated = {
  workspaceId: string;
  tabId: string;
  rootPaneId: string;
};

export type HerdrIntegrationInfo = {
  target: string;
  label: string;
  command: string;
  available: boolean;
  state: "not_installed" | "current" | "outdated";
};

export type HerdrPromptOutcome = "accepted" | "blocked" | "not_found" | "unavailable";

/** One herdr error crossing, classified for the surface routes. */
export type HerdrCallError = {
  code: string | null;
  message: string;
};

function herdrError(error: unknown): HerdrCallError {
  const text = error instanceof Error ? error.message : String(error);
  const match = /herdr error: (.+)$/.exec(text);
  const detail = match?.[1] ?? text;
  // herdr error lines carry the server message; well-known codes appear in it.
  if (detail.includes("agent_blocked")) return { code: "agent_blocked", message: detail };
  if (detail.includes("agent_not_found")) return { code: "agent_not_found", message: detail };
  if (detail.includes("pane_not_found")) return { code: "pane_not_found", message: detail };
  if (detail.includes("agent_not_ready")) return { code: "agent_not_ready", message: detail };
  if (detail.includes("workspace_not_found"))
    return { code: "workspace_not_found", message: detail };
  if (detail.includes("tab_not_found")) return { code: "tab_not_found", message: detail };
  return { code: null, message: detail };
}

/** herdr serves ONE request per connection (verified live) — open, write,
 * await the matching response, drop. Concurrency-safe by construction. */
function herdrSingleRequest(
  socketPath: string,
  timeoutMs: number,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`herdr request timed out: ${method}`))),
      timeoutMs,
    );
    socket.on("connect", () => {
      socket.setEncoding("utf8");
      socket.write(`${JSON.stringify({ id: "herdr-surface", method, params })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length === 0) continue;
        let message: {
          id?: unknown;
          result?: unknown;
          error?: { code?: unknown; message?: unknown };
        };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id !== "herdr-surface") continue;
        if (message.error !== undefined) {
          const code = typeof message.error.code === "string" ? message.error.code : null;
          const text =
            typeof message.error.message === "string" ? message.error.message : (code ?? "unknown");
          finish(() => reject(new Error(`herdr error: ${code ?? ""} ${text}`.trim())));
        } else {
          finish(() => resolve(message.result));
        }
        return;
      }
    });
    socket.on("error", (error) => finish(() => reject(error)));
    socket.on("close", () =>
      finish(() => reject(new Error("herdr socket closed before response"))),
    );
  });
}

type HerdrSurfaceOptions = {
  socketPath?: string;
  requestTimeoutMs?: number;
  /** Reconnect backoff floor/ceiling for the subscription feed. */
  reconnectMs?: number;
  reconnectMaxMs?: number;
};

export type HerdrSubscription = {
  stop(): void;
  /** Drop the feed connection; it reopens (and re-reads `paneIds`). */
  restart(): void;
};

export class HerdrControlClient {
  readonly #socketPath: string;
  readonly #requestTimeoutMs: number;
  readonly #reconnectMs: number;
  readonly #reconnectMaxMs: number;

  constructor(options: HerdrSurfaceOptions = {}) {
    this.#socketPath = options.socketPath ?? defaultHerdrSocketPath();
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
    this.#reconnectMs = options.reconnectMs ?? 1_000;
    this.#reconnectMaxMs = options.reconnectMaxMs ?? 10_000;
  }

  async #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return await herdrSingleRequest(this.#socketPath, this.#requestTimeoutMs, method, params);
  }

  async #try<T>(run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch {
      return null;
    }
  }

  /** Full live session state; null when herdr is unreachable or the response
   * shape drifts (fail-closed: the monitor reports `{available:false}`). */
  async snapshot(): Promise<HerdrSnapshotView | null> {
    const result = await this.#try(() => this.#request("session.snapshot", {}));
    if (result === null || typeof result !== "object") return null;
    const snapshot = (result as { snapshot?: unknown }).snapshot;
    if (snapshot === null || typeof snapshot !== "object") return null;
    const raw = snapshot as {
      version?: unknown;
      protocol?: unknown;
      focused_workspace_id?: unknown;
      focused_tab_id?: unknown;
      focused_pane_id?: unknown;
      workspaces?: unknown;
      tabs?: unknown;
      panes?: unknown;
    };
    if (typeof raw.version !== "string" || typeof raw.protocol !== "number") return null;
    const workspaces = mapEach(raw.workspaces, mapWorkspace);
    const tabs = mapEach(raw.tabs, mapTab);
    const panes = mapEach(raw.panes, mapPane);
    if (workspaces === null || tabs === null || panes === null) return null;
    return {
      serverVersion: raw.version,
      protocol: raw.protocol,
      focused: {
        workspaceId: stringOrNull(raw.focused_workspace_id),
        tabId: stringOrNull(raw.focused_tab_id),
        paneId: stringOrNull(raw.focused_pane_id),
      },
      workspaces,
      tabs,
      panes,
    };
  }

  /** One pane read with surface options; null when gone/unreachable. */
  async readPane(paneId: string, options: HerdrReadOptions): Promise<HerdrPaneReading | null> {
    const result = await this.#try(() =>
      this.#request("pane.read", {
        pane_id: paneId,
        source: options.source,
        lines: options.lines,
        format: options.format,
        strip_ansi: options.format === "text",
      }),
    );
    if (result === null || typeof result !== "object") return null;
    const read = (result as { read?: unknown }).read;
    if (read === null || typeof read !== "object") return null;
    const raw = read as {
      pane_id?: unknown;
      revision?: unknown;
      text?: unknown;
      truncated?: unknown;
    };
    if (
      typeof raw.pane_id !== "string" ||
      typeof raw.revision !== "number" ||
      !Number.isSafeInteger(raw.revision) ||
      raw.revision < 0 ||
      typeof raw.text !== "string" ||
      typeof raw.truncated !== "boolean"
    ) {
      return null;
    }
    return {
      paneId: raw.pane_id,
      revision: raw.revision.toString(10),
      text: raw.text,
      truncated: raw.truncated,
    };
  }

  /** Submit a prompt to the agent occupying a pane (pane id is a valid
   * agent target). Delivery only — the caller observes state via the feed. */
  async promptAgent(paneId: string, text: string): Promise<HerdrPromptOutcome> {
    try {
      await this.#request("agent.prompt", { target: paneId, text });
      return "accepted";
    } catch (error) {
      const classified = herdrError(error);
      if (classified.code === "agent_blocked") return "blocked";
      if (classified.code === "agent_not_found" || classified.code === "pane_not_found") {
        return "not_found";
      }
      return "unavailable";
    }
  }

  /** Logical keys into the pane's agent (e.g. ["esc"], ["ctrl+c"]). */
  async sendAgentKeys(paneId: string, keys: string[]): Promise<boolean> {
    return (
      (await this.#try(async () => {
        await this.#request("agent.send_keys", { target: paneId, keys });
        return true;
      })) ?? false
    );
  }

  /** Bring the pane to the foreground on the desktop (pane.focus). */
  async focusPane(paneId: string): Promise<boolean> {
    return (
      (await this.#try(async () => {
        await this.#request("pane.focus", { pane_id: paneId });
        return true;
      })) ?? false
    );
  }

  /** Start a supported agent in an existing available pane. herdr validates
   * agent identity and readiness; `agent_not_ready` still returns the pane
   * (the agent is starting — callers keep observing). */
  async startAgent(spec: HerdrAgentStartSpec): Promise<HerdrAgentStartOutcome> {
    try {
      const result = await this.#request("agent.start", {
        // `name` is a REQUIRED string in the herdr schema — omit it when the
        // caller gave none (a null would fail validation as invalid_request).
        ...(spec.name === null || spec.name === undefined ? {} : { name: spec.name }),
        kind: spec.kind,
        pane_id: spec.paneId,
        ...(spec.args === null || spec.args === undefined ? {} : { args: spec.args }),
        ...(spec.timeoutMs === null || spec.timeoutMs === undefined
          ? {}
          : { timeout_ms: spec.timeoutMs }),
      });
      const mapped = mapAgentStart(result, spec.paneId);
      return mapped ?? { ok: true, paneId: spec.paneId, name: spec.name ?? null, ready: true };
    } catch (error) {
      const classified = herdrError(error);
      if (classified.code === "agent_not_ready") {
        return { ok: true, paneId: spec.paneId, name: spec.name ?? null, ready: false };
      }
      return {
        ok: false,
        reason: "rejected",
        code: classified.code,
        message: classified.message,
      };
    }
  }

  /** Create a workspace (returns its root tab and pane). */
  async createWorkspace(
    label: string | null,
    cwd?: string | null,
  ): Promise<HerdrWorkspaceCreated | null> {
    const result = await this.#try(() =>
      this.#request("workspace.create", { label, ...(cwd ? { cwd } : {}) }),
    );
    if (result === null || typeof result !== "object") return null;
    const raw = result as {
      workspace?: { workspace_id?: unknown } | null;
      tab?: { tab_id?: unknown } | null;
      root_pane?: { pane_id?: unknown } | null;
    };
    const workspaceId = raw.workspace?.workspace_id;
    const tabId = raw.tab?.tab_id;
    const rootPaneId = raw.root_pane?.pane_id;
    if (
      typeof workspaceId !== "string" ||
      typeof tabId !== "string" ||
      typeof rootPaneId !== "string"
    ) {
      return null;
    }
    return { workspaceId, tabId, rootPaneId };
  }

  /** Split one pane (agent start falls back to this when a tab has no
   * available shell pane). Returns the new pane id. */
  async splitPane(
    paneId: string,
    options: { direction: "right" | "down"; cwd?: string | null; focus?: boolean },
  ): Promise<string | null> {
    const result = await this.#try(() =>
      this.#request("pane.split", {
        target_pane_id: paneId,
        direction: options.direction,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        focus: options.focus ?? false,
      }),
    );
    if (result === null || typeof result !== "object") return null;
    const raw = result as { pane?: { pane_id?: unknown } | null; move_result?: unknown };
    const paneIdOut = raw.pane?.pane_id;
    return typeof paneIdOut === "string" ? paneIdOut : null;
  }

  /** Installed agent integrations (drives the app's kind picker). */
  async listIntegrations(): Promise<HerdrIntegrationInfo[] | null> {
    const result = await this.#try(() => this.#request("integration.list", {}));
    if (result === null || typeof result !== "object") return null;
    const list = (result as { integrations?: unknown }).integrations;
    if (!Array.isArray(list)) return null;
    const out: HerdrIntegrationInfo[] = [];
    for (const entry of list) {
      if (entry === null || typeof entry !== "object") continue;
      const raw = entry as {
        target?: unknown;
        label?: unknown;
        command?: unknown;
        available?: unknown;
        state?: unknown;
      };
      if (
        typeof raw.target !== "string" ||
        typeof raw.label !== "string" ||
        typeof raw.command !== "string" ||
        typeof raw.available !== "boolean" ||
        (raw.state !== "not_installed" && raw.state !== "current" && raw.state !== "outdated")
      ) {
        continue; // skip drifted entries, never reject the whole list
      }
      out.push({
        target: raw.target,
        label: raw.label,
        command: raw.command,
        available: raw.available,
        state: raw.state,
      });
    }
    return out;
  }

  /** Long-lived subscription feed. herdr pushes `{"event", "data"}` frames on
   * the subscription connection (verified live); the connection is re-opened
   * with backoff and the subscription re-sent after any close. Per-pane state
   * subscriptions are pane-addressed in herdr, so the pane set is read fresh
   * from `paneIds` on every (re)connect, and `restart()` re-opens the feed
   * when the pane set changes (the caller learns that from structure events). */
  subscribe(
    paneIds: () => string[],
    onEvent: (event: HerdrSurfaceEvent) => void,
    onError?: (error: Error) => void,
  ): HerdrSubscription {
    let stopped = false;
    let socket: ReturnType<typeof connect> | null = null;
    let attempt = 0;
    let buffer = "";
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const open = (): void => {
      if (stopped) return;
      const sock = connect(this.#socketPath);
      socket = sock;
      sock.setEncoding("utf8");
      sock.on("connect", () => {
        attempt = 0;
        const subscriptions: Array<Record<string, string>> = [
          ...[
            "workspace.created",
            "workspace.updated",
            "workspace.metadata_updated",
            "workspace.renamed",
            "workspace.reordered",
            "workspace.closed",
            "workspace.focused",
            "tab.created",
            "tab.closed",
            "tab.focused",
            "tab.renamed",
            "tab.moved",
            "pane.created",
            "pane.closed",
            "pane.updated",
            "pane.focused",
            "pane.moved",
            "pane.exited",
            "pane.agent_detected",
            "layout.updated",
          ].map((type) => ({ type })),
          ...paneIds().flatMap((paneId) => [
            { type: "pane.agent_status_changed", pane_id: paneId },
          ]),
        ];
        sock.write(
          `${JSON.stringify({ id: "herdr-feed", method: "events.subscribe", params: { subscriptions } })}\n`,
        );
      });
      sock.on("data", (chunk: string) => {
        buffer += chunk;
        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline === -1) break;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line.length === 0) continue;
          let message: { id?: unknown; result?: unknown; event?: unknown; data?: unknown };
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          // Response frames carry `id`; pushed frames carry `event`/`data`.
          if (message.id !== undefined) continue;
          const event = mapSurfaceEvent(message.event, message.data);
          if (event !== null) onEvent(event);
        }
      });
      sock.on("error", (error) => onError?.(error));
      sock.on("close", () => {
        if (socket === sock) socket = null;
        if (stopped) return;
        const delay = Math.min(this.#reconnectMs * 2 ** attempt, this.#reconnectMaxMs);
        attempt += 1;
        reconnectTimer = setTimeout(open, delay);
      });
    };

    open();
    return {
      stop: () => {
        stopped = true;
        if (reconnectTimer !== null) clearTimeout(reconnectTimer);
        socket?.destroy();
        socket = null;
      },
      restart: () => {
        if (stopped || socket === null) return;
        socket.destroy(); // the close handler schedules the reopen
        socket = null;
      },
    };
  }

  close(): void {}
}

// ——— herdr protocol-22 mappers (boundary-private) ————————————————————————

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function agentStateOrUnknown(value: unknown): HerdrAgentState {
  return value === "idle" || value === "working" || value === "blocked" || value === "done"
    ? value
    : "unknown";
}

function mapEach<T>(value: unknown, map: (entry: Record<string, unknown>) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") return null;
    const mapped = map(entry as Record<string, unknown>);
    if (mapped === null) return null; // shape drift: fail closed
    out.push(mapped);
  }
  return out;
}

function mapWorkspace(entry: Record<string, unknown>): HerdrWorkspaceView | null {
  const id = entry.workspace_id;
  const activeTabId = entry.active_tab_id;
  if (typeof id !== "string" || typeof activeTabId !== "string") return null;
  return {
    id,
    label: typeof entry.label === "string" ? entry.label : "",
    number: typeof entry.number === "number" ? entry.number : 0,
    tabCount: typeof entry.tab_count === "number" ? entry.tab_count : 0,
    paneCount: typeof entry.pane_count === "number" ? entry.pane_count : 0,
    activeTabId,
    focused: entry.focused === true,
    status: agentStateOrUnknown(entry.agent_status),
  };
}

function mapTab(entry: Record<string, unknown>): HerdrTabView | null {
  const id = entry.tab_id;
  const workspaceId = entry.workspace_id;
  if (typeof id !== "string" || typeof workspaceId !== "string") return null;
  return {
    id,
    workspaceId,
    label: typeof entry.label === "string" ? entry.label : "",
    number: typeof entry.number === "number" ? entry.number : 0,
    focused: entry.focused === true,
    paneCount: typeof entry.pane_count === "number" ? entry.pane_count : 0,
  };
}

function mapPane(entry: Record<string, unknown>): HerdrPaneView | null {
  const id = entry.pane_id;
  const workspaceId = entry.workspace_id;
  const tabId = entry.tab_id;
  if (typeof id !== "string" || typeof workspaceId !== "string" || typeof tabId !== "string")
    return null;
  const revision = entry.revision;
  return {
    id,
    workspaceId,
    tabId,
    title: stringOrNull(entry.terminal_title_stripped) ?? stringOrNull(entry.terminal_title),
    status: agentStateOrUnknown(entry.agent_status),
    agent: stringOrNull(entry.agent),
    cwd: stringOrNull(entry.cwd),
    revision:
      typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
        ? revision.toString(10)
        : "0",
    focused: entry.focused === true,
    agentSession: mapAgentSession(entry.agent_session),
  };
}

/** herdr's agent_session passthrough (kind "id"|"path", opaque value). */
function mapAgentSession(value: unknown): { kind: string; value: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  const v = record.value;
  if (typeof kind !== "string" || typeof v !== "string" || v.length === 0) return null;
  return { kind, value: v };
}

function mapAgentStart(result: unknown, fallbackPaneId: string): HerdrAgentStartOutcome | null {
  if (result === null || typeof result !== "object") return null;
  const raw = result as {
    pane?: { pane_id?: unknown } | null;
    agent?: { name?: unknown; pane_id?: unknown } | string | null;
    ready?: unknown;
  };
  const paneId = typeof raw.pane?.pane_id === "string" ? raw.pane.pane_id : fallbackPaneId;
  const name =
    typeof raw.agent === "string"
      ? raw.agent
      : typeof raw.agent?.name === "string"
        ? raw.agent.name
        : null;
  return { ok: true, paneId, name, ready: raw.ready !== false };
}

function mapSurfaceEvent(event: unknown, data: unknown): HerdrSurfaceEvent | null {
  if (typeof event !== "string") return null;
  if (event === "pane.agent_status_changed") {
    if (data === null || typeof data !== "object") return null;
    const raw = data as { pane_id?: unknown; agent_status?: unknown };
    if (typeof raw.pane_id !== "string") return null;
    return {
      kind: "pane_state",
      paneId: raw.pane_id,
      status: agentStateOrUnknown(raw.agent_status),
    };
  }
  if (
    event.startsWith("workspace.") ||
    event.startsWith("tab.") ||
    event.startsWith("pane.") ||
    event.startsWith("worktree.") ||
    event === "layout.updated"
  ) {
    return { kind: "structure" };
  }
  return null;
}
