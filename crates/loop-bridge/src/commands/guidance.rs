//! Guidance·attention commands: durable decision records, attention
//! request/resolution, and the M-TL2 guidance delivery watermark.

use super::{append, append_owned, bridge_error, store, OperationOutput};
use loop_core::attention::{Attention, AttentionKind, AttentionResolution};
use loop_core::event::{Event, EventKind};
use loop_core::task::{TaskId, TaskState};
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
    register!(builder, record_decision, request_attention, resolve_attention)
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
    let resolution = match input.resolution.as_str() {
        "approved" => AttentionResolution::Approved,
        "retry" => AttentionResolution::Retry,
        "cancel" => AttentionResolution::Cancel,
        "rejected" => AttentionResolution::Rejected("rejected".into()),
        value if value.starts_with("rejected:") => {
            AttentionResolution::Rejected(value.trim_start_matches("rejected:").trim().to_string())
        }
        value if !value.trim().is_empty() => AttentionResolution::Answer(value.to_string()),
        _ => return Err(bridge_error("invalid_resolution", "resolution is required")),
    };
    let mut store = store(&input.database_path)?;
    let projection = store
        .projection(&input.run_id)
        .map_err(|error| bridge_error("run_not_found", error))?;
    let attention = projection
        .attention
        .get(&input.attention_id)
        .ok_or_else(|| bridge_error("attention_not_found", &input.attention_id))?;
    let mut events = vec![Event::new(
        &input.run_id,
        EventKind::AttentionResolved {
            attention_id: input.attention_id,
            resolution: resolution.clone(),
        },
    )];
    if resolution == AttentionResolution::Retry
        && let Some(task_id) = attention.task_id.clone()
    {
        let state = projection
            .tasks
            .get(&task_id)
            .ok_or_else(|| bridge_error("task_not_found", &task_id))?
            .state;
        match state {
            TaskState::Pending | TaskState::Ready => {}
            TaskState::Attention | TaskState::Failed => {
                events.push(Event::new(&input.run_id, EventKind::TaskReady(task_id)));
            }
            TaskState::Blocked => {
                return Err(bridge_error(
                    "invalid_retry",
                    "terminally blocked dependent work cannot be retried",
                ));
            }
            TaskState::Running | TaskState::Verifying | TaskState::Cancelled => {
                return Err(bridge_error(
                    "reconciliation_required",
                    "running, verifying, or stopped work must be explicitly reconciled before retry",
                ));
            }
            TaskState::Done => {
                return Err(bridge_error(
                    "invalid_retry",
                    "completed work cannot be retried",
                ));
            }
        }
    }
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
    super::append_batch_and_notify(&mut store, &events, "attention_resolution_failed")?;
    Ok(OperationOutput { accepted: true })
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
