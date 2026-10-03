/**
 * Session tap -> collector round-trip over the REAL unix socket (decision
 * 2026-xx-gui-conversation M-GC1, gateway side): a scripted fake pi drives
 * the actual extension tap core (pi-extensions/session-tap.ts, the exact
 * artifact pi loads) through its default node:net transport against a real
 * SessionCollector socket, and the collector's session inventory and SSE
 * frame buffer are asserted. Deterministic: no pi process, no paid model
 * calls. Sender semantics (vocabulary, backoff, fail-open) live in
 * packages/pi-loop/test/session-tap.test.ts.
 */

import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionCollector } from "../src/session-collector";
import { SessionEventLog, type SessionOutboundFrame } from "../src/session-events";
import { SessionTap, type TapPi } from "../../../pi-extensions/session-tap";

// ——— scripted fake pi (drives the real tap) ———

class FakePi {
  readonly handlers = new Map<string, Array<(event: never, ctx: never) => void>>();
  readonly sent: Array<{ content: unknown; options: unknown }> = [];

  on(event: string, handler: (event: never, ctx: never) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  sendUserMessage(content: unknown, options?: unknown): void {
    this.sent.push({ content, options });
  }

  fire(event: string, payload: unknown = {}, ctx: unknown = {}): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload as never, ctx as never);
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000, stepMs = 5): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor: deadline exceeded");
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

function startCollector(
  socketPath: string,
  capacity = 128,
): { collector: SessionCollector; log: SessionEventLog } {
  const log = new SessionEventLog(3, capacity);
  const collector = new SessionCollector({
    log,
    socketPath,
    // Real pump, tightened for tests: deltas flush >=25ms apart, checked
    // every 5ms. Assertions poll, so wall-clock jitter is absorbed.
    mergeFlushMs: 25,
    mergeTickMs: 5,
  });
  collector.start();
  return { collector, log };
}

function frameEvents(collector: SessionCollector, sessionId: string): string[] {
  return collector.bufferedFrames(sessionId).map((frame) => frame.event);
}

