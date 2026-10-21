/**
 * Deterministic test doubles for the gateway suite: a manual clock, a fake
 * runtime port with manual snapshot delivery, a scripted planner, and a
 * boot helper that starts the real HTTP server on an ephemeral loopback
 * port. No paid model calls, no native bridge, no wall-clock waits.
 */

import type { RemotePaneSummary, SnapshotOutput, TaskSnapshotOutput } from "@loop/protocol";

import { Hs256BearerVerifier, signHs256Token } from "../src/auth";
import type { PeerIdentityVerifier } from "../src/auth";
import type { GatewayAuthEnvNames, GatewayAuthMode, GatewayIdentityMode } from "../src/config";
import { RunEventLog } from "../src/events";
import type { OutboundFrame } from "../src/events";
import { FileViewer } from "../src/files";
import { HerdrControlClient } from "../src/herdr-pane-source";
import { HerdrStateMonitor } from "../src/herdr-state";
import { PaneEventLog } from "../src/pane-events";
import { PaneMirror } from "../src/pane-mirror";
import type { PaneObservationPort, PaneReading } from "../src/pane-port";
import { ProblemError } from "../src/problem";
import { SessionCollector } from "../src/session-collector";
import { SessionEventLog } from "../src/session-events";
import type { SpawnOutcome, SpawnPort, SpawnRequest } from "../src/spawn";
import type { GraphPort, ResolveAttentionPort, SteerPort } from "../src/server";
import { GatewayService, type PromptPlannerPort, type RunRuntimePort } from "../src/service";
import { startGateway, type GatewayServer } from "../src/server";

export class TestClock {
  #nowMs: number;

  constructor(startMs = 1_700_000_000_000) {
    this.#nowMs = startMs;
  }

  get now(): number {
    return this.#nowMs;
  }

  advance(ms: number): void {
    this.#nowMs += ms;
  }
}

export class FakeRuntime implements RunRuntimePort {
  readonly #subscribers = new Map<string, Set<(snapshot: SnapshotOutput) => void>>();
  readonly #snapshots = new Map<string, SnapshotOutput>();
  failSnapshot = false;
  /** Durable registry rows returned by listRuns (decision D3 test seam). */
  durableRuns: { runId: string; state: "active" | "completed" | "failed" }[] = [];
  failListRuns = false;

  async snapshot(runId: string): Promise<SnapshotOutput> {
    if (this.failSnapshot) throw new Error("store unavailable");
    const found = this.#snapshots.get(runId);
    if (found === undefined) throw new Error("no durable run");
    return found;
  }

  async listRuns(): Promise<{ runId: string; state: "active" | "completed" | "failed" }[]> {
    if (this.failListRuns) throw new Error("store unavailable");
    return this.durableRuns;
  }

  subscribe(runId: string, listener: (snapshot: SnapshotOutput) => void): () => void {
    const set = this.#subscribers.get(runId) ?? new Set();
    set.add(listener);
    this.#subscribers.set(runId, set);
    return () => {
      set.delete(listener);
    };
  }

  /** Push a snapshot to every live subscriber and cache it for getRun. */
  emit(snapshot: SnapshotOutput): void {
    this.#snapshots.set(snapshot.runId, snapshot);
    for (const listener of this.#subscribers.get(snapshot.runId) ?? []) {
      listener(snapshot);
    }
  }
}

export class ScriptedPlanner implements PromptPlannerPort {
  readonly calls: {
    runId: string;
    prompt: string;
    clientContext: { displayName?: string } | null;
    handle: { markPlanning(id: string): void; planningFailed(id: string): void };
  }[] = [];
  failSynchronously = false;

  begin(
    input: { runId: string; prompt: string; clientContext: { displayName?: string } | null },
    handle: { markPlanning(id: string): void; planningFailed(id: string): void },
  ): void {
    if (this.failSynchronously) throw new Error("pi adapter offline");
    this.calls.push({ ...input, handle });
  }
}

