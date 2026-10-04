//! Steer commands: plain mid-run guidance and steer promotion into the goal
//! graph (dependent task + criterion in one atomic append).

use super::setup::{goal_criteria, GoalCriterionInput};
use crate::commands::{
    append, append_batch_and_notify, bridge_error, store, task_from_input, OperationOutput,
    TaskSpecInput,
};
use loop_core::event::{steer_promotion_events, Event, EventKind, SteerPromotionError};
use loop_core::task::{Task, TaskId};
use rustra::prelude::*;

#[bridge_type]
pub struct SteerRunInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: Option<String>,
    pub message: String,
}

/// Focused tests that prove the steer-promotion contract end to end. The
/// command reports them verbatim as evidence so a reviewer can re-run the
/// exact suite; renaming one of these tests must update this list in the
/// same commit.
const STEER_PROMOTION_EVIDENCE_TESTS: &[&str] = &[
    "loop_core::event::steer::tests::steer_promotion_binds_message_task_and_criterion",
    "loop_core::event::steer::tests::steer_promotion_requires_dependency_and_bound_checks",
    "loop_core::event::steer::tests::steer_criterion_blocks_run_completion_until_verified",
    "loop_bridge::execution::steer_promotion_bridge_tests::steer_promotion_binds_criterion_to_new_dependent_task",
    "loop_bridge::execution::steer_promotion_bridge_tests::unverified_steer_criterion_blocks_run_completion",
];

#[bridge_type]
pub struct PromoteSteerInput {
    pub database_path: String,
    pub run_id: String,
    pub message: String,
    pub task: TaskSpecInput,
    pub criteria: Vec<GoalCriterionInput>,
}

#[bridge_type]
pub struct PromoteSteerOutput {
    pub accepted: bool,
    pub run_id: String,
    pub task_id: String,
    pub criterion_ids: Vec<String>,
    pub summary: String,
    pub evidence_tests: Vec<String>,
}

pub(crate) fn register_steer(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(builder, steer_run, promote_steer)
}

#[command]
pub fn steer_run(input: SteerRunInput) -> Result<OperationOutput> {
    if input.message.trim().is_empty() || input.message.len() > 16_000 {
        return Err(bridge_error(
            "invalid_guidance",
            "guidance must contain 1 to 16000 bytes",
        ));
    }
    append(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::GuidanceAdded {
                task_id: input.task_id.map(TaskId::from),
                message: input.message,
            },
        ),
    )
}

/// Promote a mid-run user steer into the goal graph: the correction becomes
/// a new dependent task and a new goal criterion in one atomic append, so
/// the existing `RunCompleted` gate keeps the run open until the promoted
/// criterion verifies. Plain guidance without a criterion is still served
/// by `steer_run`; this command is for requirements that must be enforced.
#[command]
pub fn promote_steer(input: PromoteSteerInput) -> Result<PromoteSteerOutput> {
    let criterion_ids: Vec<String> = input.criteria.iter().map(|c| c.id.clone()).collect();
    let task = task_from_input(input.task)?;
    let events = steer_promotion_events(
        &input.run_id,
        &input.message,
        task.clone(),
        goal_criteria(input.criteria),
    )
    .map_err(|error: SteerPromotionError| bridge_error("invalid_steer_promotion", error))?;
    let mut store = store(&input.database_path)?;
    let projection = store
        .projection(&input.run_id)
        .map_err(|error| bridge_error("run_not_found", error))?;
    if projection.run_id.is_none() {
        return Err(bridge_error("run_not_found", &input.run_id));
    }
    if projection
        .run_state
        .is_some_and(loop_core::run::RunState::is_terminal)
    {
        return Err(bridge_error(
            "run_not_active",
            "a terminal run cannot accept steer promotions",
        ));
    }
    if projection.tasks.contains_key(&task.id) {
        return Err(bridge_error("task_already_created", &task.id));
    }
    for dependency in &task.dependencies {
        if !projection.tasks.contains_key(dependency) {
            return Err(bridge_error(
                "unknown_dependency",
                format!(
                    "steer task {} depends on unknown task {}",
                    task.id, dependency
                ),
            ));
        }
    }
    let task_id = task.id.to_string();
    let mut merged: Vec<Task> = projection.tasks.values().cloned().collect();
    merged.push(task);
    loop_core::graph::TaskGraph::new(merged)
        .map_err(|error| bridge_error("invalid_graph", error))?;
    append_batch_and_notify(&mut store, &events, "promote_steer_failed")?;
    Ok(PromoteSteerOutput {
        accepted: true,
        summary: format!(
            "steer promoted to criteria [{}] on dependent task {}; the run stays open until they verify",
            criterion_ids.join(", "),
            task_id
        ),
        task_id,
        run_id: input.run_id,
        criterion_ids,
        evidence_tests: STEER_PROMOTION_EVIDENCE_TESTS
            .iter()
            .map(|test| (*test).to_string())
            .collect(),
    })
}
