/**
 * Tokenless connect tests (decision 2026-xx-tokenless-auth-and-app-layout
 * §D-A1): an empty bearer is the normal first-run case on a Tailscale-bound
 * gateway — the app sends no Authorization header at all. A non-empty bearer
 * selects the explicit fallback (§D-A3). Stubbed fetch — no network, no
 * paid model calls.
 */

import { describe, expect, test } from "bun:test";

import {
  connectionConfigFromUrl,
  createConnectionConfig,
  ConnectionConfigError,
  parseBaseUrl,
} from "../src/auth/connection";
import { decodeStoredCredentials } from "../src/auth/credentialStore";
import { probeGateway } from "../src/gateway-client/probe";
import type { FetchLike } from "../src/herdr/client";

/** A bearer-only listener that rejects the tokenless probe with 401. */
const unauthorizedFetchImpl: FetchLike = async () =>
  new Response(JSON.stringify({ code: "unauthorized", status: 401 }), { status: 401 });

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

describe("serve-TLS URL connection config (2026-10-22 amendment)", () => {
  test("an https URL builds the https base URL, port optional (443 implied)", () => {
    expect(connectionConfigFromUrl("https://gw.tail42f248.ts.net")).toEqual({
      baseUrl: "https://gw.tail42f248.ts.net",
      bearer: "",
    });
    expect(connectionConfigFromUrl("https://gw.tail42f248.ts.net:8443", " tok ")).toEqual({
      baseUrl: "https://gw.tail42f248.ts.net:8443",
      bearer: "tok",
    });
  });

  test("a plain http URL is accepted with its explicit port", () => {
    expect(connectionConfigFromUrl("http://100.80.133.120:18477")).toEqual({
      baseUrl: "http://100.80.133.120:18477",
      bearer: "",
    });
  });

  test("paths, bare hosts, junk ports, and empty hosts fail closed", () => {
    expect(() => connectionConfigFromUrl("https://gw.ts.net/v1")).toThrow(ConnectionConfigError);
    expect(() => connectionConfigFromUrl("gw.ts.net")).toThrow(ConnectionConfigError);
    expect(() => connectionConfigFromUrl("https://gw.ts.net:")).toThrow(ConnectionConfigError);
    expect(() => connectionConfigFromUrl("https://gw.ts.net:zero")).toThrow(ConnectionConfigError);
    expect(() => connectionConfigFromUrl("https://:443")).toThrow(ConnectionConfigError);
    expect(() => connectionConfigFromUrl("ftp://gw.ts.net")).toThrow(ConnectionConfigError);
  });

  test("parseBaseUrl recovers host, port, and scheme from both shapes", () => {
    expect(parseBaseUrl("http://gw.tailnet.ts.net:18477")).toEqual({
      host: "gw.tailnet.ts.net",
      port: 18477,
      tls: false,
    });
    expect(parseBaseUrl("https://gw.tailnet.ts.net")).toEqual({
      host: "gw.tailnet.ts.net",
      port: 443,
      tls: true,
    });
    expect(() => parseBaseUrl("ftp://gw.tailnet.ts.net")).toThrow(ConnectionConfigError);
  });
});

describe("tokenless probe (no Authorization header)", () => {
  test("empty bearer sends no Authorization header and resolves on 200", async () => {
    const config = createConnectionConfig("gw.tailnet.ts.net", "18477", "");
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get("Authorization") });
      return new Response(JSON.stringify({ available: true, version: 1, panes: [] }), { status: 200 });
    };
    await probeGateway(config, fetchImpl);
    expect(seen).toEqual([{ url: "http://gw.tailnet.ts.net:18477/v1/herdr/state", auth: null }]);
  });

  test("a 401 from a bearer-only listener still fails the tokenless probe", async () => {
    const config = createConnectionConfig("gw.tailnet.ts.net", "18477", "");
    await expect(probeGateway(config, unauthorizedFetchImpl)).rejects.toMatchObject({
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
      tls: false,
      bearer: "tok_fallback",
    });
  });

  test("a serve-TLS item decodes with its scheme; legacy entries read as http", () => {
    expect(decodeStoredCredentials("https://gw.tailnet.ts.net:8443", "tok_tls")).toEqual({
      host: "gw.tailnet.ts.net",
      port: 8443,
      tls: true,
      bearer: "tok_tls",
    });
    expect(decodeStoredCredentials("https://gw.tailnet.ts.net:8443", "tokenless")).toEqual({
      host: "gw.tailnet.ts.net",
      port: 8443,
      tls: true,
      bearer: "",
    });
    expect(decodeStoredCredentials("gw.tailnet.ts.net:18477", "tokenless")).toEqual({
      host: "gw.tailnet.ts.net",
      port: 18477,
      tls: false,
      bearer: "",
    });
  });
});
