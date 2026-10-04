//! Benchmark·trace commands — trace summaries, scoring, and comparison —
//! plus the pure policy evaluators registered alongside them (compute
//! routing selection, failure policy, cleanup disposition).

use super::{bridge_error, store};
use loop_core::benchmark::{TraceComparison, TraceScore, TraceSummary};
use loop_core::policy::{
    CleanupDisposition, ComputeClass, DependencyTerminalization, FailureClass, FailurePolicy,
    IndependentBranchAction, OnExhaustion, RefusalCode, RetryOutcome, RetryScope, RunFailureAction,
    TerminalizationPolicy,
};
use loop_core::task::{TaskKind, TaskState};
use rustra::prelude::*;

#[bridge_type]
pub struct GetTraceInput {
    pub database_path: String,
    pub run_id: String,
}

#[bridge_type]
pub struct CompareTracesInput {
    pub database_path: String,
    pub run_ids: Vec<String>,
}

/// Per-run row of a benchmark report: aggregated metrics plus derived score.
#[bridge_type]
pub struct TraceReportEntry {
    pub run_id: String,
    pub summary: TraceSummary,
    pub score: TraceScore,
}

#[bridge_type]
pub struct GetTraceOutput {
    pub run_id: String,
    pub summary: TraceSummary,
    pub score: TraceScore,
}

#[bridge_type]
pub struct CompareTracesOutput {
    /// One row per compared run, in input order (duplicates removed).
    pub entries: Vec<TraceReportEntry>,
    /// Deterministic ranking by score, highest first.
    pub comparison: TraceComparison,
}

#[bridge_type]
pub struct EvaluateCleanupDispositionInput {
    pub refusal_code: RefusalCode,
}

#[bridge_type]
pub struct CleanupDispositionOutput {
    pub disposition: CleanupDisposition,
}

#[bridge_type]
pub struct EvaluateFailurePolicyInput {
    pub failure_class: FailureClass,
    pub retries_used: u16,
    pub task_kind: TaskKind,
    pub failure_policy: FailurePolicy,
    pub terminalization_policy: TerminalizationPolicy,
}

#[bridge_type]
pub enum FailurePolicyAction {
    Retry,
    FailTask,
    RequireAttention,
}

#[bridge_type]
pub struct FailurePolicyOutput {
    pub action: FailurePolicyAction,
    pub retry_scope: Option<RetryScope>,
    pub delay_ms: Option<u64>,
    pub dependents: Option<DependencyTerminalization>,
    pub independent_branches: Option<IndependentBranchAction>,
    pub run: Option<RunFailureAction>,
}

/// Capability scores advertised for a compute candidate (loop-core
/// `ComputeCapabilities` mirror; the core type lacks a JSON schema derive,
/// so the bridge carries its own wire form and converts on entry).
#[bridge_type]
pub struct ComputeCapabilitiesInput {
    pub coding: u8,
    pub reasoning: u8,
    pub tools: u8,
    pub vision: u8,
    pub long_context: u8,
}

/// Task risk driving the compute-class floor (loop-core `Risk` mirror).
#[bridge_type]
pub enum RoutingRisk {
    Low,
    Medium,
    High,
    Critical,
}

#[bridge_type]
pub struct ComputeCandidateInput {
    pub id: String,
    pub compute_class: ComputeClass,
    pub capabilities: ComputeCapabilitiesInput,
    pub latency: u16,
    pub cost_weight: u16,
    pub available: bool,
}

#[bridge_type]
pub struct CapabilityRequirementsInput {
    pub capabilities: ComputeCapabilitiesInput,
    pub minimum_compute: ComputeClass,
    pub maximum_compute: ComputeClass,
    pub risk: RoutingRisk,
    pub high_risk_floor: ComputeClass,
    pub critical_risk_floor: ComputeClass,
}

#[bridge_type]
pub struct SelectCandidateInput {
    pub candidates: Vec<ComputeCandidateInput>,
    pub eligible_candidate_ids: Vec<String>,
    pub requirements: CapabilityRequirementsInput,
}

