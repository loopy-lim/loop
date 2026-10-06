/**
 * Resilience contract (task `mobile-resilience`): the app survives mid-run
 * interruptions without losing data or hanging silently.
 *
 * Covered axes:
 * 1. 429 rate limiting — submit/steer/observe honor Retry-After verbatim,
 *    fall back to exponential backoff + jitter without a hint, and GIVE UP
 *    past a bounded threshold with a user-displayable GatewayError.
 * 2. Mid-stream dropout — Last-Event-ID cursor replay delivers every frame
 *    exactly once (no loss, no duplication), proven end-to-end against the
 *    mock gateway.
 * 3. Submit/steer fallback — network failures stay user-driven (one attempt,
 *    onFailure, draft preserved by contract) while 429 stays client-recoverable.
 * 4. Classification — 429 is retryable even with a junk problem body;
 *    401/403 and other statuses never are.
 *
 * No real network beyond loopback, no model calls, no real waits (the mock
 * gateway scripts Retry-After: 0; the delay curves are unit-tested pure).
 */

import { describe, expect, test } from "bun:test";

import { createConnectionConfig } from "../src/auth/connection";
import { GatewayClient } from "../src/gateway-client/client";
import { GatewayError, parseProblem, parseRetryAfter, responseError } from "../src/gateway-client/problem";
import {
  BACKOFF_BASE_MS,
  POST_429_MAX_ATTEMPTS,
  STREAM_429_MAX_RETRIES,
  post429DelayMs,
  streamRetryDelayMs,
} from "../src/gateway-client/retry";
import { sendComposerText } from "../src/state/composer";
import type { ConversationStreamEvent } from "../src/gateway-client/conversation";
import type { FetchLike } from "../src/gateway-client/client";
import { TOKEN } from "./fixtures";
import { SESSION_GONE, SESSION_ID } from "./conversation-fixtures";
import { createMockGateway } from "./mock-gateway";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

const CONFIG = createConnectionConfig("gw.tailnet.ts.net", "18477", "tok_resilience");

function problemResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });
}

describe("Retry-After parsing (RFC 9110 delta-seconds and HTTP-date)", () => {
  test("delta-seconds map 1:1 to milliseconds (0 included)", () => {
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter(" 30 ")).toBe(30_000);
  });

  test("HTTP-date resolves to the remaining delay, never negative", () => {
    const future = new Date(Date.now() + 5_000).toUTCString();
    const parsed = must(parseRetryAfter(future));
    expect(parsed).toBeGreaterThan(0);
    expect(parsed).toBeLessThanOrEqual(5_000);
    expect(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });

  test("absent or junk header yields null (caller falls back to backoff)", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon-ish")).toBeNull();
  });
});

describe("429 delay policy: server hint wins, exponential backoff + jitter otherwise", () => {
  test("submit/steer delays honor Retry-After verbatim on every attempt", () => {
    expect(post429DelayMs(1, 5_000, 123)).toBe(5_000);
    expect(post429DelayMs(3, 0, 123)).toBe(0);
  });

  test("submit/steer without a hint: 1s → 2s → capped exponential, jitter added", () => {
    expect(post429DelayMs(1, null, 40)).toBe(BACKOFF_BASE_MS + 40);
    expect(post429DelayMs(2, null, 40)).toBe(2 * BACKOFF_BASE_MS + 40);
    expect(post429DelayMs(10, null, 40)).toBe(30_000 + 40);
  });

  test("stream delays honor Retry-After; otherwise backoff + jitter", () => {
    expect(streamRetryDelayMs(7_000, 1_000, 99)).toBe(7_000);
    expect(streamRetryDelayMs(null, 4_000, 99)).toBe(4_099);
    expect(streamRetryDelayMs(null, 500_000, 0)).toBe(30_000);
  });
});

