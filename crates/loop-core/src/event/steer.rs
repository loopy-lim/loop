//! Promotion of a mid-run user steer into the durable goal contract.
//!
//! A correction delivered to a worker is guidance, not completion evidence
//! (see `docs/decisions/2026-09-28-goal-closure-and-routing.md`). When the
//! user adds a requirement while a run is in progress, the requirement must
//! enter the goal graph as a new criterion bound to a new dependent task, so
//! the existing `RunCompleted` gate (`ProjectionError::IncompleteGoal`)
//! enforces it. This module assembles the canonical event batch for that
//! promotion; the store's reducer remains the authority and re-validates
//! every event on apply.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::event::{Event, EventKind, GoalCriterion};
use crate::task::Task;

#[derive(Clone, Debug, Deserialize, Eq, Error, PartialEq, Serialize)]
pub enum SteerPromotionError {
    #[error("steer message must contain 1 to 16000 bytes")]
    EmptyMessage,
    #[error("steer promotion requires a dependent task: {0} has no dependencies")]
    DetachedTask(String),
    #[error("steer promotion requires at least one goal criterion")]
    MissingCriteria,
    #[error("criterion {criterion} must be bound to the promoted task {task}")]
    CriterionTaskMismatch { criterion: String, task: String },
    #[error("criterion {0} must name at least one completion check")]
    CriterionWithoutChecks(String),
    #[error("criterion {0} duplicates a criterion id")]
    DuplicateCriterion(String),
    #[error("criterion description must be a declared requirement of the promoted task")]
    UnmappedRequirement,
    #[error("criterion references a check outside the task completion contract: {0}")]
    UnknownCheck(String),
}

/// Byte bounds shared with the bridge guidance contract: a promoted steer is
/// guidance plus a goal entry, so it obeys the same message size policy.
pub const STEER_MESSAGE_MAX_BYTES: usize = 16_000;

