/**
 * Herdr surface contract (rebuild brief
 * docs/design/rebuild-brief-herdr-first.md §4/M1). Every case runs against a
 * fake herdr unix socket speaking the protocol-22 subset the adapter uses:
 * no real herdr, no paid model calls. Covered: state mapping (revision u64
 * decimal-string rule), SSE state feed intro + push convergence, read
 * parameter passthrough, prompt blocked/not-found mapping, key delivery,
 * start orchestration (shell pane vs split fallback, rejections), workspace
 * creation, integration inventory, and fail-closed degradation when herdr is
 * unreachable.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { claudeProjectDirName } from "../src/agent-sessions";
import { authHeader, bootTestGateway, type TestGateway } from "./helpers";
import {
  HerdrControlClient,
  HerdrPaneSource,
  notePaneBirth,
  paneBirthMs,
} from "../src/herdr-pane-source";

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

// ——— fake herdr unix socket ————————————————————————————————————————————————

type JsonRecord = Record<string, unknown>;

type FakeHerdr = {
  path: string;
  setSnapshot: (snapshot: JsonRecord) => void;
  calls: { method: string; params: JsonRecord }[];
  subscribeCalls: { id: string; params: JsonRecord }[];
  respond: (method: string, response: (params: JsonRecord) => JsonRecord) => void;
  push: (frame: JsonRecord) => void;
  subscriberCount: () => number;
  close: () => Promise<void>;
};

function startFakeHerdrSocket(initialSnapshot: JsonRecord): FakeHerdr {
  const dir = join(
    tmpdir(),
    `loop-gateway-herdr-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  const socketPath = join(dir, "herdr.sock");
  const calls: { method: string; params: JsonRecord }[] = [];
  const subscribeCalls: { id: string; params: JsonRecord }[] = [];
  const responders = new Map<string, (params: JsonRecord) => JsonRecord>();
  const subscribers = new Set<{ write(bytes: string): void }>();
  let snapshot = initialSnapshot;

  const server = Bun.listen({
    unix: socketPath,
    socket: {
      open() {},
      data(_socket, bytes) {
        const text = String(bytes);
        for (const line of text.split("\n")) {
          if (line.trim().length === 0) continue;
          let message: { id?: unknown; method?: unknown; params?: unknown };
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (typeof message.id !== "string" || typeof message.method !== "string") continue;
          const params = (message.params ?? {}) as JsonRecord;
          if (message.method === "events.subscribe") {
            subscribeCalls.push({ id: String(message.id), params });
            subscribers.add({
              write: (out: string) => {
                _socket.write(out);
              },
            });
            _socket.write(
              `${JSON.stringify({ id: message.id, result: { type: "subscription_started" } })}\n`,
            );
            continue;
          }
          calls.push({ method: message.method, params });
          const responder = responders.get(message.method);
          if (responder === undefined) {
            _socket.write(
              `${JSON.stringify({ id: message.id, error: { code: "unknown_method", message: message.method } })}\n`,
            );
            continue;
          }
          const out = responder(params);
          const failure = out.failure as { code: string; message: string } | undefined;
          if (failure !== undefined) {
            _socket.write(`${JSON.stringify({ id: message.id, error: failure })}\n`);
          } else {
            _socket.write(`${JSON.stringify({ id: message.id, result: out })}\n`);
          }
        }
      },
      close() {},
      error() {},
    },
  });

  responders.set("session.snapshot", () => snapshot);

  return {
    path: socketPath,
    setSnapshot(next: JsonRecord) {
      snapshot = next;
    },
    calls,
    subscribeCalls,
    respond(method, response) {
      responders.set(method, response);
    },
    push(frame) {
      const line = `${JSON.stringify(frame)}\n`;
      for (const subscriber of subscribers) subscriber.write(line);
    },
    subscriberCount: () => subscribers.size,
    async close() {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// ——— fixture state ————————————————————————————————————————————————————————

function fixtureSnapshot(
  overrides: {
    paneStatus?: string;
    paneAgent?: string | null;
    focusedWorkspaceId?: string;
  } = {},
): JsonRecord {
  return {
    snapshot: {
      version: "0.9.5",
      protocol: 22,
      focused_workspace_id: overrides.focusedWorkspaceId ?? "w1",
      focused_tab_id: "w1:t1",
      focused_pane_id: "w1:p1",
      workspaces: [
        {
          workspace_id: "w1",
          label: "loop",
          number: 1,
          tab_count: 1,
          pane_count: 2,
          active_tab_id: "w1:t1",
          focused: true,
          agent_status: "working",
        },
      ],
      tabs: [
        {
          tab_id: "w1:t1",
          workspace_id: "w1",
          label: "1",
          number: 1,
          focused: true,
          pane_count: 2,
        },
      ],
      panes: [
        {
          pane_id: "w1:p1",
          workspace_id: "w1",
          tab_id: "w1:t1",
          terminal_title: "◐ hardening",
          terminal_title_stripped: "hardening",
          agent_status: overrides.paneStatus ?? "working",
          agent: overrides.paneAgent === undefined ? "claude" : overrides.paneAgent,
          cwd: "/Users/loopy/dev/ll3/loop",
          foreground_cwd: "/Users/loopy/dev/ll3/loop/frontend",
          revision: 12,
          focused: true,
        },
        {
          pane_id: "w1:p2",
          workspace_id: "w1",
          tab_id: "w1:t1",
          terminal_title: null,
          terminal_title_stripped: null,
          agent_status: null,
          agent: null,
          cwd: "/Users/loopy/dev/ll3/loop",
          revision: 0,
          focused: false,
        },
      ],
    },
  };
}

async function waitUntilHerdr(
  gateway: TestGateway,
  predicate: () => boolean,
  deadlineMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await gateway.herdr?.control.snapshot().catch(() => null);
    await Bun.sleep(10);
  }
  throw new Error("herdr state did not converge");
}

// ——— boot helper ———————————————————————————————————————————————————————————

function bootWithHerdr(
  fake: FakeHerdr,
  overrides?: Parameters<typeof bootTestGateway>[0],
): TestGateway {
  const control = new HerdrControlClient({ socketPath: fake.path, requestTimeoutMs: 1_000 });
  return bootTestGateway({ ...overrides, herdr: { control } });
}

// ——— tests ——————————————————————————————————————————————————————————————————

describe("herdr surface (M1)", () => {
  let fake: FakeHerdr;
  let gateway: TestGateway;

  beforeAll(() => {
    fake = startFakeHerdrSocket(fixtureSnapshot());
    fake.respond("pane.read", (params) => ({
      read: {
        pane_id: params.pane_id,
        revision: 12,
        text: "hello \u001b[32mgreen\u001b[0m",
        truncated: false,
      },
    }));
    fake.respond("agent.prompt", () => ({ type: "prompt_submitted" }));
    fake.respond("agent.send_keys", () => ({ type: "ok" }));
    fake.respond("pane.focus", () => ({ type: "ok" }));
    fake.respond("integration.list", () => ({
      integrations: [
        {
          target: "claude",
          label: "Claude Code",
          command: "claude",
          available: true,
          state: "current",
        },
        {
          target: "antigravity_cli",
          label: "Antigravity",
          command: "agy",
          available: false,
          state: "not_installed",
        },
      ],
    }));
    fake.respond("workspace.create", () => ({
      workspace: { workspace_id: "w9" },
      tab: { tab_id: "w9:t1" },
      root_pane: { pane_id: "w9:p1" },
    }));
    gateway = bootWithHerdr(fake);
  });

  afterAll(async () => {
    gateway.stop();
    await fake.close();
  });

  test("GET /v1/herdr/state maps the snapshot into gateway vocabulary", async () => {
    await waitUntilHerdr(gateway, () => gateway.herdr?.monitor.current().available === true);
    const response = await fetch(`${gateway.baseUrl}/v1/herdr/state`, {
      headers: authHeader(gateway.token()),
    });
    expect(response.status).toBe(200);
    const state = (await response.json()) as Record<string, unknown>;
    expect(state.available).toBe(true);
    expect(state.serverVersion).toBe("0.9.5");
    expect(state.protocol).toBe(22);
    const panes = state.panes as Record<string, unknown>[];
    expect(panes).toHaveLength(2);
    expect(panes[0]?.id).toBe("w1:p1");
    expect(panes[0]?.title).toBe("hardening");
    expect(panes[0]?.status).toBe("working");
    expect(panes[0]?.agent).toBe("claude");
    // The agent's own cwd rides along for the conversation resolver's
    // fallback key (agents that `cd` after start store sessions there).
    expect(panes[0]?.foregroundCwd).toBe("/Users/loopy/dev/ll3/loop/frontend");
    // u64 decimal-string rule; the agent pane's revision is the gateway's
    // synthesized content revision (herdr's own counter is not a change hook)
    expect(panes[0]?.revision).toBe("1");
    expect(panes[1]?.agent).toBeNull();
    expect(panes[1]?.status).toBe("unknown");
    const workspaces = state.workspaces as Record<string, unknown>[];
    expect(workspaces[0]?.activeTabId).toBe("w1:t1");
    expect((state.focused as Record<string, unknown>).paneId).toBe("w1:p1");
  });

  test("GET conversation borrows nothing written before the pane's birth", async () => {
    await waitUntilHerdr(gateway, () => gateway.herdr?.monitor.current().available === true);
    const home = join(
      tmpdir(),
      `loop-gw-conv-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const project = join(
      home,
      ".claude",
      "projects",
      claudeProjectDirName("/Users/loopy/dev/ll3/loop"),
    );
    mkdirSync(project, { recursive: true });
    const file = join(project, "old.jsonl");
    writeFileSync(
      file,
      `${JSON.stringify({ type: "user", uuid: "u1", timestamp: "2026-10-01T00:00:00Z", message: { role: "user", content: "이전 세션" } })}\n`,
    );
    utimesSync(file, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      // Pane w1:p1 is pre-existing (no birth recorded) — the legacy fallback
      // still serves the newest cwd session.
      const legacy = await fetch(`${gateway.baseUrl}/v1/herdr/panes/w1:p1/conversation`, {
        headers: authHeader(gateway.token()),
      });
      expect(legacy.status).toBe(200);

      // A gateway-started pane must not borrow the pre-birth session file.
      notePaneBirth("w1:p1", Date.now());
      const fresh = await fetch(`${gateway.baseUrl}/v1/herdr/panes/w1:p1/conversation`, {
        headers: authHeader(gateway.token()),
      });
      expect(fresh.status).toBe(404);

      // Once the pane's own record lands (mtime after birth), it is served.
      await Bun.sleep(5);
      appendFileSync(
        file,
        `${JSON.stringify({ type: "assistant", uuid: "a1", timestamp: "2026-10-24T00:00:00Z", message: { role: "assistant", content: [{ type: "text", text: "새 답변" }] } })}\n`,
      );
      const own = await fetch(`${gateway.baseUrl}/v1/herdr/panes/w1:p1/conversation`, {
        headers: authHeader(gateway.token()),
      });
      expect(own.status).toBe(200);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("GET /v1/herdr/events sends a fresh intro and converges on feed events", async () => {
    await waitUntilHerdr(gateway, () => gateway.herdr?.monitor.current().available === true);
    await waitUntilHerdr(gateway, () => fake.subscriberCount() > 0);
    const response = await fetch(`${gateway.baseUrl}/v1/herdr/events`, {
      headers: { Accept: "text/event-stream", ...authHeader(gateway.token()) },
    });
    expect(response.status).toBe(200);
    const reader = must(response.body?.getReader());
    const decoder = new TextDecoder();
    let raw = "";
    const deadline = Date.now() + 2_000;
    // Push a status change on the herdr feed; the monitor must refresh and
    // emit herdr_state v2 with the new pane status.
    fake.setSnapshot(fixtureSnapshot({ paneStatus: "done" }));
    fake.push({
      event: "pane.agent_status_changed",
      data: { pane_id: "w1:p1", workspace_id: "w1", agent_status: "done" },
    });
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || raw.includes('"status":"done"')) break;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining)),
      ]);
      if (chunk === "timeout" || chunk.done) break;
      raw += decoder.decode(chunk.value, { stream: true });
    }
    await reader.cancel().catch(() => undefined);
    expect(raw).toContain("event: herdr_state");
    expect(raw).toContain("id: herdr-1");
    expect(raw).toContain('"status":"done"');
    // restore for later tests
    fake.setSnapshot(fixtureSnapshot());
  });

  test("GET /v1/herdr/panes/{id}/read passes source/format and clamps lines", async () => {
    const response = await fetch(
      `${gateway.baseUrl}/v1/herdr/panes/${encodeURIComponent("w1:p1")}/read?lines=99999&source=visible&format=ansi`,
      { headers: authHeader(gateway.token()) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.paneId).toBe("w1:p1");
    // the route read is its own window-keyed stream: same window + same
    // content must hold the revision (no fabricated change per poll)
    expect(body.revision).toMatch(/^\d+$/);
    const again = await fetch(
      `${gateway.baseUrl}/v1/herdr/panes/${encodeURIComponent("w1:p1")}/read?lines=99999&source=visible&format=ansi`,
      { headers: authHeader(gateway.token()) },
    );
    expect(((await again.json()) as Record<string, unknown>).revision).toBe(body.revision);
    expect(body.text).toContain("green");
    const readCall = fake.calls.findLast((call) => call.method === "pane.read");
    must(readCall);
    expect(readCall?.params.lines).toBe(2000);
    expect(readCall?.params.source).toBe("visible");
    expect(readCall?.params.format).toBe("ansi");
    expect(readCall?.params.strip_ansi).toBe(false);
  });

  test("POST prompt maps accepted, blocked, and not-found outcomes", async () => {
    const ok = await fetch(
      `${gateway.baseUrl}/v1/herdr/panes/${encodeURIComponent("w1:p1")}/prompt`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
        body: JSON.stringify({ text: "run the tests" }),
      },
    );
    expect(ok.status).toBe(202);

    fake.respond("agent.prompt", () => ({
      failure: { code: "agent_blocked", message: "agent is waiting on an approval dialog" },
    }));
    const blocked = await fetch(
      `${gateway.baseUrl}/v1/herdr/panes/${encodeURIComponent("w1:p1")}/prompt`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
        body: JSON.stringify({ text: "hello" }),
      },
    );
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as Record<string, unknown>).code).toBe("agent_blocked");

    fake.respond("agent.prompt", () => ({
      failure: { code: "pane_not_found", message: "no such pane" },
    }));
    const missing = await fetch(
      `${gateway.baseUrl}/v1/herdr/panes/${encodeURIComponent("w9:zz")}/prompt`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
        body: JSON.stringify({ text: "hello" }),
      },
    );
    expect(missing.status).toBe(404);

    fake.respond("agent.prompt", () => ({ type: "prompt_submitted" }));
  });

  test("POST keys delivers logical keys and rejects malformed input", async () => {
    const ok = await fetch(
      `${gateway.baseUrl}/v1/herdr/panes/${encodeURIComponent("w1:p1")}/keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
        body: JSON.stringify({ keys: ["ctrl+c"] }),
      },
    );
    expect(ok.status).toBe(204);
    const keysCall = fake.calls.findLast((call) => call.method === "agent.send_keys");
    must(keysCall);
    expect(keysCall?.params.target).toBe("w1:p1");
    expect(keysCall?.params.keys).toEqual(["ctrl+c"]);

    const bad = await fetch(
      `${gateway.baseUrl}/v1/herdr/panes/${encodeURIComponent("w1:p1")}/keys`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
        body: JSON.stringify({ keys: ["rm -rf /"] }),
      },
    );
    expect(bad.status).toBe(400);
  });

  test("POST focus delivers pane focus", async () => {
    const ok = await fetch(
      `${gateway.baseUrl}/v1/herdr/panes/${encodeURIComponent("w1:p1")}/focus`,
      {
        method: "POST",
        headers: authHeader(gateway.token()),
      },
    );
    expect(ok.status).toBe(204);
  });

  test("POST agents/start uses an available shell pane in the target tab", async () => {
    fake.respond("agent.start", (params) => ({
      pane: { pane_id: params.pane_id },
      agent: { name: params.name },
      ready: true,
    }));
    const response = await fetch(`${gateway.baseUrl}/v1/herdr/agents/start`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
      body: JSON.stringify({ kind: "agy" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.paneId).toBe("w1:p2"); // the only pane without an agent
    expect(body.kind).toBe("agy");
    expect(body.createdPane).toBe(false);
    const startCall = fake.calls.findLast((call) => call.method === "agent.start");
    must(startCall);
    expect(startCall?.params.pane_id).toBe("w1:p2");
    expect(startCall?.params.kind).toBe("agy");
    // herdr 0.9.5 requires `name` on agent.start — an unnamed start derives
    // a stable kind+pane slug (the missing-field 409 fix, live-verified).
    expect(startCall?.params.name).toBe("agy-w1-p2");
  });

  test("POST agents/start splits when the tab has no shell pane", async () => {
    fake.setSnapshot(
      fixtureSnapshotWithPanes([
        {
          pane_id: "w1:p1",
          workspace_id: "w1",
          tab_id: "w1:t1",
          terminal_title_stripped: "busy",
          agent_status: "working",
          agent: "claude",
          cwd: "/tmp",
          revision: 3,
          focused: true,
        },
      ]),
    );
    fake.respond("pane.split", () => ({ pane: { pane_id: "w1:p3" } }));
    // converge the monitor onto the mutated snapshot before starting
    await gateway.herdr?.monitor.refresh();
    expect(gateway.herdr?.monitor.current().panes).toHaveLength(1);
    const response = await fetch(`${gateway.baseUrl}/v1/herdr/agents/start`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
      body: JSON.stringify({ kind: "codex" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.paneId).toBe("w1:p3");
    expect(body.createdPane).toBe(true);
    const splitCall = fake.calls.findLast((call) => call.method === "pane.split");
    expect(splitCall?.params.target_pane_id).toBe("w1:p1");
    expect(splitCall?.params.direction).toBe("right");
    // state back to the shared fixture for later tests
    fake.setSnapshot(fixtureSnapshot());
  });

  test("POST agents/start retries the fresh-pane agent_pane_busy window", async () => {
    // Live finding (2026-10-22): herdr answers `agent_pane_busy` when
    // agent.start lands between workspace.create and the pane registering as
    // an available shell. One busy answer, then success — the route must ride
    // out the window instead of surfacing a 409.
    let startAttempts = 0;
    fake.respond("agent.start", (params) => {
      startAttempts += 1;
      if (startAttempts === 1) {
        return {
          failure: {
            code: "agent_pane_busy",
            message: "agent target pane w9:p1 is not an available shell",
          },
        };
      }
      return { pane: { pane_id: params.pane_id }, agent: { name: params.name }, ready: true };
    });
    const response = await fetch(`${gateway.baseUrl}/v1/herdr/agents/start`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
      body: JSON.stringify({ kind: "codex", createWorkspace: true }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.paneId).toBe("w9:p1");
    expect(startAttempts).toBe(2);
  });

  test("POST agents/start records the pane birth for the fallback floor", async () => {
    fake.respond("agent.start", (params) => ({
      pane: { pane_id: params.pane_id },
      agent: { name: params.name },
      ready: true,
    }));
    const response = await fetch(`${gateway.baseUrl}/v1/herdr/agents/start`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
      body: JSON.stringify({ kind: "codex", createWorkspace: true }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(paneBirthMs(String(body.paneId))).not.toBeNull();
  });

  test("POST agents/start maps herdr rejection to agent_start_rejected", async () => {
    fake.respond("agent.start", () => ({
      failure: { code: "pane_not_available", message: "pane is busy" },
    }));
    const response = await fetch(`${gateway.baseUrl}/v1/herdr/agents/start`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
      body: JSON.stringify({ kind: "pi", name: "Bad Name!" }),
    });
    // invalid name is rejected before any herdr call
    expect(response.status).toBe(400);

    const goodName = await fetch(`${gateway.baseUrl}/v1/herdr/agents/start`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
      body: JSON.stringify({ kind: "pi", name: "reviewer-2" }),
    });
    expect(goodName.status).toBe(409);
    expect(((await goodName.json()) as Record<string, unknown>).code).toBe("agent_start_rejected");
    fake.respond("agent.start", (params) => ({
      pane: { pane_id: params.pane_id },
      agent: { name: params.name },
      ready: true,
    }));
  });

  test("POST workspaces creates a workspace and returns its handles", async () => {
    const response = await fetch(`${gateway.baseUrl}/v1/herdr/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
      body: JSON.stringify({ label: "scratch" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.workspaceId).toBe("w9");
    expect(body.tabId).toBe("w9:t1");
    expect(body.rootPaneId).toBe("w9:p1");
  });

  test("GET integrations returns the installed-kind inventory", async () => {
    const response = await fetch(`${gateway.baseUrl}/v1/herdr/integrations`, {
      headers: authHeader(gateway.token()),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { integrations: Record<string, unknown>[] };
    expect(body.integrations).toHaveLength(2);
    expect(body.integrations[0]?.target).toBe("claude");
    expect(body.integrations[1]?.state).toBe("not_installed");
  });
});

describe("herdr surface fail-closed paths", () => {
  test("absent herdr surface → /v1/herdr 404", async () => {
    const gateway = bootTestGateway();
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/herdr/state`, {
        headers: authHeader(gateway.token()),
      });
      expect(response.status).toBe(404);
    } finally {
      gateway.stop();
    }
  });

  test("unreachable herdr socket → honest available:false and 503 commands", async () => {
    const control = new HerdrControlClient({
      socketPath: join(tmpdir(), "loop-gateway-herdr-missing.sock"),
      requestTimeoutMs: 250,
    });
    const gateway = bootTestGateway({ herdr: { control } });
    try {
      await Bun.sleep(50);
      const state = await fetch(`${gateway.baseUrl}/v1/herdr/state`, {
        headers: authHeader(gateway.token()),
      });
      expect(state.status).toBe(200);
      expect(((await state.json()) as Record<string, unknown>).available).toBe(false);

      const prompt = await fetch(
        `${gateway.baseUrl}/v1/herdr/panes/${encodeURIComponent("w1:p1")}/prompt`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeader(gateway.token()) },
          body: JSON.stringify({ text: "hello" }),
        },
      );
      expect(prompt.status).toBe(503);
      expect(((await prompt.json()) as Record<string, unknown>).code).toBe("herdr_unavailable");
    } finally {
      gateway.stop();
    }
  });
});

describe("herdr content revisions and output watch", () => {
  let fake: FakeHerdr;
  let gateway: TestGateway;
  let tail: string;

  beforeAll(() => {
    tail = "first output";
    fake = startFakeHerdrSocket(fixtureSnapshot());
    // herdr 0.9.5 live behavior: pane.read's revision never moves
    fake.respond("pane.read", (params) => ({
      read: { pane_id: params.pane_id, revision: 0, text: tail, truncated: false },
    }));
    gateway = bootWithHerdr(fake);
  });

  afterAll(async () => {
    gateway.stop();
    await fake.close();
  });

  test("agent pane carries the synthesized content revision; non-agent keeps the snapshot one", async () => {
    await waitUntilHerdr(gateway, () => gateway.herdr?.monitor.current().available === true);
    const state = must(gateway.herdr?.monitor.current());
    expect(state.panes.find((pane) => pane.id === "w1:p1")?.revision).toBe("1"); // first tail read seeds the counter
    expect(state.panes.find((pane) => pane.id === "w1:p2")?.revision).toBe("0"); // no agent → no tail read
    const readCall = must(fake.calls.findLast((call) => call.method === "pane.read"));
    expect(readCall.params.pane_id).toBe("w1:p1");
    expect(readCall.params.lines).toBe(12);
  });

  test("changed tail content bumps the state version and the pane revision", async () => {
    const before = must(gateway.herdr?.monitor.current()).version;
    tail = "second output";
    await gateway.herdr?.monitor.refresh();
    const state = must(gateway.herdr?.monitor.current());
    expect(state.version).toBe(before + 1);
    expect(state.panes.find((pane) => pane.id === "w1:p1")?.revision).toBe("2");
  });

  test("identical content stays a no-op frame (version stable)", async () => {
    const before = must(gateway.herdr?.monitor.current()).version;
    await gateway.herdr?.monitor.refresh();
    expect(must(gateway.herdr?.monitor.current()).version).toBe(before);
  });

  test("an output_matched push converges the view without waiting for the poll", async () => {
    const before = must(gateway.herdr?.monitor.current()).version;
    await waitUntilHerdr(gateway, () => fake.subscriberCount() > 0);
    tail = "third output";
    fake.push({
      event: "pane.output_matched",
      data: {
        pane_id: "w1:p1",
        matched_line: "third output",
        read: { pane_id: "w1:p1", revision: 0, text: tail, truncated: false },
      },
    });
    await waitUntilHerdr(gateway, () => must(gateway.herdr?.monitor.current()).version > before);
    expect(must(gateway.herdr?.monitor.current()).panes.find((pane) => pane.id === "w1:p1")?.revision).toBe("3");
  });

  test("a pane gaining its agent re-opens the feed with the output watch", async () => {
    await waitUntilHerdr(gateway, () => fake.subscriberCount() > 0);
    const subsBefore = fake.subscribeCalls.length;
    fake.setSnapshot(
      fixtureSnapshotWithPanes([
        {
          pane_id: "w1:p1",
          workspace_id: "w1",
          tab_id: "w1:t1",
          agent_status: "working",
          agent: "claude",
          cwd: "/tmp",
          revision: 3,
          focused: true,
        },
        {
          pane_id: "w1:p2",
          workspace_id: "w1",
          tab_id: "w1:t1",
          agent_status: "idle",
          agent: "codex",
          cwd: "/tmp",
          revision: 0,
          focused: false,
        },
      ]),
    );
    await gateway.herdr?.monitor.refresh(); // view converges; watch signature changes
    await waitUntilHerdr(gateway, () => fake.subscribeCalls.length > subsBefore);
    const subs = (must(fake.subscribeCalls.at(-1)).params.subscriptions ?? []) as JsonRecord[];
    const watched = subs.filter((entry) => entry.type === "pane.output_matched");
    expect(watched.map((entry) => entry.pane_id).toSorted()).toEqual(["w1:p1", "w1:p2"]);
  });

  test("a transient tail-read failure keeps the last content revision (no flip-flop)", async () => {
    const good = (params: JsonRecord): JsonRecord => ({
      read: { pane_id: params.pane_id, revision: 0, text: tail, truncated: false },
    });
    let failing = true;
    fake.respond("pane.read", (params) =>
      failing ? { failure: { code: "transient", message: "boom" } } : good(params),
    );
    const before = must(gateway.herdr?.monitor.current()).version;
    await gateway.herdr?.monitor.refresh(); // both reads fail → cached revisions hold
    expect(must(gateway.herdr?.monitor.current()).version).toBe(before);
    failing = false;
    await gateway.herdr?.monitor.refresh(); // recovery: unchanged content stays a no-op
    expect(must(gateway.herdr?.monitor.current()).version).toBe(before);
    fake.respond("pane.read", good); // restore for any later test
  });
});

describe("herdr feed subscription and event mapping", () => {
  test("output watch subscribes only agent panes and maps the three signals", async () => {
    const fake = startFakeHerdrSocket(fixtureSnapshot());
    try {
      const control = new HerdrControlClient({ socketPath: fake.path, requestTimeoutMs: 1_000 });
      const events: { kind: string; paneId?: string; status?: string }[] = [];
      const subscription = control.subscribe(
        () => [
          { paneId: "w1:p1", watchOutput: true },
          { paneId: "w1:p2", watchOutput: false },
        ],
        (event) => events.push(event),
      );
      await Bun.sleep(50);
      const subs = (must(fake.subscribeCalls.at(-1)).params.subscriptions ?? []) as JsonRecord[];
      const watched = subs.filter((entry) => entry.type === "pane.output_matched");
      expect(watched).toHaveLength(1);
      expect(watched[0]?.pane_id).toBe("w1:p1");
      expect(watched[0]?.source).toBe("recent_unwrapped");
      expect(watched[0]?.lines).toBe(1);
      expect((watched[0]?.match as JsonRecord)?.value).toBe(".");
      expect(subs.filter((entry) => entry.type === "pane.agent_status_changed")).toHaveLength(2);

      fake.push({ event: "pane.output_matched", data: { pane_id: "w1:p1", matched_line: "x", read: {} } });
      fake.push({ event: "pane.agent_status_changed", data: { pane_id: "w1:p2", agent_status: "working" } });
      fake.push({ event: "layout.updated", data: {} });
      fake.push({ event: "irrelevant.event", data: {} });
      await Bun.sleep(50);
      expect(events).toEqual([
        { kind: "pane_output", paneId: "w1:p1" },
        { kind: "pane_state", paneId: "w1:p2", status: "working" },
        { kind: "structure" },
      ]);
      subscription.stop();
    } finally {
      await fake.close();
    }
  });

  test("pane reads carry the synthesized revision per read window", async () => {
    const fake = startFakeHerdrSocket(fixtureSnapshot());
    try {
      let text = "a";
      // real herdr returns window- and format-dependent text for the same
      // content; the fake reproduces that so cross-window isolation is real
      fake.respond("pane.read", (params) => ({
        read: {
          pane_id: params.pane_id,
          revision: 0,
          text: `${String(params.lines)}:${String(params.format)}:${text}`,
          truncated: false,
        },
      }));
      const control = new HerdrControlClient({ socketPath: fake.path, requestTimeoutMs: 1_000 });
      // the state monitor's tail stream
      expect((await control.readTail("w1:p1", 12))?.revision).toBe("1");
      expect((await control.readTail("w1:p1", 12))?.revision).toBe("1");
      text = "b";
      expect((await control.readTail("w1:p1", 12))?.revision).toBe("2");
      // an interleaved route read through a different window seeds its own
      // stream and must NOT bump the monitor's stream (refetch-loop guard)
      expect(
        (
          await control.readPane("w1:p1", {
            lines: 400,
            source: "recent_unwrapped",
            format: "ansi",
          })
        )?.revision,
      ).toBe("3");
      expect((await control.readTail("w1:p1", 12))?.revision).toBe("2");

      // the observation port (mirror path) keeps its own stream-local table
      const source = new HerdrPaneSource({ socketPath: fake.path });
      try {
        expect((await source.readPane("w1:p1"))?.revision).toBe("1");
        text = "c";
        expect((await source.readPane("w1:p1"))?.revision).toBe("2");
      } finally {
        source.close();
      }
    } finally {
      await fake.close();
    }
  });
});

function fixtureSnapshotWithPanes(panes: JsonRecord[]): JsonRecord {
  const base = fixtureSnapshot() as { snapshot: JsonRecord };
  return {
    snapshot: {
      ...base.snapshot,
      panes,
      focused_pane_id: "w1:p1",
    },
  };
}

// ——— cold-spawn start window (2026-10-22 live finding) ——————————————————————
// herdr's agent.start carries its own readiness wait (timeout_ms; the route
// passes 30s). The control client's socket budget must cover that window:
// cutting the socket at the default 3s request cap read a slow-but-healthy
// cold spawn (codex's node CLI on a busy machine) as a bogus
// `agent_start_rejected` 409. This fake answers agent.start after 300ms —
// past a shrunken default budget (100ms), inside the start-specific window.
describe("HerdrControlClient.startAgent socket budget", () => {
  test("a start reply slower than the default budget still succeeds", async () => {
    const dir = join(
      tmpdir(),
      `loop-gateway-start-budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(dir, { recursive: true });
    const socketPath = join(dir, "herdr.sock");
    const server = Bun.listen({
      unix: socketPath,
      socket: {
        open() {},
        data(socket, bytes) {
          for (const line of String(bytes).split("\n")) {
            if (line.trim().length === 0) continue;
            let message: { id?: unknown; method?: unknown };
            try {
              message = JSON.parse(line);
            } catch {
              continue;
            }
            if (message.method !== "agent.start" || typeof message.id !== "string") continue;
            const id = message.id;
            setTimeout(() => {
              socket.write(
                `${JSON.stringify({
                  id,
                  result: { pane: { pane_id: "w9:p1" }, agent: { name: "cold-codex" }, ready: true },
                })}\n`,
              );
            }, 300);
          }
        },
        close() {},
        error() {},
      },
    });
    try {
      const control = new HerdrControlClient({ socketPath, requestTimeoutMs: 100 });
      const outcome = await control.startAgent({
        kind: "codex",
        paneId: "w9:p1",
        name: "cold-codex",
        timeoutMs: 1_000,
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.paneId).toBe("w9:p1");
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
