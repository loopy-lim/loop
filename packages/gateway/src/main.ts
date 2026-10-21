/**
 * Local gateway entrypoint (ADR §5 composition root, decision
 * 2026-xx-real-run-planner). Wires the adapter composition for real runs:
 * env config, fail-closed Tailscale bind check, HS256 bearer verifier, a
 * runtime port spoken directly to the generated protocol (the Rust bridge),
 * the deterministic-local planner with an in-host orchestrator hand-off, and
 * a provider registry assembled only from configuration.
 *
 * Cost gating (decision D2): the default provider mode is
 * `deterministic-local` — free fake workers only, no model call. Real
 * providers require the operator's explicit `LOOP_GATEWAY_PROVIDER_MODE=
 * loop-config`, which assembles the registry from the Loop config files
 * (providers.toml / models.toml / policy.toml). Provider, model, and endpoint
 * values exist only in that configuration or in adapter construction.
 *
 * Required environment:
 *   LOOP_GATEWAY_HOST            explicit Tailscale IP (e.g. 100.80.133.120)
 *   LOOP_GATEWAY_PORT            1..65535
 *   LOOP_GATEWAY_DATABASE_PATH   Loop store path (runtime SQLite, WAL)
 *   LOOP_GATEWAY_JWT_SECRET / _ISSUER / _AUDIENCE   bearer material values
 *                                (required only in bearer-fallback mode)
 *
 * Optional environment:
 *   LOOP_GATEWAY_AUTH_MODE       tailscale (default, tokenless — tailnet
 *                                membership is the trust boundary) |
 *                                bearer-fallback (decision
 *                                2026-xx-tokenless-auth-and-app-layout §D-A;
 *                                requires the JWT envs above)
 *   LOOP_GATEWAY_IDENTITY        off (default) | whois — tailscale-mode peer
 *                                identity hardening; "whois" requires platform
 *                                support and is rejected otherwise (§D-A2)
 *   LOOP_GATEWAY_PROJECT_ROOT    absolute working directory for submitted
 *                                runs (default: process cwd; never
 *                                requestable by clients)
 *   LOOP_GATEWAY_PROVIDER_MODE   deterministic-local (default) | loop-config
 *   LOOP_GATEWAY_MAX_WORKERS     deterministic-local worker cap (default 2)
 *   LOOP_GATEWAY_SESSIONS        "off" disables the conversation collector
 *                                (decision 2026-xx-gui-conversation; default on)
 *   LOOP_GATEWAY_SESSION_SOCKET  tap ingress unix socket override
 *                                (default: defaultSessionSocketPath())
 *   LOOP_GATEWAY_RUNTIME_FILE    well-known runtime record path override
 *                                (default: <loop config dir>/gateway.json —
 *                                see runtime-record.ts); records ONLY the
 *                                bound host:port, never any secret
 *
 * Session spawn (decision 2026-xx-session-spawn):
 *   LOOP_GATEWAY_SPAWN                    on (default) | off — master gate for
 *                                         POST /v1/sessions/spawn
 *   LOOP_GATEWAY_SPAWN_TMUX_SESSION       target tmux session (default "loop",
 *                                         auto-created)
 *   LOOP_GATEWAY_SPAWN_TMUX_AUTO          on (default) | off — create the tmux
 *                                         session when missing
 *   LOOP_GATEWAY_SPAWN_DEFAULT_CWD        absolute default cwd for spawned pi
 *                                         TUIs (default: gateway process cwd)
 *   LOOP_GATEWAY_SPAWN_ALLOWED_ROOTS      colon-separated absolute dirs the
 *                                         requested cwd must live under
 *                                         (default: [default cwd])
 *   LOOP_GATEWAY_PI_PATH / _PI_ARGS       pi binary + extra argv (default
 *                                         "pi" / empty; the tap loads via
 *                                         the host pi settings)
 *   LOOP_GATEWAY_SPAWN_FALLBACK           error (default, deterministic
 *                                         problem when tmux is absent) |
 *                                         osascript (explicit Terminal.app
 *                                         opt-in)
 *   LOOP_GATEWAY_SPAWN_ON_BEARER_FALLBACK on | off (default) — allow spawn
 *                                         over the bearer-fallback listener
 *
 * Run: bun packages/gateway/src/main.ts
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";

import type { RecordActivityInput, RunState, SnapshotOutput } from "@loop/protocol";

import { Hs256BearerVerifier } from "./auth";
import {
  DEFAULT_AUTH_ENV_NAMES,
  gatewayConfigFromEnv,
  parseGatewayConfig,
  type GatewayAuthMode,
  type GatewayConfig,
  type GatewayIdentityMode,
} from "./config";
import { defaultHerdrSocketPath, HerdrControlClient, HerdrPaneSource } from "./herdr-pane-source";
import { HerdrAgentSessionRegistrar } from "./herdr-agent-session";
import { HerdrStateMonitor } from "./herdr-state";
import { RunEventLog } from "./events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { FileViewer } from "./files";
import { orchestratorPlanner, type RunExecutionPort } from "./planner";
import { PaneEventLog } from "./pane-events";
import { PaneMirror } from "./pane-mirror";
import { ProblemError } from "./problem";
import {
  gatewayRuntimeRecordPath,
  magicDnsNameFromStatusOutput,
  pairingRecordHost,
  writeGatewayRuntimeRecord,
} from "./runtime-record";
import { AGENT_SESSION_POLL_MS, REPLAY_BUFFER_FRAMES } from "./wire";
import { defaultSessionSocketPath, SessionCollector } from "./session-collector";
import { defaultResolveDir, nodeSpawnExec, spawnConfigFromEnv, TmuxSpawner } from "./spawn";
import { SessionEventLog } from "./session-events";
import type { SteerPort } from "./server";
import { GatewayService, type RunRuntimePort } from "./service";
import { startGateway, type GatewayServer } from "./server";
import { OsTailscaleInspector } from "./tailscale";

type Protocol = typeof import("@loop/protocol");

/** Store-side sink dependency (structural seam shared with the orchestrator). */
type ActivityRecorder = { recordActivity(input: RecordActivityInput): Promise<unknown> };

