//! Wire frame family for the GUI conversation view v1 (decision
//! `2026-xx-gui-conversation` D2): pi session conversation frames streamed to
//! the remote app as the primary UX, collected from the in-session pi
//! extension tap by the gateway.
//!
//! Boundary: these types live only in the bridge (transport form). The
//! session/conversation concept never enters `loop-core`, run/task domain
//! events are never promoted from conversation identifiers, and the
//! sessionId↔runId correlation carried here is adapter metadata, not core
//! state. Conversation frames are a THIRD SSE family, separate from run
//! events and pane frames (separate per-session log, identity-keyed
//! dedupe/replay via `message_id`/`tool_call_id`/`steer_id`).
//!
//! Contract notes (decision D4 — the rendering contract the gateway and the
//! app implement in parallel):
//! - SSE `event` names are the discriminators; payloads carry NO duplicate
//!   discriminator field and NO seq field. Ordering is the SSE `id` cursor
//!   order; identity/idempotency is the payload identifiers.
//! - Frame names on the wire are the rustra event names minus the `loop.`
//!   prefix (`loop.user_message` → SSE `user_message`), same rule as the
//!   pane family. `conversation_reset` follows the same strip.
//! - Assistant deltas are gateway-merged (bounded); `ConversationAssistantMessage`
//!   is the authoritative final that replaces any per-`message_id` buffer.
//! - Tool calls pair by `tool_call_id` into a running→done|error state
//!   machine; `started`-less `ended` renders as a closed card.
//! - All text fields (`text`/`delta`/`args_json`/`result_text`) pass the
//!   gateway's `[credential]=[redacted]` redaction gate before the wire;
//!   bounded fields carry a `*_truncated` mark when cut.
//! - No u64 fields exist (seq is intentionally absent and asset sizes are
//!   bounded well below u32), so the ADR §4.1 u64 decimal-string rule does
//!   not apply to this family.
//! - Attachments (M2, decision D5): user inputs carry reference-shaped
//!   `RemoteSessionAssetRef` metadata ONLY — bodies are never inlined into
//!   frames (ring-buffer/replay budget, terminal-mirror D7 precedent). The
//!   gateway serves bodies out-of-band at
//!   `GET /v1/sessions/{sessionId}/attachments/{attachmentId}`; replay
//!   re-issues references, not bodies. `image_count` stays the honest
//!   observed count; `attachments` is the referenceable subset whose bodies
//!   the gateway can serve (they may legitimately differ).

use rustra::prelude::*;

/// Channel a user input arrived through, as observed by the in-session tap
/// (decision D2). Variant casing follows the bridge codegen's camelCase rule,
/// so the wire values are `interactive` / `steer` / `api`.
#[bridge_type]
pub enum ConversationUserMessageSource {
    /// Normal interactive user turn in the pi session.
    Interactive,
    /// Steer injected mid-turn (mailbox drain surfaced in the conversation).
    Steer,
    /// Programmatic input (non-interactive invocation path).
    Api,
}

/// Lifecycle phase of the observed session (decision D2). Variant casing
/// follows the bridge codegen's camelCase rule, so the wire values are
/// `sessionStarted` / `turnStarted` / `turnEnded` / `sessionEnded`.
///
/// Lifecycle frames are a UI axis, not a conversation item: the app uses
/// them for the running badge and never renders them on the timeline (D4 §6).
#[bridge_type]
pub enum ConversationLifecyclePhase {
    SessionStarted,
    TurnStarted,
    TurnEnded,
    SessionEnded,
}

/// Lifecycle/state vocabulary of an observable session (decision D2).
/// Variant casing follows the bridge codegen's camelCase rule, so the wire
/// values are `live` / `ended` / `unobserved`.
#[bridge_type]
pub enum RemoteSessionState {
    /// The tap stream is live for this session.
    Live,
    /// The session ended (`session_shutdown` observed); the stream closes
    /// after the shared `session_gone` reset converges.
    Ended,
    /// Known to exist but no tap stream is served for it (honest inventory
    /// mark, mirroring the pane family's `unobserved`).
    Unobserved,
}