#[bridge_type]
pub struct SelectCandidateOutput {
    pub candidate_id: String,
    pub compute_class: ComputeClass,
}

impl From<ComputeCapabilitiesInput> for loop_core::policy::ComputeCapabilities {
    fn from(input: ComputeCapabilitiesInput) -> Self {
        Self::new(
            input.coding,
            input.reasoning,
            input.tools,
            input.vision,
            input.long_context,
        )
    }
}

impl From<RoutingRisk> for loop_core::policy::Risk {
    fn from(risk: RoutingRisk) -> Self {
        match risk {
            RoutingRisk::Low => Self::Low,
            RoutingRisk::Medium => Self::Medium,
            RoutingRisk::High => Self::High,
            RoutingRisk::Critical => Self::Critical,
        }
    }
}

impl From<ComputeCandidateInput> for loop_core::policy::ComputeCandidate {
    fn from(input: ComputeCandidateInput) -> Self {
        let mut candidate = Self::new(
            input.id,
            input.compute_class,
            input.capabilities.into(),
            input.latency,
            input.cost_weight,
        );
        candidate.available = input.available;
        candidate
    }
}

pub(crate) fn register_trace(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(builder, get_trace, compare_traces)
}

pub(crate) fn register_policy(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(
        builder,
        select_candidate,
        evaluate_failure_policy,
        evaluate_cleanup_disposition
    )
}

fn run_trace_summary(database_path: &str, run_id: &str) -> Result<TraceSummary> {
    let store = store(database_path)?;
    let events = store
        .events(run_id)
        .map_err(|error| bridge_error("trace_failed", error))?;
    if events.is_empty() {
        return Err(bridge_error("run_not_found", run_id));
    }
    let mut summary = TraceSummary::from_events(&events);
    let projection = store
        .projection(run_id)
        .map_err(|error| bridge_error("trace_failed", error))?;
    // Store runs complete tasks through VerificationPassed; TaskCompleted is an
    // optional runtime receipt, so take completions from the projection.
    summary.tasks_completed = u32::try_from(
        projection
            .tasks
            .values()
            .filter(|task| task.state == TaskState::Done)
            .count(),
    )
    .unwrap_or(u32::MAX);
    Ok(summary)
}

#[command]
pub fn get_trace(input: GetTraceInput) -> Result<GetTraceOutput> {
    let run_id = input.run_id.clone();
    let summary = run_trace_summary(&input.database_path, &run_id)?;
    Ok(GetTraceOutput {
        run_id,
        score: summary.score(),
        summary,
    })
}

