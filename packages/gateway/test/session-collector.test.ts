/**
 * SessionCollector unit behavior (decision 2026-xx-gui-conversation D1/D2/D4,
 * M-GC1): delta merge cadence, final authority, redaction + bounds,
 * fail-observer ingress, correlation honesty, and the real unix-socket
 * round-trip. Deterministic: a fake clock drives merges; no pi process, no
 * paid model calls.
 */

import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { SessionOutboundFrame } from "../src/session-events";
import { SessionEventLog } from "../src/session-events";
import { SessionCollector } from "../src/session-collector";

function harness(
  overrides: { capacity?: number; maxFrameBytes?: number; mergeFlushMs?: number } = {},
) {
  const log = new SessionEventLog(5, overrides.capacity ?? 512);
  const collector = new SessionCollector({
    log,
    nowMs: () => clock.now,
    mergeFlushMs: overrides.mergeFlushMs ?? 250,
    mergeTickMs: 0, // tests pump manually
    maxFrameBytes: overrides.maxFrameBytes ?? 16 * 1024,
  });
  let now = 1_700_000_000_000;
  const clock = {
    get now(): number {
      return now;
    },
    advance(ms: number): void {
      now += ms;
    },
  };
  const frames = (sessionId: string): SessionOutboundFrame[] => log.bufferedFrames(sessionId);
  const events = (sessionId: string): string[] => frames(sessionId).map((frame) => frame.event);
  return { log, collector, clock, frames, events };
}

type CollectorHarness = ReturnType<typeof harness>;

function registered(
  h: CollectorHarness,
  sessionId = "s-1",
  register: Record<string, unknown> = {},
) {
  h.collector.openConnection("c1");
  h.collector.ingestLine(
    "c1",
    JSON.stringify({ type: "register", sessionId, lane: "pi", ...register }),
  );
  return "c1";
}

describe("assistant delta merge (D4 §2)", () => {
  test("many snapshots inside one window merge into one delta; the flush interval holds ≥ mergeFlushMs", () => {
    const h = harness();
    const conn = registered(h);

    // Nine updates within one flush window (1 s of updates, no pump tick).
    for (let index = 1; index <= 9; index += 1) {
      h.collector.ingestLine(
        conn,
        JSON.stringify({ type: "assistant_update", messageId: "m-1", text: `text ${index}` }),
      );
    }
    h.clock.advance(100);
    h.collector.tickMerge(h.clock.now); // due at +250: not yet flushed
    expect(h.events("s-1")).toEqual([]);
    h.clock.advance(200); // now past the due time
    h.collector.tickMerge(h.clock.now);

    const deltas = h.frames("s-1");
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.event).toBe("assistant_delta");
    expect(deltas[0]!.data).toMatchObject({ messageId: "m-1", delta: "text 9" });

    // Next snapshot schedules a NEW window ≥250 ms after the first flush.
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "assistant_update", messageId: "m-1", text: "text 9 and more" }),
    );
    h.clock.advance(100);
    h.collector.tickMerge(h.clock.now);
    expect(h.frames("s-1")).toHaveLength(1); // inside the window: nothing yet
    h.clock.advance(200);
    h.collector.tickMerge(h.clock.now);
    expect(h.frames("s-1")).toHaveLength(2);
    expect(h.frames("s-1")![1]!.data).toMatchObject({ delta: " and more" }); // suffix delta only
  });

  test("the final replaces the buffer: no trailing delta for pending snapshots, final is authoritative", () => {
    const h = harness();
    const conn = registered(h);
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "assistant_update", messageId: "m-1", text: "partial draft" }),
    );
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "assistant_message", messageId: "m-1", text: "the real final" }),
    );
    h.clock.advance(1_000);
    h.collector.tickMerge(h.clock.now);

    expect(h.events("s-1")).toEqual(["assistant_message"]);
    expect(h.frames("s-1")![0]!.data).toMatchObject({
      messageId: "m-1",
      text: "the real final",
      truncated: false,
    });
  });

  test("updates for a finalized message never reopen the buffer; final-less flush still converges", () => {
    const h = harness();
    const conn = registered(h);
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "assistant_message", messageId: "m-1", text: "done" }),
    );
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "assistant_update", messageId: "m-1", text: "done + zombie" }),
    );
    h.clock.advance(1_000);
    h.collector.tickMerge(h.clock.now);
    expect(h.events("s-1")).toEqual(["assistant_message"]);
  });

  test("over-cap merges drop updates for NEW message ids but never their finals (final converges)", () => {
    const h = harness({ mergeFlushMs: 0 }); // every tick flushes
    const conn = registered(h);
    for (let index = 0; index < 32; index += 1) {
      h.collector.ingestLine(
        conn,
        JSON.stringify({ type: "assistant_update", messageId: `m-${index}`, text: "x" }),
      );
    }
    h.collector.tickMerge(h.clock.now);
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "assistant_update", messageId: "m-over", text: "dropped" }),
    );
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "assistant_message", messageId: "m-over", text: "final kept" }),
    );
    h.collector.tickMerge(h.clock.now);

    expect(h.frames("s-1").filter((frame) => frame.event === "assistant_message")).toHaveLength(1);
    expect(
      h
        .frames("s-1")
        .some((frame) => frame.data && (frame.data as { text?: string }).text === "final kept"),
    ).toBe(true);
  });
});

