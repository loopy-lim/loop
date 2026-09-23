//! Direct tests for the private `migration` and `schema` modules.
//!
//! Both modules are compiled into this test binary via `#[path]` includes so
//! `migrate` and `SCHEMA` are exercised without going through
//! `SqliteStore::open` and without widening the crate's public API.

#[path = "../src/schema.rs"]
mod schema;

#[path = "../src/migration.rs"]
mod migration;

use rusqlite::Connection;

/// Minimal legacy database: the four identifier tables still carry their
/// original single-column global primary keys, and tables introduced later
/// (edges, attempts, events, projection_cache, execution_leases) are absent.
const LEGACY_SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE tasks (
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    state TEXT NOT NULL,
    data_json TEXT NOT NULL,
    PRIMARY KEY (run_id, id)
);

CREATE TABLE workers (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    provider TEXT,
    session_id TEXT,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (run_id, task_id) REFERENCES tasks(run_id, id) ON DELETE CASCADE
);

CREATE TABLE decisions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id TEXT,
    value_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE attention (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id TEXT,
    kind TEXT NOT NULL,
    content_ref TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
"#;

fn pk_count(connection: &Connection, table: &str) -> i64 {
    connection
        .query_row(
            &format!("SELECT count(*) FROM pragma_table_info('{table}') WHERE pk > 0"),
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn object_exists(connection: &Connection, kind: &str, name: &str) -> bool {
    connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = ?1 AND name = ?2",
            [kind, name],
            |_| Ok(()),
        )
        .is_ok()
}

fn assert_foreign_keys_clean(connection: &Connection) {
    let mut statement = connection.prepare("PRAGMA foreign_key_check").unwrap();
    let offenders: Vec<String> = statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert!(offenders.is_empty(), "foreign key violations: {offenders:?}");
}

fn seed_run_and_tasks(connection: &Connection) {
    connection
        .execute_batch(
            r#"
            INSERT INTO runs (id, state) VALUES ('old', 'attention');
            INSERT INTO tasks (run_id, id, state, data_json)
                VALUES ('old', 'impl', 'completed', '{}');
            "#,
        )
        .unwrap();
}

fn seed_legacy_workers(connection: &Connection) {
    connection
        .execute(
            "INSERT INTO workers (id, run_id, task_id, provider, session_id, state)
                VALUES ('w1', 'old', 'impl', 'pi', 'session-1', 'finished')",
            [],
        )
        .unwrap();
}

fn seed_legacy_identifier_rows(connection: &Connection) {
    connection
        .execute_batch(
            r#"
            INSERT INTO decisions (id, run_id, task_id, value_json)
                VALUES ('d1', 'old', 'impl', '{"approved":true}');
            INSERT INTO attention (id, run_id, kind, state, data_json)
                VALUES ('approval', 'old', 'approval', 'open', '{"summary":"Preserve me"}');
            INSERT INTO artifacts (id, run_id, task_id, kind, content_ref, metadata_json)
                VALUES ('a1', 'old', 'impl', 'report', 'artifacts/a1', '{"lines":1}');
            "#,
        )
        .unwrap();
}

/// A fresh database must receive the complete current schema, with the four
/// identifier tables already carrying their composite (run_id, id) keys and
/// no legacy rewrite triggered. Defends `schema::SCHEMA` against dropped or
/// renamed tables/indexes and the fresh-install path of `migrate`.
#[test]
fn migrate_installs_the_full_schema_on_a_fresh_database() {
    let dir = tempfile::tempdir().unwrap();
    let connection = Connection::open(dir.path().join("fresh.db")).unwrap();

    migration::migrate(&connection).unwrap();

    for table in [
        "runs",
        "tasks",
        "edges",
        "attempts",
        "workers",
        "events",
        "decisions",
        "attention",
        "artifacts",
        "projection_cache",
        "execution_leases",
    ] {
        assert!(
            object_exists(&connection, "table", table),
            "missing table {table}"
        );
    }
    assert!(
        object_exists(&connection, "index", "events_run_seq"),
        "missing index events_run_seq"
    );
    for table in ["workers", "attention", "decisions", "artifacts"] {
        assert_eq!(pk_count(&connection, table), 2, "{table}");
        assert!(!object_exists(
            &connection,
            "table",
            &format!("{table}_legacy")
        ));
    }
    let journal_mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    assert_eq!(journal_mode, "wal");
}

/// The core legacy-key rewrite (migration.rs:8-11): databases whose identifier
/// tables still use single-column global primary keys are rebuilt with the
/// composite (run_id, id) keys. Rows and their column values must survive the
/// rename/copy/drop round trip, `_legacy` leftovers must not, tables absent
/// from the old database must be created in the same pass, and the result must
/// be referentially clean. Defends against row loss, column drift between the
/// legacy and current definitions, and schema-creation/key-rewrite ordering.
#[test]
fn legacy_global_keys_are_rewritten_without_losing_rows() {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch(LEGACY_SCHEMA).unwrap();
    seed_run_and_tasks(&connection);
    seed_legacy_workers(&connection);
    seed_legacy_identifier_rows(&connection);

    migration::migrate(&connection).unwrap();

    for table in ["workers", "attention", "decisions", "artifacts"] {
        assert_eq!(pk_count(&connection, table), 2, "{table}");
        assert!(
            !object_exists(&connection, "table", &format!("{table}_legacy")),
            "{table}_legacy should be dropped"
        );
    }
    for missing in ["edges", "attempts", "events", "projection_cache", "execution_leases"] {
        assert!(
            object_exists(&connection, "table", missing),
            "missing table {missing}"
        );
    }

    let (provider, session_id, worker_state): (Option<String>, Option<String>, String) = connection
        .query_row(
            "SELECT provider, session_id, state FROM workers WHERE run_id = 'old' AND id = 'w1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(provider.as_deref(), Some("pi"));
    assert_eq!(session_id.as_deref(), Some("session-1"));
    assert_eq!(worker_state, "finished");

    let attention_json: String = connection
        .query_row(
            "SELECT data_json FROM attention WHERE run_id = 'old' AND id = 'approval'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(attention_json.contains("Preserve me"));

    let decision_count: i64 = connection
        .query_row("SELECT count(*) FROM decisions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(decision_count, 1);
    let artifact_ref: String = connection
        .query_row(
            "SELECT content_ref FROM artifacts WHERE run_id = 'old' AND id = 'a1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(artifact_ref, "artifacts/a1");

    assert_foreign_keys_clean(&connection);
}

/// Running `migrate` again on an already-migrated database must be a no-op:
/// no duplicated rows, no error, keys stay composite. Defends the pk-count
/// guard against re-entrancy regressions on store re-open.
#[test]
fn migrate_is_idempotent_on_an_already_migrated_database() {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch(LEGACY_SCHEMA).unwrap();
    seed_run_and_tasks(&connection);
    seed_legacy_workers(&connection);
    seed_legacy_identifier_rows(&connection);
    migration::migrate(&connection).unwrap();

    migration::migrate(&connection).unwrap();

    for table in ["workers", "attention", "decisions", "artifacts"] {
        assert_eq!(pk_count(&connection, table), 2, "{table}");
        assert!(!object_exists(&connection, "table", &format!("{table}_legacy")));
    }
    for table in ["workers", "decisions", "attention", "artifacts"] {
        let count: i64 = connection
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "{table} rows must not duplicate");
    }
}

/// A partially migrated database (one identifier table already composite,
/// the rest still legacy) must finish migrating the remaining tables without
/// touching the already-migrated one. Defends the per-table pk>0 detection
/// so a single migrated table cannot short-circuit or corrupt the loop.
#[test]
fn an_already_migrated_table_does_not_block_remaining_legacy_tables() {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch(LEGACY_SCHEMA).unwrap();
    seed_run_and_tasks(&connection);
    seed_legacy_identifier_rows(&connection);
    // Simulate workers having been migrated previously.
    connection
        .execute_batch(
            r#"
            BEGIN;
            ALTER TABLE workers RENAME TO workers_pending;
            CREATE TABLE workers (
                id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                provider TEXT,
                session_id TEXT,
                state TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
                PRIMARY KEY (run_id, id),
                FOREIGN KEY (run_id, task_id) REFERENCES tasks(run_id, id) ON DELETE CASCADE
            );
            COMMIT;
            "#,
        )
        .unwrap();
    seed_legacy_workers(&connection);

    migration::migrate(&connection).unwrap();

    for table in ["workers", "attention", "decisions", "artifacts"] {
        assert_eq!(pk_count(&connection, table), 2, "{table}");
        assert!(!object_exists(&connection, "table", &format!("{table}_legacy")));
    }
    let worker_count: i64 = connection
        .query_row("SELECT count(*) FROM workers", [], |row| row.get(0))
        .unwrap();
    assert_eq!(worker_count, 1);
    let attention_count: i64 = connection
        .query_row("SELECT count(*) FROM attention", [], |row| row.get(0))
        .unwrap();
    assert_eq!(attention_count, 1);
    assert_foreign_keys_clean(&connection);
}

/// The behavioral point of the migration: after the rewrite, identifiers are
/// scoped per run — the same id may exist under different runs, while a
/// duplicate within one run is rejected by the composite primary key, and
/// pre-existing rows survive the new inserts untouched.
#[test]
fn composite_keys_scope_identifiers_per_run() {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch(LEGACY_SCHEMA).unwrap();
    seed_run_and_tasks(&connection);
    seed_legacy_identifier_rows(&connection);
    migration::migrate(&connection).unwrap();

    connection
        .execute("INSERT INTO runs (id, state) VALUES ('new', 'running')", [])
        .unwrap();
    connection
        .execute(
            "INSERT INTO attention (id, run_id, kind, state, data_json)
                VALUES ('approval', 'new', 'approval', 'open', '{}')",
            [],
        )
        .unwrap();

    let duplicate = connection.execute(
        "INSERT INTO attention (id, run_id, kind, state, data_json)
            VALUES ('approval', 'new', 'approval', 'open', '{}')",
        [],
    );
    assert!(duplicate.is_err(), "duplicate (run_id, id) must be rejected");

    let per_run: Vec<(String, String)> = connection
        .prepare("SELECT run_id, id FROM attention ORDER BY run_id")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(per_run, vec![("new".into(), "approval".into()), ("old".into(), "approval".into())]);
    assert_foreign_keys_clean(&connection);
}
