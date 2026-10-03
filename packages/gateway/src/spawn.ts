/**
 * Remote session spawner (decision 2026-xx-session-spawn): POST
 * /v1/sessions/spawn opens a NEW pi TUI on the host in a fresh tmux window.
 * The spawner is adapter-local by boundary — terminal, tmux, and launcher
 * concepts never enter loop-core (AGENTS.md), and the spawner knows nothing
 * about models, providers, or endpoints: it runs `pi` with the host's own
 * auth as-is and injects no credentials.
 *
 * Design (decision §D-A/§D-B):
 *  - tmux `new-window` is the only first-class launcher. tmux absence is a
 *    deterministic problem (`spawn_tmux_unavailable`); the Terminal.app
 *    osascript path exists only when explicitly configured (`fallback:
 *    "osascript"`) and is never a silent fallback.
 *  - `enabled` gates the whole surface (default on: in tokenless mode the
 *    requester already proved tailnet membership, and a tailnet member can
 *    open tmux windows over SSH — this endpoint adds no new trust surface).
 *    On the bearer-fallback listener spawn is denied unless explicitly
 *    allowed (`allowOnFallback`, default off): a verified token is a weaker
 *    basis than tailnet membership.
 *  - The requested cwd must be absolute, exist, and live under one of the
 *    configured allowed roots (fail-closed path policy). Problem fields
 *    never carry path values (problem.ts contract).
 *  - Command assembly is a pure function unit-tested without executing
 *    tmux; process execution sits behind the injectable `SpawnExec` seam.
 *
 * Session correlation honesty: the tap extension registers the REAL
 * sessionId with the gateway collector when the spawned pi starts, so the
 * spawn response carries only the launcher target (tmux pane id / spawn id)
 * — the session appears in `GET /v1/sessions` automatically once the tap
 * connects, and the app discovers it there (decision §D-C).
 */

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { spawn } from "node:child_process";

import { ProblemError } from "./problem";

// ——— Configuration ———

/** Adapter-local spawn configuration (decision §D-A/§D-B). Composed only in
 * the composition root (`spawnConfigFromEnv` / tests); never requestable by
 * clients. */
export type GatewaySpawnConfig = {
  /** Master gate for POST /v1/sessions/spawn; default on (decision §D-B1). */
  enabled?: boolean;
  /** tmux binary; default "tmux" (resolved from PATH at spawn time). */
  tmuxPath?: string;
  /** Target tmux session name; default "loop" (dedicated session — a
   * predictable target regardless of where the gateway itself runs). */
  tmuxSession?: string;
  /** Create the tmux session when missing; default on (zero-config first
   * use). Off → deterministic `spawn_tmux_session_missing`. */
  tmuxAutoCreate?: boolean;
  /** pi binary; default "pi" (host PATH; the host's own pi auth is used). */
  piPath?: string;
  /** Extra pi argv (e.g. ["--extension", "/path/to/tap.ts"]); default []. */
  piArgs?: string[];
  /** Absolute directories the requested cwd must live under (each realpath
   * applied at spawn time); default [defaultCwd]. */
  allowedRoots?: string[];
  /** Default cwd when the request omits one; default: the process cwd. */
  defaultCwd?: string;
  /** Launcher when tmux is absent; default "error" (deterministic problem).
   * "osascript" opens Terminal.app on macOS — an explicit opt-in only. */
  fallback?: "error" | "osascript";
  /** Allow spawn on the bearer-fallback listener; default off (decision
   * §D-B2). */
  allowOnFallback?: boolean;
};

/** Validated, defaulted spawn configuration (startup fail-closed). */
export type ResolvedSpawnConfig = {
  enabled: boolean;
  tmuxPath: string;
  tmuxSession: string;
  tmuxAutoCreate: boolean;
  piPath: string;
  piArgs: string[];
  allowedRoots: string[];
  defaultCwd: string;
  fallback: "error" | "osascript";
  allowOnFallback: boolean;
};