describe("tap -> collector over the real socket (M-GC1)", () => {
  test("a scripted fake pi session streams into the inventory and the conversation buffer", async () => {
    const socketPath = join(tmpdir(), `loop-test-tap-${crypto.randomUUID()}.sock`);
    const { collector } = startCollector(socketPath);
    const sessionId = `sess-${crypto.randomUUID().slice(0, 8)}`;
    try {
      const pi = new FakePi();
      const imageBody = Buffer.from("fakepng-bytes").toString("base64");
      const tap = new SessionTap(pi as TapPi, {
        environment: { LOOP_RUN_ID: "run-e2e", LOOP_TASK_ID: "task-e2e" },
        socketPath,
        transport: { backoffMs: 10, maxBackoffMs: 40 },
      });

      // session_start: the tap connects and registers (real node:net transport).
      tap.startSession({ sessionManager: { getSessionId: () => sessionId } });
      await waitFor(() => tap.connected);

      // The operator types in the TUI (with one attached image).
      tap.handleInput({
        type: "input",
        text: "tmux 세션에서 온 인사",
        images: [{ type: "image", data: imageBody, mimeType: "image/png" }],
        source: "interactive",
      });
      // A turn streams an assistant message.
      tap.handleTurnStart({ type: "turn_start" });
      tap.handleMessageUpdate({
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "안녕" }] },
      });
      await waitFor(() => frameEvents(collector, sessionId).includes("assistant_delta"));
      tap.handleMessageUpdate({
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "안녕하세요" }] },
      });
      await waitFor(
        () =>
          collector.bufferedFrames(sessionId).filter((f) => f.event === "assistant_delta").length >=
          2,
      );
      tap.handleMessageEnd({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "안녕하세요 최종" }] },
      });
      await waitFor(() => frameEvents(collector, sessionId).includes("assistant_message"));
      // A tool call card.
      tap.handleToolStart({
        type: "tool_execution_start",
        toolCallId: "tc-1",
        toolName: "bash",
        args: { command: "echo hi" },
      });
      tap.handleToolUpdate({ type: "tool_execution_update", toolCallId: "tc-1" }); // observed, not streamed
      tap.handleToolEnd({
        type: "tool_execution_end",
        toolCallId: "tc-1",
        result: { content: [{ type: "text", text: "hi" }] },
        isError: false,
      });
      await waitFor(() => frameEvents(collector, sessionId).includes("tool_call_ended"));
      tap.handleTurnEnd({ type: "turn_end" });
      await waitFor(
        () =>
          frameEvents(collector, sessionId).filter((event) => event === "lifecycle").length >= 3,
      );

      // Inventory: the tapped real session is listed with honest correlation.
      const list = collector.listSessions();
      expect(list.sessions).toHaveLength(1);
      expect(list.sessions[0]).toEqual({
        sessionId,
        runId: "run-e2e",
        taskId: "task-e2e",
        workerId: null,
        lane: "pi",
        title: null,
        state: "live",
      });

      // Conversation buffer: the full D2 frame sequence, in order.
      const events = frameEvents(collector, sessionId);
      expect(events).toEqual([
        "lifecycle", // sessionStarted
        "user_message",
        "lifecycle", // turnStarted
        "assistant_delta",
        "assistant_delta",
        "assistant_message",
        "tool_call_started",
        "tool_call_ended",
        "lifecycle", // turnEnded
      ]);
      const frames = collector.bufferedFrames(sessionId) as Array<
        SessionOutboundFrame & { data: Record<string, unknown> }
      >;
      expect(frames[0]!.data).toMatchObject({ phase: "sessionStarted" });
      expect(frames[2]!.data).toMatchObject({ phase: "turnStarted" });
      expect(frames[8]!.data).toMatchObject({ phase: "turnEnded" });
      const attachmentId = (frames[1]!.data.attachments as Array<{ attachmentId: string }>)[0]!
        .attachmentId;
      expect(frames[1]!.data).toMatchObject({
        text: "tmux 세션에서 온 인사",
        source: "interactive",
        imageCount: 1,
        attachments: [
          {
            attachmentId: expect.any(String),
            mimeType: "image/png",
            byteLen: "fakepng-bytes".length,
          },
        ],
      });
      // Deltas are merged suffixes; the final replaces the buffer text.
      expect(frames[3]!.data).toMatchObject({ delta: "안녕" });
      expect(frames[4]!.data).toMatchObject({ delta: "하세요" });
      expect(frames[5]!.data).toMatchObject({ text: "안녕하세요 최종", truncated: false });
      expect(frames[6]!.data).toMatchObject({
        toolCallId: "tc-1",
        toolName: "bash",
        argsJson: '{"command":"echo hi"}',
      });
      expect(frames[7]!.data).toMatchObject({
        toolCallId: "tc-1",
        resultText: "hi",
        isError: false,
      });

      // The attachment body referenced by the user_message frame is fetchable.
      const attachment = collector.getAttachment(sessionId, attachmentId);
      expect(attachment).not.toBeNull();
      expect(Buffer.from(attachment!.bytes).toString("utf8")).toBe("fakepng-bytes");
    } finally {
      collector.stop();
      rmSync(socketPath, { force: true });
    }
  });

  test("collector restart: the tap reconnects and re-registers live", async () => {
    const socketPath = join(tmpdir(), `loop-test-tap-${crypto.randomUUID()}.sock`);
    let { collector, log } = startCollector(socketPath);
    const sessionId = `sess-${crypto.randomUUID().slice(0, 8)}`;
    try {
      const pi = new FakePi();
      const tap = new SessionTap(pi as TapPi, {
        socketPath,
        transport: { backoffMs: 10, maxBackoffMs: 40 },
      });
      tap.startSession({ sessionManager: { getSessionId: () => sessionId } });
      await waitFor(() => tap.connected);

      // Gateway restart: the socket dies under the tap.
      collector.stop();
      await waitFor(() => !tap.connected);

      // Frames offered while disconnected are dropped (honest loss).
      tap.handleInput({ type: "input", text: "during the gap" });

      // The collector comes back on the same socket path.
      const revived = startCollector(socketPath);
      collector = revived.collector;
      log = revived.log;

      // The tap's capped backoff reconnects and re-registers.
      await waitFor(() => tap.connected, 5_000);
      await waitFor(() => collector.listSessions().sessions.length > 0);
      expect(collector.listSessions().sessions[0]).toMatchObject({
        sessionId,
        state: "live",
        lane: "pi",
      });

      // The re-registered session streams frames into the NEW collector.
      tap.handleMessageEnd({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "다시 산다" }] },
      });
      await waitFor(() => frameEvents(collector, sessionId).includes("assistant_message"));
      expect(frameEvents(collector, sessionId)).toEqual(["lifecycle", "assistant_message"]);
      expect(collector.bufferedFrames(sessionId)[1]!.data).toMatchObject({ text: "다시 산다" });
      void log;
    } finally {
      collector.stop();
      rmSync(socketPath, { force: true });
    }
  });

  test("session_shutdown marks the session ended and replays a sessionGone reset", async () => {
    const socketPath = join(tmpdir(), `loop-test-tap-${crypto.randomUUID()}.sock`);
    const { collector, log } = startCollector(socketPath);
    const sessionId = `sess-${crypto.randomUUID().slice(0, 8)}`;
    try {
      const pi = new FakePi();
      const tap = new SessionTap(pi as TapPi, {
        socketPath,
        transport: { backoffMs: 10, maxBackoffMs: 40 },
      });
      tap.startSession({ sessionManager: { getSessionId: () => sessionId } });
      await waitFor(() => tap.connected);
      tap.handleInput({ type: "input", text: "한 번 쓰고 끝낸다" });
      await waitFor(() => frameEvents(collector, sessionId).includes("user_message"));

      // The operator quits pi: the tap sends the honest shutdown line.
      tap.stopSession();
      await waitFor(() => collector.listSessions().sessions[0]!.state === "ended");
      expect(tap.connected).toBe(false);

      // History replays, then converges on the shared sessionGone reset.
      const observation = collector.observeSession(sessionId, null);
      expect(observation.terminalAfterIntro).toBe(true);
      expect(observation.intro.at(-1)).toMatchObject({
        event: "conversation_reset",
        data: { reason: "sessionGone" },
      });
      expect(log.isGone(sessionId)).toBe(true);
    } finally {
      collector.stop();
      rmSync(socketPath, { force: true });
    }
  });

  test("no gateway at all: the tap stays inert and pi keeps working (fail-open)", async () => {
    const socketPath = join(tmpdir(), `loop-test-tap-absent-${crypto.randomUUID()}.sock`);
    const pi = new FakePi();
    const tap = new SessionTap(pi as TapPi, {
      socketPath,
      transport: { backoffMs: 10, maxBackoffMs: 20 },
    });
    tap.startSession({ sessionManager: { getSessionId: () => "sess-off" } });
    expect(tap.connected).toBe(false);
    // Everything still "works" locally; frames are silently dropped.
    tap.handleInput({ type: "input", text: "invisible to the app" });
    tap.handleMessageEnd({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "still fine" }] },
    });
    tap.stopSession();
    expect(tap.connected).toBe(false);
    expect(tap.sessionId).toBeNull();
  });
});
