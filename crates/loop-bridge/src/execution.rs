use crate::commands::{
    append, append_batch_and_notify, append_owned, bridge_error, store, task_from_input,
    task_from_preflight_input,
};
use crate::{
    AssumptionInput, CompletionCheckInput, CompletionCoverageInput, DecompositionContractOutput,
    DependencyConsumptionInput, OperationOutput, PreflightTaskSpecInput, RunInput,
    SemanticTouchpointInput, TaskSpecInput,
};
use loop_core::attention::{AttentionKind, AttentionResolution, AttentionState};
use loop_core::event::{
    steer_promotion_events, GoalCriterion, SteerPromotionError,
};
use loop_core::event::{CheckReceipt, Event, EventKind};
use loop_core::task::{Task, TaskId, TaskState};
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

fn goal_criteria(inputs: Vec<GoalCriterionInput>) -> Vec<GoalCriterion> {
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

#[bridge_type]
pub struct ReconcileTaskInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub confirmed_stopped: bool,
}

#[bridge_type]
pub struct SteerRunInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: Option<String>,
    pub message: String,
}

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

#[bridge_type]
pub struct ExecutionLeaseInput {
    pub database_path: String,
    pub run_id: String,
    pub owner: String,
    pub now_ms: i64,
    pub ttl_ms: i64,
}

#[bridge_type]
pub struct ReleaseExecutionInput {
    pub database_path: String,
    pub run_id: String,
    pub owner: String,
}

#[bridge_type]
pub struct RunListOutput {
    pub run_id: String,
    pub state: loop_core::run::RunState,
}

#[bridge_type]
pub struct ListRunsInput {
    pub database_path: String,
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
    Ok(OperationOutput { accepted: true })
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
    Ok(OperationOutput { accepted: true })
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
    Ok(OperationOutput { accepted: true })
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
    Ok(OperationOutput { accepted: true })
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

#[command]
pub fn claim_execution(input: ExecutionLeaseInput) -> Result<OperationOutput> {
    let _ignored_client_clock = input.now_ms;
    let accepted = store(&input.database_path)?
        .claim_execution(&input.run_id, &input.owner, input.ttl_ms)
        .map_err(|e| bridge_error("execution_lease_failed", e))?;
    Ok(OperationOutput { accepted })
}

#[command]
pub fn renew_execution(input: ExecutionLeaseInput) -> Result<OperationOutput> {
    let _ignored_client_clock = input.now_ms;
    let accepted = store(&input.database_path)?
        .renew_execution(&input.run_id, &input.owner, input.ttl_ms)
        .map_err(|e| bridge_error("execution_lease_failed", e))?;
    Ok(OperationOutput { accepted })
}

#[command]
pub fn release_execution(input: ReleaseExecutionInput) -> Result<OperationOutput> {
    store(&input.database_path)?
        .release_execution(&input.run_id, &input.owner)
        .map_err(|e| bridge_error("execution_release_failed", e))?;
    Ok(OperationOutput { accepted: true })
}

#[command]
pub fn reconcile_task(input: ReconcileTaskInput) -> Result<OperationOutput> {
    if !input.confirmed_stopped {
        return Err(bridge_error(
            "confirmation_required",
            "Confirm the previous worker and verification processes have stopped before retrying",
        ));
    }
    let mut store = store(&input.database_path)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| bridge_error("clock_failed", e))?
        .as_millis() as i64;
    let owner = format!("reconcile-{}-{now}", std::process::id());
    if !store
        .claim_execution(&input.run_id, &owner, 5000)
        .map_err(|e| bridge_error("lease_failed", e))?
    {
        return Err(bridge_error(
            "owner_active",
            "The execution owner is still active; pause or cancel it first",
        ));
    }
    let result = (|| {
        let projection = store
            .projection(&input.run_id)
            .map_err(|e| bridge_error("run_not_found", e))?;
        let task_id = TaskId::from(input.task_id);
        let mut events = vec![Event::new(
            &input.run_id,
            EventKind::TaskExecutionReconciled {
                task_id: task_id.clone(),
            },
        )];
        for attention in projection.attention.values().filter(|a| {
            a.state == AttentionState::Open
                && a.kind == AttentionKind::Failure
                && a.task_id.as_ref() == Some(&task_id)
        }) {
            events.push(Event::new(
                &input.run_id,
                EventKind::AttentionResolved {
                    attention_id: attention.id.clone(),
                    resolution: AttentionResolution::Retry,
                },
            ));
        }
        store
            .append_batch_owned(&events, Some(&owner))
            .map_err(|e| bridge_error("reconcile_failed", e))?;
        Ok(OperationOutput { accepted: true })
    })();
    store
        .release_execution(&input.run_id, &owner)
        .map_err(|e| bridge_error("lease_failed", e))?;
    result
}

