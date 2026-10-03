/**
 * Gateway adapter configuration (ADR §4.2 / adapter-local types).
 *
 * Only the ENV-VAR NAMES of the bearer material live in config. Secret,
 * issuer, and audience VALUES are read from the environment (process memory)
 * at verification time and are never persisted or logged anywhere.
 *
 * Auth mode (decision 2026-xx-tokenless-auth-and-app-layout §D-A): the
 * default "tailscale" mode binds only an active Tailscale CGNAT interface and
 * trusts tailnet membership — clients present no bearer material. The
 * explicit "bearer-fallback" mode is the only non-Tailscale path; it requires
 * bearer verification on every request and fails closed at startup when the
 * signing material is not configured.
 */

/** Config-selected authentication mode (decision §D-A1/§D-A3). */
export type GatewayAuthMode = "tailscale" | "bearer-fallback";

/** Optional tailscale-mode identity hardening (decision §D-A2). "whois"
 * requires platform peer-identity support; the composition must supply an
 * identity verifier or startup is rejected deterministically. */
export type GatewayIdentityMode = "off" | "whois";

/** Secondary tailscale-mode loopback listener (decision §D-A4 amendment).
 * Enabled by default in tailscale mode so same-host clients (local apps,
 * browser demos, curl) reach the gateway over 127.0.0.1 without touching the
 * off-box tailnet surface. Ignored in bearer-fallback mode, whose single
 * explicit bind already decides its own surface. */
export type GatewayLoopbackConfig = {
  /** Default true (tailscale mode only). */
  enabled?: boolean;
  /** Loopback IP literal; default "127.0.0.1" (validated fail-closed at
   * startup by `validateLoopbackBindHost`). */
  host?: string;
  /** Default: the primary listener's port. */
  port?: number;
};

import {
  HEARTBEAT_MS,
  MAX_PANE_TEXT_BYTES,
  MAX_OBSERVED_PANES,
  PANE_POLL_MS,
  PANE_READ_LINES,
  PANE_REPLAY_BUFFER_FRAMES,
  QUEUE_MAX_BYTES,
  QUEUE_MAX_FRAMES,
  REPLAY_BUFFER_FRAMES,
  SESSION_MAX_FRAME_BYTES,
  SESSION_MERGE_FLUSH_MS,
  SESSION_MERGE_TICK_MS,
  SESSION_REPLAY_BUFFER_FRAMES,
} from "./wire";

export type GatewayAuthEnvNames = {
  /** Environment variable holding the HS256 signing secret. */
  secretEnv: string;
  /** Environment variable holding the exact required `iss` claim value. */
  issuerEnv: string;
  /** Environment variable holding the exact required `aud` claim value. */
  audienceEnv: string;
};

export type GatewayPaneConfig = {
  /** Pane observation poll interval in ms (decision D2 default 250). */
  pollMs?: number;
  /** Upstream bound: panes actually read per tick (decision D5). */
  maxObservedPanes?: number;
  /** Per-pane replay ring buffer size in frames (decision D5). */
  replayBufferFrames?: number;
  /** Per-frame UTF-8 byte cap before `truncated: true` (decision D5). */
  maxFrameBytes?: number;
  /** `pane.read` window in lines. */
  readLines?: number;
};

/** GUI conversation session bounds (decision 2026-xx-gui-conversation D2/D3).
 * The tap ingress socket path is resolved by the composition root from the
 * environment (same axis as the pane socket), not from this config. */
export type GatewaySessionConfig = {
  /** Minimum assistant delta merge interval in ms (decision D4 §2). */
  mergeFlushMs?: number;
  /** Merge pump interval in ms (0 disables the pump — test-only value). */
  mergeTickMs?: number;
  /** Per-session replay ring buffer size in frames (decision D3). */
  replayBufferFrames?: number;
  /** Per-frame UTF-8 byte cap before `*_truncated: true` (decision D2). */
  maxFrameBytes?: number;
};

