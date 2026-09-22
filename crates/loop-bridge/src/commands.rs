use loop_core::attention::{Attention, AttentionKind, AttentionResolution};
use loop_core::event::{Event, EventKind};
use loop_core::graph::TaskGraph;
use loop_core::policy::{ComputeClass, RetentionPolicy};
use loop_core::run::RunState;
use loop_core::scheduler::{Capacity, Scheduler};
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskId, TaskKind, TaskState, VerificationEvidence,
    WorkOwnership,
};
use loop_store::SqliteStore;
use rustra::prelude::*;
use std::sync::OnceLock;

use crate::{EventOutput, RunChangedEvent};

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
pub struct CompletionCheckInput {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub working_directory: Option<String>,
    pub timeout_ms: u64,
}

#[bridge_type]
pub struct TaskSpecInput {
    pub id: String,
    pub title: String,
    pub kind: TaskKind,
    pub dependencies: Vec<String>,
    pub read_scope: Vec<String>,
    pub write_scope: Vec<String>,
    pub requirements: Vec<String>,
    pub completion_checks: Vec<CompletionCheckInput>,
    pub preferred_compute: ComputeClass,
    pub minimum_compute: ComputeClass,
    pub maximum_compute: ComputeClass,
    pub max_attempts: u16,
}

#[bridge_type]
pub struct SubmitPlanInput {
    pub database_path: String,
    pub run_id: String,
    pub tasks: Vec<TaskSpecInput>,
}

#[bridge_type]
pub struct AddTaskInput {
    pub database_path: String,
    pub run_id: String,
    pub task: TaskSpecInput,
}

#[bridge_type]
pub struct UpdateTaskInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub state: TaskState,
}

#[bridge_type]
pub struct ClaimRunnableTasksInput {
    pub database_path: String,
    pub run_id: String,
    pub running_task_ids: Vec<String>,
    pub max_workers: u16,
    pub max_frontier_workers: u16,
}

#[bridge_type]
pub struct WorkerInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub worker_id: String,
}

#[bridge_type]
pub struct WorkerResultInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub worker_id: String,
    pub success: bool,
    pub summary: String,
}

#[bridge_type]
pub struct CheckResultInput {
    pub id: String,
    pub passed: bool,
}

#[bridge_type]
pub struct VerificationInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub passed: bool,
    pub checks: Vec<CheckResultInput>,
    pub reason: String,
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
}

#[bridge_type]
pub struct SubscribeEventsInput {
    pub database_path: String,
    pub run_id: String,
    pub after_sequence: i64,
    pub limit: u16,
}

#[bridge_type]
pub struct OperationOutput {
    pub accepted: bool,
}

#[bridge_type]
pub struct SubmitPlanOutput {
    pub task_count: u32,
}

#[bridge_type]
pub struct TaskIdsOutput {
    pub task_ids: Vec<String>,
}

#[bridge_type]
pub struct TaskSnapshotOutput {
    pub id: String,
    pub title: String,
    pub kind: TaskKind,
    pub state: TaskState,
    pub attempt: u16,
    pub preferred_compute: ComputeClass,
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
}

#[bridge_type]
pub struct CleanupRunInput {
    pub database_path: String,
    pub run_id: String,
    pub keep_recent: u32,
    pub dry_run: bool,
}

#[bridge_type]
pub struct SkippedArtifactOutput {
    pub artifact: String,
    pub reason: String,
}

#[bridge_type]
pub struct CleanupRunOutput {
    pub removed_artifacts: Vec<String>,
    pub skipped_artifacts: Vec<SkippedArtifactOutput>,
}

#[bridge_type]
pub struct EvaluateWorktreeRemovalInput {
    pub project_root: String,
    pub worktree_path: String,
    pub is_merged: bool,
    pub is_clean: bool,
}

#[bridge_type]
pub struct PolicyEvaluationOutput {
    pub allowed: bool,
    pub refusal_code: Option<String>,
    pub reason: Option<String>,
}

#[bridge_type]
pub struct EvaluateSurfaceRemovalInput {
    pub surface_id: String,
    pub is_owned_by_loop: bool,
}

