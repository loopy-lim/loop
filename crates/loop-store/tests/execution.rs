#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use loop_core::event::{Event, EventKind};
use loop_core::policy::ComputeClass;
use loop_core::task::{CompletionCheck, CompletionContract, Task, TaskId, TaskKind, WorkOwnership};
use loop_store::{
    bounded_renewal, RenewalOutcome, SqliteStore, StoreError, RENEW_MAX_ATTEMPTS,
    RENEW_RETRY_DELAY_MS, RENEW_THRESHOLD_DIVISOR,
};

fn running_task() -> Task {
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

/// A plausible transient store failure, as a busy write lock would surface.
fn busy_error() -> StoreError {
    StoreError::Database(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
        Some("database is locked".into()),
    ))
}

#[test]
fn missed_renewal_recovers_and_appends_keep_succeeding() {
    // The first renewal attempt fails transiently; the retry lands while the
    // lease is still alive, so the owner keeps its append rights.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recover.sqlite");
    let mut store = SqliteStore::open(&path).unwrap();
    store
        .append(&Event::new("run", EventKind::RunCreated))
        .unwrap();
    assert!(store.claim_execution("run", "owner", 5_000).unwrap());
    let (_, expires_before) = store.execution_lease("run").unwrap().unwrap();

    let mut attempts = 0;
    let mut delays = 0;
    let outcome = bounded_renewal(
        || {
            attempts += 1;
            if attempts == 1 {
                Err(busy_error())
            } else {
                store.renew_execution("run", "owner", 5_000)
            }
        },
        || delays += 1,
    )
    .unwrap();
    assert_eq!(outcome, RenewalOutcome::Renewed);
    assert_eq!(attempts, 2);
    assert_eq!(delays, 1);

    // The lease survived (same-millisecond renewals land on the same expiry
    // millisecond) — the owned append below proves the fence stayed open.
    let (_, expires_after) = store.execution_lease("run").unwrap().unwrap();
    assert!(expires_after >= expires_before);
    // And owned appends keep succeeding.
    let event = Event::new(
        "run",
        EventKind::GuidanceAdded {
            task_id: None,
            message: "after recovery".into(),
        },
    );
    store
        .append_batch_owned(std::slice::from_ref(&event), Some("owner"))
        .unwrap();
}

#[test]
fn exhausted_renewal_retries_hand_off_to_the_durable_recovery_path() {
    // Every attempt fails transiently until the budget is spent; the caller
    // then gives up and the durable hand-off facts stay assembled for the
    // next owner's recycle.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("exhausted.sqlite");
    let mut store = SqliteStore::open(&path).unwrap();
    for event in [
        Event::new("run", EventKind::RunCreated),
        Event::new("run", EventKind::TaskCreated(running_task())),
        Event::new("run", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
    ] {
        store.append(&event).unwrap();
    }
    assert!(store.claim_execution("run", "owner", 5_000).unwrap());

    let mut attempts = 0;
    let result = bounded_renewal(
        || {
            attempts += 1;
            Err(busy_error())
        },
        || {},
    );
    match result {
        Err(StoreError::RenewalExhausted {
            attempts: spent, ..
        }) => {
            assert_eq!(spent, RENEW_MAX_ATTEMPTS);
        }
        other => panic!("expected renewal exhaustion, got {other:?}"),
    }
    assert_eq!(attempts, RENEW_MAX_ATTEMPTS);

    // The durable hand-off facts are in place: the running worker is an
    // unfinished claim a new owner can recycle without human confirmation.
    let interrupted = store.interrupted_execution_claims("run").unwrap();
    assert_eq!(interrupted.claims.len(), 1);
    assert_eq!(interrupted.claims[0].task_id, "impl");
    assert_eq!(interrupted.claims[0].worker_id.as_deref(), Some("worker-1"));
}

#[test]
fn lapsed_or_taken_lease_ends_renewal_without_retrying() {
    // A lost lease is a deterministic store judgment: no retry is spent on it.
    let mut attempts = 0;
    let mut delays = 0;
    let outcome = bounded_renewal(
        || {
            attempts += 1;
            Ok(false)
        },
        || delays += 1,
    )
    .unwrap();
    assert_eq!(outcome, RenewalOutcome::Lost);
    assert_eq!(attempts, 1);
    assert_eq!(delays, 0);

    // The same judgment through the real store: a foreign owner cannot renew.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("foreign.sqlite");
    let mut store = SqliteStore::open(&path).unwrap();
    store
        .append(&Event::new("run", EventKind::RunCreated))
        .unwrap();
    assert!(store.claim_execution("run", "owner-a", 5_000).unwrap());
    assert_eq!(
        store
            .renew_execution_retrying("run", "owner-b", 5_000)
            .unwrap(),
        RenewalOutcome::Lost
    );
}

#[test]
fn production_renewal_retries_transient_failures_with_real_store() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("production.sqlite");
    let mut store = SqliteStore::open(&path).unwrap();
    store
        .append(&Event::new("run", EventKind::RunCreated))
        .unwrap();
    assert!(store.claim_execution("run", "owner", 1_000).unwrap());
    let (_, expires_before) = store.execution_lease("run").unwrap().unwrap();
    assert_eq!(
        store
            .renew_execution_retrying("run", "owner", 1_000)
            .unwrap(),
        RenewalOutcome::Renewed
    );
    let (_, expires_after) = store.execution_lease("run").unwrap().unwrap();
    assert!(expires_after >= expires_before);
    // Validation failures are deterministic and never enter the retry loop.
    assert!(matches!(
        store.renew_execution_retrying("run", "owner", 500),
        Err(StoreError::InvalidLease)
    ));
}

