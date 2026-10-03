#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use loop_core::event::{Artifact, Event, EventKind};
use loop_core::policy::{ArtifactKind, RefusalCode, RetentionPolicy};
use loop_core::run::RunState;
use loop_core::task::{CompletionCheck, CompletionContract, Task, TaskId, TaskKind, WorkOwnership};
use loop_store::{SqliteStore, StoreError};

fn sample_task(id: &str) -> Task {
    Task::builder(TaskId::from(id), "task title", TaskKind::Implementation)
        .ownership(WorkOwnership::new(std::iter::empty::<&str>(), ["src/**"]))
        .completion_contract(CompletionContract::new([CompletionCheck::new("check")]))
        .build()
        .unwrap()
}

#[test]
fn sqlite_storage_records_and_retrieves_per_run_artifacts() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("loop.db");
    let mut store = SqliteStore::open(&db_path).unwrap();

    store
        .append(&Event::new("run-1", EventKind::RunCreated))
        .unwrap();

    let art1 = Artifact::new("surf-1", ArtifactKind::Surface, "tab-1");
    let art2 = Artifact::new("wt-1", ArtifactKind::Worktree, "/project/.worktrees/wt-1");

    store.record_artifact("run-1", art1.clone()).unwrap();
    store.record_artifact("run-1", art2.clone()).unwrap();

    let artifacts = store.artifacts("run-1").unwrap();
    assert_eq!(artifacts.len(), 2);
    assert_eq!(artifacts[0], art1);
    assert_eq!(artifacts[1], art2);

    // Empty artifacts for non-existent run
    let empty = store.artifacts("run-none").unwrap();
    assert!(empty.is_empty());
}

#[test]
fn purge_run_deletes_terminal_run_and_cascades_to_artifacts_and_tasks() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("loop.db");
    let mut store = SqliteStore::open(&db_path).unwrap();

    store
        .append(&Event::new("run-1", EventKind::RunCreated))
        .unwrap();
    store
        .append(&Event::new(
            "run-1",
            EventKind::TaskCreated(sample_task("task-1")),
        ))
        .unwrap();
    store
        .record_artifact(
            "run-1",
            Artifact::new("art-1", ArtifactKind::Surface, "surface-1"),
        )
        .unwrap();
    store
        .append(&Event::new("run-1", EventKind::RunCancelled))
        .unwrap();

    assert_eq!(store.artifacts("run-1").unwrap().len(), 1);
    assert_eq!(store.events("run-1").unwrap().len(), 4);

    // Purge terminal run
    let purged = store.purge_run("run-1").unwrap();
    assert!(purged);

    // Verify all cascaded data is gone
    assert!(store.artifacts("run-1").unwrap().is_empty());
    assert!(store.events("run-1").unwrap().is_empty());
    assert!(store.runs().unwrap().is_empty());
}

#[test]
fn purge_run_refuses_active_and_attention_runs() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("loop.db");
    let mut store = SqliteStore::open(&db_path).unwrap();

    // Active run
    store
        .append(&Event::new("run-active", EventKind::RunCreated))
        .unwrap();

    let err = store.purge_run("run-active").unwrap_err();
    match err {
        StoreError::CleanupRefused(refusal) => {
            assert_eq!(refusal.artifact_kind, ArtifactKind::RunRecord);
            assert_eq!(refusal.target, "run-active");
            assert_eq!(refusal.code, RefusalCode::RunNotTerminal);
        }
        other => panic!("expected CleanupRefused, got {:?}", other),
    }

    // Run remains untouched
    let runs = store.runs().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].0, "run-active");
    assert_eq!(runs[0].1, RunState::Active);
}

#[test]
fn double_purge_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("loop.db");
    let mut store = SqliteStore::open(&db_path).unwrap();

    store
        .append(&Event::new("run-1", EventKind::RunCreated))
        .unwrap();
    store
        .append(&Event::new("run-1", EventKind::RunCompleted))
        .unwrap();

    // First purge succeeds
    let first = store.purge_run("run-1").unwrap();
    assert!(first);

    // Second purge on already-deleted run is idempotent and succeeds without error
    let second = store.purge_run("run-1").unwrap();
    assert!(!second);

    // Purge on completely non-existent run also succeeds idempotently
    let non_existent = store.purge_run("never-existed").unwrap();
    assert!(!non_existent);
}

#[test]
fn store_purge_honors_retention_policy_and_keeps_recent_terminal_runs() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("loop.db");
    let mut store = SqliteStore::open(&db_path).unwrap();

    // Create 5 terminal runs: run-1 (oldest) to run-5 (newest)
    for i in 1..=5 {
        let run_id = format!("run-{}", i);
        store
            .append(&Event::new(&run_id, EventKind::RunCreated))
            .unwrap();
        store
            .record_artifact(
                &run_id,
                Artifact::new(format!("art-{}", i), ArtifactKind::RunRecord, &run_id),
            )
            .unwrap();
        store
            .append(&Event::new(&run_id, EventKind::RunCompleted))
            .unwrap();
    }

    // Add an active run (should be refused/skipped by retention evaluation)
    store
        .append(&Event::new("run-active", EventKind::RunCreated))
        .unwrap();

    // Retention policy: keep 2 newest terminal runs
    let policy = RetentionPolicy::new(2);

    // First purge
    let plan = store.purge(policy).unwrap();

    // Terminal runs newest to oldest: run-5, run-4 (kept), run-3, run-2, run-1 (purged)
    // Plus run-active refused
    assert_eq!(plan.actions.len(), 3);
    assert_eq!(plan.actions[0].target, "run-3");
    assert_eq!(plan.actions[1].target, "run-2");
    assert_eq!(plan.actions[2].target, "run-1");

    assert_eq!(plan.refusals.len(), 1);
    assert_eq!(plan.refusals[0].target, "run-active");
    assert_eq!(plan.refusals[0].code, RefusalCode::RunNotTerminal);

    // Verify remaining runs in store: run-active, run-5, run-4
    let remaining_runs: Vec<String> = store
        .runs()
        .unwrap()
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert!(remaining_runs.contains(&"run-active".to_string()));
    assert!(remaining_runs.contains(&"run-5".to_string()));
    assert!(remaining_runs.contains(&"run-4".to_string()));
    assert!(!remaining_runs.contains(&"run-3".to_string()));
    assert!(!remaining_runs.contains(&"run-2".to_string()));
    assert!(!remaining_runs.contains(&"run-1".to_string()));

    // Artifacts of purged runs are gone
    assert!(store.artifacts("run-3").unwrap().is_empty());
    assert!(store.artifacts("run-2").unwrap().is_empty());
    assert!(store.artifacts("run-1").unwrap().is_empty());

    // Artifacts of kept runs are intact
    assert_eq!(store.artifacts("run-5").unwrap().len(), 1);
    assert_eq!(store.artifacts("run-4").unwrap().len(), 1);

    // Second purge with same policy: double-purge is idempotent!
    let second_plan = store.purge(policy).unwrap();
    assert!(second_plan.actions.is_empty());
    assert_eq!(second_plan.refusals.len(), 1);
    assert_eq!(second_plan.refusals[0].target, "run-active");
}
