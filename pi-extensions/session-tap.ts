/**
 * session-tap.ts — in-session pi extension tap that streams the REAL
 * operator session to the Loop gateway session collector (decision
 * 2026-xx-gui-conversation D1).
 *
 * What it does:
 *   On `session_start` it connects to the gateway's unix-socket collector,
 *   sends one `register` line first, then forwards observed session events
 *   as NDJSON lines (the sender side of the tap protocol — the gateway's
 *   session-collector owns ingress). `deliver_input` lines arriving on the
 *   same socket are fed back into pi via `pi.sendUserMessage` (D5 app
 *   composer), so the remote app can drive the live terminal session.
 *
 * Observed pi events (pi 0.87.1 vocabulary, docs/research/gui-session-events.md):
 *   input                  -> user_message (+ attachment body lines before it)
 *   message_update         -> assistant_update (full snapshot; latest wins)
 *   message_end            -> assistant_message (authoritative final)
 *   tool_execution_start   -> tool_call_started
 *   tool_execution_update  -> observed, not streamed in v1 (the collector card
 *                             contract is the started/ended pair; no partial
 *                             frame exists in the v1 vocabulary)
 *   tool_execution_end     -> tool_call_ended
 *   turn_start / turn_end  -> lifecycle(turnStarted / turnEnded)
 *   session_start          -> connect + register + lifecycle(sessionStarted)
 *   session_shutdown       -> dedicated `session_shutdown` line, then disconnect
 *   message_start          -> observed for assistant-message identity only
 *
 * Fail-open contract (fail-observer): the tap never throws into pi. A missing
 * or dead gateway means frames are silently dropped (finals on later frames
 * converge the app view); reconnects use capped exponential backoff; timers
 * and sockets never keep pi alive; pi behavior is unaffected in every mode
 * (interactive TUI, rpc, json, print — pi loads extensions in all modes).
 *
 * Correlation (D1): `LOOP_RUN_ID` / `LOOP_TASK_ID` / `LOOP_WORKER_ID` env
 * markers, when present in the pi process, ride the register line. Marker-less
 * sessions (the operator's own Lead TUI, for example) appear in the inventory
 * with honest null run/task/worker ids.
 *
 * Socket path: `LOOP_SESSION_TAP_SOCKET` env, else the gateway's
 * `LOOP_GATEWAY_SESSION_SOCKET` env (same knob, so a customized gateway path
 * is picked up automatically), else the gateway default
 * `<tmpdir>/loop-session-collector.sock`.
 *
 * Registration (pi config; loads in interactive/TUI too) — user settings
 * `~/.pi/agent/settings.json`:
 *   { "extensions": ["~/dev/ll3/loop/pi-extensions/session-tap.ts"] }
 * (absolute paths are supported; user-level relative paths resolve from
 * ~/.pi/agent). Copying the file to ~/.pi/agent/extensions/ works equally.
 *
 * Self-contained by design: only node built-ins, no workspace imports — this
 * file is loaded directly by pi from wherever it is registered.
 */

import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ——— Tap line vocabulary (sender side; the gateway session-collector owns ingress) ———

/** Reference-shaped attachment metadata on a user_message line (D5). */
export interface TapAttachmentRef {
	attachmentId: string;
	mimeType: string;
	byteLen: number;
}

/** Collector-accepted user-message sources. */
export type TapUserSource = "interactive" | "steer" | "api";

/** Collector-accepted lifecycle phases. */
export type TapLifecyclePhase = "sessionStarted" | "turnStarted" | "turnEnded" | "sessionEnded";

