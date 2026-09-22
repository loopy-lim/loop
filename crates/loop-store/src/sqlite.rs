use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use loop_core::event::{
    verification_recovery_attention, worker_recovery_attention, Artifact, Event, EventKind,
    ProjectionError, RunProjection,
};
use loop_core::policy::{CleanupRefusal, PurgePlan, RetentionPolicy};
use loop_core::run::RunState;
use loop_core::task::TaskState;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use thiserror::Error;

use crate::migration::migrate;

pub struct SqliteStore {
    connection: Connection,
}

impl SqliteStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        migrate(&connection)?;
        Ok(Self { connection })
    }

    pub fn append(&mut self, event: &Event) -> Result<i64, StoreError> {
        self.append_batch(std::slice::from_ref(event))
    }

    pub fn append_batch(&mut self, events: &[Event]) -> Result<i64, StoreError> {
        self.append_batch_internal(events, None, false)
    }

    pub fn append_batch_owned(
        &mut self,
        events: &[Event],
        owner: Option<&str>,
    ) -> Result<i64, StoreError> {
        self.append_batch_internal(events, owner, true)
    }

    fn append_batch_internal(
        &mut self,
        events: &[Event],
        owner: Option<&str>,
        enforce_owner: bool,
    ) -> Result<i64, StoreError> {
        if events.is_empty() {
            return Ok(0);
        }
        let run_id = &events[0].run_id;
        if events.iter().any(|event| event.run_id != *run_id) {
            return Err(StoreError::MixedRuns);
        }
        // Acquire the write lock before reading the projection. Otherwise two
        // writers can validate against the same old state and lose transitions.
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if enforce_owner {
            require_execution_owner(&transaction, run_id, owner, database_now_ms(&transaction)?)?;
        }
        let mut projection = match load_projection(&transaction, run_id) {
            Ok(projection) => projection,
            Err(StoreError::RunNotFound(_)) => RunProjection::default(),
            Err(error) => return Err(error),
        };
        for event in events {
            projection.apply(event)?;
        }

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
        transaction.execute(
            "INSERT INTO projection_cache (run_id, seq, version, data_json) VALUES (?1, ?2, 1, ?3) ON CONFLICT(run_id) DO UPDATE SET seq = excluded.seq, version = 1, data_json = excluded.data_json",
            params![run_id, sequence, serde_json::to_string(&projection)?],
        )?;
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
        load_projection(&self.connection, run_id)
    }

    pub fn last_sequence(&self, run_id: &str) -> Result<i64, StoreError> {
        Ok(self.connection.query_row(
            "SELECT coalesce(max(seq), 0) FROM events WHERE run_id = ?1",
            [run_id],
            |row| row.get(0),
        )?)
    }

    pub fn claim_execution(&self, run_id: &str, owner: &str, ttl: i64) -> Result<bool, StoreError> {
        self.claim_execution_at(run_id, owner, database_now_ms(&self.connection)?, ttl)
    }

    pub fn claim_execution_at(
        &self,
        run_id: &str,
        owner: &str,
        now: i64,
        ttl: i64,
    ) -> Result<bool, StoreError> {
        if owner.is_empty() || !(1_000..=60_000).contains(&ttl) {
            return Err(StoreError::InvalidLease);
        }
        let updated = self.connection.execute(
            "INSERT INTO execution_leases (run_id, owner, expires_at) VALUES (?1, ?2, ?3) ON CONFLICT(run_id) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at WHERE (owner = ?2 AND expires_at > ?4) OR (owner <> ?2 AND expires_at <= ?4)",
            params![run_id, owner, now.saturating_add(ttl), now],
        )?;
        Ok(updated == 1)
    }

    pub fn renew_execution(&self, run_id: &str, owner: &str, ttl: i64) -> Result<bool, StoreError> {
        self.renew_execution_at(run_id, owner, database_now_ms(&self.connection)?, ttl)
    }

    pub fn renew_execution_at(
        &self,
        run_id: &str,
        owner: &str,
        now: i64,
        ttl: i64,
    ) -> Result<bool, StoreError> {
        if owner.is_empty() || !(1_000..=60_000).contains(&ttl) {
            return Err(StoreError::InvalidLease);
        }
        let updated = self.connection.execute(
            "UPDATE execution_leases SET expires_at = ?3 WHERE run_id = ?1 AND owner = ?2 AND expires_at > ?4",
            params![run_id, owner, now.saturating_add(ttl), now],
        )?;
        Ok(updated == 1)
    }

    pub fn require_execution_owner(
        &self,
        run_id: &str,
        owner: Option<&str>,
    ) -> Result<(), StoreError> {
        require_execution_owner(
            &self.connection,
            run_id,
            owner,
            database_now_ms(&self.connection)?,
        )
    }

    pub fn execution_lease(&self, run_id: &str) -> Result<Option<(String, i64)>, StoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT owner, expires_at FROM execution_leases WHERE run_id = ?1",
                [run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?)
    }

    pub fn release_execution(&self, run_id: &str, owner: &str) -> Result<(), StoreError> {
        self.connection.execute(
            "DELETE FROM execution_leases WHERE run_id = ?1 AND owner = ?2",
            params![run_id, owner],
        )?;
        Ok(())
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

    pub fn artifacts(&self, run_id: &str) -> Result<Vec<Artifact>, StoreError> {
        let mut statement = self.connection.prepare(
            "SELECT id, kind, content_ref FROM artifacts WHERE run_id = ?1 ORDER BY created_at ASC, id ASC",
        )?;
        let rows = statement.query_map([run_id], |row| {
            let id: String = row.get(0)?;
            let kind_str: String = row.get(1)?;
            let target: String = row.get(2)?;
            Ok((id, kind_str, target))
        })?;
        let mut result = Vec::new();
        for row in rows {
            let (id, kind_str, target) = row?;
            let kind = kind_str.parse().map_err(StoreError::InvalidArtifactKind)?;
            result.push(Artifact::new(id, kind, target));
        }
        Ok(result)
    }

    pub fn record_artifact(&mut self, run_id: &str, artifact: Artifact) -> Result<i64, StoreError> {
        self.append(&Event::new(run_id, EventKind::ArtifactCreated(artifact)))
    }

    pub fn runs(&self) -> Result<Vec<(String, RunState)>, StoreError> {
        let mut statement = self
            .connection
            .prepare("SELECT id, state FROM runs ORDER BY created_at DESC, rowid DESC")?;
        let rows = statement.query_map([], |row| {
            let id: String = row.get(0)?;
            let state_str: String = row.get(1)?;
            Ok((id, state_str))
        })?;
        let mut result = Vec::new();
        for row in rows {
            let (id, state_str) = row?;
            let state = state_str.parse().map_err(StoreError::InvalidRunState)?;
            result.push((id, state));
        }
        Ok(result)
    }

    pub fn purge_plan(&self, policy: RetentionPolicy) -> Result<PurgePlan, StoreError> {
        let runs = self.runs()?;
        let plan = policy.evaluate_runs(runs.iter().map(|(id, state)| (id.as_str(), *state)));
        Ok(plan)
    }

    pub fn purge_run(&mut self, run_id: &str) -> Result<bool, StoreError> {
        let mut statement = self
            .connection
            .prepare("SELECT state FROM runs WHERE id = ?1")?;
        let mut rows = statement.query([run_id])?;
        let Some(row) = rows.next()? else {
            // Already purged or does not exist: idempotent
            return Ok(false);
        };
        let state_str: String = row.get(0)?;
        let state: RunState = state_str.parse().map_err(StoreError::InvalidRunState)?;

        if !state.is_terminal() {
            let refusal = loop_core::policy::evaluate_run_record_removal(run_id, state);
            if let Err(refusal) = refusal {
                return Err(StoreError::CleanupRefused(refusal));
            }
        }

        self.connection
            .execute("DELETE FROM runs WHERE id = ?1", [run_id])?;
        Ok(true)
    }

    pub fn delete_run(&mut self, run_id: &str) -> Result<bool, StoreError> {
        self.purge_run(run_id)
    }

    pub fn purge(&mut self, policy: RetentionPolicy) -> Result<PurgePlan, StoreError> {
        let plan = self.purge_plan(policy)?;
        for action in &plan.actions {
            self.purge_run(&action.target)?;
        }
        Ok(plan)
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

fn database_now_ms(connection: &Connection) -> Result<i64, StoreError> {
    Ok(connection.query_row(
        "SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)",
        [],
        |row| row.get(0),
    )?)
}

fn require_execution_owner(
    connection: &Connection,
    run_id: &str,
    owner: Option<&str>,
    now: i64,
) -> Result<(), StoreError> {
    let lease: Option<(String, i64)> = connection
        .query_row(
            "SELECT owner, expires_at FROM execution_leases WHERE run_id = ?1",
            [run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match (lease, owner) {
        (None, None) => Ok(()),
        (Some((lease_owner, expires_at)), Some(owner))
            if lease_owner == owner && expires_at > now =>
        {
            Ok(())
        }
        _ => Err(StoreError::ExecutionOwnerRequired),
    }
}

fn load_projection(connection: &Connection, run_id: &str) -> Result<RunProjection, StoreError> {
    let cached: Option<String> = connection.query_row(
        "SELECT data_json FROM projection_cache WHERE run_id = ?1 AND version = 1 AND seq = (SELECT max(seq) FROM events WHERE run_id = ?1)",
        [run_id], |row| row.get(0),
    ).optional()?;
    if let Some(data) = cached {
        if let Ok(projection) = serde_json::from_str(&data) {
            return Ok(projection);
        }
    }
    let mut statement =
        connection.prepare("SELECT payload_json FROM events WHERE run_id = ?1 ORDER BY seq")?;
    let events = statement.query_map([run_id], |row| row.get::<_, String>(0))?;
    let mut projection = RunProjection::default();
    for event in events {
        projection.apply(&serde_json::from_str(&event?)?)?;
    }
    if projection.run_id.is_none() {
        return Err(StoreError::RunNotFound(run_id.into()));
    }
    Ok(projection)
}

fn apply_indexes(transaction: &Transaction<'_>, event: &Event) -> Result<(), StoreError> {
    match &event.kind {
        EventKind::RunConfigured { .. }
        | EventKind::GuidanceAdded { .. }
        | EventKind::TaskOutputRecorded { .. }
        | EventKind::CheckReceiptsRecorded { .. }
        | EventKind::TaskActivityRecorded { .. } => {}
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
        EventKind::RunPauseRequested => {}
        EventKind::RunPaused => update_run_state(transaction, &event.run_id, "paused")?,
        EventKind::RunCancellationRequested => {
            update_run_state(transaction, &event.run_id, "cancelling")?
        }
        EventKind::VerificationStopped { task_id } => {
            if !run_is_cancelling(transaction, &event.run_id)? {
                insert_attention(
                    transaction,
                    &event.run_id,
                    &verification_recovery_attention(&event.run_id, task_id),
                )?;
            }
        }
        EventKind::TaskExecutionReconciled { task_id } => {
            transaction.execute("UPDATE workers SET state = 'cancelled' WHERE run_id = ?1 AND task_id = ?2 AND state = 'running'", params![event.run_id, task_id.to_string()])?;
        }
        EventKind::WorkerStopped { task_id, worker_id } => {
            transaction.execute(
                "UPDATE workers SET state = 'cancelled' WHERE id = ?1 AND run_id = ?2",
                params![worker_id, event.run_id],
            )?;
            if !run_is_cancelling(transaction, &event.run_id)? {
                insert_attention(
                    transaction,
                    &event.run_id,
                    &worker_recovery_attention(&event.run_id, task_id, worker_id),
                )?;
            }
        }
        EventKind::RunCancelled => update_run_state(transaction, &event.run_id, "cancelled")?,
        EventKind::RunResumed => update_run_state(transaction, &event.run_id, "active")?,
        EventKind::ArtifactCreated(artifact) => {
            transaction.execute(
                "INSERT INTO artifacts (id, run_id, kind, content_ref, metadata_json) VALUES (?1, ?2, ?3, ?4, '{}')",
                params![artifact.id, event.run_id, artifact.kind.to_string(), artifact.target],
            )?;
        }
        EventKind::ArtifactRemovalRequested { .. } => {}
        EventKind::ArtifactRemoved { artifact_id, .. } => {
            transaction.execute(
                "DELETE FROM artifacts WHERE id = ?1 AND run_id = ?2",
                params![artifact_id, event.run_id],
            )?;
        }
    }
    Ok(())
}

fn run_is_cancelling(transaction: &Transaction<'_>, run_id: &str) -> Result<bool, StoreError> {
    Ok(transaction.query_row(
        "SELECT state = 'cancelling' FROM runs WHERE id = ?1",
        [run_id],
        |row| row.get(0),
    )?)
}

fn insert_attention(
    transaction: &Transaction<'_>,
    run_id: &str,
    attention: &loop_core::attention::Attention,
) -> Result<(), StoreError> {
    transaction.execute(
        "INSERT INTO attention (id, run_id, kind, state, data_json) VALUES (?1, ?2, ?3, 'open', ?4)",
        params![
            attention.id,
            run_id,
            format!("{:?}", attention.kind).to_lowercase(),
            serde_json::to_string(attention)?
        ],
    )?;
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
    #[error("execution lease requires a non-empty owner and a TTL between 1 and 60 seconds")]
    InvalidLease,
    #[error("an active, matching execution owner is required")]
    ExecutionOwnerRequired,
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
    #[error("invalid artifact kind: {0}")]
    InvalidArtifactKind(String),
    #[error("invalid run state: {0}")]
    InvalidRunState(String),
    #[error(transparent)]
    CleanupRefused(#[from] CleanupRefusal),
}
