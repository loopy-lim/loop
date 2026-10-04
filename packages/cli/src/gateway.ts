/**
 * Gateway daemon supervision (decision: loop pair auto-spawn).
 *
 * `loop pair` must be a single command: when no live gateway is detected it
 * spawns the gateway composition root (packages/gateway/src/main.ts) as a
 * detached background daemon — Tailscale-only binding, an OS-assigned free
 * port, and the default Loop database path — then lets the existing pairing
 * resolution print the QR. When a gateway is already alive (runtime record
 * `gateway.json` + loopback/tailnet port probe + PID record) it is reused and
 * never double-started.
 *
 * Boundary note: the CLI deliberately holds NO `@loop/gateway` dependency
 * (the same convention as the duplicated runtime-record constants in
 * pair.ts). The daemon is the unmodified gateway entrypoint started with
 * `bun`; this module only decides whether to start it and supervises the
 * PID record for `loop gateway status|stop`.
 *
 * Secrets: the daemon inherits the operator environment as-is; this module
 * never reads, writes, logs, or persists credential values. The PID record
 * holds one integer — the spawned process id — and nothing else.
 *
 * Fail-closed Tailscale principle: without a reachable `tailscale status`
 * reporting a CGNAT address on this machine, auto-spawn refuses with a
 * named ConfigError instead of falling back to a non-Tailscale bind.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, connect, type AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError, resolveConfigDirectory } from "@loop/orchestrator/config";

import {
  gatewayRuntimeRecordPath,
  parseGatewayRuntimeRecord,
  type GatewayRuntimeRecord,
} from "./pair";
import { probeTailscaleStatus } from "./tailscale-cli";

/** The default database file inside the Loop config directory — the same
 * convention `loadLoopConfig` uses for `--database`-less invocations. */
export const DEFAULT_DATABASE_FILE_NAME = "loop.sqlite";

/** PID record: `<runtime record path>.pid`, so the existing
 * LOOP_GATEWAY_RUNTIME_FILE override relocates both files together (tests
 * never touch the real user config directory). */
export const GATEWAY_PID_SUFFIX = ".pid";

export function gatewayPidFilePath(env: Record<string, string | undefined> = process.env): string {
  return `${gatewayRuntimeRecordPath(env)}${GATEWAY_PID_SUFFIX}`;
}

/** Parse the PID record. Anything unexpected yields null — a corrupt record
 * degrades to "no PID" handling instead of blocking pair or stop. */
export function parsePidFile(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const pid = Number.parseInt(trimmed, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Pure Tailscale CGNAT range check: 100.64.0.0/10, the only range the
 * gateway's fail-closed bind policy accepts in tailscale mode. */
export function isCgnatIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host.trim());
  if (match === null) return false;
  const octets = match.slice(1).map((value) => Number.parseInt(value, 10));
  if (octets.some((value) => value > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 100 && b >= 64 && b <= 127;
}

export type Probe = (
  command: string,
  args: string[],
) => Promise<{ exitCode: number; output: string }>;

/** Resolve this machine's Tailscale bind address via `tailscale status
 * --json` (the same probe family the MagicDNS detection in pair.ts uses).
 * Returns the first IPv4 CGNAT address of Self, or null when Tailscale is
 * absent/not running — callers turn null into a named ConfigError. */
export async function probeTailscaleBindIp(probe: Probe): Promise<string | null> {
  // Same CLI resolution as the MagicDNS probe: PATH first, then the macOS
  // app bundle CLI (the GUI install does not put `tailscale` on PATH).
  const result = await probeTailscaleStatus(probe);
  if (result === null) return null;
  try {
    const status = JSON.parse(result.output) as { Self?: { TailscaleIPs?: string[] } };
    const addresses = status.Self?.TailscaleIPs ?? [];
    return addresses.find((address) => isCgnatIpv4(address)) ?? null;
  } catch {
    return null;
  }
}

export type FreePortAllocator = () => Promise<number>;

/** OS-assigned free port: bind 127.0.0.1:0, read the assigned port, release.
 * The classic TOCTOU window is accepted: the daemon binds within seconds and
 * a collision fails loudly at its bind, never silently. */
export async function pickFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolveClose, reject) => {
    server.once("error", reject);
    server.close(() => resolveClose());
  });
  return address.port;
}