export type TapLine =
	| {
			type: "register";
			sessionId: string;
			runId: string | null;
			taskId: string | null;
			workerId: string | null;
			lane: string;
			title: string | null;
	  }
	| {
			type: "user_message";
			messageId: string;
			text: string;
			source: TapUserSource;
			imageCount: number;
			attachments: TapAttachmentRef[];
			occurredAt: string;
	  }
	| { type: "attachment"; attachmentId: string; mimeType: string; dataBase64: string; occurredAt: string }
	| { type: "assistant_update"; messageId: string; text: string; occurredAt: string }
	| { type: "assistant_message"; messageId: string; text: string; occurredAt: string }
	| { type: "tool_call_started"; toolCallId: string; toolName: string; argsJson: string; occurredAt: string }
	| { type: "tool_call_ended"; toolCallId: string; resultText: string; isError: boolean; occurredAt: string }
	| { type: "lifecycle"; phase: TapLifecyclePhase; occurredAt: string }
	| { type: "session_shutdown" };

// ——— Bounds (pre-empt the collector's bounded ingress: a giant field is
// truncated honestly per frame instead of getting the whole LINE dropped) ———

const MAX_TEXT_BYTES = 256 * 1024;
const MAX_TOOL_BYTES = 64 * 1024;

export function truncateUtf8(text: string, maxBytes: number): string {
	const buffer = Buffer.from(text, "utf8");
	if (buffer.byteLength <= maxBytes) return text;
	let cut = maxBytes;
	while (cut > 0 && (buffer[cut]! & 0xc0) === 0x80) cut -= 1; // back up to a code-point boundary
	return buffer.subarray(0, cut).toString("utf8");
}

// ——— Structural pi API (subset used; pi 0.87.1 ExtensionAPI compatible) ———

export interface TapEventContext {
	sessionManager?: {
		getSessionId?: () => string;
		getSessionFile?: () => string | undefined;
	};
}

export interface TapInputImage {
	type?: string;
	data?: string;
	mimeType?: string;
}

export interface TapInputEvent {
	type: "input";
	text?: string;
	images?: TapInputImage[];
	source?: "interactive" | "rpc" | "extension";
	streamingBehavior?: "steer" | "followUp";
}

export interface TapMessageEvent {
	type: "message_start" | "message_update" | "message_end";
	message?: {
		role?: string;
		content?: unknown;
		responseId?: string;
	};
}

export interface TapToolEvent {
	type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	result?: unknown;
	isError?: boolean;
}

export interface TapBoundaryEvent {
	type: "turn_start" | "turn_end";
}

export interface TapSessionStartEvent {
	type: "session_start";
	reason?: string;
}

export interface TapShutdownEvent {
	type: "session_shutdown";
	reason?: string;
}

export interface TapPi {
	on(event: "session_start", handler: (event: TapSessionStartEvent, ctx: TapEventContext) => void): void;
	on(event: "input", handler: (event: TapInputEvent, ctx: TapEventContext) => void): void;
	on(
		event: "message_start" | "message_update" | "message_end",
		handler: (event: TapMessageEvent, ctx: TapEventContext) => void,
	): void;
	on(
		event: "tool_execution_start" | "tool_execution_update" | "tool_execution_end",
		handler: (event: TapToolEvent, ctx: TapEventContext) => void,
	): void;
	on(event: "turn_start" | "turn_end", handler: (event: TapBoundaryEvent, ctx: TapEventContext) => void): void;
	on(event: "session_shutdown", handler: (event: TapShutdownEvent, ctx: TapEventContext) => void): void;
	sendUserMessage(
		content: string | Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>,
		options?: { deliverAs?: "steer" | "followUp" },
	): void;
	getSessionName?: () => string | undefined;
}

// ——— Event -> line mapping (pure; exported for the test suite) ———

/** Concatenated `text` blocks of a message content array (thinking and tool
 * calls excluded — the v1 conversation frame carries the visible text). */
export function messageText(message: unknown): string {
	if (typeof message === "string") return message;
	if (typeof message !== "object" || message === null) return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text") {
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	return parts.join("");
}