describe("classification: retryable vs terminal is consistent", () => {
  test("429 is retryable even when the problem body is junk (status wins)", () => {
    const parsed = parseProblem(429, null);
    expect(parsed.retryable).toBe(true);
    expect(parsed.status).toBe(429);
  });

  test("401/403 are non-retryable regardless of body contents", () => {
    expect(parseProblem(401, null).retryable).toBe(false);
    expect(parseProblem(403, { code: "unauthorized" }).retryable).toBe(false);
    expect(parseProblem(403, { retryable: true }).retryable).toBe(false); // server lies → still terminal
  });

  test("GatewayError carries the parsed Retry-After from the response", async () => {
    const hinted = await responseError(
      problemResponse(429, { code: "capacity_exhausted", status: 429 }, { "Retry-After": "4" }),
    );
    expect(hinted).toBeInstanceOf(GatewayError);
    expect(hinted.retryable).toBe(true);
    expect(hinted.retryAfterMs).toBe(4_000);

    const unhinted = await responseError(problemResponse(429, "junk body"));
    expect(unhinted.retryAfterMs).toBeNull(); // caller falls back to backoff
    expect(unhinted.retryable).toBe(true); // status-based classification
  });
});

describe("429 on submit and steer (mock gateway, Retry-After: 0)", () => {
  // A dedicated gateway per describe block: rate-limit scripting is stateful.
  const gateway = createMockGateway();
  const client = new GatewayClient(createConnectionConfig("127.0.0.1", Number(gateway.url.split(":")[2]), TOKEN));

  test("transient 429s are absorbed: submit succeeds on a later attempt", async () => {
    gateway.rateLimitNextPosts(2);
    const accepted = await client.submitPrompt("run the resilience suite");
    expect(accepted.run.runId).toBeTypeOf("string");
    const submits = gateway.requests.filter((r) => r.method === "POST" && r.path === "/v1/runs");
    expect(submits).toHaveLength(3); // 2 × 429, then the accepted attempt
  });

  test("steer honors the same 429 retry budget and succeeds", async () => {
    gateway.rateLimitNextPosts(1);
    const steer = await client.steerRun("run_01JMOBILEFIXTURE0001", "focus on tests");
    expect(steer.steerId).toBeTypeOf("string");
    const steers = gateway.requests.filter((r) => r.path.endsWith("/steer"));
    expect(steers).toHaveLength(2); // 1 × 429, then accepted
  });

  test("past POST_429_MAX_ATTEMPTS submit gives up with a displayable GatewayError", async () => {
    const before = gateway.requests.filter((r) => r.method === "POST" && r.path === "/v1/runs").length;
    gateway.rateLimitNextPosts(POST_429_MAX_ATTEMPTS + 1);
    let caught: unknown = null;
    try {
      await client.submitPrompt("this one hits a saturated gateway");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayError);
    const error = caught as GatewayError;
    expect(error.problem.status).toBe(429);
    expect(error.retryable).toBe(true);
    // The composer renders e.message verbatim: status + code, no bearer.
    expect(error.message).toContain("429");
    expect(error.message).toContain("capacity_exhausted");
    expect(error.message).not.toContain("tok_resilience");
    // Exactly the retry budget was spent, then the give-up throw.
    const after = gateway.requests.filter((r) => r.method === "POST" && r.path === "/v1/runs").length;
    expect(after - before).toBe(POST_429_MAX_ATTEMPTS);
  });

  test("a network failure still gets exactly ONE submit attempt (non-idempotent)", async () => {
    let attempts = 0;
    const flaky: FetchLike = async () => {
      attempts += 1;
      throw new TypeError("Network request failed");
    };
    const isolated = new GatewayClient(CONFIG, flaky);
    await expect(isolated.submitPrompt("no auto resubmit")).rejects.toBeInstanceOf(TypeError);
    expect(attempts).toBe(1);
  });

  test("a 400 problem still gets exactly ONE submit attempt (no other status retried)", async () => {
    let attempts = 0;
    const badRequest: FetchLike = async () => {
      attempts += 1;
      return problemResponse(400, {
        type: "about:blank",
        title: "Invalid request",
        status: 400,
        code: "invalid_request",
        detail: "Schema validation failed.",
        requestId: "req_x",
        retryable: false,
        fields: null,
      });
    };
    const isolated = new GatewayClient(CONFIG, badRequest);
    await expect(isolated.submitPrompt("no retry on 400")).rejects.toBeInstanceOf(GatewayError);
    expect(attempts).toBe(1);
  });
});

