/**
 * Contract-client tests for the Loop gateway wire contract (ADR §4).
 *
 * Runs against a local mock gateway on an ephemeral loopback port. No real
 * network, no provider or model calls. Evidence covers: 202 submit shape,
 * problem mapping, bigint-as-string, SSE initial status / ordered output /
 * reset / terminal, Last-Event-ID replay after clean disconnect, and the
 * no-auto-resubmit rule.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GatewayClient, PromptValidationError } from "../src/gateway-client/client";
import { GatewayError } from "../src/gateway-client/problem";
import { createConnectionConfig } from "../src/auth/connection";
import { RunProjection } from "../src/state/runProjection";
import { createMockGateway, type MockGateway } from "./mock-gateway";
import {
  ACCEPTED,
  FRAME_IDS,
  OLD_RUN_ID,
  OUTPUT_FRAME_1,
  OUTPUT_FRAME_2,
  RESET_FRAME,
  RUN,
  RUN_ID,
  RUN_PAGE,
  STATUS_FRAME,
  TERMINAL_FRAME,
  TOKEN,
} from "./fixtures";
import type { RunStreamEvent } from "../src/gateway-client/wire";

let gateway: MockGateway;
let client: GatewayClient;

beforeAll(() => {
  gateway = createMockGateway();
  client = new GatewayClient(
    createConnectionConfig("127.0.0.1", gateway.url.split(":")[2]!, TOKEN),
  );
});

afterAll(() => {
  gateway.stop();
});

describe("sessionAttachmentUrl", () => {
  test("composes the M2 GET route over the configured base (v9 scripted attach)", () => {
    const url = client.sessionAttachmentUrl("sess_demo_v9_0008", "att_demo_upload_0001");
    expect(url).toBe(
      "http://127.0.0.1:" +
        gateway.url.split(":")[2]! +
        "/v1/sessions/sess_demo_v9_0008/attachments/att_demo_upload_0001",
    );
  });

  test("encodes path segments (ids are opaque, never parsed back)", () => {
    const url = client.sessionAttachmentUrl("sess/a b", "att/x?y");
    expect(url).toContain("/sessions/sess%2Fa%20b/attachments/att%2Fx%3Fy");
  });
});

function collect(): { events: RunStreamEvent[]; done: Promise<void> } {
  const events: RunStreamEvent[] = [];
  const done = client.observeRun(RUN_ID, (event) => events.push(event));
  return { events, done };
}

describe("submit", () => {
  test("returns the accepted run summary from a 202 with contract headers", async () => {
    const accepted = await client.submitPrompt("Implement the remote gateway and verify it", {
      displayName: "Loopy's phone",
    });

    expect(accepted).toEqual(ACCEPTED);
    expect(accepted.run.status).toBe("accepted");
    expect(accepted.run.terminal).toBe(false);
    expect(accepted.run.lastSequence).toBeNull();
    expect(accepted.run.taskCounts).toEqual({
      pending: 0,
      running: 0,
      attention: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    });

    const post = gateway.requests.at(-1);
    expect(post?.method).toBe("POST");
    expect(post?.path).toBe("/v1/runs");
    expect(post?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(post?.requestId).toMatch(/^req_[0-9a-f]{24}$/);

    const body = JSON.parse(post?.body ?? "{}") as Record<string, unknown>;
    expect(body).toEqual({
      prompt: "Implement the remote gateway and verify it",
      clientContext: { displayName: "Loopy's phone" },
    });
  });

  test("rejects empty and oversized prompts before any network round trip", async () => {
    expect(() => client.submitPrompt("   ")).toThrow(PromptValidationError);
    expect(() => client.submitPrompt("x".repeat(64 * 1024 + 1))).toThrow(PromptValidationError);
    const posts = gateway.requests.filter((r) => r.method === "POST").length;
    expect(posts).toBe(1); // no additional requests were made
  });

  test("maps a 400 problem body and does not retry (submit is not idempotent)", async () => {
    let attempts = 0;
    const c = new GatewayClient(createConnectionConfig("127.0.0.1", 1, TOKEN), async () => {
      attempts++;
      return new Response(
        JSON.stringify({
          type: "https://loop.local/problems/invalid_request",
          title: "Invalid request",
          status: 400,
          code: "invalid_request",
          detail: "Schema validation failed.",
          requestId: "req_srv_1",
          retryable: false,
          fields: { prompt: "must not be empty" },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/problem+json", "X-Request-Id": "req_srv_1" },
        },
      );
    });
    let error: GatewayError | null = null;
    try {
      await c.submitPrompt("valid-looking prompt");
    } catch (e) {
      error = e as GatewayError;
    }
    expect(error).not.toBeNull();
    expect(error?.problem.code).toBe("invalid_request");
    expect(error?.problem.status).toBe(400);
    expect(error?.problem.fields).toEqual({ prompt: "must not be empty" });
    expect(error?.problem.requestId).toBe("req_srv_1");
    expect(attempts).toBe(1);
  });

  test("maps 401 unauthorized as non-retryable", async () => {
    const bad = new GatewayClient(
      createConnectionConfig("127.0.0.1", gateway.url.split(":")[2]!, "wrong-token"),
    );
    let error: GatewayError | null = null;
    try {
      await bad.getRun(RUN_ID);
    } catch (e) {
      error = e as GatewayError;
    }
    expect(error?.problem.code).toBe("unauthorized");
    expect(error?.problem.status).toBe(401);
    expect(error?.retryable).toBe(false);
  });
});

describe("list and get", () => {
  test("preserves decimal-string u64 values and page shape", async () => {
    const page = await client.listRuns(20);
    expect(page).toEqual(RUN_PAGE);
    expect(typeof page.runs[0]!.lastSequence).toBe("string");
    expect(page.runs[1]!.lastSequence).toBe("128");
    expect(page.nextCursor).toBeNull();

    const run = await client.getRun(RUN_ID);
    expect(run).toEqual(RUN);
    expect(run.attention?.kind).toBe("decision");
    expect(run.tasks[0]!.status).toBe("running");
  });

  test("maps unknown run to run_not_found", async () => {
    let error: GatewayError | null = null;
    try {
      await client.getRun("run_missing");
    } catch (e) {
      error = e as GatewayError;
    }
    expect(error?.problem.code).toBe("run_not_found");
    expect(error?.problem.status).toBe(404);
  });
});

describe("event stream", () => {
  test("delivers initial status, ordered outputs, and terminal, then stops", async () => {
    const connectionsBefore = gateway.eventLastEventIds.length;
    const { events, done } = collect();
    await done;

    expect(events.map((e) => e.kind)).toEqual(["status", "output", "output", "terminal"]);
    expect(events[0]).toEqual({ kind: "status", frame: STATUS_FRAME });
    expect(events[1]).toEqual({ kind: "output", frame: OUTPUT_FRAME_1 });
    expect(events[2]).toEqual({ kind: "output", frame: OUTPUT_FRAME_2 });
    expect(events[3]).toEqual({ kind: "terminal", frame: TERMINAL_FRAME });
    const terminal = events[3];
    if (terminal?.kind !== "terminal") throw new Error("missing terminal frame");
    expect(terminal.frame.run.terminal).toBe(true);
    // terminal ends observation: exactly one connection was opened
    expect(gateway.eventLastEventIds.length).toBe(connectionsBefore + 1);
  });

  test("reconnects after a clean non-terminal disconnect with Last-Event-ID replay", async () => {
    gateway.disconnectAfterFirstFrame();
    const { events, done } = collect();
    await done;

    expect(events.map((e) => e.kind)).toEqual(["status", "output", "output", "terminal"]);
    // First connection had no cursor; second resumed exactly after frame 1.
    expect(gateway.eventLastEventIds.slice(-2)).toEqual([null, FRAME_IDS.status]);
  });

  test("surfaces a stale cursor as a reset event carrying the authoritative run", async () => {
    const events: RunStreamEvent[] = [];
    await client.observeRun(RUN_ID, (e) => events.push(e), { lastEventId: "gen0-n999999" });

    const reset = events[0];
    if (reset?.kind !== "reset") throw new Error("missing reset frame");
    expect(reset.frame.reason).toBe("cursor_unavailable");
    expect(reset.frame.run).toEqual(STATUS_FRAME.run);
    expect(events.map((e) => e.kind)).toEqual(["reset", "terminal"]);
    void RESET_FRAME;
    void OLD_RUN_ID;
  });

  test("requires Accept: text/event-stream (406 maps to stream_not_acceptable)", async () => {
    const response = await fetch(`${gateway.url}/v1/runs/${RUN_ID}/events`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    });
    expect(response.status).toBe(406);
    const problem = (await response.json()) as { code: string };
    expect(problem.code).toBe("stream_not_acceptable");
  });
});

describe("projection integration", () => {
  test("stream events reduce into a deduplicated, terminal run state", async () => {
    const projection = new RunProjection(RUN_ID);
    await client.observeRun(RUN_ID, (event) => {
      switch (event.kind) {
        case "status":
          projection.applyStatus(event.frame);
          break;
        case "output":
          projection.applyOutput(event.frame);
          break;
        case "reset":
          projection.applyReset(event.frame);
          break;
        case "terminal":
          projection.applyTerminal(event.frame);
          break;
      }
    });

    const state = projection.snapshot();
    expect(state.terminal).toBe(true);
    expect(state.stale).toBe(false);
    expect(state.run?.status).toBe("completed");
    expect(state.outputs.map((o) => o.activityId)).toEqual([
      "57:gateway-app:3",
      "57:gateway-app:4",
    ]);
  });
});