/// Why a session stream converged to a reset frame (decision D3). Variant
/// casing follows the bridge codegen's camelCase rule, so the wire values
/// are `cursorUnavailable` / `sessionGone` / `slowConsumer`. Mirrors the
/// pane family's reset reasons with the session-gone cause named for the
/// session lifetime.
#[bridge_type]
pub enum RemoteSessionResetReason {
    /// The presented cursor is malformed, foreign, or points at evicted
    /// history; the client restarts from a fresh frame.
    CursorUnavailable,
    /// The session no longer exists (pi session shutdown); shared-recorded
    /// so reconnects converge identically (unlike the other two reasons,
    /// this one IS replayed after being recorded — pane `paneGone` precedent).
    SessionGone,
    /// The connection's outbound queue overflowed; identical in effect to
    /// `cursor_unavailable` (fresh start) but named for the cause,
    /// connection-local, never buffered for replay.
    SlowConsumer,
}

/// Reference to one attachment body served by the gateway (decision D5,
/// M2): metadata only, never the body. `byte_len` is the DECODED body size
/// in bytes and is bounded far below u32 by the gateway's per-asset cap, so
/// the family stays free of the u64 decimal-string rule.
#[bridge_type]
pub struct RemoteSessionAssetRef {
    /// Gateway-assigned attachment identity; addresses the body endpoint.
    pub attachment_id: String,
    /// Bounded RFC 2045 media type (`type/subtype`), e.g. `image/png`.
    pub mime_type: String,
    /// Decoded body size in bytes; advisory render metadata (sizing/labels).
    pub byte_len: u32,
}

/// One user input on the session stream (SSE event `user_message`): a
/// complete user turn as observed by the tap (decision D5, M2).
#[bridge_type]
pub struct ConversationUserMessage {
    /// Tap-assigned message identity; the app's idempotent render key.
    pub message_id: String,
    /// Bounded, redacted input text.
    pub text: String,
    pub source: ConversationUserMessageSource,
    /// Number of image attachments observed in this input. The honest
    /// observed count; `attachments` is the referenceable subset (bodies the
    /// gateway actually holds), so it may be smaller (D5).
    pub image_count: u32,
    /// Reference-shaped attachment metadata. Bodies are served out-of-band
    /// at `GET /v1/sessions/{sessionId}/attachments/{attachmentId}` — never
    /// inline (ring-buffer/replay budget, D5).
    pub attachments: Vec<RemoteSessionAssetRef>,
    /// UTC RFC 3339 timestamp of the tap observation.
    pub occurred_at: String,
}

/// One assistant streaming delta (SSE event `assistant_delta`) for the
/// `message_id` buffer. Gateway-merged (bounded cadence); tokens are never
/// forwarded one-by-one (D4 §2). The final
/// `ConversationAssistantMessage` replaces the whole buffer, so lost or
/// duplicated deltas always converge.
#[bridge_type]
pub struct ConversationAssistantDelta {
    pub message_id: String,
    /// Bounded, redacted merged-delta text (append to the buffer).
    pub delta: String,
    /// UTC RFC 3339 timestamp of the gateway merge.
    pub occurred_at: String,
}

/// The authoritative final assistant message (SSE event
/// `assistant_message`): replaces the entire `message_id` buffer (D4 §2).
#[bridge_type]
pub struct ConversationAssistantMessage {
    pub message_id: String,
    /// Bounded, redacted final text.
    pub text: String,
    /// True when the final text exceeded the frame byte bound and was cut.
    pub truncated: bool,
    /// UTC RFC 3339 timestamp of the tap observation.
    pub occurred_at: String,
}

/// A tool call began (SSE event `tool_call_started`): opens the app's tool
/// card in the `running` state (D4 §3).
#[bridge_type]
pub struct ConversationToolCallStarted {
    /// Tap-assigned tool-call identity (pi `toolCallId` correlation); the
    /// card's idempotent render key.
    pub tool_call_id: String,
    pub tool_name: String,
    /// Bounded, redacted JSON encoding of the call arguments.
    pub args_json: String,
    /// True when `args_json` exceeded the frame byte bound and was cut.
    pub args_truncated: bool,
    /// UTC RFC 3339 timestamp of the tap observation.
    pub occurred_at: String,
}