const OWNER_CACHE_TTL_MS = 1_000;

/**
 * Execution-owner-aware store recorder.
 *
 * The orchestrator holds the run's execution lease while workers run, and the
 * store rejects any append whose owner does not match the active lease.
 * Mirror sink lines are produced inside provider callbacks that never see the
 * lease owner id, so this recorder resolves the run's live owner from the
 * snapshot (the same authority `loop status` reads) and appends it. The 1 s
 * cache matches the lease renewal cadence; with no lease held the owner is
 * omitted and the store's policy applies as usual.
 */
function executionOwnerRecorder(protocol: Protocol, databasePath: string): ActivityRecorder {
  const cached = new Map<string, { owner: string; until: number }>();
  return {
    async recordActivity(input) {
      const now = Date.now();
      let owner = cached.get(input.runId);
      if (owner === undefined || owner.until <= now) {
        const snapshot = await protocol.getSnapshot({ databasePath, runId: input.runId });
        const active = snapshot.executionOwner ?? null;
        owner = active === null ? undefined : { owner: active, until: now + OWNER_CACHE_TTL_MS };
        if (owner === undefined) cached.delete(input.runId);
        else cached.set(input.runId, owner);
      }
      return protocol.recordActivity({ ...input, executionOwner: owner?.owner ?? null });
    },
  };
}

