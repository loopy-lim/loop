//! Execution-side commands (prepare/configure/steer/lease), decomposed into
//! command families and re-exported from here so the public API — command
//! names and wire types — is unchanged:
//!
//! - [`setup`] — run/goal preparation, goal criteria, preflight, configure
//! - [`context`] — run plan and per-task worker context, receipts, records
//! - [`steer`] — mid-run guidance and steer promotion
//! - [`lease`] — execution leases, reconciliation, recycling, run listing

mod context;
mod lease;
mod setup;
mod steer;

pub use context::*;
pub use lease::*;
pub use setup::*;
pub use steer::*;

use crate::commands::{
    AssumptionInput, CompletionCheckInput, CompletionCoverageInput, DecompositionContractOutput,
    DependencyConsumptionInput, SemanticTouchpointInput, TaskSpecInput,
};
use loop_core::task::Task;

pub(crate) fn register_execution(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    lease::register_lease(steer::register_steer(context::register_run_context(
        setup::register_run_setup(builder),
    )))
}

pub(crate) fn register_preflight(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    setup::register_preflight(builder)
}

fn decomposition_contract(task: &Task) -> Option<DecompositionContractOutput> {
    let contract = task.decomposition_contract.as_ref()?;
    Some(DecompositionContractOutput {
        defaults: contract.defaults.clone(),
        assumptions: contract
            .assumptions
            .iter()
            .map(|assumption| AssumptionInput {
                assumption: assumption.assumption.clone(),
                evidence: assumption.evidence.clone(),
                if_false: assumption.if_false.clone(),
                revisit: assumption.revisit.clone(),
            })
            .collect(),
        semantic_touchpoints: contract
            .semantic_touchpoints
            .iter()
            .map(|touchpoint| SemanticTouchpointInput {
                id: touchpoint.id.clone(),
                access: touchpoint.access,
                conflict_resolution: touchpoint.conflict_resolution,
            })
            .collect(),
        consumes: contract
            .consumes
            .iter()
            .map(|consumption| DependencyConsumptionInput {
                dependency: consumption.dependency.to_string(),
                decisions: consumption.decisions.clone(),
                artifacts: consumption.artifacts.clone(),
                checks: consumption.checks.clone(),
                risks: consumption.risks.clone(),
            })
            .collect(),
        completion_coverage: task
            .completion_contract
            .checks
            .iter()
            .filter_map(|check| {
                let coverage = check.coverage.as_ref()?;
                Some(CompletionCoverageInput {
                    check_id: check.id.clone(),
                    requirements: coverage.requirements.clone(),
                    artifacts: coverage.artifacts.clone(),
                    semantics: coverage.semantics.clone(),
                    evidence_level: coverage.evidence_level,
                })
            })
            .collect(),
        failure_policy: contract.failure_policy.clone(),
    })
}

pub(crate) fn task_spec(task: &Task) -> TaskSpecInput {
    TaskSpecInput {
        id: task.id.to_string(),
        title: task.title.clone(),
        kind: task.kind,
        dependencies: task.dependencies.iter().map(ToString::to_string).collect(),
        read_scope: task.ownership.read_scope.clone(),
        write_scope: task.ownership.write_scope.clone(),
        requirements: task.requirements.clone(),
        // persona는 loop-core Task에 내구 메타데이터가 생기기 전까지 에코 시 None이다
        // (docs/decisions/2026-09-22-worker-persona-contract.md D2 후속 작업).
        persona: None,
        completion_checks: task
            .completion_contract
            .checks
            .iter()
            .map(|check| CompletionCheckInput {
                id: check.id.clone(),
                command: check.command.clone(),
                args: check.args.clone(),
                working_directory: check.working_directory.clone(),
                timeout_ms: check.timeout_ms,
            })
            .collect(),
        preferred_compute: task.preferred_compute,
        minimum_compute: task.minimum_compute,
        maximum_compute: task.maximum_compute,
        routing: Some(task.routing),
        max_attempts: task.max_attempts,
    }
}

#[cfg(test)]
mod preflight_bridge_tests {
    use super::*;
    use crate::commands::RunInput;
    use crate::{
        AssumptionInput, CompletionCoverageInput, DependencyConsumptionInput,
        PreflightTaskSpecInput, SemanticTouchpointInput,
    };
    use loop_core::policy::{ComputeClass, FailurePolicy, OnExhaustion};
    use loop_core::task::{EvidenceLevel, SemanticAccess, SemanticConflictResolution, TaskKind};

