//! Run setup commands: plan/goal-run preparation, goal criteria appends,
//! goal-task corrections, preflight preparation, and run configuration.

use crate::commands::{
    OperationOutput, PreflightTaskSpecInput, TaskSpecInput, append, append_batch_and_notify,
    bridge_error, store, task_from_input, task_from_preflight_input,
};
use loop_core::event::{Event, EventKind, GoalCriterion};
use loop_core::task::{Task, TaskId};
use rustra::prelude::*;

#[bridge_type]
pub struct PrepareRunInput {
    pub database_path: String,
    pub run_id: String,
    pub intent: String,
    pub working_directory: String,
    pub tasks: Vec<TaskSpecInput>,
}

#[bridge_type]
pub struct GoalCriterionInput {
    pub id: String,
    pub description: String,
    pub task_id: String,
    pub check_ids: Vec<String>,
}

#[bridge_type]
pub struct PrepareGoalRunInput {
    pub database_path: String,
    pub run_id: String,
    pub intent: String,
    pub working_directory: String,
    pub tasks: Vec<TaskSpecInput>,
    pub criteria: Vec<GoalCriterionInput>,
}

#[bridge_type]
pub struct AppendGoalCriteriaInput {
    pub database_path: String,
    pub run_id: String,
    pub criteria: Vec<GoalCriterionInput>,
}

#[bridge_type]
pub struct AddGoalTaskInput {
    pub database_path: String,
    pub run_id: String,
    pub task: TaskSpecInput,
    pub criteria: Vec<GoalCriterionInput>,
}

#[bridge_type]
pub struct PrepareRunPreflightInput {
    pub database_path: String,
    pub run_id: String,
    pub intent: String,
    pub working_directory: String,
    pub tasks: Vec<PreflightTaskSpecInput>,
}

#[bridge_type]
pub struct ConfigureRunInput {
    pub database_path: String,
    pub run_id: String,
    pub intent: String,
    pub working_directory: String,
}

pub(crate) fn goal_criteria(inputs: Vec<GoalCriterionInput>) -> Vec<GoalCriterion> {
    inputs
        .into_iter()
        .map(|item| GoalCriterion {
            id: item.id,
            description: item.description,
            task_id: TaskId::from(item.task_id),
            check_ids: item.check_ids,
        })
        .collect()
}

fn ensure_goal_coverage(tasks: &[Task], criteria: &[GoalCriterionInput]) -> Result<()> {
    for task in tasks {
        if task.requirements.is_empty()
            || task.requirements.iter().any(|requirement| {
                requirement.trim().is_empty()
                    || !criteria.iter().any(|criterion| {
                        criterion.task_id == task.id.as_str()
                            && criterion.description == *requirement
                    })
            })
        {
            return Err(bridge_error(
                "invalid_goal",
                format!("task {} has an unmapped requirement", task.id),
            ));
        }
    }
    Ok(())
}

pub(crate) fn register_run_setup(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(
        builder,
        prepare_run,
        prepare_goal_run,
        append_goal_criteria,
        add_goal_task,
        configure_run
    )
}

pub(crate) fn register_preflight(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(builder, prepare_run_preflight)
}

#[command]
pub fn prepare_run(input: PrepareRunInput) -> Result<OperationOutput> {
    if !std::path::Path::new(&input.working_directory).is_absolute() {
        return Err(bridge_error(
            "invalid_context",
            "working directory must be absolute",
        ));
    }
    let tasks = input
        .tasks
        .into_iter()
        .map(task_from_input)
        .collect::<Result<Vec<_>>>()?;
    if tasks.is_empty() {
        return Err(bridge_error("invalid_graph", "plan must contain tasks"));
    }
    loop_core::graph::TaskGraph::new(tasks.clone())
        .map_err(|e| bridge_error("invalid_graph", e))?;
    let mut events = vec![
        Event::new(&input.run_id, EventKind::RunCreated),
        Event::new(
            &input.run_id,
            EventKind::RunConfigured {
                intent: input.intent,
                working_directory: input.working_directory,
            },
        ),
    ];
    events.extend(
        tasks
            .into_iter()
            .map(|task| Event::new(&input.run_id, EventKind::TaskCreated(task))),
    );
    append_batch_and_notify(
        &mut store(&input.database_path)?,
        &events,
        "prepare_run_failed",
    )?;
    Ok(OperationOutput {
        accepted: true,
        ..OperationOutput::default()
    })
}

