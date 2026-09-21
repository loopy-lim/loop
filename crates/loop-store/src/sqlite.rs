use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use loop_core::event::{Event, EventKind, ProjectionError, RunProjection};
use loop_core::run::RunState;
use loop_core::task::TaskState;
use rusqlite::{params, Connection, Transaction};
use thiserror::Error;

use crate::migration::migrate;

pub struct SqliteStore {
    connection: Connection,
}

impl SqliteStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let connection = Connection::open(path)?;
        migrate(&connection)?;
        Ok(Self { connection })
    }

    pub fn append(&mut self, event: &Event) -> Result<i64, StoreError> {
        self.append_batch(std::slice::from_ref(event))
    }

    pub fn append_batch(&mut self, events: &[Event]) -> Result<i64, StoreError> {
        if events.is_empty() {
            return Ok(0);
        }
        let run_id = &events[0].run_id;
        if events.iter().any(|event| event.run_id != *run_id) {
            return Err(StoreError::MixedRuns);
        }
        let mut projection = RunProjection::default();
        for event in self.events(run_id)? {
            projection.apply(&event)?;
        }
        for event in events {
            projection.apply(event)?;
        }

        let transaction = self.connection.transaction()?;
        let mut sequence = 0;
        for event in events {
            apply_indexes(&transaction, event)?;
            let payload = serde_json::to_string(event)?;
            transaction.execute(
                "INSERT INTO events (run_id, payload_json) VALUES (?1, ?2)",
                params![event.run_id, payload],
            )?;
            sequence = transaction.last_insert_rowid();
        }
        sync_projection_indexes(&transaction, &projection)?;
        transaction.commit()?;
        Ok(sequence)
    }

    pub fn events(&self, run_id: &str) -> Result<Vec<Event>, StoreError> {
        let mut statement = self
            .connection
            .prepare("SELECT payload_json FROM events WHERE run_id = ?1 ORDER BY seq ASC")?;
        let values = statement
            .query_map([run_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        values
            .into_iter()
            .map(|value| serde_json::from_str(&value).map_err(StoreError::from))
            .collect()
    }

    pub fn event_records(
        &self,
        run_id: &str,
        after_sequence: i64,
        limit: usize,
    ) -> Result<Vec<EventRecord>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT seq, payload_json FROM events WHERE run_id = ?1 AND seq > ?2 ORDER BY seq ASC LIMIT ?3",
        )?;
        let rows = statement.query_map(
            params![
                run_id,
                after_sequence,
                i64::try_from(limit.min(1_000)).unwrap_or(1_000)
            ],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )?;
        rows.map(|row| {
            let (sequence, payload) = row?;
            Ok(EventRecord {
                sequence,
                event: serde_json::from_str(&payload)?,
            })
        })
        .collect()
    }

    pub fn projection(&self, run_id: &str) -> Result<RunProjection, StoreError> {
        let events = self.events(run_id)?;
        if events.is_empty() {
            return Err(StoreError::RunNotFound(run_id.to_string()));
        }
        let mut projection = RunProjection::default();
        for event in &events {
            projection.apply(event)?;
        }
        Ok(projection)
    }

    pub fn recover_run(
        &self,
        run_id: &str,
        observed_workers: &BTreeMap<String, ObservedWorkerState>,
    ) -> Result<RecoveredRun, StoreError> {
        let events = self.events(run_id)?;
        if events.is_empty() {
            return Err(StoreError::RunNotFound(run_id.to_string()));
        }
        let mut projection = RunProjection::default();
        for event in &events {
            projection.apply(event)?;
        }
        let mut workers = BTreeMap::new();
        for (worker_id, task_id) in projection.active_workers.clone() {
            let state = match observed_workers.get(&worker_id) {
                Some(ObservedWorkerState::Running) => RecoveredWorkerState::Running,
                Some(ObservedWorkerState::Completed) => RecoveredWorkerState::CompletedNeedsResult,
                None => {
                    if let Some(task) = projection.tasks.get_mut(&task_id) {
                        task.state = TaskState::Attention;
                    }
                    projection.run_state = Some(RunState::Attention);
                    projection.active_workers.remove(&worker_id);
                    RecoveredWorkerState::Lost
                }
            };
            workers.insert(worker_id, state);
        }
        Ok(RecoveredRun {
            projection,
            workers,
            events: events.len(),
        })
    }

    pub fn table_names(&self) -> Result<BTreeSet<String>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )?;
        let names = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<BTreeSet<_>, _>>()?;
        Ok(names)
    }
}

