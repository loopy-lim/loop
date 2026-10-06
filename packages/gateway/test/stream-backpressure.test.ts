/**
 * SseClientStream unit behavior (ADR §4.5): frame wire format, bounded
 * per-connection queue, slow-consumer convergence to one authoritative
 * reset, and terminal/keepalive handling. Pure in-memory, fully
 * deterministic.
 */

import { describe, expect, test } from "bun:test";

import type { SseFrameName } from "../src/events";
import { encodeFrame, KEEPALIVE_COMMENT, SseClientStream } from "../src/stream";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

function frame(event: SseFrameName, seq: number, data: unknown = {}) {
  return { id: `id-${seq}`, event, data };
}

describe("frame encoding", () => {
  test("id/event/data then blank line; data stays a single JSON line", () => {
    const text = encodeFrame({ id: "abc", event: "status", data: { version: 1, runId: "r" } });
    expect(text).toBe('id: abc\nevent: status\ndata: {"version":1,"runId":"r"}\n\n');
  });

  test("keepalive is an SSE comment without cursor", () => {
    expect(KEEPALIVE_COMMENT).toBe(": keepalive\n\n");
  });
});

function resetFrame(seq: number) {
  return {
    id: `reset-${seq}`,
    event: "reset",
    data: {
      version: 1,
      runId: "r",
      reason: "slow_consumer",
      run: { runId: "r", status: "running" },
    },
  } as const;
}

describe("bounded queue and slow-consumer convergence", () => {
  test("outputs up to the frame cap queue; overflow drops outputs for a caller reset", () => {
    const stream = new SseClientStream({ maxFrames: 4, maxBytes: 1024 * 1024 });
    for (let seq = 1; seq <= 4; seq += 1) {
      expect(stream.write(frame("output", seq), "output")).toBe("queued");
    }
    expect(stream.pendingFrames).toBe(4);

    expect(stream.write(frame("output", 5), "output")).toBe("dropped");
    // Every pending output is gone; the caller now converges with one reset.
    expect(stream.pendingFrames).toBe(0);
    expect(stream.write(resetFrame(6), "control")).toBe("queued");
    expect(stream.pendingFrames).toBe(1);
    const queued = JSON.parse(must(readAll(stream).match(/data: (.*)\n/)?.[1]));
    expect(queued).toMatchObject({ reason: "slow_consumer", run: { runId: "r" } });
    expect(stream.closed).toBe(false);
  });

  test("the convergence reset carries the latest run shape provided by the service", () => {
    const stream = new SseClientStream({ maxFrames: 1, maxBytes: 1024 * 1024 });
    expect(stream.write(frame("output", 1), "output")).toBe("queued");
    expect(stream.write(frame("output", 2), "output")).toBe("dropped");
    expect(stream.write(resetFrame(3), "control")).toBe("queued");
    const raw = readAll(stream);
    expect(raw).toContain('"reason":"slow_consumer"');
    expect(raw).toContain('"runId":"r"');
  });

  test("a reset that cannot fit closes the connection", () => {
    const tiny = new SseClientStream({ maxFrames: 4, maxBytes: 50 });
    expect(tiny.write(frame("output", 1), "output")).toBe("queued");
    expect(tiny.write(frame("output", 2), "output")).toBe("dropped");
    // The reset does not fit → close; the run itself is unaffected.
    expect(tiny.write(resetFrame(3), "control")).toBe("closed");
    expect(tiny.closed).toBe(true);
    expect(tiny.write(frame("output", 4), "output")).toBe("closed");
  });

  test("control frames are never dropped by output overflow", () => {
    const stream = new SseClientStream({ maxFrames: 2, maxBytes: 1024 * 1024 });
    expect(stream.write(frame("status", 1), "control")).toBe("queued");
    expect(stream.write(frame("output", 2), "output")).toBe("queued");
    // Third frame overflows: pending output is dropped, status survives.
    expect(stream.write(frame("output", 3), "output")).toBe("dropped");
    expect(stream.write(resetFrame(4), "control")).toBe("queued");
    const raw = readAll(stream);
    expect(raw).toContain("event: status");
    expect(raw).toContain("event: reset");
    expect(raw).not.toContain("id-3");
  });

  test("writes after close are ignored and terminal closes after flush", () => {
    const stream = new SseClientStream({ maxFrames: 8, maxBytes: 1024 * 1024 });
    stream.write(frame("terminal", 1), "control");
    stream.close("terminal");
    expect(stream.write(frame("output", 2), "output")).toBe("closed");
    expect(stream.closeReason).toBe("terminal");
  });

  test("keepalive queues a comment and is exempt from the frame cap", () => {
    const stream = new SseClientStream({ maxFrames: 1, maxBytes: 1024 * 1024 });
    stream.write(frame("status", 1), "control");
    stream.keepalive();
    stream.keepalive();
    const raw = readAll(stream);
    expect(raw.split(KEEPALIVE_COMMENT)).toHaveLength(3);
  });
});

function readAll(stream: SseClientStream): string {
  let out = "";
  for (;;) {
    const chunk = stream.read();
    if (chunk === null) return out;
    out += chunk;
  }
}
