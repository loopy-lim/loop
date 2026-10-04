//! Run lifecycle commands: creation, pause/resume/cancel, snapshots, the run
//! graph projection, and event subscription.

use super::{append, append_and_notify, bridge_error, store, OperationOutput};
use loop_core::attention::AttentionKind;
use loop_core::event::{Event, EventKind};
use loop_core::policy::ComputeClass;
use loop_core::run::RunState;
use loop_core::task::{TaskKind, TaskState};
use loop_store::SqliteStore;
use rustra::prelude::*;

use crate::events::EventOutput;

#[bridge_type]
pub struct CreateRunInput {
    pub database_path: String,
    pub run_id: String,
}

#[bridge_type]
pub struct RunInput {
    pub database_path: String,
    pub run_id: String,
}

#[bridge_type]
pub struct SubscribeEventsInput {
    pub database_path: String,
    pub run_id: String,
    pub after_sequence: i64,
    pub limit: u16,
}

#[bridge_type]
pub struct TaskSnapshotOutput {
    pub id: String,
    pub title: String,
    pub kind: TaskKind,
    pub state: TaskState,
    pub attempt: u16,
    pub preferred_compute: ComputeClass,
    pub dependencies: Vec<String>,
    pub read_scope: Vec<String>,
    pub write_scope: Vec<String>,
    pub blocked_by: Vec<String>,
    pub last_failure: Option<String>,
    pub activities: Vec<String>,
    /// Epoch milliseconds of the latest durable worker start or task activity.
    /// Includes sub-second precision for newly recorded events.
    pub last_progress_ms: Option<i64>,
    pub result_summary: Option<String>,
}

#[bridge_type]
pub struct RunGraphInput {
    pub database_path: String,
    pub run_id: String,
    pub now_ms: i64,
}

#[bridge_type]
pub enum GraphOwnerHealth {
    Live,
    Missing,
    Expired,
    Inactive,
}

#[bridge_type]
pub struct GraphNodeOutput {
    pub id: String,
    pub title: String,
    pub kind: TaskKind,
    pub state: TaskState,
    pub dependencies: Vec<String>,
    pub blocked_by: Vec<String>,
    pub read_scope: Vec<String>,
    pub write_scope: Vec<String>,
    pub workers: Vec<String>,
    pub attempt: u16,
    pub result_summary: Option<String>,
    pub last_failure: Option<String>,
}

#[bridge_type]
pub struct RunGraphOutput {
    pub run_id: String,
    pub state: RunState,
    pub last_sequence: String,
    pub owner_health: GraphOwnerHealth,
    pub open_attention_count: u32,
    pub nodes: Vec<GraphNodeOutput>,
}

#[bridge_type]
pub struct ActiveWorkerOutput {
    pub id: String,
    pub task_id: String,
}

#[bridge_type]
pub struct SnapshotOutput {
    pub run_id: String,
    pub state: RunState,
    pub tasks: Vec<TaskSnapshotOutput>,
    pub active_workers: Vec<ActiveWorkerOutput>,
    pub open_attention_ids: Vec<String>,
    pub attention: Vec<AttentionSnapshotOutput>,
    pub intent: String,
    pub working_directory: String,
    pub guidance: Vec<String>,
    pub goal_criteria: Vec<GoalCriterionStatusOutput>,
    pub last_sequence: i64,
    pub execution_owner: Option<String>,
    pub execution_expires_at: Option<i64>,
}

#[bridge_type]
pub struct GoalCriterionStatusOutput {
    pub id: String,
    pub description: String,
    pub task_id: String,
    pub check_ids: Vec<String>,
    pub state: loop_core::event::GoalCriterionState,
}

#[bridge_type]
pub struct AttentionSnapshotOutput {
    pub opened_at_ms: Option<i64>,
    pub id: String,
    pub kind: AttentionKind,
    pub summary: String,
    pub task_id: Option<String>,
}

