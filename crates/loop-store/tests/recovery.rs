#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::collections::BTreeMap;

use loop_core::attention::{Attention, AttentionKind};
use loop_core::event::{Event, EventKind};
use loop_core::policy::ComputeClass;
use loop_core::task::{CompletionCheck, CompletionContract, Task, TaskId, TaskKind, TaskState, VerificationEvidence};
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
fn append_task_validates_current_graph_and_run_state_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = SqliteStore::open(dir.path().join("loop.db")).unwrap();
    store.append(&Event::new("run-1", EventKind::RunCreated)).unwrap();
    let mut missing = task();
    missing.dependencies = vec![TaskId::from("unknown")];
    assert!(store.append_task(&Event::new("run-1", EventKind::TaskCreated(missing))).is_err());
    assert!(store.projection("run-1").unwrap().tasks.is_empty());

    let mut unchecked = task();
    unchecked.completion_contract = CompletionContract::default();
    assert!(store.append_task(&Event::new("run-1", EventKind::TaskCreated(unchecked))).is_err());
    assert!(store.projection("run-1").unwrap().tasks.is_empty());

    store.append_task(&Event::new("run-1", EventKind::TaskCreated(task()))).unwrap();
    assert_eq!(store.projection("run-1").unwrap().tasks.len(), 1);
    store.append(&Event::new("run-1", EventKind::RunCancellationRequested)).unwrap();
    assert!(store.append_task(&Event::new("run-1", EventKind::TaskCreated({ let mut next = task(); next.id = TaskId::from("late"); next }))).is_err());
    assert_eq!(store.projection("run-1").unwrap().tasks.len(), 1);
}

#[test]
fn verification_completion_and_task_insertion_serialize_in_either_order() {
    for add_first in [true, false] {
        let dir = tempfile::tempdir().unwrap();
        let mut store = SqliteStore::open(dir.path().join("loop.db")).unwrap();
        let run = "race";
        store.append_batch(&[
            Event::new(run, EventKind::RunCreated),
            Event::new(run, EventKind::TaskCreated(task())),
            Event::new(run, EventKind::TaskReady(TaskId::from("impl"))),
            Event::new(run, EventKind::WorkerStarted { task_id: TaskId::from("impl"), worker_id: "w".into() }),
            Event::new(run, EventKind::WorkerFinished { task_id: TaskId::from("impl"), worker_id: "w".into() }),
        ]).unwrap();
        let mut late = task();
        late.id = TaskId::from("late");
        late.dependencies = vec![TaskId::from("impl")];
        let insertion = Event::new(run, EventKind::TaskCreated(late));
        let verification = Event::new(run, EventKind::VerificationPassed { task_id: TaskId::from("impl"), evidence: VerificationEvidence::new([("tests", true)]) });
        if add_first { store.append_task(&insertion).unwrap(); }
        store.append_verification_owned(&verification, None).unwrap();
        if add_first {
            assert_eq!(store.projection(run).unwrap().run_state, Some(loop_core::run::RunState::Active));
            assert_eq!(store.projection(run).unwrap().tasks[&TaskId::from("late")].state, TaskState::Pending);
        } else {
            assert_eq!(store.projection(run).unwrap().run_state, Some(loop_core::run::RunState::Completed));
            assert!(store.append_task(&insertion).is_err());
        }
    }
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
fn reconciled_attempt_row_is_cancelled_then_reused_on_redispatch() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.db");
    let setup = [
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
    ];
    {
        let mut store = SqliteStore::open(&path).unwrap();
        store.append_batch(&setup).unwrap();
    }

    // The worker is orphaned and an operator reconciles the execution. The
    // abandoned attempt must be marked cancelled in the queryable index while
    // the task returns to ready.
    {
        let mut store = SqliteStore::open(&path).unwrap();
        store
            .append(&Event::new(
                "run-1",
                EventKind::TaskExecutionReconciled {
                    task_id: TaskId::from("impl"),
                },
            ))
            .unwrap();
    }
    {
        let connection = rusqlite::Connection::open(&path).unwrap();
        let attempt_state: String = connection
            .query_row(
                "SELECT state FROM attempts WHERE run_id = 'run-1' AND task_id = 'impl' AND attempt = 0",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(attempt_state, "cancelled");
        let worker_state: String = connection
            .query_row(
                "SELECT state FROM workers WHERE run_id = 'run-1' AND id = 'worker-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(worker_state, "cancelled");
    }

    // Redispatching the same attempt must reuse the row instead of violating
    // the attempts PRIMARY KEY, and a later genuine retry (attempt incremented
    // by a verification failure) must still open its own row.
    {
        let mut store = SqliteStore::open(&path).unwrap();
        store
            .append(&Event::new(
                "run-1",
                EventKind::WorkerStarted {
                    task_id: TaskId::from("impl"),
                    worker_id: "worker-2".into(),
                },
            ))
            .unwrap();
        store
            .append(&Event::new(
                "run-1",
                EventKind::WorkerFinished {
                    task_id: TaskId::from("impl"),
                    worker_id: "worker-2".into(),
                },
            ))
            .unwrap();
        store
            .append(&Event::new(
                "run-1",
                EventKind::VerificationFailed {
                    task_id: TaskId::from("impl"),
                    reason: "checks failed".into(),
                },
            ))
            .unwrap();
        store
            .append(&Event::new(
                "run-1",
                EventKind::WorkerStarted {
                    task_id: TaskId::from("impl"),
                    worker_id: "worker-3".into(),
                },
            ))
            .unwrap();

        let projection = store.projection("run-1").unwrap();
        assert_eq!(
            projection.tasks[&TaskId::from("impl")].state,
            TaskState::Running
        );
        assert_eq!(
            projection.tasks[&TaskId::from("impl")].attempt, 1,
            "only the verification failure may consume retry budget"
        );
        assert_eq!(
            projection.active_workers.get("worker-3").map(|id| id.as_str()),
            Some("impl")
        );
    }

    let connection = rusqlite::Connection::open(&path).unwrap();
    let rows: Vec<(i64, String)> = connection
        .prepare(
            "SELECT attempt, state FROM attempts WHERE run_id = 'run-1' AND task_id = 'impl' ORDER BY attempt",
        )
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![(0, "failed".to_string()), (1, "running".to_string())],
        "exactly one attempts row per attempt number; no duplicates"
    );
}

#[test]
fn reconcile_cancels_verifying_attempt_rows_of_a_finished_worker() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.db");
    let mut store = SqliteStore::open(&path).unwrap();
    store
        .append_batch(&[
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
            Event::new(
                "run-1",
                EventKind::WorkerFinished {
                    task_id: TaskId::from("impl"),
                    worker_id: "worker-1".into(),
                },
            ),
        ])
        .unwrap();
    store
        .append(&Event::new(
            "run-1",
            EventKind::TaskExecutionReconciled {
                task_id: TaskId::from("impl"),
            },
        ))
        .unwrap();

    assert_eq!(
        store.projection("run-1").unwrap().tasks[&TaskId::from("impl")].state,
        TaskState::Ready
    );
    drop(store);
    let connection = rusqlite::Connection::open(&path).unwrap();
    let attempt_state: String = connection
        .query_row(
            "SELECT state FROM attempts WHERE run_id = 'run-1' AND task_id = 'impl' AND attempt = 0",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(attempt_state, "cancelled");
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
