/**
 * Attention-demo gateway (task `simulator-attention-demo`).
 *
 * A local, fake-data gateway that speaks just enough of the real wire
 * contract (ADR §4 + packages/gateway/src/wire.ts) to prove the end-to-end
 * attention cycle on the simulator: a run whose oldest-open attention the
 * RunScreen shows, and POST /v1/runs/{id}/attention/resolve — the exact
 * route the app's "Submit response" button calls — flipping the run state
 * (attention → released) and pushing the status frame over SSE.
 *
 * Evidence rules (same as demo-gateway.ts):
 * - ALL data is fake and clearly named `demo-*`; no model calls, no paid
 *   APIs, no real worker. This is the "fake provider" attention run.
 * - Bearer token is the constant `demo-token` — not a credential; tokenless
 *   requests are also accepted (decision 2026-xx-tokenless-auth §D-A1).
 * - Loopback bind only (127.0.0.1); the iOS simulator reaches it directly.
 * - Resolution text lives in process memory and, when
 *   ATTENTION_DEMO_LOG is set, as one JSONL line per accepted resolve —
 *   no secrets are involved (demo token is not a credential).
 *
 * Demo-only surface:
 *   GET /v1/demo/attention-state — release-confirmation JSON for evidence.
 *
 * Usage: bun apps/loop-mobile/scripts/attention-demo-gateway.ts [port]
 */

const TOKEN = "demo-token";
const PORT = Number(process.argv[2] ?? "18600");
const LOG_PATH = process.env.ATTENTION_DEMO_LOG ?? "";

const RUN_ID = "run_demo_attention_0010";
const TASK_ID = "task_demo_attention_1";
const ATTENTION_ID = "att_demo_attention_0010";
const ATTENTION_MESSAGE =
  "Worker blocked on a decision: retry the flaky integration test or skip it? Reply with your directive.";
const CREATED_AT = new Date(Date.now() - 7 * 60_000).toISOString();

type TaskCounts = {
  pending: number;
  running: number;
  attention: number;
  done: number;
  failed: number;
  cancelled: number;
};

/** The one demo run. attention=1 while open; the accepted resolve moves the
 * task to done and the run back to running (attention released). */
let resolved = false;
let resolution: string | null = null;
let resolvedAt: string | null = null;
let resolveRequests = 0;

function taskCounts(): TaskCounts {
  return resolved
    ? { pending: 0, running: 0, attention: 0, done: 1, failed: 0, cancelled: 0 }
    : { pending: 1, running: 0, attention: 1, done: 0, failed: 0, cancelled: 0 };
}

function runSummary() {
  return {
    runId: RUN_ID,
    status: resolved ? "running" : "attention",
    terminal: false,
    createdAt: CREATED_AT,
    updatedAt: new Date().toISOString(),
    lastSequence: resolved ? "9" : "7", // decimal string per contract
    taskCounts: taskCounts(),
  };
}

function runFull() {
  return {
    ...runSummary(),
    tasks: [
      {
        taskId: TASK_ID,
        status: resolved ? "done" : "attention",
        attempt: 1,
        summary: "Retry-or-skip decision on the flaky integration test",
      },
    ],
    attention: resolved
      ? null
      : { attentionId: ATTENTION_ID, taskId: TASK_ID, kind: "question", message: ATTENTION_MESSAGE },
  };
}

function problem(status: number, code: string, title: string, detail: string) {
  return {
    type: `https://loop.local/problems/${code}`,
    title,
    status,
    code,
    detail,
    requestId: `req_demo_${Math.random().toString(36).slice(2, 8)}`,
    retryable: false,
    fields: null,
  };
}

// ── run SSE stream (GET /v1/runs/{id}/events) ────────────────────────────
// Same envelope rule as the real gateway: the SSE `event` name discriminates
// (`status`), `data` carries no kind field, ids feed Last-Event-ID cursors.

type Waiter = { token: symbol; push: (frame: string) => void };
const runWaiters: Waiter[] = [];
let seq = 0;

function statusFrame(): string {
  seq += 1;
  return `id: e${seq}\nevent: status\ndata: ${JSON.stringify({
    version: 1,
    runId: RUN_ID,
    occurredAt: new Date().toISOString(),
    run: runFull(),
  })}\n\n`;
}

function pushStatusToAll(): void {
  const frame = statusFrame();
  for (const waiter of [...runWaiters]) waiter.push(frame);
}

