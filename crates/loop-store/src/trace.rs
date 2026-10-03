//! Deterministic trace queries over persisted run events.
//!
//! Aggregation runs in SQLite (event-kind counts, recorded time window) plus
//! one sequence-ordered scan for per-task rows, so persona benchmark
//! comparison and self-trace reports read the same numbers without joining
//! data in the adapter layer.

use std::collections::btree_map::Entry;
use std::collections::BTreeMap;

use loop_core::benchmark::TraceSummary;
use loop_core::event::{Event, EventKind};
use rusqlite::Connection;

use crate::sqlite::{SqliteStore, StoreError};

const WINDOW_SQL: &str =
    "SELECT count(*), min(created_at), max(created_at) FROM events WHERE run_id = ?1";

const KIND_COUNT_SQL: &str = "SELECT json_extract(payload_json, '$.kind.type') AS kind, count(*) \
     FROM events WHERE run_id = ?1 GROUP BY kind ORDER BY kind";

const TASK_SCAN_SQL: &str =
    "SELECT seq, payload_json, created_at FROM events WHERE run_id = ?1 ORDER BY seq ASC";

/// Per-task aggregation derived from one run's ordered events.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct TaskTrace {
    pub task_id: String,
    /// Worker starts observed for the task, one per attempt.
    pub attempts: u32,
    pub worker_failures: u32,
    pub verification_failures: u32,
    pub verification_passes: u32,
    /// Attention events attributed to the task.
    pub attention_created: u32,
    pub first_ready_seq: Option<i64>,
    pub first_started_seq: Option<i64>,
    pub output_recorded_seq: Option<i64>,
    pub completed_seq: Option<i64>,
    pub first_ready_at: Option<i64>,
    pub completed_at: Option<i64>,
}

impl TaskTrace {
    /// Ready-to-completion wall time in milliseconds, from recorded timestamps.
    pub fn duration_ms(&self) -> Option<u64> {
        Some(i64::max(0, self.completed_at? - self.first_ready_at?) as u64 * 1000)
    }

    /// Ready-to-completion distance in event-sequence steps.
    pub fn duration_events(&self) -> Option<u64> {
        Some(i64::max(0, self.completed_seq? - self.first_ready_seq?) as u64)
    }
}

/// Aggregated trace for one persisted run.
///
/// `summary` is the loop-core primitive with `elapsed_ms` filled from the
/// recorded event timestamps; `tasks` is ordered by first appearance in the
/// run's event sequence, so reports are stable for identical run data.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RunTraceReport {
    pub run_id: String,
    pub summary: TraceSummary,
    pub first_event_at: Option<i64>,
    pub last_event_at: Option<i64>,
    pub tasks: Vec<TaskTrace>,
}

impl SqliteStore {
    /// Aggregate one run's persisted events into a trace report.
    pub fn trace_report(&self, run_id: &str) -> Result<RunTraceReport, StoreError> {
        // `trace_reports` yields exactly one report per requested id, so a
        // single-id request always produces a single report; a missing entry
        // degrades to the existing not-found error instead of panicking.
        let mut reports = self.trace_reports(std::slice::from_ref(&run_id))?;
        reports
            .pop()
            .ok_or_else(|| StoreError::RunNotFound(run_id.to_string()))
    }

    /// Aggregate several runs, preserving the given input order.
    pub fn trace_reports(&self, run_ids: &[&str]) -> Result<Vec<RunTraceReport>, StoreError> {
        run_ids
            .iter()
            .map(|run_id| self.load_report(run_id))
            .collect()
    }

    /// Run-labeled summaries in input order, ready for
    /// `loop_core::benchmark::compare_traces`.
    pub fn trace_summaries(
        &self,
        run_ids: &[&str],
    ) -> Result<Vec<(String, TraceSummary)>, StoreError> {
        Ok(self
            .trace_reports(run_ids)?
            .into_iter()
            .map(|report| (report.run_id, report.summary))
            .collect())
    }

    fn load_report(&self, run_id: &str) -> Result<RunTraceReport, StoreError> {
        let (total_events, first_event_at, last_event_at) =
            self.connection.query_row(WINDOW_SQL, [run_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            })?;
        if total_events == 0 {
            return Err(StoreError::RunNotFound(run_id.to_string()));
        }
        let total_events = u32::try_from(total_events).unwrap_or(u32::MAX);

        let mut summary = TraceSummary {
            total_events,
            elapsed_ms: elapsed_ms(first_event_at, last_event_at),
            ..TraceSummary::default()
        };
        let mut statement = self.connection.prepare(KIND_COUNT_SQL)?;
        let rows = statement.query_map([run_id], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (kind, count) = row?;
            if let Some(kind) = kind {
                add_kind(
                    &mut summary,
                    &kind,
                    u32::try_from(count).unwrap_or(u32::MAX),
                );
            }
        }

        let tasks = scan_tasks(&self.connection, run_id)?;
        Ok(RunTraceReport {
            run_id: run_id.to_string(),
            summary,
            first_event_at,
            last_event_at,
            tasks,
        })
    }
}