pub(crate) fn register_run_entry(
    builder: rustra::PackageBuilder,
) -> rustra::PackageBuilder {
    register!(builder, create_run, get_run)
}

pub(crate) fn register_run_lifecycle(
    builder: rustra::PackageBuilder,
) -> rustra::PackageBuilder {
    register!(builder, cancel_run, pause_run, confirm_paused)
}

pub(crate) fn register_run_queries(
    builder: rustra::PackageBuilder,
) -> rustra::PackageBuilder {
    register!(builder, resume_run, get_snapshot, get_run_graph, subscribe_events)
}

#[command]
pub fn create_run(input: CreateRunInput) -> Result<SnapshotOutput> {
    let mut store = store(&input.database_path)?;
    let event = Event::new(&input.run_id, EventKind::RunCreated);
    append_and_notify(&mut store, &event, "create_run_failed")?;
    snapshot(&store, &input.run_id)
}

#[command]
pub fn get_run(input: RunInput) -> Result<SnapshotOutput> {
    get_snapshot(input)
}

#[command]
pub fn cancel_run(input: RunInput) -> Result<OperationOutput> {
    let current = store(&input.database_path)?
        .projection(&input.run_id)
        .map_err(|error| bridge_error("run_not_found", error))?;
    if current.run_state.is_some_and(RunState::is_terminal) {
        return Ok(OperationOutput { accepted: true });
    }
    let kind = if current.has_in_flight_work() {
        EventKind::RunCancellationRequested
    } else {
        EventKind::RunCancelled
    };
    append(&input.database_path, Event::new(input.run_id, kind))
}

#[command]
pub fn pause_run(input: RunInput) -> Result<OperationOutput> {
    append(
        &input.database_path,
        Event::new(input.run_id, EventKind::RunPauseRequested),
    )
}

#[command]
pub fn confirm_paused(input: RunInput) -> Result<OperationOutput> {
    append(
        &input.database_path,
        Event::new(input.run_id, EventKind::RunPaused),
    )
}

#[command]
pub fn resume_run(input: RunInput) -> Result<OperationOutput> {
    append(
        &input.database_path,
        Event::new(input.run_id, EventKind::RunResumed),
    )
}

#[command]
pub fn get_snapshot(input: RunInput) -> Result<SnapshotOutput> {
    let store = store(&input.database_path)?;
    snapshot(&store, &input.run_id)
}

#[command]
pub fn get_run_graph(input: RunGraphInput) -> Result<RunGraphOutput> {
    let store = store(&input.database_path)?;
    let snapshot = snapshot(&store, &input.run_id)?;
    let owner_health = if snapshot.state != RunState::Active {
        GraphOwnerHealth::Inactive
    } else {
        match snapshot.execution_expires_at {
            Some(expires_at) if expires_at > input.now_ms => GraphOwnerHealth::Live,
            Some(_) => GraphOwnerHealth::Expired,
            None => GraphOwnerHealth::Missing,
        }
    };
    let nodes = snapshot
        .tasks
        .into_iter()
        .map(|task| GraphNodeOutput {
            workers: snapshot
                .active_workers
                .iter()
                .filter(|worker| worker.task_id == task.id)
                .map(|worker| worker.id.clone())
                .collect(),
            id: task.id,
            title: task.title,
            kind: task.kind,
            state: task.state,
            dependencies: task.dependencies,
            blocked_by: task.blocked_by,
            read_scope: task.read_scope,
            write_scope: task.write_scope,
            attempt: task.attempt,
            result_summary: task.result_summary,
            last_failure: task.last_failure,
        })
        .collect();
    Ok(RunGraphOutput {
        run_id: snapshot.run_id,
        state: snapshot.state,
        last_sequence: snapshot.last_sequence.to_string(),
        owner_health,
        open_attention_count: snapshot.open_attention_ids.len() as u32,
        nodes,
    })
}

