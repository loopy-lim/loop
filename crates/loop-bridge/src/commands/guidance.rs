//! Guidance·attention commands: durable decision records, attention
//! request/resolution, and the M-TL2 guidance delivery watermark.

use super::{CompletionCheckInput, OperationOutput, append, append_owned, bridge_error, store};
use loop_core::attention::{
    Attention, AttentionKind, AttentionResolution, CorrectiveTask, FailureDirective,
};
use loop_core::event::{Event, EventKind, RunProjection};
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskId, TaskKind, TaskState, WorkOwnership,
};
use rustra::prelude::*;

use crate::events::GuidanceDeliveredEvent;

#[bridge_type]
pub struct RecordGuidanceDeliveredInput {
    pub database_path: String,
    pub run_id: String,
    pub guidance: GuidanceDeliveredEvent,
    pub execution_owner: Option<String>,
}

#[bridge_type]
pub struct DecisionInput {
    pub database_path: String,
    pub run_id: String,
    pub decision_id: String,
    pub task_id: Option<String>,
    pub value: String,
}

#[bridge_type]
pub struct ResolveAttentionInput {
    pub database_path: String,
    pub run_id: String,
    pub attention_id: String,
    pub resolution: String,
    /// Corrective-task contract, required by — and only valid with — the
    /// `add_task` failure directive.
    pub corrective_task: Option<CorrectiveTaskInput>,
}

#[bridge_type]
pub struct CorrectiveTaskInput {
    pub id: String,
    pub title: String,
    pub write_scope: Vec<String>,
    pub requirements: Vec<String>,
    pub completion_checks: Vec<CompletionCheckInput>,
}

#[bridge_type]
pub struct RequestAttentionInput {
    pub database_path: String,
    pub run_id: String,
    pub attention_id: String,
    pub kind: AttentionKind,
    pub summary: String,
    pub task_id: Option<String>,
    pub execution_owner: Option<String>,
}

pub(crate) fn register_decision_attention(
    builder: rustra::PackageBuilder,
) -> rustra::PackageBuilder {
    register!(
        builder,
        record_decision,
        request_attention,
        resolve_attention
    )
}

pub(crate) fn register_guidance_delivery(
    builder: rustra::PackageBuilder,
) -> rustra::PackageBuilder {
    register!(builder, record_guidance_delivered)
}

/// Records that a live worker received guidance up to `through_sequence`
/// (ADR M-TL2 delivery watermark). The store's reducer enforces the
/// ascending-only watermark per task, so an out-of-order or duplicate
/// delivery record fails here instead of regressing the projection.
#[command]
pub fn record_guidance_delivered(input: RecordGuidanceDeliveredInput) -> Result<OperationOutput> {
    if input.guidance.worker_id.trim().is_empty() {
        return Err(bridge_error(
            "invalid_guidance_delivery",
            "worker id is required",
        ));
    }
    if input.guidance.through_sequence <= 0 {
        return Err(bridge_error(
            "invalid_guidance_delivery",
            "through_sequence must be a positive event-log sequence",
        ));
    }
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::GuidanceDelivered {
                task_id: TaskId::from(input.guidance.task_id),
                worker_id: input.guidance.worker_id,
                through_sequence: input.guidance.through_sequence,
            },
        ),
        input.execution_owner.as_deref(),
    )
}

#[command]
pub fn record_decision(input: DecisionInput) -> Result<OperationOutput> {
    append(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::DecisionRecorded {
                decision_id: input.decision_id,
                task_id: input.task_id.map(TaskId::from),
                value: input.value,
            },
        ),
    )
}

#[command]
pub fn resolve_attention(input: ResolveAttentionInput) -> Result<OperationOutput> {
    let resolution = parse_resolution(&input.resolution, input.corrective_task)?;
    let mut store = store(&input.database_path)?;
    let projection = store
        .projection(&input.run_id)
        .map_err(|error| bridge_error("run_not_found", error))?;
    let mut attention = projection
        .attention
        .get(&input.attention_id)
        .ok_or_else(|| bridge_error("attention_not_found", &input.attention_id))?
        .clone();
    // Pre-validate against the core acceptance rules so the wire error names
    // the actual violation (kind mismatch, free text on failure, malformed
    // corrective contract) instead of a failed batch append. The durable
    // append re-runs the same rules race-free.
    attention
        .resolve(resolution.clone())
        .map_err(|error| bridge_error("invalid_resolution", error))?;
    let mut events = vec![Event::new(
        &input.run_id,
        EventKind::AttentionResolved {
            attention_id: input.attention_id,
            resolution: resolution.clone(),
        },
    )];
    // Directive effects and legacy verdict effects stay in one place: the
    // dispatch is on the core vocabulary, so a directive can never grow a
    // bridge-only meaning.
    match resolution.as_failure_directive() {
        Some(FailureDirective::Retry) => {
            if let Some(task_id) = attention.task_id.clone() {
                redispatch_ready_events(&projection, &input.run_id, task_id, &mut events)?;
            }
        }
        Some(FailureDirective::AddTask(corrective)) => {
            let task_id = attention.task_id.clone().ok_or_else(|| {
                bridge_error(
                    "invalid_resolution",
                    "the add_task directive requires a task-bound failure attention",
                )
            })?;
            if projection.tasks.contains_key(&corrective.id) {
                return Err(bridge_error(
                    "invalid_task",
                    format!("corrective task already exists: {}", corrective.id),
                ));
            }
            let created = Event::new(
                &input.run_id,
                EventKind::TaskCreated(corrective_task_spec(&corrective)?),
            );
            events.push(created);
            events.push(Event::new(
                &input.run_id,
                EventKind::TaskDependencyAdded {
                    task_id: task_id.clone(),
                    depends_on: corrective.id,
                },
            ));
            redispatch_ready_events(&projection, &input.run_id, task_id, &mut events)?;
        }
        // Defer closes the attention only: the failed task stays parked in
        // Attention until an explicit later re-dispatch (updateTask).
        Some(FailureDirective::Defer) => {}
        Some(FailureDirective::Cancel) | None => {
            if let AttentionResolution::Answer(message) = &resolution {
                events.push(Event::new(
                    &input.run_id,
                    EventKind::GuidanceAdded {
                        task_id: attention.task_id.clone(),
                        message: message.clone(),
                    },
                ));
            }
            if matches!(
                resolution,
                AttentionResolution::Cancel | AttentionResolution::Rejected(_)
            ) {
                events.push(Event::new(
                    &input.run_id,
                    if projection.has_in_flight_work() {
                        EventKind::RunCancellationRequested
                    } else {
                        EventKind::RunCancelled
                    },
                ));
            }
        }
    }
    super::append_batch_and_notify(&mut store, &events, "attention_resolution_failed")?;
    Ok(OperationOutput { accepted: true })
}

