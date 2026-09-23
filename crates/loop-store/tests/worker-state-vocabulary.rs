//! Direct tests for the frozen storage vocabulary written by `sqlite.rs`.
//!
//! Follows the `migration-schema-direct.rs` pattern: the private modules are
//! compiled into this test binary via `#[path]` includes, so the storage-word
//! functions and the raw persisted columns can be asserted directly without
//! widening the crate's public API.
//!
//! Why this exists (`docs/decisions/2026-09-24-evolution-roadmap.md`, 실행 1):
//! the `attempts.compute_class`, `attention.kind`, `tasks.state`, and
//! `runs.state` columns historically stored
//! `format!("{:?}", variant).to_lowercase()`, making Rust identifiers a
//! de-facto persistence contract. The words below are now pinned explicitly:
//! any change to a stored string fails here because existing persisted rows
//! (and the read-back paths that parse them) depend on the exact values.

// The `#[path]` includes compile the private modules into this binary; the
// store's full API surface is intentionally unused here, so silence the
// dead-code lint the include would otherwise trigger.
#[allow(dead_code)]
#[path = "../src/schema.rs"]
mod schema;

#[allow(dead_code)]
#[path = "../src/migration.rs"]
mod migration;

#[allow(dead_code)]
#[path = "../src/sqlite.rs"]
mod sqlite;

use loop_core::attention::{Attention, AttentionKind};
use loop_core::event::{Event, EventKind};
use loop_core::policy::ComputeClass;
use loop_core::run::RunState;
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskId, TaskKind, TaskState, WorkOwnership,
};
use sqlite::SqliteStore;

fn task_with_preferred_compute(preferred: ComputeClass) -> Task {
    Task::builder(
        TaskId::from("impl"),
        "implementation",
        TaskKind::Implementation,
    )
    .ownership(WorkOwnership::new(std::iter::empty::<&str>(), ["src/**"]))
    .compute(
        preferred,
        ComputeClass::Deterministic,
        ComputeClass::Frontier,
    )
    .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
    .build()
    .unwrap()
}

#[test]
fn compute_class_storage_words_are_frozen() {
    for (class, word) in [
        (ComputeClass::Deterministic, "deterministic"),
        (ComputeClass::TypedDecision, "typeddecision"),
        (ComputeClass::Tiny, "tiny"),
        (ComputeClass::Fast, "fast"),
        (ComputeClass::Balanced, "balanced"),
        (ComputeClass::Strong, "strong"),
        (ComputeClass::Frontier, "frontier"),
    ] {
        assert_eq!(
            sqlite::compute_class_storage_word(class),
            word,
            "frozen storage word for {class:?} changed; existing rows depend on it"
        );
    }
}

#[test]
fn attention_kind_storage_words_are_frozen() {
    for (kind, word) in [
        (AttentionKind::Question, "question"),
        (AttentionKind::Decision, "decision"),
        (AttentionKind::Approval, "approval"),
        (AttentionKind::Conflict, "conflict"),
        (AttentionKind::Failure, "failure"),
    ] {
        assert_eq!(
            sqlite::attention_kind_storage_word(kind),
            word,
            "frozen storage word for {kind:?} changed; existing rows depend on it"
        );
    }
}

#[test]
fn task_state_storage_words_are_frozen() {
    for (state, word) in [
        (TaskState::Pending, "pending"),
        (TaskState::Ready, "ready"),
        (TaskState::Running, "running"),
        (TaskState::Verifying, "verifying"),
        (TaskState::Attention, "attention"),
        (TaskState::Blocked, "blocked"),
        (TaskState::Done, "done"),
        (TaskState::Failed, "failed"),
        (TaskState::Cancelled, "cancelled"),
    ] {
        assert_eq!(
            sqlite::task_state_storage_word(state),
            word,
            "frozen storage word for {state:?} changed; existing rows depend on it"
        );
    }
}

#[test]
fn typed_decision_storage_word_deliberately_diverges_from_serde() {
    // The storage word is the legacy debug-format lowercase ("typeddecision"),
    // not the serde snake_case form ("typed_decision"). Converging them would
    // silently orphan rows written before the freeze — this pins the
    // divergence as intentional.
    assert_eq!(
        serde_json::to_string(&ComputeClass::TypedDecision).unwrap(),
        "\"typed_decision\""
    );
    assert_eq!(
        sqlite::compute_class_storage_word(ComputeClass::TypedDecision),
        "typeddecision"
    );
}

#[test]
fn persisted_columns_carry_the_frozen_words() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = SqliteStore::open(dir.path().join("vocabulary.db")).unwrap();

    let column = |store: &SqliteStore, sql: &str| -> String {
        store
            .connection
            .query_row(sql, [], |row| row.get(0))
            .unwrap()
    };

    store
        .append(&Event::new("run-1", EventKind::RunCreated))
        .unwrap();
    assert_eq!(
        column(&store, "SELECT state FROM runs WHERE id = 'run-1'",),
        "active"
    );

    store
        .append(&Event::new(
            "run-1",
            EventKind::TaskCreated(task_with_preferred_compute(ComputeClass::TypedDecision)),
        ))
        .unwrap();
    assert_eq!(
        column(
            &store,
            "SELECT state FROM tasks WHERE run_id = 'run-1' AND id = 'impl'",
        ),
        "pending"
    );

    store
        .append(&Event::new(
            "run-1",
            EventKind::TaskReady(TaskId::from("impl")),
        ))
        .unwrap();
    assert_eq!(
        column(
            &store,
            "SELECT state FROM tasks WHERE run_id = 'run-1' AND id = 'impl'",
        ),
        "ready"
    );

    store
        .append(&Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ))
        .unwrap();
    assert_eq!(
        column(
            &store,
            "SELECT state FROM tasks WHERE run_id = 'run-1' AND id = 'impl'",
        ),
        "running"
    );
    assert_eq!(
        column(
            &store,
            "SELECT compute_class FROM attempts WHERE run_id = 'run-1' AND task_id = 'impl' AND attempt = 0",
        ),
        "typeddecision"
    );

    store
        .append(&Event::new(
            "run-1",
            EventKind::AttentionCreated(Attention::for_task(
                "failure-1",
                AttentionKind::Failure,
                "worker lost",
                TaskId::from("impl"),
            )),
        ))
        .unwrap();
    assert_eq!(
        column(&store, "SELECT state FROM runs WHERE id = 'run-1'"),
        "attention"
    );
    assert_eq!(
        column(
            &store,
            "SELECT kind FROM attention WHERE run_id = 'run-1' AND id = 'failure-1'",
        ),
        "failure"
    );
    assert_eq!(
        column(
            &store,
            "SELECT state FROM attention WHERE run_id = 'run-1' AND id = 'failure-1'",
        ),
        "open"
    );

    // Read-back paths must parse the same frozen words back into the domain.
    assert_eq!(
        store.runs().unwrap(),
        vec![("run-1".to_string(), RunState::Attention)]
    );
    assert_eq!(
        store.projection("run-1").unwrap().tasks[&TaskId::from("impl")].state,
        TaskState::Running
    );
}
