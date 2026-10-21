/**
 * HTTP/SSE surface of the gateway (ADR §4) — routing, mode-selected auth
 * (tokenless Tailscale vs bearer fallback), Origin rejection, request ids,
 * request validation, problem mapping, and SSE streaming. Thin by design:
 * all state and policy live in GatewayService; this module owns only HTTP
 * framing and adapter-local validation.
 */

import type { RunGraphOutput } from "@loop/protocol";
import type { GatewayAuthEnvNames, GatewayAuthMode, GatewayConfig } from "./config";
import type { HerdrAgentStartSpec, HerdrControlClient, HerdrReadSource } from "./herdr-pane-source";
import { HERDR_DEFAULT_READ_SOURCE, HERDR_READ_SOURCES } from "./herdr-pane-source";
import type { HerdrStateMonitor } from "./herdr-state";
import { DEFAULT_AUTH_ENV_NAMES } from "./config";
import type { OutboundFrame } from "./events";
import { ProblemError, problemResponse } from "./problem";
import { resolveAgentConversation } from "./agent-sessions";
import type { AuthVerifier, PeerIdentityVerifier } from "./auth";
import { decodeListCursor } from "./cursor";
import type { PaneMirror } from "./pane-mirror";
import { SseClientStream } from "./stream";
import type { SessionCollector } from "./session-collector";
import { isUploadableImageType, MAX_ATTACHMENT_BODY_BYTES } from "./session-assets";
import type { FileViewer } from "./files";
import type { SessionOutboundFrame } from "./session-events";
import type { SpawnPort } from "./spawn";
import type { GatewayService } from "./service";
import type { TailscaleInspector } from "./tailscale";
import {
  OsTailscaleInspector,
  stripIpv6Zone,
  validateFallbackBindHost,
  validateLoopbackBindHost,
} from "./tailscale";
import {
  HEARTBEAT_MS,
  MAX_DISPLAY_NAME_GRAPHEMES,
  MAX_PROMPT_BYTES,
  QUEUE_MAX_BYTES,
  QUEUE_MAX_FRAMES,
  type RemoteRun,
  type RemoteRunPage,
} from "./wire";

/** Steer delivery seam (decision 2026-xx-gui-conversation D3): the existing
 * `steer_run` bridge behind a narrow port. Composition wires
 * `protocol.steerRun` with the database path; the server stays HTTP-only and
 * the bridge is called exactly once per accepted steer (spy-verified). */
export interface SteerPort {
  /** Throws ProblemError for problem-mapped failures (e.g. unknown run). */
  steer(runId: string, message: string): Promise<void>;
}

export interface ResolveAttentionPort {
  resolve(runId: string, attentionId: string, resolution: string): Promise<void>;
}

export interface GraphPort {
  get(runId: string): Promise<RunGraphOutput>;
}

/** Herdr surface port (rebuild brief §4): the state monitor plus the control
 * client, both implemented over the single herdr socket adapter. Absent →
 * /v1/herdr routes 404 (fail-closed, like every optional surface). */
export type HerdrSurface = {
  monitor: HerdrStateMonitor;
  control: HerdrControlClient;
};

export type GatewayServerDeps = {
  service: GatewayService;
  /** Bearer verification; consulted only in "bearer-fallback" mode
   * (decision 2026-xx-tokenless-auth-and-app-layout §D-A1/§D-A3). */
  verifier: AuthVerifier;
  /** Optional peer-identity hardening for "tailscale" mode (§D-A2);
   * required at startup when config selects `identity: "whois"`. */
  identity?: PeerIdentityVerifier;
  inspector?: TailscaleInspector;
  /** Terminal-mirror pane surface; absent → pane routes 404 (feature not
   * configured; fail-closed, decision 2026-xx-terminal-mirror). */
  panes?: PaneMirror;
  /** GUI conversation surface (collector); absent → session routes 404 and
   * steer is mirrored nowhere (decision 2026-xx-gui-conversation D3). */
  sessions?: SessionCollector;
  /** Steer delivery seam; absent → POST /v1/runs/{runId}/steer is 404. */
  steer?: SteerPort;
  /** Attention resolution seam; absent → resolve route is 404. */
  resolveAttention?: ResolveAttentionPort;
  graph?: GraphPort;
  /** Remote session spawner (decision 2026-xx-session-spawn); absent →
   * POST /v1/sessions/spawn is 404 (fail-closed, like every other optional
   * surface). The spawner owns all policy; the server only frames HTTP. */
  spawn?: SpawnPort;
  /** Read-only working-directory file surface (split-viewer design §A);
   * absent → file routes 404 (fail-closed, same as every optional surface).
   * All path policy lives in the viewer; the server only frames HTTP. */
  files?: FileViewer;
  /** Herdr surface (rebuild brief §4); absent → /v1/herdr routes 404. */
  herdr?: HerdrSurface;
};

export type GatewayServer = {
  hostname: string;
  port: number;
  /** Secondary loopback listener (tailscale mode, decision §D-A4);
   * `null` when disabled (config opt-out, bearer-fallback mode, or the
   * primary already binds loopback). */
  loopback: { hostname: string; port: number } | null;
  stop(): void;
};

/** Structural slice of Bun's Server used for peer lookup; kept loose so the
 * runtime works across bun-types versions that predate `requestIP`. */
type PeerLookup = { requestIP?: (request: Request) => { address: string } | null } | null;

