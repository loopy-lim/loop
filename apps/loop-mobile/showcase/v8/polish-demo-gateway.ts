/**
 * Polish capture gateway (task `polish-capture`).
 *
 * A local, fake-data gateway serving exactly the wire surface the chats
 * list needs (GET /v1/runs, GET /v1/sessions, SSE streams) with runs
 * shaped so the grouped main screen (task `main-screen-polish`) shows all
 * three sections deterministically:
 *
 *   In progress — an attention run (section lead, warn edge) and a running
 *                 run, plus one live uncorrelated session ("Unnamed
 *                 session" honest fallback).
 *   Today       — a completed run updated earlier today.
 *   Earlier     — a completed run last updated yesterday.
 *
 *   One terminal run has NO correlated session, so its row fronts the
 *   "Untitled task" empty-state label instead of a raw run id (brief S-11).
 *
 * Evidence rules (same as scripts/demo-gateway.ts):
 * - ALL data is fake and clearly named `polish-*`; no model calls, no paid
 *   APIs, no real worker.
 * - Tokenless requests accepted (decision 2026-xx-tokenless-auth §D-A1).
 * - Loopback bind only (127.0.0.1); the iOS simulator reaches it directly.
 *
 * Usage: bun apps/loop-mobile/showcase/v8/polish-demo-gateway.ts [port]
 */

const PORT = Number(process.argv[2] ?? "18777");

const minutesAgo = (n: number) => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - n);
  return d.toISOString();
};
const dayAt = (dayOffset: number, hour: number, minute: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

function runSummary(
  runId: string,
  status: string,
  updatedAt: string,
  counts: [number, number, number, number, number, number],
) {
  const [pending, running, attention, done, failed, cancelled] = counts;
  return {
    runId,
    status,
    terminal: status === "completed" || status === "failed" || status === "cancelled",
    createdAt: updatedAt,
    updatedAt,
    lastSequence: "7",
    taskCounts: { pending, running, attention, done, failed, cancelled },
  };
}

const ATTENTION_RUN = "run_polish_attention_0001";
const LIVE_RUN = "run_polish_live_0002";
const DONE_TODAY_RUN = "run_polish_done_0003";
const UNTITLED_RUN = "run_polish_untitled_0004";
const DONE_OLD_RUN = "run_polish_done_0005";

function runsBody() {
  return {
    runs: [
      runSummary(ATTENTION_RUN, "attention", minutesAgo(7), [0, 0, 1, 0, 0, 0]),
      runSummary(LIVE_RUN, "running", minutesAgo(3), [0, 1, 0, 0, 0, 0]),
      runSummary(DONE_TODAY_RUN, "completed", minutesAgo(45), [0, 0, 0, 2, 0, 0]),
      runSummary(UNTITLED_RUN, "completed", minutesAgo(90), [0, 0, 0, 1, 0, 0]),
      runSummary(DONE_OLD_RUN, "completed", dayAt(-1, 21, 30), [0, 0, 0, 3, 0, 0]),
    ],
    nextCursor: null,
  };
}

function sessionsBody() {
  return {
    sessions: [
      {
        sessionId: "sess_polish_attention_0001",
        runId: ATTENTION_RUN,
        taskId: "task_polish_1",
        workerId: "worker-polish",
        lane: "interactive",
        title: "Retry or skip the flaky integration test?",
        state: "live",
      },
      {
        sessionId: "sess_polish_live_0002",
        runId: LIVE_RUN,
        taskId: "task_polish_2",
        workerId: "worker-polish",
        lane: "interactive",
        title: "Refactor the SSE backpressure path",
        state: "live",
      },
      {
        sessionId: "sess_polish_done_0003",
        runId: DONE_TODAY_RUN,
        taskId: "task_polish_3",
        workerId: "worker-polish",
        lane: "interactive",
        title: "Fix the gateway test flake",
        state: "ended",
      },
      {
        sessionId: "sess_polish_done_0005",
        runId: DONE_OLD_RUN,
        taskId: "task_polish_5",
        workerId: "worker-polish",
        lane: "interactive",
        title: "Two-day touchpoint map audit",
        state: "ended",
      },
      {
        // Uncorrelated live session: no run, no observed utterance — the
        // row must read the honest "Unnamed session" label, never an id.
        sessionId: "sess_polish_orphan_0006",
        runId: null,
        taskId: null,
        workerId: null,
        lane: "interactive",
        title: null,
        state: "live",
      },
    ],
  };
}

function problem(status: number, code: string, title: string, detail: string) {
  return {
    type: `https://loop.local/problems/${code}`,
    title,
    status,
    code,
    detail,
    requestId: `req_polish_${Math.random().toString(36).slice(2, 8)}`,
    retryable: false,
    fields: null,
  };
}

// ── SSE: any session/run stream is an honest empty stream (the list never
// opens a conversation; the app just sees no frames).
function sseResponse(): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, 10_000);
      void keepalive; // never closed: the stream stays open like the real gateway's
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    const auth = request.headers.get("Authorization");
    if (auth !== null && auth !== "Bearer demo-token") {
      return Response.json(problem(401, "unauthorized", "Unauthorized", "Bearer invalid."), {
        status: 401,
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/runs") {
      return Response.json(runsBody());
    }
    if (request.method === "GET" && url.pathname === "/v1/sessions") {
      return Response.json(sessionsBody());
    }
    const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch !== null) {
      const run = runsBody().runs.find((r) => r.runId === decodeURIComponent(runMatch[1]));
      if (run === undefined) {
        return Response.json(
          problem(404, "run_not_found", "Run not found", "No such demo run."),
          { status: 404 },
        );
      }
      return Response.json({ ...run, tasks: [], attention: null });
    }
    if (
      request.method === "GET" &&
      (/^\/v1\/runs\/[^/]+\/events$/.test(url.pathname) ||
        /^\/v1\/sessions\/[^/]+\/events$/.test(url.pathname))
    ) {
      return sseResponse();
    }

    return Response.json(
      problem(404, "not_found", "Not found", `No route ${request.method} ${url.pathname}.`),
      { status: 404 },
    );
  },
});

console.log(`polish-demo-gateway: listening on 127.0.0.1:${server.port} (fake polish-* data only)`);