    fn task(id: &str) -> TaskSpecInput {
        TaskSpecInput {
            id: id.into(),
            title: id.into(),
            kind: TaskKind::Implementation,
            dependencies: vec![],
            read_scope: vec![],
            write_scope: vec![format!("src/{id}.rs")],
            requirements: vec!["behavior".into()],
            persona: None,
            completion_checks: vec![CompletionCheckInput {
                id: "unit".into(),
                command: "cargo".into(),
                args: vec!["test".into()],
                working_directory: None,
                timeout_ms: 1_000,
            }],
            preferred_compute: ComputeClass::Fast,
            minimum_compute: ComputeClass::Tiny,
            maximum_compute: ComputeClass::Strong,
            routing: None,
            max_attempts: 2,
        }
    }

    fn preflight_task(id: &str) -> PreflightTaskSpecInput {
        PreflightTaskSpecInput {
            task: task(id),
            defaults: vec!["preserve compatibility".into()],
            assumptions: vec![AssumptionInput {
                assumption: "tests are offline".into(),
                evidence: "repository suite".into(),
                if_false: "record missing live evidence".into(),
                revisit: "before release".into(),
            }],
            semantic_touchpoints: vec![SemanticTouchpointInput {
                id: "policy".into(),
                access: SemanticAccess::Modify,
                conflict_resolution: SemanticConflictResolution::Serialize,
            }],
            consumes: Vec::<DependencyConsumptionInput>::new(),
            completion_coverage: vec![CompletionCoverageInput {
                check_id: "unit".into(),
                requirements: vec!["behavior".into()],
                artifacts: vec![format!("src/{id}.rs")],
                semantics: vec!["behavior is preserved".into()],
                evidence_level: EvidenceLevel::Unit,
            }],
            failure_policy: FailurePolicy::new([], OnExhaustion::FailTask),
        }
    }

    #[test]
    fn tracked_prepare_rejects_unmapped_goal_without_writing_run() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("goal-invalid.db").display().to_string();
        let result = prepare_goal_run(PrepareGoalRunInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            intent: "verify behavior".into(),
            working_directory: "/project".into(),
            tasks: vec![task("implementation")],
            criteria: vec![GoalCriterionInput {
                id: "goal".into(),
                description: "behavior".into(),
                task_id: "implementation".into(),
                check_ids: vec!["missing".into()],
            }],
        });
        assert!(result.is_err());
        assert!(
            crate::commands::get_snapshot(RunInput {
                database_path,
                run_id: "run".into()
            })
            .is_err()
        );
    }

    #[test]
    fn tracked_prepare_persists_goal_status_and_rejects_duplicate_correction() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("goal-valid.db").display().to_string();
        let criterion = GoalCriterionInput {
            id: "goal".into(),
            description: "behavior".into(),
            task_id: "implementation".into(),
            check_ids: vec!["unit".into()],
        };
        prepare_goal_run(PrepareGoalRunInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            intent: "verify behavior".into(),
            working_directory: "/project".into(),
            tasks: vec![task("implementation")],
            criteria: vec![criterion],
        })
        .unwrap();
        let snapshot = crate::commands::get_snapshot(RunInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
        })
        .unwrap();
        assert_eq!(snapshot.goal_criteria.len(), 1);
        assert_eq!(
            snapshot.goal_criteria[0].state,
            loop_core::event::GoalCriterionState::Pending
        );
        let duplicate = append_goal_criteria(AppendGoalCriteriaInput {
            database_path,
            run_id: "run".into(),
            criteria: vec![GoalCriterionInput {
                id: "goal".into(),
                description: "repeat".into(),
                task_id: "implementation".into(),
                check_ids: vec!["unit".into()],
            }],
        });
        assert!(duplicate.is_err());
    }

    #[test]
    fn corrected_goal_adds_task_and_criterion_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("goal-correction.db").display().to_string();
        prepare_goal_run(PrepareGoalRunInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            intent: "behavior".into(),
            working_directory: "/project".into(),
            tasks: vec![task("original")],
            criteria: vec![GoalCriterionInput {
                id: "original".into(),
                description: "behavior".into(),
                task_id: "original".into(),
                check_ids: vec!["unit".into()],
            }],
        })
        .unwrap();
        let invalid = add_goal_task(AddGoalTaskInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            task: task("correction"),
            criteria: vec![GoalCriterionInput {
                id: "correction".into(),
                description: "behavior".into(),
                task_id: "correction".into(),
                check_ids: vec!["missing".into()],
            }],
        });
        assert!(invalid.is_err());
        let snapshot = crate::commands::get_snapshot(RunInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
        })
        .unwrap();
        assert_eq!(snapshot.tasks.len(), 1);
        assert_eq!(snapshot.goal_criteria.len(), 1);
        add_goal_task(AddGoalTaskInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            task: task("correction"),
            criteria: vec![GoalCriterionInput {
                id: "correction".into(),
                description: "behavior".into(),
                task_id: "correction".into(),
                check_ids: vec!["unit".into()],
            }],
        })
        .unwrap();
        let snapshot = crate::commands::get_snapshot(RunInput {
            database_path,
            run_id: "run".into(),
        })
        .unwrap();
        assert_eq!(snapshot.tasks.len(), 2);
        assert_eq!(snapshot.goal_criteria.len(), 2);
    }

    #[test]
    fn prepare_run_preflight_rejects_weak_contract_before_persisting() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("preflight.db").display().to_string();
        let mut weak = preflight_task("weak");
        weak.defaults.clear();

        let error = prepare_run_preflight(PrepareRunPreflightInput {
            database_path,
            run_id: "run".into(),
            intent: "intent".into(),
            working_directory: "/project".into(),
            tasks: vec![weak],
        })
        .unwrap_err();

        assert_eq!(error.code(), "preflight_failed");
    }

    #[test]
    fn prepare_run_preflight_persists_contract_for_worker_context() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir
            .path()
            .join("preflight-context.db")
            .display()
            .to_string();
        prepare_run_preflight(PrepareRunPreflightInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            intent: "intent".into(),
            working_directory: "/project".into(),
            tasks: vec![preflight_task("implementation")],
        })
        .unwrap();

        let context = get_task_context(TaskContextInput {
            database_path,
            run_id: "run".into(),
            task_id: "implementation".into(),
        })
        .unwrap();
        let contract = context.decomposition_contract.unwrap();

        assert_eq!(contract.defaults, vec!["preserve compatibility"]);
        assert_eq!(contract.completion_coverage[0].check_id, "unit");
        assert_eq!(
            contract.failure_policy.on_unbudgeted_failure,
            OnExhaustion::FailTask
        );
    }
}

