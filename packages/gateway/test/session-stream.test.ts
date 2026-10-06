/**
 * GUI conversation v1 — session SSE surface over HTTP (decision
 * 2026-xx-gui-conversation D3/D4, M-GC1/M-GC2). A fully scripted session
 * (prompt, tool call, result, merged deltas, steer marker, shutdown) renders
 * as an ordered conversation event stream. Cursor replay semantics are
 * identical to the run/pane families; steer mirrors exactly once; no herdr,
 * no pi process, no paid model calls.
 */

import { describe, expect, test } from "bun:test";

import { encodeStreamCursor } from "../src/cursor";
import { writeSessionFrame } from "../src/server";
import { SseClientStream } from "../src/stream";
import {
  authHeader,
  bootTestGateway,
  SseCollector,
  tap,
  tapConnect,
  tapDisconnect,
  type ParsedFrame,
  type TestGateway,
} from "./helpers";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

function readStreamRaw(stream: SseClientStream): string {
  let raw = "";
  for (;;) {
    const chunk = stream.read();
    if (chunk === null) return raw;
    raw += chunk;
  }
}

function sessionGateway(overrides?: Parameters<typeof bootTestGateway>[0]): TestGateway & {
  sessions: NonNullable<TestGateway["sessions"]>;
  sessionLog: NonNullable<TestGateway["sessionLog"]>;
} {
  const gateway = bootTestGateway({ ...overrides, session: overrides?.session ?? {} });
  if (gateway.sessions === null || gateway.sessionLog === null)
    throw new Error("session surface missing");
  return gateway as never;
}

function openSessionStream(
  gateway: TestGateway,
  sessionId: string,
  lastEventId?: string,
): Promise<Response> {
  return fetch(`${gateway.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/events`, {
    headers: {
      Accept: "text/event-stream",
      ...authHeader(gateway.token()),
      ...(lastEventId === undefined ? {} : { "Last-Event-ID": lastEventId }),
    },
  });
}

/**
 * Read a session stream until `predicate` matches, then linger briefly for a
 * server close already in flight (a reset flush and its EOF are two separate
 * chunks). The linger RACES a timer — until() alone would block on the
 * heartbeat for a quiet stream. Streams that stay open (slow-consumer cases)
 * report `closedByServer === false`.
 */
async function readSession(
  response: Response,
  predicate: (frames: ParsedFrame[]) => boolean,
  deadlineMs = 2_000,
): Promise<{ frames: ParsedFrame[]; closedByServer: boolean }> {
  const collector = new SseCollector(response);
  try {
    await collector.until(predicate, deadlineMs);
    await Promise.race([
      collector.until(() => collector.closedByServer, 30_000).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 300)),
    ]);
  } finally {
    await collector.close();
  }
  return { frames: collector.frames, closedByServer: collector.closedByServer };
}

/** Script the canonical session (decision D4 §1–§4 walk-through): prompt,
 * tool call + result, merged assistant deltas + final, steer marker pair,
 * turn end, shutdown. Run correlation marks the session run-mapped. */
function scriptSession(gateway: TestGateway, sessionId = "sess-1", runId = "run-9"): string {
  const conn = tapConnect(gateway, {
    sessionId,
    runId,
    taskId: "task-1",
    workerId: null,
    lane: "pi",
    title: "worker-1",
  });
  tap(gateway, conn, { type: "lifecycle", phase: "sessionStarted" });
  tap(gateway, conn, {
    type: "user_message",
    messageId: "m-1",
    text: "run the tests",
    source: "interactive",
    imageCount: 0,
  });
  tap(gateway, conn, {
    type: "tool_call_started",
    toolCallId: "tc-1",
    toolName: "bash",
    argsJson: JSON.stringify({ command: "bun test" }),
  });
  tap(gateway, conn, {
    type: "tool_call_ended",
    toolCallId: "tc-1",
    resultText: "42 pass",
    isError: false,
  });
  // Snapshot updates merge on the ≥250 ms cadence (D4 §2): two updates land
  // inside one flush window and surface as ONE merged delta.
  tap(gateway, conn, { type: "assistant_update", messageId: "m-2", text: "Running" });
  tap(gateway, conn, { type: "assistant_update", messageId: "m-2", text: "Running the suite" });
  gateway.clock.advance(300);
  gateway.sessions?.tickMerge(gateway.clock.now);
  tap(gateway, conn, {
    type: "assistant_message",
    messageId: "m-2",
    text: "Running the suite — done",
  });
  // Steer feedback steps 2+3 (D4 §4): the accepted-steer mirror, then the
  // tap-observed user bubble that the app folds the marker into.
  gateway.sessions?.mirrorSteerQueued({ runId, steerId: "steer-1", text: "focus on auth" });
  tap(gateway, conn, {
    type: "user_message",
    messageId: "m-3",
    text: "focus on auth",
    source: "steer",
  });
  tap(gateway, conn, { type: "lifecycle", phase: "turnEnded" });
  tap(gateway, conn, { type: "session_shutdown" });
  tapDisconnect(gateway, conn); // post-shutdown close: state stays "ended"
  return conn;
}

