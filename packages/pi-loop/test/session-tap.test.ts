/**
 * Session tap sender behavior (decision 2026-xx-gui-conversation D1/D5, the
 * pi-loop side of M-GC1): the tap core lives in pi-extensions/session-tap.ts
 * (self-contained by design — pi loads it directly), and these tests import
 * that exact file so the tested artifact IS the deployed artifact.
 *
 * Covered here: event->line vocabulary, register-first ordering with env
 * markers, reconnect backoff, fail-open contracts, and the deliver_input
 * feedback path. The gateway-side round-trip over the real collector socket
 * lives in packages/gateway/test/session-tap-ingress.test.ts. No pi process,
 * no paid model calls.
 */

import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SessionTap,
  TapTransport,
  messageText,
  tapMarker,
  tapSocketPath,
  tapUserSource,
  toolArgsJson,
  toolResultText,
  truncateUtf8,
  type TapSocketHandle,
  type TapSocketHandlers,
} from "../../../pi-extensions/session-tap";
import sessionTapExtension from "../../../pi-extensions/session-tap";

// ——— fakes ———

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

interface RecordedHandle {
  writes: string[];
  handlers: TapSocketHandlers;
  closed: boolean;
}

class ScriptedConnect {
  readonly handles: RecordedHandle[] = [];
  failing = false;

  connect(socketPath: string, handlers: TapSocketHandlers): TapSocketHandle {
    if (this.failing) throw new Error("no collector socket");
    const record: RecordedHandle = { writes: [], handlers, closed: false };
    this.handles.push(record);
    void socketPath;
    return {
      write: (line: string) => {
        record.writes.push(line);
      },
      close: () => {
        record.closed = true;
      },
    };
  }

  get last(): RecordedHandle {
    return this.handles[this.handles.length - 1]!;
  }
}

/** Backoff schedule captured in-process so tests drive retries synchronously. */
class ScriptedSchedule {
  readonly pending: Array<{ fn: () => void; ms: number }> = [];

  schedule(fn: () => void, ms: number): unknown {
    this.pending.push({ fn, ms });
    return this.pending.length;
  }

  cancel(timer: unknown): void {
    const index = (timer as number) - 1;
    if (index >= 0 && index < this.pending.length) this.pending.splice(index, 1);
  }
}

function parseLines(writes: string[]): unknown[] {
  return writes.map((line) => JSON.parse(line));
}

function makeTap(
  pi: FakePi,
  scripted: ScriptedConnect,
  overrides: {
    environment?: Record<string, string | undefined>;
    maxBackoffMs?: number;
    schedule?: ScriptedSchedule;
  } = {},
): SessionTap {
  return new SessionTap(pi, {
    environment: { LOOP_RUN_ID: "run-9", LOOP_TASK_ID: "t-1", ...overrides.environment },
    socketPath: "/unused.sock",
    transport: {
      connect: (path, handlers) => scripted.connect(path, handlers),
      backoffMs: 500,
      maxBackoffMs: overrides.maxBackoffMs ?? 15_000,
      ...(overrides.schedule === undefined
        ? {}
        : {
            schedule: (fn: () => void, ms: number) => overrides.schedule!.schedule(fn, ms),
            cancelSchedule: (timer: unknown) => overrides.schedule!.cancel(timer),
          }),
    },
  });
}

// ——— pure mappings ———

