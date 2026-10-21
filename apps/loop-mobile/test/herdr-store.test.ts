/**
 * HerdrStore + selector contracts (rebuild brief M2/M5): generation guard,
 * disconnect reset, pure derivations the screens render from. No react, no
 * network (stubbed fetch keeps the stream offline).
 */

import { describe, expect, test } from "bun:test";

import {
  agentPanes,
  HerdrStore,
  paneDisplayName,
  panesOfTab,
  workspaceGroups,
} from "../src/herdr/store";
import type { HerdrPane, HerdrState } from "../src/herdr/wire";

function pane(overrides: Partial<HerdrPane>): HerdrPane {
  return {
    id: "w1:p1",
    workspaceId: "w1",
    tabId: "w1:t1",
    title: null,
    status: "idle",
    agent: null,
    cwd: null,
    revision: "0",
    focused: false,
    ...overrides,
  };
}

function state(overrides: Partial<HerdrState> = {}): HerdrState {
  return {
    available: true,
    version: 1,
    serverVersion: "0.9.5",
    protocol: 22,
    focused: { workspaceId: "w1", tabId: "w1:t1", paneId: "w1:p1" },
    workspaces: [
      { id: "w2", label: "b", number: 2, tabCount: 1, paneCount: 1, activeTabId: "w2:t1", focused: false, status: "idle" },
      { id: "w1", label: "a", number: 1, tabCount: 1, paneCount: 2, activeTabId: "w1:t1", focused: true, status: "working" },
    ],
    tabs: [
      { id: "w1:t1", workspaceId: "w1", label: "1", number: 1, focused: true, paneCount: 2 },
      { id: "w2:t1", workspaceId: "w2", label: "1", number: 1, focused: false, paneCount: 1 },
    ],
    panes: [],
    ...overrides,
  };
}

describe("HerdrStore", () => {
  test("connect resets state and reports connecting, then live on first frame", async () => {
    const store = new HerdrStore({
      fetchImpl: async () =>
        new Response(
          `event: herdr_state\ndata: ${JSON.stringify(state())}\n\n`,
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    });
    const seen: HerdrAppStateish[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));
    store.connect({ baseUrl: "http://gw.tailnet.ts.net:18477", bearer: "" });
    await Bun.sleep(120);
    store.disconnect();
    unsubscribe();
    const statuses = seen.map((entry) => entry.connection.status);
    expect(statuses).toContain("connecting");
    expect(statuses).toContain("live");
    expect(store.getSnapshot().connection.status).toBe("idle");
    expect(store.getSnapshot().herdr).toBeNull();
  });

  test("a failed stream surfaces honestly", async () => {
    const store = new HerdrStore({
      fetchImpl: async () => new Response(JSON.stringify({ code: "unauthorized", status: 401 }), { status: 401 }),
    });
    store.connect({ baseUrl: "http://gw.tailnet.ts.net:18477", bearer: "" });
    await Bun.sleep(80);
    expect(store.getSnapshot().connection.status).toBe("failed");
    store.disconnect();
  });
});

type HerdrAppStateish = ReturnType<HerdrStore["getSnapshot"]>;

describe("selectors", () => {
  const full = state({
    panes: [
      pane({ id: "w1:p2", agent: "agy", status: "working", title: "번역 리팩터" }),
      pane({ id: "w1:p1", agent: "claude", status: "blocked" }),
      pane({ id: "w2:p1", workspaceId: "w2", tabId: "w2:t1", agent: "codex" }),
      pane({ id: "w1:p3" }), // shell — never an agent row
    ],
  });

  test("agentPanes keeps only panes with a detected agent", () => {
    const agents = agentPanes(full);
    expect(agents.map((entry) => entry.id)).toEqual(["w1:p1", "w1:p2", "w2:p1"]);
  });

  test("workspaceGroups sorts by workspace number and omits empty ones", () => {
    const groups = workspaceGroups(full);
    expect(groups.map((group) => group.workspace.id)).toEqual(["w1", "w2"]);
    expect(groups[0]?.panes.map((entry) => entry.id)).toEqual(["w1:p1", "w1:p2"]);
  });

  test("panesOfTab filters by tab", () => {
    expect(panesOfTab(full, "w1:t1")).toHaveLength(3);
    expect(panesOfTab(full, "w2:t1")).toHaveLength(1);
  });

  test("paneDisplayName prefers title, then kind, then id", () => {
    expect(paneDisplayName(pane({ title: "제목" }), "Antigravity")).toBe("제목");
    expect(paneDisplayName(pane({ agent: "agy" }), "Antigravity")).toBe("Antigravity");
    expect(paneDisplayName(pane({}), "")).toBe("w1:p1");
  });
});