export function startGateway(config: GatewayConfig, deps: GatewayServerDeps): GatewayServer {
  const inspector = deps.inspector ?? new OsTailscaleInspector();
  const authMode: GatewayAuthMode = config.authMode ?? "tailscale";
  const identityMode = config.identity ?? "off";

  // Startup checks are deterministic and fail closed before any socket opens
  // (decision 2026-xx-tokenless-auth-and-app-layout §D-A1/§D-A3).
  if (authMode === "bearer-fallback") {
    validateFallbackBindHost(config.host);
    assertBearerMaterialConfigured(config.auth ?? DEFAULT_AUTH_ENV_NAMES);
  } else {
    inspector.assertBindable(config.host); // Fail closed before binding (ADR §2 D2).
    if (identityMode === "whois" && deps.identity === undefined) {
      throw new Error(
        'gateway config identity "whois" requires platform peer-identity support (no verifier provided)',
      );
    }
  }

  let boundServers: NonNullable<PeerLookup>[] = [];
  const peerAddress = (request: Request): string | null => {
    for (const listener of boundServers) {
      const ip = listener.requestIP?.(request);
      if (ip) return ip.address;
    }
    return null;
  };

  // One fetch pipeline shared by every listener — mode-selected auth, Origin
  // rejection, and problem mapping are listener-agnostic (decision §D-A4).
  const fetchHandler = async (request: Request): Promise<Response> => {
    try {
      return await handle(request, config, deps, authMode, identityMode, () =>
        peerAddress(request),
      );
    } catch (error) {
      const requestId = requestIdOf(request);
      if (error instanceof ProblemError) {
        const extra: Record<string, string> =
          error.code === "capacity_exhausted" ? { "Retry-After": "5" } : {};
        return problemResponse(error.status, error.code, requestId, error.fields, extra);
      }
      return problemResponse(500, "internal", requestId);
    }
  };

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 0, // SSE connections are long-lived; keepalives own liveness.
    fetch: fetchHandler,
  });
  const listeners: { stop(closeActive?: boolean): void }[] = [server];
  boundServers = [server as unknown as NonNullable<PeerLookup>];

  // Secondary loopback listener (decision §D-A4 amendment): tailscale mode
  // only — the primary's bind policy already rejects loopback primaries, so
  // the two listeners can never collide — fail-closed on a loopback literal,
  // same port as the primary by default. Bearer-fallback mode never starts
  // it: its single explicit bind already defines its surface.
  let loopbackListener: { hostname: string; port: number } | null = null;
  const loopbackEnabled = config.loopback?.enabled ?? authMode === "tailscale";
  const loopbackHost = config.loopback?.host ?? "127.0.0.1";
  const loopbackPort = config.loopback?.port ?? config.port;
  const primaryPort = server.port ?? config.port;
  // Suppress the secondary when the primary already serves that exact
  // loopback socket (canonicalized: ::1 aliases collapse). Under the real
  // tailscale bind policy the primary can never be loopback, so this fires
  // only for stub-inspector boots (tests) or ::1 spelling collisions.
  const primaryLoopback = canonicalLoopbackLiteral(config.host);
  const secondarySuppressed =
    primaryLoopback !== null && primaryLoopback === canonicalLoopbackLiteral(loopbackHost);
  if (authMode === "tailscale" && loopbackEnabled && !secondarySuppressed) {
    validateLoopbackBindHost(loopbackHost); // Fail closed before binding.
    const secondary = Bun.serve({
      hostname: loopbackHost,
      port: loopbackPort === config.port ? primaryPort : loopbackPort,
      idleTimeout: 0,
      fetch: fetchHandler,
    });
    listeners.push(secondary);
    boundServers.push(secondary as unknown as NonNullable<PeerLookup>);
    loopbackListener = { hostname: loopbackHost, port: secondary.port ?? primaryPort };
  }

  // Bun types the bound port as optional; at runtime it is always assigned
  // after listen — including OS-assigned ports (test-only port 0).
  return {
    hostname: config.host,
    port: server.port ?? config.port,
    loopback: loopbackListener,
    stop: () => {
      for (const listener of listeners) listener.stop(true);
    },
  };
}

/** Canonical loopback literal for suppression comparison, or `null` when the
 * host is not a loopback literal (fail-closed binding is done elsewhere). */
function canonicalLoopbackLiteral(host: string): string | null {
  try {
    validateLoopbackBindHost(host);
  } catch {
    return null;
  }
  const lower = stripIpv6Zone(host); // strip zone id
  return lower === "0:0:0:0:0:0:0:1" ? "::1" : lower;
}

/** Bearer-fallback startup gate (decision §D-A3): an unconfigured gateway
 * authenticates nobody, so a fallback listener without its signing material
 * refuses to start instead of serving 401s forever. Values stay in process
 * memory; only their presence is checked here. */
function assertBearerMaterialConfigured(names: GatewayAuthEnvNames): void {
  for (const envName of [names.secretEnv, names.issuerEnv, names.audienceEnv]) {
    const value = process.env[envName];
    if (value === undefined || value.length === 0) {
      throw new Error(`bearer-fallback mode requires ${envName} to be set at startup`);
    }
  }
}

async function handle(
  request: Request,
  config: GatewayConfig,
  deps: GatewayServerDeps,
  authMode: GatewayAuthMode,
  identityMode: "off" | "whois",
  peerAddress: () => string | null,
): Promise<Response> {
  const requestId = requestIdOf(request);

  // Browsers are not v1 clients: any Origin header is rejected (ADR §2 D2).
  // Both auth modes reject Origin (decision §D-A1).
  if (request.headers.get("origin") !== null) {
    return problemResponse(403, "origin_rejected", requestId);
  }

  if (authMode === "bearer-fallback") {
    try {
      deps.verifier.verify(request.headers.get("authorization"));
    } catch (error) {
      if (error instanceof ProblemError)
        return problemResponse(error.status, error.code, requestId);
      throw error;
    }
  } else if (identityMode === "whois") {
    // Tokenless mode: tailnet membership is the trust boundary (§D-A1); the
    // optional identity check re-derives the peer from the platform (§D-A2).
    const identity = deps.identity;
    if (identity === undefined) throw new Error("whois auth mode requires an identity verifier");
    try {
      identity.verifyIdentity({ address: peerAddress() });
    } catch (error) {
      if (error instanceof ProblemError)
        return problemResponse(error.status, error.code, requestId);
      throw error;
    }
  }

  const url = new URL(request.url);
  const segments = normalizePath(url.pathname)
    .split("/")
    .filter((segment) => segment.length > 0);

  if (segments[0] !== "v1") {
    return problemResponse(404, "not_found", requestId);
  }
  if (segments[1] === "runs") {
    return handleRunRoute(request, url, segments, config, deps, requestId);
  }
  if (segments[1] === "panes") {
    return handlePaneRoute(request, segments, config, deps, requestId);
  }
  if (segments[1] === "sessions") {
    return handleSessionRoute(request, segments, config, deps, authMode, requestId);
  }
  if (segments[1] === "files") {
    return handleFileRoute(request, url, segments, deps, requestId);
  }
  if (segments[1] === "herdr") {
    return handleHerdrRoute(request, url, segments, config, deps, requestId);
  }
  return problemResponse(404, "not_found", requestId);
}

// ——— GET /v1/files, GET /v1/files/content (split-viewer design §A) ———
// Read-only working-directory surface: the FileViewer owns every path
// decision; absent dep → 404 (fail-closed, like panes/sessions/spawn).

async function handleFileRoute(
  request: Request,
  url: URL,
  segments: string[],
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  const files = deps.files;
  if (files === undefined) return problemResponse(404, "not_found", requestId);
  if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
  if (segments.length === 2) {
    const entries = files.list(url.searchParams.get("dir") ?? "");
    return jsonResponse({ entries }, 200, requestId);
  }
  if (segments.length === 3 && segments[2] === "content") {
    const path = url.searchParams.get("path");
    if (path === null || path.length === 0) {
      throw new ProblemError(400, "invalid_request", { path: "path is required" });
    }
    const { text, etag } = files.readText(path);
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ETag: etag,
      },
    });
  }
  return problemResponse(404, "not_found", requestId);
}

