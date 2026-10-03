/**
 * Local mock Loop gateway for contract-client tests (ADR §4 wire contract +
 * decision 2026-xx-terminal-mirror pane surface).
 *
 * Implements just enough of POST /v1/runs, GET /v1/runs, GET /v1/runs/{id},
 * GET /v1/panes and the two SSE streams to exercise the app client: bearer
 * auth, X-Request-Id echo, problem responses, bigint-as-string, SSE replay
 * via Last-Event-ID, stale-cursor reset, clean non-terminal disconnect, pane
 * revision dedupe/coalescing, and pane_gone close.
 *
 * Runs on an ephemeral loopback port. No network beyond localhost, no model
 * calls, no credentials or prompts persisted or logged.
 */

import {
  ACCEPTED,
  FRAME_IDS,
  OLD_RUN_ID,
  OUTPUT_FRAME_1,
  OUTPUT_FRAME_2,
  PANE_FRAMES,
  PANE_FRAME_IDS,
  RESET_FRAME,
  RUN,
  RUN_ID,
  RUN_PAGE,
  STATUS_FRAME,
  TERMINAL_FRAME,
  TOKEN,
} from "./fixtures";
import {
  ATTACHMENT_ID,
  ATTACHMENT_PNG_BASE64,
  CONVERSATION_FRAMES,
  CONVERSATION_FRAME_IDS,
  CURSOR_RESET,
  ORPHAN_SESSION_ID,
  SESSION_GONE,
  SESSION_ID,
  SESSION_LIST,
} from "./conversation-fixtures";
import type { GatewayProblem } from "../src/gateway-client/wire";

export type RecordedRequest = {
  method: string;
  path: string;
  authorization: string | null;
  requestId: string | null;
  accept: string | null;
  body: string | null;
};

/** MockGateway = existing run/pane surfaces + GUI conversation v1 routes. */
export type MockGateway = {
  url: string;
  stop: () => void;
  requests: RecordedRequest[];
  /** Last-Event-ID header of each /events connection, in order. */
  eventLastEventIds: (string | null)[];
  /** Last-Event-ID header of each pane /events connection, in order. */
  paneEventLastEventIds: (string | null)[];
  /** Last-Event-ID header of each session /events connection, in order. */
  sessionEventLastEventIds: (string | null)[];
  /** Drop the TCP stream after the first frame of the CURRENT next connection. */
  disconnectAfterFirstFrame: () => void;
  /** Same, but for the next SESSION events connection. */
  disconnectNextSessionStreamAfterFirstFrame: () => void;
};

function problem(
  status: number,
  code: string,
  title: string,
  detail: string,
  requestId: string,
  retryable: boolean,
  fields: Record<string, string> | null = null,
): GatewayProblem {
  return {
    type: `https://loop.local/problems/${code}`,
    title,
    status,
    code,
    detail,
    requestId,
    retryable,
    fields,
  };
}