export type PortProbe = (host: string, port: number) => Promise<boolean>;

/** TCP liveness probe: the port accepts a connection or it does not. */
export async function isPortAccepting(
  host: string,
  port: number,
  timeoutMs = 750,
): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = connect({ host, port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolveProbe(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs);
  });
}

/** A gateway is alive when its recorded port accepts connections. The
 * loopback listener (enabled by default in tailscale mode) is probed first;
 * the recorded tailnet address is the fallback for loopback-suppressed
 * setups. */
export async function isGatewayAlive(
  record: GatewayRuntimeRecord,
  probePort: PortProbe = isPortAccepting,
): Promise<boolean> {
  if (await probePort("127.0.0.1", record.port)) return true;
  if (record.host !== "127.0.0.1") return probePort(record.host, record.port);
  return false;
}

/** The auto-spawn decision (pinned by tests). `stalePid` is the dead PID to
 * clean up before spawning; a live PID with a dead port means the daemon is
 * still booting, so reuse wins over double-start. */
export type GatewayDecision =
  | { action: "reuse"; reason: string }
  | { action: "spawn"; reason: string; stalePid: number | null };

export function decideGatewayAction(input: {
  record: GatewayRuntimeRecord | null;
  alive: boolean;
  pid: number | null;
  pidAlive: boolean;
}): GatewayDecision {
  if (input.record === null) {
    if (input.pid !== null && input.pidAlive) {
      return { action: "reuse", reason: "daemon pid is alive; runtime record not written yet" };
    }
    return { action: "spawn", reason: "no runtime record", stalePid: null };
  }
  if (input.alive) return { action: "reuse", reason: "gateway port is accepting connections" };
  if (input.pid !== null && input.pidAlive) {
    return { action: "reuse", reason: "daemon pid is alive; port not accepting yet" };
  }
  return {
    action: "spawn",
    reason:
      input.pid !== null
        ? "runtime record is stale and the recorded pid is dead"
        : "runtime record is stale: recorded port is not accepting connections",
    stalePid: input.pid !== null && !input.pidAlive ? input.pid : null,
  };
}

/** The `bun` executable that runs the daemon entrypoint: the running bun
 * binary in dev, otherwise `bun` from PATH (the compiled `dist/loop` binary
 * cannot execute TypeScript itself). */
export function resolveBunCommand(executablePath: string): string {
  return executablePath.split("/").pop() === "bun" ? executablePath : "bun";
}

/** Where the gateway entrypoint lives: relative to the executable (compiled
 * `dist/loop` → repo checkout), then relative to this module (dev source
 * layout). The first existing candidate wins. */
export function gatewayEntryCandidates(executablePath: string, moduleDir: string): string[] {
  return [
    resolve(executablePath, "..", "..", "packages", "gateway", "src", "main.ts"),
    resolve(moduleDir, "..", "..", "gateway", "src", "main.ts"),
  ];
}

export function resolveGatewayEntryPath(
  executablePath: string,
  moduleDir = dirname(fileURLToPath(import.meta.url)),
): string {
  for (const candidate of gatewayEntryCandidates(executablePath, moduleDir)) {
    if (existsSync(candidate)) return candidate;
  }
  throw new ConfigError(
    "gateway-entry-not-found",
    `gateway entrypoint not found (looked in: ${gatewayEntryCandidates(executablePath, moduleDir).join(", ")})`,
  );
}

export type SpawnPlan = {
  /** Tailscale CGNAT IP the daemon binds (fail-closed tailscale-only). */
  host: string;
  /** OS-assigned free port. */
  port: number;
  /** Default database path unless explicitly overridden. */
  databasePath: string;
  /** Gateway composition-root entrypoint file. */
  entryPath: string;
  /** bun executable used to run the entrypoint. */
  command: string;
  /** Daemon working directory (the repository root above the entrypoint). */
  cwd: string;
  /** Exact daemon environment overrides (merged over the operator env). */
  env: Record<string, string>;
};