fn bridge_error(code: &'static str, error: impl std::fmt::Display) -> RustraError {
    RustraError::custom(code, error.to_string())
}

fn store(path: &str) -> Result<SqliteStore> {
    SqliteStore::open(path).map_err(|error| bridge_error("store_error", error))
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
pub fn submit_plan(input: SubmitPlanInput) -> Result<SubmitPlanOutput> {
    let tasks = input
        .tasks
        .into_iter()
        .map(task_from_input)
        .collect::<Result<Vec<_>>>()?;
    TaskGraph::new(tasks.clone()).map_err(|error| bridge_error("invalid_graph", error))?;
    let events: Vec<_> = tasks
        .into_iter()
        .map(|task| Event::new(&input.run_id, EventKind::TaskCreated(task)))
        .collect();
    if events.is_empty() {
        return Err(bridge_error("invalid_graph", "plan must contain tasks"));
    }
    let mut store = store(&input.database_path)?;
    append_batch_and_notify(&mut store, &events, "submit_plan_failed")?;
    Ok(SubmitPlanOutput {
        task_count: u32::try_from(events.len()).unwrap_or(u32::MAX),
    })
}

#[command]
pub fn add_task(input: AddTaskInput) -> Result<OperationOutput> {
    let task = task_from_input(input.task)?;
    let mut store = store(&input.database_path)?;
    let projection = store
        .projection(&input.run_id)
        .map_err(|error| bridge_error("run_not_found", error))?;
    let mut tasks: Vec<_> = projection.tasks.into_values().collect();
    tasks.push(task.clone());
    TaskGraph::new(tasks).map_err(|error| bridge_error("invalid_graph", error))?;
    let event = Event::new(&input.run_id, EventKind::TaskCreated(task));
    append_and_notify(&mut store, &event, "add_task_failed")?;
    Ok(OperationOutput { accepted: true })
}

#[command]
pub fn update_task(input: UpdateTaskInput) -> Result<OperationOutput> {
    if input.state != TaskState::Ready {
        return Err(bridge_error(
            "invalid_task_update",
            "only the deterministic ready transition is exposed; use lifecycle commands for other states",
        ));
    }
    let mut store = store(&input.database_path)?;
    let event = Event::new(
        &input.run_id,
        EventKind::TaskReady(TaskId::from(input.task_id)),
    );
    append_and_notify(&mut store, &event, "update_task_failed")?;
    Ok(OperationOutput { accepted: true })
}

#[command]
pub fn claim_runnable_tasks(input: ClaimRunnableTasksInput) -> Result<TaskIdsOutput> {
    let mut store = store(&input.database_path)?;
    let projection = store
        .projection(&input.run_id)
        .map_err(|error| bridge_error("run_not_found", error))?;
    if projection.run_state == Some(RunState::Attention) {
        return Ok(TaskIdsOutput { task_ids: vec![] });
    }
    let graph = TaskGraph::new(projection.tasks.into_values())
        .map_err(|error| bridge_error("invalid_graph", error))?;
    let running: Vec<_> = input
        .running_task_ids
        .into_iter()
        .map(TaskId::from)
        .collect();
    let claimed = Scheduler::new(Capacity::new(
        usize::from(input.max_workers.max(1)),
        usize::from(input.max_frontier_workers.max(1)),
    ))
    .claim_runnable(&graph, &running);
    let ready_events: Vec<_> = claimed
        .iter()
        .filter(|task_id| {
            graph
                .task(task_id)
                .is_some_and(|task| task.state == loop_core::task::TaskState::Pending)
        })
        .cloned()
        .map(|task_id| Event::new(&input.run_id, EventKind::TaskReady(task_id)))
        .collect();
    if !ready_events.is_empty() {
        append_batch_and_notify(&mut store, &ready_events, "claim_failed")?;
    }
    Ok(TaskIdsOutput {
        task_ids: claimed.into_iter().map(|id| id.to_string()).collect(),
    })
}

#[command]
pub fn record_worker_started(input: WorkerInput) -> Result<OperationOutput> {
    append(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::WorkerStarted {
                task_id: TaskId::from(input.task_id),
                worker_id: input.worker_id,
            },
        ),
    )
}