#[command]
pub fn compare_traces(input: CompareTracesInput) -> Result<CompareTracesOutput> {
    if input.run_ids.is_empty() {
        return Err(bridge_error(
            "invalid_comparison",
            "at least one run_id is required",
        ));
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut entries = Vec::with_capacity(input.run_ids.len());
    let mut ranked = Vec::with_capacity(input.run_ids.len());
    for run_id in input.run_ids {
        if !seen.insert(run_id.clone()) {
            continue;
        }
        let summary = run_trace_summary(&input.database_path, &run_id)?;
        ranked.push((run_id.clone(), summary));
        entries.push(TraceReportEntry {
            run_id,
            score: summary.score(),
            summary,
        });
    }
    Ok(CompareTracesOutput {
        entries,
        comparison: loop_core::benchmark::compare_traces(ranked),
    })
}

#[command]
pub fn select_candidate(input: SelectCandidateInput) -> Result<SelectCandidateOutput> {
    let requirements = loop_core::policy::CapabilityRequirements::new(
        input.requirements.capabilities.coding,
        input.requirements.capabilities.reasoning,
        input.requirements.capabilities.tools,
        input.requirements.capabilities.vision,
        input.requirements.capabilities.long_context,
    )
    .with_compute_range(
        input.requirements.minimum_compute,
        input.requirements.maximum_compute,
    )
    .with_risk(input.requirements.risk.into())
    .with_risk_floors(
        input.requirements.high_risk_floor,
        input.requirements.critical_risk_floor,
    );
    let candidates: Vec<loop_core::policy::ComputeCandidate> =
        input.candidates.into_iter().map(Into::into).collect();
    let eligible_candidate_ids: std::collections::BTreeSet<String> =
        input.eligible_candidate_ids.into_iter().collect();
    let selected =
        loop_core::policy::select_candidate(&candidates, &eligible_candidate_ids, &requirements)
            .map_err(|error| bridge_error("no_sufficient_candidate", error))?;
    Ok(SelectCandidateOutput {
        candidate_id: selected.id.clone(),
        compute_class: selected.compute_class,
    })
}

#[command]
pub fn evaluate_cleanup_disposition(
    input: EvaluateCleanupDispositionInput,
) -> Result<CleanupDispositionOutput> {
    Ok(CleanupDispositionOutput {
        disposition: input.refusal_code.disposition(),
    })
}

#[command]
pub fn evaluate_failure_policy(input: EvaluateFailurePolicyInput) -> Result<FailurePolicyOutput> {
    Ok(
        match input
            .failure_policy
            .evaluate(input.failure_class, input.retries_used)
        {
            RetryOutcome::Retry { scope, delay_ms } => FailurePolicyOutput {
                action: FailurePolicyAction::Retry,
                retry_scope: Some(scope),
                delay_ms: Some(delay_ms),
                dependents: None,
                independent_branches: None,
                run: None,
            },
            RetryOutcome::Exhausted(OnExhaustion::RequireAttention) => FailurePolicyOutput {
                action: FailurePolicyAction::RequireAttention,
                retry_scope: None,
                delay_ms: None,
                dependents: None,
                independent_branches: None,
                run: None,
            },
            RetryOutcome::Exhausted(OnExhaustion::FailTask) => {
                let terminalization = input.terminalization_policy.outcome(input.task_kind);
                FailurePolicyOutput {
                    action: FailurePolicyAction::FailTask,
                    retry_scope: None,
                    delay_ms: None,
                    dependents: Some(terminalization.dependents),
                    independent_branches: Some(terminalization.independent_branches),
                    run: Some(terminalization.run),
                }
            }
        },
    )
}

#[cfg(test)]
mod routing_tests {
    use super::*;

    fn candidate(id: &str, compute_class: ComputeClass, cost_weight: u16) -> ComputeCandidateInput {
        ComputeCandidateInput {
            id: id.into(),
            compute_class,
            capabilities: ComputeCapabilitiesInput {
                coding: 0,
                reasoning: 0,
                tools: 1,
                vision: 0,
                long_context: 0,
            },
            latency: 0,
            cost_weight,
            available: true,
        }
    }

    fn requirements(
        minimum: ComputeClass,
        maximum: ComputeClass,
        risk: RoutingRisk,
    ) -> CapabilityRequirementsInput {
        CapabilityRequirementsInput {
            capabilities: ComputeCapabilitiesInput {
                coding: 0,
                reasoning: 0,
                tools: 0,
                vision: 0,
                long_context: 0,
            },
            minimum_compute: minimum,
            maximum_compute: maximum,
            risk,
            high_risk_floor: ComputeClass::Strong,
            critical_risk_floor: ComputeClass::Frontier,
        }
    }

    fn eligible(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    #[test]
    fn select_candidate_prefers_the_cheapest_eligible_candidate() {
        let output = select_candidate(SelectCandidateInput {
            candidates: vec![
                candidate("expensive", ComputeClass::Fast, 90),
                candidate("cheap", ComputeClass::Fast, 10),
            ],
            eligible_candidate_ids: eligible(&["expensive", "cheap"]),
            requirements: requirements(ComputeClass::Fast, ComputeClass::Strong, RoutingRisk::Low),
        })
        .unwrap();
        assert_eq!(output.candidate_id, "cheap");
        assert_eq!(output.compute_class, ComputeClass::Fast);
    }

    #[test]
    fn select_candidate_applies_the_risk_floor() {
        let output = select_candidate(SelectCandidateInput {
            candidates: vec![
                candidate("tiny", ComputeClass::Tiny, 1),
                candidate("strong", ComputeClass::Strong, 50),
            ],
            eligible_candidate_ids: eligible(&["tiny", "strong"]),
            requirements: requirements(
                ComputeClass::Tiny,
                ComputeClass::Frontier,
                RoutingRisk::High,
            ),
        })
        .unwrap();
        // High risk floors the effective minimum at Strong, so the cheap
        // tiny candidate is rejected by the loop-core decision.
        assert_eq!(output.candidate_id, "strong");
    }

    #[test]
    fn select_candidate_respects_maximum_compute_and_eligibility() {
        let output = select_candidate(SelectCandidateInput {
            candidates: vec![
                candidate("frontier", ComputeClass::Frontier, 1),
                candidate("eligible-strong", ComputeClass::Strong, 40),
                candidate("ineligible-fast", ComputeClass::Fast, 1),
            ],
            eligible_candidate_ids: eligible(&["frontier", "eligible-strong"]),
            requirements: requirements(ComputeClass::Tiny, ComputeClass::Strong, RoutingRisk::Low),
        })
        .unwrap();
        assert_eq!(output.candidate_id, "eligible-strong");
    }

    #[test]
    fn select_candidate_enforces_capability_requirements() {
        let mut sighted = candidate("sighted", ComputeClass::Fast, 20);
        sighted.capabilities.vision = 1;
        let output = select_candidate(SelectCandidateInput {
            candidates: vec![candidate("blind", ComputeClass::Fast, 1), sighted],
            eligible_candidate_ids: eligible(&["blind", "sighted"]),
            requirements: CapabilityRequirementsInput {
                capabilities: ComputeCapabilitiesInput {
                    coding: 0,
                    reasoning: 0,
                    tools: 0,
                    vision: 1,
                    long_context: 0,
                },
                minimum_compute: ComputeClass::Fast,
                maximum_compute: ComputeClass::Strong,
                risk: RoutingRisk::Low,
                high_risk_floor: ComputeClass::Strong,
                critical_risk_floor: ComputeClass::Frontier,
            },
        })
        .unwrap();
        assert_eq!(output.candidate_id, "sighted");
    }

    #[test]
    fn cleanup_disposition_is_exposed_without_creating_attention() {
        let output = evaluate_cleanup_disposition(EvaluateCleanupDispositionInput {
            refusal_code: RefusalCode::RunNotTerminal,
        })
        .unwrap();

        assert!(matches!(output.disposition, CleanupDisposition::Defer));
    }

    #[test]
    fn failure_policy_returns_a_core_terminalization_outcome() {
        let output = evaluate_failure_policy(EvaluateFailurePolicyInput {
            failure_class: FailureClass::Assertion,
            retries_used: 0,
            task_kind: TaskKind::Integration,
            failure_policy: FailurePolicy::default(),
            terminalization_policy: TerminalizationPolicy::default(),
        })
        .unwrap();

        assert!(matches!(output.action, FailurePolicyAction::FailTask));
        assert_eq!(
            output.dependents,
            Some(DependencyTerminalization::BlockTerminal)
        );
        assert_eq!(output.run, Some(RunFailureAction::Fail));
        assert_eq!(output.retry_scope, None);
    }

    #[test]
    fn select_candidate_rejects_when_no_candidate_qualifies() {
        let mut offline = candidate("offline", ComputeClass::Fast, 1);
        offline.available = false;
        let error = select_candidate(SelectCandidateInput {
            candidates: vec![offline],
            eligible_candidate_ids: eligible(&["offline"]),
            requirements: requirements(ComputeClass::Fast, ComputeClass::Strong, RoutingRisk::Low),
        })
        .unwrap_err();
        assert_eq!(error.code(), "no_sufficient_candidate");
        assert_eq!(
            error.message(),
            "no eligible compute candidate satisfies task constraints"
        );
    }
}
