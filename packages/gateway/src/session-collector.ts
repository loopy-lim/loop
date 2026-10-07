/**
 * SessionCollector — the gateway-side conversation engine (decision
 * 2026-xx-gui-conversation D1/D3) and the session SSE surface's state owner.
 *
 * The in-session pi extension tap connects to the collector (unix socket,
 * fail-observer) and streams NDJSON lines: one `register` line, then
 * observation lines. This module is the ONLY place tap-protocol knowledge
 * lives (the pi-loop adapter owns the sending side); everything above it —
 * the SSE surface and the app — speaks the Rustra-generated conversation
 * frames exclusively.
 *
 * Duties (all decision-anchored):
 * - Correlation: the tap forwards the worker's `LOOP_RUN_ID`/`LOOP_TASK_ID`
 *   env markers on `register`; marker-less sessions report null run/task
 *   honestly in the inventory (D1).
 * - Delta merge (D4 §2): `assistant_update` lines carry the full message
 *   snapshot; merged on a ≥250 ms cadence into bounded
 *   `ConversationAssistantDelta` frames (suffix deltas, latest snapshot
 *   wins). `assistant_message` is the authoritative final that replaces the
 *   buffer — dropped or duplicated deltas always converge.
 * - Redaction + bounds (D4 §8, D2): every text field passes
 *   `redactProviderText` (`[credential]=[redacted]`) and the per-frame UTF-8
 *   byte cap (`*_truncated` on the frames that carry the flag).
 * - Reset convergence (D3): `session_shutdown` → shared-recorded
 *   `conversation_reset(sessionGone)`; unusable cursors and slow consumers
 *   converge via connection-local resets exactly like the run/pane families.
 * - Steer mirror (D4 §4): an accepted steer against a run is mirrored once
 *   as `steer_queued` on every live session correlated to that run.
 *
 * Observation failures are isolated: a malformed or unknown ingress line is
 * dropped without state changes, and collector problems never touch the run
 * machinery (fail-observer, like the pane mirror's fail-closed axis).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { redactProviderText } from "@loop/providers";
import type {
  ConversationLifecyclePhase,
  ConversationUserMessageSource,
  RemoteSessionState,
  RemoteSessionSummary,
  RemoteSessionAssetRef,
  RustraEventPayloads,
} from "@loop/protocol";

import { MAX_PROMPT_BYTES } from "./wire";

import { ProblemError } from "./problem";
import {
  isUploadableImageType,
  isValidMimeType,
  MAX_ATTACHMENT_BODY_BYTES,
  MAX_ATTACHMENT_REF_BYTES,
  SessionAssetStore,
  type StoredAttachment,
} from "./session-assets";
import type {
  ConversationFrameName,
  SessionEventLog,
  SessionOutboundFrame,
} from "./session-events";
import { truncateUtf8 } from "./projection";

/** Generated conversation frame payloads (Rust-owned:
 * crates/loop-bridge/src/conversation.rs, schema-anchored as `loop.*`
 * events). The gateway never re-declares these shapes. */
export type UserMessagePayload = RustraEventPayloads["loop.user_message"];
export type AssistantDeltaPayload = RustraEventPayloads["loop.assistant_delta"];
export type AssistantMessagePayload = RustraEventPayloads["loop.assistant_message"];
export type ToolCallStartedPayload = RustraEventPayloads["loop.tool_call_started"];
export type ToolCallEndedPayload = RustraEventPayloads["loop.tool_call_ended"];
export type LifecyclePayload = RustraEventPayloads["loop.lifecycle"];
export type SteerQueuedPayload = RustraEventPayloads["loop.steer_queued"];
export type ConversationResetPayload = RustraEventPayloads["loop.conversation_reset"];
export type SessionListOutput = RustraEventPayloads["loop.session_list"];

// ——— Tap ingress seam (NDJSON line vocabulary; adapter-local, pi-loop owns the sender) ———

export type TapRegisterLine = {
  type: "register";
  sessionId: string;
  /** Env-marker correlation forwarded by the tap; null when absent (D1). */
  runId?: string | null;
  taskId?: string | null;
  workerId?: string | null;
  /** Adapter-reported lane label; defaults to "pi" (the only v1 source). */
  lane?: string;
  title?: string | null;
};

/** Full message snapshot so far (NOT a token): latest wins, loss converges. */
export type TapAssistantUpdateLine = {
  type: "assistant_update";
  messageId: string;
  text: string;
  occurredAt?: string;
};

type TapCommon = { occurredAt?: string };

/** Reference-shaped attachment metadata on a `user_message` line (D5).
 * `byteLen` is optional tap-declared render metadata; when a body is stored,
 * the decoded length is authoritative instead. */