describe("redaction and bounds (D4 §8, D2)", () => {
  test("every text field passes [credential]=[redacted]; oversize text is cut", () => {
    const h = harness({ maxFrameBytes: 64 });
    const conn = registered(h);
    h.collector.ingestLine(
      conn,
      JSON.stringify({
        type: "user_message",
        messageId: "m-1",
        text: "my token: supersecret123 value",
        source: "interactive",
      }),
    );
    h.collector.ingestLine(
      conn,
      JSON.stringify({
        type: "tool_call_started",
        toolCallId: "tc-1",
        toolName: "curl",
        argsJson: '{"authorization":"Bearer abc.def.ghi"}',
      }),
    );
    h.collector.ingestLine(
      conn,
      JSON.stringify({
        type: "tool_call_ended",
        toolCallId: "tc-1",
        resultText: "bearer zzz-secret and lots of padding " + "p".repeat(200),
        isError: true,
      }),
    );

    const user = h.frames("s-1")[0]!.data as { text: string };
    expect(user.text).toContain("[credential]=[redacted]");
    expect(user.text).not.toContain("supersecret123");
    expect(Buffer.byteLength(user.text, "utf8")).toBeLessThanOrEqual(64);

    const started = h.frames("s-1")[1]!.data as { argsJson: string; argsTruncated: boolean };
    expect(started.argsJson).toContain("[credential]=[redacted]");
    expect(started.argsJson).not.toContain("abc.def.ghi");

    const ended = h.frames("s-1")[2]!.data as {
      resultText: string;
      resultTruncated: boolean;
      isError: boolean;
    };
    expect(ended.resultText).toContain("[credential]=[redacted]");
    expect(ended.resultTruncated).toBe(true); // 200 chars of padding over the 64-byte cap
    expect(ended.isError).toBe(true);

    // Deltas and finals pass the same gate.
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "assistant_update", messageId: "m-2", text: "password: hunter2" }),
    );
    h.clock.advance(1_000);
    h.collector.tickMerge(h.clock.now);
    expect((h.frames("s-1")[3]!.data as { delta: string }).delta).toContain(
      "[credential]=[redacted]",
    );
  });
});

