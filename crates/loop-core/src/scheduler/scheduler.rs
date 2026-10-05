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

    /// Claims every dispatchable task that fits capacity and conflict rules.
    ///
    /// The gate is per-conflict, not per-world: a running decision or
    /// integration task no longer stops all dispatch. The invariants that
    /// remain are (a) serial kinds are only claimed into an empty world, so
    /// decision/integration tasks never run concurrently with anything, and
    /// (b) tasks whose read/write scopes or semantic touchpoints overlap a
    /// running or already-claimed task are never claimed. Independent,
    /// non-overlapping ready tasks run alongside a serial task.
    pub fn claim_runnable(&self, graph: &TaskGraph, running: &[TaskId]) -> Vec<TaskId> {
        self.claim_plan(graph, running).claimed
    }

    /// [`Self::claim_runnable`] with the full per-task record: what was
    /// claimed, and — for every ready task left waiting — the deterministic
    /// reason. Callers relay [`ClaimSkip::activity`] lines into task activity
    /// so a serialized world reads as waiting, not stuck.
    pub fn claim_plan(&self, graph: &TaskGraph, running: &[TaskId]) -> ClaimPlan {
        let running_tasks: Vec<_> = running.iter().filter_map(|id| graph.task(id)).collect();
        let mut plan = ClaimPlan::default();
        let mut claimed: Vec<&Task> = Vec::new();
        let mut frontier = running_tasks
            .iter()
            .filter(|task| task.preferred_compute == ComputeClass::Frontier)
            .count();
        // Set when a serial task is claimed this round: it starts alone, so
        // every other ready task waits on the serial hold.
        let mut serial_claimed = false;
        for task in graph.tasks() {
            if !matches!(task.state, TaskState::Pending | TaskState::Ready)
                || !graph.dependencies_done(task)
            {
                continue;
            }
            if claimed.len() + running.len() >= self.capacity.max_workers {
                plan.skipped.push(ClaimSkip::new(
                    task.id.clone(),
                    ClaimSkipReason::CapacityFull,
                ));
                continue;
            }
            if task.kind.is_serial() {
                if running.is_empty() && claimed.is_empty() {
                    claimed.push(task);
                    serial_claimed = true;
                } else {
                    plan.skipped.push(ClaimSkip::new(
                        task.id.clone(),
                        ClaimSkipReason::SerialHeld,
                    ));
                }
                continue;
            }
            if serial_claimed {
                plan.skipped.push(ClaimSkip::new(
                    task.id.clone(),
                    ClaimSkipReason::SerialHeld,
                ));
                continue;
            }
            if task.preferred_compute == ComputeClass::Frontier
                && frontier >= self.capacity.max_frontier_workers
            {
                plan.skipped.push(ClaimSkip::new(
                    task.id.clone(),
                    ClaimSkipReason::FrontierFull,
                ));
                continue;
            }
            if let Some(other) = running_tasks
                .iter()
                .copied()
                .chain(claimed.iter().copied())
                .find(|other| tasks_conflict(task, other))
            {
                plan.skipped.push(ClaimSkip {
                    task_id: task.id.clone(),
                    reason: ClaimSkipReason::ScopeOverlap {
                        with: other.id.clone(),
                    },
                });
                continue;
            }
            claimed.push(task);
            if task.preferred_compute == ComputeClass::Frontier {
                frontier += 1;
            }
        }
        plan.claimed = claimed.into_iter().map(|task| task.id.clone()).collect();
        plan
    }
}

/// Why a ready task was left unclaimed by one [`Scheduler::claim_plan`]
/// attempt. Reasons are deterministic and machine-readable so callers can
/// record them as task activity instead of leaving concurrency limits
/// invisible.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClaimSkipReason {
    /// A decision/integration task holds the world (running, or claimed this
    /// round); serial kinds run alone among themselves.
    SerialHeld,
    /// Read/write scope or semantic touchpoints overlap the cited task.
    ScopeOverlap { with: TaskId },
    /// The frontier lane cap is exhausted.
    FrontierFull,
    /// The worker cap is exhausted.
    CapacityFull,
}

/// One ready task the scheduler evaluated but did not claim.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimSkip {
    pub task_id: TaskId,
    pub reason: ClaimSkipReason,
}

impl ClaimSkip {
    pub const fn new(task_id: TaskId, reason: ClaimSkipReason) -> Self {
        Self { task_id, reason }
    }

    /// Stable activity-line vocabulary: `serial-held`,
    /// `scope-overlap-with <task-id>`, `frontier-full`, `capacity-full`.
    /// Callers relay this verbatim into task activity.
    pub fn activity(&self) -> String {
        match &self.reason {
            ClaimSkipReason::SerialHeld => "serial-held".to_string(),
            ClaimSkipReason::ScopeOverlap { with } => format!("scope-overlap-with {with}"),
            ClaimSkipReason::FrontierFull => "frontier-full".to_string(),
            ClaimSkipReason::CapacityFull => "capacity-full".to_string(),
        }
    }
}

/// Full per-task record of one [`Scheduler::claim_plan`] attempt.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ClaimPlan {
    /// Tasks claimed for dispatch, in graph walk order.
    pub claimed: Vec<TaskId>,
    /// Ready tasks left waiting, each with its deterministic reason.
    pub skipped: Vec<ClaimSkip>,
}

/// Physical and semantic conflict between two dispatchable tasks. An empty
/// write scope is not a universal conflict: it writes nothing the scheduler
/// can see, so only actual read/write or semantic-touchpoint overlap
/// serializes two tasks. Rejecting scope-requiring tasks with empty write
/// scopes is submission-time validation (`TaskBuilder::build` and graph
/// validation both enforce it), not a scheduler conflict rule.
fn tasks_conflict(left: &Task, right: &Task) -> bool {
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
    fn blank_scope_elements_are_inert_and_glob_leading_scopes_stay_conservative() {
        // A blank element asserts nothing, so it cannot prove overlap.
        assert!(!write_scopes_overlap(&[String::new()], &["src/**".to_string()]));
        assert!(!write_scopes_overlap(&["src/**".to_string()], &[String::new()]));
        // A glob-leading element has no provable prefix and stays
        // conservatively exclusive.
        assert!(write_scopes_overlap(&["**".to_string()], &["src/a.rs".to_string()]));
        assert!(write_scopes_overlap(&["src/**".to_string()], &["src/a.rs".to_string()]));
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