/** Runtime port over the generated protocol (Rust bridge owns the store). */
export async function protocolRuntimePort(
  databasePath: string,
  pollMs = 150,
): Promise<RunRuntimePort & { protocol: Protocol }> {
  const protocol = await import("@loop/protocol");
  await protocol.rustra.ready();
  return {
    protocol,
    async snapshot(runId: string): Promise<SnapshotOutput> {
      return protocol.getSnapshot({ databasePath, runId });
    },
    async listRuns(): Promise<{ runId: string; state: RunState }[]> {
      return protocol.listRuns({ databasePath });
    },
    subscribe(runId: string, listener: (snapshot: SnapshotOutput) => void): () => void {
      let stopped = false;
      let busy = false;
      let sequence = "-1";
      const poll = async () => {
        if (stopped || busy) return;
        busy = true;
        try {
          const snapshot = await protocol.getSnapshot({ databasePath, runId });
          const next = snapshot.lastSequence.toString(10);
          if (!stopped && next !== sequence) {
            sequence = next;
            listener(snapshot);
          }
        } catch {
          /* The durable run may not exist yet; retry on the next tick. */
        } finally {
          busy = false;
        }
      };
      const timer = setInterval(() => {
        void poll();
      }, pollMs);
      timer.unref?.();
      void poll();
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
  };
}

const PROVIDER_MODES = ["deterministic-local", "loop-config"] as const;
export type ProviderMode = (typeof PROVIDER_MODES)[number];
const DEFAULT_MAX_WORKERS = 2;

/** Pane observation env: explicit socket path override / explicit off switch
 * (decision D2: pane observation is fail-closed and machine-path-isolated). */
function paneAssemblyFromEnv(
  env: Record<string, string | undefined>,
): { socketPath: string } | null {
  if (env.LOOP_GATEWAY_PANES === "off") return null;
  const socketPath = env.LOOP_GATEWAY_HERDR_SOCKET ?? defaultHerdrSocketPath();
  if (!existsSync(socketPath)) return null; // herdr absent → feature off
  return { socketPath };
}

function bootPaneMirror(
  config: ReturnType<typeof parseGatewayConfig>,
  env: Record<string, string | undefined>,
): {
  mirror: PaneMirror;
  source: HerdrPaneSource;
  agentSessions: HerdrAgentSessionRegistrar | null;
} | null {
  const assembly = paneAssemblyFromEnv(env);
  if (assembly === null) return null;
  const pane = config.pane;
  if (pane === undefined) return null;
  const source = new HerdrPaneSource({
    socketPath: assembly.socketPath,
    readLines: pane.readLines,
  });
  const mirror = new PaneMirror({
    port: source,
    log: new PaneEventLog(1, pane.replayBufferFrames),
    pollMs: pane.pollMs,
    maxObservedPanes: pane.maxObservedPanes,
    maxFrameBytes: pane.maxFrameBytes,
  });
  // Agent-session reconciliation shares the pane mirror's herdr socket gate
  // and its fail-observer contract; `off` is the explicit kill-switch.
  const agentSessions =
    env.LOOP_GATEWAY_AGENT_SESSIONS === "off"
      ? null
      : new HerdrAgentSessionRegistrar({ port: source });
  return { mirror, source, agentSessions };
}

/** Herdr surface env gate (rebuild brief §4): same socket-presence rule as
 * the pane mirror, with its own off switch. Returns null when disabled or
 * when the herdr socket is absent (fail-closed, feature off). */
function bootHerdrSurface(
  env: Record<string, string | undefined>,
): { monitor: HerdrStateMonitor; control: HerdrControlClient } | null {
  if (env.LOOP_GATEWAY_HERDR === "off") return null;
  const socketPath = env.LOOP_GATEWAY_HERDR_SOCKET ?? defaultHerdrSocketPath();
  if (!existsSync(socketPath)) return null;
  const control = new HerdrControlClient({ socketPath });
  return { monitor: new HerdrStateMonitor(control), control };
}

/** Steer delivery seam over the generated protocol (decision
 * 2026-xx-gui-conversation D3): the SAME `loop steer` backend (steerRun),
 * called exactly once per accepted steer; orchestrator and mailbox are
 * unchanged. */
function protocolSteerPort(protocol: Protocol, databasePath: string): SteerPort {
  return {
    async steer(runId: string, message: string): Promise<void> {
      try {
        await protocol.steerRun({ databasePath, runId, taskId: null, message });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (/not found|unknown run/i.test(text)) throw new ProblemError(404, "run_not_found");
        throw new ProblemError(502, "steer_unavailable");
      }
    },
  };
}

/** Conversation collector env: explicit off switch / socket path override
 * (decision D1: the collector is fail-observer — bind failure disables the
 * conversation surface only; runs and panes are unaffected). */
function sessionSocketPathFromEnv(env: Record<string, string | undefined>): string | null {
  if (env.LOOP_GATEWAY_SESSIONS === "off") return null;
  return env.LOOP_GATEWAY_SESSION_SOCKET ?? defaultSessionSocketPath();
}

function bootSessionCollector(
  config: ReturnType<typeof parseGatewayConfig>,
  env: Record<string, string | undefined>,
): SessionCollector | null {
  const socketPath = sessionSocketPathFromEnv(env);
  if (socketPath === null) return null;
  const session = config.session;
  if (session === undefined) return null;
  const collector = new SessionCollector({
    log: new SessionEventLog(1, session.replayBufferFrames),
    socketPath,
    mergeFlushMs: session.mergeFlushMs,
    mergeTickMs: session.mergeTickMs,
    maxFrameBytes: session.maxFrameBytes,
  });
  try {
    collector.start();
  } catch (error) {
    collector.stop();
    console.error(
      `session collector disabled: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  return collector;
}

/** Auth-mode selection (decision 2026-xx-tokenless-auth-and-app-layout §D-A):
 * tokenless tailscale binding is the default; bearer is the explicit fallback. */
const AUTH_MODES = ["tailscale", "bearer-fallback"] as const;

function authModeFromEnv(env: Record<string, string | undefined>): GatewayAuthMode {
  const raw = env.LOOP_GATEWAY_AUTH_MODE ?? "tailscale";
  if (!(AUTH_MODES as readonly string[]).includes(raw)) {
    throw new Error(`LOOP_GATEWAY_AUTH_MODE must be one of: ${AUTH_MODES.join(", ")}`);
  }
  return raw as GatewayAuthMode;
}

const IDENTITY_MODES = ["off", "whois"] as const;

function identityModeFromEnv(env: Record<string, string | undefined>): GatewayIdentityMode {
  const raw = env.LOOP_GATEWAY_IDENTITY ?? "off";
  if (!(IDENTITY_MODES as readonly string[]).includes(raw)) {
    throw new Error(`LOOP_GATEWAY_IDENTITY must be one of: ${IDENTITY_MODES.join(", ")}`);
  }
  return raw as GatewayIdentityMode;
}

/** Cost gate (decision D2): deterministic-local unless the operator opts in. */
function providerModeFromEnv(env: Record<string, string | undefined>): ProviderMode {
  const raw = env.LOOP_GATEWAY_PROVIDER_MODE ?? "deterministic-local";
  if (!(PROVIDER_MODES as readonly string[]).includes(raw)) {
    throw new Error(`LOOP_GATEWAY_PROVIDER_MODE must be one of: ${PROVIDER_MODES.join(", ")}`);
  }
  return raw as ProviderMode;
}

function projectRootFromEnv(env: Record<string, string | undefined>): string {
  const raw = resolve(env.LOOP_GATEWAY_PROJECT_ROOT ?? process.cwd());
  if (raw.trim().length === 0) {
    throw new Error("LOOP_GATEWAY_PROJECT_ROOT must be an absolute path");
  }
  return raw;
}

function maxWorkersFromEnv(env: Record<string, string | undefined>, fallback: number): number {
  const raw = env.LOOP_GATEWAY_MAX_WORKERS;
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 64) {
    throw new Error("LOOP_GATEWAY_MAX_WORKERS must be an integer in 1..64");
  }
  return parsed;
}

type ProviderAssembly = {
  registry: import("@loop/providers").ProviderRegistry;
  maxWorkers: number;
};

/**
 * Deterministic-local provider lane (decision D2): free fake workers only, no
 * model call. The mirroring layer records each worker's lifecycle/result lines
 * into the store, so submitted runs carry real worker output over the wire
 * (decision D4). Shared by the production boot and the real-run integration
 * test so the composition cannot drift.
 */
export async function deterministicLocalRegistry(
  protocol: Protocol,
  databasePath: string,
): Promise<import("@loop/providers").ProviderRegistry> {
  const [{ FakeProvider, MirroringProvider, ProviderRegistry }, { StoreActivitySink }] =
    await Promise.all([import("@loop/providers"), import("@loop/orchestrator")]);
  const sink = new StoreActivitySink(executionOwnerRecorder(protocol, databasePath), databasePath);
  return new ProviderRegistry([
    new MirroringProvider(
      new FakeProvider("deterministic-local", ["tiny", "fast", "balanced"]),
      sink,
    ),
  ]);
}

/**
 * Provider assembly (decision D2): model ids and endpoints exist only in
 * configuration / adapter construction — never in request handling.
 */
async function assembleProviders(options: {
  mode: ProviderMode;
  databasePath: string;
  projectRoot: string;
  protocol: Protocol;
  env: Record<string, string | undefined>;
}): Promise<ProviderAssembly> {
  if (options.mode === "loop-config") {
    const [{ buildProviderRegistry, loadLoopConfig }] = await Promise.all([
      import("@loop/orchestrator"),
      import("@loop/orchestrator/config"),
    ]);
    const loopConfig = loadLoopConfig({ databasePath: options.databasePath });
    return {
      registry: buildProviderRegistry({
        config: loopConfig,
        projectRoot: options.projectRoot,
        activityRecorder: executionOwnerRecorder(options.protocol, options.databasePath),
      }),
      maxWorkers: maxWorkersFromEnv(options.env, loopConfig.scheduler.maxWorkers),
    };
  }
  return {
    registry: await deterministicLocalRegistry(options.protocol, options.databasePath),
    maxWorkers: maxWorkersFromEnv(options.env, DEFAULT_MAX_WORKERS),
  };
}

export type BootedGateway = GatewayServer & {
  /** Abort in-flight run executions (host shutdown semantics, decision D1). */
  abortRuns(): void;
};

const execFileProm = promisify(execFile);

/** Fail-observer MagicDNS probe (decision: loop pair MagicDNS-first). Runs
 * `tailscale status --json` and extracts Self.DNSName; any failure — tailscale
 * absent, not running, slow, or unparseable output — yields null so the
 * runtime record degrades to the bound host verbatim. The probe never blocks
 * or fails the boot: it only refines what the record says about the bind. */
async function probeMagicDnsName(): Promise<string | null> {
  try {
    const { stdout } = await execFileProm("tailscale", ["status", "--json"], {
      timeout: 3_000,
    });
    return magicDnsNameFromStatusOutput(stdout);
  } catch {
    return null;
  }
}

export async function bootGatewayFromEnv(
  env: Record<string, string | undefined> = process.env,
): Promise<BootedGateway> {
  const config = parseGatewayConfig({
    ...(gatewayConfigFromEnv(env) as GatewayConfig),
    authMode: authModeFromEnv(env),
    identity: identityModeFromEnv(env),
  });
  const databasePath = env.LOOP_GATEWAY_DATABASE_PATH;
  if (databasePath === undefined || databasePath.trim().length === 0) {
    throw new Error("LOOP_GATEWAY_DATABASE_PATH is required");
  }
  const projectRoot = projectRootFromEnv(env);
  const mode = providerModeFromEnv(env);

  const runtime = await protocolRuntimePort(databasePath);
  const providers = await assembleProviders({
    mode,
    databasePath,
    projectRoot,
    protocol: runtime.protocol,
    env,
  });
  const { LoopRuntime } = await import("@loop/orchestrator");
  const loopRuntime = new LoopRuntime({
    control: runtime.protocol,
    databasePath,
    providers: providers.registry,
    maxWorkers: providers.maxWorkers,
    // "watch": store-side activity history only — no herdr panes; the store
    // activity window is the sole wire source for run worker output (decision
    // D4, unchanged). The pane mirror below is a separate observation surface
    // (decision 2026-xx-terminal-mirror) and replaces nothing.
    workerVisibility: "watch",
  });
  const abort = new AbortController();

  const execution: RunExecutionPort = loopRuntime;
  const log = new RunEventLog(1, config.replayBufferFrames ?? REPLAY_BUFFER_FRAMES);
  const service = new GatewayService({
    runtime,
    planner: orchestratorPlanner({
      execution,
      workingDirectory: projectRoot,
      signal: abort.signal,
    }),
    log,
    planningLimit: config.planningLimit ?? 32,
  });

  // Terminal mirror v1 (decision 2026-xx-terminal-mirror): pane observation
  // is a separate fail-closed surface. It activates only when a herdr socket
  // path is configured and present; any source failure degrades to an empty
  // inventory and never touches the run machinery above.
  const paneAssembly = bootPaneMirror(config, env);
  const panes = paneAssembly?.mirror ?? null;
  const paneSource = paneAssembly?.source ?? null;
  const agentSessions = paneAssembly?.agentSessions ?? null;

  // Herdr surface (rebuild brief docs/design/rebuild-brief-herdr-first.md §4):
  // state monitor + control port over the same socket gate as the pane
  // mirror. Fail-observer — an unreachable herdr degrades to an honest
  // `available: false` view; the app renders an offline state.
  const herdrSurface = bootHerdrSurface(env);

  // GUI conversation v1 (decision 2026-xx-gui-conversation): the third SSE
  // family. The collector is fail-observer — a bind failure disables the
  // conversation surface only; runs and panes above are unaffected.
  const sessions = bootSessionCollector(config, env);

  // Remote session spawner (decision 2026-xx-session-spawn): tmux-first,
  // config-gated, cwd-rooted. Composition-root-only seam (§D-C); disabled
  // configs still construct the port — the port itself answers
  // `spawn_disabled` deterministically so the route stays honest 403, not 404.
  const spawner = new TmuxSpawner({
    config: spawnConfigFromEnv(env, { processCwd: process.cwd() }),
    exec: nodeSpawnExec,
    resolveDir: defaultResolveDir,
  });

  const server = startGateway(config, {
    service,
    verifier: new Hs256BearerVerifier(config.auth ?? DEFAULT_AUTH_ENV_NAMES),
    inspector: new OsTailscaleInspector(),
    ...(panes === null ? {} : { panes }),
    ...(sessions === null ? {} : { sessions }),
    steer: protocolSteerPort(runtime.protocol, databasePath),
    resolveAttention: {
      async resolve(runId, attentionId, resolution) {
        try {
          const snapshot = await runtime.protocol.getSnapshot({ databasePath, runId });
          if (!snapshot.attention.some((entry) => entry.id === attentionId)) {
            throw new ProblemError(404, "not_found");
          }
          await runtime.protocol.resolveAttention({
            databasePath,
            runId,
            attentionId,
            resolution,
            correctiveTask: null,
          });
        } catch (error) {
          if (error instanceof ProblemError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          if (/attention.*not found|unknown attention|not open/i.test(message)) {
            throw new ProblemError(404, "not_found");
          }
          if (/run_not_found|unknown run|run.*not found/i.test(message)) {
            throw new ProblemError(404, "run_not_found");
          }
          throw new ProblemError(502, "runtime_unavailable");
        }
      },
    },
    graph: {
      async get(runId) {
        try {
          return await runtime.protocol.getRunGraph({ databasePath, runId, nowMs: Date.now() });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/run_not_found|not found/i.test(message))
            throw new ProblemError(404, "run_not_found");
          throw new ProblemError(502, "runtime_unavailable");
        }
      },
    },
    spawn: spawner,
    // Read-only working-directory file surface (split-viewer design §A):
    // rooted at the configured project root, same confinement as spawn.
    files: new FileViewer({ root: projectRoot }),
    ...(herdrSurface === null ? {} : { herdr: herdrSurface }),
  });
  // Well-known runtime record (loop pair port fallback): written only AFTER
  // startGateway returned, so the file always describes a successful bind and
  // a failed boot leaves any previous record untouched. The primary
  // (tailnet-facing) listener is what pair payloads describe. Fail-observer:
  // an unwritable record degrades to a warning; the gateway still serves.
  // MagicDNS-first (decision: loop pair MagicDNS-first): a tailnet bind is
  // recorded under the machine's MagicDNS name when Tailscale reports one,
  // so the phone scans a DNS name (iOS ATS-safe) instead of a bare IP.
  try {
    const dnsName = await probeMagicDnsName();
    writeGatewayRuntimeRecord(gatewayRuntimeRecordPath(env), {
      host: pairingRecordHost(server.hostname, dnsName),
      port: server.port,
    });
  } catch (error) {
    console.error(
      `gateway runtime record not written: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  panes?.start();
  agentSessions?.start(AGENT_SESSION_POLL_MS);
  herdrSurface?.monitor.start();
  const innerStop = server.stop.bind(server); // capture before Object.assign overwrites it
  return Object.assign(server, {
    abortRuns: () => abort.abort(),
    stop: () => {
      innerStop();
      herdrSurface?.monitor.stop();
      herdrSurface?.control.close();
      panes?.stop();
      agentSessions?.stop();
      paneSource?.close();
      sessions?.stop();
    },
  });
}

if (import.meta.main) {
  try {
    const server = await bootGatewayFromEnv();
    const shutdown = () => {
      server.abortRuns();
      server.stop();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    const surfaces =
      server.loopback === null
        ? `http://${server.hostname}:${server.port}/v1`
        : `http://${server.hostname}:${server.port}/v1 + http://${server.loopback.hostname}:${server.loopback.port}/v1 (loopback, machine-local)`;
    console.log(`gateway listening on ${surfaces}`);
  } catch (error) {
    if (error instanceof ProblemError || error instanceof Error) {
      console.error(`gateway failed to start: ${error.message}`);
    }
    process.exit(1);
  }
}
