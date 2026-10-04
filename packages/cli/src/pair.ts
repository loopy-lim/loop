/**
 * `loop pair` — QR pairing surface for the running gateway (decision
 * 2026-xx-qr-pairing). Read-only: prints the `loop://connect` payload URL
 * and a UTF-8 ASCII QR; it never opens a connection or mutates state.
 *
 * Port resolution order (decision: loop pair port fallback):
 *   1. LOOP_GATEWAY_PORT — the same environment the gateway composition root
 *      reads — wins when set,
 *   2. then the gateway runtime record (`gateway.json` in the Loop config
 *      directory, written by packages/gateway/src/runtime-record.ts after a
 *      successful bind; path override via LOOP_GATEWAY_RUNTIME_FILE),
 *   3. otherwise a ConfigError naming both sources.
 *
 * Host resolution order (decision D-C + MagicDNS-first amendment): explicit
 * `--host` flag, then the MagicDNS name of this machine via
 * `tailscale status --json`, then the host recorded in the gateway runtime
 * record (`gateway.json`), then LOOP_GATEWAY_HOST as-is (with an iOS ATS
 * warning when the resolved host is a bare IP). The MagicDNS name wins over
 * recorded/env sources because it names the same machine regardless of which
 * address the gateway bound — iOS ATS rejects bare-IP payloads outright.
 *
 * The payload never carries secrets: tokenless mode has no secret, the
 * bearer-fallback token is forbidden in QR payloads (decision §D-A), and the
 * runtime record itself holds only the connection pair.
 * Errors surface through the CLI's redacting error path.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { ConfigError, resolveConfigDirectory } from "@loop/orchestrator/config";
import { encodeQrMatrix, renderAsciiQr } from "./qr";
import { probeTailscaleStatus } from "./tailscale-cli";

export const PAIR_URL_PREFIX = "loop://connect?";

export class PairUrlError extends Error {
  override readonly name = "PairUrlError";
  constructor(message: string) {
    super(message);
  }
}

const MIN_PORT = 1;
const MAX_PORT = 65535;

/** Gateway runtime record conventions — MUST stay in sync with the writer,
 * packages/gateway/src/runtime-record.ts (kept duplicate rather than adding a
 * cli → gateway dependency; the contract is pinned by tests on both sides). */
export const GATEWAY_RUNTIME_FILE_ENV = "LOOP_GATEWAY_RUNTIME_FILE";
export const GATEWAY_RUNTIME_FILE_NAME = "gateway.json";

/** The connection pair as written by the gateway. Only these two keys are
 * ever read; unknown or secret-bearing fields in the file are ignored. */
export type GatewayRuntimeRecord = { host: string; port: number };

/** Resolve the runtime record path exactly like the gateway writer: explicit
 * LOOP_GATEWAY_RUNTIME_FILE override first (absolute or cwd-relative), then
 * the existing Loop config directory convention. */
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

/** Build the QR payload: `loop://connect?host=<host>&port=<port>`. */
export function buildPairUrl(host: string, port: number | string): string {
  return `${PAIR_URL_PREFIX}host=${assertPairHost(host)}&port=${assertPairPort(port)}`;
}

/** Parse a pairing payload back to its connection pair. Unknown query
 * parameters are ignored (forward compatibility); secret-bearing parameters
 * are rejected outright instead of being silently accepted. */
export function parsePairUrl(url: string): { host: string; port: number } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PairUrlError("pairing payload is not a valid URL");
  }
  if (parsed.protocol.toLowerCase() !== "loop:") {
    throw new PairUrlError(`not a loop pairing URL (scheme ${parsed.protocol})`);
  }
  if (parsed.hostname.toLowerCase() !== "connect") {
    throw new PairUrlError(`unexpected loop URL target: ${parsed.hostname || "(none)"}`);
  }
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_PARAM_PATTERN.test(key)) {
      throw new PairUrlError(`pairing payload must not carry secrets (refused parameter: ${key})`);
    }
  }
  const host = parsed.searchParams.get("host");
  const port = parsed.searchParams.get("port");
  if (host === null || port === null)
    throw new PairUrlError("pairing payload requires host and port parameters");
  return { host: assertPairHost(host), port: assertPairPort(port) };
}

/** The host is an IPv4 literal: iOS ATS rejects numeric hosts, so scanning
 * this QR on the phone fails even though the payload parses (decision D-A). */
export function isIpLiteralHost(host: string): boolean {
  return IPV4_LITERAL.test(host);
}

export type PairHostSource = "flag" | "magicdns" | "record" | "env";

export type PairInfo = {
  url: string;
  host: string;
  port: number;
  source: PairHostSource;
  /** Present when the payload host is an IP literal (iOS ATS caveat). */
  ipAtsWarning: boolean;
};

export type PairDeps = {
  env: Record<string, string | undefined>;
  probe: (command: string, args: string[]) => Promise<{ exitCode: number; output: string }>;
  /** Reads the runtime record file; returns null when absent or unreadable.
   * Defaults to node:fs — inject for tests or exotic environments. */
  readRuntimeFile?: (path: string) => string | null;
  /** Optional auto-start hook (decision: loop pair auto-spawn): runs before
   * pair resolution so a stopped gateway is spawned as a background daemon
   * and a live one is reused untouched. Implemented in gateway.ts; inject a
   * spy in tests. Throws ConfigError on fail-closed refusal. */
  ensureGateway?: () => Promise<void>;
};

function defaultReadRuntimeFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Parse the runtime record into the connection pair. Anything unexpected —
 * missing file, invalid JSON, non-bare host, out-of-range port — yields null
 * so the fallback degrades to the explicit-source error instead of guessing. */
export function parseGatewayRuntimeRecord(raw: string | null): GatewayRuntimeRecord | null {
  if (raw === null || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.host !== "string" || typeof record.port !== "number") return null;
  try {
    // assertPairHost rejects scheme/port forms; unknown keys (and any
    // secret-shaped fields) are ignored — only the pair is ever surfaced.
    return { host: assertPairHost(record.host), port: assertPairPort(record.port) };
  } catch {
    return null;
  }
}

/** Single lazy read of the runtime record: both the port fallback and the
 * host fallback share one file read (and one parse) per resolution. */
function memoizedRecordReader(deps: PairDeps): () => GatewayRuntimeRecord | null {
  let cache: GatewayRuntimeRecord | null | undefined;
  return () => {
    if (cache === undefined) {
      cache = parseGatewayRuntimeRecord(
        (deps.readRuntimeFile ?? defaultReadRuntimeFile)(gatewayRuntimeRecordPath(deps.env)),
      );
    }
    return cache;
  };
}

/** Resolve the pairing host without mutating anything. */
export async function resolvePair(deps: PairDeps, hostFlag?: string): Promise<PairInfo> {
  const readRecord = memoizedRecordReader(deps);
  let port: number;
  const portRaw = deps.env.LOOP_GATEWAY_PORT?.trim();
  if (portRaw !== undefined && portRaw.length > 0) {
    // An explicitly set but invalid env port fails closed: falling back would
    // silently point the QR at a different gateway than the operator set.
    port = assertPairPort(portRaw);
  } else {
    const recordPath = gatewayRuntimeRecordPath(deps.env);
    const record = readRecord();
    if (record === null) {
      throw new ConfigError(
        "pair-port-unresolved",
        `loop pair could not resolve the gateway port: set LOOP_GATEWAY_PORT (the running gateway's port), or start the gateway once so it records the bound port in ${recordPath}`,
      );
    }
    port = record.port;
  }
  let host: string;
  let source: PairHostSource;
  if (hostFlag !== undefined && hostFlag.trim().length > 0) {
    host = hostFlag;
    source = "flag";
  } else {
    const magicDns = await probeMagicDnsHost(deps.probe);
    if (magicDns !== null) {
      host = magicDns;
      source = "magicdns";
    } else {
      // No MagicDNS name: the recorded bound host is the next-most-authoritative
      // source (the gateway wrote it after a successful bind), ahead of the
      // ambient LOOP_GATEWAY_HOST.
      const recordHost = readRecord()?.host;
      if (recordHost !== undefined) {
        host = recordHost;
        source = "record";
      } else {
        const envHost = deps.env.LOOP_GATEWAY_HOST;
        if (envHost === undefined || envHost.trim().length === 0) {
          throw new ConfigError(
            "pair-host-unresolved",
            "cannot resolve a pairing host: pass --host <tailscale-host>, run inside the tailnet (tailscale status), or set LOOP_GATEWAY_HOST",
          );
        }
        host = envHost;
        source = "env";
      }
    }
  }
  const pairHost = assertPairHost(host);
  return {
    url: buildPairUrl(pairHost, port),
    host: pairHost,
    port,
    source,
    ipAtsWarning: isIpLiteralHost(pairHost),
  };
}

async function probeMagicDnsHost(probe: PairDeps["probe"]): Promise<string | null> {
  // Tailscale CLI candidates: PATH first, then the macOS app bundle CLI
  // (the GUI install does not put `tailscale` on PATH).
  const result = await probeTailscaleStatus(probe);
  if (result === null) return null;
  try {
    const status = JSON.parse(result.output) as { Self?: { DNSName?: string } };
    const dnsName = status.Self?.DNSName?.trim().replace(/\.$/, "");
    return dnsName !== undefined && dnsName.length > 0 ? dnsName : null;
  } catch {
    return null;
  }
}

/** Render the plain-text `pair` output: URL line, ASCII QR, usage hints. */
export function formatPairText(info: PairInfo): string {
  const lines = [
    "Scan with the phone's system camera — the loop:// link opens LoopMobile and connects.",
    "",
    info.url,
    "",
    renderAsciiQr(encodeQrMatrix(info.url).matrix),
    "",
    `Host source: ${info.source}`,
    "Tailnet-only: this address is unreachable outside the tailnet — a leaked QR grants nothing.",
  ];
  if (info.ipAtsWarning) {
    lines.push(
      "Warning: the host is a bare IP; iOS ATS rejects numeric hosts — prefer --host <magicdns-name>.",
    );
  }
  return lines.join("\n") + "\n";
}

/** `loop pair` command body. Output-only once the pair is resolved; the
 * optional ensureGateway hook may spawn the background daemon first. Exit
 * code follows CLI convention. */
export async function runPairCommand(
  deps: PairDeps,
  io: { stdout(value: string): void; stderr(value: string): void },
  options: { hostFlag?: string; json?: boolean },
): Promise<number> {
  if (deps.ensureGateway !== undefined) await deps.ensureGateway();
  const info = await resolvePair(deps, options.hostFlag);
  if (options.json === true) {
    io.stdout(
      `${JSON.stringify({ url: info.url, host: info.host, port: info.port, source: info.source })}\n`,
    );
  } else {
    io.stdout(formatPairText(info));
  }
  return 0;
}