#[command]
pub fn record_worker_result(input: WorkerResultInput) -> Result<OperationOutput> {
    let run_id = input.run_id.clone();
    let failed_task_id = TaskId::from(input.task_id.clone());
    let failure_summary = input.summary.clone();
    let finished = Event::new(
        &input.run_id,
        EventKind::WorkerFinished {
            task_id: TaskId::from(input.task_id),
            worker_id: input.worker_id,
        },
    );
    let mut store = store(&input.database_path)?;
    if input.success {
        append_and_notify(&mut store, &finished, "worker_result_failed")?;
    } else {
        let failure = Event::new(
            &input.run_id,
            EventKind::VerificationFailed {
                task_id: finished_task_id(&finished)?,
                reason: input.summary,
            },
        );
        append_batch_and_notify(&mut store, &[finished, failure], "worker_result_failed")?;
        ensure_failure_attention(&mut store, &run_id, &failed_task_id, &failure_summary)?;
    }
    Ok(OperationOutput { accepted: true })
}

#[command]
pub fn record_verification(input: VerificationInput) -> Result<OperationOutput> {
    let task_id = TaskId::from(input.task_id);
    let failed_task_id = task_id.clone();
    let failure_reason = input.reason.clone();
    let passed = input.passed;
    let kind = if input.passed {
        EventKind::VerificationPassed {
            task_id,
            evidence: VerificationEvidence::new(
                input
                    .checks
                    .into_iter()
                    .map(|check| (check.id, check.passed)),
            ),
        }
    } else {
        EventKind::VerificationFailed {
            task_id,
            reason: input.reason,
        }
    };
    let mut store = store(&input.database_path)?;
    let event = Event::new(&input.run_id, kind);
    append_and_notify(&mut store, &event, "verification_failed")?;
    if !passed {
        ensure_failure_attention(&mut store, &input.run_id, &failed_task_id, &failure_reason)?;
    }
    let projection = store
        .projection(&input.run_id)
        .map_err(|error| bridge_error("snapshot_failed", error))?;
    if !projection.tasks.is_empty()
        && projection
            .tasks
            .values()
            .all(|task| task.state == loop_core::task::TaskState::Done)
    {
        let event = Event::new(&input.run_id, EventKind::RunCompleted);
        append_and_notify(&mut store, &event, "complete_run_failed")?;
    }
    Ok(OperationOutput { accepted: true })
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
        events.push(Event::new(&input.run_id, EventKind::TaskReady(task_id)));
    }
    append_batch_and_notify(&mut store, &events, "attention_resolution_failed")?;
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
    append(
        &input.database_path,
        Event::new(input.run_id, EventKind::AttentionCreated(attention)),
    )
}

