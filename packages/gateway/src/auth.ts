/**
 * Bearer verification for /v1/** (ADR §2 D2, §4.1).
 *
 * v1 tokens are HS256 JWTs with required `exp`, exact `iss`, exact `aud`.
 * `alg: none` and algorithm mismatches are rejected. The signing secret,
 * issuer, and audience are read from the environment at verification time
 * (process memory only) — never from config, disk, logs, or events.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { GatewayAuthEnvNames } from "./config";
import { ProblemError } from "./problem";

export interface AuthVerifier {
  /** Throws ProblemError(401, "unauthorized") when the request is not authentic. */
  verify(authorization: string | null): void;
}

/** Optional tailscale-mode hardening (decision
 * 2026-xx-tokenless-auth-and-app-layout §D-A2): verifies that the connecting
 * peer is an identifiable tailnet member (e.g. a tailscaled whois lookup where
 * the platform provides one). Implementations throw ProblemError(401,
 * "unauthorized") when identity cannot be established; `address === null`
 * means the platform could not report the peer at all and must be rejected. */
export interface PeerIdentityVerifier {
  verifyIdentity(peer: { address: string | null }): void;
}

export class Hs256BearerVerifier implements AuthVerifier {
  readonly #names: GatewayAuthEnvNames;
  readonly #nowMs: () => number;

  constructor(names: GatewayAuthEnvNames, nowMs: () => number = Date.now) {
    this.#names = names;
    this.#nowMs = nowMs;
  }

  verify(authorization: string | null): void {
    if (authorization === null || !authorization.startsWith("Bearer ")) failUnauthorized();

    const env = process.env;
    const secret = env[this.#names.secretEnv];
    const issuer = env[this.#names.issuerEnv];
    const audience = env[this.#names.audienceEnv];
    if (secret === undefined || issuer === undefined || audience === undefined) {
      // Fail closed: an unconfigured gateway authenticates nobody.
      failUnauthorized();
    }

    const token = (authorization as string).slice("Bearer ".length);
    const parts = token.split(".");
    if (parts.length !== 3) failUnauthorized();

    const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
    const header = parseJson(rawHeader);
    if (header === null) failUnauthorized();
    const payload = parseJson(rawPayload);
    if (payload === null) failUnauthorized();
    if (header.alg !== "HS256") failUnauthorized(); // Rejects alg:none and mismatches.

    const expected = createHmac("sha256", secret as string)
      .update(`${rawHeader}.${rawPayload}`)
      .digest();
    const presented = base64UrlDecode(rawSignature);
    if (presented === null || presented.length !== expected.length) failUnauthorized();
    if (!timingSafeEqual(new Uint8Array(presented), new Uint8Array(expected))) failUnauthorized();

    if (typeof payload.exp !== "number" || payload.exp * 1000 <= this.#nowMs()) failUnauthorized();
    if (payload.iss !== issuer) failUnauthorized();
    const aud = payload.aud;
    const audienceMatches = aud === audience || (Array.isArray(aud) && aud.includes(audience));
    if (!audienceMatches) failUnauthorized();
  }
}

/** Always throws; the explicit `never` return lets callers rely on narrowing. */
function failUnauthorized(): never {
  throw new ProblemError(401, "unauthorized");
}

function parseJson(segment: string): Record<string, unknown> | null {
  const bytes = base64UrlDecode(segment);
  if (bytes === null) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function base64UrlDecode(segment: string): Buffer | null {
  if (segment.length === 0) return null;
  try {
    const buffer = Buffer.from(segment, "base64url");
    // Buffer ignores invalid characters silently; require a faithful round-trip.
    return buffer.toString("base64url") === segment ? buffer : null;
  } catch {
    return null;
  }
}

/** Test/composition helper: sign an HS256 JWT. Lives in the adapter because
 * token issuance is out of v1 scope; operators mint tokens out of band. */
export function signHs256Token(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const body = `${enc(header)}.${enc(payload)}`;
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}
