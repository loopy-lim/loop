/**
 * Contract-client tests for the GUI conversation v1 surface (decision
 * 2026-xx-gui-conversation D2–D4, milestone M-GC3).
 *
 * Runs against a local mock gateway serving the RECORDED conversation stream
 * (test/conversation-fixtures.ts, typed against the generated `@loop/protocol`
 * payloads). No real network, no model calls. Evidence covers: session
 * inventory, SSE frame decode with unknown-family tolerance, cursor replay
 * and reset convergence, sessionGone close, steer endpoint contract, and the
 * full D4 rendering contract in ConversationProjection.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import { GatewayClient, PromptValidationError } from "../src/gateway-client/client";
import { GatewayError } from "../src/gateway-client/problem";
import { createConnectionConfig } from "../src/auth/connection";
import { composerTarget, submitComposerText, type ComposerTarget } from "../src/state/composer";
import {
  ConversationProjection,
  toolCardExpanded,
  type ConversationItem,
} from "../src/state/conversationProjection";
import { splitSessions } from "../src/state/sessionsView";
import { decodeConversationFrame } from "../src/gateway-client/conversation";
import { createMockGateway, type MockGateway } from "./mock-gateway";
import { RUN_ID, TOKEN } from "./fixtures";
import {
  ATTACHMENT_ID,
  ATTACHMENT_PNG_BYTES,
  CONVERSATION_FRAMES,
  CURSOR_RESET,
  ORPHAN_SESSION_ID,
  SESSION_GONE,
  SESSION_ID,
  SESSION_LIST,
  STEER,
} from "./conversation-fixtures";
import type { ConversationStreamEvent } from "../src/gateway-client/conversation";

let gateway: MockGateway;
let client: GatewayClient;

beforeAll(() => {
  gateway = createMockGateway();
  client = new GatewayClient(
    createConnectionConfig("127.0.0.1", gateway.url.split(":")[2]!, TOKEN),
  );
});

afterAll(() => {
  gateway.stop();
});

/** The recorded stream as decoded app events (unknown families dropped). */
function recordedEvents(): ConversationStreamEvent[] {
  return CONVERSATION_FRAMES.map((frame) =>
    decodeConversationFrame({
      id: frame.id,
      event: frame.event,
      data: JSON.stringify(frame.payload),
    }),
  ).filter((event): event is ConversationStreamEvent => event !== null);
}

function projectAll(
  projection: ConversationProjection = new ConversationProjection(SESSION_ID),
): ConversationProjection {
  for (const event of recordedEvents()) {
    projection.apply(event);
  }
  return projection;
}