describe("429 on live streams + cursor replay (mock gateway)", () => {
  const gateway = createMockGateway();
  const client = new GatewayClient(
    createConnectionConfig("127.0.0.1", Number(gateway.url.split(":")[2]), TOKEN),
  );

  test("a 429'd SSE connection is retried with the hinted delay and loses nothing", async () => {
    gateway.rateLimitNextStreams(1, "0");
    const retries: Array<{ delayMs: number }> = [];
    const events: ConversationStreamEvent[] = [];
    await client.observeSession(SESSION_ID, (event) => events.push(event), {
      onRetryableError: (_error, delayMs) => retries.push({ delayMs }),
    });
    // The refused connection was retried with the Retry-After hint (0ms),
    // and the follow-up connection delivered the whole stream untouched.
    expect(retries).toHaveLength(1);
    expect(retries[0]?.delayMs).toBe(0);
    expect(events.at(-1)?.frame).toEqual(SESSION_GONE);
  });

  test("persistent 429s past STREAM_429_MAX_RETRIES give up with a displayable error", async () => {
    const before = gateway.requests.filter(
      (r) => r.method === "GET" && r.path.endsWith("/events"),
    ).length;
    gateway.rateLimitNextStreams(STREAM_429_MAX_RETRIES + 1, "0");
    const retries: number[] = [];
    let caught: unknown = null;
    try {
      await client.observeSession(SESSION_ID, () => undefined, {
        onRetryableError: (_error, delayMs) => retries.push(delayMs),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayError);
    const error = caught as GatewayError;
    expect(error.problem.status).toBe(429);
    expect(error.retryable).toBe(true);
    // First connection + exactly the retry budget, then the give-up throw.
    const attempts = gateway.requests.filter(
      (r) => r.method === "GET" && r.path.endsWith("/events"),
    ).length;
    expect(attempts - before).toBe(STREAM_429_MAX_RETRIES + 1);
    expect(retries).toHaveLength(STREAM_429_MAX_RETRIES);
  });

  test("mid-stream dropout: cursor replay loses no frame and duplicates nothing", async () => {
    // Control: uninterrupted stream.
    const control: ConversationStreamEvent[] = [];
    await client.observeSession(SESSION_ID, (event) => control.push(event));
    expect(control.length).toBeGreaterThan(2);
    expect(control.at(-1)?.frame).toEqual(SESSION_GONE);
    // Interrupted: the gateway drops the TCP stream after the first frame.
    const interrupted: ConversationStreamEvent[] = [];
    gateway.disconnectNextSessionStreamAfterFirstFrame();
    await client.observeSession(SESSION_ID, (event) => interrupted.push(event));
    // Every frame arrived in order, exactly once — 유실분 없이 이어받기.
    expect(interrupted.map((e) => e.kind)).toEqual(control.map((e) => e.kind));
    expect(JSON.stringify(interrupted)).toBe(JSON.stringify(control));
  });
});

describe("composer fallback survives the 429 path (draft preservation contract)", () => {
  test("a saturated gateway surfaces one onFailure message; retry then succeeds", async () => {
    const gateway = createMockGateway();
    const client = new GatewayClient(
      createConnectionConfig("127.0.0.1", Number(gateway.url.split(":")[2]), TOKEN),
    );
    gateway.rateLimitNextPosts(POST_429_MAX_ATTEMPTS);
    const failures: string[] = [];
    const successes: Array<{ runId: string | null }> = [];

    // First press: every attempt 429s → the user-visible failure message.
    await sendComposerText(client, {
      target: { kind: "prompt" },
      text: "same text both times",
      onSuccess: (result) => successes.push(result),
      onFailure: (message) => failures.push(message),
    });
    expect(successes).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("429");

    // Resend: same text, same path, capacity recovered → success clears the draft.
    await sendComposerText(client, {
      target: { kind: "prompt" },
      text: "same text both times",
      onSuccess: (result) => successes.push(result),
      onFailure: (message) => failures.push(message),
    });
    expect(successes).toEqual([{ runId: expect.any(String) }]);
    expect(failures).toHaveLength(1);
  });
});
