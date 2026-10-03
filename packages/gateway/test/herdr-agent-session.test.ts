/**
 * Herdr agent-session registration (fix: Loop workers never appeared in
 * Herdr's agent UI). Root cause: Herdr 0.8.2 lists an agent only when its
 * pane carries an `agent_session` record, and that record is written ONLY
 * when `pane.report_agent_session` (with `session_start_source`) arrives on
 * the herdr socket from the agent side. Loop's managed worker agents
 (`herdr agent start` → names prefixed `loop-`) never report one — the
 * herdr pi-side integration is not installed and the CLI verb is a silent
 * no-op — so worker panes stay invisible.
 *
 * The fix: the gateway (which already owns the only herdr socket client)
 * reconciles Loop-managed agents on a tick: any `loop-`-prefixed agent
 * without an `agent_session` gets one reported over the socket, keyed by the
 * herdr agent name (Loop's stable worker identity — the same name every
 * `agent prompt`/`agent read` addresses).
 *
 * Gates mirrored from the pane-boundary suite:
 * 1. herdr socket protocol knowledge stays confined to herdr-pane-source.ts
 *    (the registrar consumes a port, never the socket).
 * 2. Failure isolation: an unreachable herdr degrades to "no reports" and
 *    never throws out of a tick (fail-observer, PaneMirror precedent).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import { HerdrPaneSource, type HerdrAgentSummary } from "../src/herdr-pane-source";
import {
  AGENT_SESSION_SOURCE,
  AGENT_SESSION_START_SOURCE,
  LOOP_AGENT_NAME_PREFIX,
  type AgentSessionReport,
  type HerdrAgentInventoryPort,
  HerdrAgentSessionRegistrar,
} from "../src/herdr-agent-session";

// ——— Fake port (registrar core; deterministic, no sockets) ———

class FakeInventoryPort implements HerdrAgentInventoryPort {
  agents: HerdrAgentSummary[] | null = [];
  reports: AgentSessionReport[] = [];
  failReports = false;

  async listAgents(): Promise<HerdrAgentSummary[] | null> {
    return this.agents;
  }

  async reportAgentSession(report: AgentSessionReport): Promise<boolean> {
    if (this.failReports) return false;
    this.reports.push(report);
    return true;
  }
}

/** Port-shaped (post-adapter) agent inventory entry. */
function loopAgent(overrides: Partial<HerdrAgentSummary> = {}): HerdrAgentSummary {
  return {
    name: "loop-loop-0207f6a8-ad7b-192df734",
    paneId: "w1:p15",
    agent: "pi",
    agentSession: null,
    ...overrides,
  };
}

/** Wire-shaped `agent.list` entry (pre-adapter; snake_case herdr fields). */
function wireAgent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "loop-loop-0207f6a8-ad7b-192df734",
    pane_id: "w1:p15",
    agent: "pi",
    agent_status: "working",
    ...overrides,
  };
}

describe("HerdrAgentSessionRegistrar core", () => {
  test("reports agent_session for Loop-managed agents that lack one", async () => {
    const port = new FakeInventoryPort();
    port.agents = [
      loopAgent(),
      loopAgent({ name: "loop-loop-839f30e4-33c6-ab93553c", paneId: "w1:p17" }),
    ];
    const registrar = new HerdrAgentSessionRegistrar({ port });
    await registrar.tick();
    expect(port.reports).toHaveLength(2);
    const first = port.reports[0]!;
    expect(first.paneId).toBe("w1:p15");
    expect(first.agent).toBe("pi");
    expect(first.agentSessionId).toBe("loop-loop-0207f6a8-ad7b-192df734");
    expect(first.source).toBe(AGENT_SESSION_SOURCE);
    expect(first.sessionStartSource).toBe(AGENT_SESSION_START_SOURCE);
    expect(Number.isInteger(first.seq)).toBe(true);
    // seq advances monotonically across reports (herdr upserts by source).
    expect(port.reports[1]!.seq).toBeGreaterThan(first.seq);
  });

  test("skips agents without the Loop prefix and agents already carrying a session", async () => {
    const port = new FakeInventoryPort();
    port.agents = [
      loopAgent({ name: "operator-lead", paneId: "w1:p2" }),
      loopAgent({
        paneId: "w1:p2",
        agent: "codex",
        agentSession: { source: "herdr:codex", agent: "codex", kind: "id", value: "01a0e17d" },
      }),
      loopAgent({ agentSession: { source: "herdr:pi", agent: "pi", kind: "id", value: "loop-x" } }),
    ];
    const registrar = new HerdrAgentSessionRegistrar({ port });
    await registrar.tick();
    expect(port.reports).toHaveLength(0);
  });

  test("skips malformed entries (missing name or pane) and unknown inventory", async () => {
    const port = new FakeInventoryPort();
    port.agents = [loopAgent({ name: "" }), loopAgent({ name: "loop-ok", paneId: "" })];
    const registrar = new HerdrAgentSessionRegistrar({ port });
    await registrar.tick();
    expect(port.reports).toHaveLength(0);

    port.agents = null; // herdr unreachable / shape drift
    await registrar.tick();
    expect(port.reports).toHaveLength(0);
  });

  test("a failed report never throws out of a tick and retries next tick", async () => {
    const port = new FakeInventoryPort();
    port.agents = [loopAgent()];
    port.failReports = true;
    const registrar = new HerdrAgentSessionRegistrar({ port });
    await registrar.tick();
    expect(port.reports).toHaveLength(0);
    port.failReports = false;
    await registrar.tick();
    expect(port.reports).toHaveLength(1);
  });

  test("a throwing listAgents never throws out of a tick", async () => {
    const registrar = new HerdrAgentSessionRegistrar({
      port: {
        listAgents: () => Promise.reject(new Error("socket exploded")),
        reportAgentSession: () => Promise.resolve(true),
      },
    });
    await registrar.tick(); // must not reject
  });
});