describe("fail-observer ingress (D1)", () => {
  test("malformed, premature, and unknown lines are dropped without state changes", () => {
    const h = harness();
    h.collector.ingestLine(
      "c-unknown",
      JSON.stringify({ type: "user_message", messageId: "m-1", text: "x" }),
    );
    h.collector.openConnection("c1");
    for (const line of [
      "not json",
      "[]",
      JSON.stringify({ type: "user_message", messageId: "m-1", text: "before register" }),
      JSON.stringify({ type: "register" }), // missing sessionId
      JSON.stringify({ type: "register", sessionId: "" }),
      JSON.stringify({ type: "lifecycle", phase: "sessionStarted" }), // still unregistered
      JSON.stringify({ type: "time_travel", messageId: "m-1" }), // unknown type
    ]) {
      h.collector.ingestLine("c1", line);
    }
    expect(h.collector.listSessions().sessions).toEqual([]);
    expect(h.events("s-1")).toEqual([]);

    // Invalid observation values are ignored, valid ones still land.
    const conn = registered(h);
    h.collector.ingestLine(conn, JSON.stringify({ type: "lifecycle", phase: "exploded" }));
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "user_message", messageId: "", text: "x" }),
    );
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "user_message", messageId: "m-1", text: "ok", source: "hijacked" }),
    );
    expect(h.events("s-1")).toEqual(["user_message"]);
    expect((h.frames("s-1")[0]!.data as { source: string }).source).toBe("interactive"); // default, not "hijacked"
  });

  test("a second register on the same connection is ignored; unknown-session observations never create state", () => {
    const h = harness();
    const conn = registered(h, "s-1", { runId: "run-1" });
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "register", sessionId: "s-hijack", lane: "pi" }),
    );
    h.collector.ingestLine(
      "c-other-opened",
      JSON.stringify({ type: "user_message", messageId: "m-1", text: "x" }),
    );
    h.collector.openConnection("c2");
    h.collector.ingestLine(
      "c2",
      JSON.stringify({ type: "user_message", messageId: "m-1", text: "unregistered" }),
    );

    const sessions = h.collector.listSessions().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe("s-1");
    expect(h.collector.listSessions().sessions[0]!.state).toBe("live");
  });
});

describe("session lifetime (D3)", () => {
  test("shutdown records the shared sessionGone reset and closes the session to further traffic", () => {
    const h = harness();
    const conn = registered(h);
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "user_message", messageId: "m-1", text: "hello" }),
    );
    h.collector.ingestLine(conn, JSON.stringify({ type: "session_shutdown" }));

    expect(h.collector.listSessions().sessions[0]!.state).toBe("ended");
    // The gone reset is shared-recorded (run/pane terminal precedent), not a
    // buffered conversation frame.
    const gone = h.log.goneReset("s-1")!;
    expect(gone.event).toBe("conversation_reset");
    expect(gone.data).toMatchObject({ reason: "sessionGone" });
    // Shared-recorded: reconnect intro converges on the same frame.
    const observation = h.collector.observeSession("s-1", null);
    expect(observation.terminalAfterIntro).toBe(true);
    expect(observation.intro.at(-1)!.data).toEqual(gone.data);

    // Post-shutdown traffic is dropped.
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "user_message", messageId: "m-2", text: "zombie" }),
    );
    expect(h.events("s-1").filter((event) => event === "user_message")).toHaveLength(1);
  });

  test("tap disconnect marks unobserved (history replayable); reconnect marks live again", () => {
    const h = harness();
    const conn = registered(h);
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "user_message", messageId: "m-1", text: "hello" }),
    );
    h.collector.tapDisconnected(conn);

    expect(h.collector.listSessions().sessions[0]!.state).toBe("unobserved");
    expect(h.collector.observeSession("s-1", null).intro.map((frame) => frame.event)).toEqual([
      "user_message",
    ]);
    expect(h.collector.observeSession("s-1", null).terminalAfterIntro).toBe(false);

    const conn2 = "c2";
    h.collector.openConnection(conn2);
    h.collector.ingestLine(
      conn2,
      JSON.stringify({ type: "register", sessionId: "s-1", lane: "pi" }),
    );
    expect(h.collector.listSessions().sessions[0]!.state).toBe("live");
  });

  test("steer mirrors only onto live sessions correlated to the run", () => {
    const h = harness();
    const live = registered(h, "s-live", { runId: "run-1" });
    h.collector.openConnection("c2");
    h.collector.ingestLine(
      "c2",
      JSON.stringify({ type: "register", sessionId: "s-ended", runId: "run-1", lane: "pi" }),
    );
    h.collector.ingestLine("c2", JSON.stringify({ type: "session_shutdown" }));
    h.collector.openConnection("c3");
    h.collector.ingestLine(
      "c3",
      JSON.stringify({ type: "register", sessionId: "s-other", runId: "run-2", lane: "pi" }),
    );

    expect(h.collector.mirrorSteerQueued({ runId: "run-1", steerId: "st-1", text: "go" })).toBe(1);
    expect(h.events("s-live")).toEqual(["steer_queued"]);
    expect(h.log.goneReset("s-ended")).not.toBeNull(); // ended session: reset surface only
    // A second steer mirrors onto the still-live session; ended/other stay untouched.
    expect(
      h.collector.mirrorSteerQueued({ runId: "run-1", steerId: "st-2", text: "token: abc123" }),
    ).toBe(1);
    expect(h.events("s-live")).toEqual(["steer_queued", "steer_queued"]);
    expect(h.frames("s-live").map((frame) => (frame.data as { steerId: string }).steerId)).toEqual([
      "st-1",
      "st-2",
    ]);
    expect(h.events("s-other")).toEqual([]);

    // Text passes the gate on the mirror too.
    expect((h.frames("s-live")[0]!.data as { text: string }).text).toBe("go");
    h.collector.ingestLine(live, JSON.stringify({ type: "lifecycle", phase: "turnStarted" }));
    expect(
      h.collector.mirrorSteerQueued({ runId: "run-1", steerId: "st-3", text: "token: abc123" }),
    ).toBe(1);
    expect((h.frames("s-live").at(-1)!.data as { text: string }).text).toContain(
      "[credential]=[redacted]",
    );
  });
});