async function handleRunRoute(
  request: Request,
  url: URL,
  segments: string[],
  config: GatewayConfig,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  if (segments.length === 2) {
    if (request.method === "POST") return handleSubmit(request, deps, requestId);
    if (request.method === "GET") return handleList(url, deps, requestId);
    return problemResponse(405, "method_not_allowed", requestId);
  }
  if (segments.length === 3) {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    return handleGet(decodeSegment(routeSegment(segments, 2)), deps, requestId);
  }
  if (segments.length === 4 && segments[3] === "graph") {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    if (deps.graph === undefined) return problemResponse(404, "not_found", requestId);
    return jsonResponse(
      await deps.graph.get(decodeSegment(routeSegment(segments, 2))),
      200,
      requestId,
    );
  }
  if (segments.length === 4 && segments[3] === "events") {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    return handleEvents(request, decodeSegment(routeSegment(segments, 2)), config, deps, requestId);
  }
  if (segments.length === 4 && segments[3] === "steer") {
    if (request.method !== "POST") return problemResponse(405, "method_not_allowed", requestId);
    return handleSteer(request, decodeSegment(routeSegment(segments, 2)), deps, requestId);
  }
  if (segments.length === 5 && segments[3] === "attention" && segments[4] === "resolve") {
    if (request.method !== "POST") return problemResponse(405, "method_not_allowed", requestId);
    return handleResolveAttention(
      request,
      decodeSegment(routeSegment(segments, 2)),
      deps,
      requestId,
    );
  }
  return problemResponse(404, "not_found", requestId);
}

// ——— GET /v1/sessions, GET /v1/sessions/{sessionId}/events, POST steer ———
// (GUI conversation v1; decision 2026-xx-gui-conversation D3)

async function handleSessionRoute(
  request: Request,
  segments: string[],
  config: GatewayConfig,
  deps: GatewayServerDeps,
  authMode: GatewayAuthMode,
  requestId: string,
): Promise<Response> {
  // Spawn sits under the sessions path family but does NOT require the
  // collector: it creates a host-side pi TUI (decision 2026-xx-session-spawn
  // §D-C); the tap later registers the resulting session on its own.
  if (segments.length === 3 && segments[2] === "spawn") {
    if (request.method !== "POST") return problemResponse(405, "method_not_allowed", requestId);
    return handleSpawn(request, deps, authMode, requestId);
  }
  const sessions = deps.sessions;
  if (sessions === undefined) return problemResponse(404, "not_found", requestId);
  if (segments.length === 2) {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    return jsonResponse(sessions.listSessions(), 200, requestId);
  }
  if (segments.length === 4 && segments[3] === "events") {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    return handleSessionEvents(
      request,
      decodeSessionSegment(routeSegment(segments, 2)),
      config,
      deps,
      requestId,
    );
  }
  if (segments.length === 4 && segments[3] === "attachments") {
    if (request.method !== "POST") return problemResponse(405, "method_not_allowed", requestId);
    return handleAttachmentUpload(
      request,
      decodeSessionSegment(routeSegment(segments, 2)),
      deps,
      requestId,
    );
  }
  if (segments.length === 4 && segments[3] === "input") {
    if (request.method !== "POST") return problemResponse(405, "method_not_allowed", requestId);
    return handleSessionInput(
      request,
      decodeSessionSegment(routeSegment(segments, 2)),
      deps,
      requestId,
    );
  }
  if (segments.length === 5 && segments[3] === "attachments") {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    return handleSessionAttachment(
      decodeSessionSegment(routeSegment(segments, 2)),
      decodeAttachmentSegment(routeSegment(segments, 4)),
      deps,
      requestId,
    );
  }
  return problemResponse(404, "not_found", requestId);
}

function decodeSessionSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ProblemError(404, "session_not_found");
  }
}

function decodeAttachmentSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ProblemError(404, "attachment_not_found");
  }
}

/**
 * GET /v1/sessions/{sessionId}/attachments/{attachmentId} (decision D5,
 * M2): the attachment BODY, served out-of-band from the SSE frame buffer —
 * replay re-issues references, not bodies. An evicted or never-stored body
 * is an honest 404 (`attachment_not_found`), never synthesized bytes; an
 * unknown session 404s as `session_not_found`. Not redacted (opaque bytes,
 * bounded by size instead — session-assets.ts caps).
 */
function handleSessionAttachment(
  sessionId: string,
  attachmentId: string,
  deps: GatewayServerDeps,
  requestId: string,
): Response {
  const sessions = deps.sessions;
  if (sessions === undefined) return problemResponse(404, "not_found", requestId);
  const attachment = sessions.getAttachment(sessionId, attachmentId);
  if (attachment === null) {
    const code = sessions.sessionKnown(sessionId) ? "attachment_not_found" : "session_not_found";
    return problemResponse(404, code, requestId);
  }
  return new Response(attachment.bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}

async function handleSessionEvents(
  request: Request,
  sessionId: string,
  config: GatewayConfig,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.toLowerCase().includes("text/event-stream")) {
    return problemResponse(406, "stream_not_acceptable", requestId);
  }

  const sessions = deps.sessions;
  if (sessions === undefined) return problemResponse(404, "not_found", requestId);
  const lastEventId = request.headers.get("last-event-id");
  const observation = sessions.observeSession(sessionId, lastEventId);

  const stream = new SseClientStream({
    maxFrames: config.queueMaxFrames ?? QUEUE_MAX_FRAMES,
    maxBytes: config.queueMaxBytes ?? QUEUE_MAX_BYTES,
  });

  // Intro frames first, then the live subscription — one synchronous block,
  // so no appended frame can slip between intro and subscription.
  for (const frame of observation.intro) {
    stream.write(frame, "control");
  }
  const unsubscribe: { current: (() => void) | null } = { current: null };
  const transport = sseTransport(stream, config, unsubscribe, request.signal, requestId);
  if (observation.terminalAfterIntro) {
    stream.close("session_gone");
  } else {
    unsubscribe.current = observation.listen((frame) => {
      writeSessionFrame(stream, frame, () => sessions.slowConsumerReset(sessionId));
      transport.flush();
    });
  }
  return transport.response;
}

/**
 * Per-frame write policy for a session stream (decision D4 §2 / D3): merged
 * deltas are the droppable volume axis (the final converges the buffer),
 * every other conversation frame is control; a connection reset closes after
 * flushing; a dropped delta converges via one authoritative connection-local
 * reset. Extracted so the slow-consumer path is unit-testable — the HTTP
 * transport drains eagerly, so queue overflow cannot be produced over a real
 * socket.
 */
export function writeSessionFrame(
  stream: SseClientStream,
  frame: SessionOutboundFrame,
  converge: () => SessionOutboundFrame | null,
): void {
  const kind = frame.event === "assistant_delta" ? "output" : "control";
  const outcome = stream.write(frame, kind);
  if (frame.event === "conversation_reset") stream.close("session_reset");
  if (outcome === "dropped") {
    const reset = converge();
    if (reset === null) stream.close("reset_unavailable");
    else stream.write(reset, "control");
  }
}