describe("session inventory (GET /v1/sessions)", () => {
  test("returns the inventory with contract headers", async () => {
    const list = await client.listSessions();
    expect(list).toEqual(SESSION_LIST);
    expect(list.sessions).toHaveLength(2);

    const get = gateway.requests.at(-1);
    expect(get?.method).toBe("GET");
    expect(get?.path).toBe("/v1/sessions");
    expect(get?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(get?.requestId).toMatch(/^req_[0-9a-f]{24}$/);
  });

  test("splits correlated sessions from uncorrelated ones (honest run_id = null)", () => {
    const { byRunId, uncorrelated } = splitSessions(SESSION_LIST.sessions);
    expect(byRunId.get(RUN_ID)?.sessionId).toBe(SESSION_ID);
    expect(uncorrelated).toHaveLength(1);
    expect(uncorrelated[0]?.sessionId).toBe(ORPHAN_SESSION_ID);
    expect(uncorrelated[0]?.runId).toBeNull();
  });
});

describe("session event stream (GET /v1/sessions/{id}/events)", () => {
  test("streams the recorded frames in order, ignores unknown families, closes on sessionGone", async () => {
    const events: ConversationStreamEvent[] = [];
    await client.observeSession(SESSION_ID, (event) => events.push(event));

    const kinds = events.map((event) => event.kind);
    expect(kinds).not.toContain("future_thing"); // D4 §7: unknown families never arrive
    expect(kinds[0]).toBe("lifecycle");
    expect(events[0]?.frame).toMatchObject({ phase: "sessionStarted" });
    expect(kinds[1]).toBe("user_message");
    expect(kinds.at(-1)).toBe("conversation_reset");
    expect(events.at(-1)?.frame).toEqual(SESSION_GONE);

    const entry = gateway.requests.at(-1);
    expect(entry?.path).toBe(`/v1/sessions/${SESSION_ID}/events`);
    expect(entry?.accept).toBe("text/event-stream");
  });

  test("replays from the Last-Event-ID cursor", async () => {
    const events: ConversationStreamEvent[] = [];
    await client.observeSession(SESSION_ID, (event) => events.push(event), {
      lastEventId: "conv-n3",
    });
    expect(gateway.sessionEventLastEventIds).toContain("conv-n3");
    // First decoded frame of the replay is the one AFTER the cursor.
    expect(events[0]?.kind).toBe("assistant_delta");
    // Only m-2 (the steer fold) remains after the cursor.
    expect(events.filter((event) => event.kind === "user_message")).toHaveLength(1);
  });

  test("reconnects after a clean non-terminal disconnect carrying the cursor", async () => {
    gateway.disconnectNextSessionStreamAfterFirstFrame();
    const events: ConversationStreamEvent[] = [];
    await client.observeSession(SESSION_ID, (event) => events.push(event));
    // sessionEventLastEventIds accumulates across tests: compare the tail.
    expect(gateway.sessionEventLastEventIds.slice(-2)).toEqual([null, "conv-n1"]);
    // First connection delivered frame 1, the reconnect delivered the rest.
    const userMessages = events.filter((event) => event.kind === "user_message");
    expect(userMessages).toHaveLength(2);
    expect(events.at(-1)?.frame).toEqual(SESSION_GONE);
  });

  test("converges a stale cursor through conversation_reset(cursorUnavailable)", async () => {
    const events: ConversationStreamEvent[] = [];
    await client.observeSession(SESSION_ID, (event) => events.push(event), {
      lastEventId: "conv-from-a-dead-generation",
    });
    expect(events[0]?.kind).toBe("conversation_reset");
    expect(events[0]?.frame).toEqual(CURSOR_RESET);
    // Fresh replay follows, then the shared-recorded termination.
    expect(events[1]?.kind).toBe("lifecycle");
    expect(events.at(-1)?.frame).toEqual(SESSION_GONE);
  });

  test("maps a 404 unknown session to a non-retryable GatewayError", async () => {
    let attempts = 0;
    const error = await new GatewayClient(
      createConnectionConfig("127.0.0.1", 1, TOKEN),
      async () => {
        attempts++;
        return new Response(
          JSON.stringify({
            type: "https://loop.local/problems/session_not_found",
            title: "Session not found",
            status: 404,
            code: "session_not_found",
            detail: "The requested session does not exist.",
            requestId: "req_mock",
            retryable: false,
            fields: null,
          }),
          { status: 404, headers: { "Content-Type": "application/problem+json" } },
        );
      },
    )
      .observeSession("sess_unknown", () => undefined)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).retryable).toBe(false);
    expect(attempts).toBe(1); // no retry on non-retryable problems
  });
});

describe("steer endpoint (POST /v1/runs/{runId}/steer)", () => {
  test("posts the message with contract headers and parses the 202 acceptance", async () => {
    const postsBefore = gateway.requests.filter((r) => r.method === "POST").length;
    const accepted = await client.steerRun(RUN_ID, STEER.text);
    expect(accepted.steerId).toMatch(/^st_/);

    const post = gateway.requests.at(-1);
    expect(gateway.requests.filter((r) => r.method === "POST").length).toBe(postsBefore + 1);
    expect(post?.method).toBe("POST");
    expect(post?.path).toBe(`/v1/runs/${RUN_ID}/steer`);
    expect(post?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ message: STEER.text });
  });

  test("rejects empty steer text before any network round trip", async () => {
    const posts = gateway.requests.filter((r) => r.method === "POST").length;
    expect(() => client.steerRun(RUN_ID, "   ")).toThrow(PromptValidationError);
    expect(gateway.requests.filter((r) => r.method === "POST").length).toBe(posts);
  });

  test("rejects oversized steer text before any network round trip", async () => {
    const posts = gateway.requests.filter((r) => r.method === "POST").length;
    expect(() => client.steerRun(RUN_ID, "x".repeat(64 * 1024 + 1))).toThrow(PromptValidationError);
    expect(gateway.requests.filter((r) => r.method === "POST").length).toBe(posts);
  });

  test("does not retry a non-retryable steer problem (404 unknown run)", async () => {
    let attempts = 0;
    const error = await new GatewayClient(
      createConnectionConfig("127.0.0.1", 1, TOKEN),
      async () => {
        attempts++;
        return new Response(
          JSON.stringify({
            type: "https://loop.local/problems/run_not_found",
            title: "Run not found",
            status: 404,
            code: "run_not_found",
            detail: "The requested run does not exist.",
            requestId: "req_mock",
            retryable: false,
            fields: null,
          }),
          { status: 404, headers: { "Content-Type": "application/problem+json" } },
        );
      },
    )
      .steerRun("run_unknown", STEER.text)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(attempts).toBe(1);
  });
});

