/**
 * Remote spawn contract-client + flow tests (task `spawn-app-ui`, decision
 * 2026-xx-session-spawn §D-C/§D-D).
 *
 * Runs against scripted fetch seams and fake inventory feeds. No real
 * network, no tmux execution, no provider or model calls. Evidence covers:
 * the POST /v1/sessions/spawn framing (route, JSON content-type, bearer /
 * tokenless auth, request id), the 201 SpawnOutcome shape, deterministic
 * problem mapping with NO retry (spawning is not idempotent — a retry would
 * open a second terminal window), the before/after session discovery
 * (`awaitSpawnedSession`), and the learned-gate classification
 * (`spawn_disabled` / `not_found`).
 */

import { describe, expect, test } from "bun:test";

import { GatewayClient, type FetchLike } from "../src/gateway-client/client";
import { GatewayError } from "../src/gateway-client/problem";
import { createConnectionConfig } from "../src/auth/connection";
import {
  awaitSpawnedSession,
  describeSpawnProblem,
  isSpawnGateProblem,
} from "../src/features/session-spawn";
import { TOKEN } from "./fixtures";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

/** An already-resolved sleep (discovery polls without wall-clock delay). */
const INSTANT = (): Promise<void> => Promise.resolve();

/** 403 problem fixture for spawn-gate classification + copy tests. */
function gatewayError(
  code: string,
  detail: string,
  fields: Record<string, string> | null,
): GatewayError {
  return new GatewayError({
    type: `https://loop.local/problems/${code}`,
    title: code,
    status: 403,
    code,
    detail,
    requestId: "req_srv_1",
    retryable: false,
    fields,
  });
}

const PORT = "18477";

function clientWith(fetchImpl: FetchLike, bearer: string = TOKEN): GatewayClient {
  return new GatewayClient(createConnectionConfig("127.0.0.1", PORT, bearer), fetchImpl);
}

/** A fetch seam that records the request and answers with `status`. */
function scripted(
  status: number,
  body: unknown,
  contentType = "application/json; charset=utf-8",
): { client: GatewayClient; requests: { url: string; init: RequestInit }[] } {
  const requests: { url: string; init: RequestInit }[] = [];
  const client = clientWith(async (url, init) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": contentType, "X-Request-Id": "req_srv_spawn" },
    });
  });
  return { client, requests };
}

const SPAWN_201 = {
  spawnId: "abc12345",
  tmuxTarget: "loop:pi-abc12345",
  paneId: "%7",
  pid: 4711,
  cwd: "/work/nested",
  launcher: "tmux" as const,
};