// ——— GET /v1/panes, GET /v1/panes/{paneId}/events (terminal mirror v1) ———

async function handlePaneRoute(
  request: Request,
  segments: string[],
  config: GatewayConfig,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  const panes = deps.panes;
  if (panes === undefined) return problemResponse(404, "not_found", requestId);
  if (segments.length === 2) {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    const inventory = await panes.listPanes();
    return jsonResponse(inventory, 200, requestId);
  }
  if (segments.length === 4 && segments[3] === "events") {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    return handlePaneEvents(
      request,
      decodePaneSegment(routeSegment(segments, 2)),
      config,
      deps,
      requestId,
    );
  }
  return problemResponse(404, "not_found", requestId);
}

function decodePaneSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ProblemError(404, "pane_not_found");
  }
}

/** 라우트 매칭이 segments 길이를 보장한 뒤 인덱스를 읽는다. 보장이 깨지면
 * 404 로 실패한다(null/undefined 가 아래로 새는 것을 막는다). */
function routeSegment(segments: string[], index: number): string {
  const segment = segments[index];
  if (segment === undefined) throw new ProblemError(404, "not_found");
  return segment;
}

async function handlePaneEvents(
  request: Request,
  paneId: string,
  config: GatewayConfig,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.toLowerCase().includes("text/event-stream")) {
    return problemResponse(406, "stream_not_acceptable", requestId);
  }

  const panes = deps.panes;
  if (panes === undefined) return problemResponse(404, "not_found", requestId);
  const lastEventId = request.headers.get("last-event-id");
  const observation = panes.observePane(paneId, lastEventId);

  const stream = new SseClientStream({
    maxFrames: config.queueMaxFrames ?? QUEUE_MAX_FRAMES,
    maxBytes: config.queueMaxBytes ?? QUEUE_MAX_BYTES,
  });

  // Intro frames first, then the live subscription — one synchronous block,
  // so no appended frame can slip between intro and subscription.
  for (const frame of observation.intro) {
    stream.write(frame, "control");
  }
  const unsubscribe: { current: (() => void) | null } = { current: null };
  const transport = sseTransport(stream, config, unsubscribe, request.signal, requestId);
  if (observation.terminalAfterIntro) {
    stream.close("pane_gone");
  } else {
    unsubscribe.current = observation.listen((frame) => {
      const outcome = stream.write(frame, frame.event === "pane_text" ? "output" : "control");
      if (frame.event === "pane_reset") stream.close("pane_reset");
      if (outcome === "dropped") {
        // Slow consumer: converge on one authoritative pane reset (D5).
        const reset = panes.slowConsumerReset(paneId);
        if (reset === null) stream.close("reset_unavailable");
        else stream.write(reset, "control");
      }
      transport.flush();
    });
  }
  return transport.response;
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

// ——— /v1/herdr (rebuild brief docs/design/rebuild-brief-herdr-first.md §4) ———
// The herdr surface speaks gateway vocabulary only: every herdr protocol
// shape was mapped inside the single socket adapter. The monitor is the one
// feed subscriber; these handlers frame HTTP/SSE around its view and the
// control port. Absent dep → 404 (fail-closed, like every optional surface).

const HERDR_READ_SOURCE_SET = new Set<string>(HERDR_READ_SOURCES);
const HERDR_READ_FORMATS = new Set(["text", "ansi"]);
const HERDR_READ_LINES_MAX = 2000;
const HERDR_PROMPT_MAX_BYTES = 64 * 1024;
const HERDR_KEYS_MAX = 8;
const HERDR_KEY_PATTERN = /^[a-z0-9]+(?:\+[a-z0-9]+)*$/i;
const HERDR_AGENT_KIND_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const HERDR_AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

function herdrStateFrame(state: ReturnType<HerdrStateMonitor["current"]>): {
  id: string;
  event: string;
  data: unknown;
} {
  return { id: `herdr-${state.version}`, event: "herdr_state", data: state };
}

