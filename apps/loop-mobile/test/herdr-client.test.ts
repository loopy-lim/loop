/**
 * HerdrClient contract (rebuild brief M2): one method per gateway route,
 * problem errors via GatewayError, prompt's blocked outcome as a first-class
 * value. Stubbed fetch — no network, no paid model calls.
 */

import { describe, expect, test } from "bun:test";

import { createConnectionConfig } from "../src/auth/connection";
import { HerdrClient, type FetchLike } from "../src/herdr/client";

const CONFIG = createConnectionConfig("gw.tailnet.ts.net", "18477", "tok");

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function recordingFetch(
  respond: (method: string, path: string, body: unknown) => Response,
): { fetch: FetchLike; calls: { method: string; path: string; body: unknown; auth: string | null }[] } {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  return {
    calls,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      let body: unknown = null;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      calls.push({
        method: init?.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        body,
        auth: new Headers(init?.headers).get("Authorization"),
      });
      return respond(calls[calls.length - 1]?.method ?? "GET", calls[calls.length - 1]?.path ?? "", body);
    },
  };
}

describe("HerdrClient", () => {
  test("state() hits /v1/herdr/state with the bearer header", async () => {
    const stub = recordingFetch(() => ok({ available: true, version: 1, panes: [] }));
    const client = new HerdrClient(CONFIG, stub.fetch);
    const state = await client.state();
    expect(state.available).toBe(true);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.path).toBe("/v1/herdr/state");
    expect(stub.calls[0]?.auth).toBe("Bearer tok");
  });

  test("readPane builds the query and encodes the pane id", async () => {
    const stub = recordingFetch(() =>
      ok({ paneId: "w1:p1", revision: "3", text: "x", truncated: false }),
    );
    const client = new HerdrClient(CONFIG, stub.fetch);
    const reading = await client.readPane("w1:p1", { lines: 120, source: "visible", format: "ansi" });
    expect(reading.revision).toBe("3");
    expect(stub.calls[0]?.path).toBe("/v1/herdr/panes/w1%3Ap1/read?lines=120&source=visible&format=ansi");
  });

  test("prompt resolves 202 as accepted and 409 as blocked", async () => {
    const stub = recordingFetch(() => ok({}, 202));
    const client = new HerdrClient(CONFIG, stub.fetch);
    const accepted = await client.prompt("w1:p1", "run the tests");
    expect(accepted).toEqual({ accepted: true });
    expect(stub.calls[0]?.body).toEqual({ text: "run the tests" });
    expect(stub.calls[0]?.method).toBe("POST");

    const blockedStub = recordingFetch(() =>
      new Response(JSON.stringify({ code: "agent_blocked", status: 409 }), { status: 409 }),
    );
    const blocked = await new HerdrClient(CONFIG, blockedStub.fetch).prompt("w1:p1", "hello");
    expect(blocked).toEqual({ accepted: false, reason: "blocked" });

    const missingStub = recordingFetch(() =>
      new Response(JSON.stringify({ code: "agent_not_found", status: 404 }), { status: 404 }),
    );
    const missing = await new HerdrClient(CONFIG, missingStub.fetch).prompt("w9:zz", "hello");
    expect(missing).toEqual({ accepted: false, reason: "not_found" });
  });

  test("sendKeys and focusPane accept 204", async () => {
    const stub = recordingFetch(() => new Response(null, { status: 204 }));
    const client = new HerdrClient(CONFIG, stub.fetch);
    await expect(client.sendKeys("w1:p1", ["esc"])).resolves.toBeUndefined();
    await expect(client.focusPane("w1:p1")).resolves.toBeUndefined();
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]?.body).toEqual({ keys: ["esc"] });
    expect(stub.calls[1]?.body).toBeNull();
  });

  test("startAgent and createWorkspace post their bodies", async () => {
    const stub = recordingFetch(() =>
      ok({
        paneId: "w1:p2",
        name: "reviewer-1",
        kind: "agy",
        ready: true,
        createdPane: false,
        workspaceId: "w1",
        tabId: "w1:t1",
      }),
    );
    const client = new HerdrClient(CONFIG, stub.fetch);
    const started = await client.startAgent({ kind: "agy", name: "reviewer-1" });
    expect(started.kind).toBe("agy");
    expect(stub.calls[0]?.path).toBe("/v1/herdr/agents/start");
    expect(stub.calls[0]?.body).toEqual({ kind: "agy", name: "reviewer-1" });

    const wsStub = recordingFetch(() => ok({ workspaceId: "w9", tabId: "w9:t1", rootPaneId: "w9:p1" }));
    const client2 = new HerdrClient(CONFIG, wsStub.fetch);
    const created = await client2.createWorkspace("scratch");
    expect(created.workspaceId).toBe("w9");
    expect(wsStub.calls[0]?.body).toEqual({ label: "scratch", cwd: null });
  });

  test("integrations unwraps the list", async () => {
    const stub = recordingFetch(() =>
      ok({
        integrations: [
          { target: "agy", label: "Antigravity", command: "agy", available: true, state: "current" },
        ],
      }),
    );
    const client = new HerdrClient(CONFIG, stub.fetch);
    const list = await client.integrations();
    expect(list).toHaveLength(1);
    expect(list[0]?.target).toBe("agy");
  });

  test("a 503 problem becomes a GatewayError with retryable passthrough", async () => {
    const stub = recordingFetch(() =>
      new Response(
        JSON.stringify({ code: "herdr_unavailable", status: 503, retryable: true }),
        { status: 503 },
      ),
    );
    const client = new HerdrClient(CONFIG, stub.fetch);
    await expect(client.sendKeys("w1:p1", ["ctrl+c"])).rejects.toMatchObject({
      problem: { code: "herdr_unavailable", retryable: true },
    });
  });
});
