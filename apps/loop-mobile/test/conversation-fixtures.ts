/**
 * Recorded conversation event stream fixtures (GUI conversation v1, decision
 * 2026-xx-gui-conversation D2).
 *
 * Payloads are typed against the Rustra-GENERATED `@loop/protocol` shapes, so
 * a Rust-side wire change fails compilation here before it can fail at
 * runtime. One stream tells the whole v1 story: session start → user prompt →
 * running turn with assistant deltas + final replacement → tool cards
 * (done + error) → steer accepted mid-run → steer user message → session
 * end. Frame ids double as mock replay cursors. No model calls — this is a
 * recorded stream.
 */

import type { RustraEventPayloads } from "@loop/protocol";

import { RUN_ID } from "./fixtures";

type UserMessage = RustraEventPayloads["loop.user_message"];
type AssistantDelta = RustraEventPayloads["loop.assistant_delta"];
type AssistantMessage = RustraEventPayloads["loop.assistant_message"];
type ToolCallStarted = RustraEventPayloads["loop.tool_call_started"];
type ToolCallEnded = RustraEventPayloads["loop.tool_call_ended"];
type Lifecycle = RustraEventPayloads["loop.lifecycle"];
type SteerQueued = RustraEventPayloads["loop.steer_queued"];
type ConversationReset = RustraEventPayloads["loop.conversation_reset"];

export const SESSION_ID = "sess_01JCONVERSATION0001";
/** A session observed without any run marker (decision D1: honest null). */
export const ORPHAN_SESSION_ID = "sess_01JCONVERSATION0002";

/** GET /v1/sessions inventory: one run-correlated, one uncorrelated. */
export const SESSION_LIST: RustraEventPayloads["loop.session_list"] = {
  sessions: [
    {
      sessionId: SESSION_ID,
      runId: RUN_ID,
      taskId: null,
      workerId: "worker-1",
      lane: "interactive",
      title: "Fix the flaky gateway test",
      state: "live",
    },
    {
      sessionId: ORPHAN_SESSION_ID,
      runId: null,
      taskId: null,
      workerId: null,
      lane: "interactive",
      title: null,
      state: "ended",
    },
  ],
};

const STEER_TEXT = "also check the sse parser";

// ——— M2 attachment fixtures (decision D5) ———

/** The attachment the recorded stream's first user message references. */
export const ATTACHMENT_ID = "att_local_png_0001";
/** A ref whose body the mock gateway never stored (honest 404 path). */
export const ATTACHMENT_MISSING_ID = "att_missing_0001";

/** A real 1×1 PNG (89 50 4E 47…): the deterministic LOCAL-IMAGE fixture —
 * the inline-image render path runs on these bytes alone, no gateway model
 * call and no network beyond the loopback mock. */
export const ATTACHMENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Decoded length of ATTACHMENT_PNG_BASE64 — the honest `byteLen` contract. */
export const ATTACHMENT_PNG_BYTES = 70;

/** M2 (D5): user messages carry reference-shaped metadata; `imageCount`
 * stays the honest observed count and may exceed the servable refs. */

/**
 * The recorded stream, in SSE order. `future_thing` is a deliberate unknown
 * frame family: D4 §7 requires v1 clients to ignore it.
 */