/// Assemble the promotion batch: the new task, the steer message recorded as
/// guidance scoped to that task, and the criteria that bind the requirement
/// into the completion gate. Event order matters — the reducer validates
/// guidance and criteria against the task created earlier in the same batch.
pub fn steer_promotion_events(
    run_id: &str,
    message: &str,
    task: Task,
    criteria: Vec<GoalCriterion>,
) -> Result<Vec<Event>, SteerPromotionError> {
    if message.trim().is_empty() || message.len() > STEER_MESSAGE_MAX_BYTES {
        return Err(SteerPromotionError::EmptyMessage);
    }
    if task.dependencies.is_empty() {
        return Err(SteerPromotionError::DetachedTask(task.id.to_string()));
    }
    if criteria.is_empty() {
        return Err(SteerPromotionError::MissingCriteria);
    }
    let mut seen_ids = std::collections::BTreeSet::new();
    for criterion in &criteria {
        if !seen_ids.insert(criterion.id.clone()) {
            return Err(SteerPromotionError::DuplicateCriterion(criterion.id.clone()));
        }
        if criterion.task_id != task.id {
            return Err(SteerPromotionError::CriterionTaskMismatch {
                criterion: criterion.id.clone(),
                task: task.id.to_string(),
            });
        }
        if criterion.description.trim().is_empty()
            || !task.requirements.contains(&criterion.description)
        {
            return Err(SteerPromotionError::UnmappedRequirement);
        }
        if criterion.check_ids.is_empty() {
            return Err(SteerPromotionError::CriterionWithoutChecks(
                criterion.id.clone(),
            ));
        }
        for check_id in &criterion.check_ids {
            if !task
                .completion_contract
                .checks
                .iter()
                .any(|check| &check.id == check_id)
            {
                return Err(SteerPromotionError::UnknownCheck(check_id.clone()));
            }
        }
    }
    let task_id = task.id.clone();
    Ok(vec![
        Event::new(run_id, EventKind::TaskCreated(task)),
        Event::new(
            run_id,
            EventKind::GuidanceAdded {
                task_id: Some(task_id.clone()),
                message: message.to_string(),
            },
        ),
        Event::new(run_id, EventKind::GoalCriteriaDeclared(criteria)),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::{
        CheckReceipt, GoalCriterionState, ProjectionError, RunProjection, SourceReceipt,
    };
    use crate::policy::ComputeClass;
    use crate::run::RunState;
    use crate::task::{CompletionCheck, CompletionContract, TaskId, TaskKind, VerificationEvidence, WorkOwnership};

    fn correction_task() -> Task {
        Task::builder(TaskId::from("correction"), "apply correction", TaskKind::Implementation)
            .dependencies([TaskId::from("original")])
            .ownership(WorkOwnership::new(
                std::iter::empty::<&str>(),
                ["src/correction.rs"],
            ))
            .requirements(["corrected behavior works"])
            .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
            .completion_contract(CompletionContract::new([CompletionCheck::new("unit")]))
            .build()
            .unwrap()
    }

    fn criterion() -> GoalCriterion {
        GoalCriterion {
            id: "steer-criterion".into(),
            description: "corrected behavior works".into(),
            task_id: TaskId::from("correction"),
            check_ids: vec!["unit".into()],
        }
    }

    fn stable_receipt(check_id: &str) -> CheckReceipt {
        CheckReceipt {
            id: check_id.into(),
            command: "cargo".into(),
            args: vec!["test".into()],
            working_directory: "/project".into(),
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
            duration_ms: 1,
            output_artifact: None,
            source: Some(SourceReceipt {
                before_fingerprint: "abc".into(),
                after_fingerprint: "abc".into(),
                observed_changed_paths: vec![],
                observed_outside_write_scope: vec![],
            }),
        }
    }

    /// Drives one task from pending through verification, optionally with a
    /// stable passing receipt, to isolate the criterion gate from the
    /// task-completeness gate.
    fn verify_task(projection: &mut RunProjection, task_id: &str, check_id: &str, with_receipt: bool) {
        let task_id = TaskId::from(task_id);
        let mut kinds = vec![
            EventKind::TaskReady(task_id.clone()),
            EventKind::WorkerStarted {
                task_id: task_id.clone(),
                worker_id: format!("worker-{task_id}"),
            },
            EventKind::WorkerFinished {
                task_id: task_id.clone(),
                worker_id: format!("worker-{task_id}"),
            },
        ];
        if with_receipt {
            kinds.push(EventKind::CheckReceiptsRecorded {
                task_id: task_id.clone(),
                checks: vec![stable_receipt(check_id)],
            });
        }
        kinds.push(EventKind::VerificationPassed {
            task_id,
            evidence: VerificationEvidence::new([(check_id, true)]),
        });
        for kind in kinds {
            projection.apply(&Event::new("run", kind)).unwrap();
        }
    }

    #[test]
    fn steer_promotion_binds_message_task_and_criterion() {
        let events =
            steer_promotion_events("run", "also cover the corrected behavior", correction_task(), vec![criterion()])
                .unwrap();
        assert_eq!(events.len(), 3);
        assert!(matches!(
            &events[0].kind,
            EventKind::TaskCreated(task) if task.id == TaskId::from("correction")
                && task.dependencies == vec![TaskId::from("original")]
        ));
        assert!(matches!(
            &events[1].kind,
            EventKind::GuidanceAdded { task_id: Some(task_id), message }
                if *task_id == TaskId::from("correction")
                    && message == "also cover the corrected behavior"
        ));
        assert!(matches!(
            &events[2].kind,
            EventKind::GoalCriteriaDeclared(criteria) if criteria.len() == 1
                && criteria[0].task_id == TaskId::from("correction")
        ));
    }

    #[test]
    fn steer_promotion_requires_dependency_and_bound_checks() {
        let detached = Task::builder(TaskId::from("correction"), "apply correction", TaskKind::Implementation)
            .dependencies([TaskId::from("original")])
            .ownership(WorkOwnership::new(
                std::iter::empty::<&str>(),
                ["src/correction.rs"],
            ))
            .requirements(["corrected behavior works"])
            .completion_contract(CompletionContract::new([CompletionCheck::new("unit")]))
            .build()
            .unwrap();
        let detached = Task {
            dependencies: vec![],
            ..detached
        };
        assert_eq!(
            steer_promotion_events("run", "message", detached, vec![criterion()]).unwrap_err(),
            SteerPromotionError::DetachedTask("correction".into())
        );
        assert_eq!(
            steer_promotion_events("run", "message", correction_task(), vec![]).unwrap_err(),
            SteerPromotionError::MissingCriteria
        );
        assert_eq!(
            steer_promotion_events("run", "  ", correction_task(), vec![criterion()]).unwrap_err(),
            SteerPromotionError::EmptyMessage
        );
        let wrong_task = GoalCriterion {
            task_id: TaskId::from("original"),
            ..criterion()
        };
        assert_eq!(
            steer_promotion_events("run", "message", correction_task(), vec![wrong_task]).unwrap_err(),
            SteerPromotionError::CriterionTaskMismatch {
                criterion: "steer-criterion".into(),
                task: "correction".into()
            }
        );
        let unknown_check = GoalCriterion {
            check_ids: vec!["missing".into()],
            ..criterion()
        };
        assert_eq!(
            steer_promotion_events("run", "message", correction_task(), vec![unknown_check]).unwrap_err(),
            SteerPromotionError::UnknownCheck("missing".into())
        );
        let unmapped = GoalCriterion {
            description: "undeclared requirement".into(),
            ..criterion()
        };
        assert_eq!(
            steer_promotion_events("run", "message", correction_task(), vec![unmapped]).unwrap_err(),
            SteerPromotionError::UnmappedRequirement
        );
    }

    #[test]
    fn steer_criterion_blocks_run_completion_until_verified() {
        let original = Task::builder(TaskId::from("original"), "original", TaskKind::Implementation)
            .ownership(WorkOwnership::new(
                std::iter::empty::<&str>(),
                ["src/original.rs"],
            ))
            .requirements(["behavior works"])
            .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
            .completion_contract(CompletionContract::new([CompletionCheck::new("unit")]))
            .build()
            .unwrap();
        let mut projection = RunProjection::default();
        projection.apply(&Event::new("run", EventKind::RunCreated)).unwrap();
        projection
            .apply(&Event::new("run", EventKind::TaskCreated(original)))
            .unwrap();
        projection
            .apply(&Event::new(
                "run",
                EventKind::GoalCriteriaDeclared(vec![GoalCriterion {
                    id: "original-criterion".into(),
                    description: "behavior works".into(),
                    task_id: TaskId::from("original"),
                    check_ids: vec!["unit".into()],
                }]),
            ))
            .unwrap();

        // Mid-run steer: the promotion batch applies through the same reducer
        // policies the store uses, on a run that is already in progress.
        for event in steer_promotion_events(
            "run",
            "also cover the corrected behavior",
            correction_task(),
            vec![criterion()],
        )
        .unwrap()
        {
            projection.apply(&event).unwrap();
        }
        assert_eq!(projection.goal_criteria.len(), 2);
        assert_eq!(
            projection
                .goal_criteria_status()
                .iter()
                .filter(|item| item.state == GoalCriterionState::Pending)
                .count(),
            2
        );

        // Every task finishes, but the steer criterion has no receipts yet:
        // the existing IncompleteGoal policy must refuse completion even
        // though the task-completeness gate alone would pass.
        verify_task(&mut projection, "original", "unit", true);
        verify_task(&mut projection, "correction", "unit", false);
        assert_eq!(projection.run_state, Some(RunState::Active));
        assert!(matches!(
            projection.apply(&Event::new("run", EventKind::RunCompleted)),
            Err(ProjectionError::IncompleteGoal)
        ));

        // Once the steer-added criterion verifies against its declared check,
        // the same gate accepts completion.
        projection
            .apply(&Event::new(
                "run",
                EventKind::CheckReceiptsRecorded {
                    task_id: TaskId::from("correction"),
                    checks: vec![stable_receipt("unit")],
                },
            ))
            .unwrap();
        projection
            .apply(&Event::new("run", EventKind::RunCompleted))
            .unwrap();
        assert_eq!(projection.run_state, Some(RunState::Completed));
    }
}