// ——— Adapter protocol (real unix socket; the single herdr-protocol file) ———

describe("HerdrPaneSource agent-session protocol", () => {
  let socketPath: string;
  let requests: { id: string; method: string; params: Record<string, unknown> }[] = [];
  let responder: (method: string, params: Record<string, unknown>) => unknown;
  let server: Bun.TCPSocketListener<unknown> | Bun.UnixSocketListener<unknown> | null = null;

  beforeAll(async () => {
    socketPath = join(await mkdtemp(join(tmpdir(), "herdr-agent-session-")), "herdr.sock");
    server = Bun.listen<unknown>({
      unix: socketPath,
      socket: {
        open(socket) {
          socket.data = { buffer: "" };
        },
        data(socket, chunk) {
          let buffer: string = ((socket.data as { buffer?: string }).buffer ?? "") + String(chunk);
          for (;;) {
            const newline = buffer.indexOf("\n");
            if (newline === -1) break;
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            (socket.data as { buffer: string }).buffer = buffer;
            let parsed: { id: string; method: string; params: Record<string, unknown> };
            try {
              parsed = JSON.parse(line);
            } catch {
              continue;
            }
            requests.push(parsed);
            const result = responder(parsed.method, parsed.params);
            socket.write(`${JSON.stringify({ id: parsed.id, result })}\n`);
          }
        },
        error() {},
      },
    });
    responder = () => ({});
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("listAgents speaks agent.list and maps the agents array with session passthrough", async () => {
    requests = [];
    responder = (method) => {
      expect(method).toBe("agent.list");
      return {
        type: "agent_list",
        agents: [
          wireAgent(),
          wireAgent({
            name: "loop-with-session",
            pane_id: "w1:p16",
            agent_session: {
              source: "herdr:pi",
              agent: "pi",
              kind: "id",
              value: "loop-with-session",
            },
          }),
        ],
      };
    };
    const source = new HerdrPaneSource({ socketPath });
    try {
      const agents = await source.listAgents();
      expect(agents).not.toBeNull();
      expect(agents).toHaveLength(2);
      expect(agents![0]).toEqual({
        name: "loop-loop-0207f6a8-ad7b-192df734",
        paneId: "w1:p15",
        agent: "pi",
        agentSession: null,
      });
      expect(agents![1]!.agentSession).toEqual({
        source: "herdr:pi",
        agent: "pi",
        kind: "id",
        value: "loop-with-session",
      });
      expect(requests).toHaveLength(1);
    } finally {
      source.close();
    }
  });

  test("listAgents fails closed to null on protocol drift and transport errors", async () => {
    const source = new HerdrPaneSource({
      socketPath: join(tmpdir(), "herdr-agent-session-missing.sock"),
    });
    try {
      await expect(source.listAgents()).resolves.toBeNull();
    } finally {
      source.close();
    }

    requests = [];
    responder = () => ({ nope: true }); // shape drift: no agents array
    const driftSource = new HerdrPaneSource({ socketPath });
    try {
      await expect(driftSource.listAgents()).resolves.toBeNull();
    } finally {
      driftSource.close();
    }
  });

  test("reportAgentSession speaks pane.report_agent_session with the session-start marker", async () => {
    requests = [];
    responder = (method, params) => {
      expect(method).toBe("pane.report_agent_session");
      expect(params.pane_id).toBe("w1:p15");
      expect(params.source).toBe(AGENT_SESSION_SOURCE);
      expect(params.agent).toBe("pi");
      expect(params.agent_session_id).toBe("loop-loop-0207f6a8-ad7b-192df734");
      expect(params.session_start_source).toBe(AGENT_SESSION_START_SOURCE);
      expect(typeof params.seq).toBe("number");
      return { type: "ok" };
    };
    const source = new HerdrPaneSource({ socketPath });
    try {
      const delivered = await source.reportAgentSession({
        paneId: "w1:p15",
        agent: "pi",
        agentSessionId: "loop-loop-0207f6a8-ad7b-192df734",
        source: AGENT_SESSION_SOURCE,
        sessionStartSource: AGENT_SESSION_START_SOURCE,
        seq: 1,
      });
      expect(delivered).toBe(true);
      expect(requests).toHaveLength(1);
    } finally {
      source.close();
    }
  });

  test("reportAgentSession fails closed to false on transport errors", async () => {
    const source = new HerdrPaneSource({
      socketPath: join(tmpdir(), "herdr-agent-session-missing.sock"),
    });
    try {
      const delivered = await source.reportAgentSession({
        paneId: "w1:p15",
        agent: "pi",
        agentSessionId: "loop-x",
        source: AGENT_SESSION_SOURCE,
        sessionStartSource: AGENT_SESSION_START_SOURCE,
        seq: 2,
      });
      expect(delivered).toBe(false);
    } finally {
      source.close();
    }
  });

  test("the registrar module never speaks the herdr socket protocol itself", async () => {
    const raw = await readFile(join(import.meta.dir, "../src/herdr-agent-session.ts"), "utf8");
    // Code-level gate (comment prose may explain the boundary it relies on).
    const source = raw
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(source).not.toMatch(/node:net/);
    expect(source).not.toContain("agent.list");
    expect(source).not.toContain('"pane.report_agent_session"');
    expect(source).toContain(LOOP_AGENT_NAME_PREFIX);
  });
});
