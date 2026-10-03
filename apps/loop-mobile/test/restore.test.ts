/**
 * Session restore policy tests (decision 2026-xx-app-credential-persistence.md
 * D2-2/D2-3, acceptance #5): auto-connect on relaunch, fallback WITHOUT
 * deleting the stored entry, and token-free failure reasons. Deterministic —
 * mocked store + probe, no native module, no network.
 */

import { describe, expect, test } from "bun:test";

import {
  createGatewayCredentialStore,
  storedToConnectionConfig,
  type GatewayKeychainPort,
} from "../src/auth/credentialStore";
import { describeConnectFailure, restoreSession } from "../src/auth/restore";
import { GatewayError } from "../src/gateway-client/problem";

function mockKeychainWith(stored: { username: string; password: string } | null) {
  let item = stored;
  const port: GatewayKeychainPort = {
    async save(username, password) {
      item = { username, password };
      return true;
    },
    async load() {
      return item === null ? null : { ...item };
    },
    async clear() {
      item = null;
      return true;
    },
  };
  return { port, item: () => item };
}

const STORED = { username: "gw.tailnet.ts.net:18477", password: "tok_test_bearer" };
const OK_PROBE = async () => {};

describe("restoreSession", () => {
  test("fresh device → none; probe never invoked", async () => {
    let probes = 0;
    const outcome = await restoreSession({
      store: createGatewayCredentialStore(mockKeychainWith(null).port),
      connect: async () => {
        probes += 1;
      },
    });
    expect(outcome).toEqual({ kind: "none" });
    expect(probes).toBe(0);
  });

  test("stored + probe success → restored with the stored config", async () => {
    const outcome = await restoreSession({
      store: createGatewayCredentialStore(mockKeychainWith(STORED).port),
      connect: OK_PROBE,
    });
    expect(outcome.kind).toBe("restored");
    if (outcome.kind === "restored") {
      expect(outcome.config.baseUrl).toBe("http://gw.tailnet.ts.net:18477");
      expect(outcome.config.bearer).toBe("tok_test_bearer");
    }
  });

  test("stored tokenless SETTING + probe success → restored tokenless (QR pairing decision §3.2)", async () => {
    // The relaunch-restore contract for a QR-paired tokenless connection:
    // the saved host:port restores as a tokenless config (empty bearer).
    const outcome = await restoreSession({
      store: createGatewayCredentialStore(
        mockKeychainWith({ username: "gw.tailnet.ts.net:18477", password: "tokenless" }).port,
      ),
      connect: OK_PROBE,
    });
    expect(outcome.kind).toBe("restored");
    if (outcome.kind === "restored") {
      expect(outcome.config.baseUrl).toBe("http://gw.tailnet.ts.net:18477");
      expect(outcome.config.bearer).toBe("");
    }
  });

  test("probe failure → fallback keeps the stored entry (no delete)", async () => {
    const mock = mockKeychainWith(STORED);
    const outcome = await restoreSession({
      store: createGatewayCredentialStore(mock.port),
      connect: async () => {
        throw new Error("connect EHOSTUNREACH");
      },
    });
    expect(outcome.kind).toBe("fallback");
    if (outcome.kind === "fallback") {
      expect(outcome.config.baseUrl).toBe("http://gw.tailnet.ts.net:18477");
      expect(outcome.reason).not.toContain("tok_test_bearer");
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
    // Acceptance #5: fallback must NOT delete the stored credential.
    expect(mock.item()).toEqual(STORED);
  });

  test("gateway rejection reason carries status/code only, never the token", async () => {
    const problem = {
      type: "about:blank",
      title: "unauthorized",
      status: 401,
      code: "unauthorized",
      detail: `invalid bearer tok_test_bearer`, // hostile detail echoing the token
      requestId: "req_test",
      retryable: false,
      fields: null,
    };
    const outcome = await restoreSession({
      store: createGatewayCredentialStore(mockKeychainWith(STORED).port),
      connect: async () => {
        throw new GatewayError(problem);
      },
    });
    expect(outcome.kind).toBe("fallback");
    if (outcome.kind === "fallback") {
      expect(outcome.reason).toContain("401");
      expect(outcome.reason).toContain("unauthorized");
      expect(outcome.reason).not.toContain("tok_test_bearer");
    }
  });

  test("keychain read failure propagates (caller falls back to manual, entry untouched)", async () => {
    const port: GatewayKeychainPort = {
      async save() {
        return true;
      },
      async load() {
        throw new Error("keychain unavailable");
      },
      async clear() {
        throw new Error("keychain unavailable");
      },
    };
    expect(
      restoreSession({ store: createGatewayCredentialStore(port), connect: OK_PROBE }),
    ).rejects.toThrow("keychain unavailable");
  });
});

describe("storedToConnectionConfig", () => {
  test("validated stored credentials become the in-memory config", () => {
    const config = storedToConnectionConfig({
      host: "gw.tailnet.ts.net",
      port: 18477,
      bearer: "tok",
    });
    expect(config).toEqual({ baseUrl: "http://gw.tailnet.ts.net:18477", bearer: "tok" });
  });
});

describe("describeConnectFailure", () => {
  test("network errors map to a token-free unreachable notice", () => {
    const reason = describeConnectFailure(new Error("network request failed"));
    expect(reason).not.toContain("tok");
    expect(reason).toContain("unreachable");
  });
});
