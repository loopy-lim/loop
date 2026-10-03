/**
 * Tokenless connect tests (decision 2026-xx-tokenless-auth-and-app-layout
 * §D-A1): an empty bearer is the normal first-run case on a Tailscale-bound
 * gateway — the app sends no Authorization header at all. A non-empty bearer
 * selects the explicit fallback (§D-A3). Stubbed fetch — no network, no
 * paid model calls.
 */

import { describe, expect, test } from "bun:test";

import { createConnectionConfig, ConnectionConfigError } from "../src/auth/connection";
import { decodeStoredCredentials } from "../src/auth/credentialStore";
import { probeGateway } from "../src/gateway-client/probe";
import type { FetchLike } from "../src/gateway-client/client";

describe("tokenless connection config", () => {
  test("an empty bearer is valid and normalizes to the tokenless empty string", () => {
    const config = createConnectionConfig("gw.tailnet.ts.net", "18477", "");
    expect(config).toEqual({ baseUrl: "http://gw.tailnet.ts.net:18477", bearer: "" });
  });

  test("bearer defaults to empty when omitted", () => {
    const config = createConnectionConfig("gw.tailnet.ts.net", 18477);
    expect(config.bearer).toBe("");
  });

  test("host and port shape errors still fail closed", () => {
    expect(() => createConnectionConfig("", "18477")).toThrow(ConnectionConfigError);
    expect(() => createConnectionConfig("http://gw", "18477")).toThrow(ConnectionConfigError);
    expect(() => createConnectionConfig("gw.tailnet.ts.net", "0")).toThrow(ConnectionConfigError);
  });

  test("a non-empty bearer still selects the fallback", () => {
    const config = createConnectionConfig("gw.tailnet.ts.net", "18477", " tok_fallback ");
    expect(config.bearer).toBe("tok_fallback");
  });
});

describe("tokenless probe (no Authorization header)", () => {
  test("empty bearer sends no Authorization header and resolves on 200", async () => {
    const config = createConnectionConfig("gw.tailnet.ts.net", "18477", "");
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get("Authorization") });
      return new Response(JSON.stringify({ runs: [], cursor: null }), { status: 200 });
    };
    await probeGateway(config, fetchImpl);
    expect(seen).toEqual([{ url: "http://gw.tailnet.ts.net:18477/v1/runs?limit=1", auth: null }]);
  });

  test("a 401 from a bearer-only listener still fails the tokenless probe", async () => {
    const config = createConnectionConfig("gw.tailnet.ts.net", "18477", "");
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ code: "unauthorized", status: 401 }), { status: 401 });
    await expect(probeGateway(config, fetchImpl)).rejects.toMatchObject({
      problem: { status: 401 },
    });
  });
});

describe("keychain stays bearer-fallback only", () => {
  test("an empty stored password decodes to null (nothing tokenless is ever stored)", () => {
    expect(decodeStoredCredentials("gw.tailnet.ts.net:18477", "")).toBeNull();
  });

  test("a real fallback item still decodes", () => {
    expect(decodeStoredCredentials("gw.tailnet.ts.net:18477", "tok_fallback")).toEqual({
      host: "gw.tailnet.ts.net",
      port: 18477,
      bearer: "tok_fallback",
    });
  });
});