const SCRIPTED_ORDER = [
  "lifecycle",
  "user_message",
  "tool_call_started",
  "tool_call_ended",
  "assistant_delta",
  "assistant_message",
  "steer_queued",
  "user_message",
  "lifecycle",
  "conversation_reset",
];

describe("scripted session renders as an ordered conversation stream", () => {
  test("prompt → tool card → result → steer marker, in script order, then session_gone closes", async () => {
    const gateway = sessionGateway();
    try {
      scriptSession(gateway);

      const response = await openSessionStream(gateway, "sess-1");
      expect(response.status).toBe(200);
      const { frames, closedByServer } = await readSession(response, (seen) =>
        seen.some((frame) => frame.event === "conversation_reset"),
      );

      // Render-order stability: SSE frame order IS the conversation order.
      expect(frames.map((frame) => frame.event)).toEqual(SCRIPTED_ORDER);
      expect(closedByServer).toBe(true); // session_gone closes after the reset flushes

      // Wire contract: payload carries identity + content only — no
      // discriminator field, no seq field (decision D4 §1).
      expect(frames[0]?.data).toEqual({ phase: "sessionStarted", occurredAt: expect.any(String) });
      expect(frames[1]?.data).toEqual({
        messageId: "m-1",
        text: "run the tests",
        source: "interactive",
        imageCount: 0,
        attachments: [], // M2 (D5): reference-shaped; bodies live out-of-band
        occurredAt: expect.any(String),
      });
      expect(frames[2]?.data).toEqual({
        toolCallId: "tc-1",
        toolName: "bash",
        argsJson: JSON.stringify({ command: "bun test" }),
        argsTruncated: false,
        occurredAt: expect.any(String),
      });
      expect(frames[3]?.data).toEqual({
        toolCallId: "tc-1",
        resultText: "42 pass",
        resultTruncated: false,
        isError: false,
        occurredAt: expect.any(String),
      });
      // Delta merge: ONE merged delta carrying the latest snapshot (D4 §2 —
      // never one frame per update; the final below still replaces it all).
      expect(frames[4]?.data).toEqual({
        messageId: "m-2",
        delta: "Running the suite",
        occurredAt: expect.any(String),
      });
      // Authoritative final replaces the delta buffer (D4 §2).
      expect(frames[5]?.data).toEqual({
        messageId: "m-2",
        text: "Running the suite — done",
        truncated: false,
        occurredAt: expect.any(String),
      });
      expect(frames[6]?.data).toEqual({
        steerId: "steer-1",
        text: "focus on auth",
        runId: "run-9",
        occurredAt: expect.any(String),
      });
      expect(frames[7]?.data).toMatchObject({ messageId: "m-3", source: "steer" });
      expect(frames[8]?.data).toEqual({ phase: "turnEnded", occurredAt: expect.any(String) });
      expect(frames[9]?.data).toEqual({ reason: "sessionGone", occurredAt: expect.any(String) });

      // Cursor hygiene: opaque unique ids, and the shared reset convention —
      // the gone reset reuses the last buffered cursor so an id-based dedupe
      // cannot drop it (run/pane terminal precedent).
      const ids = frames.map((frame) => frame.id);
      expect(new Set(ids.slice(0, -1)).size).toBe(frames.length - 1);
      expect(ids[9]).toBe(ids[8]);
    } finally {
      gateway.stop();
    }
  });

  test("gone convergence: every reconnect replays history then the SAME reset frame", async () => {
    const gateway = sessionGateway();
    try {
      scriptSession(gateway);
      const first = await openSessionStream(gateway, "sess-1");
      const seen = await readSession(first, (frames) =>
        frames.some((frame) => frame.event === "conversation_reset"),
      );
      const reset = must(seen.frames[seen.frames.length - 1]);

      for (let reconnect = 0; reconnect < 2; reconnect += 1) {
        const again = await openSessionStream(gateway, "sess-1");
        const replayed = await readSession(again, (frames) =>
          frames.some((frame) => frame.event === "conversation_reset"),
        );
        expect(replayed.frames.map((frame) => frame.event)).toEqual(SCRIPTED_ORDER);
        const againReset = must(replayed.frames[replayed.frames.length - 1]);
        expect(againReset.id).toBe(reset.id);
        expect(againReset.data).toEqual(reset.data);
        expect(replayed.closedByServer).toBe(true);
      }
    } finally {
      gateway.stop();
    }
  });
});