#[command]
pub fn list_runs(input: ListRunsInput) -> Result<Vec<RunListOutput>> {
    Ok(store(&input.database_path)?
        .runs()
        .map_err(|e| bridge_error("runs_failed", e))?
        .into_iter()
        .map(|(run_id, state)| RunListOutput { run_id, state })
        .collect())
}

fn decomposition_contract(task: &Task) -> Option<DecompositionContractOutput> {
    let contract = task.decomposition_contract.as_ref()?;
    Some(DecompositionContractOutput {
        defaults: contract.defaults.clone(),
        assumptions: contract
            .assumptions
            .iter()
            .map(|assumption| AssumptionInput {
                assumption: assumption.assumption.clone(),
                evidence: assumption.evidence.clone(),
                if_false: assumption.if_false.clone(),
                revisit: assumption.revisit.clone(),
            })
            .collect(),
        semantic_touchpoints: contract
            .semantic_touchpoints
            .iter()
            .map(|touchpoint| SemanticTouchpointInput {
                id: touchpoint.id.clone(),
                access: touchpoint.access,
                conflict_resolution: touchpoint.conflict_resolution,
            })
            .collect(),
        consumes: contract
            .consumes
            .iter()
            .map(|consumption| DependencyConsumptionInput {
                dependency: consumption.dependency.to_string(),
                decisions: consumption.decisions.clone(),
                artifacts: consumption.artifacts.clone(),
                checks: consumption.checks.clone(),
                risks: consumption.risks.clone(),
            })
            .collect(),
        completion_coverage: task
            .completion_contract
            .checks
            .iter()
            .filter_map(|check| {
                let coverage = check.coverage.as_ref()?;
                Some(CompletionCoverageInput {
                    check_id: check.id.clone(),
                    requirements: coverage.requirements.clone(),
                    artifacts: coverage.artifacts.clone(),
                    semantics: coverage.semantics.clone(),
                    evidence_level: coverage.evidence_level,
                })
            })
            .collect(),
        failure_policy: contract.failure_policy.clone(),
    })
}

pub(crate) fn task_spec(task: &Task) -> TaskSpecInput {
    TaskSpecInput {
        id: task.id.to_string(),
        title: task.title.clone(),
        kind: task.kind,
        dependencies: task.dependencies.iter().map(ToString::to_string).collect(),
        read_scope: task.ownership.read_scope.clone(),
        write_scope: task.ownership.write_scope.clone(),
        requirements: task.requirements.clone(),
        // persona는 loop-core Task에 내구 메타데이터가 생기기 전까지 에코 시 None이다
        // (docs/decisions/2026-09-22-worker-persona-contract.md D2 후속 작업).
        persona: None,
        completion_checks: task
            .completion_contract
            .checks
            .iter()
            .map(|check| CompletionCheckInput {
                id: check.id.clone(),
                command: check.command.clone(),
                args: check.args.clone(),
                working_directory: check.working_directory.clone(),
                timeout_ms: check.timeout_ms,
            })
            .collect(),
        preferred_compute: task.preferred_compute,
        minimum_compute: task.minimum_compute,
        maximum_compute: task.maximum_compute,
        routing: Some(task.routing),
        max_attempts: task.max_attempts,
    }
}

