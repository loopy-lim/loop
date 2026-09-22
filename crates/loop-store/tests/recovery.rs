use std::collections::BTreeMap;

use loop_core::attention::{Attention, AttentionKind};
use loop_core::event::{Event, EventKind};
use loop_core::policy::ComputeClass;
use loop_core::task::{CompletionCheck, CompletionContract, Task, TaskId, TaskKind, TaskState};
use loop_store::{ObservedWorkerState, RecoveredWorkerState, SqliteStore};

fn task() -> Task {
    Task::builder(
        TaskId::from("impl"),
        "implementation",
        TaskKind::Implementation,
    )
    .ownership(loop_core::task::WorkOwnership::new(
        std::iter::empty::<&str>(),
        ["src/**"],
    ))
    .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
    .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
    .build()
    .unwrap()
}

#[test]
fn migration_creates_the_durable_orchestration_entities() {
    let dir = tempfile::tempdir().unwrap();
    let store = SqliteStore::open(dir.path().join("loop.db")).unwrap();
    let names = store.table_names().unwrap();
    for required in [
        "runs",
        "tasks",
        "edges",
        "attempts",
        "workers",
        "events",
        "decisions",
        "attention",
        "artifacts",
    ] {
        assert!(names.contains(required), "missing table {required}");
    }
}

#[test]
fn partially_completed_run_survives_reopen_and_marks_missing_worker_lost() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.db");
    {
        let mut store = SqliteStore::open(&path).unwrap();
        for event in [
            Event::new("run-1", EventKind::RunCreated),
            Event::new("run-1", EventKind::TaskCreated(task())),
            Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
            Event::new(
                "run-1",
                EventKind::WorkerStarted {
                    task_id: TaskId::from("impl"),
                    worker_id: "worker-1".into(),
                },
            ),
        ] {
            store.append(&event).unwrap();
        }
    }

    let store = SqliteStore::open(&path).unwrap();
    let recovered = store
        .recover_run("run-1", &BTreeMap::<String, ObservedWorkerState>::new())
        .unwrap();
    assert_eq!(recovered.events, 4);
    assert_eq!(recovered.workers["worker-1"], RecoveredWorkerState::Lost);
    assert_eq!(
        recovered.projection.tasks[&TaskId::from("impl")].state,
        TaskState::Attention
    );
}

#[test]
fn recovery_keeps_a_confirmed_live_worker_running() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = SqliteStore::open(dir.path().join("loop.db")).unwrap();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(task())),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
    ] {
        store.append(&event).unwrap();
    }
    let recovered = store
        .recover_run(
            "run-1",
            &BTreeMap::from([("worker-1".into(), ObservedWorkerState::Running)]),
        )
        .unwrap();
    assert_eq!(recovered.workers["worker-1"], RecoveredWorkerState::Running);
    assert_eq!(
        recovered.projection.tasks[&TaskId::from("impl")].state,
        TaskState::Running
    );
}

#[test]
fn query_indexes_follow_the_validated_event_projection() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.db");
    {
        let mut exhausted = task();
        exhausted.max_attempts = 1;
        let mut store = SqliteStore::open(&path).unwrap();
        store
            .append_batch(&[
                Event::new("run-1", EventKind::RunCreated),
                Event::new("run-1", EventKind::TaskCreated(exhausted)),
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
                        reason: "failed".into(),
                    },
                ),
                Event::new(
                    "run-1",
                    EventKind::AttentionCreated(Attention::for_task(
                        "failure-impl-1",
                        AttentionKind::Failure,
                        "failed",
                        TaskId::from("impl"),
                    )),
                ),
            ])
            .unwrap();
    }
    let connection = rusqlite::Connection::open(path).unwrap();
    let task_state: String = connection
        .query_row(
            "SELECT state FROM tasks WHERE run_id = 'run-1' AND id = 'impl'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let attempt_state: String = connection
        .query_row(
            "SELECT state FROM attempts WHERE run_id = 'run-1' AND task_id = 'impl' AND attempt = 0",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(task_state, "attention");
    assert_eq!(attempt_state, "failed");
}

#[test]
fn identifiers_are_scoped_by_run_and_cache_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("scoped.db");
    let mut store = SqliteStore::open(&path).unwrap();
    for run in ["one", "two"] {
        store
            .append(&Event::new(run, EventKind::RunCreated))
            .unwrap();
        store
            .append(&Event::new(
                run,
                EventKind::AttentionCreated(Attention::new(
                    "same-id",
                    AttentionKind::Approval,
                    "confirm",
                )),
            ))
            .unwrap();
    }
    drop(store);
    let store = SqliteStore::open(&path).unwrap();
    assert_eq!(store.projection("one").unwrap().attention.len(), 1);
    assert_eq!(store.projection("two").unwrap().attention.len(), 1);
}
