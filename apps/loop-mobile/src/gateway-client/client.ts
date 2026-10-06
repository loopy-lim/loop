/**
 * GatewayClient — the only network surface of the mobile app.
 *
 * Implements the app-side interface assumed by ADR §5:
 *   1. submitPrompt  -> POST /v1/runs (202, never auto-resubmitted)
 *   2. listRuns      -> GET /v1/runs
 *   3. getRun        -> GET /v1/runs/{runId}   (foreground polling fallback)
 *   4. observeRun    -> GET /v1/runs/{runId}/events (SSE with Last-Event-ID)
 *   5. listSessions  -> GET /v1/sessions (GUI conversation v1 inventory)
 *   6. observeSession-> GET /v1/sessions/{sessionId}/events (SSE)
 *   7. steerRun      -> POST /v1/runs/{runId}/steer (never auto-resubmitted)
 *   8. fetchSessionAttachment -> GET /v1/sessions/{id}/attachments/{id} (M2)
 *   9. listFiles      -> GET /v1/files?dir=… (split-viewer design §A)
 *  10. readFileContent-> GET /v1/files/content?path=… (ETag revalidation)
 *
 * Every request carries an X-Request-Id and — only in the bearer fallback —
 * the in-memory bearer (decision 2026-xx-tokenless-auth-and-app-layout
 * §D-A1: tokenless requests send no Authorization header). Errors are
 * branched on problem `code` + `status` only. The app never logs prompts or
 * the bearer.
 */

import {
  decodeConversationFrame,
  type ConversationStreamEvent,
  type RemoteSessionAssetRef,
  type RemoteSessionList,
  type SteerAccepted,
} from "./conversation";
import { GatewayError, parseProblem, responseError, throwProblem } from "./problem";
import {
  BACKOFF_MAX_MS,
  POST_429_MAX_ATTEMPTS,
  STREAM_429_MAX_RETRIES,
  freshJitterMs,
  post429DelayMs,
  streamRetryDelayMs,
} from "./retry";
import { SseParser, Utf8ChunkDecoder, type SseFrame } from "./sse";
import { openXhrSse } from "./xhr-sse";
import {
  validatePrompt,
  type ClientContext,
  type PaneStreamEvent,
  type RemotePaneListOutput,
  type RemotePaneSummary,
  type RemoteRun,
  type RemoteRunPage,
  type RemoteRunSummary,
  type RunStreamEvent,
  type SubmitPromptAccepted,
  type SubmitPromptInput,
} from "./wire";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** M2 attachment body served by the gateway (decision D5): opaque bounded
 * bytes plus the stored media type. Rendered via the app's attachment cache. */
export type AttachmentBody = {
  mimeType: string;
  bytes: Uint8Array;
};

/** One entry of GET /v1/files (split-viewer design §A wire shape). */
export type RemoteFileEntry = {
  name: string;
  size: number;
  isDir: boolean;
  mtimeMs: number;
};

export type FileListing = { entries: RemoteFileEntry[] };

/** GET /v1/files/content result. `notModified` is the ETag 304 path: the
 * cached text stays authoritative and no body was transferred. */
export type FileContentResult =
  | { kind: "ok"; text: string; etag: string }
  | { kind: "notModified"; etag: string };

/** Remote spawn 201 body (decision 2026-xx-session-spawn §D-C). Adapter-
 * local wire shape, like SteerAccepted — the decision keeps the spawn
 * response OUT of the Rust domain (no codegen surface), so this is the
 * app-side view declared at the single protocol boundary. `tmuxTarget` is
 * display-only (tmux may auto-rename windows); `paneId` is the stable
 * handle. `paneId`/`pid`/`tmuxTarget` are null on the Terminal.app path. */
export type SpawnOutcome = {
  spawnId: string;
  tmuxTarget: string | null;
  paneId: string | null;
  pid: number | null;
  cwd: string;
  launcher: "tmux" | "terminal-app";
};

