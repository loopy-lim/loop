//! Wire types for optional usage metadata (gap analysis G17 — 사용량·비용
//! 기록, 도입).
//!
//! Boundary: these types live only in the bridge (transport form). Usage is
//! recorded ONLY when the upstream reports it; nothing here invents figures.
//! Estimated and observed values are distinguished on the wire (`basis`) so
//! derived numbers are never presented as measured costs. Cost is a bounded
//! decimal string — never floating-point money on the wire.

use rustra::prelude::*;

/// How a usage figure was obtained (G17 추정치/실측 구별). Variant casing
/// follows the bridge codegen's camelCase rule, so the wire values are
/// `observed` / `estimated`.
#[bridge_type]
pub enum UsageBasis {
    /// Upstream-reported actuals.
    Observed,
    /// Locally derived estimate; reporting surfaces must label it as an
    /// estimate, never as a measured cost.
    Estimated,
}

/// Optional usage metadata (G17): present only when the upstream reports it.
/// Individual axes are null when unreported; `basis` qualifies every figure
/// in the record at once (adapters do not mix observed and estimated axes).
#[bridge_type]
pub struct UsageMetadata {
    /// Prompt (input) tokens; null when unreported.
    pub input_tokens: Option<u64>,
    /// Completion (output) tokens; null when unreported.
    pub output_tokens: Option<u64>,
    /// Cache-read tokens when the upstream reports a separate cache axis.
    pub cache_read_tokens: Option<u64>,
    pub basis: UsageBasis,
    /// Bounded decimal-string cost in `currency`; null when unpriced.
    pub cost: Option<String>,
    /// ISO 4217 code for `cost`; null when unpriced.
    pub currency: Option<String>,
}

/// Wire shape of one usage observation (G17): emitted by the collecting
/// surface and recorded by the orchestrator. Worker/task correlation is
/// optional so run-level totals use the same record shape.
#[bridge_type]
pub struct UsageRecordEvent {
    pub run_id: String,
    /// Worker task the usage belongs to; null for run-level usage.
    pub task_id: Option<String>,
    /// Adapter worker identity; opaque correlation label.
    pub worker_id: Option<String>,
    pub usage: UsageMetadata,
    /// UTC RFC 3339 timestamp of the observation window end.
    pub occurred_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The usage record round-trips serde JSON without loss (regression
    /// guard for the `#[bridge_type]` camelCase contract) and null axes
    /// survive honestly.
    #[test]
    fn usage_record_round_trips_through_serde_json() {
        let record = UsageRecordEvent {
            run_id: "run-1".into(),
            task_id: Some("task-1".into()),
            worker_id: Some("worker-1".into()),
            usage: UsageMetadata {
                input_tokens: Some(1_234),
                output_tokens: Some(567),
                cache_read_tokens: None,
                basis: UsageBasis::Observed,
                cost: Some("0.0123".into()),
                currency: Some("USD".into()),
            },
            occurred_at: "2026-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&record).unwrap();
        assert!(json.contains(r#""inputTokens":1234"#));
        assert!(json.contains(r#""outputTokens":567"#));
        assert!(json.contains(r#""cacheReadTokens":null"#));
        assert!(json.contains(r#""basis":"observed""#));
        assert!(json.contains(r#""cost":"0.0123""#));
        assert!(json.contains(r#""currency":"USD""#));
        let parsed: UsageRecordEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.usage.input_tokens, Some(1_234));
        assert!(parsed.usage.cache_read_tokens.is_none());

        // Honesty invariant: an unpriced, unreported record stays null on
        // every axis and still carries its basis.
        let parsed: UsageRecordEvent = serde_json::from_str(
            r#"{"runId":"run-1","taskId":null,"workerId":null,"usage":{"inputTokens":null,"outputTokens":null,"cacheReadTokens":null,"basis":"estimated","cost":null,"currency":null},"occurredAt":"2026-01-01T00:00:00Z"}"#,
        )
        .unwrap();
        assert!(parsed.task_id.is_none());
        assert!(parsed.usage.cost.is_none());
        assert!(matches!(parsed.usage.basis, UsageBasis::Estimated));
    }

    /// The basis vocabulary is fixed at v1: `observed` / `estimated`.
    #[test]
    fn usage_basis_wire_vocabulary_is_fixed() {
        for (variant, wire) in [
            (UsageBasis::Observed, "observed"),
            (UsageBasis::Estimated, "estimated"),
        ] {
            assert_eq!(serde_json::to_string(&variant).unwrap(), format!(r#""{wire}""#));
        }
    }

    /// Schema presence: the loop package schema anchors the usage record
    /// payload under its rustra event name so recording surfaces consume
    /// GENERATED wire types only.
    #[test]
    fn package_schema_anchors_usage_record_event() {
        let schema = serde_json::to_string(&crate::loop_package().live_schema()).unwrap();
        assert!(schema.contains(r#""name":"loop.usage_recorded""#));
        for definition in ["UsageRecordEvent", "UsageMetadata", "UsageBasis"] {
            assert!(
                schema.contains(&format!(r#""{definition}""#)),
                "missing definition {definition}"
            );
        }
    }
}