describe("ConversationProjection — D4 rendering contract", () => {
  test("full recorded stream: timeline order, final replacement, tool states, folded steer", () => {
    const view = projectAll().snapshot();

    expect(view.items.map((item) => item.kind)).toEqual([
      "user", // m-1 interactive prompt
      "assistant", // a-1 (deltas → final replacement)
      "tool", // t-1 done
      "tool", // t-2 error
      "steer", // st-1: queued by the frame, delivered by the source=steer message
      "assistant", // a-2 final
    ]);

    const user = view.items[0] as Extract<ConversationItem, { kind: "user" }>;
    expect(user).toMatchObject({ messageId: "m-1", source: "interactive", imageCount: 1 });
    // M2 (D5): refs ride on the frame into the projection verbatim; bodies
    // are never part of the stream — the app fetches them separately.
    expect(user.attachments).toEqual([
      { attachmentId: ATTACHMENT_ID, mimeType: "image/png", byteLen: ATTACHMENT_PNG_BYTES },
    ]);

    const assistant = view.items[1] as Extract<ConversationItem, { kind: "assistant" }>;
    // Authoritative final REPLACED the delta buffer (texts differ on purpose).
    expect(assistant.text).toBe("I'll check the test first, then fix the flake.");
    expect(assistant.final).toBe(true);

    const tool1 = view.items[2] as Extract<ConversationItem, { kind: "tool" }>;
    expect(tool1).toMatchObject({
      toolCallId: "t-1",
      toolName: "read",
      state: "done",
      resultText: "export function handle(…) { … }",
      interrupted: false,
    });

    const tool2 = view.items[3] as Extract<ConversationItem, { kind: "tool" }>;
    expect(tool2).toMatchObject({ toolCallId: "t-2", state: "error", interrupted: false });

    const steer = view.items[4] as Extract<ConversationItem, { kind: "steer" }>;
    expect(steer).toMatchObject({ steerId: "st-1", status: "delivered" });
    // Folded: the steer user message m-2 did NOT create a second bubble.
    expect(view.items.filter((item) => item.kind === "user")).toHaveLength(1);

    expect(view.running).toBe(false);
    // The recorded frames end at turnEnded: session end arrives either as a
    // sessionEnded lifecycle or the sessionGone reset (separate test).
    expect(view.sessionEnded).toBe(false);
    expect(view.ended).toBe(false);
    expect(view.stale).toBe(false);
  });

  test("idempotent render: replaying the whole stream changes nothing", () => {
    const projection = projectAll();
    const before = projection.snapshot().items;
    for (const event of recordedEvents()) {
      projection.apply(event); // full duplicate delivery (replay overlap)
    }
    expect(projection.snapshot().items).toEqual(before);
  });

  test("deltas append to the buffer; the final replaces it; post-final deltas are ignored", () => {
    const projection = new ConversationProjection(SESSION_ID);
    const events = recordedEvents();

    projection.apply(events[1]!); // user m-1
    projection.apply(events[3]!); // delta "I'll check the test "
    let view = projection.snapshot();
    let assistant = view.items[1] as Extract<ConversationItem, { kind: "assistant" }>;
    expect(assistant).toMatchObject({ text: "I'll check the test ", final: false });

    projection.apply(events[4]!); // delta "first."
    view = projection.snapshot();
    assistant = view.items[1] as Extract<ConversationItem, { kind: "assistant" }>;
    expect(assistant.text).toBe("I'll check the test first.");

    projection.apply(events[5]!); // assistant_message final (different text)
    view = projection.snapshot();
    assistant = view.items[1] as Extract<ConversationItem, { kind: "assistant" }>;
    expect(assistant.text).toBe("I'll check the test first, then fix the flake.");
    expect(assistant.final).toBe(true);

    projection.apply(events[3]!); // a late duplicate delta must not corrupt the final
    expect(
      (projection.snapshot().items[1] as Extract<ConversationItem, { kind: "assistant" }>).text,
    ).toBe("I'll check the test first, then fix the flake.");
  });

  test("started-less ended synthesizes a closed card without a running phase", () => {
    const ended = CONVERSATION_FRAMES.find((frame) => frame.id === "conv-n10")!;
    const projection = new ConversationProjection(SESSION_ID);
    projection.apply(
      decodeConversationFrame({
        id: ended.id,
        event: ended.event,
        data: JSON.stringify(ended.payload),
      })!,
    );
    const view = projection.snapshot();
    expect(view.items).toHaveLength(1);
    const card = view.items[0] as Extract<ConversationItem, { kind: "tool" }>;
    expect(card).toMatchObject({
      toolCallId: "t-2",
      state: "error",
      resultText: "exit code 1 — 1 test failed",
      interrupted: false,
    });

    const doneEnded = CONVERSATION_FRAMES.find((frame) => frame.id === "conv-n8")!;
    const fresh = new ConversationProjection(SESSION_ID);
    fresh.apply(
      decodeConversationFrame({
        id: doneEnded.id,
        event: doneEnded.event,
        data: JSON.stringify(doneEnded.payload),
      })!,
    );
    expect((fresh.snapshot().items[0] as Extract<ConversationItem, { kind: "tool" }>).state).toBe(
      "done",
    );
  });

  test("steer markers: local pending → queued (order matching) → delivered (fold)", () => {
    const projection = new ConversationProjection(SESSION_ID);
    const events = recordedEvents();

    projection.appendLocalSteer(STEER.text);
    expect(projection.snapshot().items).toEqual([
      { kind: "steer", steerId: null, text: STEER.text, status: "pending", foldedMessageId: null },
    ]);

    projection.apply(events[11]!); // steer_queued st-1
    expect(projection.snapshot().items[0]).toMatchObject({ steerId: "st-1", status: "queued" });

    projection.apply(events[13]!); // user_message m-2 source=steer
    const view = projection.snapshot();
    expect(view.items).toHaveLength(1); // folded: no separate user bubble
    expect(view.items[0]).toMatchObject({
      kind: "steer",
      steerId: "st-1",
      status: "delivered",
      foldedMessageId: "m-2",
    });
  });

  test("steer evidence without a local marker: queued frame synthesizes a marker; steer message renders standalone", () => {
    const projection = new ConversationProjection(SESSION_ID);
    const events = recordedEvents();

    projection.apply(events[11]!); // steer_queued with no pending marker
    expect(projection.snapshot().items).toEqual([
      { kind: "steer", steerId: "st-1", text: STEER.text, status: "queued", foldedMessageId: null },
    ]);

    const fresh = new ConversationProjection(SESSION_ID);
    fresh.apply(events[13]!); // user_message source=steer, no marker at all
    const view = fresh.snapshot();
    const user = view.items[0] as Extract<ConversationItem, { kind: "user" }>;
    expect(view.items).toHaveLength(1);
    expect(user).toMatchObject({ messageId: "m-2", source: "steer" }); // standalone delivery evidence
  });

  test("lifecycle drives the running badge and session end finalizes open items", () => {
    const projection = new ConversationProjection(SESSION_ID);
    const events = recordedEvents();

    projection.apply(events[2]!); // turnStarted
    expect(projection.snapshot().running).toBe(true);
    projection.apply(events[3]!); // a delta arrives mid-turn
    projection.apply(events[10]!); // turnEnded
    expect(projection.snapshot().running).toBe(false);

    const midTurn = new ConversationProjection(SESSION_ID);
    midTurn.apply(events[2]!); // turnStarted
    midTurn.apply(events[6]!); // tool_call_started (never ends)
    midTurn.apply(events[3]!); // streaming assistant buffer (no final)
    // The recorded stream ends via the sessionGone reset; a sessionEnded
    // lifecycle arrives when the tap observes the pi session shutdown:
    midTurn.apply(
      decodeConversationFrame({
        id: "conv-end",
        event: "lifecycle",
        data: JSON.stringify({ phase: "sessionEnded", occurredAt: "2026-09-25T09:02:00.000Z" }),
      })!,
    );
    const ended = midTurn.snapshot();
    expect(ended.sessionEnded).toBe(true);
    expect(ended.running).toBe(false);
    const card = ended.items.find((item) => item.kind === "tool") as Extract<
      ConversationItem,
      { kind: "tool" }
    >;
    expect(card).toMatchObject({ state: "running", interrupted: true }); // interrupted, never an error
    const assistant = ended.items.find((item) => item.kind === "assistant") as Extract<
      ConversationItem,
      { kind: "assistant" }
    >;
    expect(assistant).toMatchObject({ final: true, text: "I'll check the test " }); // buffer confirmed as-is
  });

  test("reset convergence: cursorUnavailable marks stale until the next frame; sessionGone ends and finalizes", () => {
    const projection = new ConversationProjection(SESSION_ID);
    const events = recordedEvents();

    projection.apply(events[0]!); // lifecycle sessionStarted
    projection.apply(
      decodeConversationFrame({
        id: "reset",
        event: "conversation_reset",
        data: JSON.stringify(CURSOR_RESET),
      })!,
    );
    expect(projection.snapshot().stale).toBe(true);
    projection.apply(events[1]!); // any decoded frame proves continuity
    expect(projection.snapshot().stale).toBe(false);

    projection.apply(
      decodeConversationFrame({
        id: "gone",
        event: "conversation_reset",
        data: JSON.stringify(SESSION_GONE),
      })!,
    );
    const view = projection.snapshot();
    expect(view.ended).toBe(true);
    expect(view.stale).toBe(false);
    expect(view.running).toBe(false);
  });

  test("applySummary: ended inventory finalizes; other sessions are ignored", () => {
    const projection = new ConversationProjection(SESSION_ID);
    projection.applySummary({
      sessionId: "sess_other",
      runId: null,
      taskId: null,
      workerId: null,
      lane: "interactive",
      title: "other",
      state: "ended",
    });
    expect(projection.snapshot().sessionEnded).toBe(false);

    projection.applySummary({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      taskId: null,
      workerId: "worker-1",
      lane: "interactive",
      title: "Fix the flaky gateway test",
      state: "ended",
    });
    expect(projection.snapshot().sessionEnded).toBe(true);
  });
});

