#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use loop_core::event::{
    CheckReceipt, Event, EventKind, GoalCriterion, GoalCriterionState, ProjectionError,
    RunProjection, SourceReceipt,
};
use loop_core::policy::ComputeClass;
use loop_core::run::RunState;
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskId, TaskKind, VerificationEvidence,
    WorkOwnership,
};

fn task() -> Task {
    Task::builder(TaskId::from("impl"), "implement", TaskKind::Implementation)
        .ownership(WorkOwnership::new(
            std::iter::empty::<&str>(),
            ["src/impl.rs"],
        ))
        .requirements(["behavior works"])
        .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
        .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
        .build()
        .unwrap()
}

fn receipt(exit_code: i32) -> CheckReceipt {
    receipt_with_outside_paths(exit_code, [])
}

fn receipt_with_outside_paths<'p>(
    exit_code: i32,
    outside_write_scope: impl IntoIterator<Item = &'p str>,
) -> CheckReceipt {
    CheckReceipt {
        id: "tests".into(),
        command: "cargo".into(),
        args: vec!["test".into()],
        working_directory: "/project".into(),
        exit_code,
        stdout: String::new(),
        stderr: String::new(),
        timed_out: false,
        duration_ms: 1,
        output_artifact: None,
        source: Some(SourceReceipt {
            before_fingerprint: "abc".into(),
            after_fingerprint: "abc".into(),
            observed_changed_paths: vec![],
            observed_outside_write_scope: outside_write_scope
                .into_iter()
                .map(str::to_string)
                .collect(),
        }),
    }
}

/// Drives a projection through the full task lifecycle up to verification
/// passing with the given receipt recorded, the state a run reaches when every
/// task is done and only goal closure is still in question.
fn verified_projection(receipt: CheckReceipt) -> RunProjection {
    let mut projection = RunProjection::default();
    for kind in [
        EventKind::RunCreated,
        EventKind::TaskCreated(task()),
        EventKind::GoalCriteriaDeclared(vec![GoalCriterion {
            id: "g1".into(),
            description: "behavior works".into(),
            task_id: TaskId::from("impl"),
            check_ids: vec!["tests".into()],
        }]),
        EventKind::TaskReady(TaskId::from("impl")),
        EventKind::WorkerStarted {
            task_id: TaskId::from("impl"),
            worker_id: "w".into(),
        },
        EventKind::WorkerFinished {
            task_id: TaskId::from("impl"),
            worker_id: "w".into(),
        },
        EventKind::CheckReceiptsRecorded {
            task_id: TaskId::from("impl"),
            checks: vec![receipt],
        },
        EventKind::VerificationPassed {
            task_id: TaskId::from("impl"),
            evidence: VerificationEvidence::new([("tests", true)]),
        },
    ] {
        projection.apply(&Event::new("run", kind)).unwrap();
    }
    projection
}

#[test]
fn declared_check_side_effect_writes_do_not_block_goal_closure() {
    // The task owns src/impl.rs; its declared `cargo test` check produced
    // build artifacts and a dependency cache outside the write scope.
    let mut projection = verified_projection(receipt_with_outside_paths(
        0,
        [
            "target/debug/libloop_core.rlib",
            "target/debug/deps/loop_core-9f2a1b.d",
            "node_modules/.cache/vite/chunks.json",
        ],
    ));
    assert_eq!(
        projection.goal_criteria_status()[0].state,
        GoalCriterionState::Verified
    );
    projection
        .apply(&Event::new("run", EventKind::RunCompleted))
        .unwrap();
    assert_eq!(projection.run_state, Some(RunState::Completed));
}

#[test]
fn genuine_source_edits_outside_write_scope_still_block_goal_closure() {
    let mut projection = verified_projection(receipt_with_outside_paths(0, ["docs/notes.md"]));
    assert_eq!(
        projection.goal_criteria_status()[0].state,
        GoalCriterionState::Pending
    );
    assert!(matches!(
        projection.apply(&Event::new("run", EventKind::RunCompleted)),
        Err(ProjectionError::IncompleteGoal)
    ));
}

#[test]
fn goal_requires_declared_checks_and_stable_receipts() {
    let mut projection = RunProjection::default();
    for kind in [
        EventKind::RunCreated,
        EventKind::TaskCreated(task()),
        EventKind::GoalCriteriaDeclared(vec![GoalCriterion {
            id: "g1".into(),
            description: "behavior works".into(),
            task_id: TaskId::from("impl"),
            check_ids: vec!["tests".into()],
        }]),
    ] {
        projection.apply(&Event::new("run", kind)).unwrap();
    }
    assert_eq!(
        projection.goal_criteria_status()[0].state,
        GoalCriterionState::Pending
    );
    projection
        .apply(&Event::new(
            "run",
            EventKind::TaskReady(TaskId::from("impl")),
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "w".into(),
            },
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "w".into(),
            },
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run",
            EventKind::CheckReceiptsRecorded {
                task_id: TaskId::from("impl"),
                checks: vec![receipt(0)],
            },
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run",
            EventKind::VerificationPassed {
                task_id: TaskId::from("impl"),
                evidence: VerificationEvidence::new([("tests", true)]),
            },
        ))
        .unwrap();
    assert_eq!(
        projection.goal_criteria_status()[0].state,
        GoalCriterionState::Verified
    );
    projection
        .apply(&Event::new("run", EventKind::RunCompleted))
        .unwrap();
}

#[test]
fn goal_rejects_missing_check_mapping_and_cannot_complete_without_receipt() {
    let mut projection = RunProjection::default();
    projection
        .apply(&Event::new("run", EventKind::RunCreated))
        .unwrap();
    projection
        .apply(&Event::new("run", EventKind::TaskCreated(task())))
        .unwrap();
    assert!(projection
        .apply(&Event::new(
            "run",
            EventKind::GoalCriteriaDeclared(vec![GoalCriterion {
                id: "g1".into(),
                description: "behavior works".into(),
                task_id: TaskId::from("impl"),
                check_ids: vec!["missing".into()]
            }])
        ))
        .is_err());
    assert!(projection.goal_criteria.is_empty());
    projection
        .apply(&Event::new(
            "run",
            EventKind::GoalCriteriaDeclared(vec![GoalCriterion {
                id: "g1".into(),
                description: "behavior works".into(),
                task_id: TaskId::from("impl"),
                check_ids: vec!["tests".into()],
            }]),
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run",
            EventKind::TaskReady(TaskId::from("impl")),
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "w".into(),
            },
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "w".into(),
            },
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run",
            EventKind::VerificationPassed {
                task_id: TaskId::from("impl"),
                evidence: VerificationEvidence::new([("tests", true)]),
            },
        ))
        .unwrap();
    assert_eq!(
        projection.goal_criteria_status()[0].state,
        GoalCriterionState::Pending
    );
    assert!(projection
        .apply(&Event::new("run", EventKind::RunCompleted))
        .is_err());
}