export type GatewayDeps = {
  env: Record<string, string | undefined>;
  probe: Probe;
  probePort?: PortProbe;
  readRuntimeFile?: (path: string) => string | null;
  readPidFile?: (path: string) => string | null;
  pidAlive?: (pid: number) => boolean;
  pickFreePort?: FreePortAllocator;
  /** Explicit database path override (e.g. `loop pair --database`). */
  databasePath?: string;
  executablePath?: string;
};

function defaultReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readRecord(deps: GatewayDeps): GatewayRuntimeRecord | null {
  return parseGatewayRuntimeRecord(
    (deps.readRuntimeFile ?? defaultReadFile)(gatewayRuntimeRecordPath(deps.env)),
  );
}

function readPid(deps: GatewayDeps): number | null {
  return parsePidFile((deps.readPidFile ?? defaultReadFile)(gatewayPidFilePath(deps.env)));
}

export type GatewayStatusInfo = {
  running: boolean;
  record: GatewayRuntimeRecord | null;
  pid: number | null;
  pidAlive: boolean;
};

/** Shared status snapshot for `gateway status`, `gateway stop`, and the pair
 * auto-spawn decision. */
export async function readGatewayStatus(deps: GatewayDeps): Promise<GatewayStatusInfo> {
  const record = readRecord(deps);
  const alive = record !== null ? await isGatewayAlive(record, deps.probePort) : false;
  const pid = readPid(deps);
  const pidAlive = pid !== null ? (deps.pidAlive ?? defaultPidAlive)(pid) : false;
  return { running: alive, record, pid, pidAlive };
}

/** Build the daemon spawn plan: Tailscale bind IP (fail-closed), free port,
 * default database path, and the gateway composition-root entrypoint. Pure
 * orchestration — no bind happens here. */
export async function planGatewaySpawn(deps: GatewayDeps): Promise<SpawnPlan> {
  const host = await probeTailscaleBindIp(deps.probe);
  if (host === null) {
    throw new ConfigError(
      "tailscale-unavailable",
      "cannot auto-start the gateway: no Tailscale CGNAT address was reported by `tailscale status` — start Tailscale (tailscale up) first; the gateway binds tailnet interfaces only",
    );
  }
  const port = await (deps.pickFreePort ?? pickFreePort)();
  const databasePath =
    deps.databasePath ??
    join(resolveConfigDirectory({ environment: deps.env }), DEFAULT_DATABASE_FILE_NAME);
  const entryPath = resolveGatewayEntryPath(deps.executablePath ?? process.execPath);
  return {
    host,
    port,
    databasePath,
    entryPath,
    command: resolveBunCommand(deps.executablePath ?? process.execPath),
    cwd: resolve(entryPath, "..", "..", ".."),
    env: {
      LOOP_GATEWAY_HOST: host,
      LOOP_GATEWAY_PORT: String(port),
      LOOP_GATEWAY_DATABASE_PATH: databasePath,
    },
  };
}

export type SpawnedProcess = {
  pid?: number;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  unref?(): void;
};

export type EnsureGatewayResult = {
  decision: GatewayDecision | { action: "external"; reason: string };
  record: GatewayRuntimeRecord | null;
};

export type EnsureGatewayOptions = GatewayDeps & {
  /** Spawn seam (tests inject; default: detached node child_process). */
  spawnProcess?: (
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string | undefined> },
  ) => SpawnedProcess;
  writePidFile?: (path: string, pid: number) => void;
  removePidFile?: (path: string) => void;
  sleep?: (ms: number) => Promise<void>;
  bootTimeoutMs?: number;
  pollIntervalMs?: number;
};