describe("composer routing (D6: running → steer, idle → new run)", () => {
  test("routes mid-run submits to steer only when run-correlated", () => {
    expect(composerTarget({ running: true, runId: RUN_ID })).toEqual({
      kind: "steer",
      runId: RUN_ID,
    });
    expect(composerTarget({ running: true, runId: null })).toEqual({ kind: "prompt" });
    expect(composerTarget({ running: false, runId: RUN_ID })).toEqual({ kind: "prompt" });
  });

  test("submits through the routed client method (spy: exactly one path fires)", async () => {
    const steerRun = mock((_: string, __: string) => Promise.resolve({ steerId: "st_9" }));
    const submitPrompt = mock((_: string) =>
      Promise.resolve({
        run: {
          runId: "run_new",
          status: "accepted",
          terminal: false,
          createdAt: "2026-09-25T09:00:00.000Z",
          updatedAt: "2026-09-25T09:00:00.000Z",
          lastSequence: null,
          taskCounts: { pending: 0, running: 0, attention: 0, done: 0, failed: 0, cancelled: 0 },
        },
      }),
    );
    const spyClient = { steerRun, submitPrompt } as unknown as GatewayClient;

    const steerTarget: ComposerTarget = { kind: "steer", runId: RUN_ID };
    const steerResult = await submitComposerText(spyClient, {
      target: steerTarget,
      text: STEER.text,
    });
    expect(steerResult).toEqual({ runId: null });
    expect(steerRun).toHaveBeenCalledTimes(1);
    expect(steerRun).toHaveBeenCalledWith(RUN_ID, STEER.text);
    expect(submitPrompt).not.toHaveBeenCalled();

    const promptResult = await submitComposerText(spyClient, {
      target: { kind: "prompt" },
      text: "new task please",
    });
    expect(promptResult).toEqual({ runId: "run_new" });
    expect(submitPrompt).toHaveBeenCalledTimes(1);
    expect(steerRun).toHaveBeenCalledTimes(1); // unchanged
  });
});

describe("tool card fold defaults (D4 §5, app-local)", () => {
  test("running cards start open; results collapse; the user override wins", () => {
    expect(toolCardExpanded("running", undefined)).toBe(true);
    expect(toolCardExpanded("done", undefined)).toBe(false);
    expect(toolCardExpanded("error", undefined)).toBe(false);
    expect(toolCardExpanded("done", true)).toBe(true); // user expanded
    expect(toolCardExpanded("running", false)).toBe(false); // user collapsed
  });
});
