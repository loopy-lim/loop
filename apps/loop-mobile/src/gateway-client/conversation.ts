/**
 * GUI conversation view v1 — app-side view of the session conversation frame
 * family (decision 2026-xx-gui-conversation D2/D4).
 *
 * Every payload type is the Rustra-generated Rust-owned shape from
 * `@loop/protocol` (`crates/loop-bridge/src/conversation.rs` → codegen). This
 * file adds nothing to the wire vocabulary; it only maps SSE `event` names to
 * generated payloads. Frame names on the wire are the rustra event names
 * minus the `loop.` prefix (`loop.user_message` → SSE `user_message`), the
 * same rule as the pane family.
 *
 * D4 §7: unknown SSE `event` names are ignored (forward compatibility), so
 * the decoder returns null for anything outside the v1 vocabulary.
 */

import type { RemoteSessionAssetRef, RustraEventPayloads } from "@loop/protocol";

/** Generated conversation payloads, re-exported so downstream layers
 * (state/features/screens) never import `@loop/protocol` directly —
 * gateway-client is the single protocol boundary (decision D-B). */
export type { RustraEventPayloads };
import type { SseFrame } from "./sse";

/** Conversation SSE frame names (wire vocabulary, decision D2). */
export type ConversationFrameName =
  | "user_message"
  | "assistant_delta"
  | "assistant_message"
  | "tool_call_started"
  | "tool_call_ended"
  | "lifecycle"
  | "steer_queued"
  | "conversation_reset";

type FramePayload<N extends ConversationFrameName> = RustraEventPayloads[`loop.${N}`];

/** One conversation stream event: SSE `event` name discriminates the payload. */
export type ConversationStreamEvent = {
  [N in ConversationFrameName]: { kind: N; frame: FramePayload<N> };
}[ConversationFrameName];

/** Session inventory entry (GET /v1/sessions; Rust `RemoteSessionSummary`). */
export type RemoteSessionSummary = RustraEventPayloads["loop.session_list"]["sessions"][number];

/** Reference-shaped attachment metadata (Rust `RemoteSessionAssetRef`, D5). */
export type { RemoteSessionAssetRef };

/** GET /v1/sessions response body (Rust `RemoteSessionListOutput`). */
export type RemoteSessionList = RustraEventPayloads["loop.session_list"];

/** POST /v1/runs/{runId}/steer 202 body; `steerId` when the gateway echoes it. */
export type SteerAccepted = {
  steerId: string | null;
};

/** Decode one SSE frame into the conversation union; null if unknown. */
export function decodeConversationFrame(frame: SseFrame): ConversationStreamEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(frame.data);
  } catch {
    return null;
  }
  switch (frame.event) {
    case "user_message":
      return { kind: "user_message", frame: data as FramePayload<"user_message"> };
    case "assistant_delta":
      return { kind: "assistant_delta", frame: data as FramePayload<"assistant_delta"> };
    case "assistant_message":
      return { kind: "assistant_message", frame: data as FramePayload<"assistant_message"> };
    case "tool_call_started":
      return { kind: "tool_call_started", frame: data as FramePayload<"tool_call_started"> };
    case "tool_call_ended":
      return { kind: "tool_call_ended", frame: data as FramePayload<"tool_call_ended"> };
    case "lifecycle":
      return { kind: "lifecycle", frame: data as FramePayload<"lifecycle"> };
    case "steer_queued":
      return { kind: "steer_queued", frame: data as FramePayload<"steer_queued"> };
    case "conversation_reset":
      return { kind: "conversation_reset", frame: data as FramePayload<"conversation_reset"> };
    default:
      return null; // unknown frame families are ignored by v1 clients (D4 §7)
  }
}