export function makeSnapshot(
  overrides: Partial<SnapshotOutput> & { runId: string },
): SnapshotOutput {
  return {
    state: "active",
    tasks: [],
    activeWorkers: [],
    openAttentionIds: [],
    attention: [],
    intent: "",
    workingDirectory: ".",
    guidance: [],
    goalCriteria: [],
    lastSequence: 1n,
    executionOwner: null,
    executionExpiresAt: null,
    ...overrides,
  };
}

export function makeTask(
  overrides: Partial<TaskSnapshotOutput> & { id: string },
): TaskSnapshotOutput {
  return {
    title: overrides.id,
    kind: "implementation",
    state: "pending",
    attempt: 1,
    preferredCompute: "fast",
    dependencies: [],
    readScope: [],
    writeScope: [],
    blockedBy: [],
    lastFailure: null,
    activities: [],
    resultSummary: null,
    ...overrides,
  };
}

let bootCounter = 0;

/** Deterministic fake pane source (decision M-TM1: no real herdr, no paid
 * calls). Tests mutate `panes` / `reads` and drive `mirror.tick()` manually. */
export class FakePaneSource implements PaneObservationPort {
  panes: RemotePaneSummary[] = [];
  reads = new Map<string, PaneReading>();
  unavailable = false;

  async listPanes(): Promise<RemotePaneSummary[] | null> {
    return this.unavailable ? null : this.panes;
  }

  async readPane(paneId: string): Promise<PaneReading | null> {
    return this.reads.get(paneId) ?? null;
  }

  setReading(paneId: string, revision: number, text: string, truncated = false): void {
    this.reads.set(paneId, { revision: revision.toString(10), text, truncated });
  }
}

export function makePane(
  overrides: Partial<RemotePaneSummary> & { paneId: string },
): RemotePaneSummary {
  return {
    label: null,
    taskId: null,
    workspaceId: "w0",
    state: "active",
    ...overrides,
  };
}

export type TestGateway = {
  server: GatewayServer;
  service: GatewayService;
  runtime: FakeRuntime;
  planner: ScriptedPlanner;
  clock: TestClock;
  baseUrl: string;
  secret: string;
  issuer: string;
  audience: string;
  /** Env-var names backing the per-boot bearer material — needed by tests
   * that start an additional server in bearer-fallback mode directly. */
  authNames: GatewayAuthEnvNames;
  token(claims?: { exp?: number; iss?: string; aud?: string | string[]; alg?: string }): string;
  stop(): void;
  panes: PaneMirror | null;
  paneSource: FakePaneSource | null;
  /** GUI conversation surface (decision 2026-xx-gui-conversation); null when
   * booted with `session: false`. Driven through `tap()` + `tickMerge()`. */
  sessions: SessionCollector | null;
  sessionLog: SessionEventLog | null;
  /** Steer spy: records every accepted steer (bridge-call parity, M-GC2). */
  steer: ScriptedSteer;
  attention: ScriptedResolveAttention;
  /** Herdr surface (rebuild brief §4); null when booted without it. The
   * monitor is started; tests await `waitUntilHerdr` for the first snapshot. */
  herdr: { monitor: HerdrStateMonitor; control: HerdrControlClient } | null;
};

/** Steer port spy (M-GC2: exactly one steer_run bridge call per accepted
 * steer; the fake asserts the call, never a real bridge). */
export class ScriptedSteer implements SteerPort {
  calls: { runId: string; message: string }[] = [];
  failWith: ProblemError | null = null;

  async steer(runId: string, message: string): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
    this.calls.push({ runId, message });
  }
}

export class ScriptedResolveAttention implements ResolveAttentionPort {
  calls: { runId: string; attentionId: string; resolution: string }[] = [];
  failWith: ProblemError | null = null;

  async resolve(runId: string, attentionId: string, resolution: string): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
    this.calls.push({ runId, attentionId, resolution });
  }
}