function sseRunResponse(): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(statusFrame()));
      const token = Symbol("run-waiter");
      const waiter: Waiter = {
        token,
        push: (frame) => {
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            /* stream already gone */
          }
        },
      };
      runWaiters.push(waiter);
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, 10_000);
      // Never closed: the demo stream stays open like the real gateway's.
      void keepalive;
    },
    cancel() {
      const idx = runWaiters.findIndex((w) => w.token === token);
      if (idx >= 0) runWaiters.splice(idx, 1);
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

function appendEvidenceLog(entry: Record<string, unknown>): void {
  if (LOG_PATH === "") return;
  try {
    Bun.write(Bun.file(LOG_PATH), `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, {
      append: true,
    }).catch(() => undefined);
  } catch {
    /* evidence log is best-effort; the HTTP surface stays authoritative */
  }
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    const auth = request.headers.get("Authorization");
    const authed = auth === null || auth === `Bearer ${TOKEN}`;
    if (!authed) {
      return Response.json(problem(401, "unauthorized", "Unauthorized", "Bearer missing or invalid."), { status: 401 });
    }

    // —— runs surface ——————————————————————————————————————————————————
    if (request.method === "GET" && url.pathname === "/v1/runs") {
      return Response.json({ runs: [runSummary()], nextCursor: null });
    }

    const resolveMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/attention\/resolve$/);
    if (request.method === "POST" && resolveMatch !== null) {
      const runId = decodeURIComponent(resolveMatch[1]);
      if (runId !== RUN_ID) {
        return Response.json(problem(404, "run_not_found", "Run not found", `No demo run ${runId}.`), { status: 404 });
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(problem(400, "bad_request", "Bad request", "Body must be JSON."), { status: 400 });
      }
      // The app's client sends exactly { attentionId, resolution }.
      const { attentionId, resolution: text } = (body ?? {}) as {
        attentionId?: unknown;
        resolution?: unknown;
      };
      if (typeof attentionId !== "string" || attentionId.trim() === "") {
        return Response.json(
          problem(400, "invalid_attention", "Invalid attention", "attentionId must be a non-empty string."),
          { status: 400 },
        );
      }
      if (typeof text !== "string" || text.trim() === "") {
        return Response.json(
          problem(400, "invalid_attention", "Invalid attention", "resolution must be a non-empty string."),
          { status: 400 },
        );
      }
      if (attentionId !== ATTENTION_ID) {
        return Response.json(
          problem(404, "attention_not_found", "Attention not found", `No open attention ${attentionId} on ${RUN_ID}.`),
          { status: 404 },
        );
      }
      if (resolved) {
        return Response.json(
          problem(409, "attention_closed", "Attention already resolved", `Attention ${ATTENTION_ID} is no longer open.`),
          { status: 409 },
        );
      }
      resolveRequests += 1;
      resolved = true;
      resolution = text;
      resolvedAt = new Date().toISOString();
      pushStatusToAll(); // the app's projection sees attention: null
      appendEvidenceLog({ kind: "resolve", runId, attentionId, resolution: text, resolvedAt });
      console.log(`attention-demo-gateway: resolve accepted run=${runId} attention=${attentionId} chars=${text.length}`);
      return Response.json({ runId, attentionId, resolved: true }, { status: 200 });
    }

    const runEvents = url.pathname.match(/^\/v1\/runs\/([^/]+)\/events$/);
    if (request.method === "GET" && runEvents !== null) {
      if (decodeURIComponent(runEvents[1]) !== RUN_ID) {
        return Response.json(problem(404, "run_not_found", "Run not found", "No such demo run."), { status: 404 });
      }
      return sseRunResponse();
    }

    const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch !== null) {
      if (decodeURIComponent(runMatch[1]) !== RUN_ID) {
        return Response.json(problem(404, "run_not_found", "Run not found", "No such demo run."), { status: 404 });
      }
      return Response.json(runFull());
    }

    // —— auxiliary surfaces the screens touch (honest empties) ——————————
    if (request.method === "GET" && url.pathname === "/v1/sessions") {
      return Response.json({ sessions: [] });
    }
    if (request.method === "GET" && url.pathname === "/v1/panes") {
      return Response.json({ panes: [] });
    }

    // —— demo-only evidence surface ————————————————————————————————————
    if (request.method === "GET" && url.pathname === "/v1/demo/attention-state") {
      return Response.json({
        runId: RUN_ID,
        attentionId: ATTENTION_ID,
        open: !resolved,
        resolved,
        resolution,
        resolvedAt,
        resolveRequests,
        run: runSummary(),
      });
    }

    return Response.json(problem(404, "not_found", "Not found", `No demo route ${request.method} ${url.pathname}.`), { status: 404 });
  },
});

console.log(`attention-demo-gateway: serving fake attention run ${RUN_ID} on http://127.0.0.1:${PORT}`);
console.log(`attention-demo-gateway: open attention ${ATTENTION_ID} — POST /v1/runs/${RUN_ID}/attention/resolve to release`);

// Graceful shutdown so the e2e script's kill leaves nothing behind.
process.on("SIGTERM", () => {
  server.stop(true);
  process.exit(0);
});