/** Tool result text: string passthrough, text blocks joined, JSON fallback. */
export function toolResultText(result: unknown): string {
	if (typeof result === "string") return result;
	if (typeof result === "object" && result !== null) {
		const content = (result as { content?: unknown }).content;
		if (Array.isArray(content)) {
			const parts: string[] = [];
			for (const block of content) {
				if (typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text") {
					const text = (block as { text?: unknown }).text;
					if (typeof text === "string") parts.push(text);
				}
			}
			if (parts.length > 0) return parts.join("\n");
		}
		try {
			return JSON.stringify(result) ?? "";
		} catch {
			return "[unserializable tool result]";
		}
	}
	return "";
}

/** Safe bounded JSON for tool args. */
export function toolArgsJson(args: unknown): string {
	if (args === undefined) return "null";
	try {
		return truncateUtf8(JSON.stringify(args) ?? "null", MAX_TOOL_BYTES);
	} catch {
		return "[unserializable tool args]";
	}
}

/** pi input source -> collector source. Steer delivery is its own honest
 * source; non-interactive origins (rpc/extension) report as "api". */
export function tapUserSource(event: TapInputEvent): TapUserSource {
	if (event.streamingBehavior === "steer") return "steer";
	return event.source === "interactive" ? "interactive" : "api";
}

// ——— Reconnecting NDJSON transport (fail-open) ———

export interface TapSocketHandlers {
	onConnected(): void;
	onData(line: string): void;
	onDown(): void;
}

export interface TapSocketHandle {
	write(line: string): void;
	close(): void;
}

export interface TapTransportOptions {
	socketPath: string;
	/** First reconnect delay; doubles up to maxBackoffMs. */
	backoffMs?: number;
	maxBackoffMs?: number;
	/** DI seam for deterministic tests (default: node:net). */
	connect?: (socketPath: string, handlers: TapSocketHandlers) => TapSocketHandle;
	/** DI seam so tests can drive backoff without real waits. */
	schedule?: (fn: () => void, ms: number) => unknown;
	cancelSchedule?: (timer: unknown) => void;
	/** Extra lines written right after the register line on EVERY successful
	 * connect (the collector re-creates the session record per connection, so
	 * connection-scoped frames like lifecycle(sessionStarted) re-arm here). */
	afterRegister?: () => TapLine[];
	/** Downstream control lines (deliver_input), already frame-split. */
	onDownstreamLine?: (line: string) => void;
}

/** Default node:net connector — works under both bun and node runtimes. */
export function defaultConnect(socketPath: string, handlers: TapSocketHandlers): TapSocketHandle {
	let ready = false;
	const socket: Socket = createConnection({ path: socketPath });
	socket.setNoDelay(true);
	let buffer = "";
	socket.on("connect", () => {
		ready = true;
		handlers.onConnected();
	});
	socket.on("data", (chunk: Buffer | string) => {
		buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
		for (;;) {
			const newline = buffer.indexOf("\n");
			if (newline === -1) {
				// Downstream lines are small (deliver_input); resync instead of
				// growing forever if one ever goes absurd (fail-open).
				if (buffer.length > 4 * 1024 * 1024) buffer = "";
				break;
			}
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			handlers.onData(line);
		}
	});
	socket.on("error", () => {
		/* close follows; the down handler owns recovery */
	});
	socket.on("close", () => {
		// Down on EVERY close: a failed connect attempt must also re-arm the
		// backoff, otherwise a refused connection pins the dead handle forever.
		const wasReady = ready;
		ready = false;
		handlers.onDown();
		void wasReady;
	});
	return {
		write(line: string): void {
			socket.write(line + "\n");
		},
		close(): void {
			socket.destroy();
		},
	};
}

type RealTimer = ReturnType<typeof setTimeout>;

/**
 * One tap connection lifecycle with reconnect + backoff. Lines offered while
 * disconnected are dropped (honest loss; finals/snapshots converge the view).
 * The register line is (re)sent FIRST on every successful connect — the
 * collector requires one registration per connection and drops observations
 * from unregistered connections (fail-observer ingress).
 */