function defaultWritePidFile(path: string, pid: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${pid}\n`, "utf8");
}

function defaultRemovePidFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* already gone — cleanup is idempotent */
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

/** Poll `predicate` until it holds or the deadline passes; throws when the
 * deadline is hit (never guesses success). */
async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  options: { timeoutMs: number; intervalMs: number; sleep: (ms: number) => Promise<void> },
): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs;
  while (true) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await options.sleep(options.intervalMs);
  }
}

/** The `loop pair` auto-start hook: reuse a live gateway, or spawn exactly
 * one daemon and wait for its port to accept. An operator-set
 * LOOP_GATEWAY_PORT means the gateway lifecycle is managed externally — no
 * spawn decision is made on that path. */
export async function ensureGatewayRunning(
  options: EnsureGatewayOptions,
): Promise<EnsureGatewayResult> {
  const portProbe = options.probePort ?? isPortAccepting;
  const sleep = options.sleep ?? defaultSleep;
  const bootTimeoutMs = options.bootTimeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 150;

  // Operator-managed port: explicit environment wins, never auto-spawn.
  const operatorPort = options.env.LOOP_GATEWAY_PORT?.trim();
  if (operatorPort !== undefined && operatorPort.length > 0) {
    return {
      decision: {
        action: "external",
        reason: "LOOP_GATEWAY_PORT is set; gateway lifecycle is operator-managed",
      },
      record: readRecord(options),
    };
  }

  const status = await readGatewayStatus(options);
  const decision = decideGatewayAction({
    record: status.record,
    alive: status.running,
    pid: status.pid,
    pidAlive: status.pidAlive,
  });
  if (decision.action === "reuse") {
    if (status.record !== null) return { decision, record: status.record };
    // Daemon alive but its runtime record has not landed yet: wait for the
    // record (the gateway writes it immediately after a successful bind).
    const recordPath = gatewayRuntimeRecordPath(options.env);
    const appeared = await waitFor(() => readRecord(options) !== null, {
      timeoutMs: bootTimeoutMs,
      intervalMs: pollIntervalMs,
      sleep,
    });
    if (!appeared) {
      throw new ConfigError(
        "gateway-runtime-record-missing",
        `a gateway daemon (pid ${status.pid}) is alive but did not write ${recordPath}`,
      );
    }
    return { decision, record: readRecord(options) };
  }

  if (decision.stalePid !== null) {
    (options.removePidFile ?? defaultRemovePidFile)(gatewayPidFilePath(options.env));
  }

  const plan = await planGatewaySpawn(options);
  const spawnProcess =
    options.spawnProcess ??
    ((command, args, spawnOptions) =>
      spawn(command, args, {
        cwd: spawnOptions.cwd,
        env: { ...process.env, ...spawnOptions.env },
        detached: true,
        stdio: "ignore",
        shell: false,
      }));
  const child = spawnProcess(plan.command, [plan.entryPath], {
    cwd: plan.cwd,
    env: { ...process.env, ...plan.env },
  });
  const pid = child.pid;
  if (pid === undefined) {
    throw new ConfigError(
      "gateway-spawn-failed",
      `failed to spawn the gateway daemon via ${plan.command}`,
    );
  }
  await new Promise<void>((resolveSpawn, reject) => {
    child.once("spawn", () => resolveSpawn());
    child.once("error", (error: unknown) =>
      reject(
        new ConfigError(
          "gateway-spawn-failed",
          `failed to spawn the gateway daemon via ${plan.command}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ),
    );
  });
  child.unref?.();
  (options.writePidFile ?? defaultWritePidFile)(gatewayPidFilePath(options.env), pid);

  const bound = await waitFor(() => portProbe("127.0.0.1", plan.port), {
    timeoutMs: bootTimeoutMs,
    intervalMs: pollIntervalMs,
    sleep,
  });
  if (!bound) {
    throw new ConfigError(
      "gateway-boot-timeout",
      `the gateway daemon (pid ${pid}) did not accept connections on port ${plan.port} within ${bootTimeoutMs} ms — inspect \`loop gateway status\` and daemon logs`,
    );
  }
  // The composition root writes the runtime record right after its bind;
  // give it the same deadline so the QR never describes a stale port.
  const recordPath = gatewayRuntimeRecordPath(options.env);
  const recorded = await waitFor(
    () => {
      const record = readRecord(options);
      return record !== null && record.port === plan.port;
    },
    { timeoutMs: bootTimeoutMs, intervalMs: pollIntervalMs, sleep },
  );
  if (!recorded) {
    throw new ConfigError(
      "gateway-runtime-record-missing",
      `the gateway daemon (pid ${pid}) bound port ${plan.port} but did not record it in ${recordPath}`,
    );
  }
  return {
    decision: { action: "spawn", reason: decision.reason, stalePid: decision.stalePid },
    record: readRecord(options),
  };
}

