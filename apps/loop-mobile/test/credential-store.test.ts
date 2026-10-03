/**
 * Credential store tests (decision 2026-xx-app-credential-persistence.md,
 * acceptance #3/#5): deterministic keychain mock — no native module, no
 * network, no paid model calls. The bearer values here are throwaway test
 * strings, never real tokens, and are only asserted against, never logged.
 */

import { describe, expect, test } from "bun:test";

import {
  createGatewayCredentialStore,
  decodeStoredCredentials,
  encodeCredentialUsername,
  TOKENLESS_PASSWORD_MARKER,
  type GatewayKeychainPort,
} from "../src/auth/credentialStore";
import { createConnectionConfig } from "../src/auth/connection";

/** In-memory single-slot keychain standing in for the OS secure store. */
function mockKeychain() {
  let item: { username: string; password: string } | null = null;
  const calls = { save: 0, load: 0, clear: 0 };
  const port: GatewayKeychainPort = {
    async save(username, password) {
      calls.save += 1;
      item = { username, password };
      return true;
    },
    async load() {
      calls.load += 1;
      return item === null ? null : { ...item };
    },
    async clear() {
      calls.clear += 1;
      item = null;
      return true;
    },
  };
  return { port, item: () => item, calls };
}

const CONFIG = createConnectionConfig("gw.tailnet.ts.net", "18477", "tok_test_bearer");

describe("credential username encoding", () => {
  test("encodes host:port; decodes losslessly", () => {
    expect(encodeCredentialUsername("gw.tailnet.ts.net", 18477)).toBe("gw.tailnet.ts.net:18477");
    expect(decodeStoredCredentials("gw.tailnet.ts.net:18477", "tok")).toEqual({
      host: "gw.tailnet.ts.net",
      port: 18477,
      bearer: "tok",
    });
  });

  test("malformed payloads decode to null (treated as not signed in)", () => {
    expect(decodeStoredCredentials("no-separator", "tok")).toBeNull();
    expect(decodeStoredCredentials(":18477", "tok")).toBeNull();
    expect(decodeStoredCredentials("host:", "tok")).toBeNull();
    expect(decodeStoredCredentials("host:not-a-port", "tok")).toBeNull();
    expect(decodeStoredCredentials("host:0", "tok")).toBeNull(); // port out of range
    expect(decodeStoredCredentials("host:70000", "tok")).toBeNull();
    expect(decodeStoredCredentials("host:18477", "")).toBeNull(); // empty bearer
  });
});

describe("gateway credential store", () => {
  test("save encodes host:port as username and bearer as password", async () => {
    const mock = mockKeychain();
    const store = createGatewayCredentialStore(mock.port);
    await store.save(CONFIG);
    expect(mock.item()).toEqual({
      username: "gw.tailnet.ts.net:18477",
      password: "tok_test_bearer",
    });
  });

  test("load round-trips the saved credential", async () => {
    const mock = mockKeychain();
    const store = createGatewayCredentialStore(mock.port);
    await store.save(CONFIG);
    expect(await store.load()).toEqual({
      host: "gw.tailnet.ts.net",
      port: 18477,
      bearer: "tok_test_bearer",
    });
  });

  test("load returns null on a fresh device", async () => {
    const store = createGatewayCredentialStore(mockKeychain().port);
    expect(await store.load()).toBeNull();
  });

  test("logout clears the stored item; a read afterwards finds nothing", async () => {
    const mock = mockKeychain();
    const store = createGatewayCredentialStore(mock.port);
    await store.save(CONFIG);
    await store.clear();
    expect(await store.load()).toBeNull();
    expect(mock.item()).toBeNull();
    expect(mock.calls.clear).toBe(1);
  });

  test("re-login overwrites the previous credential", async () => {
    const mock = mockKeychain();
    const store = createGatewayCredentialStore(mock.port);
    await store.save(CONFIG);
    await store.save(createConnectionConfig("other.tailnet.ts.net", "18477", "tok_new"));
    expect(await store.load()).toEqual({
      host: "other.tailnet.ts.net",
      port: 18477,
      bearer: "tok_new",
    });
    expect(mock.calls.save).toBe(2);
  });

  test("tokenless connect persists the connection setting, never secret material", async () => {
    const mock = mockKeychain();
    const store = createGatewayCredentialStore(mock.port);
    // Tokenless config (empty bearer): the item stores the host:port SETTING
    // with the mode marker — the QR pairing decision §3.2 relaunch-restore
    // contract. No bearer material exists to store.
    await store.save(createConnectionConfig("gw.tailnet.ts.net", "18477"));
    expect(mock.item()).toEqual({
      username: "gw.tailnet.ts.net:18477",
      password: TOKENLESS_PASSWORD_MARKER,
    });
    expect(await store.load()).toEqual({ host: "gw.tailnet.ts.net", port: 18477, bearer: "" });
    // A later fallback login overwrites the tokenless entry with real material.
    await store.save(CONFIG);
    expect(await store.load()).toEqual({
      host: "gw.tailnet.ts.net",
      port: 18477,
      bearer: "tok_test_bearer",
    });
  });

  test("corrupted stored payload loads as null without throwing", async () => {
    const port: GatewayKeychainPort = {
      async save() {
        return true;
      },
      async load() {
        return { username: "corrupted-junk", password: "tok_test_bearer" };
      },
      async clear() {
        return true;
      },
    };
    const store = createGatewayCredentialStore(port);
    expect(await store.load()).toBeNull();
  });
});
