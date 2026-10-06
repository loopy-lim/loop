/**
 * Tailscale-mode loopback dual bind (decision 2026-xx-tokenless-auth-and-app-
 * layout §D-A4 amendment) plus the SSE transport teardown hardening that let
 * the real gateway replace the v7 showcase wrapper: a client disconnect that
 * races the pump must tear the connection down, never the process.
 *
 * Deterministic throughout: no real tailnet, no paid model call. The primary
 * bind in live tests is the IPv6 loopback literal `::1` (bindable on every
 * dev host) so the secondary IPv4 loopback listener has its own distinct
 * socket; under the real tailscale bind policy the primary is CGNAT, which
 * unit paths cover via the fail-closed tests in bind-auth.test.ts.
 */

import { describe, expect, test } from "bun:test";

import { gatewayConfigFromEnv, parseGatewayConfig } from "../src/config";
import type { GatewayServer } from "../src/server";
import { startGateway } from "../src/server";
import { LoopbackBindRejectedError, validateLoopbackBindHost } from "../src/tailscale";
import { authHeader, bootTestGateway, makeSnapshot, submitPrompt } from "./helpers";

describe("loopback bind policy (decision §D-A4 amendment, fail closed)", () => {
  test("accepts IPv4 127.0.0.0/8 and IPv6 ::1 literals only", () => {
    for (const host of ["127.0.0.1", "127.8.8.8", "127.255.255.254", "::1", "0:0:0:0:0:0:0:1"]) {
      expect(() => validateLoopbackBindHost(host)).not.toThrow();
    }
    for (const host of [
      "0.0.0.0", // wildcard
      "192.168.1.10", // LAN
      "10.0.0.5", // LAN
      "100.80.133.120", // CGNAT — the primary's surface, never the secondary's
      "169.254.1.1", // link-local
      "gateway.loop.local", // hostname
      "::", // unspecified
      "fe80::1", // link-local v6
      "ff02::1", // multicast v6
    ]) {
      expect(() => validateLoopbackBindHost(host)).toThrow(LoopbackBindRejectedError);
    }
  });
});

describe("loopback config resolution", () => {
  test("defaults to enabled on 127.0.0.1 at the primary port", () => {
    const parsed = parseGatewayConfig({ host: "100.80.133.120", port: 18477 });
    expect(parsed.loopback).toEqual({ enabled: true, host: "127.0.0.1", port: 18477 });
  });

  test("honors enabled/host/port overrides", () => {
    const off = parseGatewayConfig({
      host: "100.80.133.120",
      port: 18477,
      loopback: { enabled: false },
    });
    expect(off.loopback.enabled).toBe(false);
    const custom = parseGatewayConfig({
      host: "100.80.133.120",
      port: 18477,
      loopback: { host: "127.0.0.9", port: 18500 },
    });
    expect(custom.loopback).toEqual({ enabled: true, host: "127.0.0.9", port: 18500 });
  });

  test("rejects malformed overrides deterministically", () => {
    expect(() => parseGatewayConfig({ host: "h", port: 1, loopback: { port: 0 } })).toThrow();
    expect(() => parseGatewayConfig({ host: "h", port: 1, loopback: { port: 65536 } })).toThrow();
    expect(() =>
      parseGatewayConfig({ host: "h", port: 1, loopback: { enabled: 1 as unknown as boolean } }),
    ).toThrow();
    expect(() => parseGatewayConfig({ host: "h", port: 1, loopback: { host: "" } })).toThrow();
  });

  test("env config maps LOOP_GATEWAY_LOOPBACK_*", () => {
    const plain = gatewayConfigFromEnv({
      LOOP_GATEWAY_HOST: "100.80.133.120",
      LOOP_GATEWAY_PORT: "18477",
    });
    expect(plain.loopback?.enabled).toBeUndefined(); // default resolved at parse time
    const off = gatewayConfigFromEnv({
      LOOP_GATEWAY_HOST: "100.80.133.120",
      LOOP_GATEWAY_PORT: "18477",
      LOOP_GATEWAY_LOOPBACK: "off",
    });
    expect(off.loopback?.enabled).toBe(false);
    expect(() =>
      gatewayConfigFromEnv({
        LOOP_GATEWAY_HOST: "h",
        LOOP_GATEWAY_PORT: "1",
        LOOP_GATEWAY_LOOPBACK: "maybe",
      }),
    ).toThrow("LOOP_GATEWAY_LOOPBACK");
    expect(() =>
      gatewayConfigFromEnv({
        LOOP_GATEWAY_HOST: "h",
        LOOP_GATEWAY_PORT: "1",
        LOOP_GATEWAY_LOOPBACK_PORT: "70000",
      }),
    ).toThrow("LOOP_GATEWAY_LOOPBACK_PORT");
  });
});

/** Dual-bind harness: the booted test gateway owns the service; servers are
 * started explicitly so each test picks its own primary host/port. */
function dualBindHarness() {
  const gateway = bootTestGateway();
  return {
    gateway,
    start(config: Parameters<typeof startGateway>[0]): GatewayServer {
      return startGateway(config, {
        service: gateway.service,
        verifier: { verify: () => undefined },
        inspector: { assertBindable: () => undefined },
      });
    },
    stop(server: GatewayServer | null) {
      server?.stop();
      gateway.stop();
    },
  };
}