// ---------------------------------------------------------------------------
// `loop gateway status` / `loop gateway stop`
// ---------------------------------------------------------------------------

export function formatGatewayStatusText(info: GatewayStatusInfo): string {
  if (!info.running) {
    const stalePid = info.pid !== null && !info.pidAlive ? ` (stale pid record: ${info.pid})` : "";
    return `gateway: not running${stalePid}\nStart one implicitly with \`loop pair\`.\n`;
  }
  const record = info.record as GatewayRuntimeRecord;
  const pidLine =
    info.pid === null
      ? "pid: (not recorded — started outside loop)"
      : `pid: ${info.pid}${info.pidAlive ? "" : " (stale)"}`;
  return ["gateway: running", `host: ${record.host}`, `port: ${record.port}`, pidLine, ""].join(
    "\n",
  );
}

export function formatGatewayStatusJson(info: GatewayStatusInfo): string {
  return `${JSON.stringify({
    running: info.running,
    host: info.record?.host ?? null,
    port: info.record?.port ?? null,
    pid: info.pid,
    pidAlive: info.pidAlive,
  })}\n`;
}

export type StopResult = { exitCode: number; message: string };

export type StopGatewayOptions = GatewayDeps & {
  kill?: (pid: number, signal: "SIGTERM" | "SIGKILL") => boolean;
  removePidFile?: (path: string) => void;
  sleep?: (ms: number) => Promise<void>;
  stopTimeoutMs?: number;
  pollIntervalMs?: number;
};

/** Graceful stop: SIGTERM the recorded pid, wait for exit, escalate to
 * SIGKILL past the deadline, then remove the pid record. Idempotent — a
 * stopped gateway or stale pid record is cleaned up with exit code 0. */
export async function gatewayStop(options: StopGatewayOptions): Promise<StopResult> {
  const status = await readGatewayStatus(options);
  const sleep = options.sleep ?? defaultSleep;
  const removePidFile = options.removePidFile ?? defaultRemovePidFile;
  const kill =
    options.kill ??
    ((pid, signal) => {
      try {
        process.kill(pid, signal);
        return true;
      } catch {
        return false;
      }
    });
  const pidPath = gatewayPidFilePath(options.env);

  if (status.pid !== null && status.pidAlive) {
    const pid = status.pid;
    kill(pid, "SIGTERM");
    const exited = await waitFor(() => !(options.pidAlive ?? defaultPidAlive)(pid), {
      timeoutMs: options.stopTimeoutMs ?? 10_000,
      intervalMs: options.pollIntervalMs ?? 100,
      sleep,
    });
    if (!exited) {
      kill(pid, "SIGKILL");
      await waitFor(() => !(options.pidAlive ?? defaultPidAlive)(pid), {
        timeoutMs: 5_000,
        intervalMs: 100,
        sleep,
      });
    }
    removePidFile(pidPath);
    return {
      exitCode: 0,
      message: `gateway (pid ${pid}) stopped${status.record === null ? "" : ` (was serving ${status.record.host}:${status.record.port})`}`,
    };
  }

  if (status.pid !== null) {
    removePidFile(pidPath);
    return {
      exitCode: 0,
      message: `stale pid record ${status.pid} removed; gateway is not running`,
    };
  }

  if (status.running) {
    return {
      exitCode: 1,
      message: `gateway is serving ${status.record?.host}:${status.record?.port} but has no pid record — it was not started by loop; stop it in the terminal that owns it`,
    };
  }

  return { exitCode: 0, message: "gateway is not running" };
}