fn apply_indexes(transaction: &Transaction<'_>, event: &Event) -> Result<(), StoreError> {
    match &event.kind {
        EventKind::RunCreated => {
            transaction.execute(
                "INSERT INTO runs (id, state) VALUES (?1, 'active')",
                [&event.run_id],
            )?;
        }
        EventKind::TaskCreated(task) => {
            let data = serde_json::to_string(task)?;
            transaction.execute(
                "INSERT INTO tasks (run_id, id, state, data_json) VALUES (?1, ?2, 'pending', ?3)",
                params![event.run_id, task.id.as_str(), data],
            )?;
            for dependency in &task.dependencies {
                transaction.execute(
                    "INSERT INTO edges (run_id, task_id, dependency_id) VALUES (?1, ?2, ?3)",
                    params![event.run_id, task.id.as_str(), dependency.as_str()],
                )?;
            }
        }
        EventKind::TaskReady(task_id) => {
            update_task_state(transaction, &event.run_id, task_id.as_str(), "ready")?;
        }
        EventKind::WorkerStarted { task_id, worker_id } => {
            update_task_state(transaction, &event.run_id, task_id.as_str(), "running")?;
            transaction.execute(
                "INSERT INTO workers (id, run_id, task_id, state) VALUES (?1, ?2, ?3, 'running')",
                params![worker_id, event.run_id, task_id.as_str()],
            )?;
            let task_json: String = transaction.query_row(
                "SELECT data_json FROM tasks WHERE run_id = ?1 AND id = ?2",
                params![event.run_id, task_id.as_str()],
                |row| row.get(0),
            )?;
            let task: loop_core::task::Task = serde_json::from_str(&task_json)?;
            transaction.execute(
                "INSERT INTO attempts (run_id, task_id, attempt, compute_class, state) VALUES (?1, ?2, ?3, ?4, 'running')",
                params![
                    event.run_id,
                    task_id.as_str(),
                    task.attempt,
                    format!("{:?}", task.preferred_compute).to_lowercase(),
                ],
            )?;
        }
        EventKind::WorkerFinished { task_id, worker_id } => {
            update_task_state(transaction, &event.run_id, task_id.as_str(), "verifying")?;
            transaction.execute(
                "UPDATE workers SET state = 'completed', updated_at = unixepoch() WHERE id = ?1 AND run_id = ?2",
                params![worker_id, event.run_id],
            )?;
            update_latest_attempt_state(transaction, &event.run_id, task_id.as_str(), "verifying")?;
        }
        EventKind::WorkerFailed {
            task_id, worker_id, ..
        } => {
            update_task_state(transaction, &event.run_id, task_id.as_str(), "failed")?;
            transaction.execute(
                "UPDATE workers SET state = 'failed', updated_at = unixepoch() WHERE id = ?1 AND run_id = ?2",
                params![worker_id, event.run_id],
            )?;
            update_latest_attempt_state(transaction, &event.run_id, task_id.as_str(), "failed")?;
        }
        EventKind::VerificationPassed { task_id, .. } | EventKind::TaskCompleted(task_id) => {
            update_task_state(transaction, &event.run_id, task_id.as_str(), "done")?;
            update_latest_attempt_state(transaction, &event.run_id, task_id.as_str(), "done")?;
        }
        EventKind::VerificationFailed { task_id, .. } => {
            update_task_state(transaction, &event.run_id, task_id.as_str(), "ready")?;
            update_latest_attempt_state(transaction, &event.run_id, task_id.as_str(), "failed")?;
        }
        EventKind::AttentionCreated(attention) => {
            let data = serde_json::to_string(attention)?;
            transaction.execute(
                "INSERT INTO attention (id, run_id, kind, state, data_json) VALUES (?1, ?2, ?3, 'open', ?4)",
                params![attention.id, event.run_id, format!("{:?}", attention.kind).to_lowercase(), data],
            )?;
            update_run_state(transaction, &event.run_id, "attention")?;
        }
        EventKind::AttentionResolved { attention_id, .. } => {
            transaction.execute(
                "UPDATE attention SET state = 'resolved', updated_at = unixepoch() WHERE id = ?1 AND run_id = ?2",
                params![attention_id, event.run_id],
            )?;
            update_run_state(transaction, &event.run_id, "active")?;
        }
        EventKind::DecisionRecorded {
            decision_id,
            task_id,
            value,
        } => {
            transaction.execute(
                "INSERT INTO decisions (id, run_id, task_id, value_json) VALUES (?1, ?2, ?3, ?4)",
                params![
                    decision_id,
                    event.run_id,
                    task_id.as_ref().map(|id| id.as_str()),
                    value
                ],
            )?;
        }
        EventKind::RunCompleted => update_run_state(transaction, &event.run_id, "completed")?,
        EventKind::RunCancelled => update_run_state(transaction, &event.run_id, "cancelled")?,
        EventKind::RunResumed => update_run_state(transaction, &event.run_id, "active")?,
    }
    Ok(())
}