export type GatewayConfig = {
  /** Tailscale mode: explicit CGNAT IP bound to an active interface;
   * wildcard/loopback/LAN binds fail closed (ADR §2 D2). Bearer-fallback
   * mode: any explicit IP literal except wildcard/multicast (decision §D-A3).
   */
  host: string;
  /** TCP port 1..65535. Port 0 (OS-assigned) is a test-only value that
   * `parseGatewayConfig` never produces. */
  port: number;
  /** Authentication mode; default "tailscale" (decision §D-A1). */
  authMode?: GatewayAuthMode;
  /** Tailscale-mode secondary loopback listener (decision §D-A4);
   * default enabled on 127.0.0.1 at the primary port. */
  loopback?: GatewayLoopbackConfig;
  /** Tailscale-mode peer-identity hardening; default "off" (decision §D-A2). */
  identity?: GatewayIdentityMode;
  /** Bearer material env-var names; defaults to the LOOP_GATEWAY_JWT_* names. */
  auth?: GatewayAuthEnvNames;
  /** Max concurrent accepted+planning submissions before 429 (ADR §4.3). */
  planningLimit?: number;
  /** SSE keepalive interval in ms (tests shrink this). */
  heartbeatMs?: number;
  /** Per-run replay ring buffer size in frames. */
  replayBufferFrames?: number;
  /** Per-connection outbound queue caps (ADR §4.5). */
  queueMaxFrames?: number;
  queueMaxBytes?: number;
  /** Terminal-mirror pane observation bounds (decision 2026-xx-terminal-mirror). */
  pane?: GatewayPaneConfig;
  /** GUI conversation session bounds (decision 2026-xx-gui-conversation). */
  session?: GatewaySessionConfig;
};

export const DEFAULT_AUTH_ENV_NAMES: GatewayAuthEnvNames = {
  secretEnv: "LOOP_GATEWAY_JWT_SECRET",
  issuerEnv: "LOOP_GATEWAY_JWT_ISSUER",
  audienceEnv: "LOOP_GATEWAY_JWT_AUDIENCE",
};

export const DEFAULT_PLANNING_LIMIT = 32;

/** Validate and normalize externally supplied config (composition root input). */
export function parseGatewayConfig(input: GatewayConfig): Required<
  Omit<GatewayConfig, "auth" | "pane" | "session" | "authMode" | "identity" | "loopback">
> & {
  auth: GatewayAuthEnvNames;
  authMode: GatewayAuthMode;
  identity: GatewayIdentityMode;
  loopback: Required<GatewayLoopbackConfig>;
  pane: Required<GatewayPaneConfig>;
  session: Required<GatewaySessionConfig>;
} {
  if (typeof input.host !== "string" || input.host.trim().length === 0) {
    throw new Error("gateway config requires a host");
  }
  const authMode = input.authMode ?? "tailscale";
  if (authMode !== "tailscale" && authMode !== "bearer-fallback") {
    throw new Error('gateway config authMode must be "tailscale" or "bearer-fallback"');
  }
  const identity = input.identity ?? "off";
  if (identity !== "off" && identity !== "whois") {
    throw new Error('gateway config identity must be "off" or "whois"');
  }
  // Loopback secondary listener (decision §D-A4): structural validation only —
  // loopback-literal-ness is enforced fail-closed at startup by the server.
  const loopback = input.loopback ?? {};
  if (loopback.enabled !== undefined && typeof loopback.enabled !== "boolean") {
    throw new Error("gateway config loopback.enabled must be a boolean");
  }
  if (
    loopback.host !== undefined &&
    (typeof loopback.host !== "string" || loopback.host.trim().length === 0)
  ) {
    throw new Error("gateway config loopback.host must be a non-empty string");
  }
  if (
    loopback.port !== undefined &&
    (!Number.isInteger(loopback.port) || loopback.port < 1 || loopback.port > 65535)
  ) {
    throw new Error("gateway config loopback.port must be an integer in 1..65535");
  }
  // Peer identity is a tailscale-mode hardening (decision §D-A2); bearer
  // fallback already authenticates every request, so the option is noise.
  if (authMode !== "tailscale" && identity !== "off") {
    throw new Error('gateway config identity "whois" applies only to authMode "tailscale"');
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error("gateway config requires an integer port in 1..65535");
  }
  const pane = input.pane ?? {};
  const panePollMs = pane.pollMs ?? PANE_POLL_MS;
  const paneMaxObserved = pane.maxObservedPanes ?? MAX_OBSERVED_PANES;
  const paneReplay = pane.replayBufferFrames ?? PANE_REPLAY_BUFFER_FRAMES;
  const paneMaxFrameBytes = pane.maxFrameBytes ?? MAX_PANE_TEXT_BYTES;
  const paneReadLines = pane.readLines ?? PANE_READ_LINES;
  const session = input.session ?? {};
  const sessionMergeFlush = session.mergeFlushMs ?? SESSION_MERGE_FLUSH_MS;
  const sessionMergeTick = session.mergeTickMs ?? SESSION_MERGE_TICK_MS;
  const sessionReplay = session.replayBufferFrames ?? SESSION_REPLAY_BUFFER_FRAMES;
  const sessionMaxFrameBytes = session.maxFrameBytes ?? SESSION_MAX_FRAME_BYTES;
  for (const [name, value, minimum] of [
    ["pane.pollMs", panePollMs, 1],
    ["pane.maxObservedPanes", paneMaxObserved, 1],
    ["pane.replayBufferFrames", paneReplay, 1],
    ["pane.maxFrameBytes", paneMaxFrameBytes, 1],
    ["pane.readLines", paneReadLines, 1],
    ["session.mergeFlushMs", sessionMergeFlush, 1],
    // 0 disables the pump (test-only value; production drives ticks itself).
    ["session.mergeTickMs", sessionMergeTick, 0],
    ["session.replayBufferFrames", sessionReplay, 1],
    ["session.maxFrameBytes", sessionMaxFrameBytes, 1],
  ] as const) {
    if (!Number.isInteger(value) || value < minimum) {
      throw new Error(`gateway config requires an integer ${name} >= ${minimum}`);
    }
  }
  return {
    host: input.host,
    port: input.port,
    authMode,
    identity,
    loopback: {
      enabled: loopback.enabled ?? true,
      host: loopback.host ?? "127.0.0.1",
      port: loopback.port ?? input.port,
    },
    auth: input.auth ?? DEFAULT_AUTH_ENV_NAMES,
    planningLimit: input.planningLimit ?? DEFAULT_PLANNING_LIMIT,
    heartbeatMs: input.heartbeatMs ?? HEARTBEAT_MS,
    replayBufferFrames: input.replayBufferFrames ?? REPLAY_BUFFER_FRAMES,
    queueMaxFrames: input.queueMaxFrames ?? QUEUE_MAX_FRAMES,
    queueMaxBytes: input.queueMaxBytes ?? QUEUE_MAX_BYTES,
    pane: {
      pollMs: panePollMs,
      maxObservedPanes: paneMaxObserved,
      replayBufferFrames: paneReplay,
      maxFrameBytes: paneMaxFrameBytes,
      readLines: paneReadLines,
    },
    session: {
      mergeFlushMs: sessionMergeFlush,
      mergeTickMs: sessionMergeTick,
      replayBufferFrames: sessionReplay,
      maxFrameBytes: sessionMaxFrameBytes,
    },
  };
}