async function handleHerdrRoute(
  request: Request,
  url: URL,
  segments: string[],
  config: GatewayConfig,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  const herdr = deps.herdr;
  if (herdr === undefined) return problemResponse(404, "not_found", requestId);
  const { monitor, control } = herdr;

  // GET /v1/herdr/state — the full mapped view (honest `available: false`
  // when herdr is unreachable; never an error for reachability).
  if (segments.length === 3 && segments[2] === "state") {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    return jsonResponse(monitor.current(), 200, requestId);
  }

  // GET /v1/herdr/events — SSE state feed. State frames are idempotent full
  // snapshots addressed by the monitor version, so reconnects never need a
  // cursor: the intro always carries fresh state (Last-Event-ID is ignored).
  if (segments.length === 3 && segments[2] === "events") {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    const accept = request.headers.get("accept") ?? "";
    if (!accept.toLowerCase().includes("text/event-stream")) {
      return problemResponse(406, "stream_not_acceptable", requestId);
    }
    const stream = new SseClientStream({
      maxFrames: config.queueMaxFrames ?? QUEUE_MAX_FRAMES,
      maxBytes: config.queueMaxBytes ?? QUEUE_MAX_BYTES,
    });
    stream.write(herdrStateFrame(monitor.current()), "control");
    const unsubscribe: { current: (() => void) | null } = { current: null };
    const transport = sseTransport(stream, config, unsubscribe, request.signal, requestId);
    unsubscribe.current = monitor.subscribe((state) => {
      // State frames are idempotent full snapshots; a queue overflow closes
      // the stream and the client reconnects straight into a fresh intro.
      stream.write(herdrStateFrame(state), "control");
      transport.flush();
    });
    return transport.response;
  }

  // GET /v1/herdr/panes/{paneId}/read?lines=&source=&format=
  if (segments.length === 5 && segments[2] === "panes" && segments[4] === "read") {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    const paneId = decodeHerdrSegment(routeSegment(segments, 3));
    const params = url.searchParams;
    const lines = parseBoundedInt(params.get("lines"), 400, 1, HERDR_READ_LINES_MAX);
    const source = params.get("source") ?? HERDR_DEFAULT_READ_SOURCE;
    if (!HERDR_READ_SOURCE_SET.has(source)) {
      throw invalid({ source: "source must be visible, recent, or recent_unwrapped" });
    }
    const format = params.get("format") ?? "text";
    if (!HERDR_READ_FORMATS.has(format)) {
      throw invalid({ format: "format must be text or ansi" });
    }
    const reading = await control.readPane(paneId, {
      lines,
      source: source as HerdrReadSource,
      format: format as "text" | "ansi",
    });
    if (reading === null) return problemResponse(404, "pane_not_found", requestId);
    return jsonResponse(reading, 200, requestId);
  }

  // GET /v1/herdr/panes/{paneId}/conversation — the pane's agent session as
  // structured turns (claude/codex session files) or a summary card (agy).
  // Unmapped kinds and missing sources 404: the app keeps its ANSI mirror.
  if (segments.length === 5 && segments[2] === "panes" && segments[4] === "conversation") {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    const paneId = decodeHerdrSegment(routeSegment(segments, 3));
    const pane = monitor.current().panes.find((entry) => entry.id === paneId);
    if (pane === undefined || pane.agent === null || pane.cwd === null) {
      return problemResponse(404, "conversation_unavailable", requestId);
    }
    const conversation = resolveAgentConversation(pane.agent, pane.cwd, undefined, pane.agentSession);
    if (conversation === null) return problemResponse(404, "conversation_unavailable", requestId);
    return jsonResponse({ paneId, ...conversation }, 200, requestId);
  }

  // POST /v1/herdr/panes/{paneId}/prompt — deliver text to the pane's agent.
  if (segments.length === 5 && segments[2] === "panes" && segments[4] === "prompt") {
    if (request.method !== "POST") return problemResponse(405, "method_not_allowed", requestId);
    const paneId = decodeHerdrSegment(routeSegment(segments, 3));
    const body = await readJsonBody(request);
    const text = body.text;
    if (typeof text !== "string" || text.length === 0) {
      throw invalid({ text: "text is required" });
    }
    if (Buffer.byteLength(text, "utf8") > HERDR_PROMPT_MAX_BYTES) {
      return problemResponse(413, "prompt_too_large", requestId);
    }
    const outcome = await control.promptAgent(paneId, text);
    if (outcome === "blocked") return problemResponse(409, "agent_blocked", requestId);
    if (outcome === "not_found") return problemResponse(404, "agent_not_found", requestId);
    if (outcome === "unavailable") return problemResponse(503, "herdr_unavailable", requestId);
    return jsonResponse({ paneId, accepted: true }, 202, requestId);
  }

  // POST /v1/herdr/panes/{paneId}/keys — logical keys (esc, ctrl+c, …).
  if (segments.length === 5 && segments[2] === "panes" && segments[4] === "keys") {
    if (request.method !== "POST") return problemResponse(405, "method_not_allowed", requestId);
    const paneId = decodeHerdrSegment(routeSegment(segments, 3));
    const body = await readJsonBody(request);
    const keys = body.keys;
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > HERDR_KEYS_MAX) {
      throw invalid({ keys: `keys must be 1-${HERDR_KEYS_MAX} logical key names` });
    }
    for (const key of keys) {
      if (typeof key !== "string" || !HERDR_KEY_PATTERN.test(key)) {
        throw invalid({ keys: "each key must be a logical key name like esc or ctrl+c" });
      }
    }
    const delivered = await control.sendAgentKeys(paneId, keys);
    if (!delivered) return problemResponse(503, "herdr_unavailable", requestId);
    return new Response(null, { status: 204, headers: { "X-Request-Id": requestId } });
  }

  // POST /v1/herdr/panes/{paneId}/focus — foreground the pane on the desktop.
  if (segments.length === 5 && segments[2] === "panes" && segments[4] === "focus") {
    if (request.method !== "POST") return problemResponse(405, "method_not_allowed", requestId);
    const paneId = decodeHerdrSegment(routeSegment(segments, 3));
    const focused = await control.focusPane(paneId);
    if (!focused) return problemResponse(503, "herdr_unavailable", requestId);
    return new Response(null, { status: 204, headers: { "X-Request-Id": requestId } });
  }

  // POST /v1/herdr/agents/start — resolve a target tab, find or split a
  // shell pane, and start the requested agent kind there.
  if (segments.length === 4 && segments[2] === "agents" && segments[3] === "start") {
    if (request.method !== "POST") return problemResponse(405, "method_not_allowed", requestId);
    const body = await readJsonBody(request);
    const kind = body.kind;
    if (typeof kind !== "string" || !HERDR_AGENT_KIND_PATTERN.test(kind)) {
      throw invalid({ kind: "kind must be a supported agent kind name" });
    }
    if (body.name !== undefined && body.name !== null) {
      if (typeof body.name !== "string" || !HERDR_AGENT_NAME_PATTERN.test(body.name)) {
        throw invalid({ name: "name must match [a-z][a-z0-9_-]{0,31}" });
      }
    }
    if (
      body.workspaceId !== undefined &&
      body.workspaceId !== null &&
      typeof body.workspaceId !== "string"
    ) {
      throw invalid({ workspaceId: "workspaceId must be a string" });
    }
    if (body.tabId !== undefined && body.tabId !== null && typeof body.tabId !== "string") {
      throw invalid({ tabId: "tabId must be a string" });
    }
    if (body.cwd !== undefined && body.cwd !== null && typeof body.cwd !== "string") {
      throw invalid({ cwd: "cwd must be a string" });
    }
    const started = await startHerdrAgent(monitor, control, {
      kind,
      name: typeof body.name === "string" ? body.name : null,
      workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : null,
      tabId: typeof body.tabId === "string" ? body.tabId : null,
      cwd: typeof body.cwd === "string" ? body.cwd : null,
      createWorkspace: body.createWorkspace === true,
    });
    if (started === null) return problemResponse(503, "herdr_unavailable", requestId);
    if (started.kind === "rejected") {
      return problemResponse(409, "agent_start_rejected", requestId, {
        code: started.code ?? "unknown",
      });
    }
    return jsonResponse(started.value, 201, requestId);
  }

  // POST /v1/herdr/workspaces — create a workspace (root tab + pane).
  if (segments.length === 3 && segments[2] === "workspaces") {
    if (request.method !== "POST") return problemResponse(405, "method_not_allowed", requestId);
    const body = await readJsonBody(request);
    if (body.label !== undefined && body.label !== null && typeof body.label !== "string") {
      throw invalid({ label: "label must be a string" });
    }
    if (body.cwd !== undefined && body.cwd !== null && typeof body.cwd !== "string") {
      throw invalid({ cwd: "cwd must be a string" });
    }
    const created = await control.createWorkspace(
      typeof body.label === "string" && body.label.length > 0 ? body.label : null,
      typeof body.cwd === "string" && body.cwd.length > 0 ? body.cwd : null,
    );
    if (created === null) return problemResponse(503, "herdr_unavailable", requestId);
    return jsonResponse(created, 201, requestId);
  }

  // GET /v1/herdr/integrations — installed agent kinds for the picker.
  if (segments.length === 3 && segments[2] === "integrations") {
    if (request.method !== "GET") return problemResponse(405, "method_not_allowed", requestId);
    const integrations = await control.listIntegrations();
    if (integrations === null) return problemResponse(503, "herdr_unavailable", requestId);
    return jsonResponse({ integrations }, 200, requestId);
  }

  return problemResponse(404, "not_found", requestId);
}