#[cfg(test)]
mod steer_promotion_bridge_tests {
    use super::*;
    use crate::{
        CheckResultInput, CompletionCheckInput, RecordCheckReceiptsInput, RunInput,
        UpdateTaskInput, VerificationInput, WorkerInput, WorkerResultInput,
    };
    use loop_core::event::{CheckReceipt, SourceReceipt};
    use loop_core::policy::ComputeClass;
    use loop_core::run::RunState;
    use loop_core::task::{TaskKind, TaskState};
    use loop_store::SqliteStore;

    const RUN_ID: &str = "steer-run";

    fn task(id: &str, dependencies: &[&str]) -> TaskSpecInput {
        TaskSpecInput {
            id: id.into(),
            title: id.into(),
            kind: TaskKind::Implementation,
            dependencies: dependencies.iter().map(|id| (*id).to_string()).collect(),
            read_scope: vec![],
            write_scope: vec![format!("src/{id}.rs")],
            requirements: vec!["behavior".into()],
            persona: None,
            completion_checks: vec![CompletionCheckInput {
                id: "unit".into(),
                command: "cargo".into(),
                args: vec!["test".into()],
                working_directory: None,
                timeout_ms: 1_000,
            }],
            preferred_compute: ComputeClass::Fast,
            minimum_compute: ComputeClass::Tiny,
            maximum_compute: ComputeClass::Strong,
            routing: None,
            max_attempts: 2,
        }
    }

    fn criterion(id: &str) -> GoalCriterionInput {
        GoalCriterionInput {
            id: id.into(),
            description: "behavior".into(),
            task_id: id.into(),
            check_ids: vec!["unit".into()],
        }
    }

