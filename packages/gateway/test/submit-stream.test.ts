/**
 * Submit → stream happy path plus the POST/LIST/GET validation contract
 * (ADR §4.3–§4.6). Drives the real HTTP server with an app-like client
 * over an ephemeral loopback port; the runtime and planner are fakes.
 */

import { describe, expect, test } from "bun:test";

import {
  authHeader,
  bootTestGateway,
  makeSnapshot,
  makeTask,
  readSseUntil,
  SseCollector,
  submitPrompt,
} from "./helpers";

describe("POST /v1/runs → SSE happy path", () => {
  test("submit returns 202 with an accepted summary, then status/output/terminal stream", async () => {
    const gateway = bootTestGateway();
    try {
      const response = await submitPrompt(gateway, {
        prompt: "Implement the remote gateway and verify it",
        clientContext: { displayName: "Loopy's phone" },
      });
      expect(response.status).toBe(202);
      expect(response.headers.get("X-Request-Id")).toStartWith("req_");
      const body = (await response.json()) as { run: Record<string, unknown> };
      const runId = body.run.runId as string;
      expect(body.run).toMatchObject({
        status: "accepted",
        terminal: false,
        lastSequence: null,
        taskCounts: { pending: 0, running: 0, attention: 0, done: 0, failed: 0, cancelled: 0 },
      });
      expect(gateway.planner.calls).toHaveLength(1);
      expect(gateway.planner.calls[0]!.prompt).toBe("Implement the remote gateway and verify it");
      expect(gateway.planner.calls[0]!.clientContext).toEqual({ displayName: "Loopy's phone" });

      // App client connects and receives the current status first (ADR §4.5).
      const stream = new SseCollector(
        await fetch(`${gateway.baseUrl}/v1/runs/${runId}/events`, {
          headers: { Accept: "text/event-stream", ...authHeader(gateway.token()) },
        }),
      );
      const initial = await stream.until((parsed) => parsed.length >= 1);
      expect(initial[0]!.event).toBe("status");
      expect(initial[0]!.id).toBeString();
      expect((initial[0]!.data as { run: { status: string } }).run.status).toBe("accepted");

      gateway.planner.calls[0]!.handle.markPlanning(runId);
      gateway.runtime.emit(
        makeSnapshot({
          runId,
          state: "active",
          lastSequence: 42n,
          tasks: [
            makeTask({
              id: "gateway-app",
              state: "running",
              activities: ["gateway listening on tailnet"],
            }),
            makeTask({ id: "gateway-auth", state: "done", resultSummary: "bearer verified" }),
          ],
          attention: [
            {
              id: "attn_1",
              kind: "decision",
              summary: "Select the tailnet ACL policy",
              taskId: "gateway-app",
            },
          ],
          openAttentionIds: ["attn_1"],
        }),
      );

      const events = await stream.until((parsed) =>
        parsed.some((frame) => frame.event === "output"),
      );

      const statusFrames = events.filter((frame) => frame.event === "status");
      expect(statusFrames.length).toBeGreaterThanOrEqual(3); // accepted, planning, running
      const runningFrame = statusFrames.find(
        (frame) => (frame.data as { run: { status: string } }).run.status === "running",
      );
      expect(runningFrame).toBeDefined();
      const runningRun = (runningFrame!.data as { run: Record<string, unknown> }).run;
      expect(runningRun.lastSequence).toBe("42"); // u64 as decimal string
      expect(runningRun.taskCounts).toEqual({
        pending: 0,
        running: 1,
        attention: 0,
        done: 1,
        failed: 0,
        cancelled: 0,
      });
      expect(runningRun.attention).toMatchObject({
        attentionId: "attn_1",
        taskId: "gateway-app",
        kind: "decision",
      });

      const outputFrames = events.filter((frame) => frame.event === "output");
      expect(outputFrames).toHaveLength(1);
      expect(outputFrames[0]!.data).toMatchObject({
        version: 1,
        runId,
        taskId: "gateway-app",
        activityId: "42:gateway-app:0",
        text: "gateway listening on tailnet",
        truncated: false,
      });

      // Drive to completion on the same connection: status then terminal, then close.
      gateway.runtime.emit(
        makeSnapshot({ runId, state: "completed", lastSequence: 57n, tasks: [] }),
      );
      const final = await stream.until((parsed) =>
        parsed.some((frame) => frame.event === "terminal"),
      );
      expect(stream.closedByServer).toBe(true); // terminal flushes then closes
      expect(final.filter((frame) => frame.event === "terminal")).toHaveLength(1);
      expect(final.at(-1)!.event).toBe("terminal");

      // A fresh client on the finished run still gets status + terminal closure.
      const fresh = new SseCollector(
        await fetch(`${gateway.baseUrl}/v1/runs/${runId}/events`, {
          headers: { Accept: "text/event-stream", ...authHeader(gateway.token()) },
        }),
      );
      const freshFrames = await fresh.until((parsed) =>
        parsed.some((frame) => frame.event === "terminal"),
      );
      expect(fresh.closedByServer).toBe(true);
      expect(freshFrames.at(-1)!.event).toBe("terminal");
    } finally {
      gateway.stop();
    }
  });

  test("planning failure flips the run to failed and emits status then terminal", async () => {
    const gateway = bootTestGateway();
    try {
      const response = await submitPrompt(gateway, { prompt: "break the planner" });
      expect(response.status).toBe(202);
      // 202 body is `{ run: RemoteRunSummary }` (ADR §4.3); runId lives inside `run`.
      const body = (await response.json()) as { run: { runId: string } };
      const { runId } = body.run;

      const stream = await fetch(`${gateway.baseUrl}/v1/runs/${runId}/events`, {
        headers: { Accept: "text/event-stream", ...authHeader(gateway.token()) },
      });
      gateway.planner.calls[0]!.handle.planningFailed(runId);

      const { frames } = await readSseUntil(stream, (parsed) =>
        parsed.some((frame) => frame.event === "terminal"),
      );
      const failedStatus = frames.find(
        (frame) =>
          frame.event === "status" &&
          (frame.data as { run: { status: string } }).run.status === "failed",
      );
      expect(failedStatus).toBeDefined();
      expect(frames.at(-1)!.event).toBe("terminal");

      const getResponse = await fetch(`${gateway.baseUrl}/v1/runs/${runId}`, {
        headers: authHeader(gateway.token()),
      });
      expect(getResponse.status).toBe(200);
      const run = (await getResponse.json()) as {
        status: string;
        terminal: boolean;
        tasks: unknown[];
      };
      expect(run).toMatchObject({ status: "failed", terminal: true, tasks: [] });
    } finally {
      gateway.stop();
    }
  });
});

