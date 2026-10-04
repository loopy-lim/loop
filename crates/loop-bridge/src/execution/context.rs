//! Task context commands: run plan read-back, per-task worker context, check
//! receipts, stop verification, activity and output records.

use super::{decomposition_contract, task_spec};
use crate::commands::{
    append_owned, bridge_error, store, DecompositionContractOutput, OperationOutput, RunInput,
    TaskSpecInput,
};
use loop_core::event::{CheckReceipt, Event, EventKind};
use loop_core::task::{TaskId, TaskState};
use rustra::prelude::*;

#[bridge_type]
pub struct TaskContextInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
}

#[bridge_type]
pub struct DependencyResultOutput {
    pub task_id: String,
    pub title: String,
    pub summary: String,
}

#[bridge_type]
pub struct TaskContextOutput {
    pub intent: String,
    pub working_directory: String,
    pub task: TaskSpecInput,
    pub decomposition_contract: Option<DecompositionContractOutput>,
    pub attempt: u16,
    pub dependency_results: Vec<DependencyResultOutput>,
    pub result_summary: Option<String>,
    pub previous_failure: Option<String>,
    pub previous_checks: Vec<CheckReceipt>,
    pub guidance: Vec<String>,
}

#[bridge_type]
pub struct RunPlanOutput {
    pub intent: String,
    pub working_directory: String,
    pub tasks: Vec<TaskSpecInput>,
}

#[bridge_type]
pub struct RecordCheckReceiptsInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub checks: Vec<CheckReceipt>,
    pub execution_owner: Option<String>,
}

#[bridge_type]
pub struct StopVerificationInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub execution_owner: Option<String>,
}

#[bridge_type]
pub struct RecordActivityInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub activity: String,
    pub execution_owner: Option<String>,
}

#[bridge_type]
pub struct RecordTaskOutputInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub summary: String,
    pub execution_owner: Option<String>,
}

pub(crate) fn register_run_context(
    builder: rustra::PackageBuilder,
) -> rustra::PackageBuilder {
    register!(
        builder,
        get_run_plan,
        get_task_context,
        record_check_receipts,
        stop_verification,
        record_activity,
        record_task_output
    )
}

#[command]
pub fn get_run_plan(input: RunInput) -> Result<RunPlanOutput> {
    let projection = store(&input.database_path)?
        .projection(&input.run_id)
        .map_err(|e| bridge_error("run_not_found", e))?;
    Ok(RunPlanOutput {
        intent: projection.intent,
        working_directory: projection.working_directory,
        tasks: projection.tasks.values().map(task_spec).collect(),
    })
}

#[command]
pub fn get_task_context(input: TaskContextInput) -> Result<TaskContextOutput> {
    let projection = store(&input.database_path)?
        .projection(&input.run_id)
        .map_err(|e| bridge_error("run_not_found", e))?;
    let id = TaskId::from(input.task_id);
    let task = projection
        .tasks
        .get(&id)
        .ok_or_else(|| bridge_error("task_not_found", &id))?;
    let dependency_results = task
        .dependencies
        .iter()
        .filter_map(|id| {
            let dependency = projection.tasks.get(id)?;
            if dependency.state != TaskState::Done {
                return None;
            }
            Some(DependencyResultOutput {
                task_id: id.to_string(),
                title: dependency.title.clone(),
                summary: projection.outputs.get(id).cloned().unwrap_or_default(),
            })
        })
        .collect();
    let guidance = projection
        .guidance
        .iter()
        .filter(|item| item.task_id.as_ref().is_none_or(|target| target == &id))
        .map(|item| item.message.clone())
        .collect();
    Ok(TaskContextOutput {
        intent: projection.intent.clone(),
        working_directory: projection.working_directory.clone(),
        task: task_spec(task),
        decomposition_contract: decomposition_contract(task),
        attempt: task.attempt,
        dependency_results,
        result_summary: projection.outputs.get(&id).cloned(),
        previous_failure: projection.failures.get(&id).cloned(),
        previous_checks: projection.checks.get(&id).cloned().unwrap_or_default(),
        guidance,
    })
}

#[command]
pub fn record_check_receipts(input: RecordCheckReceiptsInput) -> Result<OperationOutput> {
    let projection = store(&input.database_path)?
        .projection(&input.run_id)
        .map_err(|error| bridge_error("snapshot_failed", error))?;
    let task_id = TaskId::from(input.task_id);
    let task = projection
        .tasks
        .get(&task_id)
        .ok_or_else(|| bridge_error("task_not_found", &task_id))?;
    let mut checks = input.checks;
    for check in &mut checks {
        if let Some(source) = &mut check.source {
            source.observed_outside_write_scope = task
                .ownership
                .observed_outside_write_scope(&source.observed_changed_paths);
        }
    }
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::CheckReceiptsRecorded { task_id, checks },
        ),
        input.execution_owner.as_deref(),
    )
}

#[command]
pub fn stop_verification(input: StopVerificationInput) -> Result<OperationOutput> {
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::VerificationStopped {
                task_id: TaskId::from(input.task_id),
            },
        ),
        input.execution_owner.as_deref(),
    )
}

#[command]
pub fn record_activity(input: RecordActivityInput) -> Result<OperationOutput> {
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::TaskActivityRecorded {
                task_id: TaskId::from(input.task_id),
                activity: input.activity,
            },
        ),
        input.execution_owner.as_deref(),
    )
}

#[command]
pub fn record_task_output(input: RecordTaskOutputInput) -> Result<OperationOutput> {
    if input.summary.trim().is_empty() {
        return Err(bridge_error(
            "invalid_output",
            "task output summary is required",
        ));
    }
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::TaskOutputRecorded {
                task_id: TaskId::from(input.task_id),
                summary: input.summary,
            },
        ),
        input.execution_owner.as_deref(),
    )
}
