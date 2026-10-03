/**
 * Bind validation and request authentication/authorization rejections
 * (ADR §2 D2, §4.6): wildcard/loopback/LAN binds fail closed, bearer
 * verification rejects malformed/expired/mismatched tokens, browser Origin
 * headers are rejected, and framing errors map to the problem contract.
 *
 * Auth modes (decision 2026-xx-tokenless-auth-and-app-layout §D-A): the
 * tokenless "tailscale" mode serves /v1 without any bearer material (tailnet
 * membership is the trust boundary, optional peer-identity hardening); the
 * explicit "bearer-fallback" mode keeps bearer verification and refuses to
 * start without its signing material. Both modes and every rejection path
 * are covered here deterministically — no paid calls, no real tailnet.
 */

import { describe, expect, test } from "bun:test";

import {
  validateBindableHost,
  validateFallbackBindHost,
  BindRejectedError,
  FallbackBindRejectedError,
  type InterfaceSnapshot,
} from "../src/tailscale";
import { parseGatewayConfig, type GatewayAuthMode } from "../src/config";
import { ProblemError } from "../src/problem";
import { startGateway } from "../src/server";
import { bootTestGateway, authHeader, submitPrompt } from "./helpers";

const tailscaleInterfaces: InterfaceSnapshot[] = [
  { name: "utun4", addresses: ["100.80.133.120", "fe80::1"] },
];

describe("Tailscale bind validation (fail closed)", () => {
  test("accepts an explicit active Tailscale CGNAT address", () => {
    expect(() => validateBindableHost("100.80.133.120", tailscaleInterfaces)).not.toThrow();
    expect(() => validateBindableHost("100.64.0.1", tailscaleInterfaces)).toThrow(
      BindRejectedError,
    );
  });

  test("rejects wildcard, loopback, link-local, and ordinary LAN addresses", () => {
    for (const host of ["0.0.0.0", "127.0.0.1", "169.254.10.2", "192.168.1.10", "10.0.0.5"]) {
      expect(() => validateBindableHost(host, tailscaleInterfaces)).toThrow(BindRejectedError);
    }
    for (const host of ["::", "::1", "fe80::1"]) {
      expect(() => validateBindableHost(host, tailscaleInterfaces)).toThrow(BindRejectedError);
    }
  });

  test("rejects hostnames and addresses not on an active interface", () => {
    expect(() => validateBindableHost("gateway.loop.local", tailscaleInterfaces)).toThrow(
      BindRejectedError,
    );
    expect(() => validateBindableHost("100.99.1.5", tailscaleInterfaces)).toThrow(
      BindRejectedError,
    );
  });

  test("startGateway refuses to bind before opening a socket", () => {
    const gateway = bootTestGateway();
    try {
      let bindError: unknown = null;
      try {
        startGateway(
          { host: "0.0.0.0", port: 0 },
          {
            service: gateway.service,
            verifier: { verify: () => undefined },
          },
        );
      } catch (error) {
        bindError = error;
      }
      expect(bindError).toBeInstanceOf(BindRejectedError);
    } finally {
      gateway.stop();
    }
  });
});

describe("bearer-fallback bind policy (decision 2026-xx-tokenless-auth-and-app-layout §D-A3)", () => {
  test("accepts explicit loopback, LAN, and CGNAT literals — the bearer token is the trust boundary", () => {
    for (const host of ["127.0.0.1", "192.168.1.10", "10.0.0.5", "100.80.133.120"]) {
      expect(() => validateFallbackBindHost(host)).not.toThrow();
    }
  });

  test("rejects wildcard, multicast, reserved, and non-literal hosts deterministically", () => {
    for (const host of [
      "gateway.loop.local",
      "0.0.0.0",
      "224.0.0.1",
      "239.1.2.3",
      "255.255.255.255",
      "::",
      "ff02::1",
    ]) {
      expect(() => validateFallbackBindHost(host)).toThrow(FallbackBindRejectedError);
    }
  });

  test("startGateway rejects a wildcard fallback bind before opening a socket", () => {
    const gateway = bootTestGateway();
    try {
      let bindError: unknown = null;
      try {
        startGateway(
          { host: "0.0.0.0", port: 0, authMode: "bearer-fallback" },
          {
            service: gateway.service,
            verifier: { verify: () => undefined },
          },
        );
      } catch (error) {
        bindError = error;
      }
      expect(bindError).toBeInstanceOf(FallbackBindRejectedError);
    } finally {
      gateway.stop();
    }
  });
});