#[test]
fn renewal_retry_budget_fits_inside_the_smallest_threshold() {
    // The whole retry budget must land inside the renewal threshold (one
    // third of the TTL) even for the minimum 1 s TTL.
    assert_eq!(RENEW_THRESHOLD_DIVISOR, 3);
    let smallest_threshold = 1_000 / RENEW_THRESHOLD_DIVISOR;
    let budget_ms = (RENEW_MAX_ATTEMPTS - 1) as i64 * (RENEW_RETRY_DELAY_MS as i64);
    assert!(budget_ms <= smallest_threshold);
}

#[test]
fn one_execution_owner_until_release_or_expiry() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lease.sqlite");
    let mut first = SqliteStore::open(&path).unwrap();
    first
        .append(&Event::new("run", EventKind::RunCreated))
        .unwrap();
    let second = SqliteStore::open(&path).unwrap();
    assert!(first.claim_execution_at("run", "one", 0, 5000).unwrap());
    assert!(!second.claim_execution_at("run", "two", 1000, 5000).unwrap());
    second.release_execution("run", "two").unwrap();
    assert!(!second.claim_execution_at("run", "two", 2000, 5000).unwrap());
    assert!(first.claim_execution_at("run", "one", 3000, 5000).unwrap());
    assert!(!second.claim_execution_at("run", "two", 5000, 5000).unwrap());
    assert!(second.claim_execution_at("run", "two", 8000, 5000).unwrap());
    assert!(!first.claim_execution_at("run", "one", 8001, 5000).unwrap());
    assert!(!second
        .claim_execution_at("run", "two", 13_001, 5000)
        .unwrap());
}

#[test]
fn stale_owner_cannot_renew_after_takeover_and_release() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("renew.sqlite");
    let mut store = SqliteStore::open(&path).unwrap();
    store
        .append(&Event::new("run", EventKind::RunCreated))
        .unwrap();
    assert!(store.claim_execution_at("run", "old", 0, 5000).unwrap());
    assert!(store.claim_execution_at("run", "new", 5000, 5000).unwrap());
    store.release_execution("run", "new").unwrap();
    assert!(!store.renew_execution_at("run", "old", 5001, 5000).unwrap());
    assert!(store.execution_lease("run").unwrap().is_none());
}