pub(crate) fn register_preflight(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(builder, prepare_run_preflight)
}

pub(crate) fn register_execution(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(
        builder,
        prepare_run,
        prepare_goal_run,
        append_goal_criteria,
        add_goal_task,
        configure_run,
        get_run_plan,
        get_task_context,
        record_check_receipts,
        stop_verification,
        record_activity,
        record_task_output,
        steer_run,
        promote_steer,
        claim_execution,
        renew_execution,
        release_execution,
        reconcile_task,
        list_runs
    )
}

#[cfg(test)]
mod preflight_bridge_tests {
    use super::*;
    use crate::{
        AssumptionInput, CompletionCoverageInput, DependencyConsumptionInput,
        PreflightTaskSpecInput, SemanticTouchpointInput,
    };
    use loop_core::policy::{ComputeClass, FailurePolicy, OnExhaustion};
    use loop_core::task::{EvidenceLevel, SemanticAccess, SemanticConflictResolution, TaskKind};

    fn task(id: &str) -> TaskSpecInput {
        TaskSpecInput {
            id: id.into(),
            title: id.into(),
            kind: TaskKind::Implementation,
            dependencies: vec![],
            read_scope: vec![],
            write_scope: vec![format!("src/{id}.rs")],
            requirements: vec!["behavior".into()],
            persona: None,
            completion_checks: vec![CompletionCheckInput {
                id: "unit".into(),
                command: "cargo".into(),
                args: vec!["test".into()],
                working_directory: None,
                timeout_ms: 1_000,
            }],
            preferred_compute: ComputeClass::Fast,
            minimum_compute: ComputeClass::Tiny,
            maximum_compute: ComputeClass::Strong,
            routing: None,
            max_attempts: 2,
        }
    }

    fn preflight_task(id: &str) -> PreflightTaskSpecInput {
        PreflightTaskSpecInput {
            task: task(id),
            defaults: vec!["preserve compatibility".into()],
            assumptions: vec![AssumptionInput {
                assumption: "tests are offline".into(),
                evidence: "repository suite".into(),
                if_false: "record missing live evidence".into(),
                revisit: "before release".into(),
            }],
            semantic_touchpoints: vec![SemanticTouchpointInput {
                id: "policy".into(),
                access: SemanticAccess::Modify,
                conflict_resolution: SemanticConflictResolution::Serialize,
            }],
            consumes: Vec::<DependencyConsumptionInput>::new(),
            completion_coverage: vec![CompletionCoverageInput {
                check_id: "unit".into(),
                requirements: vec!["behavior".into()],
                artifacts: vec![format!("src/{id}.rs")],
                semantics: vec!["behavior is preserved".into()],
                evidence_level: EvidenceLevel::Unit,
            }],
            failure_policy: FailurePolicy::new([], OnExhaustion::FailTask),
        }
    }

