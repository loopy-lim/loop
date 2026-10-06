use crate::run::RunState;
use crate::task::TaskId;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Run-level inputs that gate a dispatch attempt, mirrored from the store
/// projection. Their deterministic interpretation lives in
/// [`Scheduler::claim`](crate::scheduler::Scheduler::claim): only
/// [`RunState::Active`] may dispatch, and an open attention holds dispatch
/// even on an active run.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DispatchGate {
    /// Current run lifecycle state (`None` before the first run event).
    pub run_state: Option<RunState>,
    /// Whether the projection carries an unresolved attention request.
    pub has_open_attention: bool,
}

/// Deterministic outcome of one dispatch attempt. Bridge commands relay this
/// decision verbatim; the caller (orchestrator) reads the cause of an empty
/// claim from the variant instead of re-deriving it from a snapshot race.
///
/// Precedence: a run in a non-dispatchable lifecycle state (pausing, paused,
/// cancelling, terminal, not yet started) wins over an open attention —
/// lifecycle is the stronger gate. A run in `RunState::Attention`, or an
/// active run with a still-open attention, reports
/// [`ClaimDecision::AttentionHeld`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClaimDecision {
    /// Dispatchable work exists and was claimed for these tasks.
    Claimed(Vec<TaskId>),
    /// The run is not active (pausing, paused, cancelling, terminal, or not
    /// yet started); nothing may be claimed until it resumes.
    Paused,
    /// The run is active but an open attention holds dispatch.
    AttentionHeld,
    /// Dispatch is unheld, yet no runnable task fits capacity and conflict
    /// rules. This is the only hold-free empty result and the only one that
    /// justifies a blocked attention on the caller side.
    Empty,
}

impl ClaimDecision {
    /// Claimed task ids; empty for every non-claimed outcome.
    pub fn claimed_ids(&self) -> &[TaskId] {
        match self {
            Self::Claimed(ids) => ids,
            Self::Paused | Self::AttentionHeld | Self::Empty => &[],
        }
    }
}

/// Flat variant tag of [`ClaimDecision`] — the wire-shaped dispatch verdict.
/// The bridge output carries this tag next to the claimed ids; snake_case
/// values (`claimed`, `paused`, `attention_held`, `empty`) match the core
/// enum vocabulary so orchestrator callers read domain causes, not bit flags.
#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimOutcome {
    Claimed,
    Paused,
    AttentionHeld,
    Empty,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::TaskGraph;
    use crate::policy::{FailurePolicy, OnExhaustion};
    use crate::scheduler::{Capacity, Scheduler};
    use crate::task::{
        Assumption, CompletionCheck, CompletionContract, CompletionCoverage, DecompositionContract,
        SemanticAccess, SemanticConflictResolution, SemanticTouchpoint, Task, TaskKind,
        WorkOwnership,
    };

    fn task(id: &str, write_scope: &str) -> Task {
        let requirement = format!("requirement-{id}");
        Task::builder(TaskId::from(id), id, TaskKind::Implementation)
            .ownership(WorkOwnership::new(
                std::iter::empty::<&str>(),
                [write_scope],
            ))
            .requirements([requirement.clone()])
            .completion_contract(CompletionContract::new([CompletionCheck::new(format!(
                "check-{id}"
            ))
            .coverage(CompletionCoverage::new(
                [requirement],
                [write_scope],
                ["behavior"],
                crate::task::EvidenceLevel::Unit,
            ))]))
            .decomposition_contract(DecompositionContract::new(
                ["preserve compatibility"],
                [Assumption::new("offline", "tests", "report", "release")],
                [SemanticTouchpoint::new(
                    write_scope,
                    SemanticAccess::Modify,
                    SemanticConflictResolution::Serialize,
                )],
                [],
                FailurePolicy::new([], OnExhaustion::FailTask),
            ))
            .build()
            .unwrap()
    }

    fn active_gate() -> DispatchGate {
        DispatchGate {
            run_state: Some(RunState::Active),
            has_open_attention: false,
        }
    }

    #[test]
    fn claims_when_the_run_is_active_and_unheld() {
        let graph = TaskGraph::preflight([task("a", "src/**")]).unwrap();
        assert_eq!(
            Scheduler::new(Capacity::new(2, 1)).claim(&graph, &[], active_gate()),
            ClaimDecision::Claimed(vec![TaskId::from("a")])
        );
    }

    #[test]
    fn paused_run_wins_over_open_attention() {
        let graph = TaskGraph::preflight([task("a", "src/**")]).unwrap();
        let gate = DispatchGate {
            run_state: Some(RunState::Paused),
            has_open_attention: true,
        };
        assert_eq!(
            Scheduler::new(Capacity::new(2, 1)).claim(&graph, &[], gate),
            ClaimDecision::Paused
        );
    }

    #[test]
    fn open_attention_holds_dispatch_on_an_active_run() {
        let graph = TaskGraph::preflight([task("a", "src/**")]).unwrap();
        let gate = DispatchGate {
            run_state: Some(RunState::Active),
            has_open_attention: true,
        };
        assert_eq!(
            Scheduler::new(Capacity::new(2, 1)).claim(&graph, &[], gate),
            ClaimDecision::AttentionHeld
        );
    }

    #[test]
    fn attention_run_state_is_an_attention_hold_not_a_pause() {
        let graph = TaskGraph::preflight([task("a", "src/**")]).unwrap();
        let gate = DispatchGate {
            run_state: Some(RunState::Attention),
            has_open_attention: false,
        };
        assert_eq!(
            Scheduler::new(Capacity::new(2, 1)).claim(&graph, &[], gate),
            ClaimDecision::AttentionHeld
        );
    }

    #[test]
    fn missing_run_state_counts_as_paused() {
        let graph = TaskGraph::preflight([task("a", "src/**")]).unwrap();
        let gate = DispatchGate {
            run_state: None,
            has_open_attention: false,
        };
        assert_eq!(
            Scheduler::new(Capacity::new(2, 1)).claim(&graph, &[], gate),
            ClaimDecision::Paused
        );
    }

    #[test]
    fn exhausted_capacity_is_empty_not_paused() {
        let graph = TaskGraph::preflight([task("a", "src/**")]).unwrap();
        assert_eq!(
            Scheduler::new(Capacity::new(0, 1)).claim(&graph, &[], active_gate()),
            ClaimDecision::Empty
        );
    }

    #[test]
    fn claimed_ids_is_empty_for_every_hold() {
        assert!(ClaimDecision::Paused.claimed_ids().is_empty());
        assert!(ClaimDecision::AttentionHeld.claimed_ids().is_empty());
        assert!(ClaimDecision::Empty.claimed_ids().is_empty());
        assert_eq!(
            ClaimDecision::Claimed(vec![TaskId::from("a")]).claimed_ids(),
            &[TaskId::from("a")]
        );
    }
}
