/**
 * Safety contract (task `mobile-safety`): the app must never leak the
 * gateway credential outside the OS keychain + in-memory config, never
 * log from production code, and never crash or blank on SSE/network
 * failure — the observing screens degrade to a visible error notice.
 *
 * Two kinds of gates, matching the house rule that react-native does not
 * load under the test runtime (no component render, no network beyond
 * localhost, no paid model calls):
 *
 * 1. Source pins (machine-enforced policy, same style as
 *    logout-placement/ergonomics): zero `console.*` in src, zero
 *    forbidden durable-storage imports (AsyncStorage/localStorage/sqlite).
 * 2. Behavioral tests against the real client/store seams: a hard network
 *    failure keeps observeRun alive (retry + visible retry signal, no
 *    unhandled rejection), a non-retryable problem surfaces as a
 *    GatewayError the screens catch, and logout actually deletes the
 *    keychain item.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { createConnectionConfig } from "../src/auth/connection";
import { createGatewayCredentialStore, type GatewayKeychainPort } from "../src/auth/credentialStore";
import { GatewayClient } from "../src/gateway-client/client";
import { GatewayError } from "../src/gateway-client/problem";

const mobileRoot = join(import.meta.dir, "..");

function filesUnder(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

const sources = filesUnder(join(mobileRoot, "src"), [".ts", ".tsx"]).map((file) => [
  file,
  readFileSync(file, "utf8"),
]) as Array<[string, string]>;

describe("no credential or prompt logging from production code", () => {
  test("no console.* call anywhere in src (logs are a leak channel)", () => {
    const offenders = sources.filter(([, src]) => /console\./.test(src));
    expect(offenders.map(([file]) => file)).toEqual([]);
  });

  test("no forbidden durable-storage import (AsyncStorage/localStorage/sqlite)", () => {
    const forbidden = /from\s+["'][^"']*(async-storage|localstorage|expo-sqlite|react-native-sqlite)/i;
    const offenders = sources.filter(([, src]) => forbidden.test(src));
    expect(offenders.map(([file]) => file)).toEqual([]);
  });
});

describe("SSE hard failure never crashes — it degrades to a visible error state", () => {
  const CONFIG = createConnectionConfig("gw.tailnet.ts.net", "18477", "tok_secret_bearer");

  test("network failure before headers: observeRun keeps retrying and resolves on abort", async () => {
    const client = new GatewayClient(CONFIG, async () => {
      throw new TypeError("Network request failed");
    });
    const controller = new AbortController();
    const retries: unknown[] = [];
    await client.observeRun(
      "run_safety",
      () => undefined,
      {
        signal: controller.signal,
        onRetryableError: (error) => {
          retries.push(error);
          if (retries.length >= 2) controller.abort();
        },
      },
    );
    // Resolving (vs rejecting) is the contract: the screen's .catch is for
    // non-retryable problems only; a dead network is a retryable state.
    expect(retries.length).toBe(2);
    expect(retries[0]).toBeInstanceOf(Error);
  });

  test("non-retryable problem (404): rejects with GatewayError carrying status/code only", async () => {
    const problem = {
      type: "about:blank",
      title: "not found",
      status: 404,
      code: "not_found",
      detail: "run is gone",
      requestId: "req_safety",
      retryable: false,
      fields: null,
    };
    const client = new GatewayClient(
      CONFIG,
      async () => new Response(JSON.stringify(problem), { status: 404 }),
    );
    let caught: unknown = null;
    try {
      await client.observeRun("run_safety", () => undefined);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayError);
    const gatewayError = caught as GatewayError;
    expect(gatewayError.retryable).toBe(false);
    // The surfaced message is what RunScreen/ConversationScreen render as
    // streamError — it must never embed the bearer.
    expect(gatewayError.message).not.toContain("tok_secret_bearer");
    expect(gatewayError.message).toContain("404");
  });

  test("every observing screen catches stream failure into a rendered error notice", () => {
    for (const screen of ["RunScreen.tsx", "PaneScreen.tsx", "ConversationScreen.tsx"]) {
      const src = readFileSync(join(mobileRoot, "src/screens", screen), "utf8");
      // observe* rejection lands in streamError state…
      expect(src).toContain(".catch((e: unknown)");
      expect(src).toContain("setStreamError(");
      // …which renders (the screen degrades, never blanks or throws).
      expect(src).toContain("streamError !== null");
      // Retryable failures mark the stream stale so the user sees the lag.
      expect(src).toContain("onRetryableError");
    }
    // The conversation surface shows the fixed disconnection copy, not a
    // raw transport dump (C10).
    const conversation = readFileSync(
      join(mobileRoot, "src/screens/ConversationScreen.tsx"),
      "utf8",
    );
    expect(conversation).toContain("STREAM_DISCONNECTED_NOTICE");
  });
});

describe("logout deletes the credential (D2-4)", () => {
  test("save → logout → keychain empty; a later load finds nothing", async () => {
    let item: { username: string; password: string } | null = null;
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
    const store = createGatewayCredentialStore(port);
    await store.save(createConnectionConfig("gw.tailnet.ts.net", 18477, "tok_logout_bearer"));
    expect(item).not.toBeNull();
    await store.clear();
    expect(item).toBeNull();
    expect(await store.load()).toBeNull();
  });

  test("App logout routes exclusively through store.clear() before the manual screen", () => {
    const app = readFileSync(join(mobileRoot, "src/App.tsx"), "utf8");
    expect(app).toContain("await store.clear()");
    const logout = app.slice(app.indexOf("const logout = useCallback"));
    expect(logout.indexOf("await store.clear()")).toBeLessThan(
      logout.indexOf('setPhase("manual")'),
    );
  });
});