    #[test]
    fn tracked_prepare_rejects_unmapped_goal_without_writing_run() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("goal-invalid.db").display().to_string();
        let result = prepare_goal_run(PrepareGoalRunInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            intent: "verify behavior".into(),
            working_directory: "/project".into(),
            tasks: vec![task("implementation")],
            criteria: vec![GoalCriterionInput {
                id: "goal".into(),
                description: "behavior".into(),
                task_id: "implementation".into(),
                check_ids: vec!["missing".into()],
            }],
        });
        assert!(result.is_err());
        assert!(crate::commands::get_snapshot(RunInput {
            database_path,
            run_id: "run".into()
        })
        .is_err());
    }

    #[test]
    fn tracked_prepare_persists_goal_status_and_rejects_duplicate_correction() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("goal-valid.db").display().to_string();
        let criterion = GoalCriterionInput {
            id: "goal".into(),
            description: "behavior".into(),
            task_id: "implementation".into(),
            check_ids: vec!["unit".into()],
        };
        prepare_goal_run(PrepareGoalRunInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            intent: "verify behavior".into(),
            working_directory: "/project".into(),
            tasks: vec![task("implementation")],
            criteria: vec![criterion],
        })
        .unwrap();
        let snapshot = crate::commands::get_snapshot(RunInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
        })
        .unwrap();
        assert_eq!(snapshot.goal_criteria.len(), 1);
        assert_eq!(
            snapshot.goal_criteria[0].state,
            loop_core::event::GoalCriterionState::Pending
        );
        let duplicate = append_goal_criteria(AppendGoalCriteriaInput {
            database_path,
            run_id: "run".into(),
            criteria: vec![GoalCriterionInput {
                id: "goal".into(),
                description: "repeat".into(),
                task_id: "implementation".into(),
                check_ids: vec!["unit".into()],
            }],
        });
        assert!(duplicate.is_err());
    }

    #[test]
    fn corrected_goal_adds_task_and_criterion_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("goal-correction.db").display().to_string();
        prepare_goal_run(PrepareGoalRunInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            intent: "behavior".into(),
            working_directory: "/project".into(),
            tasks: vec![task("original")],
            criteria: vec![GoalCriterionInput {
                id: "original".into(),
                description: "behavior".into(),
                task_id: "original".into(),
                check_ids: vec!["unit".into()],
            }],
        })
        .unwrap();
        let invalid = add_goal_task(AddGoalTaskInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            task: task("correction"),
            criteria: vec![GoalCriterionInput {
                id: "correction".into(),
                description: "behavior".into(),
                task_id: "correction".into(),
                check_ids: vec!["missing".into()],
            }],
        });
        assert!(invalid.is_err());
        let snapshot = crate::commands::get_snapshot(RunInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
        })
        .unwrap();
        assert_eq!(snapshot.tasks.len(), 1);
        assert_eq!(snapshot.goal_criteria.len(), 1);
        add_goal_task(AddGoalTaskInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            task: task("correction"),
            criteria: vec![GoalCriterionInput {
                id: "correction".into(),
                description: "behavior".into(),
                task_id: "correction".into(),
                check_ids: vec!["unit".into()],
            }],
        })
        .unwrap();
        let snapshot = crate::commands::get_snapshot(RunInput {
            database_path,
            run_id: "run".into(),
        })
        .unwrap();
        assert_eq!(snapshot.tasks.len(), 2);
        assert_eq!(snapshot.goal_criteria.len(), 2);
    }

    #[test]
    fn prepare_run_preflight_rejects_weak_contract_before_persisting() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("preflight.db").display().to_string();
        let mut weak = preflight_task("weak");
        weak.defaults.clear();

        let error = prepare_run_preflight(PrepareRunPreflightInput {
            database_path,
            run_id: "run".into(),
            intent: "intent".into(),
            working_directory: "/project".into(),
            tasks: vec![weak],
        })
        .unwrap_err();

        assert_eq!(error.code(), "preflight_failed");
    }

    #[test]
    fn prepare_run_preflight_persists_contract_for_worker_context() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir
            .path()
            .join("preflight-context.db")
            .display()
            .to_string();
        prepare_run_preflight(PrepareRunPreflightInput {
            database_path: database_path.clone(),
            run_id: "run".into(),
            intent: "intent".into(),
            working_directory: "/project".into(),
            tasks: vec![preflight_task("implementation")],
        })
        .unwrap();

        let context = get_task_context(TaskContextInput {
            database_path,
            run_id: "run".into(),
            task_id: "implementation".into(),
        })
        .unwrap();
        let contract = context.decomposition_contract.unwrap();

        assert_eq!(contract.defaults, vec!["preserve compatibility"]);
        assert_eq!(contract.completion_coverage[0].check_id, "unit");
        assert_eq!(
            contract.failure_policy.on_unbudgeted_failure,
            OnExhaustion::FailTask
        );
    }
}