export type TapAttachmentRef = { attachmentId: string; mimeType: string; byteLen?: number };

/** One attachment body, sent by the tap BEFORE the `user_message` line that
 * references it (documented ordering — refs then resolve to stored bytes).
 * `dataBase64` is standard base64; the decoded size is what the ref's
 * `byteLen` reports once stored. Bodies are bounded, not redacted (D5). */
export type TapAttachmentBodyLine = {
  type: "attachment";
  attachmentId: string;
  mimeType: string;
  dataBase64: string;
} & TapCommon;

export type TapLine =
  | TapRegisterLine
  | ({
      type: "user_message";
      messageId: string;
      text: string;
      source?: string;
      imageCount?: number;
      attachments?: TapAttachmentRef[];
    } & TapCommon)
  | TapAssistantUpdateLine
  | ({ type: "assistant_message"; messageId: string; text: string } & TapCommon)
  | ({
      type: "tool_call_started";
      toolCallId: string;
      toolName: string;
      argsJson: string;
    } & TapCommon)
  | ({
      type: "tool_call_ended";
      toolCallId: string;
      resultText: string;
      isError?: boolean;
    } & TapCommon)
  | ({ type: "lifecycle"; phase: string } & TapCommon)
  | TapAttachmentBodyLine
  | { type: "session_shutdown" };

/** Downstream (collector → tap) delivery line, one per accepted app input
 * (D5). The tap feeds it to `pi.sendUserMessage` — text block first, then
 * image blocks (`{ type: "image", data, mimeType }` from the base64) — so
 * the model sees `InputEvent.images`. Bodies ride ONLY this control channel;
 * they never enter the frame log, and delivery is fire-and-forget (the
 * honest session evidence is the tap's observed `user_message` frame). */
export type DeliverInputLine = {
  type: "deliver_input";
  inputId: string;
  text: string;
  attachments: { attachmentId: string; mimeType: string; dataBase64: string }[];
  occurredAt: string;
};

/** Wire vocabularies validated against the generated unions. */
const USER_SOURCES: readonly ConversationUserMessageSource[] = ["interactive", "steer", "api"];
const LIFECYCLE_PHASES: readonly ConversationLifecyclePhase[] = [
  "sessionStarted",
  "turnStarted",
  "turnEnded",
  "sessionEnded",
];

// ——— Ingress guard rails (bounded ingress; text is re-bounded per frame below) ———

const MAX_INGRESS_LINE_BYTES = 1024 * 1024;
/** Pre-decode bound for a base64 attachment body line: 4/3 expansion over
 * the per-asset cap, plus slack — an oversized body never decodes. */
const MAX_ATTACHMENT_BODY_LINE_BYTES = Math.ceil((MAX_ATTACHMENT_BODY_BYTES * 4) / 3) + 4096;
const MAX_ID_LENGTH = 128;
const MAX_LABEL_LENGTH = 200;
const MAX_OPEN_MERGES_PER_SESSION = 32;
const MAX_FINALIZED_MESSAGES_PER_SESSION = 256;
/** Reference cap per `user_message` frame (D5 quantification): extra valid
 * refs beyond the cap are dropped honestly (the observed `imageCount` stays
 * the full observed number; the refs list what the gateway serves). */
const MAX_ATTACHMENTS_PER_MESSAGE = 8;

export type SessionCollectorOptions = {
  log: SessionEventLog;
  nowMs?: () => number;
  /** Redaction gate override (tests); default `redactProviderText` (D4 §8). */
  redact?: (text: string, limit: number) => string;
  /** Per-frame UTF-8 byte cap before truncation (D2; pane-family bound). */
  maxFrameBytes?: number;
  /** Minimum merge interval in ms (D4 §2; BoundedPaneSender axis). */
  mergeFlushMs?: number;
  /**
   * Merge pump interval in ms. 0 disables the timer (tests drive
   * `tickMerge()` manually); the default pumps in production.
   */
  mergeTickMs?: number;
  /** Unix socket path for the tap ingress; absent → pure core only (tests
   * drive `ingestLine` directly, or the server has no session surface). */
  socketPath?: string;
  /** Attachment body caps (D5 quantification; see session-assets.ts).
   * Overrides exist for deterministic tests. */
  assets?: {
    maxBodyBytes?: number;
    maxPerSession?: number;
    maxTotalBytesPerSession?: number;
  };
};

type SessionRecord = {
  runId: string | null;
  taskId: string | null;
  workerId: string | null;
  lane: string;
  title: string | null;
  state: RemoteSessionState;
};

type TapConnection = { sessionId: string | null; write: ((line: string) => void) | null };