describe("tailscale-mode loopback dual bind (live)", () => {
  test("serves the primary and loopback listeners tokenlessly on the same port", async () => {
    const harness = dualBindHarness();
    let server: GatewayServer | null = null;
    try {
      server = harness.start({ host: "::1", port: 0, authMode: "tailscale", identity: "off" });
      expect(server.loopback).toEqual({ hostname: "127.0.0.1", port: server.port });
      for (const base of [`http://[::1]:${server.port}`, `http://127.0.0.1:${server.port}`]) {
        const response = await fetch(`${base}/v1/runs`);
        expect(response.status).toBe(200);
      }
    } finally {
      harness.stop(server);
    }
  });

  test("loopback enabled=false restores the single-listener posture", async () => {
    const harness = dualBindHarness();
    let server: GatewayServer | null = null;
    try {
      server = harness.start({
        host: "::1",
        port: 0,
        authMode: "tailscale",
        identity: "off",
        loopback: { enabled: false },
      });
      expect(server.loopback).toBeNull();
      expect((await fetch(`http://[::1]:${server.port}/v1/runs`)).status).toBe(200);
      const refused = await fetch(`http://127.0.0.1:${server.port}/v1/runs`).then(
        () => "unexpected-200",
        (error) => String(error),
      );
      expect(refused).toMatch(/[Ee]rrno|[Rr]efused|[Cc]onnection|[Uu]nable to connect/);
    } finally {
      harness.stop(server);
    }
  });

  test("bearer-fallback mode never starts the loopback listener", () => {
    const harness = dualBindHarness();
    let server: GatewayServer | null = null;
    try {
      server = harness.start({
        host: "127.0.0.1",
        port: 0,
        authMode: "bearer-fallback",
        auth: harness.gateway.authNames,
      });
      expect(server.loopback).toBeNull();
    } finally {
      harness.stop(server);
    }
  });

  test("a loopback primary suppresses the secondary instead of colliding", () => {
    const harness = dualBindHarness();
    let server: GatewayServer | null = null;
    try {
      server = harness.start({
        host: "127.0.0.1",
        port: 0,
        authMode: "tailscale",
        identity: "off",
      });
      expect(server.loopback).toBeNull();
    } finally {
      harness.stop(server);
    }
  });

  test("a non-loopback loopback.host is rejected before any socket opens", () => {
    const harness = dualBindHarness();
    const server: GatewayServer | null = null;
    try {
      expect(() =>
        harness.start({
          host: "::1",
          port: 0,
          authMode: "tailscale",
          identity: "off",
          loopback: { host: "192.168.1.10" },
        }),
      ).toThrow(LoopbackBindRejectedError);
    } finally {
      harness.stop(server);
    }
  });

  test("stop() closes both listeners", async () => {
    const harness = dualBindHarness();
    const server = harness.start({ host: "::1", port: 0, authMode: "tailscale", identity: "off" });
    expect(server.loopback).not.toBeNull();
    server.stop();
    for (const base of [`http://[::1]:${server.port}`, `http://127.0.0.1:${server.port}`]) {
      const outcome = await fetch(`${base}/v1/runs`).then(
        () => "unexpected-200",
        (error) => String(error),
      );
      expect(outcome).toMatch(/[Ee]rrno|[Rr]efused|[Cc]onnection|[Cc]losed|[Uu]nable to connect/);
    }
    harness.stop(null);
  });
});

describe("SSE transport teardown hardening (v7 wrapper replacement precondition)", () => {
  test("client disconnect after cancel never escapes the pump nor kills the server", async () => {
    const gateway = bootTestGateway();
    try {
      const submitted = await submitPrompt(gateway, { prompt: "disconnect probe" });
      const body = (await submitted.json()) as { run: { runId: string } };
      const runId = body.run.runId;

      const response = await fetch(`${gateway.baseUrl}/v1/runs/${runId}/events`, {
        headers: { Accept: "text/event-stream", ...authHeader(gateway.token()) },
      });
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      await reader.read(); // drain the intro so frames are flowing
      await reader.cancel(); // client walks away mid-stream

      // Frames pushed after the disconnect must be swallowed by the pump
      // guard. Pre-hardening this raced `Controller is already closed` out of
      // `enqueue` and could take the whole gateway process down.
      gateway.runtime.emit(makeSnapshot({ runId, state: "completed" }));

      const stillAlive = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: authHeader(gateway.token()),
      });
      expect(stillAlive.status).toBe(200);
    } finally {
      gateway.stop();
    }
  });

  test("an aborted SSE request cleans up and leaves the server serving", async () => {
    const gateway = bootTestGateway();
    try {
      const submitted = await submitPrompt(gateway, { prompt: "abort probe" });
      const body = (await submitted.json()) as { run: { runId: string } };
      const runId = body.run.runId;

      const control = new AbortController();
      const response = await fetch(`${gateway.baseUrl}/v1/runs/${runId}/events`, {
        headers: { Accept: "text/event-stream", ...authHeader(gateway.token()) },
        signal: control.signal,
      });
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      await reader.read();
      control.abort();
      gateway.runtime.emit(makeSnapshot({ runId, state: "completed" }));

      const stillAlive = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: authHeader(gateway.token()),
      });
      expect(stillAlive.status).toBe(200);
    } finally {
      gateway.stop();
    }
  });
});