/** tmux session names cannot contain `.` or `:` (target syntax) — validated
 * at startup so the assembled argv can never parse ambiguously. */
const TMUX_SESSION_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Validate + default external spawn config; throws (startup fail-closed)
 * on structural violations, same style as `parseGatewayConfig`. */
export function resolveSpawnConfig(
  input: GatewaySpawnConfig | undefined,
  defaults: { processCwd: string },
): ResolvedSpawnConfig {
  const cfg = input ?? {};
  const defaultCwd = cfg.defaultCwd ?? defaults.processCwd;
  const allowedRoots = cfg.allowedRoots ?? [defaultCwd];
  for (const root of allowedRoots) {
    if (typeof root !== "string" || root.length === 0 || !root.startsWith("/")) {
      throw new Error("spawn config allowedRoots entries must be absolute paths");
    }
  }
  if (typeof defaultCwd !== "string" || defaultCwd.length === 0 || !defaultCwd.startsWith("/")) {
    throw new Error("spawn config defaultCwd must be an absolute path");
  }
  const tmuxSession = cfg.tmuxSession ?? "loop";
  if (!TMUX_SESSION_NAME.test(tmuxSession)) {
    throw new Error("spawn config tmuxSession must match [A-Za-z0-9_-]{1,64}");
  }
  if (cfg.fallback !== undefined && cfg.fallback !== "error" && cfg.fallback !== "osascript") {
    throw new Error('spawn config fallback must be "error" or "osascript"');
  }
  return {
    enabled: cfg.enabled ?? true,
    tmuxPath: cfg.tmuxPath ?? "tmux",
    tmuxSession,
    tmuxAutoCreate: cfg.tmuxAutoCreate ?? true,
    piPath: cfg.piPath ?? "pi",
    piArgs: cfg.piArgs ?? [],
    allowedRoots,
    defaultCwd,
    fallback: cfg.fallback ?? "error",
    allowOnFallback: cfg.allowOnFallback ?? false,
  };
}

/** Composition-root convenience: read the spawn config from the environment
 * (same axis as `gatewayConfigFromEnv`). Absolute paths only; the allowed
 * roots are colon-separated. */
export function spawnConfigFromEnv(
  env: Record<string, string | undefined>,
  defaults: { processCwd: string },
): ResolvedSpawnConfig {
  const onOff = (name: string, fallback: boolean): boolean => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (raw === "on") return true;
    if (raw === "off") return false;
    throw new Error(`${name} must be "on" or "off"`);
  };
  const optionalPath = (name: string): string | undefined => {
    const raw = env[name];
    if (raw === undefined || raw.trim().length === 0) return undefined;
    if (!raw.startsWith("/")) throw new Error(`${name} must be an absolute path`);
    return raw;
  };
  const rootsEnv = env.LOOP_GATEWAY_SPAWN_ALLOWED_ROOTS;
  const allowedRoots =
    rootsEnv === undefined || rootsEnv.trim().length === 0
      ? undefined
      : rootsEnv
          .split(":")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
  const fallback = env.LOOP_GATEWAY_SPAWN_FALLBACK;
  if (fallback !== undefined && fallback !== "error" && fallback !== "osascript") {
    throw new Error('LOOP_GATEWAY_SPAWN_FALLBACK must be "error" or "osascript"');
  }
  return resolveSpawnConfig(
    {
      enabled: onOff("LOOP_GATEWAY_SPAWN", true),
      tmuxSession: env.LOOP_GATEWAY_SPAWN_TMUX_SESSION,
      tmuxAutoCreate: onOff("LOOP_GATEWAY_SPAWN_TMUX_AUTO", true),
      piPath: env.LOOP_GATEWAY_PI_PATH,
      piArgs:
        env.LOOP_GATEWAY_PI_ARGS === undefined
          ? undefined
          : env.LOOP_GATEWAY_PI_ARGS.trim().length === 0
            ? []
            : env.LOOP_GATEWAY_PI_ARGS.trim().split(/\s+/),
      allowedRoots,
      defaultCwd: optionalPath("LOOP_GATEWAY_SPAWN_DEFAULT_CWD"),
      fallback: fallback as GatewaySpawnConfig["fallback"],
      allowOnFallback: onOff("LOOP_GATEWAY_SPAWN_ON_BEARER_FALLBACK", false),
    },
    defaults,
  );
}