export class TapTransport {
	readonly #options: Required<Pick<TapTransportOptions, "socketPath" | "backoffMs" | "maxBackoffMs">> & TapTransportOptions;
	readonly #registerLine: () => TapLine;
	#handle: TapSocketHandle | null = null;
	#connected = false;
	#backoffMs: number;
	#timer: unknown = null;
	#stopped = false;

	constructor(registerLine: () => TapLine, options: TapTransportOptions) {
		this.#registerLine = registerLine;
		this.#options = { backoffMs: 500, maxBackoffMs: 15000, ...options };
		this.#backoffMs = this.#options.backoffMs;
	}

	get connected(): boolean {
		return this.#connected;
	}

	get stopped(): boolean {
		return this.#stopped;
	}

	/** Begin connecting (idempotent while already live). */
	start(): void {
		this.#stopped = false;
		if (this.#handle !== null) return;
		this.#open();
	}

	#open(): void {
		if (this.#stopped || this.#handle !== null) return;
		try {
			this.#handle = (this.#options.connect ?? defaultConnect)(this.#options.socketPath, {
				onConnected: () => {
					this.#connected = true;
					this.#backoffMs = this.#options.backoffMs; // success resets backoff
					// Register FIRST on every connection, then the connection-scoped
					// follow-ups (lifecycle sessionStarted) while the socket is hot.
					this.#writeLine(JSON.stringify(this.#registerLine()));
					for (const line of this.#options.afterRegister?.() ?? []) {
						this.#writeLine(JSON.stringify(line));
					}
				},
				onData: (line) => this.#options.onDownstreamLine?.(line),
				onDown: () => {
					this.#handle = null;
					this.#connected = false;
					if (!this.#stopped) this.#scheduleReconnect();
				},
			});
		} catch {
			// Synchronous connect failure (missing socket file, etc.): retry later.
			this.#handle = null;
			this.#scheduleReconnect();
		}
	}

	#scheduleReconnect(): void {
		if (this.#stopped || this.#timer !== null) return;
		const delay = this.#backoffMs;
		this.#backoffMs = Math.min(this.#backoffMs * 2, this.#options.maxBackoffMs);
		const schedule =
			this.#options.schedule ??
			((fn: () => void, ms: number) => {
				const timer: RealTimer = setTimeout(fn, ms);
				timer.unref?.(); // never hold pi open for the tap
				return timer;
			});
		this.#timer = schedule(() => {
			this.#timer = null;
			this.#open();
		}, delay);
	}

	/** Offer one observation line; dropped silently while disconnected. */
	send(line: TapLine): void {
		if (!this.#connected || this.#handle === null) return;
		this.#writeLine(JSON.stringify(line));
	}

	#writeLine(line: string): void {
		if (this.#handle === null) return;
		try {
			this.#handle.write(line);
		} catch {
			// Write raced the socket dying: the close handler owns recovery.
		}
	}

	/** Offer the shutdown line, then close and stop reconnecting (idempotent). */
	shutdown(shutdownLine?: TapLine): void {
		if (shutdownLine !== undefined) this.send(shutdownLine);
		this.stop();
	}

	stop(): void {
		this.#stopped = true;
		if (this.#timer !== null) {
			(this.#options.cancelSchedule ?? ((timer: unknown) => clearTimeout(timer as RealTimer)))(this.#timer);
			this.#timer = null;
		}
		this.#handle?.close();
		this.#handle = null;
		this.#connected = false;
	}
}

// ——— Session tap: pi events -> transport ———

export interface SessionTapOptions {
	environment?: Record<string, string | undefined>;
	socketPath?: string;
	/** Transport DI seams for deterministic tests. */
	transport?: Pick<TapTransportOptions, "connect" | "backoffMs" | "maxBackoffMs" | "schedule" | "cancelSchedule">;
}

export function tapSocketPath(environment: Record<string, string | undefined> = process.env): string {
	return (
		environment.LOOP_SESSION_TAP_SOCKET ??
		environment.LOOP_GATEWAY_SESSION_SOCKET ??
		join(tmpdir(), "loop-session-collector.sock")
	);
}

/** Env-marker correlation forwarded on register (D1); null when absent. */
export function tapMarker(value: string | undefined): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed.slice(0, 128) : null;
}

