//! Attention retry regressions: re-emitting a deterministic attention id
//! after a retry directive must replace the existing row, never violate the
//! `attention (run_id, id)` primary key.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loop_core::attention::{Attention, AttentionKind, AttentionResolution, AttentionState};
use loop_core::event::{Event, EventKind};
use loop_core::policy::ComputeClass;
use loop_core::task::{CompletionCheck, CompletionContract, Task, TaskId, TaskKind, WorkOwnership};
use loop_store::SqliteStore;

fn task() -> Task {
    Task::builder(
        TaskId::from("impl"),
        "implementation",
        TaskKind::Implementation,
    )
    .ownership(WorkOwnership::new(std::iter::empty::<&str>(), ["src/**"]))
    .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
    .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
    .build()
    .unwrap()
}

/// The orchestrator failure path derives its attention id from
/// `failure-{run}-{task}-{attempt}`, and a `retry` resolution does not
/// consume attempt budget — so a second identical failure re-emits the exact
/// same id. The store must replace the resolved row (mirroring the core
/// reducer's replace-on-insert) instead of failing the whole append batch.
#[test]
fn retry_failure_recreates_the_same_attention_id_without_constraint_violation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.db");
    let attention_id = "failure-run-1-impl-0-environment";
    let attention_id = attention_id.to_string();
    let mut store = SqliteStore::open(&path).unwrap();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(task())),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "run-1:impl:0:w1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::AttentionCreated(Attention::for_task(
                attention_id.as_str(),
                AttentionKind::Failure,
                "first failure",
                TaskId::from("impl"),
            )),
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFailed {
                task_id: TaskId::from("impl"),
                worker_id: "run-1:impl:0:w1".into(),
                reason: "boom".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::AttentionResolved {
                attention_id: attention_id.clone(),
                resolution: AttentionResolution::Retry,
            },
        ),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "run-1:impl:0:w2".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::AttentionCreated(Attention::for_task(
                attention_id.as_str(),
                AttentionKind::Failure,
                "second failure after retry",
                TaskId::from("impl"),
            )),
        ),
    ] {
        store.append(&event).unwrap();
    }

    // The projection sees the replacement: one open attention with the
    // latest failure evidence.
    let projection = store.projection("run-1").unwrap();
    let attention = &projection.attention[attention_id.as_str()];
    assert_eq!(attention.state, AttentionState::Open);
    assert_eq!(attention.summary, "second failure after retry");

    // The durable index agrees: exactly one row, reopened with the new
    // payload — no UNIQUE constraint residue.
    let connection = rusqlite::Connection::open(&path).unwrap();
    let (state, data_json): (String, String) = connection
        .query_row(
            "SELECT state, data_json FROM attention WHERE run_id = 'run-1' AND id = ?1",
            [attention_id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(state, "open");
    assert!(data_json.contains("second failure after retry"));
    let rows: i64 = connection
        .query_row(
            "SELECT count(*) FROM attention WHERE run_id = 'run-1' AND id = ?1",
            [attention_id.as_str()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(rows, 1);
}

/// Verification recovery derives its id from the task id
/// (`recovery-{run}-{task}-verification`), so verification interrupted twice
/// across retries re-emits the same id through the VerificationStopped
/// recovery path.
#[test]
fn repeated_verification_recovery_replaces_the_resolved_attention_row() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.db");
    let mut store = SqliteStore::open(&path).unwrap();
    let recovery_id = "recovery-run-1-impl-verification".to_string();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(task())),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        // First attempt dies in verification: the recovery attention opens
        // and the task parks.
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "run-1:impl:0:w1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "run-1:impl:0:w1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::VerificationStopped {
                task_id: TaskId::from("impl"),
            },
        ),
        // Operator retries; a fresh worker reaches verification and is
        // interrupted again — same task, same deterministic recovery id.
        Event::new(
            "run-1",
            EventKind::AttentionResolved {
                attention_id: recovery_id.clone(),
                resolution: AttentionResolution::Retry,
            },
        ),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "run-1:impl:1:w2".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "run-1:impl:1:w2".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::VerificationStopped {
                task_id: TaskId::from("impl"),
            },
        ),
    ] {
        store.append(&event).unwrap();
    }

    let projection = store.projection("run-1").unwrap();
    let attention = &projection.attention[recovery_id.as_str()];
    assert_eq!(attention.state, AttentionState::Open);

    let connection = rusqlite::Connection::open(&path).unwrap();
    let rows: i64 = connection
        .query_row(
            "SELECT count(*) FROM attention WHERE run_id = 'run-1' AND id = ?1",
            [recovery_id.as_str()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(rows, 1);
}