describe("spawnTuiSession — POST /v1/sessions/spawn contract", () => {
  test("posts an empty JSON body to the spawn route and returns the 201 handle", async () => {
    const { client, requests } = scripted(201, SPAWN_201);

    const outcome = await client.spawnTuiSession();

    expect(outcome).toEqual(SPAWN_201);
    expect(requests).toHaveLength(1);
    const { url, init } = must(requests[0]);
    expect(url).toBe(`http://127.0.0.1:${PORT}/v1/sessions/spawn`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect((init.headers as Record<string, string>)["X-Request-Id"]).toMatch(/^req_[0-9a-f]{24}$/);
    expect(init.body).toBe("{}"); // omitted cwd → server default cwd
  });

  test("carries an explicitly requested cwd and none of the gate state", async () => {
    const { client, requests } = scripted(201, SPAWN_201);
    await client.spawnTuiSession("/work/nested");
    expect(JSON.parse(requests[0]?.init.body as string)).toEqual({ cwd: "/work/nested" });
  });

  test("tokenless mode sends NO Authorization header (tailnet membership is the boundary)", async () => {
    const requests: { init: RequestInit }[] = [];
    const tokenless = new GatewayClient(
      createConnectionConfig("127.0.0.1", PORT, ""),
      async (_url, init) => {
        requests.push({ init: init ?? {} });
        return new Response(JSON.stringify(SPAWN_201), { status: 201 });
      },
    );
    await tokenless.spawnTuiSession();
    expect(requests).toHaveLength(1);
    expect((requests[0]?.init.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });

  test("maps `spawn_disabled` (403) to GatewayError and never retries", async () => {
    let attempts = 0;
    const client = clientWith(async () => {
      attempts += 1;
      return new Response(
        JSON.stringify({
          type: "https://loop.local/problems/spawn_disabled",
          title: "Spawn disabled",
          status: 403,
          code: "spawn_disabled",
          detail: "remote spawn is disabled on this gateway",
          requestId: "req_srv_1",
          retryable: false,
          fields: null,
        }),
        { status: 403, headers: { "Content-Type": "application/problem+json" } },
      );
    });

    let error: unknown = null;
    try {
      await client.spawnTuiSession();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GatewayError);
    const problem = (error as GatewayError).problem;
    expect(problem.code).toBe("spawn_disabled");
    expect(problem.status).toBe(403);
    expect(problem.retryable).toBe(false);
    expect(attempts).toBe(1); // spawning is not idempotent: no retry, ever
  });

  test("maps `spawn_tmux_unavailable` (503) with its diagnostic fields", async () => {
    const { client } = scripted(
      503,
      {
        type: "https://loop.local/problems/spawn_tmux_unavailable",
        title: "tmux unavailable",
        status: 503,
        code: "spawn_tmux_unavailable",
        detail: "tmux is not available on the host",
        requestId: "req_srv_2",
        retryable: false,
        fields: { stage: "has-session", exitCode: "2" },
      },
      "application/problem+json",
    );

    let error: unknown = null;
    try {
      await client.spawnTuiSession();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).problem.code).toBe("spawn_tmux_unavailable");
    expect((error as GatewayError).problem.fields).toEqual({ stage: "has-session", exitCode: "2" });
  });
});

describe("awaitSpawnedSession — before/after inventory correlation", () => {
  test("opens the first NEWLY observed session id", async () => {
    const discovery = await awaitSpawnedSession({
      listSessions: async () => ({
        sessions: [{ sessionId: "sess_old" }, { sessionId: "sess_new_1" }],
      }),
      beforeIds: new Set(["sess_old"]),
      sleep: INSTANT,
      timeoutMs: 5_000,
    });
    expect(discovery).toEqual({ kind: "found", sessionId: "sess_new_1" });
  });

  test("never opens a pre-existing session id (the set is the whole point)", async () => {
    const discovery = await awaitSpawnedSession({
      listSessions: async () => ({ sessions: [{ sessionId: "sess_old" }] }),
      beforeIds: new Set(["sess_old"]),
      sleep: INSTANT,
      timeoutMs: 0,
    });
    expect(discovery).toEqual({ kind: "timeout" });
  });

  test("polls until the tap registration lands, in order, then stops", async () => {
    const polls: number[] = [];
    let call = 0;
    const slept: number[] = [];
    const discovery = await awaitSpawnedSession({
      listSessions: async () => {
        polls.push(call);
        call += 1;
        return call < 3
          ? { sessions: [{ sessionId: "sess_old" }] }
          : { sessions: [{ sessionId: "sess_new" }] };
      },
      beforeIds: new Set(["sess_old"]),
      timeoutMs: 60_000,
      pollIntervalMs: 250,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(discovery).toEqual({ kind: "found", sessionId: "sess_new" });
    expect(polls).toEqual([0, 1, 2]); // first poll immediate, then per interval
    expect(slept).toEqual([250, 250]); // slept BETWEEN polls only
  });

  test("transient inventory failures keep polling until the window closes", async () => {
    let calls = 0;
    const discovery = await awaitSpawnedSession({
      listSessions: async () => {
        calls += 1;
        if (calls < 3) throw new Error("inventory hiccup");
        return { sessions: [{ sessionId: "sess_new" }] };
      },
      beforeIds: new Set(),
      timeoutMs: 60_000,
      pollIntervalMs: 10,
      sleep: INSTANT,
    });
    expect(discovery).toEqual({ kind: "found", sessionId: "sess_new" });
    expect(calls).toBe(3);
  });

  test("times out honestly when the session never appears", async () => {
    const discovery = await awaitSpawnedSession({
      listSessions: async () => ({ sessions: [{ sessionId: "sess_old" }] }),
      beforeIds: new Set(["sess_old"]),
      timeoutMs: 30,
      pollIntervalMs: 10,
      sleep: INSTANT,
    });
    expect(discovery).toEqual({ kind: "timeout" });
  });
});

describe("problem surfacing — the reason the action failed", () => {
  test("formats code + detail + rule fields (fields never carry path values)", () => {
    expect(
      describeSpawnProblem(gatewayError("spawn_disabled", "remote spawn is disabled", null)),
    ).toBe("spawn_disabled — remote spawn is disabled");
    expect(
      describeSpawnProblem(
        gatewayError("spawn_cwd_outside_roots", "rejected", { cwd: "outside the allowed roots" }),
      ),
    ).toBe("spawn_cwd_outside_roots — rejected (cwd: outside the allowed roots)");
  });

  test("non-problem failures degrade to their message, never a blank string", () => {
    expect(describeSpawnProblem(new Error("network down"))).toBe("network down");
    expect(describeSpawnProblem("boom")).toBe("boom");
  });

  test("the learned gate covers exactly spawn_disabled and not_found", () => {
    expect(isSpawnGateProblem(gatewayError("spawn_disabled", "", null))).toBe(true);
    expect(isSpawnGateProblem(gatewayError("not_found", "", null))).toBe(true);
    expect(isSpawnGateProblem(gatewayError("spawn_tmux_unavailable", "", null))).toBe(false);
    expect(isSpawnGateProblem(new Error("network down"))).toBe(false);
  });
});