describe("cursor replay (run/pane parity)", () => {
  test("live flow then Last-Event-ID replay: remaining frames after the cursor, in order, no reset", async () => {
    const gateway = sessionGateway();
    try {
      const conn = tapConnect(gateway, { sessionId: "sess-live", lane: "pi" });
      tap(gateway, conn, { type: "user_message", messageId: "m-1", text: "first prompt" });
      tap(gateway, conn, { type: "assistant_message", messageId: "a-1", text: "working" });

      const live = await openSessionStream(gateway, "sess-live");
      const initial = await readSession(live, (frames) => frames.length >= 2);
      expect(initial.frames.map((frame) => frame.event)).toEqual([
        "user_message",
        "assistant_message",
      ]);

      tap(gateway, conn, { type: "user_message", messageId: "m-2", text: "second prompt" });
      tap(gateway, conn, { type: "assistant_message", messageId: "a-2", text: "still working" });

      const resumeFrom = must(initial.frames[1]?.id); // cursor after the second frame
      const second = await openSessionStream(gateway, "sess-live", resumeFrom);
      const replayed = await readSession(second, (frames) => frames.length >= 2);
      expect(replayed.frames.map((frame) => frame.event)).toEqual([
        "user_message",
        "assistant_message",
      ]);
      expect(replayed.frames[0]?.data).toMatchObject({ messageId: "m-2" });
      expect(replayed.frames[1]?.data).toMatchObject({ messageId: "a-2" });
      expect(replayed.frames.some((frame) => frame.event === "conversation_reset")).toBe(false);
      tapDisconnect(gateway, conn);
    } finally {
      gateway.stop();
    }
  });

  test("malformed, foreign-generation, and from-the-future cursors get a leading cursorUnavailable reset", async () => {
    const gateway = sessionGateway();
    try {
      const conn = tapConnect(gateway, { sessionId: "sess-c", lane: "pi" });
      tap(gateway, conn, { type: "user_message", messageId: "m-1", text: "hello" });

      const generation = gateway.sessionLog?.generation;
      const future = encodeStreamCursor({ generation, runId: "sess-c", seq: 999 });
      const foreign = encodeStreamCursor({ generation: generation + 1, runId: "sess-c", seq: 0 });

      for (const cursor of ["garbage", foreign, future]) {
        const response = await openSessionStream(gateway, "sess-c", cursor);
        // The reset leads the intro; the stream then continues live, so push
        // one more observed frame for the post-reset continuation.
        const readerPromise = readSession(response, (seen) => seen.length >= 2);
        await new Promise((resolve) => setTimeout(resolve, 100));
        tap(gateway, conn, { type: "user_message", messageId: `m-${cursor}`, text: "after reset" });
        const { frames } = await readerPromise;
        expect(frames[0]?.event).toBe("conversation_reset");
        expect(frames[0]?.data).toMatchObject({ reason: "cursorUnavailable" });
        // After the reset the stream continues live with fresh frames.
        expect(frames[1]?.event).toBe("user_message");
      }
      tapDisconnect(gateway, conn);
    } finally {
      gateway.stop();
    }
  });
});

