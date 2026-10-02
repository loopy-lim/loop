//! Wire types for context lifecycle management (gap analysis G1 — 컨텍스트
//! 수명 관리, 도입).
//!
//! Boundary: these types live only in the bridge (transport form). The
//! summarization policy is an orchestrator-boundary concern (`task-execution`
//! injection path) because summarization requires a compute call, which may
//! never enter `loop-core`. Preserved sets — completion contracts, recorded
//! decisions, failure evidence, guidance — are invariant by policy; the event
//! carries only counts and the folded summary, never the dropped content.

use rustra::prelude::*;

/// Why advisory context was folded into a summary (G1). Variant casing
/// follows the bridge codegen's camelCase rule, so the wire values are
/// `budgetThreshold` / `explicit`.
#[bridge_type]
pub enum ContextSummaryReason {
    /// The advisory context approached the configured budget threshold and
    /// the summarization policy fired (the default trigger).
    BudgetThreshold,
    /// A lead or operator explicitly requested the summarization.
    Explicit,
}

/// Wire shape of one context summarization observation (G1): emitted by the
/// orchestrator when it replaces advisory context with a bounded summary at
/// the task-execution boundary. Preserved sets (completion contract, decision
/// records, failure evidence, guidance) are never summarized, so the record
/// counts them honestly instead of folding them.
#[bridge_type]
pub struct ContextSummaryEvent {
    pub run_id: String,
    pub task_id: String,
    /// Worker attempt the summarized context belonged to.
    pub attempt: u16,
    pub reason: ContextSummaryReason,
    /// Advisory entries folded into the summary (activity notes, retry
    /// history). Preserved entries are never counted here.
    pub summarized_entry_count: u32,
    /// Preserved entries passed through untouched (completion contract,
    /// decision records, failure evidence, guidance).
    pub preserved_entry_count: u32,
    /// Bounded, redacted summary text that replaced the folded entries.
    pub summary: String,
    /// True when `summary` exceeded the frame byte bound and was cut.
    pub truncated: bool,
    /// UTC RFC 3339 timestamp of the summarization.
    pub occurred_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ContextSummaryEvent {
        ContextSummaryEvent {
            run_id: "run-1".into(),
            task_id: "task-1".into(),
            attempt: 2,
            reason: ContextSummaryReason::BudgetThreshold,
            summarized_entry_count: 12,
            preserved_entry_count: 4,
            summary: "folded 12 advisory entries".into(),
            truncated: false,
            occurred_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    /// The summary event round-trips serde JSON without loss (regression
    /// guard for the `#[bridge_type]` camelCase contract).
    #[test]
    fn context_summary_round_trips_through_serde_json() {
        let json = serde_json::to_string(&sample()).unwrap();
        assert_eq!(
            json,
            r#"{"runId":"run-1","taskId":"task-1","attempt":2,"reason":"budgetThreshold","summarizedEntryCount":12,"preservedEntryCount":4,"summary":"folded 12 advisory entries","truncated":false,"occurredAt":"2026-01-01T00:00:00Z"}"#
        );
        let parsed: ContextSummaryEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.run_id, "run-1");
        assert_eq!(parsed.summarized_entry_count, 12);
        assert!(matches!(
            parsed.reason,
            ContextSummaryReason::BudgetThreshold
        ));
    }

    /// The reason vocabulary is fixed at v1: `budgetThreshold` / `explicit`.
    #[test]
    fn context_summary_reason_wire_vocabulary_is_fixed() {
        for (variant, wire) in [
            (ContextSummaryReason::BudgetThreshold, "budgetThreshold"),
            (ContextSummaryReason::Explicit, "explicit"),
        ] {
            assert_eq!(serde_json::to_string(&variant).unwrap(), format!(r#""{wire}""#));
        }
    }

    /// Schema presence: the loop package schema anchors the summary payload
    /// under its rustra event name so downstream surfaces consume GENERATED
    /// wire types only.
    #[test]
    fn package_schema_anchors_context_summary_event() {
        let schema = serde_json::to_string(&crate::loop_package().live_schema()).unwrap();
        assert!(schema.contains(r#""name":"loop.context_summary""#));
        for definition in [
            "ContextSummaryEvent",
            "ContextSummaryReason",
        ] {
            assert!(
                schema.contains(&format!(r#""{definition}""#)),
                "missing definition {definition}"
            );
        }
    }
}
