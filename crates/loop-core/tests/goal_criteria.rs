use loop_core::event::{
    CheckReceipt, Event, EventKind, GoalCriterion, GoalCriterionState, RunProjection, SourceReceipt,
};
use loop_core::policy::ComputeClass;
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
            observed_outside_write_scope: vec![],
        }),
    }
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