#[command]
pub fn cancel_run(input: RunInput) -> Result<OperationOutput> {
    append(
        &input.database_path,
        Event::new(input.run_id, EventKind::RunCancelled),
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

#[command]
pub fn cleanup_run(input: CleanupRunInput) -> Result<CleanupRunOutput> {
    let mut store = store(&input.database_path)?;
    let policy = RetentionPolicy::new(input.keep_recent as usize);

    if !input.run_id.trim().is_empty() {
        let run_id = &input.run_id;
        let runs = store
            .runs()
            .map_err(|error| bridge_error("runs_failed", error))?;
        let Some((_, state)) = runs.iter().find(|(id, _)| id == run_id) else {
            // Run doesn't exist or already removed: double-purge is idempotent
            return Ok(CleanupRunOutput {
                removed_artifacts: vec![],
                skipped_artifacts: vec![],
            });
        };

        if !state.is_terminal() {
            return Ok(CleanupRunOutput {
                removed_artifacts: vec![],
                skipped_artifacts: vec![SkippedArtifactOutput {
                    artifact: run_id.clone(),
                    reason: format!("run {} is in non-terminal state {:?}", run_id, state),
                }],
            });
        }

        let removable = policy.select_removable_runs(runs.iter().map(|(id, state)| (id.as_str(), *state)));
        if input.keep_recent > 0 && !removable.contains(&run_id.as_str()) {
            return Ok(CleanupRunOutput {
                removed_artifacts: vec![],
                skipped_artifacts: vec![SkippedArtifactOutput {
                    artifact: run_id.clone(),
                    reason: format!(
                        "run {} is retained by retention policy (keep_recent = {})",
                        run_id, input.keep_recent
                    ),
                }],
            });
        }

        if !input.dry_run {
            store
                .purge_run(run_id)
                .map_err(|error| bridge_error("purge_failed", error))?;
        }

        Ok(CleanupRunOutput {
            removed_artifacts: vec![run_id.clone()],
            skipped_artifacts: vec![],
        })
    } else {
        let plan = store
            .purge_plan(policy)
            .map_err(|error| bridge_error("purge_plan_failed", error))?;
        let removed_artifacts: Vec<String> =
            plan.actions.iter().map(|a| a.target.clone()).collect();
        let skipped_artifacts: Vec<SkippedArtifactOutput> = plan
            .refusals
            .into_iter()
            .map(|r| SkippedArtifactOutput {
                artifact: r.target,
                reason: r.reason,
            })
            .collect();

        if !input.dry_run {
            for action in &plan.actions {
                store
                    .purge_run(&action.target)
                    .map_err(|error| bridge_error("purge_failed", error))?;
            }
        }

        Ok(CleanupRunOutput {
            removed_artifacts,
            skipped_artifacts,
        })
    }
}

#[command]
pub fn evaluate_worktree_removal(
    input: EvaluateWorktreeRemovalInput,
) -> Result<PolicyEvaluationOutput> {
    match loop_core::policy::evaluate_worktree_removal(
        &input.project_root,
        &input.worktree_path,
        input.is_merged,
        input.is_clean,
    ) {
        Ok(()) => Ok(PolicyEvaluationOutput {
            allowed: true,
            refusal_code: None,
            reason: None,
        }),
        Err(refusal) => Ok(PolicyEvaluationOutput {
            allowed: false,
            refusal_code: Some(
                serde_json::to_string(&refusal.code)
                    .unwrap_or_default()
                    .trim_matches('"')
                    .to_string(),
            ),
            reason: Some(refusal.reason),
        }),
    }
}

#[command]
pub fn evaluate_surface_removal(
    input: EvaluateSurfaceRemovalInput,
) -> Result<PolicyEvaluationOutput> {
    match loop_core::policy::evaluate_surface_removal(
        &input.surface_id,
        input.is_owned_by_loop,
    ) {
        Ok(()) => Ok(PolicyEvaluationOutput {
            allowed: true,
            refusal_code: None,
            reason: None,
        }),
        Err(refusal) => Ok(PolicyEvaluationOutput {
            allowed: false,
            refusal_code: Some(
                serde_json::to_string(&refusal.code)
                    .unwrap_or_default()
                    .trim_matches('"')
                    .to_string(),
            ),
            reason: Some(refusal.reason),
        }),
    }
}

fn append(path: &str, event: Event) -> Result<OperationOutput> {
    let mut store = store(path)?;
    append_and_notify(&mut store, &event, "event_append_failed")?;
    Ok(OperationOutput { accepted: true })
}

fn append_and_notify(
    store: &mut SqliteStore,
    event: &Event,
    error_code: &'static str,
) -> Result<i64> {
    let sequence = store
        .append(event)
        .map_err(|error| bridge_error(error_code, error))?;
    notify_run_changed(&event.run_id, sequence);
    Ok(sequence)
}

fn append_batch_and_notify(
    store: &mut SqliteStore,
    events: &[Event],
    error_code: &'static str,
) -> Result<i64> {
    let sequence = store
        .append_batch(events)
        .map_err(|error| bridge_error(error_code, error))?;
    if let Some(event) = events.last() {
        notify_run_changed(&event.run_id, sequence);
    }
    Ok(sequence)
}

fn notify_run_changed(run_id: &str, last_sequence: i64) {
    loop_package().emit(
        "loop.run_changed",
        RunChangedEvent {
            run_id: run_id.to_string(),
            last_sequence,
        },
    );
}

fn ensure_failure_attention(
    store: &mut SqliteStore,
    run_id: &str,
    task_id: &TaskId,
    summary: &str,
) -> Result<()> {
    let projection = store
        .projection(run_id)
        .map_err(|error| bridge_error("snapshot_failed", error))?;
    let Some(task) = projection.tasks.get(task_id) else {
        return Err(bridge_error("task_not_found", task_id));
    };
    if task.state != loop_core::task::TaskState::Attention {
        return Ok(());
    }
    // Attention ids are globally unique in the store, so scope them by run
    // to survive re-runs of the same task graph in a different run.
    let attention_id = format!("failure-{}-{}-{}", run_id, task_id, task.attempt);
    if projection.attention.contains_key(&attention_id) {
        return Ok(());
    }
    let event = Event::new(
        run_id,
        EventKind::AttentionCreated(Attention::for_task(
            attention_id,
            AttentionKind::Failure,
            summary,
            task_id.clone(),
        )),
    );
    append_and_notify(store, &event, "attention_failed")?;
    Ok(())
}

fn finished_task_id(event: &Event) -> Result<TaskId> {
    match &event.kind {
        EventKind::WorkerFinished { task_id, .. } => Ok(task_id.clone()),
        _ => Err(bridge_error("internal", "expected worker-finished event")),
    }
}

fn snapshot(store: &SqliteStore, run_id: &str) -> Result<SnapshotOutput> {
    let projection = store
        .projection(run_id)
        .map_err(|error| bridge_error("snapshot_failed", error))?;
    let state = projection
        .run_state
        .ok_or_else(|| bridge_error("run_not_found", run_id))?;
    Ok(SnapshotOutput {
        run_id: run_id.to_string(),
        state,
        tasks: projection
            .tasks
            .into_values()
            .map(|task| TaskSnapshotOutput {
                id: task.id.to_string(),
                title: task.title,
                kind: task.kind,
                state: task.state,
                attempt: task.attempt,
                preferred_compute: task.preferred_compute,
            })
            .collect(),
        active_workers: projection
            .active_workers
            .into_iter()
            .map(|(id, task_id)| ActiveWorkerOutput {
                id,
                task_id: task_id.to_string(),
            })
            .collect(),
        open_attention_ids: projection
            .attention
            .into_iter()
            .filter_map(|(id, attention)| {
                (attention.state == loop_core::attention::AttentionState::Open).then_some(id)
            })
            .collect(),
    })
}

fn task_from_input(input: TaskSpecInput) -> Result<Task> {
    Task::builder(TaskId::from(input.id), input.title, input.kind)
        .dependencies(input.dependencies.into_iter().map(TaskId::from))
        .ownership(WorkOwnership::new(input.read_scope, input.write_scope))
        .requirements(input.requirements)
        .completion_contract(CompletionContract::new(
            input.completion_checks.into_iter().map(|check| {
                CompletionCheck::command(
                    check.id,
                    check.command,
                    check.args,
                    check.working_directory,
                    check.timeout_ms,
                )
            }),
        ))
        .compute(
            input.preferred_compute,
            input.minimum_compute,
            input.maximum_compute,
        )
        .max_attempts(input.max_attempts)
        .build()
        .map_err(|error| bridge_error("invalid_task", error))
}

pub fn loop_package() -> &'static Package {
    static PACKAGE: OnceLock<Package> = OnceLock::new();
    PACKAGE.get_or_init(|| {
        let package = register!(
            Package::builder("loop.orchestration"),
            create_run,
            get_run,
            submit_plan,
            add_task,
            update_task,
            claim_runnable_tasks,
            record_worker_started,
            record_worker_result,
            record_verification,
            record_decision,
            request_attention,
            resolve_attention,
            cancel_run,
            resume_run,
            get_snapshot,
            subscribe_events,
            cleanup_run,
            evaluate_worktree_removal,
            evaluate_surface_removal
        )
        .event::<RunChangedEvent>("loop.run_changed")
        .build();
        package.register_ffi_with_default(FfiFormat::Json);
        package
    })
}