export function bootTestGateway(
  overrides: {
    planningLimit?: number;
    replayBufferFrames?: number;
    generation?: number;
    queueMaxFrames?: number;
    /** Auth mode (decision 2026-xx-tokenless-auth-and-app-layout §D-A);
     * defaults to "bearer-fallback" so existing tests exercise the strict
     * bearer path. "tailscale" boots tokenless (no verifier consulted). */
    authMode?: GatewayAuthMode;
    /** Tailscale-mode identity hardening (§D-A2). */
    identity?: GatewayIdentityMode;
    /** Peer-identity verifier seam for `identity: "whois"`. */
    identityVerifier?: PeerIdentityVerifier;
    /** `false` boots WITHOUT setting the JWT env vars — tokenless-mode
     * zero-credential tests and bearer-mode startup fail-closed tests. */
    bearerEnv?: false;
    /** Wire a pane mirror over an in-test fake source (terminal mirror v1). */
    pane?:
      | { maxObservedPanes?: number; replayBufferFrames?: number; maxFrameBytes?: number }
      | false;
    /** Wire the GUI conversation collector over the pure core (no socket);
     * `false` boots without the session surface (routes 404). */
    session?:
      | {
          replayBufferFrames?: number;
          maxFrameBytes?: number;
          mergeFlushMs?: number;
          /** Attachment body caps (D5) — tests shrink them for eviction cases. */
          assets?: {
            maxBodyBytes?: number;
            maxPerSession?: number;
            maxTotalBytesPerSession?: number;
          };
        }
      | false;
    /** Omit the steer seam (route 404s). */
    steer?: false;
    /** Omit the attention resolution seam (route 404s). */
    attention?: false;
    /** Remote session spawner (decision 2026-xx-session-spawn); default
     * absent → POST /v1/sessions/spawn is 404. Pass a ScriptedSpawner to
     * exercise the contract. */
    spawn?: SpawnPort;
    graph?: GraphPort;
    /** Read-only file surface (split-viewer design §A): pass `{ root }`
     * to wire a FileViewer over a test root; default absent → file routes
     * 404 (fail-closed). */
    files?: { root: string; maxFileBytes?: number } | false;
    /** Herdr surface (rebuild brief §4): pass a control client (over a fake
     * herdr unix socket); the monitor is built here. Default absent →
     * /v1/herdr routes 404 (fail-closed). */
    herdr?: { control: HerdrControlClient } | false;
  } = {},
): TestGateway {
  bootCounter += 1;
  const suffix = `${bootCounter}_${Math.random().toString(36).slice(2, 8)}`;
  const authNames: GatewayAuthEnvNames = {
    secretEnv: `LOOP_TEST_JWT_SECRET_${suffix}`,
    issuerEnv: `LOOP_TEST_JWT_ISSUER_${suffix}`,
    audienceEnv: `LOOP_TEST_JWT_AUDIENCE_${suffix}`,
  };
  const secret = `test-secret-${suffix}`;
  const issuer = "loop-test-issuer";
  const audience = "loop-test-audience";
  if (overrides.bearerEnv !== false) {
    process.env[authNames.secretEnv] = secret;
    process.env[authNames.issuerEnv] = issuer;
    process.env[authNames.audienceEnv] = audience;
  }

  const clock = new TestClock();
  const runtime = new FakeRuntime();
  const planner = new ScriptedPlanner();
  const log = new RunEventLog(overrides.generation ?? 7, overrides.replayBufferFrames ?? 1024);
  let runCounter = 0;
  const service = new GatewayService({
    runtime,
    planner,
    log,
    nowMs: () => clock.now,
    runIdFactory: () => {
      runCounter += 1;
      return `run-${runCounter}`;
    },
    planningLimit: overrides.planningLimit ?? 32,
  });

  const config = {
    // Test-only OS-assigned port; parseGatewayConfig never produces port 0,
    // so the resolved config object is built directly here (see config.ts).
    host: "127.0.0.1",
    port: 0,
    // Bearer fallback is the test default: every existing suite asserts the
    // strict 401 paths. Tokenless tests opt into "tailscale" explicitly.
    authMode: overrides.authMode ?? "bearer-fallback",
    identity: overrides.identity ?? "off",
    auth: authNames,
    planningLimit: 0, // unused by the server; the service holds its own limit
    heartbeatMs: 15_000,
    replayBufferFrames: overrides.replayBufferFrames ?? 1024,
    queueMaxFrames: overrides.queueMaxFrames ?? 256,
    queueMaxBytes: 1024 * 1024,
  };
  const paneDeps =
    overrides.pane === undefined
      ? null
      : overrides.pane === false
        ? null
        : (() => {
            const source = new FakePaneSource();
            const mirror = new PaneMirror({
              port: source,
              log: new PaneEventLog(
                overrides.generation ?? 7,
                overrides.pane?.replayBufferFrames ?? 512,
              ),
              nowMs: () => clock.now,
              maxObservedPanes: overrides.pane?.maxObservedPanes ?? 16,
              maxFrameBytes: overrides.pane?.maxFrameBytes ?? 16 * 1024,
            });
            return { mirror, source };
          })();
  // GUI conversation v1: the collector over the pure core — no socket, no
  // merge pump; tests feed `tap()` lines and drive `tickMerge()` by clock.
  let sessions: SessionCollector | null = null;
  let sessionLog: SessionEventLog | null = null;
  if (overrides.session !== false) {
    sessionLog = new SessionEventLog(
      overrides.generation ?? 7,
      overrides.session?.replayBufferFrames ?? 512,
    );
    sessions = new SessionCollector({
      log: sessionLog,
      nowMs: () => clock.now,
      mergeFlushMs: overrides.session?.mergeFlushMs ?? 250,
      mergeTickMs: 0,
      maxFrameBytes: overrides.session?.maxFrameBytes ?? 16 * 1024,
      ...(overrides.session?.assets === undefined ? {} : { assets: overrides.session.assets }),
    });
  }
  const steer = new ScriptedSteer();
  const attention = new ScriptedResolveAttention();
  let herdrSurface: { monitor: HerdrStateMonitor; control: HerdrControlClient } | null = null;
  if (overrides.herdr !== undefined && overrides.herdr !== false) {
    const monitor = new HerdrStateMonitor(overrides.herdr.control, {
      pollMs: 60_000,
      coalesceMs: 5,
    });
    herdrSurface = { monitor, control: overrides.herdr.control };
    monitor.start();
  }
  const server = startGateway(config, {
    service,
    verifier: new Hs256BearerVerifier(authNames, () => clock.now),
    ...(overrides.identityVerifier === undefined ? {} : { identity: overrides.identityVerifier }),
    inspector: { assertBindable: () => undefined },
    ...(paneDeps === null ? {} : { panes: paneDeps.mirror }),
    ...(sessions === null ? {} : { sessions }),
    ...(overrides.steer === false ? {} : { steer }),
    ...(overrides.attention === false ? {} : { resolveAttention: attention }),
    ...(overrides.spawn === undefined ? {} : { spawn: overrides.spawn }),
    ...(overrides.graph === undefined ? {} : { graph: overrides.graph }),
    ...(overrides.files === undefined || overrides.files === false
      ? {}
      : { files: new FileViewer(overrides.files) }),
    ...(herdrSurface === null ? {} : { herdr: herdrSurface }),
  });

  return {
    server,
    service,
    runtime,
    planner,
    clock,
    baseUrl: `http://127.0.0.1:${server.port}`,
    secret,
    issuer,
    audience,
    /** Env-var names backing the per-boot bearer material (needed by tests
     * that start a second server in bearer-fallback mode directly). */
    authNames,
    token(claims = {}) {
      const header = claims.alg === undefined ? undefined : { alg: claims.alg, typ: "JWT" };
      return signHs256Token(
        {
          iss: claims.iss ?? issuer,
          aud: claims.aud ?? audience,
          exp: claims.exp ?? Math.floor(clock.now / 1000) + 600,
        },
        claims.alg === undefined ? secret : "irrelevant-secret",
        header,
      );
    },
    stop() {
      server.stop();
      paneDeps?.mirror.stop();
      sessions?.stop();
      if (overrides.bearerEnv !== false) {
        delete process.env[authNames.secretEnv];
        delete process.env[authNames.issuerEnv];
        delete process.env[authNames.audienceEnv];
      }
    },
    panes: paneDeps?.mirror ?? null,
    paneSource: paneDeps?.source ?? null,
    sessions,
    sessionLog,
    steer,
    attention,
    herdr: herdrSurface,
  };
}