/// A tool call ended (SSE event `tool_call_ended`): closes the
/// `tool_call_id` card as `done` or `error` (D4 §3). A card with no prior
/// `started` frame (replay eviction, collector gap) is synthesized closed —
/// never through the `running` state.
#[bridge_type]
pub struct ConversationToolCallEnded {
    pub tool_call_id: String,
    /// Bounded, redacted result text for the card's collapsed view.
    pub result_text: String,
    /// True when `result_text` exceeded the frame byte bound and was cut.
    pub result_truncated: bool,
    /// True renders the card's error state; the run state is unaffected.
    pub is_error: bool,
    /// UTC RFC 3339 timestamp of the tap observation.
    pub occurred_at: String,
}

/// A session/turn lifecycle boundary (SSE event `lifecycle`): the running
/// badge axis. Not a conversation item — never rendered on the timeline
/// (D4 §6).
#[bridge_type]
pub struct ConversationLifecycle {
    pub phase: ConversationLifecyclePhase,
    /// UTC RFC 3339 timestamp of the tap observation.
    pub occurred_at: String,
}

/// Mirror of an accepted steer on the mapped session's stream (SSE event
/// `steer_queued`): step 2 of the honest 3-step steer feedback (D4 §4 —
/// submit receipt → this frame → the observed `user_message` with
/// `source=steer`). Emitted only for sessions with a run correlation.
#[bridge_type]
pub struct ConversationSteerQueued {
    /// Steer acceptance identity; pairs the app's local pending marker.
    pub steer_id: String,
    /// Bounded, redacted steer text.
    pub text: String,
    /// The run the steer was accepted against (adapter correlation).
    pub run_id: String,
    /// UTC RFC 3339 timestamp of the gateway acceptance.
    pub occurred_at: String,
}

/// Session stream reset frame (SSE event `conversation_reset`): the
/// convergence contract for cursors, lifetime, and backpressure (decision
/// D3). Connection-local for `cursor_unavailable` / `slow_consumer` (never
/// buffered for replay); `session_gone` is shared-recorded and replayed so
/// reconnects converge identically (pane `paneGone` precedent).
#[bridge_type]
pub struct RemoteSessionResetEvent {
    pub reason: RemoteSessionResetReason,
    /// UTC RFC 3339 timestamp of the gateway observation.
    pub occurred_at: String,
}

/// One subscribable session in the conversation inventory (decision D2).
/// The run/task/worker correlation is adapter metadata (env-marker backed),
/// not loop-core state; uncorrelated sessions report nulls honestly.
#[bridge_type]
pub struct RemoteSessionSummary {
    pub session_id: String,
    /// Correlated run, when the worker was started with a run marker.
    pub run_id: Option<String>,
    /// Correlated task, when the worker was started with a task marker.
    pub task_id: Option<String>,
    /// Owning worker, when the session backs a registered worker.
    pub worker_id: Option<String>,
    /// Execution lane the session runs on (adapter-reported label).
    pub lane: String,
    /// Human label for list rendering; null when the session has none.
    pub title: Option<String>,
    pub state: RemoteSessionState,
}