const MAX_TRACKED_SNAPSHOTS = 32;

/**
 * Binds one pi session to the collector transport. All handlers are
 * exception-safe: a tap bug must never surface inside pi (fail-open).
 */
export class SessionTap {
	readonly #pi: TapPi;
	readonly #options: SessionTapOptions;
	#transport: TapTransport | null = null;
	#sessionId: string | null = null;
	/** Current assistant message identity + last snapshot text sent (dedupe). */
	#assistantId: string | null = null;
	#assistantLastText: string | null = null;
	#tracked = new Set<string>();

	constructor(pi: TapPi, options: SessionTapOptions = {}) {
		this.#pi = pi;
		this.#options = options;
	}

	get sessionId(): string | null {
		return this.#sessionId;
	}

	get connected(): boolean {
		return this.#transport?.connected ?? false;
	}

	/** session_start: (re)arm the tap for this session. Idempotent per session
	 * id; a NEW session id stops the previous transport first (replacement). */
	startSession(ctx: TapEventContext): void {
		const sessionId = sessionIdFrom(ctx);
		if (sessionId === null) return; // nothing honest to register — stay off
		if (this.#transport !== null && this.#sessionId === sessionId) return; // already tapped
		this.stopSession();
		this.#sessionId = sessionId;
		this.#assistantId = null;
		this.#assistantLastText = null;
		this.#tracked.clear();
		const environment = this.#options.environment ?? process.env;
		const register: TapLine = {
			type: "register",
			sessionId,
			runId: tapMarker(environment.LOOP_RUN_ID),
			taskId: tapMarker(environment.LOOP_TASK_ID),
			workerId: tapMarker(environment.LOOP_WORKER_ID),
			lane: "pi",
			title: this.#pi.getSessionName?.() ?? null,
		};
		const startedAt = occurredAt();
		this.#transport = new TapTransport(() => register, {
			socketPath: this.#options.socketPath ?? tapSocketPath(environment),
			...(this.#options.transport ?? {}),
			onDownstreamLine: (line) => this.#handleDownstream(line),
			afterRegister: () => [{ type: "lifecycle", phase: "sessionStarted", occurredAt: startedAt }],
		});
		this.#transport.start();
	}

	/** session_shutdown: honest shutdown line, then close (idempotent). */
	stopSession(): void {
		if (this.#transport !== null) {
			this.#transport.shutdown({ type: "session_shutdown" });
			this.#transport = null;
		}
		this.#sessionId = null;
		this.#assistantId = null;
		this.#assistantLastText = null;
		this.#tracked.clear();
	}