function sseFrame(id: string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const KEEPALIVE = ": keepalive\n\n";

export function createMockGateway(): MockGateway {
  const requests: RecordedRequest[] = [];
  const eventLastEventIds: (string | null)[] = [];
  const paneEventLastEventIds: (string | null)[] = [];
  const sessionEventLastEventIds: (string | null)[] = [];
  let dropNextStreamAfterFirstFrame = false;
  let dropNextSessionStreamAfterFirstFrame = false;
  // M2 upload state (D5): refs handed out by the upload endpoint resolve on
  // the input endpoint — mirrors the gateway's session-scoped store.
  const uploadedAttachments = new Map<string, { mimeType: string; byteLen: number }>();
  let uploadCounter = 0;
  let inputCounter = 0;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const authorization = request.headers.get("Authorization");
      const clientRequestId = request.headers.get("X-Request-Id");
      const serverRequestId = clientRequestId ?? `req_mock_${requests.length}`;
      const reflectId = { "X-Request-Id": serverRequestId };

      const record = async (): Promise<RecordedRequest> => {
        const body = request.method === "POST" ? await request.text() : null;
        const entry: RecordedRequest = {
          method: request.method,
          path: url.pathname,
          authorization,
          requestId: clientRequestId,
          accept: request.headers.get("Accept"),
          body,
        };
        requests.push(entry);
        return entry;
      };

      const unauthorized = (): Response => {
        const body = problem(
          401,
          "unauthorized",
          "Unauthorized",
          "Bearer missing or invalid.",
          serverRequestId,
          false,
        );
        return Response.json(body, {
          status: 401,
          headers: { "Content-Type": "application/problem+json", ...reflectId },
        });
      };

      if (authorization !== `Bearer ${TOKEN}`) {
        await record();
        return unauthorized();
      }

      // ── POST /v1/runs ────────────────────────────────────────────────
      if (request.method === "POST" && url.pathname === "/v1/runs") {
        const entry = await record();
        let parsed: Record<string, unknown> = {};
        if (entry.body !== null) {
          parsed = JSON.parse(entry.body) as Record<string, unknown>;
        }
        const prompt = typeof parsed.prompt === "string" ? parsed.prompt : "";
        if (prompt.trim().length === 0) {
          const body = problem(
            400,
            "invalid_request",
            "Invalid request",
            "Schema validation failed.",
            serverRequestId,
            false,
            {
              prompt: "must not be empty",
            },
          );
          return Response.json(body, {
            status: 400,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        return Response.json(ACCEPTED, { status: 202, headers: reflectId });
      }

      // ── GET /v1/runs and /v1/runs/{id} ─────────────────

      // ── GUI conversation v1: POST /v1/runs/{id}/steer ────────
      const steerMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/steer$/);
      if (request.method === "POST" && steerMatch !== null) {
        const entry = await record();
        if (decodeURIComponent(steerMatch[1]!) !== RUN_ID) {
          const body = problem(
            404,
            "run_not_found",
            "Run not found",
            "The requested run does not exist.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 404,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        let parsed: Record<string, unknown> = {};
        if (entry.body !== null) {
          parsed = JSON.parse(entry.body) as Record<string, unknown>;
        }
        const message = typeof parsed.message === "string" ? parsed.message : "";
        if (message.trim().length === 0) {
          const body = problem(
            400,
            "invalid_request",
            "Invalid request",
            "Schema validation failed.",
            serverRequestId,
            false,
            {
              message: "must not be empty",
            },
          );
          return Response.json(body, {
            status: 400,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        if (new TextEncoder().encode(message).byteLength > 64 * 1024) {
          const body = problem(
            413,
            "message_too_large",
            "Payload too large",
            "The steer message exceeds the bound.",
            serverRequestId,
            false,
            {
              message: "must be at most 65536 bytes",
            },
          );
          return Response.json(body, {
            status: 413,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        return Response.json(
          { steerId: `st_${requests.length}` },
          { status: 202, headers: reflectId },
        );
      }

      // ── GUI conversation v1: GET /v1/sessions ────────────
      if (request.method === "GET" && url.pathname === "/v1/sessions") {
        await record();
        return Response.json(SESSION_LIST, { headers: reflectId });
      }

      // ── M2 (D5): GET /v1/sessions/{id}/attachments/{attachmentId} ──
      // Serves the LOCAL-IMAGE fixture bytes for the referenced ref; any
      // other id is an honest attachment_not_found (evicted/never stored).
      const attachmentMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/attachments\/([^/]+)$/);
      if (request.method === "GET" && attachmentMatch !== null) {
        await record();
        const attachmentId = decodeURIComponent(attachmentMatch[2]!);
        if (attachmentId === ATTACHMENT_ID) {
          return new Response(new Uint8Array(Buffer.from(ATTACHMENT_PNG_BASE64, "base64")), {
            status: 200,
            headers: { "Content-Type": "image/png", "Cache-Control": "no-store", ...reflectId },
          });
        }
        const missing = problem(
          404,
          "attachment_not_found",
          "Attachment not found",
          "The attachment body is not stored (evicted or never arrived).",
          serverRequestId,
          false,
        );
        return Response.json(missing, {
          status: 404,
          headers: { "Content-Type": "application/problem+json", ...reflectId },
        });
      }

      // ── M2 (D5): POST /v1/sessions/{id}/attachments (app upload) ──
      // Raw bytes in, reference-shaped RemoteSessionAssetRef out (201).
      // Deterministic problems mirror the real gateway: 404 session_not_found,
      // 400 invalid_media_type (allow-list), 413 attachment_too_large.
      const uploadMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/attachments$/);
      if (request.method === "POST" && uploadMatch !== null) {
        // Read the body FIRST — request.text() in record() would consume it.
        const bytes = new Uint8Array(await request.arrayBuffer());
        requests.push({
          method: request.method,
          path: url.pathname,
          authorization,
          requestId: clientRequestId,
          accept: request.headers.get("Accept"),
          body: `(${bytes.byteLength} binary bytes)`,
        });
        const sessionId = decodeURIComponent(uploadMatch[1]!);
        if (sessionId !== SESSION_ID && sessionId !== ORPHAN_SESSION_ID) {
          const body = problem(
            404,
            "session_not_found",
            "Session not found",
            "No such session is observed.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 404,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        const mediaType =
          (request.headers.get("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        const UPLOADABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
        if (!UPLOADABLE.has(mediaType) || bytes.byteLength === 0) {
          const body = problem(
            400,
            "invalid_media_type",
            "Invalid media type",
            "Only image/png, image/jpeg, image/webp, image/gif uploads are accepted.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 400,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        if (bytes.byteLength > 8 * 1024 * 1024) {
          const body = problem(
            413,
            "attachment_too_large",
            "Attachment too large",
            "The attachment exceeds the per-asset bound.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 413,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        uploadCounter += 1;
        const attachmentId = `up_mock_${String(uploadCounter).padStart(4, "0")}`;
        uploadedAttachments.set(attachmentId, { mimeType: mediaType, byteLen: bytes.byteLength });
        return Response.json(
          { attachmentId, mimeType: mediaType, byteLen: bytes.byteLength },
          { status: 201, headers: reflectId },
        );
      }

      // ── M2 (D5): POST /v1/sessions/{id}/input (live-session input) ──
      // { text, attachments } with REFS only. Deterministic problems: 404
      // session_not_found / attachment_not_found, 409 session_not_live,
      // 400 invalid_request (empty text+refs), 202 { inputId }.
      const inputMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/input$/);
      if (request.method === "POST" && inputMatch !== null) {
        const entry = await record();
        const sessionId = decodeURIComponent(inputMatch[1]!);
        if (sessionId !== SESSION_ID && sessionId !== ORPHAN_SESSION_ID) {
          const body = problem(
            404,
            "session_not_found",
            "Session not found",
            "No such session is observed.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 404,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        // The orphan session is known but never live (inventory: state ended).
        if (sessionId === ORPHAN_SESSION_ID) {
          const body = problem(
            409,
            "session_not_live",
            "Session not live",
            "The session has no live tap to deliver input to.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 409,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        let parsed: { text?: unknown; attachments?: unknown } = {};
        if (entry.body !== null) {
          parsed = JSON.parse(entry.body) as { text?: unknown; attachments?: unknown };
        }
        const text = typeof parsed.text === "string" ? parsed.text : null;
        if (text === null || !Array.isArray(parsed.attachments)) {
          const body = problem(
            400,
            "invalid_request",
            "Invalid request",
            "Schema validation failed.",
            serverRequestId,
            false,
            {
              input: "text must be a string and attachments must be an array",
            },
          );
          return Response.json(body, {
            status: 400,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        const attachments: unknown[] = parsed.attachments;
        if (text.trim().length === 0 && attachments.length === 0) {
          const body = problem(
            400,
            "invalid_request",
            "Invalid request",
            "Schema validation failed.",
            serverRequestId,
            false,
            {
              input: "must not be empty",
            },
          );
          return Response.json(body, {
            status: 400,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        for (const raw of attachments) {
          const attachmentId =
            typeof raw === "object" && raw !== null
              ? (raw as { attachmentId?: unknown }).attachmentId
              : undefined;
          const stored =
            typeof attachmentId === "string" ? uploadedAttachments.get(attachmentId) : undefined;
          const isFixture = attachmentId === ATTACHMENT_ID;
          if (typeof attachmentId !== "string" || (stored === undefined && !isFixture)) {
            const body = problem(
              404,
              "attachment_not_found",
              "Attachment not found",
              "The referenced attachment body is not stored.",
              serverRequestId,
              false,
            );
            return Response.json(body, {
              status: 404,
              headers: { "Content-Type": "application/problem+json", ...reflectId },
            });
          }
        }
        inputCounter += 1;
        return Response.json(
          { inputId: `in_mock_${String(inputCounter).padStart(4, "0")}` },
          { status: 202, headers: reflectId },
        );
      }

      // ── GET /v1/runs and /v1/runs/{id} ───────────────────────────────
      if (request.method === "GET" && url.pathname === "/v1/runs") {
        await record();
        return Response.json(RUN_PAGE, { headers: reflectId });
      }

      // ── GET /v1/panes (terminal mirror v1) ───────────────────────────
      if (request.method === "GET" && url.pathname === "/v1/panes") {
        await record();
        return Response.json(PANE_FRAMES.list, { headers: reflectId });
      }

      // ── Split-viewer design §A: GET /v1/files, /v1/files/content ────
      // A small in-memory tree that mirrors the gateway's fail-closed
      // behavior: traversal → 400, missing → 404, binary → 415, ETag →
      // 304. No filesystem access (test runtime hermeticity).
      if (url.pathname === "/v1/files" || url.pathname === "/v1/files/content") {
        await record();
        const MOCK_FILES: Record<string, string> = {
          "docs/findings.md": "# Findings\n\n- `bun run check` passes\n**done**\n",
          "docs/diagnosis.md": "# Diagnosis\nplain paragraph\n",
        };
        const MOCK_DIRS: Record<string, string[]> = {
          "": ["docs"],
          docs: ["findings.md", "diagnosis.md"],
        };
        const reject = (status: number, code: string, detail: string): Response =>
          Response.json(problem(status, code, code, detail, serverRequestId, false), {
            status,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        if (url.pathname === "/v1/files") {
          const dir = url.searchParams.get("dir") ?? "";
          if (dir.split("/").includes("..")) {
            return reject(400, "file_path_rejected", "path traversal is rejected");
          }
          const names = MOCK_DIRS[dir];
          if (names === undefined) return reject(404, "not_found", "No such directory.");
          const entries = names.map((name) => {
            const isDir = MOCK_DIRS[`${dir.length === 0 ? "" : `${dir}/`}${name}`] !== undefined;
            const size = isDir
              ? 0
              : (MOCK_FILES[`${dir.length === 0 ? "" : `${dir}/`}${name}`]?.length ?? 0);
            return { name, size, isDir, mtimeMs: 0 };
          });
          // Same ordering contract as the gateway (§A): dirs first, then names.
          entries.sort((a, b) =>
            a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
          );
          return Response.json({ entries }, { headers: reflectId });
        }
        const path = url.searchParams.get("path") ?? "";
        if (path.split("/").includes("..")) {
          return reject(400, "file_path_rejected", "path traversal is rejected");
        }
        const text = MOCK_FILES[path];
        if (path === "assets/logo.png") {
          return reject(415, "file_not_text", "Not text.");
        }
        if (text === undefined) return reject(404, "not_found", "No such file.");
        const etag = `"${Bun.hash(text).toString(16)}"`;
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304, headers: { ETag: etag, ...reflectId } });
        }
        return new Response(text, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8", ETag: etag, ...reflectId },
        });
      }

      const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
      if (request.method === "GET" && runMatch !== null) {
        await record();
        if (decodeURIComponent(runMatch[1]!) !== RUN_ID && runMatch[1] !== OLD_RUN_ID) {
          const body = problem(
            404,
            "run_not_found",
            "Run not found",
            "The requested run does not exist.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 404,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        return Response.json(RUN, { headers: reflectId });
      }

      // ── GET /v1/panes/{paneId}/events (SSE) ──────────────────────────
      const paneEventsMatch = url.pathname.match(/^\/v1\/panes\/([^/]+)\/events$/);
      if (request.method === "GET" && paneEventsMatch !== null) {
        const entry = await record();
        const accept = entry.accept ?? "";
        if (!accept.includes("text/event-stream")) {
          const body = problem(
            406,
            "stream_not_acceptable",
            "Not Acceptable",
            "SSE endpoint requires Accept: text/event-stream.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 406,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        const paneId = decodeURIComponent(paneEventsMatch[1]!);
        if (paneId !== PANE_FRAMES.list.panes[0]?.paneId) {
          const body = problem(
            404,
            "pane_not_found",
            "Pane not found",
            "The requested pane does not exist.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 404,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }

        const lastEventId = request.headers.get("Last-Event-ID");
        paneEventLastEventIds.push(lastEventId);
        const drop = dropNextStreamAfterFirstFrame;
        dropNextStreamAfterFirstFrame = false;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            const push = (chunk: string) => controller.enqueue(encoder.encode(chunk));
            const close = () => controller.close();

            push(KEEPALIVE); // comments never consume the cursor
            const seen = new Set<string>();
            for (const text of PANE_FRAMES.texts) seen.add(String(text.revision));
            if (lastEventId !== null && !seen.has(lastEventId) && lastEventId !== "head") {
              // Stale/foreign cursor: converge on a reset, then the latest text.
              push(sseFrame(PANE_FRAME_IDS.reset, "pane_reset", PANE_FRAMES.resetCursor));
            }
            if (lastEventId === null || lastEventId === "head") {
              for (const [index, text] of PANE_FRAMES.texts.entries()) {
                if (drop && index === 1) break;
                push(sseFrame(PANE_FRAME_IDS.text(index), "pane_text", text));
              }
              if (drop) {
                close();
                return;
              }
            } else if (seen.has(lastEventId)) {
              const startIndex =
                PANE_FRAMES.texts.findIndex((text) => String(text.revision) === lastEventId) + 1;
              for (const text of PANE_FRAMES.texts.slice(startIndex)) {
                push(
                  sseFrame(PANE_FRAME_IDS.text(PANE_FRAMES.texts.indexOf(text)), "pane_text", text),
                );
              }
            }
            // Pane termination: one pane_reset(paneGone), then the stream closes.
            push(sseFrame(PANE_FRAME_IDS.gone, "pane_reset", PANE_FRAMES.gone));
            close();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            ...reflectId,
          },
        });
      }

      // ── GET /v1/runs/{id}/events (SSE) ───────────────────────────────
      const eventsMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/events$/);
      if (request.method === "GET" && eventsMatch !== null) {
        const entry = await record();
        const accept = entry.accept ?? "";
        if (!accept.includes("text/event-stream")) {
          const body = problem(
            406,
            "stream_not_acceptable",
            "Not Acceptable",
            "SSE endpoint requires Accept: text/event-stream.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 406,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        if (decodeURIComponent(eventsMatch[1]!) !== RUN_ID) {
          const body = problem(
            404,
            "run_not_found",
            "Run not found",
            "The requested run does not exist.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 404,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }

        const lastEventId = request.headers.get("Last-Event-ID");
        eventLastEventIds.push(lastEventId);
        const drop = dropNextStreamAfterFirstFrame;
        dropNextStreamAfterFirstFrame = false;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            const push = (chunk: string) => controller.enqueue(encoder.encode(chunk));
            const close = () => controller.close();

            // Stale cursor from a previous gateway generation: reset first.
            if (
              lastEventId !== null &&
              lastEventId !== FRAME_IDS.status &&
              lastEventId !== FRAME_IDS.output1 &&
              lastEventId !== FRAME_IDS.output2
            ) {
              push(sseFrame(FRAME_IDS.reset, "reset", RESET_FRAME));
            }
            push(KEEPALIVE); // comments never consume the cursor
            if (lastEventId === null) {
              push(sseFrame(FRAME_IDS.status, "status", STATUS_FRAME));
              if (drop) {
                close();
                return;
              }
              push(sseFrame(FRAME_IDS.output1, "output", OUTPUT_FRAME_1));
              push(sseFrame(FRAME_IDS.output2, "output", OUTPUT_FRAME_2));
            } else if (lastEventId === FRAME_IDS.status) {
              push(sseFrame(FRAME_IDS.output1, "output", OUTPUT_FRAME_1));
              push(sseFrame(FRAME_IDS.output2, "output", OUTPUT_FRAME_2));
            } else if (lastEventId === FRAME_IDS.output1) {
              push(sseFrame(FRAME_IDS.output2, "output", OUTPUT_FRAME_2));
            } // stale path already emitted reset + falls through to terminal
            push(sseFrame(FRAME_IDS.terminal, "terminal", TERMINAL_FRAME));
            close();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            ...reflectId,
          },
        });
      }

      // ── GET /v1/sessions/{id}/events (SSE) ──────────────
      const sessionEventsMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/events$/);
      if (request.method === "GET" && sessionEventsMatch !== null) {
        const entry = await record();
        const accept = entry.accept ?? "";
        if (!accept.includes("text/event-stream")) {
          const body = problem(
            406,
            "stream_not_acceptable",
            "Not Acceptable",
            "SSE endpoint requires Accept: text/event-stream.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 406,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }
        const sessionId = decodeURIComponent(sessionEventsMatch[1]!);
        if (sessionId !== SESSION_ID && sessionId !== ORPHAN_SESSION_ID) {
          const body = problem(
            404,
            "session_not_found",
            "Session not found",
            "The requested session does not exist.",
            serverRequestId,
            false,
          );
          return Response.json(body, {
            status: 404,
            headers: { "Content-Type": "application/problem+json", ...reflectId },
          });
        }

        const lastEventId = request.headers.get("Last-Event-ID");
        sessionEventLastEventIds.push(lastEventId);
        const drop = dropNextSessionStreamAfterFirstFrame;
        dropNextSessionStreamAfterFirstFrame = false;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            const push = (chunk: string) => controller.enqueue(encoder.encode(chunk));
            const close = () => controller.close();

            const knownIds = new Set(CONVERSATION_FRAMES.map((frame) => frame.id));
            const stale =
              lastEventId !== null && lastEventId !== "head" && !knownIds.has(lastEventId);
            const fromIndex =
              lastEventId === null || lastEventId === "head"
                ? 0
                : CONVERSATION_FRAMES.findIndex((frame) => frame.id === lastEventId) + 1;
            if (stale) {
              // Stale/foreign cursor: converge on a reset, then fresh replay.
              push(sseFrame(CONVERSATION_FRAME_IDS.reset, "conversation_reset", CURSOR_RESET));
              if (drop) {
                close();
                return;
              }
              push(KEEPALIVE);
              for (const frame of CONVERSATION_FRAMES) {
                push(sseFrame(frame.id, frame.event, frame.payload));
              }
            } else {
              push(KEEPALIVE); // comments never consume the cursor
              for (const [index, frame] of CONVERSATION_FRAMES.entries()) {
                if (index < fromIndex) continue;
                push(sseFrame(frame.id, frame.event, frame.payload));
                if (drop) {
                  close();
                  return;
                }
              }
            }
            // Shared-recorded termination, then the stream closes.
            push(sseFrame(CONVERSATION_FRAME_IDS.gone, "conversation_reset", SESSION_GONE));
            close();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            ...reflectId,
          },
        });
      }

      await record();
      const body = problem(
        404,
        "run_not_found",
        "Not found",
        "Unknown route.",
        serverRequestId,
        false,
      );
      return Response.json(body, {
        status: 404,
        headers: { "Content-Type": "application/problem+json", ...reflectId },
      });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    eventLastEventIds,
    paneEventLastEventIds,
    sessionEventLastEventIds,
    disconnectAfterFirstFrame: () => {
      dropNextStreamAfterFirstFrame = true;
    },
    disconnectNextSessionStreamAfterFirstFrame: () => {
      dropNextSessionStreamAfterFirstFrame = true;
    },
    stop: () => server.stop(true),
  };
}