type HerdrStartSuccess = {
  paneId: string;
  name: string | null;
  kind: string;
  ready: boolean;
  createdPane: boolean;
  workspaceId: string | null;
  tabId: string | null;
};

/** Start orchestration (rebuild brief §4): resolve the target tab from the
 * explicit ids or the focused workspace, start in an available shell pane,
 * and fall back to a split when the tab has none. Returns null when herdr is
 * unreachable or the state view is not available yet. */
async function startHerdrAgent(
  monitor: HerdrStateMonitor,
  control: HerdrControlClient,
  spec: {
    kind: string;
    name: string | null;
    workspaceId: string | null;
    tabId: string | null;
    cwd: string | null;
    createWorkspace: boolean;
  },
): Promise<
  | { kind: "started"; value: HerdrStartSuccess }
  | { kind: "rejected"; code: string | null; message: string | null }
  | null
> {
  let state = monitor.current();
  if (!state.available) return null;

  // 0) Explicit "new workspace" request: create it and start in its root.
  if (spec.createWorkspace && spec.tabId === null) {
    const created = await control.createWorkspace(null, spec.cwd);
    if (created === null) return null;
    return await startInPane(
      control,
      created.rootPaneId,
      created.workspaceId,
      created.tabId,
      spec,
      false,
    );
  }

  // 1) Resolve the target tab. An explicit id the view has not seen yet (just
  // created through another connection) re-hydrates the view once before the
  // honest 404.
  if (
    (spec.tabId !== null && !state.tabs.some((tab) => tab.id === spec.tabId)) ||
    (spec.tabId === null &&
      spec.workspaceId !== null &&
      !state.workspaces.some((workspace) => workspace.id === spec.workspaceId))
  ) {
    state = await monitor.refresh();
  }
  let workspaceId: string | null = spec.workspaceId;
  let tabId: string | null = spec.tabId;
  if (tabId !== null && !state.tabs.some((tab) => tab.id === tabId)) {
    throw new ProblemError(404, "not_found");
  }
  if (tabId !== null) {
    const tab = state.tabs.find((entry) => entry.id === tabId);
    workspaceId = tab?.workspaceId ?? workspaceId;
  } else if (workspaceId !== null) {
    if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) {
      throw new ProblemError(404, "not_found");
    }
    tabId =
      state.workspaces.find((workspace) => workspace.id === workspaceId)?.activeTabId ??
      state.tabs.find((tab) => tab.workspaceId === workspaceId)?.id ??
      null;
  } else {
    workspaceId = state.focused.workspaceId ?? state.workspaces[0]?.id ?? null;
    if (workspaceId === null) {
      // No workspace exists: create one and start in its root pane.
      const created = await control.createWorkspace(null, spec.cwd);
      if (created === null) return null;
      return await startInPane(
        control,
        created.rootPaneId,
        created.workspaceId,
        created.tabId,
        spec,
        false,
      );
    }
    tabId =
      state.workspaces.find((workspace) => workspace.id === workspaceId)?.activeTabId ??
      state.tabs.find((tab) => tab.workspaceId === workspaceId)?.id ??
      null;
  }
  if (tabId === null) return null;

  // 2) Find a candidate shell pane (no agent detected/managed in it). herdr
  // has the final say on availability — a rejected candidate falls back to
  // one split from the candidate before the rejection surfaces.
  const tabPanes = state.panes.filter((pane) => pane.tabId === tabId);
  const candidate = tabPanes.find((pane) => pane.agent === null) ?? null;
  if (candidate !== null) {
    const outcome = await startInPane(control, candidate.id, workspaceId, tabId, spec, false);
    if (outcome.kind !== "rejected") return outcome;
  }

  // 3) Fall back: split the first pane of the tab and start there.
  const anchor = tabPanes[tabPanes.length - 1] ?? null;
  if (anchor === null) return null;
  const splitPaneId = await control.splitPane(anchor.id, {
    direction: "right",
    cwd: spec.cwd ?? anchor.cwd,
  });
  if (splitPaneId === null) return null;
  return await startInPane(control, splitPaneId, workspaceId, tabId, spec, true);
}

async function startInPane(
  control: HerdrControlClient,
  paneId: string,
  workspaceId: string | null,
  tabId: string | null,
  spec: { kind: string; name: string | null; cwd: string | null },
  createdPane: boolean,
): Promise<
  | { kind: "started"; value: HerdrStartSuccess }
  | { kind: "rejected"; code: string | null; message: string | null }
> {
  const startSpec: HerdrAgentStartSpec = {
    kind: spec.kind,
    paneId,
    name: spec.name,
    timeoutMs: 30_000,
  };
  const outcome = await control.startAgent(startSpec);
  if (!outcome.ok) {
    return { kind: "rejected", code: outcome.code, message: outcome.message };
  }
  return {
    kind: "started",
    value: {
      paneId: outcome.paneId,
      name: outcome.name,
      kind: spec.kind,
      ready: outcome.ready,
      createdPane,
      workspaceId,
      tabId,
    },
  };
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw invalid({ "content-type": "application/json is required" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    throw invalid({ body: "must be valid JSON" });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalid({ body: "must be a JSON object" });
  }
  return parsed as Record<string, unknown>;
}

function parseBoundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw.length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function decodeHerdrSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ProblemError(404, "pane_not_found");
  }
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ProblemError(404, "run_not_found");
  }
}
/** Reflect a syntactically valid request id or mint one (ADR §4.1). */
function requestIdOf(request: Request): string {
  const presented = request.headers.get("x-request-id");
  if (
    presented !== null &&
    presented.length >= 1 &&
    presented.length <= 128 &&
    !/[\r\n\0]/.test(presented)
  ) {
    return presented;
  }
  return `req_${crypto.randomUUID()}`;
}

function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": requestId,
    },
  });
}

function invalid(fields: Record<string, string>): ProblemError {
  return new ProblemError(400, "invalid_request", fields);
}

// ——— POST /v1/runs/{runId}/steer (decision 2026-xx-gui-conversation D3) ———

