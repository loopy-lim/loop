/**
 * SSE cursor replay semantics (ADR §4.5): reconnect with `Last-Event-ID`
 * replays buffered frames in order; malformed, foreign, or evicted cursors
 * converge to a leading `reset(reason: "cursor_unavailable")`; non-SSE
 * Accept headers and unknown runs are ordinary problem responses.
 */

import { describe, expect, test } from "bun:test";

import { decodeStreamCursor, encodeStreamCursor } from "../src/cursor";
import { authHeader, bootTestGateway, makeSnapshot, SseCollector } from "./helpers";

async function openStream(
  gateway: ReturnType<typeof bootTestGateway>,
  runId: string,
  lastEventId?: string,
) {
  const response = await fetch(`${gateway.baseUrl}/v1/runs/${runId}/events`, {
    headers: {
      Accept: "text/event-stream",
      ...authHeader(gateway.token()),
      ...(lastEventId === undefined ? {} : { "Last-Event-ID": lastEventId }),
    },
  });
  return { response, collector: new SseCollector(response) };
}

describe("replay with Last-Event-ID", () => {
  test("replays only frames after the cursor, in order", async () => {
    const gateway = bootTestGateway();
    try {
      const submit = await gateway.service.submit("reconnect me", null);
      const runId = submit.runId;

      // Connect first, then mutate so the live frames are consumed in order.
      const first = await openStream(gateway, runId);
      const initial = await first.collector.until((parsed) => parsed.length >= 1);
      expect(initial[0]!.event).toBe("status");

      gateway.planner.calls[0]!.handle.markPlanning(runId);
      gateway.runtime.emit(makeSnapshot({ runId, state: "active", lastSequence: 5n }));
      gateway.runtime.emit(
        makeSnapshot({ runId, state: "active", lastSequence: 6n, intent: "later change" }),
      );

      const seen = await first.collector.until((parsed) => parsed.length >= 4);
      await first.collector.close();

      // Reconnect from the second frame: everything after it is replayed.
      const resumeFrom = seen[1]!.id!;
      const second = await openStream(gateway, runId, resumeFrom);
      const replayed = await second.collector.until((parsed) => parsed.length >= 2);

      const seenIds = seen.map((frame) => frame.id);
      expect(replayed.map((frame) => frame.id)).toEqual(seenIds.slice(2));
      // No leading reset on a healthy replay.
      expect(replayed[0]!.event).not.toBe("reset");
      await second.collector.close();
    } finally {
      gateway.stop();
    }
  });

  test("malformed and foreign-generation cursors get a leading reset", async () => {
    const gateway = bootTestGateway();
    try {
      const submit = await gateway.service.submit("reset me", null);
      const runId = submit.runId;
      gateway.runtime.emit(makeSnapshot({ runId, state: "active", lastSequence: 3n }));

      for (const cursor of ["garbage", encodeStreamCursor({ generation: 999, runId, seq: 0 })]) {
        const stream = await openStream(gateway, runId, cursor);
        const frames = await stream.collector.until((parsed) => parsed.length >= 1);
        expect(frames[0]!.event).toBe("reset");
        expect(frames[0]!.data).toMatchObject({
          version: 1,
          runId,
          reason: "cursor_unavailable",
        });
        const run = (frames[0]!.data as { run: { status: string } }).run;
        expect(run.status).toBe("running"); // reset carries the authoritative run
        await stream.collector.close();
      }
    } finally {
      gateway.stop();
    }
  });

  test("evicted history resets instead of silently skipping frames", async () => {
    const gateway = bootTestGateway({ replayBufferFrames: 2 });
    try {
      const submit = await gateway.service.submit("evict me", null);
      const runId = submit.runId;

      const first = await openStream(gateway, runId);
      const early = await first.collector.until((parsed) => parsed.length >= 1);
      const staleCursor = early[0]!.id!;
      await first.collector.close();

      // Push more than `replayBufferFrames` additional frames.
      for (const seq of [2n, 3n, 4n, 5n]) {
        gateway.runtime.emit(makeSnapshot({ runId, state: "active", lastSequence: seq }));
      }

      const second = await openStream(gateway, runId, staleCursor);
      const frames = await second.collector.until((parsed) => parsed.length >= 1);
      expect(frames[0]!.event).toBe("reset");
      await second.collector.close();
    } finally {
      gateway.stop();
    }
  });

  test("cursor for another run is scoped away and resets", async () => {
    const gateway = bootTestGateway();
    try {
      const a = await gateway.service.submit("run a", null);
      const b = await gateway.service.submit("run b", null);
      gateway.runtime.emit(makeSnapshot({ runId: a.runId, state: "active", lastSequence: 2n }));

      // A cursor minted for run a, replayed against run b: decodeStreamCursor
      // must reject it (generation/run scoping).
      const foreign = encodeStreamCursor({ generation: 7, runId: a.runId, seq: 0 });
      expect(decodeStreamCursor(foreign, 7, b.runId)).toBeNull();

      const stream = await openStream(gateway, b.runId, foreign);
      const frames = await stream.collector.until((parsed) => parsed.length >= 1);
      expect(frames[0]!.event).toBe("reset");
      expect((frames[0]!.data as { run: { runId: string } }).run.runId).toBe(b.runId);
      await stream.collector.close();
    } finally {
      gateway.stop();
    }
  });

  test("replaying across a terminal transition ends with terminal and closes", async () => {
    const gateway = bootTestGateway();
    try {
      const submit = await gateway.service.submit("finish me", null);
      const runId = submit.runId;

      const first = await openStream(gateway, runId);
      const early = await first.collector.until((parsed) => parsed.length >= 1);
      const resumeFrom = early[0]!.id!;
      await first.collector.close();

      gateway.runtime.emit(
        makeSnapshot({ runId, state: "completed", lastSequence: 8n, tasks: [] }),
      );

      const second = await openStream(gateway, runId, resumeFrom);
      const frames = await second.collector.until((parsed) =>
        parsed.some((f) => f.event === "terminal"),
      );
      expect(second.collector.closedByServer).toBe(true);
      expect(frames.some((frame) => frame.event === "status")).toBe(true);
      expect(frames.at(-1)!.event).toBe("terminal");
    } finally {
      gateway.stop();
    }
  });
});

describe("stream negotiation errors", () => {
  test("non-SSE Accept gets 406 stream_not_acceptable", async () => {
    const gateway = bootTestGateway();
    try {
      const submit = await gateway.service.submit("negotiate", null);
      const response = await fetch(`${gateway.baseUrl}/v1/runs/${submit.runId}/events`, {
        headers: { Accept: "application/json", ...authHeader(gateway.token()) },
      });
      expect(response.status).toBe(406);
      expect(((await response.json()) as { code: string }).code).toBe("stream_not_acceptable");
    } finally {
      gateway.stop();
    }
  });

  test("unknown run is a 404 problem before any stream headers", async () => {
    const gateway = bootTestGateway();
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/runs/run-does-not-exist/events`, {
        headers: { Accept: "text/event-stream", ...authHeader(gateway.token()) },
      });
      expect(response.status).toBe(404);
      expect(response.headers.get("Content-Type")).toBe("application/problem+json");
      expect(((await response.json()) as { code: string }).code).toBe("run_not_found");
    } finally {
      gateway.stop();
    }
  });
});
