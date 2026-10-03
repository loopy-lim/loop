/**
 * Herdr socket pane source — the ONLY module in this package that knows the
 * herdr socket API (decision 2026-xx-terminal-mirror D2). It implements the
 * herdr-agnostic `PaneObservationPort` over the herdr 0.8.x socket protocol
 * (pinned: protocol 20) so the rest of the gateway stays port-shaped.
 *
 * Semantics (fail-closed):
 * - Any connect/read/timeout/protocol failure → `null` from the port → the
 *   pane mirror renders an empty inventory and no streams. The machine path
 *   (herdr CLI adapter, workers) is never touched.
 * - Revision polling: `pane.list` for inventory + `pane.read` per pane; the
 *   pane's monotonic `revision` is the change hook (S1 in decision D2).
 * - The wire `revision` (uint64) crosses this boundary as a DECIMAL STRING
 *   (ADR §4.1 u64 rule).
 *
 * Not here: pane event frames, SSE, cursors, redaction — those belong to the
 * gateway's mirror/log layers. Relocation note: this module is destined for
 * `@loop/herdr` once that package's write scope opens; until then the
 * pane-boundary test pins it as this package's single herdr-protocol file.
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