#[cfg(test)]
mod steer_promotion_bridge_tests {
    use super::*;
    use crate::{
        CheckResultInput, CompletionCheckInput, RecordCheckReceiptsInput, RunInput, UpdateTaskInput,
        VerificationInput, WorkerInput, WorkerResultInput,
    };
    use loop_core::event::{CheckReceipt, SourceReceipt};
    use loop_core::policy::ComputeClass;
    use loop_core::run::RunState;
    use loop_core::task::{TaskKind, TaskState};
    use loop_store::SqliteStore;

    const RUN_ID: &str = "steer-run";

    fn task(id: &str, dependencies: &[&str]) -> TaskSpecInput {
        TaskSpecInput {
            id: id.into(),
            title: id.into(),
            kind: TaskKind::Implementation,
            dependencies: dependencies.iter().map(|id| (*id).to_string()).collect(),
            read_scope: vec![],
            write_scope: vec![format!("src/{id}.rs")],
            requirements: vec!["behavior".into()],
            persona: None,
            completion_checks: vec![CompletionCheckInput {
                id: "unit".into(),
                command: "cargo".into(),
                args: vec!["test".into()],
                working_directory: None,
                timeout_ms: 1_000,
            }],
            preferred_compute: ComputeClass::Fast,
            minimum_compute: ComputeClass::Tiny,
            maximum_compute: ComputeClass::Strong,
            routing: None,
            max_attempts: 2,
        }
    }

    fn criterion(id: &str) -> GoalCriterionInput {
        GoalCriterionInput {
            id: id.into(),
            description: "behavior".into(),
            task_id: id.into(),
            check_ids: vec!["unit".into()],
        }
    }

