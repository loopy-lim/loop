//! Wire types for the adapter lifecycle-hook event seam (gap analysis G13 —
//! lifecycle 훅, 부분도입).
//!
//! Boundary: these types live only in the bridge (transport form). Hooks are
//! an adapter typed event seam: adapters map their own hook systems onto the
//! phases below and observe worker execution. Hook outcomes are EVIDENCE,
//! never gates — the completion judgment stays in loop-core Rust policy and
//! completion checks remain the only completion gate. The native bridge does
//! not interpret hook events.

use rustra::prelude::*;

/// Which lifecycle boundary fired a hook (G13). The typed vocabulary is
/// fixed at v1; adapters map their own hook systems onto these phases.
/// Variant casing follows the bridge codegen's camelCase rule, so the wire
/// values are `workerStarted` / `workerEnded` / `turnStarted` / `turnEnded` /
/// `toolCallStarted` / `toolCallEnded`.
#[bridge_type]
pub enum LifecycleHookPhase {
    /// A worker process started.
    WorkerStarted,
    /// A worker process ended (any terminal state).
    WorkerEnded,
    /// A worker turn began.
    TurnStarted,
    /// A worker turn ended.
    TurnEnded,
    /// A tool call began inside a worker turn.
    ToolCallStarted,
    /// A tool call ended inside a worker turn.
    ToolCallEnded,
}

/// Outcome the hook observer reported (G13). Hooks observe; a failed hook is
/// recorded evidence and never overrides run or task state.
/// Variant casing follows the bridge codegen's camelCase rule, so the wire
/// values are `completed` / `failed` / `skipped`.
#[bridge_type]
pub enum LifecycleHookOutcome {
    /// The hook ran to completion.
    Completed,
    /// The hook ran and reported a failure (carried as evidence only).
    Failed,
    /// The hook could not run (missing binary, misconfiguration).
    Skipped,
}

/// Typed seam event for adapter lifecycle hooks (G13): the bridge form of
/// one hook observation. Adapters frame these over their own event surfaces;
/// the native bridge never emits or interprets them, and completion checks
/// remain the only completion gate (core judgment invariant).
#[bridge_type]
pub struct LifecycleHookEvent {
    /// Adapter-assigned hook identity (its own hook-system name); opaque to
    /// the bridge.
    pub hook_id: String,
    pub phase: LifecycleHookPhase,
    pub outcome: LifecycleHookOutcome,
    /// Correlated run, when the hook ran inside a run-scoped worker.
    pub run_id: Option<String>,
    /// Correlated task, when the hook ran inside a task-scoped worker.
    pub task_id: Option<String>,
    /// Bounded, redacted hook output (formatter logs, policy findings).
    pub output: String,
    /// True when `output` exceeded the frame byte bound and was cut.
    pub truncated: bool,
    /// Hook process exit code, when the hook ran a process.
    pub exit_code: Option<i32>,
    /// UTC RFC 3339 timestamp of the hook observation.
    pub occurred_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> LifecycleHookEvent {
        LifecycleHookEvent {
            hook_id: "format-on-turn-end".into(),
            phase: LifecycleHookPhase::TurnEnded,
            outcome: LifecycleHookOutcome::Completed,
            run_id: Some("run-1".into()),
            task_id: Some("task-1".into()),
            output: "formatted 3 files".into(),
            truncated: false,
            exit_code: Some(0),
            occurred_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    /// The hook event round-trips serde JSON without loss (regression guard
    /// for the `#[bridge_type]` camelCase contract).
    #[test]
    fn lifecycle_hook_round_trips_through_serde_json() {
        let json = serde_json::to_string(&sample()).unwrap();
        assert_eq!(
            json,
            r#"{"hookId":"format-on-turn-end","phase":"turnEnded","outcome":"completed","runId":"run-1","taskId":"task-1","output":"formatted 3 files","truncated":false,"exitCode":0,"occurredAt":"2026-01-01T00:00:00Z"}"#
        );
        let parsed: LifecycleHookEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.hook_id, "format-on-turn-end");
        assert!(matches!(parsed.phase, LifecycleHookPhase::TurnEnded));

        // Evidence-only invariant: correlation and exit code are optional —
        // a detached observation with a failed hook still round-trips.
        let parsed: LifecycleHookEvent = serde_json::from_str(
            r#"{"hookId":"policy-check","phase":"toolCallStarted","outcome":"failed","runId":null,"taskId":null,"output":"denied","truncated":true,"exitCode":null,"occurredAt":"2026-01-01T00:00:01Z"}"#,
        )
        .unwrap();
        assert!(parsed.run_id.is_none());
        assert!(parsed.exit_code.is_none());
        assert!(parsed.truncated);
        assert!(matches!(parsed.outcome, LifecycleHookOutcome::Failed));
    }

    /// The phase and outcome vocabularies are fixed at v1.
    #[test]
    fn lifecycle_hook_wire_vocabularies_are_fixed() {
        for (variant, wire) in [
            (LifecycleHookPhase::WorkerStarted, "workerStarted"),
            (LifecycleHookPhase::WorkerEnded, "workerEnded"),
            (LifecycleHookPhase::TurnStarted, "turnStarted"),
            (LifecycleHookPhase::TurnEnded, "turnEnded"),
            (LifecycleHookPhase::ToolCallStarted, "toolCallStarted"),
            (LifecycleHookPhase::ToolCallEnded, "toolCallEnded"),
        ] {
            assert_eq!(
                serde_json::to_string(&variant).unwrap(),
                format!(r#""{wire}""#)
            );
        }
        for (variant, wire) in [
            (LifecycleHookOutcome::Completed, "completed"),
            (LifecycleHookOutcome::Failed, "failed"),
            (LifecycleHookOutcome::Skipped, "skipped"),
        ] {
            assert_eq!(
                serde_json::to_string(&variant).unwrap(),
                format!(r#""{wire}""#)
            );
        }
    }

    /// Schema presence: the loop package schema anchors the hook event
    /// payload under its rustra event name so adapters consume GENERATED
    /// wire types only.
    #[test]
    fn package_schema_anchors_lifecycle_hook_event() {
        let schema = serde_json::to_string(&crate::loop_package().live_schema()).unwrap();
        assert!(schema.contains(r#""name":"loop.lifecycle_hook""#));
        for definition in [
            "LifecycleHookEvent",
            "LifecycleHookPhase",
            "LifecycleHookOutcome",
        ] {
            assert!(
                schema.contains(&format!(r#""{definition}""#)),
                "missing definition {definition}"
            );
        }
    }
}
