/**
 * Gateway probe tests: the connect-time reachability/auth check that gates
 * credential persistence (decision D2-1). Stubbed fetch — no network, no
 * paid model calls.
 */

import { describe, expect, test } from "bun:test";

import { probeGateway } from "../src/gateway-client/probe";
import { GatewayError } from "../src/gateway-client/problem";
import type { FetchLike } from "../src/gateway-client/client";
import { createConnectionConfig } from "../src/auth/connection";

const CONFIG = createConnectionConfig("gw.tailnet.ts.net", "18477", "tok_test_bearer");

describe("probeGateway", () => {
  test("probes GET /v1/runs with bearer auth and resolves on 200", async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      seen.push({
        url: String(input),
        auth: new Headers(init?.headers).get("Authorization") ?? undefined,
      });
      return new Response(JSON.stringify({ runs: [], cursor: null }), { status: 200 });
    };
    await probeGateway(CONFIG, fetchImpl);
    expect(seen).toEqual([
      { url: "http://gw.tailnet.ts.net:18477/v1/runs?limit=1", auth: "Bearer tok_test_bearer" },
    ]);
  });

  test("non-200 becomes GatewayError with the problem contract", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ code: "unauthorized", status: 401 }), { status: 401 });
    expect(probeGateway(CONFIG, fetchImpl)).rejects.toBeInstanceOf(GatewayError);
  });

  test("network failure propagates", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("network request failed");
    };
    expect(probeGateway(CONFIG, fetchImpl)).rejects.toThrow("network request failed");
  });

  test("a hanging gateway aborts into a timeout error", async () => {
    const fetchImpl: FetchLike = (input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    expect(probeGateway(CONFIG, fetchImpl, 10)).rejects.toThrow("gateway probe timed out");
  });
});