// ——— Command assembly (pure, unit-tested without executing tmux) ———

/** POSIX single-quote a string for shell consumption (`sh -c` inside tmux /
 * Terminal.app). */
export function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** Escape a string for use inside an AppleScript double-quoted literal. */
export function escapeAppleScriptString(arg: string): string {
  return arg.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export type SpawnCommand = {
  /** Executable to spawn. */
  file: string;
  /** Full argv after `file`. */
  args: string[];
  /** One-line human display; diagnostics only (never a contract). */
  display: string;
};

/** tmux output format for new-window: stable pane id + pane shell pid. */
export const SPAWN_PANE_FORMAT = "#{pane_id}\t#{pane_pid}";

/** Deterministic tmux new-window argv (decision §D-A1): `tmux new-window -P
 * -F <format> -t <session>: -n <window> -c <cwd> <shell-command>`. The pi
 * command is one POSIX-quoted shell-command string — tmux runs it via the
 * default shell, so quoting (not argv splitting) is the injection boundary. */
export function buildSpawnCommand(input: {
  config: ResolvedSpawnConfig;
  windowName: string;
  cwd: string;
}): SpawnCommand {
  const { config, windowName, cwd } = input;
  const shellCommand = [config.piPath, ...config.piArgs].map(shellQuote).join(" ");
  return {
    file: config.tmuxPath,
    args: [
      "new-window",
      "-P",
      "-F",
      SPAWN_PANE_FORMAT,
      "-t",
      `${config.tmuxSession}:`,
      "-n",
      windowName,
      "-c",
      cwd,
      shellCommand,
    ],
    display: `${config.tmuxPath} new-window -t ${config.tmuxSession}: -n ${windowName} -c ${cwd} ${shellCommand}`,
  };
}

/** Explicit-opt-in Terminal.app launcher (decision §D-A2): osascript is the
 * only non-tmux path and never runs unless `fallback: "osascript"` is set. */
export function buildOsascriptSpawnCommand(input: {
  config: ResolvedSpawnConfig;
  cwd: string;
}): SpawnCommand {
  const { config, cwd } = input;
  const shellCommand = [config.piPath, ...config.piArgs].map(shellQuote).join(" ");
  const doScript = `cd ${shellQuote(cwd)} && ${shellCommand}`;
  const script = `tell application "Terminal" to do script "${escapeAppleScriptString(doScript)}"`;
  return {
    file: "osascript",
    args: ["-e", script],
    display: `osascript -e ${script}`,
  };
}

// ——— Process execution seam ———

export type SpawnExecResult = { exitCode: number; stdout: string; stderr: string };

/** Injectable process boundary: tests script results without executing
 * tmux; production uses `nodeSpawnExec`. Rejects when the binary cannot be
 * launched at all (ENOENT and friends). */
export type SpawnExec = (file: string, args: string[]) => Promise<SpawnExecResult>;

/** Production exec over node child_process (herdr client precedent). */
export function nodeSpawnExec(file: string, args: string[]): Promise<SpawnExecResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => rejectPromise(error));
    child.on("close", (code) => {
      resolvePromise({
        exitCode: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

/** Injectable existing-directory resolver (canonical path or null). */
export type ResolveDir = (path: string) => string | null;

/** Production resolver: realpath; null when the path does not exist. */
export function defaultResolveDir(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function defaultSpawnId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 8);
}

// ——— cwd policy (decision §D-B3) ———

/**
 * Validate the requested working directory BEFORE any process is spawned:
 * absolute (400 `spawn_cwd_invalid`), existing (404 `spawn_cwd_missing`),
 * and under one of the configured allowed roots after realpath canonicalization
 * (403 `spawn_cwd_outside_roots`) — traversal (`..`) is neutralized by the
 * canonical comparison. Returns the canonical cwd.
 */
export function validateSpawnCwd(input: {
  requested: string | undefined;
  config: ResolvedSpawnConfig;
  resolveDir: ResolveDir;
}): string {
  const raw = input.requested ?? input.config.defaultCwd;
  if (typeof raw !== "string" || raw.length === 0 || !raw.startsWith("/")) {
    throw new ProblemError(400, "spawn_cwd_invalid", { cwd: "must be an absolute path" });
  }
  const canonical = input.resolveDir(raw);
  if (canonical === null) {
    throw new ProblemError(404, "spawn_cwd_missing", { cwd: "must be an existing directory" });
  }
  const roots = input.config.allowedRoots
    .map((root) => input.resolveDir(root))
    .filter((root): root is string => root !== null);
  const under = roots.some((root) => canonical === root || canonical.startsWith(`${root}/`));
  if (!under) {
    throw new ProblemError(403, "spawn_cwd_outside_roots", { cwd: "outside the allowed roots" });
  }
  return canonical;
}

// ——— Spawner port + tmux implementation ———

/** Which listener the HTTP request arrived on (server-selected; the spawner
 * gates on it, decision §D-B2). */
export type SpawnListenerMode = "tailscale" | "bearer-fallback";

export type SpawnRequest = { cwd?: string };

/** Launcher target of an accepted spawn. The tap extension registers the
 * real pi sessionId with the collector later — this is the handle for the
 * tmux window, not the conversation session. */
export type SpawnOutcome = {
  spawnId: string;
  /** tmux target `session:window`; cosmetic (tmux may auto-rename). Null for
   * the Terminal.app path. */
  tmuxTarget: string | null;
  /** Stable tmux pane id (`%N`); null for the Terminal.app path. */
  paneId: string | null;
  /** Pane shell pid (tmux) — the pid of the spawned command tree root. */
  pid: number | null;
  cwd: string;
  launcher: "tmux" | "terminal-app";
};

/** Server seam for POST /v1/sessions/spawn (absent → route 404, fail-closed
 * like the pane/session/steer surfaces). Throws ProblemError for mapped
 * failures. */
export interface SpawnPort {
  spawn(request: SpawnRequest, context: { listener: SpawnListenerMode }): Promise<SpawnOutcome>;
}

function parsePaneFormat(stdout: string): { paneId: string; pid: number | null } | null {
  const line = stdout.split("\n").find((entry) => entry.trim().length > 0);
  if (line === undefined) return null;
  const [paneId, pidRaw] = line.split("\t");
  if (paneId === undefined || paneId.length === 0) return null;
  const pid = Number.parseInt(pidRaw ?? "", 10);
  return { paneId, pid: Number.isInteger(pid) ? pid : null };
}

/** tmux-first spawner (decision §D-A). All process interaction goes through
 * the injected `SpawnExec`; every failure is a deterministic ProblemError. */
export class TmuxSpawner implements SpawnPort {
  readonly #config: ResolvedSpawnConfig;
  readonly #exec: SpawnExec;
  readonly #resolveDir: ResolveDir;
  readonly #newSpawnId: () => string;

  constructor(deps: {
    config: ResolvedSpawnConfig;
    exec: SpawnExec;
    resolveDir: ResolveDir;
    newSpawnId?: () => string;
  }) {
    this.#config = deps.config;
    this.#exec = deps.exec;
    this.#resolveDir = deps.resolveDir;
    this.#newSpawnId = deps.newSpawnId ?? defaultSpawnId;
  }

  async spawn(
    request: SpawnRequest,
    context: { listener: SpawnListenerMode },
  ): Promise<SpawnOutcome> {
    const config = this.#config;
    // Policy gates before any filesystem/process interaction (§D-B1/§D-B2).
    if (!config.enabled) throw new ProblemError(403, "spawn_disabled");
    if (context.listener === "bearer-fallback" && !config.allowOnFallback) {
      throw new ProblemError(403, "spawn_fallback_denied");
    }
    const cwd = validateSpawnCwd({
      requested: request.cwd,
      config,
      resolveDir: this.#resolveDir,
    });
    const spawnId = this.#newSpawnId();
    const windowName = `pi-${spawnId}`;

    const tmuxReady = await this.#ensureTmuxSession(cwd);
    if (tmuxReady === "tmux-missing") {
      return this.#spawnOsascriptFallback(spawnId, cwd);
    }

    const command = buildSpawnCommand({ config, windowName, cwd });
    const result = await this.#exec(command.file, command.args);
    if (result.exitCode !== 0) {
      throw new ProblemError(500, "spawn_launch_failed", {
        stage: "tmux-new-window",
        "tmux-exit": String(result.exitCode),
      });
    }
    const pane = parsePaneFormat(result.stdout);
    if (pane === null) {
      throw new ProblemError(500, "spawn_launch_failed", {
        stage: "tmux-new-window",
        reason: "unparseable output",
      });
    }
    return {
      spawnId,
      tmuxTarget: `${config.tmuxSession}:${windowName}`,
      paneId: pane.paneId,
      pid: pane.pid,
      cwd,
      launcher: "tmux",
    };
  }

  /** `tmux has-session` probe + optional auto-create. Returns "tmux-missing"
   * when the tmux binary itself is absent (caller decides the fallback). */
  async #ensureTmuxSession(cwd: string): Promise<"ready" | "tmux-missing"> {
    const config = this.#config;
    let probe: SpawnExecResult;
    try {
      probe = await this.#exec(config.tmuxPath, ["has-session", "-t", config.tmuxSession]);
    } catch {
      return "tmux-missing"; // binary absent or unlaunchable
    }
    if (probe.exitCode === 0) return "ready";
    if (probe.exitCode !== 1) {
      throw new ProblemError(503, "spawn_tmux_unavailable", {
        "tmux-exit": String(probe.exitCode),
      });
    }
    if (!config.tmuxAutoCreate) throw new ProblemError(503, "spawn_tmux_session_missing");
    const created = await this.#exec(config.tmuxPath, [
      "new-session",
      "-d",
      "-s",
      config.tmuxSession,
      "-c",
      cwd,
    ]);
    if (created.exitCode !== 0) {
      throw new ProblemError(503, "spawn_tmux_unavailable", {
        stage: "tmux-new-session",
        "tmux-exit": String(created.exitCode),
      });
    }
    return "ready";
  }

  /** Explicit-opt-in Terminal.app path (decision §D-A2). Default config
   * (`fallback: "error"`) throws instead — installing tmux is the answer. */
  async #spawnOsascriptFallback(spawnId: string, cwd: string): Promise<SpawnOutcome> {
    const config = this.#config;
    if (config.fallback !== "osascript") {
      throw new ProblemError(503, "spawn_tmux_unavailable");
    }
    const command = buildOsascriptSpawnCommand({ config, cwd });
    try {
      const result = await this.#exec(command.file, command.args);
      if (result.exitCode !== 0) {
        throw new ProblemError(500, "spawn_launch_failed", {
          stage: "osascript",
          "osascript-exit": String(result.exitCode),
        });
      }
    } catch (error) {
      if (error instanceof ProblemError) throw error;
      throw new ProblemError(503, "spawn_tmux_unavailable");
    }
    return {
      spawnId,
      tmuxTarget: null,
      paneId: null,
      pid: null,
      cwd,
      launcher: "terminal-app",
    };
  }
}
