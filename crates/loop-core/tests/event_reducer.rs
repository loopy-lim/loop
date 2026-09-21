use loop_core::event::{Event, EventKind, RunProjection};
use loop_core::policy::ComputeClass;
use loop_core::run::RunState;
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskId, TaskKind, TaskState, VerificationEvidence,
};

fn implementation_task() -> Task {
    Task::builder(
        TaskId::from("impl"),
        "implementation",
        TaskKind::Implementation,
    )
    .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
    .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
    .build()
    .unwrap()
}

#[test]
fn event_reducer_only_completes_a_task_after_verification_evidence() {
    let mut projection = RunProjection::default();
    let events = [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(implementation_task())),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::VerificationPassed {
                task_id: TaskId::from("impl"),
                evidence: VerificationEvidence::new([("tests", true)]),
            },
        ),
        Event::new("run-1", EventKind::RunCompleted),
    ];
    for event in &events {
        projection.apply(event).unwrap();
    }
    assert_eq!(projection.run_state, Some(RunState::Completed));
    assert_eq!(
        projection.tasks[&TaskId::from("impl")].state,
        TaskState::Done
    );
    assert!(projection.active_workers.is_empty());
}

#[test]
fn verification_failure_retries_at_the_next_compute_class() {
    let mut projection = RunProjection::default();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(implementation_task())),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::VerificationFailed {
                task_id: TaskId::from("impl"),
                reason: "tests failed".into(),
            },
        ),
    ] {
        projection.apply(&event).unwrap();
    }
    let task = &projection.tasks[&TaskId::from("impl")];
    assert_eq!(task.state, TaskState::Ready);
    assert_eq!(task.attempt, 1);
    assert_eq!(task.preferred_compute, ComputeClass::Balanced);
}

#[test]
fn exhausted_verification_moves_the_task_to_human_attention() {
    let mut task = implementation_task();
    task.max_attempts = 1;
    let mut projection = RunProjection::default();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(task)),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::VerificationFailed {
                task_id: TaskId::from("impl"),
                reason: "still failing".into(),
            },
        ),
    ] {
        projection.apply(&event).unwrap();
    }
    assert_eq!(
        projection.tasks[&TaskId::from("impl")].state,
        TaskState::Attention
    );
}