fn sync_projection_indexes(
    transaction: &Transaction<'_>,
    projection: &RunProjection,
) -> Result<(), StoreError> {
    let Some(run_id) = projection.run_id.as_deref() else {
        return Ok(());
    };
    if let Some(state) = projection.run_state {
        update_run_state(transaction, run_id, &format!("{state:?}").to_lowercase())?;
    }
    for task in projection.tasks.values() {
        transaction.execute(
            "UPDATE tasks SET state = ?3, data_json = ?4 WHERE run_id = ?1 AND id = ?2",
            params![
                run_id,
                task.id.as_str(),
                format!("{:?}", task.state).to_lowercase(),
                serde_json::to_string(task)?,
            ],
        )?;
    }
    Ok(())
}

fn update_latest_attempt_state(
    transaction: &Transaction<'_>,
    run_id: &str,
    task_id: &str,
    state: &str,
) -> Result<(), StoreError> {
    transaction.execute(
        "UPDATE attempts SET state = ?3 WHERE run_id = ?1 AND task_id = ?2 AND attempt = (SELECT MAX(attempt) FROM attempts WHERE run_id = ?1 AND task_id = ?2)",
        params![run_id, task_id, state],
    )?;
    Ok(())
}

fn update_task_state(
    transaction: &Transaction<'_>,
    run_id: &str,
    task_id: &str,
    state: &str,
) -> Result<(), StoreError> {
    transaction.execute(
        "UPDATE tasks SET state = ?3 WHERE run_id = ?1 AND id = ?2",
        params![run_id, task_id, state],
    )?;
    Ok(())
}

fn update_run_state(
    transaction: &Transaction<'_>,
    run_id: &str,
    state: &str,
) -> Result<(), StoreError> {
    transaction.execute(
        "UPDATE runs SET state = ?2, updated_at = unixepoch() WHERE id = ?1",
        params![run_id, state],
    )?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ObservedWorkerState {
    Running,
    Completed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecoveredWorkerState {
    Running,
    CompletedNeedsResult,
    Lost,
}

#[derive(Clone, Debug)]
pub struct RecoveredRun {
    pub projection: RunProjection,
    pub workers: BTreeMap<String, RecoveredWorkerState>,
    pub events: usize,
}

#[derive(Clone, Debug)]
pub struct EventRecord {
    pub sequence: i64,
    pub event: Event,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("projection error: {0}")]
    Projection(#[from] ProjectionError),
    #[error("run was not found: {0}")]
    RunNotFound(String),
    #[error("one append batch cannot contain events from multiple runs")]
    MixedRuns,
}