describe("event -> line mapping (pure)", () => {
  test("messageText keeps text blocks, drops thinking/tool-call blocks", () => {
    expect(
      messageText({
        content: [
          { type: "thinking", thinking: "secret" },
          { type: "text", text: "hello " },
          { type: "text", text: "world" },
          { type: "toolCall", id: "tc-1" },
        ],
      }),
    ).toBe("hello world");
    expect(messageText("plain")).toBe("plain");
    expect(messageText({ content: "string content" })).toBe("string content");
    expect(messageText(42)).toBe("");
  });

  test("toolResultText prefers text blocks, falls back to JSON", () => {
    expect(toolResultText("raw")).toBe("raw");
    expect(
      toolResultText({
        content: [
          { type: "text", text: "a" },
          { type: "image", data: "x" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\nb");
    expect(toolResultText({ details: { code: 7 } })).toBe('{"details":{"code":7}}');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toolResultText(circular)).toBe("[unserializable tool result]");
  });

  test("toolArgsJson is bounded, total, and null for undefined", () => {
    expect(toolArgsJson(undefined)).toBe("null");
    expect(toolArgsJson({ command: "ls" })).toBe('{"command":"ls"}');
    expect(toolArgsJson("x".repeat(70_000))).toHaveLength(64 * 1024);
  });

  test("tapUserSource: steer delivery is steer, non-interactive origins are api", () => {
    expect(tapUserSource({ type: "input", source: "interactive", text: "x" })).toBe("interactive");
    expect(
      tapUserSource({
        type: "input",
        source: "interactive",
        text: "x",
        streamingBehavior: "steer",
      }),
    ).toBe("steer");
    expect(tapUserSource({ type: "input", source: "rpc", text: "x" })).toBe("api");
    expect(tapUserSource({ type: "input", source: "extension", text: "x" })).toBe("api");
  });

  test("truncateUtf8 cuts on bytes, not characters", () => {
    const text = "가".repeat(10); // 3 bytes each
    expect(truncateUtf8(text, 7)).toHaveLength(2); // 6 clean bytes; the cut third is dropped
    expect(Buffer.byteLength(truncateUtf8(text, 7), "utf8")).toBe(6);
    expect(truncateUtf8("abc", 10)).toBe("abc");
  });

  test("tapMarker trims, bounds, and reports absence honestly", () => {
    expect(tapMarker(undefined)).toBeNull();
    expect(tapMarker("  ")).toBeNull();
    expect(tapMarker(" run-7 ")).toBe("run-7");
    expect(tapMarker("x".repeat(200))).toHaveLength(128);
  });

  test("tapSocketPath honors the tap override, then the shared gateway knob, then the default", () => {
    expect(
      tapSocketPath({ LOOP_SESSION_TAP_SOCKET: "/a.sock", LOOP_GATEWAY_SESSION_SOCKET: "/b.sock" }),
    ).toBe("/a.sock");
    expect(tapSocketPath({ LOOP_GATEWAY_SESSION_SOCKET: "/b.sock" })).toBe("/b.sock");
    expect(tapSocketPath({})).toBe(join(tmpdir(), "loop-session-collector.sock"));
  });
});

// ——— sender semantics over the scripted transport ———

describe("register-first ingress (D1)", () => {
  test("register rides first with env-marker correlation; lifecycle sessionStarted follows on connect", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    expect(tap.sessionId).toBe("sess-1");
    expect(tap.connected).toBe(false); // not yet connected: nothing written

    scripted.last.handlers.onConnected();
    const lines = parseLines(scripted.last.writes);
    expect(lines[0]).toEqual({
      type: "register",
      sessionId: "sess-1",
      runId: "run-9",
      taskId: "t-1",
      workerId: null,
      lane: "pi",
      title: null,
    });
    expect(lines[1]).toMatchObject({ type: "lifecycle", phase: "sessionStarted" });
  });

  test("reconnect re-registers (one registration per connection)", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const schedule = new ScriptedSchedule();
    const tap = makeTap(pi, scripted, { schedule, maxBackoffMs: 5000 });
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    scripted.last.handlers.onConnected();
    expect(scripted.handles).toHaveLength(1);

    scripted.last.handlers.onDown(); // gateway restart -> backoff scheduled
    expect(schedule.pending).toHaveLength(1);
    schedule.pending[0]!.fn(); // retry -> NEW connection
    expect(scripted.handles).toHaveLength(2);
    scripted.handles[1]!.handlers.onConnected();

    const lines = parseLines(scripted.handles[1]!.writes);
    expect(lines[0]).toMatchObject({ type: "register", sessionId: "sess-1" });
    expect(lines[1]).toMatchObject({ type: "lifecycle", phase: "sessionStarted" });
    expect(tap.connected).toBe(true);
  });

  test("marker-less sessions register with honest nulls", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = new SessionTap(pi, {
      socketPath: "/unused.sock",
      transport: {
        connect: (path, handlers) => scripted.connect(path, handlers),
        backoffMs: 1,
        maxBackoffMs: 2,
      },
    });
    tap.startSession({ sessionManager: { getSessionId: () => "lead-1" } });
    scripted.last.handlers.onConnected();
    expect(parseLines(scripted.last.writes)[0]).toEqual({
      type: "register",
      sessionId: "lead-1",
      runId: null,
      taskId: null,
      workerId: null,
      lane: "pi",
      title: null,
    });
  });

  test("sessions without a session id stay off (nothing honest to register)", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({});
    expect(tap.sessionId).toBeNull();
    expect(scripted.handles).toHaveLength(0);
  });
});