	handleInput(event: TapInputEvent): void {
		if ((event.text ?? "").length === 0 && (event.images ?? []).length === 0) return; // nothing honest to report
		const images = (event.images ?? []).filter(
			(image): image is { type?: string; data: string; mimeType?: string } =>
				typeof image === "object" && image !== null && typeof image.data === "string" && image.data.length > 0,
		);
		// Attachment BODIES ride first (documented ordering — bodies then the
		// referencing line), bounded by the collector on arrival (D5).
		const attachments: TapAttachmentRef[] = [];
		for (const image of images) {
			const attachmentId = "att_" + randomUUID();
			const mimeType = typeof image.mimeType === "string" && image.mimeType.length > 0 ? image.mimeType : "image/png";
			attachments.push({ attachmentId, mimeType, byteLen: byteLenOfBase64(image.data) });
			this.#offer({ type: "attachment", attachmentId, mimeType, dataBase64: image.data, occurredAt: occurredAt() });
		}
		this.#offer({
			type: "user_message",
			messageId: "msg_" + randomUUID(),
			text: truncateUtf8(event.text ?? "", MAX_TEXT_BYTES),
			source: tapUserSource(event),
			imageCount: (event.images ?? []).length,
			attachments,
			occurredAt: occurredAt(),
		});
	}

	handleMessageStart(event: TapMessageEvent): void {
		if (event.message?.role !== "assistant") return;
		this.#assistantId =
			typeof event.message.responseId === "string" && event.message.responseId.length > 0
				? event.message.responseId
				: "asst_" + randomUUID();
		this.#assistantLastText = null;
	}

	handleMessageUpdate(event: TapMessageEvent): void {
		if (event.message?.role !== "assistant") return;
		if (this.#assistantId === null) this.handleMessageStart(event); // late join: synthesize identity
		const text = messageText(event.message);
		if (text.length === 0 && this.#assistantLastText === null) return; // no content yet: nothing honest to stream
		if (text === this.#assistantLastText) return; // snapshot unchanged (thinking-only delta, etc.)
		this.#rememberTracked(this.#assistantId!);
		this.#assistantLastText = text;
		this.#offer({
			type: "assistant_update",
			messageId: this.#assistantId!,
			text: truncateUtf8(text, MAX_TEXT_BYTES),
			occurredAt: occurredAt(),
		});
	}

	handleMessageEnd(event: TapMessageEvent): void {
		if (event.message?.role !== "assistant") return;
		if (this.#assistantId === null) this.handleMessageStart(event);
		const messageId = this.#assistantId!;
		const text = messageText(event.message);
		this.#assistantId = null;
		this.#assistantLastText = null;
		this.#tracked.delete(messageId);
		this.#offer({ type: "assistant_message", messageId, text: truncateUtf8(text, MAX_TEXT_BYTES), occurredAt: occurredAt() });
	}

	handleToolStart(event: TapToolEvent): void {
		if (typeof event.toolCallId !== "string" || event.toolCallId.length === 0) return;
		this.#offer({
			type: "tool_call_started",
			toolCallId: event.toolCallId.slice(0, 128),
			toolName: (typeof event.toolName === "string" && event.toolName.length > 0 ? event.toolName : "unknown").slice(0, 128),
			argsJson: toolArgsJson(event.args),
			occurredAt: occurredAt(),
		});
	}

	/** tool_execution_update is OBSERVED but not streamed in v1: the collector
	 * card contract is the started/ended pair (decision D4 §3); partial
	 * results stay terminal-local. Kept as an explicit no-op for vocabulary
	 * completeness and forward compatibility. */
	handleToolUpdate(_event: TapToolEvent): void {}

	handleToolEnd(event: TapToolEvent): void {
		if (typeof event.toolCallId !== "string" || event.toolCallId.length === 0) return;
		this.#offer({
			type: "tool_call_ended",
			toolCallId: event.toolCallId.slice(0, 128),
			resultText: truncateUtf8(toolResultText(event.result), MAX_TOOL_BYTES),
			isError: event.isError === true,
			occurredAt: occurredAt(),
		});
	}

	handleTurnStart(_event: TapBoundaryEvent): void {
		this.#offer({ type: "lifecycle", phase: "turnStarted", occurredAt: occurredAt() });
	}

	handleTurnEnd(_event: TapBoundaryEvent): void {
		this.#offer({ type: "lifecycle", phase: "turnEnded", occurredAt: occurredAt() });
	}

	// ——— internals ———

	#offer(line: TapLine): void {
		try {
			this.#transport?.send(line);
		} catch {
			/* fail-open: observation never breaks the session */
		}
	}

	#rememberTracked(messageId: string): void {
		this.#tracked.add(messageId);
		if (this.#tracked.size > MAX_TRACKED_SNAPSHOTS) {
			const oldest = this.#tracked.values().next().value;
			if (oldest !== undefined) this.#tracked.delete(oldest);
		}
	}

	/** Downstream deliver_input (D5): feed the app composer into pi — text
	 * block first, then image blocks. Fire-and-forget; the honest evidence is
	 * the observed `input` event that pi itself fires afterwards. */
	#handleDownstream(line: string): void {
		try {
			const parsed: unknown = JSON.parse(line);
			if (typeof parsed !== "object" || parsed === null) return;
			const message = parsed as { type?: unknown; text?: unknown; attachments?: unknown };
			if (message.type !== "deliver_input") return;
			const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
			if (typeof message.text === "string" && message.text.length > 0) {
				content.push({ type: "text", text: truncateUtf8(message.text, MAX_TEXT_BYTES) });
			}
			if (Array.isArray(message.attachments)) {
				for (const attachment of message.attachments) {
					if (typeof attachment !== "object" || attachment === null) continue;
					const data = (attachment as { dataBase64?: unknown }).dataBase64;
					const mimeType = (attachment as { mimeType?: unknown }).mimeType;
					if (typeof data !== "string" || data.length === 0 || typeof mimeType !== "string") continue;
					content.push({ type: "image", data, mimeType });
				}
			}
			if (content.length === 0) return;
			this.#pi.sendUserMessage(content, { deliverAs: "followUp" });
		} catch {
			/* malformed downstream line: dropped (fail-open) */
		}
	}
}

