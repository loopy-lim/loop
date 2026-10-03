#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use loop_core::event::{Event, EventKind};
use loop_store::SqliteStore;

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