/// Parses the wire resolution string into the core vocabulary. Free text
/// stays an `Answer` — core rejects it for failure attentions, which is the
/// pinned contract that failure resolutions are directives, not prose.
fn parse_resolution(
    resolution: &str,
    corrective_task: Option<CorrectiveTaskInput>,
) -> Result<AttentionResolution> {
    if corrective_task.is_some() && resolution != "add_task" {
        return Err(bridge_error(
            "invalid_resolution",
            "corrective_task is only valid with the add_task directive",
        ));
    }
    match resolution {
        "approved" => Ok(AttentionResolution::Approved),
        "retry" => Ok(AttentionResolution::Retry),
        "defer" => Ok(AttentionResolution::Defer),
        "cancel" => Ok(AttentionResolution::Cancel),
        "add_task" => {
            let corrective = corrective_task.ok_or_else(|| {
                bridge_error(
                    "invalid_resolution",
                    "the add_task directive requires a corrective_task payload",
                )
            })?;
            Ok(AttentionResolution::AddTask(corrective_task_from_input(
                corrective,
            )))
        }
        "rejected" => Ok(AttentionResolution::Rejected("rejected".into())),
        value if value.starts_with("rejected:") => Ok(AttentionResolution::Rejected(
            value.trim_start_matches("rejected:").trim().to_string(),
        )),
        value if !value.trim().is_empty() => Ok(AttentionResolution::Answer(value.to_string())),
        _ => Err(bridge_error("invalid_resolution", "resolution is required")),
    }
}

fn corrective_task_from_input(input: CorrectiveTaskInput) -> CorrectiveTask {
    CorrectiveTask::new(
        input.id,
        input.title,
        input.write_scope,
        input.requirements,
        input.completion_checks.into_iter().map(|check| {
            CompletionCheck::command(
                check.id,
                check.command,
                check.args,
                check.working_directory,
                check.timeout_ms,
            )
        }),
    )
}

/// Derives the corrective task from the directive contract: an
/// implementation-kind task whose write scope is exactly the one the resolver
/// fixed, so a repair cannot widen its blast radius beyond the decision
/// record.
fn corrective_task_spec(corrective: &CorrectiveTask) -> Result<Task> {
    Task::builder(
        corrective.id.clone(),
        corrective.title.clone(),
        TaskKind::Implementation,
    )
    .ownership(WorkOwnership::new(
        std::iter::empty::<String>(),
        corrective.write_scope.clone(),
    ))
    .requirements(corrective.requirements.clone())
    .completion_contract(CompletionContract::new(
        corrective.completion_checks.iter().cloned(),
    ))
    .build()
    .map_err(|error| bridge_error("invalid_task", error))
}

/// The shared re-dispatch contract of the `retry` and `add_task` directives:
/// only queued (pending/ready) or parked (attention/failed) work can be
/// re-dispatched, and never past an explicit reconciliation.
fn redispatch_ready_events(
    projection: &RunProjection,
    run_id: &str,
    task_id: TaskId,
    events: &mut Vec<Event>,
) -> Result<()> {
    let state = projection
        .tasks
        .get(&task_id)
        .ok_or_else(|| bridge_error("task_not_found", &task_id))?
        .state;
    match state {
        TaskState::Pending | TaskState::Ready => Ok(()),
        TaskState::Attention | TaskState::Failed => {
            events.push(Event::new(run_id, EventKind::TaskReady(task_id)));
            Ok(())
        }
        TaskState::Blocked => Err(bridge_error(
            "invalid_retry",
            "terminally blocked dependent work cannot be retried",
        )),
        TaskState::Running | TaskState::Verifying | TaskState::Cancelled => Err(bridge_error(
            "reconciliation_required",
            "running, verifying, or stopped work must be explicitly reconciled before retry",
        )),
        TaskState::Done => Err(bridge_error(
            "invalid_retry",
            "completed work cannot be retried",
        )),
    }
}

#[command]
pub fn request_attention(input: RequestAttentionInput) -> Result<OperationOutput> {
    if input.summary.trim().is_empty() {
        return Err(bridge_error("invalid_attention", "summary is required"));
    }
    let attention = match input.task_id {
        Some(task_id) => Attention::for_task(
            input.attention_id,
            input.kind,
            input.summary,
            TaskId::from(task_id),
        ),
        None => Attention::new(input.attention_id, input.kind, input.summary),
    };
    let event = Event::new(input.run_id, EventKind::AttentionCreated(attention));
    match input.execution_owner.as_deref() {
        Some(owner) => append_owned(&input.database_path, event, Some(owner)),
        None => append(&input.database_path, event),
    }
}