export const CONVERSATION_FRAMES: {
  id: string;
  event: string;
  payload: unknown;
}[] = [
  {
    id: "conv-n1",
    event: "lifecycle",
    payload: {
      phase: "sessionStarted",
      occurredAt: "2026-09-25T09:00:00.000Z",
    } satisfies Lifecycle,
  },
  {
    id: "conv-n2",
    event: "user_message",
    payload: {
      messageId: "m-1",
      text: "Fix the flaky gateway test",
      source: "interactive",
      imageCount: 1,
      attachments: [
        { attachmentId: ATTACHMENT_ID, mimeType: "image/png", byteLen: ATTACHMENT_PNG_BYTES },
      ],
      occurredAt: "2026-09-25T09:00:01.000Z",
    } satisfies UserMessage,
  },
  {
    id: "conv-n3",
    event: "lifecycle",
    payload: { phase: "turnStarted", occurredAt: "2026-09-25T09:00:01.500Z" } satisfies Lifecycle,
  },
  {
    id: "conv-n4",
    event: "assistant_delta",
    payload: {
      messageId: "a-1",
      delta: "I'll check the test ",
      occurredAt: "2026-09-25T09:00:02.000Z",
    } satisfies AssistantDelta,
  },
  {
    id: "conv-n5",
    event: "assistant_delta",
    payload: {
      messageId: "a-1",
      delta: "first.",
      occurredAt: "2026-09-25T09:00:02.300Z",
    } satisfies AssistantDelta,
  },
  {
    // Deliberate unknown family: never decoded, never rendered (D4 §7).
    id: "conv-n5b",
    event: "future_thing",
    payload: { note: "a future frame family" },
  },
  {
    // Final text DIFFERS from the delta buffer: proves authoritative
    // replacement instead of append (D4 §2).
    id: "conv-n6",
    event: "assistant_message",
    payload: {
      messageId: "a-1",
      text: "I'll check the test first, then fix the flake.",
      truncated: false,
      occurredAt: "2026-09-25T09:00:03.000Z",
    } satisfies AssistantMessage,
  },
  {
    id: "conv-n7",
    event: "tool_call_started",
    payload: {
      toolCallId: "t-1",
      toolName: "read",
      argsJson: '{"path":"packages/gateway/src/server.ts"}',
      argsTruncated: false,
      occurredAt: "2026-09-25T09:00:04.000Z",
    } satisfies ToolCallStarted,
  },
  {
    id: "conv-n8",
    event: "tool_call_ended",
    payload: {
      toolCallId: "t-1",
      resultText: "export function handle(…) { … }",
      resultTruncated: false,
      isError: false,
      occurredAt: "2026-09-25T09:00:05.000Z",
    } satisfies ToolCallEnded,
  },
  {
    id: "conv-n9",
    event: "tool_call_started",
    payload: {
      toolCallId: "t-2",
      toolName: "bash",
      argsJson: '{"cmd":"bun test packages/gateway"}',
      argsTruncated: false,
      occurredAt: "2026-09-25T09:00:06.000Z",
    } satisfies ToolCallStarted,
  },
  {
    id: "conv-n10",
    event: "tool_call_ended",
    payload: {
      toolCallId: "t-2",
      resultText: "exit code 1 — 1 test failed",
      resultTruncated: false,
      isError: true,
      occurredAt: "2026-09-25T09:00:07.000Z",
    } satisfies ToolCallEnded,
  },
  {
    id: "conv-n11",
    event: "lifecycle",
    payload: { phase: "turnEnded", occurredAt: "2026-09-25T09:00:07.500Z" } satisfies Lifecycle,
  },
  {
    // Steer accepted mid-run: the gateway mirror of the mailbox acceptance.
    id: "conv-n12",
    event: "steer_queued",
    payload: {
      steerId: "st-1",
      text: STEER_TEXT,
      runId: RUN_ID,
      occurredAt: "2026-09-25T09:00:08.000Z",
    } satisfies SteerQueued,
  },
  {
    id: "conv-n13",
    event: "lifecycle",
    payload: { phase: "turnStarted", occurredAt: "2026-09-25T09:00:08.200Z" } satisfies Lifecycle,
  },
  {
    // The steer surfacing in-session: folds the st-1 marker (D4 §4).
    id: "conv-n14",
    event: "user_message",
    payload: {
      messageId: "m-2",
      text: STEER_TEXT,
      source: "steer",
      imageCount: 0,
      attachments: [],
      occurredAt: "2026-09-25T09:00:08.500Z",
    } satisfies UserMessage,
  },
  {
    id: "conv-n15",
    event: "assistant_message",
    payload: {
      messageId: "a-2",
      text: "Steered — the sse parser is covered now.",
      truncated: false,
      occurredAt: "2026-09-25T09:00:10.000Z",
    } satisfies AssistantMessage,
  },
  {
    id: "conv-n16",
    event: "lifecycle",
    payload: { phase: "turnEnded", occurredAt: "2026-09-25T09:00:10.500Z" } satisfies Lifecycle,
  },
];

/** Shared-recorded termination: replayed, then the stream closes (D3). */
export const SESSION_GONE: ConversationReset = {
  reason: "sessionGone",
  occurredAt: "2026-09-25T09:01:00.000Z",
};

export const CURSOR_RESET: ConversationReset = {
  reason: "cursorUnavailable",
  occurredAt: "2026-09-25T09:00:00.500Z",
};

export const CONVERSATION_FRAME_IDS = {
  byIndex: (index: number): string => CONVERSATION_FRAMES[index]?.id ?? "",
  gone: "conv-gone-n99",
  reset: "conv-reset-n0",
} as const;

export const STEER = { text: STEER_TEXT } as const;