describe("observation vocabulary", () => {
  test("input -> attachment bodies first, then user_message with refs and honest source", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    scripted.last.handlers.onConnected();
    scripted.last.writes.length = 0;

    const body = Buffer.from("fakepng").toString("base64"); // 7 bytes
    tap.handleInput({
      type: "input",
      text: "look at this",
      images: [{ type: "image", data: body, mimeType: "image/png" }],
      source: "interactive",
    });

    const lines = parseLines(scripted.last.writes);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      type: "attachment",
      attachmentId: expect.any(String),
      mimeType: "image/png",
      dataBase64: body,
      occurredAt: expect.any(String),
    });
    expect(lines[1]).toMatchObject({
      type: "user_message",
      text: "look at this",
      source: "interactive",
      imageCount: 1,
      attachments: [
        {
          attachmentId: (lines[0] as { attachmentId: string }).attachmentId,
          mimeType: "image/png",
          byteLen: 7,
        },
      ],
    });
  });

  test("assistant snapshots dedupe and converge; the final replaces under one identity", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    scripted.last.handlers.onConnected();
    scripted.last.writes.length = 0;

    tap.handleMessageUpdate({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "안녕" }] },
    });
    tap.handleMessageUpdate({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "안녕" },
          { type: "thinking", thinking: "…" },
        ],
      },
    });
    tap.handleMessageUpdate({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "안녕하세요" }] },
    });
    tap.handleMessageEnd({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "안녕하세요 최종" }] },
    });

    const lines = parseLines(scripted.last.writes);
    expect(lines).toEqual([
      expect.objectContaining({ type: "assistant_update", text: "안녕" }),
      expect.objectContaining({ type: "assistant_update", text: "안녕하세요" }),
      expect.objectContaining({ type: "assistant_message", text: "안녕하세요 최종" }),
    ]);
    // One synthesized identity shared by updates and the final.
    const ids = new Set(lines.map((line) => (line as { messageId: string }).messageId));
    expect(ids.size).toBe(1);
  });

  test("non-assistant messages are ignored", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    scripted.last.handlers.onConnected();
    scripted.last.writes.length = 0;

    tap.handleMessageUpdate({
      type: "message_update",
      message: { role: "user", content: [{ type: "text", text: "echo" }] },
    });
    tap.handleMessageEnd({ type: "message_end", message: { role: "toolResult", content: [] } });
    expect(scripted.last.writes).toHaveLength(0);
  });

  test("tool cards: started -> (update not streamed) -> ended with joined text and honest error", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    scripted.last.handlers.onConnected();
    scripted.last.writes.length = 0;

    tap.handleToolStart({
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "bash",
      args: { command: "echo hi" },
    });
    tap.handleToolUpdate({ type: "tool_execution_update", toolCallId: "tc-1" });
    tap.handleToolEnd({
      type: "tool_execution_end",
      toolCallId: "tc-1",
      result: {
        content: [
          { type: "text", text: "hi" },
          { type: "image", data: "x" },
        ],
      },
      isError: false,
    });
    tap.handleToolEnd({
      type: "tool_execution_end",
      toolCallId: "tc-2",
      result: "boom",
      isError: true,
    });

    const lines = parseLines(scripted.last.writes);
    expect(lines).toEqual([
      {
        type: "tool_call_started",
        toolCallId: "tc-1",
        toolName: "bash",
        argsJson: '{"command":"echo hi"}',
        occurredAt: expect.any(String),
      },
      {
        type: "tool_call_ended",
        toolCallId: "tc-1",
        resultText: "hi",
        isError: false,
        occurredAt: expect.any(String),
      },
      {
        type: "tool_call_ended",
        toolCallId: "tc-2",
        resultText: "boom",
        isError: true,
        occurredAt: expect.any(String),
      },
    ]);
  });

  test("turn boundaries map to lifecycle frames", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    scripted.last.handlers.onConnected();
    scripted.last.writes.length = 0;

    tap.handleTurnStart({ type: "turn_start" });
    tap.handleTurnEnd({ type: "turn_end" });
    expect(parseLines(scripted.last.writes)).toEqual([
      { type: "lifecycle", phase: "turnStarted", occurredAt: expect.any(String) },
      { type: "lifecycle", phase: "turnEnded", occurredAt: expect.any(String) },
    ]);
  });

  test("garbage events never throw and never write (fail-open)", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    scripted.last.handlers.onConnected();
    scripted.last.writes.length = 0;

    tap.handleInput({ type: "input" });
    tap.handleMessageUpdate({
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: 42 }] },
    });
    tap.handleMessageEnd({ type: "message_end", message: undefined });
    tap.handleToolStart({ type: "tool_execution_start", toolCallId: "" });
    tap.handleToolEnd({ type: "tool_execution_end", toolCallId: undefined });
    expect(scripted.last.writes).toHaveLength(0);
  });
});