describe("tokenless tailscale mode (decision 2026-xx-tokenless-auth-and-app-layout §D-A1)", () => {
  test("serves /v1 with no bearer material configured and no Authorization header", async () => {
    // Zero-credential boot: no JWT env vars exist at all in this mode.
    const gateway = bootTestGateway({ authMode: "tailscale", bearerEnv: false });
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/runs`);
      expect(response.status).toBe(200);
      // A bearer header is simply ignored — the verifier is never consulted.
      const withHeader = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: { Authorization: "Bearer not-a-token" },
      });
      expect(withHeader.status).toBe(200);
    } finally {
      gateway.stop();
    }
  });

  test("still rejects browser Origin headers", async () => {
    const gateway = bootTestGateway({ authMode: "tailscale", bearerEnv: false });
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: { Origin: "http://evil.example" },
      });
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe("origin_rejected");
    } finally {
      gateway.stop();
    }
  });
});

describe("peer identity hardening (decision 2026-xx-tokenless-auth-and-app-layout §D-A2)", () => {
  class ScriptedIdentityVerifier {
    calls: (string | null)[] = [];
    allow = new Set<string>(["127.0.0.1"]);

    verifyIdentity(peer: { address: string | null }): void {
      this.calls.push(peer.address);
      if (peer.address === null || !this.allow.has(peer.address)) {
        throw new ProblemError(401, "unauthorized");
      }
    }
  }

  test("startup rejects identity whois without a platform identity verifier", () => {
    expect(() => bootTestGateway({ authMode: "tailscale", identity: "whois" })).toThrow(
      /peer-identity support/,
    );
  });

  test("gates tokenless requests on the platform-derived peer address", async () => {
    const identity = new ScriptedIdentityVerifier();
    const gateway = bootTestGateway({
      authMode: "tailscale",
      bearerEnv: false,
      identity: "whois",
      identityVerifier: identity,
    });
    try {
      const allowed = await fetch(`${gateway.baseUrl}/v1/runs`);
      expect(allowed.status).toBe(200);
      expect(identity.calls.length).toBe(1);

      identity.allow.clear(); // Platform reports an unknown peer.
      const rejected = await fetch(`${gateway.baseUrl}/v1/runs`);
      expect(rejected.status).toBe(401);
      expect(((await rejected.json()) as { code: string }).code).toBe("unauthorized");
    } finally {
      gateway.stop();
    }
  });
});

describe("auth mode configuration (decision §D-A)", () => {
  test("parseGatewayConfig defaults to tokenless tailscale mode and validates modes", () => {
    const defaults = parseGatewayConfig({ host: "100.80.133.120", port: 8_080 });
    expect(defaults.authMode).toBe("tailscale");
    expect(defaults.identity).toBe("off");

    expect(() =>
      parseGatewayConfig({ host: "h", port: 1, authMode: "open" as unknown as GatewayAuthMode }),
    ).toThrow(/authMode/);
    expect(() =>
      parseGatewayConfig({ host: "h", port: 1, identity: "radar" as unknown as "off" }),
    ).toThrow(/identity/);
    // Peer identity is a tailscale-mode hardening; bearer fallback already
    // authenticates every request.
    expect(() =>
      parseGatewayConfig({ host: "h", port: 1, authMode: "bearer-fallback", identity: "whois" }),
    ).toThrow(/only to authMode/);
  });

  test("bearer-fallback startup fails closed when the signing material is unset", () => {
    let error: unknown = null;
    try {
      bootTestGateway({ bearerEnv: false }); // defaults to bearer-fallback mode
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/bearer-fallback mode requires LOOP_TEST_JWT_SECRET_/);
  });
});

describe("bearer authentication", () => {
  test("rejects missing, malformed, expired, and mismatched tokens with 401", async () => {
    const gateway = bootTestGateway();
    try {
      const requestWithoutAuth = await fetch(`${gateway.baseUrl}/v1/runs`);
      expect(requestWithoutAuth.status).toBe(401);
      expect(((await requestWithoutAuth.json()) as { code: string }).code).toBe("unauthorized");

      const malformed = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      });
      expect(malformed.status).toBe(401);

      const expired = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: authHeader(
          gateway.token({ exp: Math.floor((gateway.clock.now - 10_000) / 1000) }),
        ),
      });
      expect(expired.status).toBe(401);

      const wrongIssuer = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: authHeader(gateway.token({ iss: "someone-else" })),
      });
      expect(wrongIssuer.status).toBe(401);

      const wrongAudience = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: authHeader(gateway.token({ aud: "another-app" })),
      });
      expect(wrongAudience.status).toBe(401);

      const signedWithWrongSecret = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: authHeader(
          gateway.token({ exp: Math.floor((gateway.clock.now + 600_000) / 1000) }),
        ),
      });
      // gateway.token signs with the boot secret; a token signed elsewhere:
      const forged = `${gateway.token().split(".").slice(0, 2).join(".")}.c2lnbmF0dXJl`;
      expect(
        (await fetch(`${gateway.baseUrl}/v1/runs`, { headers: authHeader(forged) })).status,
      ).toBe(401);
      expect(signedWithWrongSecret.status).toBe(200); // sanity: the valid token lists runs
    } finally {
      gateway.stop();
    }
  });

  test("rejects alg:none tokens regardless of signature presence", async () => {
    const gateway = bootTestGateway();
    try {
      const algNone = gateway.token({ alg: "none" });
      const response = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: authHeader(algNone),
      });
      expect(response.status).toBe(401);
    } finally {
      gateway.stop();
    }
  });

  test("verifiers fail closed when env material is missing", async () => {
    const gateway = bootTestGateway();
    try {
      const unsetNames = {
        secretEnv: "LOOP_TEST_UNSET_SECRET",
        issuerEnv: "LOOP_TEST_UNSET_ISSUER",
        audienceEnv: "LOOP_TEST_UNSET_AUDIENCE",
      };
      for (const name of Object.values(unsetNames)) delete process.env[name];
      const { Hs256BearerVerifier } = await import("../src/auth");
      const strict = new Hs256BearerVerifier(unsetNames);
      expect(() => strict.verify(`Bearer ${gateway.token()}`)).toThrow();
    } finally {
      gateway.stop();
    }
  });
});

describe("origin and framing rules", () => {
  test("rejects any request carrying an Origin header even with valid auth", async () => {
    const gateway = bootTestGateway();
    try {
      const response = await submitPrompt(
        gateway,
        { prompt: "hello" },
        { Origin: "http://evil.example" },
      );
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe("origin_rejected");
    } finally {
      gateway.stop();
    }
  });

  test("maps unknown routes and wrong methods to problem responses", async () => {
    const gateway = bootTestGateway();
    try {
      const unknown = await fetch(`${gateway.baseUrl}/v1/zzz`, {
        headers: authHeader(gateway.token()),
      });
      expect(unknown.status).toBe(404);
      expect(((await unknown.json()) as { code: string }).code).toBe("not_found");

      const wrongMethod = await fetch(`${gateway.baseUrl}/v1/runs`, {
        method: "DELETE",
        headers: authHeader(gateway.token()),
      });
      expect(wrongMethod.status).toBe(405);
      expect(((await wrongMethod.json()) as { code: string }).code).toBe("method_not_allowed");

      const wrongEventMethod = await fetch(`${gateway.baseUrl}/v1/runs/run-1/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(gateway.token()) },
        body: "{}",
      });
      expect(wrongEventMethod.status).toBe(405);
    } finally {
      gateway.stop();
    }
  });

  test("reflects valid X-Request-Id headers", async () => {
    const gateway = bootTestGateway();
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/runs`, {
        headers: { ...authHeader(gateway.token()), "X-Request-Id": "req_client_abc" },
      });
      expect(response.headers.get("X-Request-Id")).toBe("req_client_abc");
    } finally {
      gateway.stop();
    }
  });
});