#[command]
pub fn subscribe_events(input: SubscribeEventsInput) -> Result<Vec<EventOutput>> {
    let store = store(&input.database_path)?;
    store
        .event_records(
            &input.run_id,
            input.after_sequence,
            usize::from(input.limit.max(1)),
        )
        .map_err(|error| bridge_error("events_failed", error))?
        .into_iter()
        .map(|record| {
            Ok(EventOutput {
                sequence: record.sequence,
                payload_json: serde_json::to_string(&record.event)
                    .map_err(|error| bridge_error("event_encode_failed", error))?,
            })
        })
        .collect()
}

fn snapshot(store: &SqliteStore, run_id: &str) -> Result<SnapshotOutput> {
    let projection = store
        .projection(run_id)
        .map_err(|error| bridge_error("snapshot_failed", error))?;
    let state = projection
        .run_state
        .ok_or_else(|| bridge_error("run_not_found", run_id))?;
    let attention: Vec<_> = projection
        .attention
        .values()
        .filter(|item| item.state == loop_core::attention::AttentionState::Open)
        .map(|item| {
            Ok(AttentionSnapshotOutput {
                opened_at_ms: store
                    .attention_opened_ms(run_id, &item.id)
                    .map_err(|error| bridge_error("snapshot_failed", error))?,
                id: item.id.clone(),
                kind: item.kind,
                summary: item.summary.clone(),
                task_id: item.task_id.as_ref().map(ToString::to_string),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let tasks = projection
        .tasks
        .values()
        .map(|task| {
            Ok(TaskSnapshotOutput {
                last_progress_ms: store
                    .last_progress_ms(run_id, task.id.as_str())
                    .map_err(|error| bridge_error("snapshot_failed", error))?,
                id: task.id.to_string(),
                title: task.title.clone(),
                kind: task.kind,
                state: task.state,
                attempt: task.attempt,
                preferred_compute: task.preferred_compute,
                dependencies: task.dependencies.iter().map(ToString::to_string).collect(),
                read_scope: task.ownership.read_scope.clone(),
                write_scope: task.ownership.write_scope.clone(),
                blocked_by: task
                    .dependencies
                    .iter()
                    .filter(|id| {
                        projection
                            .tasks
                            .get(*id)
                            .is_none_or(|dependency| dependency.state != TaskState::Done)
                    })
                    .map(ToString::to_string)
                    .collect(),
                last_failure: projection.failures.get(&task.id).cloned(),
                activities: projection
                    .activities
                    .get(&task.id)
                    .map(|history| history.iter().cloned().collect())
                    .unwrap_or_default(),
                result_summary: projection.outputs.get(&task.id).cloned(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let lease = store
        .execution_lease(run_id)
        .map_err(|error| bridge_error("lease_failed", error))?;
    let goal_criteria = projection
        .goal_criteria_status()
        .into_iter()
        .map(|item| GoalCriterionStatusOutput {
            id: item.criterion.id,
            description: item.criterion.description,
            task_id: item.criterion.task_id.to_string(),
            check_ids: item.criterion.check_ids,
            state: item.state,
        })
        .collect();
    Ok(SnapshotOutput {
        execution_owner: lease.as_ref().map(|(owner, _)| owner.clone()),
        execution_expires_at: lease.map(|(_, expires)| expires),
        run_id: run_id.to_string(),
        state,
        tasks,
        active_workers: projection
            .active_workers
            .iter()
            .map(|(id, task_id)| ActiveWorkerOutput {
                id: id.clone(),
                task_id: task_id.to_string(),
            })
            .collect(),
        open_attention_ids: attention.iter().map(|item| item.id.clone()).collect(),
        attention,
        intent: projection.intent,
        working_directory: projection.working_directory,
        guidance: projection
            .guidance
            .iter()
            .map(|item| item.message.clone())
            .collect(),
        goal_criteria,
        last_sequence: store
            .last_sequence(run_id)
            .map_err(|error| bridge_error("sequence_failed", error))?,
    })
}