describe("backpressure converges via slowConsumer", () => {
  // The HTTP transport drains its queue eagerly, so overflow cannot be
  // produced over a real socket (same as the run/pane suites, which prove the
  // convergence at the SseClientStream level). The session family's policy —
  // deltas droppable, everything else control, one authoritative reset on
  // drop — is exercised here through the exact server write policy.
  test("dropped deltas converge to one connection-local reset; the stream stays open", () => {
    const gateway = sessionGateway();
    try {
      const conn = tapConnect(gateway, { sessionId: "sess-slow", lane: "pi" });
      tap(gateway, conn, { type: "user_message", messageId: "m-0", text: "anchor" });

      const stream = new SseClientStream({ maxFrames: 3, maxBytes: 1024 * 1024 });
      const collector = must(gateway.sessions);
      const log = must(gateway.sessionLog);
      const unsubscribe = log.subscribe("sess-slow", (frame) => {
        writeSessionFrame(stream, frame, () => collector.slowConsumerReset("sess-slow"));
      });

      // Six merged deltas against a 3-frame queue: the fourth drop converges.
      for (let index = 1; index <= 6; index += 1) {
        tap(gateway, conn, {
          type: "assistant_update",
          messageId: `m-${index}`,
          text: `chunk ${index}`,
        });
        gateway.clock.advance(300);
        collector.tickMerge(gateway.clock.now);
      }
      unsubscribe();

      expect(stream.closed).toBe(false); // connection-local: the stream continues
      const raw = readStreamRaw(stream);
      const events = raw
        .split("\n\n")
        .filter((block) => block.trim().length > 0 && !block.startsWith(":"))
        .map((block) =>
          block
            .split("\n")
            .find((line) => line.startsWith("event: "))?.slice(7),
        );
      const resetIndex = events.indexOf("conversation_reset");
      expect(resetIndex).toBeGreaterThanOrEqual(0);
      expect(events.slice(0, resetIndex).every((event) => event === "assistant_delta")).toBe(true);
      expect(events.slice(0, resetIndex).length).toBeLessThanOrEqual(3);
      expect(events.slice(resetIndex + 1).every((event) => event === "assistant_delta")).toBe(true);
      expect(raw).toContain('"reason":"slowConsumer"');
      // Exactly one convergence reset.
      expect(events.filter((event) => event === "conversation_reset")).toHaveLength(1);
      tapDisconnect(gateway, conn);
    } finally {
      gateway.stop();
    }
  });

  test("a sessionGone reset still closes after flushing (control frames are never dropped)", () => {
    const gateway = sessionGateway();
    try {
      const conn = tapConnect(gateway, { sessionId: "sess-gone", lane: "pi" });
      const stream = new SseClientStream({ maxFrames: 3, maxBytes: 1024 * 1024 });
      const collector = must(gateway.sessions);
      const log = must(gateway.sessionLog);
      const unsubscribe = log.subscribe("sess-gone", (frame) => {
        writeSessionFrame(stream, frame, () => collector.slowConsumerReset("sess-gone"));
      });
      tap(gateway, conn, { type: "user_message", messageId: "m-1", text: "bye" });
      tap(gateway, conn, { type: "session_shutdown" });
      unsubscribe();

      expect(stream.closed).toBe(true);
      expect(stream.closeReason).toBe("session_reset");
      const raw = readStreamRaw(stream);
      expect(raw).toContain("event: user_message");
      expect(raw).toContain('"reason":"sessionGone"');
      tapDisconnect(gateway, conn);
    } finally {
      gateway.stop();
    }
  });
});