describe("GET /v1/runs list contract", () => {
  test("returns newest-first summaries with decimal strings and cursor pagination", async () => {
    const gateway = bootTestGateway();
    try {
      for (const prompt of ["first", "second", "third"]) {
        const response = await submitPrompt(gateway, { prompt });
        expect(response.status).toBe(202);
      }
      gateway.clock.advance(5); // newer submissions would now sort first

      const page1 = await fetch(`${gateway.baseUrl}/v1/runs?limit=2`, {
        headers: authHeader(gateway.token()),
      });
      expect(page1.status).toBe(200);
      const body1 = (await page1.json()) as {
        runs: { runId: string }[];
        nextCursor: string | null;
      };
      expect(body1.runs.map((run) => run.runId)).toEqual(["run-3", "run-2"]);
      expect(body1.nextCursor).toBeString();

      const page2 = await fetch(
        `${gateway.baseUrl}/v1/runs?limit=2&cursor=${encodeURIComponent(body1.nextCursor!)}`,
        { headers: authHeader(gateway.token()) },
      );
      const body2 = (await page2.json()) as {
        runs: { runId: string }[];
        nextCursor: string | null;
      };
      expect(body2.runs.map((run) => run.runId)).toEqual(["run-1"]);
      expect(body2.nextCursor).toBeNull();
    } finally {
      gateway.stop();
    }
  });
});