/** Composition-root convenience: read host/port from the environment. */
export function gatewayConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GatewayConfig {
  const host = env.LOOP_GATEWAY_HOST;
  const port = env.LOOP_GATEWAY_PORT;
  if (host === undefined || port === undefined) {
    throw new Error("LOOP_GATEWAY_HOST and LOOP_GATEWAY_PORT are required");
  }
  const parsedPort = Number.parseInt(port, 10);
  const rawLoopback = env.LOOP_GATEWAY_LOOPBACK;
  if (rawLoopback !== undefined && rawLoopback !== "on" && rawLoopback !== "off") {
    throw new Error('LOOP_GATEWAY_LOOPBACK must be "on" or "off"');
  }
  const rawLoopbackPort = env.LOOP_GATEWAY_LOOPBACK_PORT;
  const loopbackPort =
    rawLoopbackPort === undefined ? undefined : Number.parseInt(rawLoopbackPort, 10);
  if (
    rawLoopbackPort !== undefined &&
    (!Number.isInteger(loopbackPort) || loopbackPort! < 1 || loopbackPort! > 65535)
  ) {
    throw new Error("LOOP_GATEWAY_LOOPBACK_PORT must be an integer in 1..65535");
  }
  return {
    host,
    port: parsedPort,
    loopback: {
      enabled: rawLoopback === undefined ? undefined : rawLoopback === "on",
      host: env.LOOP_GATEWAY_LOOPBACK_HOST,
      port: loopbackPort,
    },
    auth: {
      secretEnv: env.LOOP_GATEWAY_JWT_SECRET_ENV ?? DEFAULT_AUTH_ENV_NAMES.secretEnv,
      issuerEnv: env.LOOP_GATEWAY_JWT_ISSUER_ENV ?? DEFAULT_AUTH_ENV_NAMES.issuerEnv,
      audienceEnv: env.LOOP_GATEWAY_JWT_AUDIENCE_ENV ?? DEFAULT_AUTH_ENV_NAMES.audienceEnv,
    },
  };
}