describe("unknown session surface rules", () => {
  test("observeSession 404s for unknown sessions; slowConsumerReset is null without state", () => {
    const h = harness();
    expect(() => h.collector.observeSession("nope", null)).toThrow(/session_not_found/);
    expect(h.collector.slowConsumerReset("nope")).toBeNull();
    const conn = registered(h);
    h.collector.ingestLine(
      conn,
      JSON.stringify({ type: "user_message", messageId: "m-1", text: "x" }),
    );
    const reset = h.collector.slowConsumerReset("s-1");
    expect(reset).not.toBeNull();
    expect(reset!.event).toBe("conversation_reset");
    expect((reset!.data as { reason: string }).reason).toBe("slowConsumer");
  });
});

describe("unix socket round-trip (D1 ingress)", () => {
  test("NDJSON lines over the real socket become frames; socket end marks unobserved", async () => {
    const socketPath = join(tmpdir(), `loop-test-session-${crypto.randomUUID()}.sock`);
    const log = new SessionEventLog(9, 64);
    const collector = new SessionCollector({ log, socketPath, mergeTickMs: 0 });
    collector.start();
    try {
      const socket = await Bun.connect({
        unix: socketPath,
        socket: {
          data() {},
        },
      });
      socket.write(
        `${JSON.stringify({ type: "register", sessionId: "s-sock", runId: "run-sock", lane: "pi" })}\n`,
      );
      socket.write(
        `${JSON.stringify({ type: "user_message", messageId: "m-1", text: "over the socket" })}\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));

      const observation = collector.observeSession("s-sock", null);
      expect(observation.intro.map((frame) => frame.event)).toEqual(["user_message"]);
      expect(observation.intro[0]!.data).toMatchObject({
        messageId: "m-1",
        text: "over the socket",
      });
      expect(collector.listSessions().sessions[0]).toMatchObject({
        sessionId: "s-sock",
        runId: "run-sock",
        state: "live",
      });

      socket.end();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(collector.listSessions().sessions[0]!.state).toBe("unobserved");
    } finally {
      collector.stop();
      rmSync(socketPath, { force: true });
    }
  });
});