// ——— helpers ———

function sessionIdFrom(ctx: TapEventContext): string | null {
	const manager = ctx?.sessionManager;
	if (manager === undefined) return null;
	try {
		if (typeof manager.getSessionId === "function") {
			const id = manager.getSessionId();
			if (typeof id === "string" && id.length > 0) return id.slice(0, 128);
		}
		const file = typeof manager.getSessionFile === "function" ? manager.getSessionFile() : undefined;
		if (typeof file === "string" && file.length > 0) return file.split("/").pop()!.slice(0, 128);
	} catch {
		/* fall through */
	}
	return null;
}

function occurredAt(): string {
	try {
		return new Date().toISOString();
	} catch {
		return "";
	}
}

function byteLenOfBase64(data: string): number {
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

// ——— pi extension factory ———

/**
 * The loaded extension: subscribes to the observed pi events and owns one
 * SessionTap per session runtime. Every handler body is guarded so the tap
 * can never throw into pi; nothing starts before session_start (pi's runtime
 * lifecycle rule — no sockets in the factory).
 */
export default function sessionTapExtension(pi: TapPi, options: SessionTapOptions = {}): void {
	let tap: SessionTap | null = null;
	const guarded =
		<A extends unknown[]>(body: (...args: A) => void) =>
		(...args: A): void => {
			try {
				body(...args);
			} catch {
				/* fail-open */
			}
		};

	pi.on(
		"session_start",
		guarded((_event: TapSessionStartEvent, ctx: TapEventContext) => {
			if (tap === null) tap = new SessionTap(pi, options);
			tap.startSession(ctx);
		}),
	);
	pi.on("input", guarded((event: TapInputEvent) => tap?.handleInput(event)));
	pi.on("message_start", guarded((event: TapMessageEvent) => tap?.handleMessageStart(event)));
	pi.on("message_update", guarded((event: TapMessageEvent) => tap?.handleMessageUpdate(event)));
	pi.on("message_end", guarded((event: TapMessageEvent) => tap?.handleMessageEnd(event)));
	pi.on("tool_execution_start", guarded((event: TapToolEvent) => tap?.handleToolStart(event)));
	pi.on("tool_execution_update", guarded((event: TapToolEvent) => tap?.handleToolUpdate(event)));
	pi.on("tool_execution_end", guarded((event: TapToolEvent) => tap?.handleToolEnd(event)));
	pi.on("turn_start", guarded((event: TapBoundaryEvent) => tap?.handleTurnStart(event)));
	pi.on("turn_end", guarded((event: TapBoundaryEvent) => tap?.handleTurnEnd(event)));
	pi.on("session_shutdown", guarded(() => tap?.stopSession()));
}