#[test]
fn active_lease_fences_unowned_and_stale_event_appends() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fenced.sqlite");
    let mut store = SqliteStore::open(&path).unwrap();
    store
        .append(&Event::new("run", EventKind::RunCreated))
        .unwrap();
    assert!(store.claim_execution("run", "owner-a", 5000).unwrap());

    let event = Event::new(
        "run",
        EventKind::GuidanceAdded {
            task_id: None,
            message: "owned".into(),
        },
    );
    assert!(store
        .append_batch_owned(std::slice::from_ref(&event), None)
        .is_err());
    assert!(store
        .append_batch_owned(std::slice::from_ref(&event), Some("owner-b"))
        .is_err());
    store
        .append_batch_owned(std::slice::from_ref(&event), Some("owner-a"))
        .unwrap();

    let (_, expires_at) = store.execution_lease("run").unwrap().unwrap();
    assert!(store
        .claim_execution_at("run", "owner-b", expires_at, 5000)
        .unwrap());
    assert!(store
        .append_batch_owned(std::slice::from_ref(&event), Some("owner-a"))
        .is_err());
}

#[test]
fn cached_projection_equals_event_replay_and_bad_cache_recovers() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("projection.sqlite");
    let mut store = SqliteStore::open(&path).unwrap();
    store
        .append(&Event::new("run", EventKind::RunCreated))
        .unwrap();
    store
        .append(&Event::new(
            "run",
            EventKind::RunConfigured {
                intent: "intent".into(),
                working_directory: "/project".into(),
            },
        ))
        .unwrap();
    store
        .append(&Event::new(
            "run",
            EventKind::GuidanceAdded {
                task_id: None,
                message: "keep public API".into(),
            },
        ))
        .unwrap();
    let mut replay = loop_core::event::RunProjection::default();
    for event in store.events("run").unwrap() {
        replay.apply(&event).unwrap();
    }
    assert_eq!(
        serde_json::to_value(store.projection("run").unwrap()).unwrap(),
        serde_json::to_value(&replay).unwrap()
    );
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute("UPDATE projection_cache SET data_json = 'broken'", [])
        .unwrap();
    assert_eq!(
        store.projection("run").unwrap().guidance[0].message,
        "keep public API"
    );
    drop(store);
    assert_eq!(
        SqliteStore::open(&path)
            .unwrap()
            .projection("run")
            .unwrap()
            .intent,
        "intent"
    );
}

#[test]
fn legacy_global_identifiers_migrate_without_losing_rows_or_replay() {
    use loop_core::attention::{Attention, AttentionKind};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.db");
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(include_str!("fixtures/global-id-schema.sql"))
        .unwrap();
    connection
        .execute(
            "INSERT INTO runs (id, state) VALUES ('old', 'attention')",
            [],
        )
        .unwrap();
    connection.execute("INSERT INTO attention (id, run_id, kind, state, data_json) VALUES ('approval', 'old', 'approval', 'open', ?1)", [serde_json::to_string(&Attention::new("approval", AttentionKind::Approval, "Preserve me")).unwrap()]).unwrap();
    for event in [
        Event::new("old", EventKind::RunCreated),
        Event::new(
            "old",
            EventKind::AttentionCreated(Attention::new(
                "approval",
                AttentionKind::Approval,
                "Preserve me",
            )),
        ),
    ] {
        connection
            .execute(
                "INSERT INTO events (run_id, payload_json) VALUES ('old', ?1)",
                [serde_json::to_string(&event).unwrap()],
            )
            .unwrap();
    }
    drop(connection);
    let mut store = SqliteStore::open(&path).unwrap();
    assert_eq!(
        store.projection("old").unwrap().attention["approval"].summary,
        "Preserve me"
    );
    store
        .append(&Event::new("new", EventKind::RunCreated))
        .unwrap();
    store
        .append(&Event::new(
            "new",
            EventKind::AttentionCreated(Attention::new(
                "approval",
                AttentionKind::Approval,
                "New approval",
            )),
        ))
        .unwrap();
    let connection = rusqlite::Connection::open(&path).unwrap();
    for table in ["workers", "attention", "decisions", "artifacts"] {
        let keys: i64 = connection
            .query_row(
                &format!("SELECT count(*) FROM pragma_table_info('{table}') WHERE pk > 0"),
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(keys, 2, "{table}");
    }
    let count: i64 = connection
        .query_row("SELECT count(*) FROM attention", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 2);
    assert!(connection
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
}