/// GET /v1/sessions response body: the session inventory (decision D3).
#[bridge_type]
pub struct RemoteSessionListOutput {
    pub sessions: Vec<RemoteSessionSummary>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every conversation frame family type round-trips serde JSON without
    /// loss (regression guard for the `#[bridge_type]` camelCase contract).
    #[test]
    fn conversation_frames_round_trip_through_serde_json() {
        let user = ConversationUserMessage {
            message_id: "m-1".into(),
            text: "run the tests".into(),
            source: ConversationUserMessageSource::Steer,
            image_count: 2,
            attachments: vec![RemoteSessionAssetRef {
                attachment_id: "att-1".into(),
                mime_type: "image/png".into(),
                byte_len: 70,
            }],
            occurred_at: "2026-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&user).unwrap();
        assert_eq!(
            json,
            r#"{"messageId":"m-1","text":"run the tests","source":"steer","imageCount":2,"attachments":[{"attachmentId":"att-1","mimeType":"image/png","byteLen":70}],"occurredAt":"2026-01-01T00:00:00Z"}"#
        );
        let parsed: ConversationUserMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.message_id, "m-1");
        assert!(matches!(
            parsed.source,
            ConversationUserMessageSource::Steer
        ));
        assert_eq!(parsed.image_count, 2);
        assert_eq!(parsed.attachments.len(), 1);
        assert_eq!(parsed.attachments[0].attachment_id, "att-1");
        assert_eq!(parsed.attachments[0].mime_type, "image/png");
        assert_eq!(parsed.attachments[0].byte_len, 70);

        // D5 honesty invariant: a message with no servable bodies carries an
        // empty reference list while keeping the observed image count.
        let parsed: ConversationUserMessage =
            serde_json::from_str(r#"{"messageId":"m-2","text":"x","source":"api","imageCount":3,"attachments":[],"occurredAt":"2026-01-01T00:00:00Z"}"#).unwrap();
        assert_eq!(parsed.image_count, 3);
        assert!(parsed.attachments.is_empty());

        let delta = ConversationAssistantDelta {
            message_id: "m-1".into(),
            delta: "partial ".into(),
            occurred_at: "2026-01-01T00:00:01Z".into(),
        };
        let parsed: ConversationAssistantDelta =
            serde_json::from_str(&serde_json::to_string(&delta).unwrap()).unwrap();
        assert_eq!(parsed.delta, "partial ");

        let final_message = ConversationAssistantMessage {
            message_id: "m-1".into(),
            text: "partial final".into(),
            truncated: true,
            occurred_at: "2026-01-01T00:00:02Z".into(),
        };
        let parsed: ConversationAssistantMessage =
            serde_json::from_str(&serde_json::to_string(&final_message).unwrap()).unwrap();
        assert!(parsed.truncated);
        assert_eq!(parsed.text, "partial final");

        let started = ConversationToolCallStarted {
            tool_call_id: "t-1".into(),
            tool_name: "read".into(),
            args_json: r#"{"path":"src/lib.rs"}"#.into(),
            args_truncated: false,
            occurred_at: "2026-01-01T00:00:03Z".into(),
        };
        let parsed: ConversationToolCallStarted =
            serde_json::from_str(&serde_json::to_string(&started).unwrap()).unwrap();
        assert_eq!(parsed.tool_call_id, "t-1");
        assert!(!parsed.args_truncated);

        let ended = ConversationToolCallEnded {
            tool_call_id: "t-1".into(),
            result_text: "ok".into(),
            result_truncated: true,
            is_error: false,
            occurred_at: "2026-01-01T00:00:04Z".into(),
        };
        let parsed: ConversationToolCallEnded =
            serde_json::from_str(&serde_json::to_string(&ended).unwrap()).unwrap();
        assert!(parsed.result_truncated);
        assert!(!parsed.is_error);

        let lifecycle = ConversationLifecycle {
            phase: ConversationLifecyclePhase::TurnStarted,
            occurred_at: "2026-01-01T00:00:05Z".into(),
        };
        let parsed: ConversationLifecycle =
            serde_json::from_str(&serde_json::to_string(&lifecycle).unwrap()).unwrap();
        assert!(matches!(
            parsed.phase,
            ConversationLifecyclePhase::TurnStarted
        ));

        let steer = ConversationSteerQueued {
            steer_id: "s-1".into(),
            text: "focus on the failing test".into(),
            run_id: "run-1".into(),
            occurred_at: "2026-01-01T00:00:06Z".into(),
        };
        let parsed: ConversationSteerQueued =
            serde_json::from_str(&serde_json::to_string(&steer).unwrap()).unwrap();
        assert_eq!(parsed.steer_id, "s-1");
        assert_eq!(parsed.run_id, "run-1");

        let reset = RemoteSessionResetEvent {
            reason: RemoteSessionResetReason::SessionGone,
            occurred_at: "2026-01-01T00:00:07Z".into(),
        };
        let json = serde_json::to_string(&reset).unwrap();
        assert_eq!(
            json,
            r#"{"reason":"sessionGone","occurredAt":"2026-01-01T00:00:07Z"}"#
        );
        let parsed: RemoteSessionResetEvent = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            parsed.reason,
            RemoteSessionResetReason::SessionGone
        ));
    }

    /// The inventory round-trips, including absent correlation metadata
    /// (`run_id=null` honest representation for uncorrelated sessions).
    #[test]
    fn session_inventory_round_trips_with_null_correlation() {
        let inventory = RemoteSessionListOutput {
            sessions: vec![
                RemoteSessionSummary {
                    session_id: "sess-1".into(),
                    run_id: Some("run-1".into()),
                    task_id: Some("task-1".into()),
                    worker_id: Some("worker-1".into()),
                    lane: "pi".into(),
                    title: Some("worker: research".into()),
                    state: RemoteSessionState::Live,
                },
                RemoteSessionSummary {
                    session_id: "sess-2".into(),
                    run_id: None,
                    task_id: None,
                    worker_id: None,
                    lane: "pi".into(),
                    title: None,
                    state: RemoteSessionState::Unobserved,
                },
            ],
        };
        let json = serde_json::to_string(&inventory).unwrap();
        assert!(json.contains(r#""runId":"run-1""#));
        assert!(json.contains(r#""runId":null"#));
        assert!(json.contains(r#""state":"live""#));
        assert!(json.contains(r#""state":"unobserved""#));
        let parsed: RemoteSessionListOutput = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.sessions.len(), 2);
        assert_eq!(parsed.sessions[0].run_id.as_deref(), Some("run-1"));
        assert!(parsed.sessions[1].run_id.is_none());
        assert!(matches!(
            parsed.sessions[1].state,
            RemoteSessionState::Unobserved
        ));
    }

    /// Schema presence (decision M-GC0): the loop package schema anchors the
    /// conversation frame payloads under their rustra event names, so the
    /// gateway and the app consume GENERATED wire types only. SSE frame
    /// names are the `loop.`-stripped event names (module contract notes).
    #[test]
    fn package_schema_anchors_conversation_frame_events() {
        let schema = crate::loop_package().live_schema();
        let schema = serde_json::to_string(&schema).unwrap();

        for name in [
            "loop.session_list",
            "loop.user_message",
            "loop.assistant_delta",
            "loop.assistant_message",
            "loop.tool_call_started",
            "loop.tool_call_ended",
            "loop.lifecycle",
            "loop.steer_queued",
            "loop.conversation_reset",
        ] {
            assert!(
                schema.contains(&format!(r#""name":"{name}""#)),
                "missing event {name}"
            );
        }

        for definition in [
            "ConversationUserMessage",
            "ConversationUserMessageSource",
            "ConversationAssistantDelta",
            "ConversationAssistantMessage",
            "ConversationToolCallStarted",
            "ConversationToolCallEnded",
            "ConversationLifecycle",
            "ConversationLifecyclePhase",
            "ConversationSteerQueued",
            "RemoteSessionResetEvent",
            "RemoteSessionResetReason",
            "RemoteSessionSummary",
            "RemoteSessionListOutput",
            "RemoteSessionState",
        ] {
            assert!(
                schema.contains(&format!(r#""{definition}""#)),
                "missing definition {definition}"
            );
        }
    }

    /// The user-message source vocabulary is fixed at v1 (decision D2):
    /// `interactive` / `steer` / `api` on the wire.
    #[test]
    fn user_message_source_wire_vocabulary_is_fixed() {
        for (variant, wire) in [
            (ConversationUserMessageSource::Interactive, "interactive"),
            (ConversationUserMessageSource::Steer, "steer"),
            (ConversationUserMessageSource::Api, "api"),
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, format!(r#""{wire}""#));
        }
    }

    /// The lifecycle phase vocabulary is fixed at v1 (decision D2):
    /// `sessionStarted` / `turnStarted` / `turnEnded` / `sessionEnded`.
    #[test]
    fn lifecycle_phase_wire_vocabulary_is_fixed() {
        for (variant, wire) in [
            (ConversationLifecyclePhase::SessionStarted, "sessionStarted"),
            (ConversationLifecyclePhase::TurnStarted, "turnStarted"),
            (ConversationLifecyclePhase::TurnEnded, "turnEnded"),
            (ConversationLifecyclePhase::SessionEnded, "sessionEnded"),
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, format!(r#""{wire}""#));
        }
    }

    /// The reset reason vocabulary matches the pane family's axes with the
    /// session-gone cause (decision D3): `cursorUnavailable` /
    /// `sessionGone` / `slowConsumer`.
    #[test]
    fn reset_reason_wire_vocabulary_matches_decision() {
        for (variant, wire) in [
            (
                RemoteSessionResetReason::CursorUnavailable,
                "cursorUnavailable",
            ),
            (RemoteSessionResetReason::SessionGone, "sessionGone"),
            (RemoteSessionResetReason::SlowConsumer, "slowConsumer"),
        ] {
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, format!(r#""{wire}""#));
        }
    }
}
