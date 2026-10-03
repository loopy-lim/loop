/**
 * `loop pair` — QR pairing surface for the running gateway (decision
 * 2026-xx-qr-pairing). Read-only: prints the `loop://connect` payload URL
 * and a UTF-8 ASCII QR; it never opens a connection or mutates state.
 *
 * Host resolution order (decision D-C): explicit `--host` flag, then the
 * MagicDNS name of this machine via `tailscale status --json`, then
 * LOOP_GATEWAY_HOST as-is (with an iOS ATS warning when it is a bare IP).
 * Port comes from LOOP_GATEWAY_PORT — the same environment the gateway
 * composition root reads — so the QR always describes the running gateway.
 *
 * The payload never carries secrets: tokenless mode has no secret, and the
 * bearer-fallback token is forbidden in QR payloads (decision §D-A).
 * Errors surface through the CLI's redacting error path.
 */

import { ConfigError } from "@loop/orchestrator/config";
import { encodeQrMatrix, renderAsciiQr } from "./qr";

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

export type PairHostSource = "flag" | "magicdns" | "env";

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
};

/** Resolve the pairing host without mutating anything. */
export async function resolvePair(deps: PairDeps, hostFlag?: string): Promise<PairInfo> {
  const portRaw = deps.env.LOOP_GATEWAY_PORT;
  if (portRaw === undefined || portRaw.trim().length === 0) {
    throw new ConfigError(
      "gateway-env-missing",
      "loop pair requires LOOP_GATEWAY_PORT (the running gateway's port)",
    );
  }
  const port = assertPairPort(portRaw);
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
  let result: { exitCode: number; output: string };
  try {
    result = await probe("tailscale", ["status", "--json"]);
  } catch {
    return null;
  }
  if (result.exitCode !== 0) return null;
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

/** `loop pair` command body. Output-only; exit code follows CLI convention. */
export async function runPairCommand(
  deps: PairDeps,
  io: { stdout(value: string): void; stderr(value: string): void },
  options: { hostFlag?: string; json?: boolean },
): Promise<number> {
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