    fn promotion_input(database_path: &str, id: &str) -> PromoteSteerInput {
        PromoteSteerInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            message: "user correction: also cover the corrected behavior".into(),
            task: task(id, &["original"]),
            criteria: vec![criterion(id)],
        }
    }

    fn prepared_run(database_path: &str) {
        prepare_goal_run(PrepareGoalRunInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            intent: "behavior".into(),
            working_directory: "/project".into(),
            tasks: vec![task("original", &[])],
            criteria: vec![criterion("original")],
        })
        .unwrap();
    }

    fn receipt(check_id: &str) -> CheckReceipt {
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

    fn start_task(database_path: &str, task_id: &str) {
        crate::update_task(UpdateTaskInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            task_id: task_id.into(),
            state: TaskState::Ready,
        })
        .unwrap();
        crate::record_worker_started(WorkerInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            task_id: task_id.into(),
            worker_id: format!("worker-{task_id}"),
            execution_owner: None,
            state: None,
        })
        .unwrap();
    }

    fn verify_task(database_path: &str, task_id: &str, with_receipts: bool) {
        crate::record_worker_result(WorkerResultInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            task_id: task_id.into(),
            worker_id: format!("worker-{task_id}"),
            success: true,
            summary: "done".into(),
            execution_owner: None,
            state: None,
        })
        .unwrap();
        if with_receipts {
            crate::record_check_receipts(RecordCheckReceiptsInput {
                database_path: database_path.into(),
                run_id: RUN_ID.into(),
                task_id: task_id.into(),
                checks: vec![receipt("unit")],
                execution_owner: None,
            })
            .unwrap();
        }
        crate::record_verification(VerificationInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            task_id: task_id.into(),
            passed: true,
            checks: vec![CheckResultInput {
                id: "unit".into(),
                passed: true,
            }],
            reason: "focused suite passed".into(),
            execution_owner: None,
        })
        .unwrap();
    }

    fn snapshot(database_path: &str) -> crate::SnapshotOutput {
        crate::get_snapshot(RunInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
        })
        .unwrap()
    }

    #[test]
    fn steer_promotion_binds_criterion_to_new_dependent_task() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("steer-bind.db").display().to_string();
        prepared_run(&database_path);

        // A steer task referencing a task outside the run must not be
        // partially written: no task, no criterion, no guidance.
        let unknown = promote_steer(PromoteSteerInput {
            task: task("correction", &["ghost"]),
            ..promotion_input(&database_path, "correction")
        });
        assert_eq!(unknown.unwrap_err().code(), "unknown_dependency");
        let before = snapshot(&database_path);
        assert_eq!(before.tasks.len(), 1);
        assert_eq!(before.goal_criteria.len(), 1);
        assert!(before.guidance.is_empty());

        let output = promote_steer(promotion_input(&database_path, "correction")).unwrap();
        assert!(output.accepted);
        assert_eq!(output.task_id, "correction");
        assert_eq!(output.criterion_ids, vec!["correction"]);
        assert!(output.summary.contains("correction"));
        assert!(!output.evidence_tests.is_empty());

        let after = snapshot(&database_path);
        assert_eq!(after.tasks.len(), 2);
        let correction = after
            .tasks
            .iter()
            .find(|task| task.id == "correction")
            .unwrap();
        assert_eq!(correction.dependencies, vec!["original".to_string()]);
        assert_eq!(correction.blocked_by, vec!["original".to_string()]);
        assert_eq!(after.goal_criteria.len(), 2);
        assert!(
            after
                .goal_criteria
                .iter()
                .all(|item| item.state == loop_core::event::GoalCriterionState::Pending)
        );
        assert_eq!(after.guidance.len(), 1);
        assert!(after.guidance[0].contains("corrected behavior"));
    }

    #[test]
    fn unverified_steer_criterion_blocks_run_completion() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("steer-gate.db").display().to_string();
        prepared_run(&database_path);
        start_task(&database_path, "original");
        promote_steer(promotion_input(&database_path, "correction")).unwrap();

        // The original work verifies with stable receipts, but the promoted
        // criterion is still pending: the run must stay open.
        verify_task(&database_path, "original", true);
        let store = SqliteStore::open(&database_path).unwrap();
        assert_eq!(
            store.projection(RUN_ID).unwrap().run_state,
            Some(RunState::Active)
        );

        // The promoted task finishing without recorded check receipts
        // isolates the goal gate from the task-completeness gate: every task
        // is done, yet the unverified steer criterion must still refuse
        // completion with the existing IncompleteGoal policy.
        start_task(&database_path, "correction");
        verify_task(&database_path, "correction", false);
        let mut store = SqliteStore::open(&database_path).unwrap();
        assert_eq!(
            store.projection(RUN_ID).unwrap().run_state,
            Some(RunState::Active)
        );
        assert!(matches!(
            store.append(&loop_core::event::Event::new(
                RUN_ID,
                loop_core::event::EventKind::RunCompleted
            )),
            Err(loop_store::StoreError::Projection(
                loop_core::event::ProjectionError::IncompleteGoal
            ))
        ));

        // Once the steer-added criterion verifies against its declared
        // check, the same gate accepts completion.
        crate::record_check_receipts(RecordCheckReceiptsInput {
            database_path: database_path.clone(),
            run_id: RUN_ID.into(),
            task_id: "correction".into(),
            checks: vec![receipt("unit")],
            execution_owner: None,
        })
        .unwrap();
        let mut store = SqliteStore::open(&database_path).unwrap();
        store
            .append(&loop_core::event::Event::new(
                RUN_ID,
                loop_core::event::EventKind::RunCompleted,
            ))
            .unwrap();
        let after = snapshot(&database_path);
        assert_eq!(after.state, RunState::Completed);
        assert!(
            after
                .goal_criteria
                .iter()
                .all(|item| item.state == loop_core::event::GoalCriterionState::Verified)
        );
    }
}
