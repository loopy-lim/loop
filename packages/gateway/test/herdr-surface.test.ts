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
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { authHeader, bootTestGateway, type TestGateway } from "./helpers";
import { HerdrControlClient } from "../src/herdr-pane-source";

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
    expect(panes[0]?.revision).toBe("12"); // u64 decimal-string rule
    expect(panes[1]?.agent).toBeNull();
    expect(panes[1]?.status).toBe("unknown");
    const workspaces = state.workspaces as Record<string, unknown>[];
    expect(workspaces[0]?.activeTabId).toBe("w1:t1");
    expect((state.focused as Record<string, unknown>).paneId).toBe("w1:p1");
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
    expect(body.revision).toBe("12");
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