type MergeState = {
  /** Already-emitted prefix of the pending snapshot (suffix deltas). */
  emittedPrefix: string;
  /** Latest full snapshot from the tap; null when nothing is pending. */
  pending: string | null;
  /** Earliest merge time; null when idle. */
  dueAtMs: number | null;
};

export class SessionCollector {
  readonly #log: SessionEventLog;
  readonly #nowMs: () => number;
  readonly #redact: (text: string, limit: number) => string;
  readonly #maxFrameBytes: number;
  readonly #mergeFlushMs: number;
  readonly #socketPath: string | null;
  readonly #mergeTickMs: number;
  readonly #assets: SessionAssetStore;
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #connections = new Map<string, TapConnection>();
  readonly #merges = new Map<string, Map<string, MergeState>>();
  readonly #finalized = new Map<string, Set<string>>();
  #listener: Bun.TCPSocketListener<SocketData> | Bun.UnixSocketListener<SocketData> | null = null;
  #mergeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionCollectorOptions) {
    this.#log = options.log;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#redact = options.redact ?? redactProviderText;
    this.#maxFrameBytes = options.maxFrameBytes ?? 16 * 1024;
    this.#mergeFlushMs = options.mergeFlushMs ?? 250;
    this.#mergeTickMs = options.mergeTickMs ?? 50;
    this.#socketPath = options.socketPath ?? null;
    this.#assets = new SessionAssetStore(options.assets);
  }

  /**
   * Bind the tap ingress socket and start the merge pump. Bind failure
   * propagates to the composition root, which degrades to no session surface
   * (fail-observer: the conversation view is optional; runs are unaffected).
   */
  start(): void {
    if (this.#mergeTimer === null && this.#mergeTickMs > 0) {
      this.#mergeTimer = setInterval(() => this.tickMerge(), this.#mergeTickMs);
      this.#mergeTimer.unref?.();
    }
    if (this.#socketPath === null || this.#listener !== null) return;
    // Never remove a socket belonging to another gateway. A stale socket
    // requires explicit operator cleanup rather than silently stealing ingress.
    if (existsSync(this.#socketPath)) {
      throw new Error(`Session socket already exists: ${this.#socketPath}`);
    }
    this.#listener = Bun.listen<SocketData>({
      unix: this.#socketPath,
      socket: {
        open: (socket) => {
          const connectionId = `tap_${crypto.randomUUID()}`;
          socket.data = { connectionId, buffer: "" };
          this.openConnection(connectionId, (line) => {
            try {
              socket.write(`${line}\n`);
            } catch {
              // A tap dying mid-write is the tap disconnect path's problem
              // (its error/end handler tears the connection down); never let
              // it crash the collector (fail-observer).
            }
          });
        },
        data: (socket, chunk) => {
          socket.data.buffer += chunk;
          for (;;) {
            const newline = socket.data.buffer.indexOf("\n");
            if (newline === -1) {
              // Unbounded line guard: drop and resync at the next newline.
              if (Buffer.byteLength(socket.data.buffer, "utf8") > MAX_INGRESS_LINE_BYTES) {
                socket.data.buffer = "";
              }
              break;
            }
            const line = socket.data.buffer.slice(0, newline);
            socket.data.buffer = socket.data.buffer.slice(newline + 1);
            this.ingestLine(socket.data.connectionId, line);
          }
        },
        end: (socket) => {
          this.#tapDisconnected(socket.data?.connectionId);
          try {
            socket.end();
          } catch {
            /* already gone */
          }
        },
        error: (socket) => {
          this.#tapDisconnected(socket.data?.connectionId);
          try {
            socket.end();
          } catch {
            /* already gone */
          }
        },
      },
    });
  }

  stop(): void {
    if (this.#mergeTimer !== null) {
      clearInterval(this.#mergeTimer);
      this.#mergeTimer = null;
    }
    if (this.#listener !== null) {
      this.#listener.stop(true);
      this.#listener = null;
    }
  }

  get socketPath(): string | null {
    return this.#socketPath;
  }

  // ——— Ingress core (pure; the socket wrapper and tests feed lines here) ———

  /** Register a tap connection (the socket open handler; tests use the same
   * seam for the pure core). `write` is the downstream channel — the socket
   * wrapper supplies the real socket writer, tests supply a capture. Null
   * (observation-only taps) can still mirror frames upstream but never
   * receives input deliveries, so a delivery to such a session answers 409
   * `session_not_live` honestly. */
  openConnection(connectionId: string, write?: (line: string) => void): void {
    this.#connections.set(connectionId, { sessionId: null, write: write ?? null });
  }

  /** One NDJSON ingress line from tap connection `connectionId`. Malformed,
   * unknown, or premature lines are dropped silently (fail-observer). */
  ingestLine(connectionId: string, line: string): void {
    if (line.length === 0) return;
    if (Buffer.byteLength(line, "utf8") > MAX_INGRESS_LINE_BYTES) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    const message = parsed as TapLine & Record<string, unknown>;
    if (typeof message.type !== "string") return;

    if (message.type === "register") {
      this.#register(connectionId, message);
      return;
    }

    const connection = this.#connections.get(connectionId);
    const sessionId = connection?.sessionId;
    if (sessionId === null || sessionId === undefined) return; // unregistered connection
    if (this.#log.isGone(sessionId)) return; // ended sessions stay closed

    switch (message.type) {
      case "user_message":
        this.#userMessage(sessionId, message);
        return;
      case "assistant_update":
        this.#assistantUpdate(sessionId, message);
        return;
      case "assistant_message":
        this.#assistantMessage(sessionId, message);
        return;
      case "tool_call_started":
        this.#toolCallStarted(sessionId, message);
        return;
      case "tool_call_ended":
        this.#toolCallEnded(sessionId, message);
        return;
      case "lifecycle":
        this.#lifecycle(sessionId, message);
        return;
      case "attachment":
        this.#attachmentBody(sessionId, message);
        return;
      case "session_shutdown":
        this.#sessionShutdown(sessionId);
        return;
      default:
        return; // unknown ingress type: ignored (forward compatibility)
    }
  }

  /** Tap socket closed without a shutdown line: flush pending deltas and
   * mark the session honestly `unobserved` (history stays replayable). */
  tapDisconnected(connectionId: string): void {
    this.#tapDisconnected(connectionId);
  }

  #tapDisconnected(connectionId: string | undefined): void {
    if (connectionId === undefined) return;
    const connection = this.#connections.get(connectionId);
    this.#connections.delete(connectionId);
    const sessionId = connection?.sessionId;
    if (sessionId === undefined || sessionId === null) return;
    this.#flushSessionMerges(sessionId);
    const record = this.#sessions.get(sessionId);
    if (record !== undefined && !this.#log.isGone(sessionId)) {
      record.state = "unobserved";
    }
  }

  #register(connectionId: string, message: TapRegisterLine): void {
    const connection = this.#connections.get(connectionId);
    if (connection === undefined) return;
    if (connection.sessionId !== null) return; // one registration per connection
    const sessionId = message.sessionId;
    if (
      typeof sessionId !== "string" ||
      sessionId.length === 0 ||
      sessionId.length > MAX_ID_LENGTH
    ) {
      return;
    }
    connection.sessionId = sessionId;

    const existing = this.#sessions.get(sessionId);
    if (existing !== undefined && existing.state !== "ended") {
      existing.state = "live"; // tap reconnect: live again, history intact
      return;
    }
    this.#sessions.set(sessionId, {
      runId: optionalId(message.runId),
      taskId: optionalId(message.taskId),
      workerId: optionalId(message.workerId),
      lane: boundedLabel(message.lane, "pi"),
      title: optionalLabel(message.title),
      state: "live",
    });
  }

  #userMessage(sessionId: string, message: Extract<TapLine, { type: "user_message" }>): void {
    const messageId = requiredId(message.messageId);
    const text = typeof message.text === "string" ? message.text : null;
    if (messageId === null || text === null) return;
    const source = USER_SOURCES.find((candidate) => candidate === message.source) ?? "interactive";
    const imageCount =
      typeof message.imageCount === "number" &&
      Number.isInteger(message.imageCount) &&
      message.imageCount >= 0
        ? message.imageCount
        : 0;
    const payload: UserMessagePayload = {
      messageId,
      text: this.#bounded(text),
      source,
      imageCount,
      attachments: this.#attachmentRefs(sessionId, message.attachments),
      occurredAt: this.#occurredAt(message.occurredAt),
    };
    this.#log.append(sessionId, "user_message", payload);
  }

  /**
   * Validate the tap's declared attachment refs into the frame's reference
   * list (D5): ids and media types are bounded, the per-message ref cap
   * drops extras honestly, and a stored body's decoded length overrides the
   * declared `byteLen` (the body is what GET serves, so it is the truth).
   */
  #attachmentRefs(sessionId: string, raw: unknown): UserMessagePayload["attachments"] {
    if (!Array.isArray(raw)) return [];
    const refs: UserMessagePayload["attachments"] = [];
    for (const candidate of raw) {
      if (refs.length >= MAX_ATTACHMENTS_PER_MESSAGE) break;
      if (typeof candidate !== "object" || candidate === null) continue;
      const record = candidate as Record<string, unknown>;
      const attachmentId = requiredId(record.attachmentId);
      const mimeType =
        typeof record.mimeType === "string" && isValidMimeType(record.mimeType)
          ? record.mimeType
          : null;
      if (attachmentId === null || mimeType === null) continue;
      const stored = this.#assets.storedBytes(sessionId, attachmentId);
      const declared =
        typeof record.byteLen === "number" &&
        Number.isInteger(record.byteLen) &&
        record.byteLen >= 0 &&
        record.byteLen <= MAX_ATTACHMENT_REF_BYTES
          ? record.byteLen
          : null;
      refs.push({ attachmentId, mimeType, byteLen: stored ?? declared ?? 0 });
    }
    return refs;
  }

  /**
   * One attachment body line (D5): bounded, sized, stored outside the frame
   * buffer. Malformed, oversized, or unknown-session bodies are dropped
   * silently (fail-observer); the referencing frame then honestly reports a
   * ref whose GET 404s. Duplicate ids replace the stored bytes (latest wins).
   */
  #attachmentBody(sessionId: string, message: Extract<TapLine, { type: "attachment" }>): void {
    const attachmentId = requiredId(message.attachmentId);
    const mimeType =
      typeof message.mimeType === "string" && isValidMimeType(message.mimeType)
        ? message.mimeType
        : null;
    if (attachmentId === null || mimeType === null || typeof message.dataBase64 !== "string")
      return;
    if (message.dataBase64.length > MAX_ATTACHMENT_BODY_LINE_BYTES) return; // pre-decode bound
    if (!isStrictBase64(message.dataBase64)) return; // malformed: dropped honestly
    const bytes = new Uint8Array(Buffer.from(message.dataBase64, "base64"));
    this.#assets.put(sessionId, attachmentId, { mimeType, bytes });
  }

  #assistantUpdate(sessionId: string, message: TapAssistantUpdateLine): void {
    const messageId = requiredId(message.messageId);
    if (messageId === null || typeof message.text !== "string") return;
    if (this.#isFinalized(sessionId, messageId)) return;
    const merges = this.#merges.get(sessionId) ?? new Map<string, MergeState>();
    if (!merges.has(messageId) && merges.size >= MAX_OPEN_MERGES_PER_SESSION) return; // over cap: final converges
    let state = merges.get(messageId);
    if (state === undefined) {
      state = { emittedPrefix: "", pending: null, dueAtMs: null };
      merges.set(messageId, state);
      this.#merges.set(sessionId, merges);
    }
    state.pending = message.text;
    if (!message.text.startsWith(state.emittedPrefix)) state.emittedPrefix = "";
    if (state.dueAtMs === null) state.dueAtMs = this.#nowMs() + this.#mergeFlushMs;
  }

  #assistantMessage(
    sessionId: string,
    message: Extract<TapLine, { type: "assistant_message" }>,
  ): void {
    const messageId = requiredId(message.messageId);
    const text = typeof message.text === "string" ? message.text : null;
    if (messageId === null || text === null) return;
    this.#merges.get(sessionId)?.delete(messageId);
    this.#rememberFinalized(sessionId, messageId);
    const bounded = truncateUtf8(this.#redact(text, Number.MAX_SAFE_INTEGER), this.#maxFrameBytes);
    const payload: AssistantMessagePayload = {
      messageId,
      text: bounded.text,
      truncated: bounded.truncated,
      occurredAt: this.#occurredAt(message.occurredAt),
    };
    this.#log.append(sessionId, "assistant_message", payload);
  }

  #toolCallStarted(
    sessionId: string,
    message: Extract<TapLine, { type: "tool_call_started" }>,
  ): void {
    const toolCallId = requiredId(message.toolCallId);
    const toolName = requiredId(message.toolName);
    const argsJson = typeof message.argsJson === "string" ? message.argsJson : null;
    if (toolCallId === null || toolName === null || argsJson === null) return;
    const bounded = truncateUtf8(
      this.#redact(argsJson, Number.MAX_SAFE_INTEGER),
      this.#maxFrameBytes,
    );
    const payload: ToolCallStartedPayload = {
      toolCallId,
      toolName,
      argsJson: bounded.text,
      argsTruncated: bounded.truncated,
      occurredAt: this.#occurredAt(message.occurredAt),
    };
    this.#log.append(sessionId, "tool_call_started", payload);
  }

  #toolCallEnded(sessionId: string, message: Extract<TapLine, { type: "tool_call_ended" }>): void {
    const toolCallId = requiredId(message.toolCallId);
    const resultText = typeof message.resultText === "string" ? message.resultText : null;
    if (toolCallId === null || resultText === null) return;
    const bounded = truncateUtf8(
      this.#redact(resultText, Number.MAX_SAFE_INTEGER),
      this.#maxFrameBytes,
    );
    const payload: ToolCallEndedPayload = {
      toolCallId,
      resultText: bounded.text,
      resultTruncated: bounded.truncated,
      isError: message.isError === true,
      occurredAt: this.#occurredAt(message.occurredAt),
    };
    this.#log.append(sessionId, "tool_call_ended", payload);
  }

  #lifecycle(sessionId: string, message: Extract<TapLine, { type: "lifecycle" }>): void {
    const phase = LIFECYCLE_PHASES.find((candidate) => candidate === message.phase);
    if (phase === undefined) return;
    const payload: LifecyclePayload = { phase, occurredAt: this.#occurredAt(message.occurredAt) };
    this.#log.append(sessionId, "lifecycle", payload);
  }

  #sessionShutdown(sessionId: string): void {
    this.#flushSessionMerges(sessionId);
    this.#merges.delete(sessionId);
    const record = this.#sessions.get(sessionId);
    if (record !== undefined) record.state = "ended";
    this.#log.markSessionGone(sessionId, {
      reason: "sessionGone",
      occurredAt: this.#isoNow(),
    } satisfies ConversationResetPayload);
  }

  // ——— Delta merge pump (D4 §2) ———

  /** Flush every merge whose due time has arrived. Tests advance a fake clock
   * and call this directly; production pumps via the interval. */
  tickMerge(nowMs: number = this.#nowMs()): void {
    for (const [sessionId, merges] of this.#merges) {
      for (const [messageId, state] of merges) {
        if (state.dueAtMs === null || state.dueAtMs > nowMs) continue;
        state.dueAtMs = null;
        this.#flushMerge(sessionId, messageId, state);
      }
    }
  }

  #flushMerge(sessionId: string, messageId: string, state: MergeState): void {
    const pending = state.pending;
    if (pending === null) return;
    if (!pending.startsWith(state.emittedPrefix)) state.emittedPrefix = "";
    const suffix = pending.slice(state.emittedPrefix.length);
    if (suffix.length === 0) return;
    const bounded = truncateUtf8(
      this.#redact(suffix, Number.MAX_SAFE_INTEGER),
      this.#maxFrameBytes,
    );
    if (bounded.text.length === 0) return;
    const payload: AssistantDeltaPayload = {
      messageId,
      delta: bounded.text,
      occurredAt: this.#isoNow(),
    };
    this.#log.append(sessionId, "assistant_delta", payload);
    state.emittedPrefix += bounded.text;
  }

  /** Graceless flush (tap disconnect / shutdown): emit everything pending. */
  #flushSessionMerges(sessionId: string): void {
    const merges = this.#merges.get(sessionId);
    if (merges === undefined) return;
    for (const [messageId, state] of merges) {
      state.dueAtMs = null;
      this.#flushMerge(sessionId, messageId, state);
    }
  }

  #isFinalized(sessionId: string, messageId: string): boolean {
    return this.#finalized.get(sessionId)?.has(messageId) ?? false;
  }

  #rememberFinalized(sessionId: string, messageId: string): void {
    let set = this.#finalized.get(sessionId);
    if (set === undefined) {
      set = new Set();
      this.#finalized.set(sessionId, set);
    }
    set.add(messageId);
    if (set.size > MAX_FINALIZED_MESSAGES_PER_SESSION) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
  }

  // ——— App-side upload + downstream input delivery (D5, M2) ———

  /**
   * Store one APP-UPLOADED attachment body (D5): the composer uploads the
   * image before the input that references it; the input then carries the
   * returned `RemoteSessionAssetRef` only — bodies never ride the frame log
   * (identical rule to tap body lines). Errors are deterministic problem
   * mappings, never silent drops (unlike the fail-observer tap path — the
   * upload is a synchronous request/response and the client branches on it).
   */
  storeUploadedAttachment(
    sessionId: string,
    mimeType: string,
    bytes: Uint8Array,
  ): RemoteSessionAssetRef {
    if (!this.sessionKnown(sessionId)) throw new ProblemError(404, "session_not_found");
    if (!isValidMimeType(mimeType) || !isUploadableImageType(mimeType)) {
      throw new ProblemError(400, "invalid_media_type");
    }
    if (bytes.byteLength === 0) {
      throw new ProblemError(400, "invalid_media_type"); // empty is not a valid image
    }
    if (bytes.byteLength > this.#assets.maxBodyBytes) {
      throw new ProblemError(413, "attachment_too_large");
    }
    const attachmentId = `att_${crypto.randomUUID()}`;
    // The store evicts oldest-first under the per-session budget; false means
    // even the new body could not fit (single-body budget semantics) — the
    // honest answer to the uploader is 413, not a stored-then-404 ref.
    if (!this.#assets.put(sessionId, attachmentId, { mimeType, bytes })) {
      throw new ProblemError(413, "attachment_too_large");
    }
    return { attachmentId, mimeType, byteLen: bytes.byteLength };
  }

  /**
   * Deliver one app-submitted input to the session's live tap (D5): the
   * downstream `deliver_input` line carries the text plus the referenced
   * attachment BODIES as base64 over the tap socket (control channel, never
   * the SSE frame log). The tap turns it into
   * `pi.sendUserMessage([{ type: "text", ... }, { type: "image", ... }])`,
   * pi fires its input event with `InputEvent.images`, and the tap's
   * observed `user_message` + attachment lines produce the session-stream
   * frames — the honest observation loop, not a synthesized frame.
   */
  submitInput(
    sessionId: string,
    input: { text: string; attachments: { attachmentId: string }[] },
  ): { inputId: string } {
    if (!this.sessionKnown(sessionId)) throw new ProblemError(404, "session_not_found");
    const connection = this.#connectionForSession(sessionId);
    if (connection === undefined || connection.write === null) {
      throw new ProblemError(409, "session_not_live");
    }
    if (Buffer.byteLength(input.text, "utf8") > MAX_PROMPT_BYTES) {
      throw new ProblemError(413, "prompt_too_large");
    }
    if (input.attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new ProblemError(400, "invalid_request", {
        attachments: `at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per input`,
      });
    }
    if (input.text.trim().length === 0 && input.attachments.length === 0) {
      throw new ProblemError(400, "invalid_request", { input: "must not be empty" });
    }
    // Refs must resolve to STORED bodies; the base64 goes only to the tap
    // socket, never into the frame buffer (D5).
    const attachments = input.attachments.map((ref) => {
      const stored = this.#assets.get(sessionId, ref.attachmentId);
      if (stored === null) throw new ProblemError(404, "attachment_not_found");
      return {
        attachmentId: ref.attachmentId,
        mimeType: stored.mimeType,
        dataBase64: Buffer.from(stored.bytes).toString("base64"),
      };
    });
    const inputId = `in_${crypto.randomUUID()}`;
    const line = JSON.stringify({
      type: "deliver_input",
      inputId,
      text: input.text,
      attachments,
      occurredAt: this.#isoNow(),
    } satisfies DeliverInputLine);
    try {
      connection.write(line);
    } catch {
      // The socket died between the liveness check and the write: the honest
      // outcome is "not live", with the connection torn down (fail-observer).
      throw new ProblemError(409, "session_not_live");
    }
    return { inputId };
  }

  #connectionForSession(sessionId: string): TapConnection | undefined {
    for (const connection of this.#connections.values()) {
      if (connection.sessionId === sessionId) return connection;
    }
    return undefined;
  }

  // ——— Steer mirror (D4 §4) ———

  /**
   * Mirror one accepted steer onto every LIVE session correlated to `runId`.
   * Returns the number of session streams the frame landed on; zero is the
   * honest outcome for runs without a correlated live session (the frame is
   * never synthesized on a stream it does not belong to).
   */
  mirrorSteerQueued(input: { runId: string; steerId: string; text: string }): number {
    let mirrored = 0;
    for (const [sessionId, record] of this.#sessions) {
      if (record.runId !== input.runId || record.state !== "live") continue;
      const bounded = truncateUtf8(
        this.#redact(input.text, Number.MAX_SAFE_INTEGER),
        this.#maxFrameBytes,
      );
      const payload: SteerQueuedPayload = {
        steerId: input.steerId,
        text: bounded.text,
        runId: input.runId,
        occurredAt: this.#isoNow(),
      };
      this.#log.append(sessionId, "steer_queued", payload);
      mirrored += 1;
    }
    return mirrored;
  }

  // ——— SSE surface (GET /v1/sessions, /v1/sessions/{id}/events, /attachments/{id}) ———

  /** GET /v1/sessions core: the honest inventory (D2). */
  listSessions(): SessionListOutput {
    const sessions: RemoteSessionSummary[] = [];
    for (const [sessionId, record] of this.#sessions) {
      sessions.push({
        sessionId,
        runId: record.runId,
        taskId: record.taskId,
        workerId: record.workerId,
        lane: record.lane,
        title: record.title,
        state: record.state,
      });
    }
    return { sessions };
  }

  /** True when the session is known to the collector or its log (D5: the
   * attachment endpoint distinguishes unknown sessions from missing bodies). */
  sessionKnown(sessionId: string): boolean {
    return (
      this.#sessions.has(sessionId) ||
      this.#log.isGone(sessionId) ||
      this.#log.hasHistory(sessionId)
    );
  }

  /** GET /v1/sessions/{sessionId}/attachments/{attachmentId} core (D5): the
   * stored body, or null when evicted/never arrived (an honest 404 — never
   * synthesized bytes). Bodies survive session end while memory holds. */
  getAttachment(sessionId: string, attachmentId: string): StoredAttachment | null {
    return this.#assets.get(sessionId, attachmentId);
  }

  /**
   * SSE /v1/sessions/{sessionId}/events core. Intro computation and the live
   * subscription happen back-to-back so no frame can slip between them.
   */
  observeSession(
    sessionId: string,
    lastEventId: string | null,
  ): {
    intro: SessionOutboundFrame[];
    terminalAfterIntro: boolean;
    listen(listener: (frame: SessionOutboundFrame) => void): () => void;
  } {
    const known =
      this.#sessions.has(sessionId) ||
      this.#log.isGone(sessionId) ||
      this.#log.hasHistory(sessionId);
    if (!known) throw new ProblemError(404, "session_not_found");

    const replay = this.#log.replay(sessionId, lastEventId);
    const intro: SessionOutboundFrame[] = [];
    if (replay.reset) {
      intro.push(this.#resetFrame(sessionId, "cursorUnavailable"));
    } else if (lastEventId === null) {
      // Fresh connection: bounded projection of the session's recent history.
      intro.push(...this.#log.bufferedFrames(sessionId));
    } else {
      intro.push(...replay.frames);
    }

    let terminalAfterIntro = false;
    if (this.#log.isGone(sessionId)) {
      // Shares cursorAtHead with the last buffered frame (run/pane terminal
      // convention), so an id-based dedupe would not wrongly drop it.
      const gone = this.#log.goneReset(sessionId);
      if (gone !== null) intro.push(gone);
      terminalAfterIntro = true;
    }

    return {
      intro,
      terminalAfterIntro,
      listen: (listener) => this.#log.subscribe(sessionId, listener),
    };
  }

  /**
   * Authoritative connection-local reset frame for a slow consumer. Null
   * when the session has no known state (nothing to converge onto).
   */
  slowConsumerReset(sessionId: string): SessionOutboundFrame | null {
    if (this.#log.isGone(sessionId)) return this.#log.goneReset(sessionId);
    if (!this.#sessions.has(sessionId) && !this.#log.hasHistory(sessionId)) return null;
    return this.#resetFrame(sessionId, "slowConsumer");
  }

  #resetFrame(
    sessionId: string,
    reason: "cursorUnavailable" | "slowConsumer",
  ): SessionOutboundFrame {
    const payload: ConversationResetPayload = { reason, occurredAt: this.#isoNow() };
    return { id: this.#log.cursorAtHead(sessionId), event: "conversation_reset", data: payload };
  }

  /** Buffered frames for a session (test introspection seam). */
  bufferedFrames(
    sessionId: string,
  ): { event: ConversationFrameName | "conversation_reset"; data: unknown }[] {
    return this.#log.bufferedFrames(sessionId);
  }

  // ——— helpers ———

  /** Redact → byte-bound (pane mirror's exact funnel; D4 §8). */
  #bounded(text: string): string {
    return truncateUtf8(this.#redact(text, Number.MAX_SAFE_INTEGER), this.#maxFrameBytes).text;
  }

  /** Tap-observed time when present and parseable, else gateway time. */
  #occurredAt(raw: unknown): string {
    if (typeof raw === "string" && raw.length > 0 && Number.isFinite(Date.parse(raw))) return raw;
    return this.#isoNow();
  }

  #isoNow(): string {
    return new Date(this.#nowMs()).toISOString();
  }
}

type SocketData = { connectionId: string; buffer: string };

/** Composition-root default for the tap ingress socket (decision D1: the
 * collector is a gateway-hosted unix socket; the tap connects at
 * `session_start`). */
export function defaultSessionSocketPath(): string {
  return join(tmpdir(), "loop-session-collector.sock");
}

function requiredId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) return null;
  return value;
}

/** Strict standard-base64 shape (the lenient decoder would silently ignore
 * junk characters — a malformed body line must drop, not decode partially). */
function isStrictBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function optionalId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > MAX_ID_LENGTH ? value.slice(0, MAX_ID_LENGTH) : value;
}

function optionalLabel(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > MAX_LABEL_LENGTH ? value.slice(0, MAX_LABEL_LENGTH) : value;
}

function boundedLabel(value: unknown, fallback: string): string {
  const label = optionalLabel(value);
  return label ?? fallback;
}