// ——— Session spawn seam (decision 2026-xx-session-spawn contract tests) ———

/** Scripted SpawnPort: records every (request, listener) pair and answers
 * with the fixed outcome or the scripted ProblemError — no tmux, no
 * processes. */
export class ScriptedSpawner implements SpawnPort {
  readonly calls: { request: SpawnRequest; listener: "tailscale" | "bearer-fallback" }[] = [];
  outcome: SpawnOutcome | null = null;
  failWith: ProblemError | null = null;

  async spawn(
    request: SpawnRequest,
    context: { listener: "tailscale" | "bearer-fallback" },
  ): Promise<SpawnOutcome> {
    this.calls.push({ request, listener: context.listener });
    if (this.failWith !== null) throw this.failWith;
    return (
      this.outcome ?? {
        spawnId: "abc12345",
        tmuxTarget: "loop:pi-abc12345",
        paneId: "%5",
        pid: 4321,
        cwd: "/tmp/loop-work",
        launcher: "tmux",
      }
    );
  }
}

// ——— Session tap seam (deterministic collector driver) ———

let tapConnectionCounter = 0;

/** Open a tap connection on the collector and register the session in one
 * step (the pure-core equivalent of socket connect + register line). `write`
 * captures the DOWNSTREAM channel — collector → tap lines (`deliver_input`);
 * pass an array-push closure to assert deliveries. */