async function handleSteer(
  request: Request,
  runId: string,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  if (deps.steer === undefined) return problemResponse(404, "not_found", requestId);
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw invalid({ "content-type": "application/json is required" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    throw invalid({ body: "must be valid JSON" });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalid({ body: "must be a JSON object" });
  }
  const message = (parsed as { message?: unknown }).message;
  // Same validation precedent as handleSubmit (D3): non-empty, byte-capped,
  // no idempotency requirement — identical to the existing steer surface.
  if (typeof message !== "string") throw invalid({ message: "must be a string" });
  if (Buffer.byteLength(message, "utf8") > MAX_PROMPT_BYTES) {
    throw new ProblemError(413, "prompt_too_large");
  }
  if (message.trim().length === 0) throw invalid({ message: "must not be empty" });

  await deps.steer.steer(runId, message);
  const steerId = `steer_${crypto.randomUUID()}`;
  // Honest mirror (D4 §4): zero is the correct outcome when no live session
  // is correlated to the run — the frame is never synthesized elsewhere.
  const mirrored = deps.sessions?.mirrorSteerQueued({ runId, steerId, text: message }) ?? 0;
  return jsonResponse({ steerId, mirrored }, 202, requestId);
}

// ——— POST /v1/runs/{runId}/attention/resolve ———

async function handleResolveAttention(
  request: Request,
  runId: string,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  const port = deps.resolveAttention;
  if (port === undefined) return problemResponse(404, "not_found", requestId);
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw invalid({ "content-type": "application/json is required" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    throw invalid({ body: "must be valid JSON" });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalid({ body: "must be a JSON object" });
  }
  const body = parsed as { attentionId?: unknown; resolution?: unknown };
  if (typeof body.attentionId !== "string" || body.attentionId.trim() === "") {
    throw invalid({ attentionId: "must be a non-empty string" });
  }
  if (typeof body.resolution !== "string" || body.resolution.trim() === "") {
    throw invalid({ resolution: "must be a non-empty string" });
  }
  await port.resolve(runId, body.attentionId, body.resolution);
  return jsonResponse({ runId, attentionId: body.attentionId, resolved: true }, 200, requestId);
}

// ——— POST /v1/sessions/{sessionId}/attachments (decision 2026-xx-gui-conversation D5, app upload) ———

/**
 * App-side attachment upload (D5): the composer stores the image BEFORE the
 * input that references it; the 201 body is the reference-shaped
 * `RemoteSessionAssetRef` and the input endpoint carries only that ref.
 * Deterministic error mapping: unknown session 404 `session_not_found`,
 * non-allow-listed type 400 `invalid_media_type`, oversized or
 * budget-exhausted body 413 `attachment_too_large` (problem+json).
 */
async function handleAttachmentUpload(
  request: Request,
  sessionId: string,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  const sessions = deps.sessions;
  if (sessions === undefined) return problemResponse(404, "not_found", requestId);
  // The declared type is what the store serves as Content-Type and what pi
  // forwards to the provider: allow-list it exactly (parameters tolerated,
  // junk types never reach the store).
  const mediaType =
    (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!isUploadableImageType(mediaType)) throw new ProblemError(400, "invalid_media_type");
  const bytes = await readBoundedBody(request, MAX_ATTACHMENT_BODY_BYTES);
  if (bytes === null) throw new ProblemError(413, "attachment_too_large");
  const ref = sessions.storeUploadedAttachment(sessionId, mediaType, bytes);
  return jsonResponse(ref, 201, requestId);
}

// ——— POST /v1/sessions/{sessionId}/input (decision D5, downstream delivery) ———

/**
 * App-submitted input for a live session (D5): text plus stored attachment
 * refs. The collector validates refs against stored bodies and delivers the
 * `deliver_input` line (text + base64 bodies) to the session's tap over the
 * control socket; the tap feeds pi `sendUserMessage` and the OBSERVED
 * `user_message` frame — not a synthesized one — lands on the stream.
 * Errors: unknown session 404, no live tap 409 `session_not_live`, empty
 * text+refs 400, oversized text 413 `prompt_too_large`, unresolved ref 404
 * `attachment_not_found` (problem+json, all deterministic).
 */
async function handleSessionInput(
  request: Request,
  sessionId: string,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  const sessions = deps.sessions;
  if (sessions === undefined) return problemResponse(404, "not_found", requestId);
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw invalid({ "content-type": "application/json is required" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    throw invalid({ body: "must be valid JSON" });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalid({ body: "must be a JSON object" });
  }
  const body = parsed as { text?: unknown; attachments?: unknown };
  if (typeof body.text !== "string") throw invalid({ text: "must be a string" });
  let attachments: { attachmentId: string }[] = [];
  if (body.attachments !== undefined && body.attachments !== null) {
    if (!Array.isArray(body.attachments)) throw invalid({ attachments: "must be an array" });
    attachments = body.attachments.map((entry) => {
      if (typeof entry !== "object" || entry === null)
        throw invalid({ attachments: "must be objects" });
      const attachmentId = (entry as { attachmentId?: unknown }).attachmentId;
      if (typeof attachmentId !== "string" || attachmentId.length === 0) {
        throw invalid({ attachments: "attachmentId must be a non-empty string" });
      }
      return { attachmentId };
    });
  }
  if (Buffer.byteLength(body.text, "utf8") > MAX_PROMPT_BYTES) {
    throw new ProblemError(413, "prompt_too_large");
  }
  const { inputId } = sessions.submitInput(sessionId, { text: body.text, attachments });
  return jsonResponse({ inputId }, 202, requestId);
}

// ——— POST /v1/sessions/spawn (decision 2026-xx-session-spawn §D-C) ———

/**
 * Remote spawn of a NEW host-side pi TUI (tmux new-window first-class):
 * the spawner port owns every policy decision (gate, cwd, tmux probing) and
 * throws ProblemError for mapped failures, which the shared fetch pipeline
 * renders as problem+json — same contract as steer. An empty request body
 * is a valid spawn with the configured default cwd. 201 carries the tmux
 * target; the real sessionId appears later via the tap registration (the
 * response never invents one).
 */
async function handleSpawn(
  request: Request,
  deps: GatewayServerDeps,
  authMode: GatewayAuthMode,
  requestId: string,
): Promise<Response> {
  if (deps.spawn === undefined) return problemResponse(404, "not_found", requestId);
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw invalid({ "content-type": "application/json is required" });
  }
  const rawBody = (await request.text()).trim();
  let parsed: unknown = {};
  if (rawBody.length > 0) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw invalid({ body: "must be valid JSON" });
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalid({ body: "must be a JSON object" });
  }
  const cwd = (parsed as { cwd?: unknown }).cwd;
  if (cwd !== undefined && typeof cwd !== "string") throw invalid({ cwd: "must be a string" });
  if (typeof cwd === "string" && cwd.trim().length === 0)
    throw invalid({ cwd: "must not be empty" });
  const outcome = await deps.spawn.spawn(cwd === undefined ? {} : { cwd }, { listener: authMode });
  return jsonResponse(outcome, 201, requestId);
}

/** Bounded body read (D5 uploads): never buffers more than `cap` bytes.
 * Returns null when the body exceeds the cap (declared or actual) — the
 * caller answers 413 without having held the bytes. */
async function readBoundedBody(request: Request, cap: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isInteger(declared) && declared >= 0 && declared > cap) return null;
  const body = request.body;
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      try {
        await reader.cancel();
      } catch {
        /* the client is already gone or the stream is closed — either way
         * the outcome below is the only honest answer */
      }
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

// ——— POST /v1/runs ———

async function handleSubmit(
  request: Request,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw invalid({ "content-type": "application/json is required" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    throw invalid({ body: "must be valid JSON" });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw invalid({ body: "must be a JSON object" });
  }
  const body = parsed as { prompt?: unknown; clientContext?: unknown };

  if (typeof body.prompt !== "string") throw invalid({ prompt: "must be a string" });
  if (Buffer.byteLength(body.prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new ProblemError(413, "prompt_too_large");
  }
  if (body.prompt.trim().length === 0) throw invalid({ prompt: "must not be empty" });

  const clientContext = validateClientContext(body.clientContext);
  const run = deps.service.submit(body.prompt, clientContext);
  return jsonResponse({ run }, 202, requestId);
}

function validateClientContext(value: unknown): { displayName?: string } | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw invalid({ clientContext: "must be an object" });
  }
  const displayName = (value as { displayName?: unknown }).displayName;
  if (displayName === undefined || displayName === null) return {};
  if (typeof displayName !== "string") throw invalid({ displayName: "must be a string" });
  const trimmed = displayName.trim();
  if (trimmed.length === 0) throw invalid({ displayName: "must not be empty" });
  if (graphemeCount(trimmed) > MAX_DISPLAY_NAME_GRAPHEMES) {
    throw invalid({ displayName: `must be at most ${MAX_DISPLAY_NAME_GRAPHEMES} graphemes` });
  }
  return { displayName: trimmed };
}

function graphemeCount(text: string): number {
  try {
    const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
    let count = 0;
    for (const _ of segmenter.segment(text)) count += 1;
    return count;
  } catch {
    return [...text].length; // environments without Intl.Segmenter
  }
}

// ——— GET /v1/runs ———

async function handleList(url: URL, deps: GatewayServerDeps, requestId: string): Promise<Response> {
  const rawLimit = url.searchParams.get("limit");
  let limit = 20;
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) throw invalid({ limit: "must be a positive integer" });
    limit = Number.parseInt(rawLimit, 10);
    if (limit < 1 || limit > 100) throw invalid({ limit: "must be between 1 and 100" });
  }
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === null ? null : decodeListCursor(rawCursor);
  if (rawCursor !== null && cursor === null) throw new ProblemError(400, "invalid_cursor");

  const page: RemoteRunPage = await deps.service.listRuns({ limit, cursor });
  return jsonResponse(page, 200, requestId);
}