function postSteer(
  gateway: TestGateway,
  runId: string,
  body: unknown,
  contentType = "application/json",
) {
  return fetch(`${gateway.baseUrl}/v1/runs/${encodeURIComponent(runId)}/steer`, {
    method: "POST",
    headers: { "Content-Type": contentType, ...authHeader(gateway.token()) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /v1/runs/{runId}/steer", () => {
  test("accepted steer calls the bridge once and mirrors exactly one steer_queued frame (replay-inclusive)", async () => {
    const gateway = sessionGateway();
    try {
      const conn = tapConnect(gateway, { sessionId: "sess-1", runId: "run-9", lane: "pi" });
      tap(gateway, conn, { type: "user_message", messageId: "m-1", text: "run the tests" });

      const response = await postSteer(gateway, "run-9", { message: "focus on auth" });
      expect(response.status).toBe(202);
      const body = (await response.json()) as { steerId: string; mirrored: number };
      expect(body.steerId).toMatch(/^steer_/);
      expect(body.mirrored).toBe(1);

      // Bridge spy: exactly one steer_run call with the exact input (M-GC2).
      expect(gateway.steer.calls).toEqual([{ runId: "run-9", message: "focus on auth" }]);

      // Exactly one mirrored frame on the mapped session's stream…
      const full = await openSessionStream(gateway, "sess-1");
      const seen = await readSession(full, (frames) => frames.length >= 2);
      expect(seen.frames.map((frame) => frame.event)).toEqual(["user_message", "steer_queued"]);
      expect(seen.frames[1]?.data).toEqual({
        steerId: body.steerId,
        text: "focus on auth",
        runId: "run-9",
        occurredAt: expect.any(String),
      });

      // …and replay re-delivers the SAME frame (cursor-stable, idempotent).
      const resume = await openSessionStream(gateway, "sess-1", must(seen.frames[0]?.id));
      const replayed = await readSession(resume, (frames) => frames.length >= 1);
      const mirrors = replayed.frames.filter((frame) => frame.event === "steer_queued");
      expect(mirrors).toHaveLength(1);
      expect(mirrors[0]?.id).toBe(seen.frames[1]?.id);
      expect(gateway.steer.calls).toHaveLength(1); // no re-delivery through the bridge

      tapDisconnect(gateway, conn);
    } finally {
      gateway.stop();
    }
  });

  test("empty → 400, over-cap → 413, malformed bodies → 400; failures never mirror", async () => {
    const { ProblemError } = await import("../src/problem");
    const gateway = sessionGateway();
    try {
      tapConnect(gateway, { sessionId: "sess-1", runId: "run-9", lane: "pi" });

      expect((await postSteer(gateway, "run-9", { message: "" })).status).toBe(400);
      expect((await postSteer(gateway, "run-9", { message: "   " })).status).toBe(400);
      expect((await postSteer(gateway, "run-9", { message: 42 })).status).toBe(400);
      expect((await postSteer(gateway, "run-9", {})).status).toBe(400);
      expect((await postSteer(gateway, "run-9", "not json", "text/plain")).status).toBe(400);
      expect(
        (await postSteer(gateway, "run-9", { message: "x".repeat(64 * 1024 + 1) })).status,
      ).toBe(413);

      // Bridge failure maps to the problem surface; nothing is mirrored.
      gateway.steer.failWith = new ProblemError(404, "run_not_found");
      const failed = await postSteer(gateway, "run-9", { message: "focus" });
      expect(failed.status).toBe(404);
      expect(((await failed.json()) as { code: string }).code).toBe("run_not_found");
      expect(
        gateway.sessions?.bufferedFrames("sess-1").some((frame) => frame.event === "steer_queued"),
      ).toBe(false);
      expect(gateway.steer.calls).toHaveLength(0);
    } finally {
      gateway.stop();
    }
  });

  test("zero mirror is honest for runs without a live correlated session; absent seams 404", async () => {
    const gateway = sessionGateway();
    try {
      tapConnect(gateway, { sessionId: "sess-1", runId: "run-9", lane: "pi" });
      const uncorrelated = await postSteer(gateway, "run-other", { message: "anyone there?" });
      expect(uncorrelated.status).toBe(202);
      expect(((await uncorrelated.json()) as { mirrored: number }).mirrored).toBe(0);
      // The bridge WAS called — steer works against the run even when the
      // conversation mirror has no target (honest D4 §4 no-frame outcome).
      expect(gateway.steer.calls).toEqual([{ runId: "run-other", message: "anyone there?" }]);
    } finally {
      gateway.stop();
    }

    const bare = sessionGateway({ steer: false });
    try {
      const response = await postSteer(bare, "run-9", { message: "focus" });
      expect(response.status).toBe(404);
    } finally {
      bare.stop();
    }
  });
});

async function postResolve(gateway: TestGateway, body: unknown) {
  return fetch(`${gateway.baseUrl}/v1/runs/run-9/attention/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader(gateway.token()) },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/runs/{runId}/attention/resolve", () => {

  test("passes attention id and resolution to the configured seam", async () => {
    const gateway = sessionGateway();
    try {
      const response = await postResolve(gateway, { attentionId: "attn-1", resolution: "approved" });
      expect(response.status).toBe(200);
      expect(gateway.attention.calls).toEqual([
        { runId: "run-9", attentionId: "attn-1", resolution: "approved" },
      ]);
    } finally {
      gateway.stop();
    }
  });

  test("validates body and fails closed when no resolve seam exists", async () => {
    const gateway = sessionGateway();
    try {
      expect((await postResolve(gateway, { attentionId: "", resolution: "approved" })).status).toBe(400);
      expect((await postResolve(gateway, { attentionId: "attn-1", resolution: " " })).status).toBe(400);
    } finally {
      gateway.stop();
    }
    const bare = sessionGateway({ attention: false });
    try {
      expect((await postResolve(bare, { attentionId: "attn-1", resolution: "approved" })).status).toBe(404);
    } finally {
      bare.stop();
    }
  });
});

describe("GET /v1/sessions inventory", () => {
  test("honest correlation and states: live, unobserved after tap loss, ended after shutdown", async () => {
    const gateway = sessionGateway();
    try {
      const live = tapConnect(gateway, {
        sessionId: "s-live",
        runId: "run-1",
        taskId: "t-1",
        lane: "pi",
        title: "w1",
      });
      tapConnect(gateway, { sessionId: "s-bare", lane: "pi" }); // no markers → nulls

      const first = await fetch(`${gateway.baseUrl}/v1/sessions`, {
        headers: { ...authHeader(gateway.token()) },
      });
      expect(first.status).toBe(200);
      type Inventory = {
        sessions: {
          sessionId: string;
          runId: string | null;
          taskId: string | null;
          workerId: string | null;
          state: string;
          lane: string;
          title: string | null;
        }[];
      };
      let body = (await first.json()) as Inventory;
      expect(body.sessions).toEqual([
        {
          sessionId: "s-live",
          runId: "run-1",
          taskId: "t-1",
          workerId: null,
          lane: "pi",
          title: "w1",
          state: "live",
        },
        {
          sessionId: "s-bare",
          runId: null,
          taskId: null,
          workerId: null,
          lane: "pi",
          title: null,
          state: "live",
        },
      ]);

      tapDisconnect(gateway, live); // tap died without shutdown
      const endedConn = tapConnect(gateway, { sessionId: "s-ended", lane: "pi" });
      tap(gateway, endedConn, { type: "session_shutdown" });

      const second = await fetch(`${gateway.baseUrl}/v1/sessions`, {
        headers: { ...authHeader(gateway.token()) },
      });
      body = (await second.json()) as Inventory;
      expect(body.sessions.map((session) => [session.sessionId, session.state])).toEqual([
        ["s-live", "unobserved"],
        ["s-bare", "live"],
        ["s-ended", "ended"],
      ]);
    } finally {
      gateway.stop();
    }
  });
});

describe("route plumbing", () => {
  test("406 without SSE accept; 404 session_not_found for unknown sessions; 405 wrong method", async () => {
    const gateway = sessionGateway();
    try {
      const noSse = await fetch(`${gateway.baseUrl}/v1/sessions/sess-1/events`, {
        headers: { ...authHeader(gateway.token()) },
      });
      expect(noSse.status).toBe(406);

      const unknown = await openSessionStream(gateway, "sess-missing");
      expect(unknown.status).toBe(404);
      expect(((await unknown.json()) as { code: string }).code).toBe("session_not_found");

      const method = await fetch(`${gateway.baseUrl}/v1/sessions`, {
        method: "POST",
        headers: { ...authHeader(gateway.token()) },
      });
      expect(method.status).toBe(405);
    } finally {
      gateway.stop();
    }
  });

  test("404 when the gateway has no session surface configured", async () => {
    const gateway = bootTestGateway({ session: false });
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/sessions`, {
        headers: { ...authHeader(gateway.token()) },
      });
      expect(response.status).toBe(404);
    } finally {
      gateway.stop();
    }
  });
});