export function tapConnect(
  gateway: TestGateway,
  register: Record<string, unknown>,
  write?: (line: string) => void,
): string {
  const connectionId = `tap-test-${(tapConnectionCounter += 1)}`;
  gateway.sessions?.openConnection(connectionId, write);
  gateway.sessions?.ingestLine(connectionId, JSON.stringify({ type: "register", ...register }));
  return connectionId;
}

/** Feed one NDJSON line over an open tap connection. */
export function tap(
  gateway: TestGateway,
  connectionId: string,
  line: Record<string, unknown>,
): void {
  gateway.sessions?.ingestLine(connectionId, JSON.stringify(line));
}

/** Close a tap connection (the pure-core equivalent of socket end). */
export function tapDisconnect(gateway: TestGateway, connectionId: string): void {
  gateway.sessions?.tapDisconnected(connectionId);
}

// ——— HTTP helpers ———

export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function submitPrompt(
  gateway: TestGateway,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return submitPromptLike(gateway, body, extraHeaders);
}

/** Same probe for any booted gateway exposing baseUrl + a bearer token.
 * The token may be a minted string or the test gateway's signer function. */
export async function submitPromptLike(
  gateway: { baseUrl: string; token: string | (() => string) },
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const token = typeof gateway.token === "function" ? gateway.token() : gateway.token;
  return fetch(`${gateway.baseUrl}/v1/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(token),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

// ——— SSE test reader ———

export type ParsedFrame = { id: string | null; event: string; data: unknown };

export function parseSseFrames(raw: string): ParsedFrame[] {
  const frames: ParsedFrame[] = [];
  // Only complete frames (terminated by a blank line) are parsed; a trailing
  // partial block from a chunk boundary stays buffered by the caller.
  const boundary = raw.lastIndexOf("\n\n");
  const complete = boundary === -1 ? "" : raw.slice(0, boundary + 2);
  for (const block of complete.split("\n\n")) {
    if (block.trim().length === 0) continue;
    let id: string | null = null;
    let event = "message";
    let data = "";
    let sawField = false;
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue; // keepalive comment
      if (line.startsWith("id: ")) {
        id = line.slice(4);
        sawField = true;
      } else if (line.startsWith("event: ")) {
        event = line.slice(7);
        sawField = true;
      } else if (line.startsWith("data: ")) {
        data = line.slice(6);
        sawField = true;
      }
    }
    // A comment-only block (keepalive) is not a frame — same rule as the
    // app-side SseParser, which drops field-less frames.
    if (!sawField) continue;
    frames.push({ id, event, data: data.length > 0 ? JSON.parse(data) : null });
  }
  return frames;
}

/** Read SSE frames until `until` matches or the deadline passes. */
export async function readSseUntil(
  response: Response,
  until: (frames: ParsedFrame[]) => boolean,
  deadlineMs = 2_000,
): Promise<{ frames: ParsedFrame[]; closedByServer: boolean; raw: string }> {
  const collector = new SseCollector(response);
  try {
    await collector.until(until, deadlineMs);
  } finally {
    await collector.close(); // release the connection: a real client disconnect
  }
  return { frames: collector.frames, closedByServer: collector.closedByServer, raw: collector.raw };
}

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

/** Incremental SSE reader that keeps its position across multiple awaits. */
export class SseCollector {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #raw = "";
  closedByServer = false;

  constructor(response: Response) {
    this.#reader = must(response.body?.getReader());
  }

  get raw(): string {
    return this.#raw;
  }

  get frames(): ParsedFrame[] {
    return parseSseFrames(this.#raw);
  }

  /** Await until the predicate holds or the server closes / deadline hits.
   * Predicates in this suite are monotone under appended frames, so frames
   * read during the post-match settle below never un-satisfy them. */
  async until(
    predicate: (frames: ParsedFrame[]) => boolean,
    deadlineMs = 2_000,
  ): Promise<ParsedFrame[]> {
    const deadline = Date.now() + deadlineMs;
    for (;;) {
      const frames = this.frames;
      if (predicate(frames)) {
        // A conformant server closes right after its terminal frame (ADR
        // §4.5: "gateway는 frame을 flush한 뒤 연결을 닫는다"). Linger briefly
        // so `closedByServer` can observe exactly that close.
        if (frames.some((frame) => frame.event === "terminal")) {
          await this.#observeServerClose(deadline, predicate);
        }
        return this.frames;
      }
      if (this.closedByServer) return frames;
      if (Date.now() > deadline) throw new Error(`SSE deadline exceeded; got: ${this.#raw}`);
      const chunk = await this.#nextRead();
      if (chunk.done) {
        this.closedByServer = true;
        return this.frames;
      }
      this.#raw += this.#decoder.decode(chunk.value, { stream: true });
    }
  }

  /** Grace window for observing a server close that is already in flight. */
  static readonly CLOSE_SETTLE_MS = 100;

  #inFlightRead: ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]> | null = null;

  /**
   * The next chunk, deduplicated: concurrent awaiters (main loop + settle
   * race) observe the SAME read instead of stealing each other's chunks.
   */
  #nextRead() {
    const pending = this.#inFlightRead ?? (this.#inFlightRead = this.#reader.read());
    return pending.finally(() => {
      this.#inFlightRead = null;
    });
  }

  /**
   * After a terminal match, race one extra read against a short grace
   * timer. A quiet window (run still live / close not in flight) returns
   * immediately; a read that wins is either EOF (close observed) or more
   * frames, which are appended before re-checking the predicate.
   */
  async #observeServerClose(
    deadline: number,
    predicate: (frames: ParsedFrame[]) => boolean,
  ): Promise<void> {
    while (!this.closedByServer) {
      const graceMs = Math.min(SseCollector.CLOSE_SETTLE_MS, deadline - Date.now());
      if (graceMs <= 0) return;
      const observed = await Promise.race([
        this.#nextRead(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), graceMs)),
      ]);
      if (observed === null) return; // quiet grace window: no close in flight
      if (observed.done) {
        this.closedByServer = true;
        return;
      }
      this.#raw += this.#decoder.decode(observed.value, { stream: true });
      if (!predicate(this.frames)) return; // yield unexpected data to the main loop
    }
  }

  async close(): Promise<void> {
    await this.#reader.cancel().catch(() => undefined);
  }
}

export function isFrame(frame: ParsedFrame | undefined, event: string): boolean {
  return frame !== undefined && frame.event === event;
}

export type { OutboundFrame };
