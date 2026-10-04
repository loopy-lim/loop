use crate::graph::TaskGraph;
use crate::policy::ComputeClass;
use crate::run::RunState;
use crate::task::{SemanticAccess, Task, TaskId, TaskState};

use super::decision::{ClaimDecision, DispatchGate};
use super::{write_scopes_overlap, Capacity};

#[derive(Clone, Copy, Debug)]
pub struct Scheduler {
    capacity: Capacity,
}

impl Scheduler {
    pub const fn new(capacity: Capacity) -> Self {
        Self { capacity }
    }

    /// Decides one dispatch attempt: run-state and attention gates first, then
    /// the capacity and conflict rules of [`Self::claim_runnable`]. This is
    /// the deterministic pause/attention/empty verdict for dispatch — bridge
    /// commands relay it verbatim and must not re-derive it from projection
    /// fields.
    ///
    /// Gate order: a run that is neither active nor in its attention state is
    /// `Paused` (lifecycle is the strongest hold, including a paused run with
    /// a still-open attention); an active run or an attention-state run with
    /// an open attention is `AttentionHeld`; only an active, attention-free
    /// run reaches the capacity/conflict scheduler.
    pub fn claim(
        &self,
        graph: &TaskGraph,
        running: &[TaskId],
        gate: DispatchGate,
    ) -> ClaimDecision {
        match gate.run_state {
            Some(RunState::Active | RunState::Attention) if gate.has_open_attention => {
                return ClaimDecision::AttentionHeld;
            }
            Some(RunState::Attention) => return ClaimDecision::AttentionHeld,
            Some(RunState::Active) => {}
            _ => return ClaimDecision::Paused,
        }
        match self.claim_runnable(graph, running) {
            claimed if claimed.is_empty() => ClaimDecision::Empty,
            claimed => ClaimDecision::Claimed(claimed),
        }
    }

    pub fn claim_runnable(&self, graph: &TaskGraph, running: &[TaskId]) -> Vec<TaskId> {
        if running.len() >= self.capacity.max_workers {
            return Vec::new();
        }
        let running_tasks: Vec<_> = running.iter().filter_map(|id| graph.task(id)).collect();
        if running_tasks.iter().any(|task| task.kind.is_serial()) {
            return Vec::new();
        }
        let mut claimed: Vec<&Task> = Vec::new();
        let mut frontier = running_tasks
            .iter()
            .filter(|task| task.preferred_compute == ComputeClass::Frontier)
            .count();
        for task in graph.tasks() {
            if claimed.len() + running.len() >= self.capacity.max_workers {
                break;
            }
            if !matches!(task.state, TaskState::Pending | TaskState::Ready)
                || !graph.dependencies_done(task)
            {
                continue;
            }
            if task.kind.is_serial() {
                if running.is_empty() && claimed.is_empty() {
                    claimed.push(task);
                    break;
                }
                continue;
            }
            if task.preferred_compute == ComputeClass::Frontier
                && frontier >= self.capacity.max_frontier_workers
            {
                continue;
            }
            if running_tasks
                .iter()
                .chain(claimed.iter())
                .any(|other| tasks_conflict(task, other))
            {
                continue;
            }
            claimed.push(task);
            if task.preferred_compute == ComputeClass::Frontier {
                frontier += 1;
            }
        }
        claimed.into_iter().map(|task| task.id.clone()).collect()
    }
}

fn tasks_conflict(left: &Task, right: &Task) -> bool {
    if (left.kind.requires_explicit_write_scope() && left.ownership.write_scope.is_empty())
        || (right.kind.requires_explicit_write_scope() && right.ownership.write_scope.is_empty())
    {
        return true;
    }
    write_scopes_overlap(&left.ownership.write_scope, &right.ownership.write_scope)
        || write_scopes_overlap(&left.ownership.read_scope, &right.ownership.write_scope)
        || write_scopes_overlap(&left.ownership.write_scope, &right.ownership.read_scope)
        || semantic_touchpoints_overlap(left, right)
}

fn semantic_touchpoints_overlap(left: &Task, right: &Task) -> bool {
    let Some(left_contract) = &left.decomposition_contract else {
        return false;
    };
    let Some(right_contract) = &right.decomposition_contract else {
        return false;
    };
    left_contract.semantic_touchpoints.iter().any(|left| {
        right_contract.semantic_touchpoints.iter().any(|right| {
            left.id == right.id
                && (left.access == SemanticAccess::Modify || right.access == SemanticAccess::Modify)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{FailurePolicy, OnExhaustion};
    use crate::task::{
        Assumption, CompletionCheck, CompletionContract, CompletionCoverage, DecompositionContract,
        EvidenceLevel, SemanticAccess, SemanticConflictResolution, SemanticTouchpoint, TaskKind,
        WorkOwnership,
    };

    fn task(id: &str, write_scope: &str, touchpoint: &str) -> Task {
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
                EvidenceLevel::Unit,
            ))]))
            .decomposition_contract(DecompositionContract::new(
                ["preserve compatibility"],
                [Assumption::new("offline", "tests", "report", "release")],
                [SemanticTouchpoint::new(
                    touchpoint,
                    SemanticAccess::Modify,
                    SemanticConflictResolution::Serialize,
                )],
                [],
                FailurePolicy::new([], OnExhaustion::FailTask),
            ))
            .build()
            .unwrap()
    }

    #[test]
    fn serializes_known_physical_scope_overlap_without_attention() {
        let graph = TaskGraph::preflight([
            task("a", "src/**", "policy-a"),
            task("b", "src/a.rs", "policy-b"),
        ])
        .unwrap();

        assert_eq!(
            Scheduler::new(Capacity::new(2, 2)).claim_runnable(&graph, &[]),
            vec![TaskId::from("a")]
        );
    }

    #[test]
    fn serializes_declared_semantic_touchpoint_overlap() {
        let graph = TaskGraph::preflight([
            task("a", "src/a.rs", "shared-policy"),
            task("b", "src/b.rs", "shared-policy"),
        ])
        .unwrap();

        assert_eq!(
            Scheduler::new(Capacity::new(2, 2)).claim_runnable(&graph, &[]),
            vec![TaskId::from("a")]
        );
    }
}