// ——— GET /v1/runs/{runId} ———

async function handleGet(
  runId: string,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  const run: RemoteRun = await deps.service.getRun(runId);
  return jsonResponse(run, 200, requestId);
}

// ——— GET /v1/runs/{runId}/events ———

async function handleEvents(
  request: Request,
  runId: string,
  config: GatewayConfig,
  deps: GatewayServerDeps,
  requestId: string,
): Promise<Response> {
  const accept = request.headers.get("accept") ?? "";
  if (!accept.toLowerCase().includes("text/event-stream")) {
    return problemResponse(406, "stream_not_acceptable", requestId);
  }

  const lastEventId = request.headers.get("last-event-id");
  const observation = await deps.service.observeRun(runId, lastEventId);

  const stream = new SseClientStream({
    maxFrames: config.queueMaxFrames ?? QUEUE_MAX_FRAMES,
    maxBytes: config.queueMaxBytes ?? QUEUE_MAX_BYTES,
  });

  // Intro frames first, then the live subscription — all in one synchronous
  // block, so no appended frame can slip between intro and subscription.
  for (const frame of observation.intro) {
    stream.write(frame, "control");
  }
  const unsubscribe: { current: (() => void) | null } = { current: null };
  const transport = sseTransport(stream, config, unsubscribe, request.signal, requestId);
  if (observation.terminalAfterIntro) {
    stream.close("terminal");
  } else {
    unsubscribe.current = observation.listen((frame: OutboundFrame) => {
      const outcome = stream.write(frame, frame.event === "output" ? "output" : "control");
      if (frame.event === "terminal") stream.close("terminal");
      if (outcome === "dropped") {
        // Slow consumer: converge on one authoritative reset (ADR §4.5).
        const reset = deps.service.slowConsumerReset(runId);
        if (reset === null) stream.close("reset_unavailable");
        else stream.write(reset, "control");
      }
      transport.flush();
    });
  }
  return transport.response;
}

/**
 * Shared SSE transport (run + pane families): one per-connection outbound
 * queue drained into a ReadableStream, comment keepalives, and abort/cancel
 * cleanup. The caller primes `stream` with intro frames, then registers the
 * live subscription into `unsubscribe.current` and uses `flush()` after each
 * enqueue — all synchronous, so no frame can slip between intro and live.
 */
function sseTransport(
  stream: SseClientStream,
  config: GatewayConfig,
  unsubscribe: { current: (() => void) | null },
  signal: AbortSignal | null,
  requestId: string,
): { response: Response; flush(): void } {
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let controllerClosed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  const pump = (target: ReadableStreamDefaultController<Uint8Array> | null = controllerRef) => {
    // A heartbeat flush can race the close: once the controller is closed
    // (terminal/reset EOF), every later flush is a no-op.
    if (target === null || controllerClosed) return;
    for (;;) {
      const chunk = stream.read();
      if (chunk === null) {
        if (stream.closed) {
          controllerClosed = true;
          try {
            target.close(); // terminal/abort: flush then end
          } catch {
            // The runtime invalidated the controller first (client socket
            // teardown). The connection is gone either way; the subscription
            // is cleaned up by cancel/abort below. Never crash the gateway
            // for a transport race (v7 showcase evidence §5 D-d).
          }
        }
        return;
      }
      try {
        target.enqueue(encoder.encode(chunk));
      } catch {
        // Client disconnected mid-stream: the controller is closed/errored
        // before our cancel/abort callbacks ran. Tear the connection down
        // deterministically instead of letting the throw escape the SSE
        // pump and kill the process (launchd KeepAlive would mask it).
        controllerClosed = true;
        cleanup();
        stream.close("client_disconnected");
        return;
      }
    }
  };

  /** Drain the queue into the transport; called after every enqueue path. */
  const flush = () => {
    pump();
  };

  const readable = new ReadableStream<Uint8Array>({
    start(target) {
      controllerRef = target;
      heartbeat = setInterval(() => {
        stream.keepalive();
        flush();
      }, config.heartbeatMs ?? HEARTBEAT_MS);
      heartbeat.unref?.();
      // Immediate comment chunk so the response head flushes even when the
      // intro is empty (e.g. replay from the head cursor on a quiet pane).
      stream.keepalive();
      pump(target);
    },
    pull(target) {
      controllerRef = target;
      pump(target);
    },
    cancel() {
      controllerClosed = true;
      cleanup();
    },
  });
  signal?.addEventListener("abort", () => {
    controllerClosed = true;
    cleanup();
    stream.close("client_disconnected");
  });

  return {
    response: new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Request-Id": requestId,
      },
    }),
    flush,
  };
}
