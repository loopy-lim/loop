/**
 * Gateway probe tests: the connect-time reachability/auth check that gates
 * credential persistence (decision D2-1). The probe endpoint is now the
 * herdr state route (rebuild brief §4) — 200 means the gateway AND its
 * herdr surface answer. Stubbed fetch — no network, no paid model calls.
 */

import { describe, expect, test } from "bun:test";

import { probeGateway } from "../src/gateway-client/probe";
import { GatewayError } from "../src/gateway-client/problem";
import { createConnectionConfig } from "../src/auth/connection";
import type { FetchLike } from "../src/herdr/client";

const CONFIG = createConnectionConfig("gw.tailnet.ts.net", "18477", "tok_test_bearer");

const STATE_BODY = JSON.stringify({ available: true, version: 1, panes: [] });

/** A listener that answers every probe with a 401 problem document. */
const unauthorizedFetchImpl: FetchLike = async () =>
  new Response(JSON.stringify({ code: "unauthorized", status: 401 }), { status: 401 });

/** A fetch that always throws (transport-level failure). */
const networkFailureFetchImpl: FetchLike = async () => {
  throw new Error("network request failed");
};

/** A fetch that never settles until the probe's abort signal fires. */
const hangingFetchImpl: FetchLike = (_input, init) =>
  new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")),
    );
  });

describe("probeGateway", () => {
  test("probes GET /v1/herdr/state with bearer auth and resolves on 200", async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      seen.push({
        url: String(input),
        auth: new Headers(init?.headers).get("Authorization") ?? undefined,
      });
      return new Response(STATE_BODY, { status: 200 });
    };
    await probeGateway(CONFIG, fetchImpl);
    expect(seen).toEqual([
      { url: "http://gw.tailnet.ts.net:18477/v1/herdr/state", auth: "Bearer tok_test_bearer" },
    ]);
  });

  test("non-200 becomes GatewayError with the problem contract", async () => {
    expect(probeGateway(CONFIG, unauthorizedFetchImpl)).rejects.toBeInstanceOf(GatewayError);
  });

  test("network failure propagates", async () => {
    expect(probeGateway(CONFIG, networkFailureFetchImpl)).rejects.toThrow("network request failed");
  });

  test("a hanging gateway aborts into a timeout error", async () => {
    expect(probeGateway(CONFIG, hangingFetchImpl, 10)).rejects.toThrow("gateway probe timed out");
  });
});