/// Map a serialized `EventKind` tag onto its summary counter. Unknown kinds
/// count only toward `total_events`; a drift test pins this mapping against
/// `TraceSummary::from_events`.
fn add_kind(summary: &mut TraceSummary, kind: &str, count: u32) {
    match kind {
        "task_created" => summary.tasks_created += count,
        "task_completed" => summary.tasks_completed += count,
        "worker_started" => summary.worker_starts += count,
        "worker_finished" => summary.worker_finishes += count,
        "worker_failed" => summary.worker_failures += count,
        "verification_passed" => summary.verification_passes += count,
        "verification_failed" => summary.verification_failures += count,
        "attention_created" => summary.attention_created += count,
        "attention_resolved" => summary.attention_resolved += count,
        _ => {}
    }
}

fn scan_tasks(connection: &Connection, run_id: &str) -> Result<Vec<TaskTrace>, StoreError> {
    let mut order: Vec<String> = Vec::new();
    let mut rows: BTreeMap<String, TaskTrace> = BTreeMap::new();
    let mut statement = connection.prepare(TASK_SCAN_SQL)?;
    let mut events = statement.query([run_id])?;
    while let Some(row) = events.next()? {
        let seq: i64 = row.get(0)?;
        let payload: String = row.get(1)?;
        let created_at: i64 = row.get(2)?;
        let event: Event = serde_json::from_str(&payload)?;
        let Some(key) = task_key(&event) else {
            continue;
        };
        // The entry API keeps the invariant (every key in `order` exists in
        // `rows`) true by construction instead of asserting it after lookup.
        let task = match rows.entry(key.clone()) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => {
                order.push(key.clone());
                entry.insert(TaskTrace {
                    task_id: key.clone(),
                    ..TaskTrace::default()
                })
            }
        };
        match &event.kind {
            EventKind::TaskReady(_) => {
                if task.first_ready_seq.is_none() {
                    task.first_ready_seq = Some(seq);
                    task.first_ready_at = Some(created_at);
                }
            }
            EventKind::WorkerStarted { .. } => {
                task.attempts += 1;
                task.first_started_seq.get_or_insert(seq);
            }
            EventKind::WorkerFailed { .. } => task.worker_failures += 1,
            EventKind::VerificationFailed { .. }
            | EventKind::VerificationClassifiedFailure { .. } => {
                task.verification_failures += 1;
            }
            EventKind::VerificationPassed { .. } => {
                task.verification_passes += 1;
                mark_completed(task, seq, created_at);
            }
            EventKind::TaskCompleted(_) => mark_completed(task, seq, created_at),
            EventKind::TaskOutputRecorded { .. } => {
                task.output_recorded_seq.get_or_insert(seq);
            }
            EventKind::AttentionCreated(_) => task.attention_created += 1,
            _ => {}
        }
    }
    // `order` only records keys inserted into `rows` above, so removal is
    // total; `filter_map` keeps the collection panic-free while preserving
    // the input order for identical run data.
    Ok(order
        .into_iter()
        .filter_map(|id| rows.remove(&id))
        .collect())
}

fn task_key(event: &Event) -> Option<String> {
    match &event.kind {
        EventKind::TaskCreated(task) => Some(task.id.as_str().to_owned()),
        EventKind::TaskReady(task_id)
        | EventKind::TaskOutputRecorded { task_id, .. }
        | EventKind::WorkerStarted { task_id, .. }
        | EventKind::WorkerFinished { task_id, .. }
        | EventKind::WorkerFailed { task_id, .. }
        | EventKind::VerificationPassed { task_id, .. }
        | EventKind::VerificationFailed { task_id, .. }
        | EventKind::VerificationClassifiedFailure { task_id, .. }
        | EventKind::TaskCompleted(task_id) => Some(task_id.as_str().to_owned()),
        EventKind::AttentionCreated(attention) => attention
            .task_id
            .as_ref()
            .map(|task_id| task_id.as_str().to_owned()),
        _ => None,
    }
}

fn mark_completed(task: &mut TaskTrace, seq: i64, created_at: i64) {
    if task.completed_seq.is_none() {
        task.completed_seq = Some(seq);
        task.completed_at = Some(created_at);
    }
}

fn elapsed_ms(first_event_at: Option<i64>, last_event_at: Option<i64>) -> Option<u64> {
    Some(i64::max(0, last_event_at? - first_event_at?) as u64 * 1000)
}