    fn promotion_input(database_path: &str, id: &str) -> PromoteSteerInput {
        PromoteSteerInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            message: "user correction: also cover the corrected behavior".into(),
            task: task(id, &["original"]),
            criteria: vec![criterion(id)],
        }
    }

    fn prepared_run(database_path: &str) {
        prepare_goal_run(PrepareGoalRunInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            intent: "behavior".into(),
            working_directory: "/project".into(),
            tasks: vec![task("original", &[])],
            criteria: vec![criterion("original")],
        })
        .unwrap();
    }

    fn receipt(check_id: &str) -> CheckReceipt {
        CheckReceipt {
            id: check_id.into(),
            command: "cargo".into(),
            args: vec!["test".into()],
            working_directory: "/project".into(),
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
            duration_ms: 1,
            output_artifact: None,
            source: Some(SourceReceipt {
                before_fingerprint: "abc".into(),
                after_fingerprint: "abc".into(),
                observed_changed_paths: vec![],
                observed_outside_write_scope: vec![],
            }),
        }
    }

    fn start_task(database_path: &str, task_id: &str) {
        crate::update_task(UpdateTaskInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            task_id: task_id.into(),
            state: TaskState::Ready,
        })
        .unwrap();
        crate::record_worker_started(WorkerInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            task_id: task_id.into(),
            worker_id: format!("worker-{task_id}"),
            execution_owner: None,
            state: None,
        })
        .unwrap();
    }

    fn verify_task(database_path: &str, task_id: &str, with_receipts: bool) {
        crate::record_worker_result(WorkerResultInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            task_id: task_id.into(),
            worker_id: format!("worker-{task_id}"),
            success: true,
            summary: "done".into(),
            execution_owner: None,
            state: None,
        })
        .unwrap();
        if with_receipts {
            crate::record_check_receipts(RecordCheckReceiptsInput {
                database_path: database_path.into(),
                run_id: RUN_ID.into(),
                task_id: task_id.into(),
                checks: vec![receipt("unit")],
                execution_owner: None,
            })
            .unwrap();
        }
        crate::record_verification(VerificationInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
            task_id: task_id.into(),
            passed: true,
            checks: vec![CheckResultInput {
                id: "unit".into(),
                passed: true,
            }],
            reason: "focused suite passed".into(),
            execution_owner: None,
        })
        .unwrap();
    }

    fn snapshot(database_path: &str) -> crate::SnapshotOutput {
        crate::get_snapshot(RunInput {
            database_path: database_path.into(),
            run_id: RUN_ID.into(),
        })
        .unwrap()
    }

    #[test]
    fn steer_promotion_binds_criterion_to_new_dependent_task() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("steer-bind.db").display().to_string();
        prepared_run(&database_path);

        // A steer task referencing a task outside the run must not be
        // partially written: no task, no criterion, no guidance.
        let unknown = promote_steer(PromoteSteerInput {
            task: task("correction", &["ghost"]),
            ..promotion_input(&database_path, "correction")
        });
        assert_eq!(unknown.unwrap_err().code(), "unknown_dependency");
        let before = snapshot(&database_path);
        assert_eq!(before.tasks.len(), 1);
        assert_eq!(before.goal_criteria.len(), 1);
        assert!(before.guidance.is_empty());

        let output = promote_steer(promotion_input(&database_path, "correction")).unwrap();
        assert!(output.accepted);
        assert_eq!(output.task_id, "correction");
        assert_eq!(output.criterion_ids, vec!["correction"]);
        assert!(output.summary.contains("correction"));
        assert!(!output.evidence_tests.is_empty());

        let after = snapshot(&database_path);
        assert_eq!(after.tasks.len(), 2);
        let correction = after
            .tasks
            .iter()
            .find(|task| task.id == "correction")
            .unwrap();
        assert_eq!(correction.dependencies, vec!["original".to_string()]);
        assert_eq!(correction.blocked_by, vec!["original".to_string()]);
        assert_eq!(after.goal_criteria.len(), 2);
        assert!(after
            .goal_criteria
            .iter()
            .all(|item| item.state == loop_core::event::GoalCriterionState::Pending));
        assert_eq!(after.guidance.len(), 1);
        assert!(after.guidance[0].contains("corrected behavior"));
    }

    #[test]
    fn unverified_steer_criterion_blocks_run_completion() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("steer-gate.db").display().to_string();
        prepared_run(&database_path);
        start_task(&database_path, "original");
        promote_steer(promotion_input(&database_path, "correction")).unwrap();

        // The original work verifies with stable receipts, but the promoted
        // criterion is still pending: the run must stay open.
        verify_task(&database_path, "original", true);
        let store = SqliteStore::open(&database_path).unwrap();
        assert_eq!(
            store.projection(RUN_ID).unwrap().run_state,
            Some(RunState::Active)
        );

        // The promoted task finishing without recorded check receipts
        // isolates the goal gate from the task-completeness gate: every task
        // is done, yet the unverified steer criterion must still refuse
        // completion with the existing IncompleteGoal policy.
        start_task(&database_path, "correction");
        verify_task(&database_path, "correction", false);
        let mut store = SqliteStore::open(&database_path).unwrap();
        assert_eq!(store.projection(RUN_ID).unwrap().run_state, Some(RunState::Active));
        assert!(matches!(
            store.append(&loop_core::event::Event::new(
                RUN_ID,
                loop_core::event::EventKind::RunCompleted
            )),
            Err(loop_store::StoreError::Projection(
                loop_core::event::ProjectionError::IncompleteGoal
            ))
        ));

        // Once the steer-added criterion verifies against its declared
        // check, the same gate accepts completion.
        crate::record_check_receipts(RecordCheckReceiptsInput {
            database_path: database_path.clone(),
            run_id: RUN_ID.into(),
            task_id: "correction".into(),
            checks: vec![receipt("unit")],
            execution_owner: None,
        })
        .unwrap();
        let mut store = SqliteStore::open(&database_path).unwrap();
        store
            .append(&loop_core::event::Event::new(
                RUN_ID,
                loop_core::event::EventKind::RunCompleted,
            ))
            .unwrap();
        let after = snapshot(&database_path);
        assert_eq!(after.state, RunState::Completed);
        assert!(after
            .goal_criteria
            .iter()
            .all(|item| item.state == loop_core::event::GoalCriterionState::Verified));
    }
}