#[command]
pub fn prepare_goal_run(input: PrepareGoalRunInput) -> Result<OperationOutput> {
    if !std::path::Path::new(&input.working_directory).is_absolute() {
        return Err(bridge_error(
            "invalid_context",
            "working directory must be absolute",
        ));
    }
    if input.criteria.is_empty() {
        return Err(bridge_error(
            "invalid_goal",
            "goal criteria must be non-empty",
        ));
    }
    let tasks = input
        .tasks
        .into_iter()
        .map(task_from_input)
        .collect::<Result<Vec<_>>>()?;
    if tasks.is_empty() {
        return Err(bridge_error("invalid_graph", "plan must contain tasks"));
    }
    loop_core::graph::TaskGraph::new(tasks.clone())
        .map_err(|error| bridge_error("invalid_graph", error))?;
    ensure_goal_coverage(&tasks, &input.criteria)?;
    let mut events = vec![
        Event::new(&input.run_id, EventKind::RunCreated),
        Event::new(
            &input.run_id,
            EventKind::RunConfigured {
                intent: input.intent,
                working_directory: input.working_directory,
            },
        ),
    ];
    events.extend(
        tasks
            .into_iter()
            .map(|task| Event::new(&input.run_id, EventKind::TaskCreated(task))),
    );
    events.push(Event::new(
        &input.run_id,
        EventKind::GoalCriteriaDeclared(goal_criteria(input.criteria)),
    ));
    append_batch_and_notify(
        &mut store(&input.database_path)?,
        &events,
        "prepare_goal_run_failed",
    )?;
    Ok(OperationOutput {
        accepted: true,
        ..OperationOutput::default()
    })
}

#[command]
pub fn append_goal_criteria(input: AppendGoalCriteriaInput) -> Result<OperationOutput> {
    append(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::GoalCriteriaDeclared(goal_criteria(input.criteria)),
        ),
    )
}

#[command]
pub fn add_goal_task(input: AddGoalTaskInput) -> Result<OperationOutput> {
    if input.criteria.is_empty() {
        return Err(bridge_error(
            "invalid_goal",
            "new task requires goal criteria",
        ));
    }
    let task = task_from_input(input.task)?;
    ensure_goal_coverage(std::slice::from_ref(&task), &input.criteria)?;
    let events = [
        Event::new(&input.run_id, EventKind::TaskCreated(task)),
        Event::new(
            &input.run_id,
            EventKind::GoalCriteriaDeclared(goal_criteria(input.criteria)),
        ),
    ];
    append_batch_and_notify(
        &mut store(&input.database_path)?,
        &events,
        "add_goal_task_failed",
    )?;
    Ok(OperationOutput {
        accepted: true,
        ..OperationOutput::default()
    })
}

#[command]
pub fn prepare_run_preflight(input: PrepareRunPreflightInput) -> Result<OperationOutput> {
    if !std::path::Path::new(&input.working_directory).is_absolute() {
        return Err(bridge_error(
            "invalid_context",
            "working directory must be absolute",
        ));
    }
    let tasks = input
        .tasks
        .into_iter()
        .map(task_from_preflight_input)
        .collect::<Result<Vec<_>>>()?;
    if tasks.is_empty() {
        return Err(bridge_error("preflight_failed", "plan must contain tasks"));
    }
    loop_core::graph::TaskGraph::preflight(tasks.clone())
        .map_err(|error| bridge_error("preflight_failed", error))?;
    let mut events = vec![
        Event::new(&input.run_id, EventKind::RunCreated),
        Event::new(
            &input.run_id,
            EventKind::RunConfigured {
                intent: input.intent,
                working_directory: input.working_directory,
            },
        ),
    ];
    events.extend(
        tasks
            .into_iter()
            .map(|task| Event::new(&input.run_id, EventKind::TaskCreated(task))),
    );
    append_batch_and_notify(
        &mut store(&input.database_path)?,
        &events,
        "prepare_run_failed",
    )?;
    Ok(OperationOutput {
        accepted: true,
        ..OperationOutput::default()
    })
}

#[command]
pub fn configure_run(input: ConfigureRunInput) -> Result<OperationOutput> {
    if input.working_directory.trim().is_empty() {
        return Err(bridge_error(
            "invalid_context",
            "working directory is required",
        ));
    }
    append(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::RunConfigured {
                intent: input.intent,
                working_directory: input.working_directory,
            },
        ),
    )
}
