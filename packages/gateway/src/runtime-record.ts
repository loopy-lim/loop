/**
 * Well-known gateway runtime record (decision: loop pair port fallback).
 *
 * After a successful bind the composition root records the actually bound
 * host and port to `~/.config/loop/gateway.json` (the existing Loop config
 * directory convention, reused via `resolveConfigDirectory`) so that
 * `loop pair` can resolve the port without copying LOOP_GATEWAY_PORT into
 * yet another shell environment.
 *
 * Security posture (decision §D-A, unchanged): the record carries ONLY the
 * connection pair — no tokens, no issuer/audience, nothing the QR surface
 * is forbidden from carrying. The type makes secrets unrepresentable and
 * the writer serializes exactly those two keys.
 *
 * Testability: the file path is overridable via LOOP_GATEWAY_RUNTIME_FILE
 * (an absolute or cwd-relative path), so tests never touch the real user
 * config directory.
 *
 * Atomicity: the record is written to a sibling temporary file and renamed
 * over the target, so readers observe either the previous record or the
 * complete new one — never a partial write. A bind failure never reaches
 * this module (the composition root writes only after `startGateway`
 * returns), so an existing record survives failed boots untouched.
 */

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { resolveConfigDirectory } from "@loop/orchestrator/config";

import { isCgnatIpv4 } from "./tailscale";

/** Env var overriding the well-known record path (test seam). */
export const GATEWAY_RUNTIME_FILE_ENV = "LOOP_GATEWAY_RUNTIME_FILE";

/** File name inside the resolved Loop config directory. */
export const GATEWAY_RUNTIME_FILE_NAME = "gateway.json";

/** The connection pair, and nothing else. Secret fields are unrepresentable. */
export type GatewayRuntimeRecord = { host: string; port: number };

/** Resolve the runtime record path: explicit override first, then the
 * existing Loop config directory convention (`LOOP_CONFIG_DIR` /
 * `XDG_CONFIG_HOME/loop` / `~/.config/loop`). */
export function gatewayRuntimeRecordPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[GATEWAY_RUNTIME_FILE_ENV];
  if (override !== undefined && override.trim().length > 0) {
    const trimmed = override.trim();
    return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
  }
  return join(resolveConfigDirectory({ environment: env }), GATEWAY_RUNTIME_FILE_NAME);
}

function assertRecordHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.length === 0) throw new Error("gateway runtime record requires a host");
  if (/[\s/:]/.test(trimmed)) {
    throw new Error("gateway runtime record host must be a bare address without scheme or port");
  }
  return trimmed;
}

function assertRecordPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("gateway runtime record requires an integer port in 1..65535");
  }
  return port;
}

/** Atomically replace the runtime record. Partial writes are never visible:
 * the payload lands in a sibling temp file that is renamed over the target
 * (POSIX rename is atomic within a directory). Any validation or I/O error
 * leaves the previous record untouched. */
export function writeGatewayRuntimeRecord(
  path: string,
  record: GatewayRuntimeRecord,
): GatewayRuntimeRecord {
  const validated: GatewayRuntimeRecord = {
    host: assertRecordHost(record.host),
    port: assertRecordPort(record.port),
  };
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    // Exactly two keys — the serialization is the secret-exclusion proof.
    writeFileSync(temp, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      /* temp never created or already gone; the target is still intact */
    }
    throw error;
  }
  return validated;
}

/** Pure parse of `tailscale status --json` output into this machine's
 * MagicDNS name (Self.DNSName, trailing dot stripped). Anything unexpected —
 * invalid JSON, absent Self/DNSName, whitespace — yields null so the caller
 * degrades to the bound host verbatim. */
export function magicDnsNameFromStatusOutput(raw: string): string | null {
  try {
    const status = JSON.parse(raw) as { Self?: { DNSName?: string } };
    const dnsName = status.Self?.DNSName?.trim().replace(/\.$/, "");
    return dnsName !== undefined && dnsName.length > 0 ? dnsName : null;
  } catch {
    return null;
  }
}

/** Decide the host written to the pairing record (decision: loop pair
 * MagicDNS-first). A tailnet-facing bind (Tailscale CGNAT IPv4) is re-labeled
 * with the machine's MagicDNS name when known — the name resolves to this
 * same machine regardless of which address the gateway bound, and iOS ATS
 * accepts DNS names while rejecting bare IPs. Any other bind (loopback
 * bearer-fallback, non-CGNAT) or an unknown MagicDNS name keeps the bound
 * host verbatim: the record never claims reachability it does not have. */
export function pairingRecordHost(boundHost: string, magicDnsName: string | null): string {
  if (!isCgnatIpv4(boundHost)) return boundHost;
  const name = magicDnsName?.trim() ?? "";
  return name.length > 0 ? name : boundHost;
}
