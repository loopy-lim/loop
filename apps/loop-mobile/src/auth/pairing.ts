/**
 * QR pairing payload — the mobile scan TARGET side (decision
 * 2026-xx-qr-pairing D-A/D-B). A scan or a `loop://` deep link delivers
 * `loop://connect?host=<tailscale-host>&port=<port>`; this module parses it
 * back to the pair `createConnectionConfig` validates. The payload is a
 * LOCATION, not a credential: tokenless mode has no secret to embed, and
 * secret-bearing parameters are refused outright instead of being silently
 * accepted — the same contract as the CLI (packages/cli/src/pair.ts). Unknown
 * query parameters are ignored (forward compatibility).
 */

export const PAIR_URL_PREFIX = "loop://connect?";

export class PairUrlError extends Error {
  override readonly name = "PairUrlError";
  constructor(message: string) {
    super(message);
  }
}

const MIN_PORT = 1;
const MAX_PORT = 65535;
/** Query keys that must never appear in a pairing payload (decision §D-A). */
const SECRET_PARAM_PATTERN = /token|secret|password|bearer|api[-_]?key|credential/i;
const IPV4_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$/;

function assertPairHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.length === 0) throw new PairUrlError("pairing host is required");
  if (trimmed.includes("/") || trimmed.includes(":")) {
    throw new PairUrlError("pairing host must be a bare Tailscale address without scheme or port");
  }
  return trimmed;
}

function assertPairPort(port: number | string): number {
  const trimmed = typeof port === "string" ? port.trim() : String(port);
  const parsed = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    throw new PairUrlError(`pairing port must be an integer in ${MIN_PORT}..${MAX_PORT}`);
  }
  return parsed;
}

/** Build a payload string (encode side lives in the CLI surface;
 * the mobile app carries it only so the round trip is testable in-place). */
export function buildPairUrl(host: string, port: number | string): string {
  return `${PAIR_URL_PREFIX}host=${assertPairHost(host)}&port=${assertPairPort(port)}`;
}

/** Parse a pairing payload back to its connection pair. Hand-rolled strict
 * grammar — NOT `new URL`: the Hermes runtime's URL polyfill treats
 * non-special schemes (loop:) differently from browser engines, and the
 * pairing contract is small enough to parse exactly. Secret-bearing
 * parameters are rejected; unknown ones are ignored (forward compat);
 * duplicate keys keep the first value (WHATWG `searchParams.get` parity with
 * the CLI surface). No percent-decoding: MagicDNS hosts are plain
 * ASCII, and an undecoded `%` simply fails the host shape check. */
export function parsePairUrl(url: string): { host: string; port: number } {
  const raw = url.trim();
  const schemeEnd = raw.indexOf("://");
  if (schemeEnd <= 0 || raw.slice(0, schemeEnd).toLowerCase() !== "loop") {
    throw new PairUrlError(`not a loop pairing URL (scheme ${raw.split(":")[0] || "(none)"})`);
  }
  const rest = raw.slice(schemeEnd + 3);
  const queryStart = rest.indexOf("?");
  if (queryStart < 0) throw new PairUrlError("pairing payload requires host and port parameters");
  const target = rest.slice(0, queryStart);
  if (target.toLowerCase() !== "connect") {
    throw new PairUrlError(`unexpected loop URL target: ${target || "(none)"}`);
  }
  let host: string | null = null;
  let port: string | null = null;
  for (const pair of rest.slice(queryStart + 1).split("&")) {
    if (pair.length === 0) continue;
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    const value = eq < 0 ? "" : pair.slice(eq + 1);
    if (SECRET_PARAM_PATTERN.test(key)) {
      throw new PairUrlError(`pairing payload must not carry secrets (refused parameter: ${key})`);
    }
    if (key === "host" && host === null) host = value;
    if (key === "port" && port === null) port = value;
    // Any other key is ignored (forward compatibility).
  }
  if (host === null || port === null)
    throw new PairUrlError("pairing payload requires host and port parameters");
  return { host: assertPairHost(host), port: assertPairPort(port) };
}

/** The payload host is an IPv4 literal: iOS ATS rejects numeric hosts, so a
 * scanned QR would fail ATS even though the payload parses (decision D-A). */
export function isIpLiteralHost(host: string): boolean {
  return IPV4_LITERAL.test(host);
}