describe("request validation and problem mapping", () => {
  test("rejects schema violations with 400 invalid_request and field hints", async () => {
    const gateway = bootTestGateway();
    try {
      const empty = await submitPrompt(gateway, { prompt: "   " });
      expect(empty.status).toBe(400);
      const emptyBody = (await empty.json()) as { code: string; fields: Record<string, string> };
      expect(emptyBody.code).toBe("invalid_request");
      expect(emptyBody.fields.prompt).toBeString();

      const missing = await submitPrompt(gateway, {});
      expect(missing.status).toBe(400);

      const wrongType = await submitPrompt(gateway, { prompt: 42 });
      expect(wrongType.status).toBe(400);

      const noJson = await fetch(`${gateway.baseUrl}/v1/runs`, {
        method: "POST",
        headers: authHeader(gateway.token()),
        body: "not json",
      });
      expect(noJson.status).toBe(400);

      const badLimit = await fetch(`${gateway.baseUrl}/v1/runs?limit=zero`, {
        headers: authHeader(gateway.token()),
      });
      expect(badLimit.status).toBe(400);

      const badCursor = await fetch(`${gateway.baseUrl}/v1/runs?cursor=@@@`, {
        headers: authHeader(gateway.token()),
      });
      expect(badCursor.status).toBe(400);
      expect(((await badCursor.json()) as { code: string }).code).toBe("invalid_cursor");
    } finally {
      gateway.stop();
    }
  });

  test("rejects oversized prompts with 413 prompt_too_large", async () => {
    const gateway = bootTestGateway();
    try {
      const big = "a".repeat(64 * 1024 + 1);
      const response = await submitPrompt(gateway, { prompt: big });
      expect(response.status).toBe(413);
      expect(((await response.json()) as { code: string }).code).toBe("prompt_too_large");
    } finally {
      gateway.stop();
    }
  });

  test("enforces the planning capacity limit with 429 and Retry-After", async () => {
    const gateway = bootTestGateway({ planningLimit: 1 });
    try {
      const first = await submitPrompt(gateway, { prompt: "occupy the queue" });
      expect(first.status).toBe(202);
      const second = await submitPrompt(gateway, { prompt: "overflow" });
      expect(second.status).toBe(429);
      expect(second.headers.get("Retry-After")).toBe("5");
      expect(((await second.json()) as { code: string; retryable: boolean }).retryable).toBe(true);
    } finally {
      gateway.stop();
    }
  });

  test("maps a synchronously failing planner to 503 planner_unavailable", async () => {
    const gateway = bootTestGateway();
    gateway.planner.failSynchronously = true;
    try {
      const response = await submitPrompt(gateway, { prompt: "boom" });
      expect(response.status).toBe(503);
      const problem = (await response.json()) as { code: string; retryable: boolean };
      expect(problem).toMatchObject({ code: "planner_unavailable", retryable: true });
    } finally {
      gateway.stop();
    }
  });

  test("problem responses carry the request id and stable type URL", async () => {
    const gateway = bootTestGateway();
    try {
      const response = await submitPrompt(
        gateway,
        { prompt: "" },
        { "X-Request-Id": "req_fixed_1" },
      );
      expect(response.headers.get("X-Request-Id")).toBe("req_fixed_1");
      const problem = (await response.json()) as { type: string; requestId: string };
      expect(problem.type).toBe("https://loop.local/problems/invalid-request");
      expect(problem.requestId).toBe("req_fixed_1");
    } finally {
      gateway.stop();
    }
  });
});

describe("client disconnect semantics", () => {
  test("disconnect does not cancel the run; the run continues and completes", async () => {
    const gateway = bootTestGateway();
    try {
      const response = await submitPrompt(gateway, { prompt: "keep going" });
      // 202 body is `{ run: RemoteRunSummary }` (ADR §4.3); runId lives inside `run`.
      const body = (await response.json()) as { run: { runId: string } };
      const { runId } = body.run;
      const stream = await fetch(`${gateway.baseUrl}/v1/runs/${runId}/events`, {
        headers: { Accept: "text/event-stream", ...authHeader(gateway.token()) },
      });
      const firstFrame = await readSseUntil(stream, (parsed) => parsed.length >= 1);
      expect(firstFrame.frames[0]!.event).toBe("status");
      // readSseUntil already cancels the reader; the server observes the abort.

      gateway.runtime.emit(
        makeSnapshot({ runId, state: "completed", lastSequence: 9n, tasks: [] }),
      );
      const after = await fetch(`${gateway.baseUrl}/v1/runs/${runId}`, {
        headers: authHeader(gateway.token()),
      });
      expect(((await after.json()) as { status: string }).status).toBe("completed");
    } finally {
      gateway.stop();
    }
  });
});