describe("fail-open and shutdown", () => {
  test("observations offered while disconnected are dropped, never thrown", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    tap.handleInput({ type: "input", text: "before connect" });
    expect(scripted.last.writes).toHaveLength(0);

    scripted.last.handlers.onConnected();
    const types = parseLines(scripted.last.writes).map((line) => (line as { type: string }).type);
    expect(types).toEqual(["register", "lifecycle"]);
  });

  test("session_shutdown writes the shutdown line and closes the socket (idempotent)", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    scripted.last.handlers.onConnected();

    tap.stopSession();
    tap.stopSession(); // idempotent
    expect(parseLines(scripted.last.writes).at(-1)).toEqual({ type: "session_shutdown" });
    expect(scripted.last.closed).toBe(true);
    expect(tap.sessionId).toBeNull();
    expect(tap.connected).toBe(false);
  });

  test("a new session id replaces the previous tap (replacement re-registers)", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    scripted.last.handlers.onConnected();

    tap.startSession({ sessionManager: { getSessionId: () => "sess-2" } });
    expect(parseLines(scripted.handles[0]!.writes).at(-1)).toEqual({ type: "session_shutdown" }); // old tap closed honestly
    expect(scripted.handles).toHaveLength(2);
    scripted.last.handlers.onConnected(); // the new connection registers on connect
    expect(parseLines(scripted.handles[1]!.writes)[0]).toMatchObject({
      type: "register",
      sessionId: "sess-2",
    });
    expect(tap.sessionId).toBe("sess-2");
  });
});

describe("deliver_input feedback (D5)", () => {
  test("downstream lines drive pi.sendUserMessage — text first, then images; garbage dropped", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    const tap = makeTap(pi, scripted);
    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    scripted.last.handlers.onConnected();

    // The handlers contract is one ALREADY-FRAME-SPLIT line per call (the
    // default node:net connector splits; the collector does the same on
    // ingress). Garbage lines and unknown types are dropped, not thrown.
    scripted.last.handlers.onData(
      JSON.stringify({
        type: "deliver_input",
        inputId: "in-1",
        text: "drive me",
        attachments: [{ attachmentId: "a-1", mimeType: "image/png", dataBase64: "aGk=" }],
      }),
    );
    scripted.last.handlers.onData("not json");
    scripted.last.handlers.onData(JSON.stringify({ type: "unknown_future" }));

    expect(pi.sent).toHaveLength(1);
    expect(pi.sent[0]).toEqual({
      content: [
        { type: "text", text: "drive me" },
        { type: "image", data: "aGk=", mimeType: "image/png" },
      ],
      options: { deliverAs: "followUp" },
    });
  });
});