export type ObserveOptions = {
  /** Opaque cursor from a previous connection for replay. */
  lastEventId?: string;
  /** Abort to stop observing (e.g. app backgrounded). */
  signal?: AbortSignal;
  onRetryableError?: (error: unknown, nextDelayMs: number) => void;
};

export class PromptValidationError extends Error {
  override readonly name = "PromptValidationError";
}

function requestId(): string {
  // X-Request-Id is an opaque correlation id (no security requirement). Hermes
  // does not expose the Web Crypto global, so derive bytes from Math.random.
  const bytes = new Uint8Array(12);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return `req_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Whether fetch Responses carry a byte body stream. React Native's
 * whatwg-fetch polyfill does not expose one, so the observe path falls back
 * to XMLHttpRequest incremental events there (xhr-sse.ts). Bun / browsers /
 * Node keep the standard streaming path.
 */
const FETCH_HAS_STREAMING_BODY: boolean = (() => {
  try {
    // A response WITHOUT a body has `body: null` (spec), so probe with one.
    return typeof ReadableStream === "function" && new Response("x").body instanceof ReadableStream;
  } catch {
    return false;
  }
})();

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Decode one SSE frame into the discriminated run-stream union; null if unknown. */
export function decodeRunFrame(frame: SseFrame): RunStreamEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(frame.data);
  } catch {
    return null;
  }
  switch (frame.event) {
    case "status":
      return { kind: "status", frame: data as never };
    case "output":
      return { kind: "output", frame: data as never };
    case "reset":
      return { kind: "reset", frame: data as never };
    case "terminal":
      return { kind: "terminal", frame: data as never };
    case "error":
      return { kind: "error", frame: data as never };
    default:
      return null; // unknown event kinds are ignored by v1 clients
  }
}

/** Decode one SSE frame into the pane-stream union; null if unknown. */
export function decodePaneFrame(frame: SseFrame): PaneStreamEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(frame.data);
  } catch {
    return null;
  }
  switch (frame.event) {
    case "pane_text":
      return { kind: "pane_text", frame: data as never };
    case "pane_reset":
      return { kind: "pane_reset", frame: data as never };
    default:
      return null; // unknown event kinds are ignored by v1 clients
  }
}

export class GatewayClient {
  private readonly config: { baseUrl: string; bearer: string };
  private readonly fetchImpl: FetchLike;

  constructor(config: { baseUrl: string; bearer: string }, fetchImpl: FetchLike = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    // Tokenless mode (decision 2026-xx-tokenless-auth-and-app-layout §D-A1):
    // an empty bearer sends NO Authorization header at all — tailnet
    // membership is the trust boundary. The header appears only for the
    // explicit bearer fallback (§D-A3).
    const auth: Record<string, string> =
      this.config.bearer.length > 0 ? { Authorization: `Bearer ${this.config.bearer}` } : {};
    return {
      ...auth,
      "X-Request-Id": requestId(),
      ...extra,
    };
  }

  private url(path: string, query?: Record<string, string | number>): string {
    const base = `${this.config.baseUrl}/v1${path}`;
    if (query === undefined) {
      return base;
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      params.set(key, String(value));
    }
    return `${base}?${params.toString()}`;
  }

  /**
   * Submit a raw prompt. Network failures and non-429 problems are NEVER
   * retried here (submit is not idempotent; callers reconcile via
   * listRuns/getRun or the composer's user-driven Resend). The one exception
   * is 429 capacity_exhausted: the gateway refuses BEFORE accepting, so a
   * bounded Retry-After-respecting retry cannot double-submit. Past
   * POST_429_MAX_ATTEMPTS the last GatewayError propagates (user-visible).
   */
  async submitPrompt(prompt: string, clientContext?: ClientContext): Promise<SubmitPromptAccepted> {
    const invalid = validatePrompt(prompt);
    if (invalid !== null) {
      throw new PromptValidationError(invalid);
    }
    const input: SubmitPromptInput = {
      prompt,
      clientContext: clientContext ?? null,
    };
    const body = JSON.stringify(input);
    for (let attempt = 1; ; attempt += 1) {
      const response = await this.fetchImpl(this.url("/runs"), {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json; charset=utf-8" }),
        body,
      });
      if (response.status !== 429) {
        if (response.status !== 202) {
          await throwProblem(response);
        }
        return (await response.json()) as SubmitPromptAccepted;
      }
      const error = await responseError(response);
      if (attempt >= POST_429_MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(post429DelayMs(attempt, error.retryAfterMs, freshJitterMs()));
    }
  }

  async listRuns(limit?: number, cursor?: string): Promise<RemoteRunPage> {
    const query: Record<string, string | number> = {};
    if (limit !== undefined) {
      query.limit = limit;
    }
    if (cursor !== undefined) {
      query.cursor = cursor;
    }
    const response = await this.fetchImpl(
      this.url("/runs", Object.keys(query).length > 0 ? query : undefined),
      {
        headers: this.headers(),
      },
    );
    if (response.status !== 200) {
      await throwProblem(response);
    }
    return (await response.json()) as RemoteRunPage;
  }

  async resolveAttention(
    runId: string,
    attentionId: string,
    resolution: string,
  ): Promise<{ runId: string; attentionId: string; resolved: true }> {
    const response = await this.fetchImpl(
      this.url(`/runs/${encodeURIComponent(runId)}/attention/resolve`),
      {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ attentionId, resolution }),
      },
    );
    if (response.status !== 200) await throwProblem(response);
    return (await response.json()) as { runId: string; attentionId: string; resolved: true };
  }

  async getRun(runId: string): Promise<RemoteRun> {
    const response = await this.fetchImpl(this.url(`/runs/${encodeURIComponent(runId)}`), {
      headers: this.headers(),
    });
    if (response.status !== 200) {
      await throwProblem(response);
    }
    return (await response.json()) as RemoteRun;
  }

  /**
   * One SSE connection as decoded text chunks, transport-agnostic.
   *
   * - Streaming-fetch environments: the response body ReadableStream through
   *   the shared UTF-8 chunk decoder (contract-tested reference path).
   * - React Native: XMLHttpRequest incremental events (xhr-sse.ts).
   * Non-200 responses become GatewayError (problem contract) on both paths.
   */
  private async *sseTextChunks(
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, void> {
    if (FETCH_HAS_STREAMING_BODY) {
      const response = await this.fetchImpl(url, { headers, signal });
      if (!response.ok || response.body === null) {
        await throwProblem(response);
        return;
      }
      const decoder = new Utf8ChunkDecoder();
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            return;
          }
          yield decoder.decode(value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }
      return;
    }
    const connection = openXhrSse({ url, headers, signal });
    const status = await connection.status;
    if (status === 0) {
      throw new Error("network error before response headers");
    }
    if (status !== 200) {
      let body = "";
      for await (const chunk of connection.chunks) {
        body += chunk;
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = null; // junk problem bodies tolerate the same as fetch path
      }
      throw new GatewayError(parseProblem(status, parsed));
    }
    yield* connection.chunks;
  }

  /** Terminal mirror v1: pane inventory (GET /v1/panes). */
  /** GET /v1/files?dir=<relative>: working-directory listing (§A). The
   * gateway confines paths and rejects traversal; errors arrive as
   * problems (file_path_rejected, not_found, …) via GatewayError. */
  async listFiles(dir = ""): Promise<FileListing> {
    const response = await this.fetchImpl(
      this.url("/files", dir.length > 0 ? { dir } : undefined),
      {
        headers: this.headers(),
      },
    );
    if (response.status !== 200) {
      await throwProblem(response);
    }
    return (await response.json()) as FileListing;
  }

  /** GET /v1/files/content?path=<relative>: text-only read with ETag
   * revalidation (§A). Pass a previously seen `etag` to short-circuit on
   * 304 — the caller keeps its cached text, nothing is re-downloaded. */
  async readFileContent(path: string, etag?: string): Promise<FileContentResult> {
    const response = await this.fetchImpl(this.url("/files/content", { path }), {
      headers: this.headers(etag !== undefined ? { "If-None-Match": etag } : undefined),
    });
    if (response.status === 304) {
      const notModified = response.headers.get("ETag") ?? etag ?? "";
      return { kind: "notModified", etag: notModified };
    }
    if (response.status !== 200) {
      await throwProblem(response);
    }
    const text = await response.text();
    return { kind: "ok", text, etag: response.headers.get("ETag") ?? "" };
  }

  async listPanes(): Promise<RemotePaneListOutput> {
    const response = await this.fetchImpl(this.url("/panes"), {
      headers: this.headers(),
    });
    if (response.status !== 200) {
      await throwProblem(response);
    }
    return (await response.json()) as RemotePaneListOutput;
  }

  /**
   * Observe one worker pane until it is gone (paneGone reset closes the
   * stream) or the signal aborts. Cursor/retry semantics mirror observeRun;
   * dedupe of repeated snapshots is the caller's job (paneId + revision).
   */
  async observePane(
    paneId: string,
    onEvent: (event: PaneStreamEvent) => void,
    options: ObserveOptions = {},
  ): Promise<void> {
    let cursor = options.lastEventId;
    let backoffMs = 1_000;
    let rateLimited = 0; // consecutive 429s; reset when a frame is delivered

    for (;;) {
      if (options.signal?.aborted) {
        return;
      }
      try {
        const headers = this.headers({
          Accept: "text/event-stream",
          ...(cursor !== undefined ? { "Last-Event-ID": cursor } : {}),
        });
        const chunks = this.sseTextChunks(
          this.url(`/panes/${encodeURIComponent(paneId)}/events`),
          headers,
          options.signal,
        );
        const parser = new SseParser();
        let sawGone = false;
        for await (const chunk of chunks) {
          for (const frame of parser.push(chunk)) {
            const event = decodePaneFrame(frame);
            if (event === null) {
              continue;
            }
            if (frame.id !== null) {
              cursor = frame.id;
            }
            onEvent(event);
            rateLimited = 0; // a delivered frame proves the stream recovered
            if (event.kind === "pane_reset" && event.frame.reason === "paneGone") {
              sawGone = true;
              break;
            }
          }
          if (sawGone) {
            break;
          }
        }
        if (sawGone) {
          return; // gateway closed after the pane_gone reset; do not reconnect
        }
        // Clean non-terminal disconnect: immediate reconnect with cursor.
      } catch (error) {
        if (options.signal?.aborted) {
          return;
        }
        if (error instanceof GatewayError && !error.retryable) {
          throw error; // 401/404/… — the server said do not retry
        }
        if (error instanceof GatewayError && error.problem.status === 429) {
          rateLimited += 1;
          if (rateLimited > STREAM_429_MAX_RETRIES) {
            throw error; // persistent capacity refusal: give up, user-visible
          }
        }
        // A Retry-After hint wins verbatim; otherwise exp backoff + jitter.
        const delay = streamRetryDelayMs(
          error instanceof GatewayError ? error.retryAfterMs : null,
          backoffMs,
          freshJitterMs(),
        );
        options.onRetryableError?.(error, delay);
        await sleep(delay, options.signal);
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
        continue;
      }
    }
  }

  /**
   * GUI conversation v1: session inventory (GET /v1/sessions).
   * Sessions carry the sessionId↔runId correlation as adapter metadata
   * (decision 2026-xx-gui-conversation D1); uncorrelated sessions have
   * `runId: null` and the app renders that honestly.
   */
  async listSessions(): Promise<RemoteSessionList> {
    const response = await this.fetchImpl(this.url("/sessions"), {
      headers: this.headers(),
    });
    if (response.status !== 200) {
      await throwProblem(response);
    }
    return (await response.json()) as RemoteSessionList;
  }

  /**
   * M2 attachments (decision D5): fetch one attachment body (GET
   * /v1/sessions/{sessionId}/attachments/{attachmentId}). Bodies live
   * outside the SSE ring buffer — a missing/evicted body is a 404 problem
   * (`attachment_not_found`), never a stream error. The media type comes
   * from the response header; bytes are returned verbatim.
   */
  async fetchSessionAttachment(sessionId: string, attachmentId: string): Promise<AttachmentBody> {
    const response = await this.fetchImpl(
      this.url(
        `/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`,
      ),
      { headers: this.headers() },
    );
    if (response.status !== 200) {
      await throwProblem(response);
    }
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();
    return {
      mimeType:
        mimeType !== undefined && mimeType.length > 0 ? mimeType : "application/octet-stream",
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  }

  /**
   * M2 attachment body URL — the GET route `fetchSessionAttachment` reads,
   * composed for direct use by native image loading (the composer preview
   * renders this URL; it serves the same body bytes). Display-level only:
   * no request is made here.
   */
  sessionAttachmentUrl(sessionId: string, attachmentId: string): string {
    return this.url(
      `/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  }

  /**
   * M2 attachment UPLOAD (decision D5, app → gateway): POST
   * /v1/sessions/{sessionId}/attachments carries the raw image bytes; the
   * 201 body is the reference-shaped `RemoteSessionAssetRef` (the body now
   * lives in the gateway's session store, addressed by attachmentId). The
   * media type is allow-listed server-side (image/png|jpeg|webp|gif);
   * failures surface as deterministic problems — 400 `invalid_media_type`,
   * 404 `session_not_found`, 413 `attachment_too_large`. Never retried.
   *
   * The body arrives as a runtime-produced Blob (readPhotoBlob's
   * `response.blob()`), NOT `new Blob([typedArray])`: React Native's Blob
   * constructor rejects ArrayBuffer/ArrayBufferView parts, while blobs
   * built by the networking layer carry the exact response bytes. The
   * declared Content-Type stays authoritative (the gateway allow-lists it;
   * blob.type is display-only).
   */
  async uploadSessionAttachment(
    sessionId: string,
    file: { mimeType: string; body: Blob },
  ): Promise<RemoteSessionAssetRef> {
    const response = await this.fetchImpl(
      this.url(`/sessions/${encodeURIComponent(sessionId)}/attachments`),
      {
        method: "POST",
        headers: this.headers({ "Content-Type": file.mimeType }),
        body: file.body,
      },
    );
    if (response.status !== 201) {
      await throwProblem(response);
    }
    return (await response.json()) as RemoteSessionAssetRef;
  }

  /**
   * Remote spawn (decision 2026-xx-session-spawn §D-C): POST
   * /v1/sessions/spawn asks the host to open a NEW pi TUI in a fresh tmux
   * window. The 201 body is the launcher handle ONLY — it deliberately
   * carries no sessionId (the real one is fixed when the spawned pi's tap
   * registers with the collector), so discovery is the caller's job via
   * GET /v1/sessions (`awaitSpawnedSession` in features/session-spawn).
   * Never retried: spawning is not idempotent — a retry would open a second
   * terminal window. Failures are deterministic problems (`spawn_disabled`,
   * `spawn_tmux_unavailable`, `spawn_cwd_*`, …) surfaced as GatewayError.
   */
  async spawnTuiSession(cwd?: string): Promise<SpawnOutcome> {
    const response = await this.fetchImpl(this.url("/sessions/spawn"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json; charset=utf-8" }),
      body: JSON.stringify(cwd === undefined ? {} : { cwd }),
    });
    if (response.status !== 201) {
      await throwProblem(response);
    }
    return (await response.json()) as SpawnOutcome;
  }

  /**
   * D5 composer input for a LIVE session: POST /v1/sessions/{sessionId}/input
   * carries { text, attachments } — refs only, never bytes. 202 → { inputId }.
   * Deterministic problems: 400 (empty input / malformed refs), 404
   * `session_not_found` / `attachment_not_found`, 409 `session_not_live`,
   * 413 `prompt_too_large`. Never retried (the observed user_message frame
   * is the delivery evidence).
   */
  async submitSessionInput(
    sessionId: string,
    input: { text: string; attachments: ReadonlyArray<{ attachmentId: string }> },
  ): Promise<{ inputId: string }> {
    const response = await this.fetchImpl(
      this.url(`/sessions/${encodeURIComponent(sessionId)}/input`),
      {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json; charset=utf-8" }),
        body: JSON.stringify({ text: input.text, attachments: [...input.attachments] }),
      },
    );
    if (response.status !== 202) {
      await throwProblem(response);
    }
    return (await response.json()) as { inputId: string };
  }

  /**
   * GUI conversation v1: accept guidance for a live run (POST
   * /v1/runs/{runId}/steer, decision D3). Validation mirrors submit (non-empty,
   * MAX_PROMPT_BYTES) and rejects before any network round trip. The mailbox
   * delivers the guidance at the next turn boundary; the conversation stream
   * mirrors acceptance as a `steer_queued` frame and the tap surfaces the
   * `source=steer` user message (D4 §4). Like submit, steer is not retried
   * on network failure — the single 429 exception follows submitPrompt
   * (a 429 refusal precedes acceptance, so the retry cannot double-steer).
   */
  async steerRun(runId: string, message: string): Promise<SteerAccepted> {
    const invalid = validatePrompt(message);
    if (invalid !== null) {
      throw new PromptValidationError(invalid);
    }
    const body = JSON.stringify({ message });
    for (let attempt = 1; ; attempt += 1) {
      const response = await this.fetchImpl(this.url(`/runs/${encodeURIComponent(runId)}/steer`), {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json; charset=utf-8" }),
        body,
      });
      if (response.status !== 429) {
        if (response.status !== 202) {
          await throwProblem(response);
        }
        // The steer id is optional feedback (D4 §4 pairs markers by order, not id).
        let steerBody: unknown = null;
        try {
          steerBody = await response.json();
        } catch {
          steerBody = null;
        }
        const steerId =
          typeof steerBody === "object" &&
          steerBody !== null &&
          typeof (steerBody as { steerId?: unknown }).steerId === "string"
            ? (steerBody as { steerId: string }).steerId
            : null;
        return { steerId };
      }
      const error = await responseError(response);
      if (attempt >= POST_429_MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(post429DelayMs(attempt, error.retryAfterMs, freshJitterMs()));
    }
  }

  /**
   * Observe one session conversation until the session is gone (sessionGone
   * reset closes the stream) or the signal aborts. Cursor/retry semantics
   * mirror observeRun/observePane; dedupe and rendering are the caller's job
   * (identity-keyed, ConversationProjection).
   */
  async observeSession(
    sessionId: string,
    onEvent: (event: ConversationStreamEvent) => void,
    options: ObserveOptions = {},
  ): Promise<void> {
    let cursor = options.lastEventId;
    let backoffMs = 1_000;
    let rateLimited = 0; // consecutive 429s; reset when a frame is delivered

    for (;;) {
      if (options.signal?.aborted) {
        return;
      }
      try {
        const headers = this.headers({
          Accept: "text/event-stream",
          ...(cursor !== undefined ? { "Last-Event-ID": cursor } : {}),
        });
        const chunks = this.sseTextChunks(
          this.url(`/sessions/${encodeURIComponent(sessionId)}/events`),
          headers,
          options.signal,
        );
        const parser = new SseParser();
        let sawGone = false;
        for await (const chunk of chunks) {
          for (const frame of parser.push(chunk)) {
            const event = decodeConversationFrame(frame);
            if (event === null) {
              continue; // unknown frame families are ignored (D4 §7)
            }
            if (frame.id !== null) {
              cursor = frame.id;
            }
            onEvent(event);
            rateLimited = 0; // a delivered frame proves the stream recovered
            if (event.kind === "conversation_reset" && event.frame.reason === "sessionGone") {
              sawGone = true;
              break;
            }
          }
          if (sawGone) {
            break;
          }
        }
        if (sawGone) {
          return; // gateway closed after the session_gone reset; do not reconnect
        }
        // Clean non-terminal disconnect: immediate reconnect with cursor.
      } catch (error) {
        if (options.signal?.aborted) {
          return;
        }
        if (error instanceof GatewayError && !error.retryable) {
          throw error; // 401/404/… — the server said do not retry
        }
        if (error instanceof GatewayError && error.problem.status === 429) {
          rateLimited += 1;
          if (rateLimited > STREAM_429_MAX_RETRIES) {
            throw error; // persistent capacity refusal: give up, user-visible
          }
        }
        // A Retry-After hint wins verbatim; otherwise exp backoff + jitter.
        const delay = streamRetryDelayMs(
          error instanceof GatewayError ? error.retryAfterMs : null,
          backoffMs,
          freshJitterMs(),
        );
        options.onRetryableError?.(error, delay);
        await sleep(delay, options.signal);
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
        continue;
      }
    }
  }

  /**
   * Observe a run until a terminal event arrives (or the signal aborts).
   *
   * - Non-retryable problems (401/404/406, `retryable: false` error events)
   *   throw GatewayError.
   * - Clean non-terminal disconnects reconnect immediately with Last-Event-ID.
   * - `error` events and 429s back off 1s..30s (+jitter); a Retry-After hint
   *   wins verbatim, and more than STREAM_429_MAX_RETRIES consecutive 429s
   *   give up with the GatewayError (user-visible via streamError).
   */
  async observeRun(
    runId: string,
    onEvent: (event: RunStreamEvent) => void,
    options: ObserveOptions = {},
  ): Promise<void> {
    let cursor = options.lastEventId;
    let backoffMs = 1_000;
    let rateLimited = 0; // consecutive 429s; reset when a frame is delivered

    for (;;) {
      if (options.signal?.aborted) {
        return;
      }
      try {
        const headers = this.headers({
          Accept: "text/event-stream",
          ...(cursor !== undefined ? { "Last-Event-ID": cursor } : {}),
        });
        const chunks = this.sseTextChunks(
          this.url(`/runs/${encodeURIComponent(runId)}/events`),
          headers,
          options.signal,
        );
        const parser = new SseParser();
        let sawTerminal = false;
        for await (const chunk of chunks) {
          for (const frame of parser.push(chunk)) {
            const event = decodeRunFrame(frame);
            if (event === null) {
              continue;
            }
            if (frame.id !== null) {
              cursor = frame.id;
            }
            if (event.kind === "error") {
              // Transport-level failure: catch below retries when retryable,
              // otherwise surfaces the problem to the caller.
              throw new GatewayError(event.frame);
            }
            onEvent(event);
            rateLimited = 0; // a delivered frame proves the stream recovered
            if (event.kind === "terminal") {
              sawTerminal = true;
              break;
            }
          }
          if (sawTerminal) {
            break;
          }
        }
        if (sawTerminal) {
          return; // gateway closed after terminal; do not reconnect
        }
        // Clean non-terminal disconnect: immediate reconnect with cursor.
      } catch (error) {
        if (options.signal?.aborted) {
          return;
        }
        if (error instanceof GatewayError && !error.retryable) {
          throw error; // 401/404/… — the server said do not retry
        }
        if (error instanceof GatewayError && error.problem.status === 429) {
          rateLimited += 1;
          if (rateLimited > STREAM_429_MAX_RETRIES) {
            throw error; // persistent capacity refusal: give up, user-visible
          }
        }
        // A Retry-After hint wins verbatim; otherwise exp backoff + jitter.
        const delay = streamRetryDelayMs(
          error instanceof GatewayError ? error.retryAfterMs : null,
          backoffMs,
          freshJitterMs(),
        );
        options.onRetryableError?.(error, delay);
        await sleep(delay, options.signal);
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
        continue;
      }
    }
  }
}

export type { RemoteRun, RemoteRunPage, RemoteRunSummary, SubmitPromptAccepted, RemotePaneSummary };
export type {
  ConversationStreamEvent,
  RemoteSessionList,
  RemoteSessionSummary,
  SteerAccepted,
} from "./conversation";