describe("reconnect backoff", () => {
  test("failures double up to the cap; success resets; stop cancels the timer", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    scripted.failing = true;
    const schedule = new ScriptedSchedule();
    const tap = makeTap(pi, scripted, { schedule, maxBackoffMs: 1500 });

    tap.startSession({ sessionManager: { getSessionId: () => "sess-1" } });
    expect(schedule.pending.map((entry) => entry.ms)).toEqual([500]);

    schedule.pending[0]!.fn(); // retry fails -> 1000
    schedule.pending.at(-1)!.fn(); // retry fails -> capped 1500
    schedule.pending.at(-1)!.fn(); // retry fails -> still 1500
    expect(schedule.pending.map((entry) => entry.ms)).toEqual([500, 1000, 1500, 1500]);

    // Success resets the backoff for future drops.
    scripted.failing = false;
    schedule.pending.at(-1)!.fn();
    scripted.last.handlers.onConnected();
    expect(tap.connected).toBe(true);

    // Drop the connection: the next delay is the reset base (500), not the cap.
    scripted.last.handlers.onDown();
    expect(schedule.pending.at(-1)!.ms).toBe(500);

    tap.stopSession();
    expect(schedule.pending).toHaveLength(4); // the pending retry was cancelled
    expect(tap.connected).toBe(false); // the onDown already tore the socket down
  });

  test("the transport is inert after stop; late sends and downs are no-ops", () => {
    const scripted = new ScriptedConnect();
    const transport = new TapTransport(
      () => ({
        type: "register",
        sessionId: "s",
        runId: null,
        taskId: null,
        workerId: null,
        lane: "pi",
        title: null,
      }),
      { socketPath: "/unused.sock", connect: (path, handlers) => scripted.connect(path, handlers) },
    );
    transport.start();
    scripted.last.handlers.onConnected();
    transport.stop();
    transport.send({ type: "lifecycle", phase: "turnStarted", occurredAt: "x" });
    scripted.last.handlers.onDown();
    expect(transport.stopped).toBe(true);
    expect(scripted.last.closed).toBe(true);
  });
});

describe("extension factory wiring", () => {
  test("session_start arms the tap; session_shutdown stops it; handlers are guarded", () => {
    const pi = new FakePi();
    const scripted = new ScriptedConnect();
    sessionTapExtension(pi, {
      environment: { LOOP_RUN_ID: "run-9" },
      socketPath: "/unused.sock",
      transport: {
        connect: (path, handlers) => scripted.connect(path, handlers),
        backoffMs: 1,
        maxBackoffMs: 2,
      },
    });

    pi.fire(
      "session_start",
      { type: "session_start", reason: "startup" },
      { sessionManager: { getSessionId: () => "sess-live" } },
    );
    scripted.last.handlers.onConnected();
    expect(parseLines(scripted.last.writes)[0]).toMatchObject({
      type: "register",
      sessionId: "sess-live",
      runId: "run-9",
    });

    pi.fire("input", { type: "input", text: "through the factory" });
    expect(parseLines(scripted.last.writes).at(-1)).toMatchObject({
      type: "user_message",
      text: "through the factory",
    });

    // Throwing/garbage handler bodies must never escape into pi.
    expect(() =>
      pi.handlers.get("input")![0]!(undefined as never, undefined as never),
    ).not.toThrow();
    expect(() =>
      pi.handlers.get("input")!.at(-1)!({ text: { evil: true } } as never, undefined as never),
    ).not.toThrow();

    pi.fire("session_shutdown", { type: "session_shutdown", reason: "quit" });
    expect(parseLines(scripted.last.writes).at(-1)).toEqual({ type: "session_shutdown" });
  });
});
