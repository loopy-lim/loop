use loop_core::attention::{Attention, AttentionKind, AttentionResolution};
use loop_core::benchmark::{TraceComparison, TraceScore, TraceSummary};
use loop_core::event::{Event, EventKind};
use loop_core::graph::TaskGraph;
use loop_core::policy::{
    CleanupDisposition, ComputeClass, DependencyTerminalization, FailureClass, FailurePolicy,
    IndependentBranchAction, OnExhaustion, RefusalCode, RetentionPolicy, RetryOutcome, RetryScope,
    RunFailureAction, TerminalizationPolicy,
};
use loop_core::run::RunState;
use loop_core::scheduler::{Capacity, Scheduler};
use loop_core::task::{
    Assumption, CompletionCheck, CompletionContract, CompletionCoverage, DecompositionContract,
    DependencyConsumption, EvidenceLevel, SemanticAccess, SemanticConflictResolution,
    SemanticTouchpoint, Task, TaskId, TaskKind, TaskState, VerificationEvidence, WorkOwnership,
};
use loop_store::{SqliteStore, StoreError};
use rustra::prelude::*;
use std::sync::OnceLock;

use crate::conversation::{
    ConversationAssistantDelta, ConversationAssistantMessage, ConversationLifecycle,
    ConversationSteerQueued, ConversationToolCallEnded, ConversationToolCallStarted,
    ConversationUserMessage, RemoteSessionListOutput, RemoteSessionResetEvent,
};
use crate::pane::{RemotePaneListOutput, RemotePaneResetEvent, RemotePaneTextEvent};
use crate::context_summary::ContextSummaryEvent;
use crate::hooks::LifecycleHookEvent;
use crate::sandbox::SandboxCapabilityReport;
use crate::usage::UsageRecordEvent;
use crate::{EventOutput, GuidanceDeliveredEvent, RunChangedEvent};

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
    pub persona: Option<String>,
    pub completion_checks: Vec<CompletionCheckInput>,
    pub preferred_compute: ComputeClass,
    pub minimum_compute: ComputeClass,
    pub maximum_compute: ComputeClass,
    pub routing: Option<loop_core::policy::TaskRouting>,
    pub max_attempts: u16,
}

#[bridge_type]
pub struct AssumptionInput {
    pub assumption: String,
    pub evidence: String,
    pub if_false: String,
    pub revisit: String,
}

#[bridge_type]
pub struct SemanticTouchpointInput {
    pub id: String,
    pub access: SemanticAccess,
    pub conflict_resolution: SemanticConflictResolution,
}

#[bridge_type]
pub struct DependencyConsumptionInput {
    pub dependency: String,
    pub decisions: Vec<String>,
    pub artifacts: Vec<String>,
    pub checks: Vec<String>,
    pub risks: Vec<String>,
}

#[bridge_type]
pub struct CompletionCoverageInput {
    pub check_id: String,
    pub requirements: Vec<String>,
    pub artifacts: Vec<String>,
    pub semantics: Vec<String>,
    pub evidence_level: EvidenceLevel,
}

#[bridge_type]
pub struct PreflightTaskSpecInput {
    pub task: TaskSpecInput,
    pub defaults: Vec<String>,
    pub assumptions: Vec<AssumptionInput>,
    pub semantic_touchpoints: Vec<SemanticTouchpointInput>,
    pub consumes: Vec<DependencyConsumptionInput>,
    pub completion_coverage: Vec<CompletionCoverageInput>,
    pub failure_policy: FailurePolicy,
}

#[bridge_type]
pub struct DecompositionContractOutput {
    pub defaults: Vec<String>,
    pub assumptions: Vec<AssumptionInput>,
    pub semantic_touchpoints: Vec<SemanticTouchpointInput>,
    pub consumes: Vec<DependencyConsumptionInput>,
    pub completion_coverage: Vec<CompletionCoverageInput>,
    pub failure_policy: FailurePolicy,
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
    pub execution_owner: Option<String>,
}

#[bridge_type]
pub struct WorkerInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub worker_id: String,
    pub execution_owner: Option<String>,
}

#[bridge_type]
pub struct RecordGuidanceDeliveredInput {
    pub database_path: String,
    pub run_id: String,
    pub guidance: GuidanceDeliveredEvent,
    pub execution_owner: Option<String>,
}

#[bridge_type]
pub struct WorkerResultInput {
    pub database_path: String,
    pub run_id: String,
    pub task_id: String,
    pub worker_id: String,
    pub success: bool,
    pub summary: String,
    pub execution_owner: Option<String>,
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
    pub dependencies: Vec<String>,
    pub read_scope: Vec<String>,
    pub write_scope: Vec<String>,
    pub blocked_by: Vec<String>,
    pub last_failure: Option<String>,
    pub activities: Vec<String>,
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
    pub id: String,
    pub kind: AttentionKind,
    pub summary: String,
    pub task_id: Option<String>,
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
pub struct EvaluateCleanupDispositionInput {
    pub refusal_code: RefusalCode,
}

#[bridge_type]
pub struct CleanupDispositionOutput {
    pub disposition: CleanupDisposition,
}

#[bridge_type]
pub struct EvaluateFailurePolicyInput {
    pub failure_class: FailureClass,
    pub retries_used: u16,
    pub task_kind: TaskKind,
    pub failure_policy: FailurePolicy,
    pub terminalization_policy: TerminalizationPolicy,
}

#[bridge_type]
pub enum FailurePolicyAction {
    Retry,
    FailTask,
    RequireAttention,
}

#[bridge_type]
pub struct FailurePolicyOutput {
    pub action: FailurePolicyAction,
    pub retry_scope: Option<RetryScope>,
    pub delay_ms: Option<u64>,
    pub dependents: Option<DependencyTerminalization>,
    pub independent_branches: Option<IndependentBranchAction>,
    pub run: Option<RunFailureAction>,
}

#[bridge_type]
pub struct EvaluateSurfaceRemovalInput {
    pub surface_id: String,
    pub is_owned_by_loop: bool,
}

#[bridge_type]
pub struct GetTraceInput {
    pub database_path: String,
    pub run_id: String,
}

#[bridge_type]
pub struct CompareTracesInput {
    pub database_path: String,
    pub run_ids: Vec<String>,
}

/// Per-run row of a benchmark report: aggregated metrics plus derived score.
#[bridge_type]
pub struct TraceReportEntry {
    pub run_id: String,
    pub summary: TraceSummary,
    pub score: TraceScore,
}

#[bridge_type]
pub struct GetTraceOutput {
    pub run_id: String,
    pub summary: TraceSummary,
    pub score: TraceScore,
}

#[bridge_type]
pub struct CompareTracesOutput {
    /// One row per compared run, in input order (duplicates removed).
    pub entries: Vec<TraceReportEntry>,
    /// Deterministic ranking by score, highest first.
    pub comparison: TraceComparison,
}

pub(crate) fn bridge_error(code: &'static str, error: impl std::fmt::Display) -> RustraError {
    RustraError::custom(code, error.to_string())
}

pub(crate) fn store(path: &str) -> Result<SqliteStore> {
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
    let event = Event::new(&input.run_id, EventKind::TaskCreated(task));
    let sequence = store
        .append_task(&event)
        .map_err(|error| match error {
            StoreError::RunNotFound(_) => bridge_error("run_not_found", error),
            StoreError::Graph(_) | StoreError::Task(_) => bridge_error("invalid_graph", error),
            _ => bridge_error("add_task_failed", error),
        })?;
    notify_run_changed(&input.run_id, sequence);
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
    let projection = store
        .projection(&input.run_id)
        .map_err(|error| bridge_error("run_not_found", error))?;
    let task_id = TaskId::from(input.task_id);
    let current = projection
        .tasks
        .get(&task_id)
        .ok_or_else(|| bridge_error("task_not_found", &task_id))?
        .state;
    if current == TaskState::Ready {
        return Ok(OperationOutput { accepted: true });
    }
    if matches!(
        current,
        TaskState::Running
            | TaskState::Verifying
            | TaskState::Blocked
            | TaskState::Cancelled
            | TaskState::Done
    ) {
        return Err(bridge_error(
            "reconciliation_required",
            "running, verifying, terminally blocked, cancelled, or completed work cannot be reset with updateTask",
        ));
    }
    let event = Event::new(&input.run_id, EventKind::TaskReady(task_id));
    append_and_notify(&mut store, &event, "update_task_failed")?;
    Ok(OperationOutput { accepted: true })
}

#[command]
pub fn claim_runnable_tasks(input: ClaimRunnableTasksInput) -> Result<TaskIdsOutput> {
    let mut store = store(&input.database_path)?;
    store
        .require_execution_owner(&input.run_id, input.execution_owner.as_deref())
        .map_err(|error| bridge_error("execution_owner_required", error))?;
    let projection = store
        .projection(&input.run_id)
        .map_err(|error| bridge_error("run_not_found", error))?;
    if projection.run_state != Some(RunState::Active) || projection.has_open_attention() {
        return Ok(TaskIdsOutput { task_ids: vec![] });
    }
    let mut running: Vec<_> = projection
        .tasks
        .values()
        .filter(|task| matches!(task.state, TaskState::Running | TaskState::Verifying))
        .map(|task| task.id.clone())
        .chain(input.running_task_ids.into_iter().map(TaskId::from))
        .collect();
    running.sort();
    running.dedup();
    let graph = TaskGraph::new(projection.tasks.into_values())
        .map_err(|error| bridge_error("invalid_graph", error))?;
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
        append_batch_and_notify_owned(
            &mut store,
            &ready_events,
            input.execution_owner.as_deref(),
            "claim_failed",
        )?;
    }
    Ok(TaskIdsOutput {
        task_ids: claimed.into_iter().map(|id| id.to_string()).collect(),
    })
}

#[command]
pub fn record_worker_started(input: WorkerInput) -> Result<OperationOutput> {
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::WorkerStarted {
                task_id: TaskId::from(input.task_id),
                worker_id: input.worker_id,
            },
        ),
        input.execution_owner.as_deref(),
    )
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
        let output = Event::new(
            &run_id,
            EventKind::TaskOutputRecorded {
                task_id: failed_task_id.clone(),
                summary: input.summary,
            },
        );
        append_batch_and_notify_owned(
            &mut store,
            &[finished, output],
            input.execution_owner.as_deref(),
            "worker_result_failed",
        )?;
    } else {
        let task_id = finished_task_id(&finished)?;
        let failure = Event::new(
            &input.run_id,
            if input.execution_owner.is_some() {
                // Transport faults (connection errors, socket resets, request
                // timeouts) take the Interrupted attention/retry path instead
                // of burning the attempt ladder toward terminal failure.
                let failure_class = FailureClass::classify_transport(&failure_summary)
                    .unwrap_or(FailureClass::Environment);
                EventKind::VerificationClassifiedFailure {
                    task_id,
                    failure_class,
                    reason: input.summary,
                }
            } else {
                // Without a lease owner, external process liveness is not
                // proven; retain the legacy attention/reconciliation path.
                EventKind::VerificationFailed {
                    task_id,
                    reason: input.summary,
                }
            },
        );
        append_batch_and_notify_owned(
            &mut store,
            &[finished, failure],
            input.execution_owner.as_deref(),
            "worker_result_failed",
        )?;
        ensure_failure_attention(
            &mut store,
            &run_id,
            &failed_task_id,
            &failure_summary,
            input.execution_owner.as_deref(),
        )?;
    }
    Ok(OperationOutput { accepted: true })
}

#[command]
pub fn record_verification(input: VerificationInput) -> Result<OperationOutput> {
    let execution_owner = input.execution_owner.clone();
    let task_id = TaskId::from(input.task_id);
    let failed_task_id = task_id.clone();
    let mut store = store(&input.database_path)?;
    let projection = store
        .projection(&input.run_id)
        .map_err(|error| bridge_error("snapshot_failed", error))?;
    let source_drift = !input.checks.is_empty() && projection.checks.get(&task_id)
        .is_some_and(|receipts| receipts.iter().any(|receipt| {
            receipt.source.as_ref().is_some_and(|source| !source.is_stable())
        }));
    let passed = input.passed && !source_drift;
    let failure_reason = if source_drift {
        "Source changed during completion checks; rerun checks on stable source".to_string()
    } else {
        input.reason.clone()
    };
    let failure_class = if passed {
        FailureClass::Assertion
    } else {
        match projection.checks.get(&task_id) {
            Some(receipts) if receipts.iter().any(|receipt| receipt.timed_out) => {
                FailureClass::Timeout
            }
            Some(_) if !input.checks.is_empty() => FailureClass::Assertion,
            // Check-free reasons are owner errors, not check evidence, so a
            // transport fault text classifies as Interrupted rather than
            // Environment (which would consume the attempt ladder).
            _ => FailureClass::classify_transport(&input.reason)
                .unwrap_or(FailureClass::Environment),
        }
    };
    let kind = if passed {
        EventKind::VerificationPassed {
            task_id,
            evidence: VerificationEvidence::new(
                input
                    .checks
                    .into_iter()
                    .map(|check| (check.id, check.passed)),
            ),
        }
    } else if execution_owner.is_some() {
        EventKind::VerificationClassifiedFailure {
            task_id,
            failure_class,
            reason: failure_reason.clone(),
        }
    } else {
        EventKind::VerificationFailed {
            task_id,
            reason: failure_reason.clone(),
        }
    };
    let event = Event::new(&input.run_id, kind);
    let sequence = store
        .append_verification_owned(&event, execution_owner.as_deref())
        .map_err(|error| bridge_error("verification_failed", error))?;
    notify_run_changed(&input.run_id, sequence);
    if !passed {
        ensure_failure_attention(
            &mut store,
            &input.run_id,
            &failed_task_id,
            &failure_reason,
            execution_owner.as_deref(),
        )?;
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
    let event = Event::new(input.run_id, EventKind::AttentionCreated(attention));
    match input.execution_owner.as_deref() {
        Some(owner) => append_owned(&input.database_path, event, Some(owner)),
        None => append(&input.database_path, event),
    }
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
pub fn record_worker_stopped(input: WorkerInput) -> Result<OperationOutput> {
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::WorkerStopped {
                task_id: TaskId::from(input.task_id),
                worker_id: input.worker_id,
            },
        ),
        input.execution_owner.as_deref(),
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
    let nodes = snapshot.tasks.into_iter().map(|task| GraphNodeOutput {
        workers: snapshot.active_workers.iter().filter(|worker| worker.task_id == task.id).map(|worker| worker.id.clone()).collect(),
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
    }).collect();
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

        let removable =
            policy.select_removable_runs(runs.iter().map(|(id, state)| (id.as_str(), *state)));
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
    match loop_core::policy::evaluate_surface_removal(&input.surface_id, input.is_owned_by_loop) {
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

fn run_trace_summary(database_path: &str, run_id: &str) -> Result<TraceSummary> {
    let store = store(database_path)?;
    let events = store
        .events(run_id)
        .map_err(|error| bridge_error("trace_failed", error))?;
    if events.is_empty() {
        return Err(bridge_error("run_not_found", run_id));
    }
    let mut summary = TraceSummary::from_events(&events);
    let projection = store
        .projection(run_id)
        .map_err(|error| bridge_error("trace_failed", error))?;
    // Store runs complete tasks through VerificationPassed; TaskCompleted is an
    // optional runtime receipt, so take completions from the projection.
    summary.tasks_completed = u32::try_from(
        projection
            .tasks
            .values()
            .filter(|task| task.state == TaskState::Done)
            .count(),
    )
    .unwrap_or(u32::MAX);
    Ok(summary)
}

/// Capability scores advertised for a compute candidate (loop-core
/// `ComputeCapabilities` mirror; the core type lacks a JSON schema derive,
/// so the bridge carries its own wire form and converts on entry).
#[bridge_type]
pub struct ComputeCapabilitiesInput {
    pub coding: u8,
    pub reasoning: u8,
    pub tools: u8,
    pub vision: u8,
    pub long_context: u8,
}

/// Task risk driving the compute-class floor (loop-core `Risk` mirror).
#[bridge_type]
pub enum RoutingRisk {
    Low,
    Medium,
    High,
    Critical,
}

#[bridge_type]
pub struct ComputeCandidateInput {
    pub id: String,
    pub compute_class: ComputeClass,
    pub capabilities: ComputeCapabilitiesInput,
    pub latency: u16,
    pub cost_weight: u16,
    pub available: bool,
}

#[bridge_type]
pub struct CapabilityRequirementsInput {
    pub capabilities: ComputeCapabilitiesInput,
    pub minimum_compute: ComputeClass,
    pub maximum_compute: ComputeClass,
    pub risk: RoutingRisk,
    pub high_risk_floor: ComputeClass,
    pub critical_risk_floor: ComputeClass,
}

#[bridge_type]
pub struct SelectCandidateInput {
    pub candidates: Vec<ComputeCandidateInput>,
    pub eligible_candidate_ids: Vec<String>,
    pub requirements: CapabilityRequirementsInput,
}

#[bridge_type]
pub struct SelectCandidateOutput {
    pub candidate_id: String,
    pub compute_class: ComputeClass,
}

impl From<ComputeCapabilitiesInput> for loop_core::policy::ComputeCapabilities {
    fn from(input: ComputeCapabilitiesInput) -> Self {
        Self::new(
            input.coding,
            input.reasoning,
            input.tools,
            input.vision,
            input.long_context,
        )
    }
}

impl From<RoutingRisk> for loop_core::policy::Risk {
    fn from(risk: RoutingRisk) -> Self {
        match risk {
            RoutingRisk::Low => Self::Low,
            RoutingRisk::Medium => Self::Medium,
            RoutingRisk::High => Self::High,
            RoutingRisk::Critical => Self::Critical,
        }
    }
}

impl From<ComputeCandidateInput> for loop_core::policy::ComputeCandidate {
    fn from(input: ComputeCandidateInput) -> Self {
        let mut candidate = Self::new(
            input.id,
            input.compute_class,
            input.capabilities.into(),
            input.latency,
            input.cost_weight,
        );
        candidate.available = input.available;
        candidate
    }
}

#[command]
pub fn select_candidate(input: SelectCandidateInput) -> Result<SelectCandidateOutput> {
    let requirements = loop_core::policy::CapabilityRequirements::new(
        input.requirements.capabilities.coding,
        input.requirements.capabilities.reasoning,
        input.requirements.capabilities.tools,
        input.requirements.capabilities.vision,
        input.requirements.capabilities.long_context,
    )
    .with_compute_range(
        input.requirements.minimum_compute,
        input.requirements.maximum_compute,
    )
    .with_risk(input.requirements.risk.into())
    .with_risk_floors(
        input.requirements.high_risk_floor,
        input.requirements.critical_risk_floor,
    );
    let candidates: Vec<loop_core::policy::ComputeCandidate> =
        input.candidates.into_iter().map(Into::into).collect();
    let eligible_candidate_ids: std::collections::BTreeSet<String> =
        input.eligible_candidate_ids.into_iter().collect();
    let selected =
        loop_core::policy::select_candidate(&candidates, &eligible_candidate_ids, &requirements)
            .map_err(|error| bridge_error("no_sufficient_candidate", error))?;
    Ok(SelectCandidateOutput {
        candidate_id: selected.id.clone(),
        compute_class: selected.compute_class,
    })
}

#[command]
pub fn evaluate_cleanup_disposition(
    input: EvaluateCleanupDispositionInput,
) -> Result<CleanupDispositionOutput> {
    Ok(CleanupDispositionOutput {
        disposition: input.refusal_code.disposition(),
    })
}

#[command]
pub fn evaluate_failure_policy(input: EvaluateFailurePolicyInput) -> Result<FailurePolicyOutput> {
    Ok(
        match input
            .failure_policy
            .evaluate(input.failure_class, input.retries_used)
        {
            RetryOutcome::Retry { scope, delay_ms } => FailurePolicyOutput {
                action: FailurePolicyAction::Retry,
                retry_scope: Some(scope),
                delay_ms: Some(delay_ms),
                dependents: None,
                independent_branches: None,
                run: None,
            },
            RetryOutcome::Exhausted(OnExhaustion::RequireAttention) => FailurePolicyOutput {
                action: FailurePolicyAction::RequireAttention,
                retry_scope: None,
                delay_ms: None,
                dependents: None,
                independent_branches: None,
                run: None,
            },
            RetryOutcome::Exhausted(OnExhaustion::FailTask) => {
                let terminalization = input.terminalization_policy.outcome(input.task_kind);
                FailurePolicyOutput {
                    action: FailurePolicyAction::FailTask,
                    retry_scope: None,
                    delay_ms: None,
                    dependents: Some(terminalization.dependents),
                    independent_branches: Some(terminalization.independent_branches),
                    run: Some(terminalization.run),
                }
            }
        },
    )
}

#[command]
pub fn get_trace(input: GetTraceInput) -> Result<GetTraceOutput> {
    let run_id = input.run_id.clone();
    let summary = run_trace_summary(&input.database_path, &run_id)?;
    Ok(GetTraceOutput {
        run_id,
        score: summary.score(),
        summary,
    })
}

#[command]
pub fn compare_traces(input: CompareTracesInput) -> Result<CompareTracesOutput> {
    if input.run_ids.is_empty() {
        return Err(bridge_error(
            "invalid_comparison",
            "at least one run_id is required",
        ));
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut entries = Vec::with_capacity(input.run_ids.len());
    let mut ranked = Vec::with_capacity(input.run_ids.len());
    for run_id in input.run_ids {
        if !seen.insert(run_id.clone()) {
            continue;
        }
        let summary = run_trace_summary(&input.database_path, &run_id)?;
        ranked.push((run_id.clone(), summary));
        entries.push(TraceReportEntry {
            run_id,
            score: summary.score(),
            summary,
        });
    }
    Ok(CompareTracesOutput {
        entries,
        comparison: loop_core::benchmark::compare_traces(ranked),
    })
}

pub(crate) fn append(path: &str, event: Event) -> Result<OperationOutput> {
    let mut store = store(path)?;
    append_and_notify(&mut store, &event, "event_append_failed")?;
    Ok(OperationOutput { accepted: true })
}

pub(crate) fn append_owned(
    path: &str,
    event: Event,
    owner: Option<&str>,
) -> Result<OperationOutput> {
    let mut store = store(path)?;
    append_and_notify_owned(&mut store, &event, owner, "event_append_failed")?;
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

fn append_and_notify_owned(
    store: &mut SqliteStore,
    event: &Event,
    owner: Option<&str>,
    error_code: &'static str,
) -> Result<i64> {
    append_batch_and_notify_owned(store, std::slice::from_ref(event), owner, error_code)
}

pub(crate) fn append_batch_and_notify(
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

pub(crate) fn append_batch_and_notify_owned(
    store: &mut SqliteStore,
    events: &[Event],
    owner: Option<&str>,
    error_code: &'static str,
) -> Result<i64> {
    let sequence = store
        .append_batch_owned(events, owner)
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
    execution_owner: Option<&str>,
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
    append_and_notify_owned(store, &event, execution_owner, "attention_failed")?;
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
    let attention: Vec<_> = projection
        .attention
        .values()
        .filter(|item| item.state == loop_core::attention::AttentionState::Open)
        .map(|item| AttentionSnapshotOutput {
            id: item.id.clone(),
            kind: item.kind,
            summary: item.summary.clone(),
            task_id: item.task_id.as_ref().map(ToString::to_string),
        })
        .collect();
    let tasks = projection
        .tasks
        .values()
        .map(|task| TaskSnapshotOutput {
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
        .collect();
    let lease = store
        .execution_lease(run_id)
        .map_err(|error| bridge_error("lease_failed", error))?;
    let goal_criteria = projection.goal_criteria_status().into_iter().map(|item| GoalCriterionStatusOutput {
        id: item.criterion.id,
        description: item.criterion.description,
        task_id: item.criterion.task_id.to_string(),
        check_ids: item.criterion.check_ids,
        state: item.state,
    }).collect();
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

pub(crate) fn task_from_preflight_input(input: PreflightTaskSpecInput) -> Result<Task> {
    let mut task = task_from_input(input.task)?;
    let mut coverage_by_check = std::collections::BTreeMap::new();
    for coverage in input.completion_coverage {
        let coverage = (
            coverage.check_id,
            CompletionCoverage::new(
                coverage.requirements,
                coverage.artifacts,
                coverage.semantics,
                coverage.evidence_level,
            ),
        );
        if coverage_by_check.insert(coverage.0, coverage.1).is_some() {
            return Err(bridge_error(
                "invalid_task",
                "completion coverage contains a duplicate check id",
            ));
        }
    }
    for check in &mut task.completion_contract.checks {
        check.coverage = coverage_by_check.remove(&check.id);
    }
    if !coverage_by_check.is_empty() {
        return Err(bridge_error(
            "invalid_task",
            "completion coverage references an unknown check",
        ));
    }
    task.decomposition_contract = Some(DecompositionContract::new(
        input.defaults,
        input.assumptions.into_iter().map(|assumption| {
            Assumption::new(
                assumption.assumption,
                assumption.evidence,
                assumption.if_false,
                assumption.revisit,
            )
        }),
        input.semantic_touchpoints.into_iter().map(|touchpoint| {
            SemanticTouchpoint::new(
                touchpoint.id,
                touchpoint.access,
                touchpoint.conflict_resolution,
            )
        }),
        input.consumes.into_iter().map(|consumption| {
            DependencyConsumption::new(
                TaskId::from(consumption.dependency),
                consumption.decisions,
                consumption.artifacts,
                consumption.checks,
                consumption.risks,
            )
        }),
        input.failure_policy,
    ));
    Ok(task)
}

pub(crate) fn task_from_input(input: TaskSpecInput) -> Result<Task> {
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
        .routing(input.routing.unwrap_or_default())
        .max_attempts(input.max_attempts)
        .build()
        .map_err(|error| bridge_error("invalid_task", error))
}

pub fn loop_package() -> &'static Package {
    static PACKAGE: OnceLock<Package> = OnceLock::new();
    PACKAGE.get_or_init(|| {
        let package = register!(
            crate::execution::register_preflight(register!(
                crate::execution::register_execution(register!(
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
                    pause_run,
                    confirm_paused,
                    record_worker_stopped,
                    resume_run,
                    get_snapshot,
                    get_run_graph,
                    subscribe_events,
                    cleanup_run,
                    evaluate_worktree_removal,
                    evaluate_surface_removal,
                    get_trace,
                    compare_traces
                )),
                // Registered after the execution module so existing command ids
                // stay stable (additive exposure of the routing decision).
                select_candidate,
                evaluate_failure_policy,
                evaluate_cleanup_disposition
            )),
            // Appended after preflight so every existing command id stays
            // stable (additive exposure of the M-TL2 steer-mailbox delivery
            // record).
            record_guidance_delivered
        )
        .event::<RunChangedEvent>("loop.run_changed")
        // Terminal mirror v1 (decision 2026-xx-terminal-mirror D3): the pane
        // frame payloads are schema-anchored here so the gateway and the apps
        // consume GENERATED wire types. The native bridge never emits these
        // events — the gateway adapter frames them from herdr pane
        // observations over its own SSE surface; these declarations fix the
        // payload contracts (field names, u64 decimal-string rule) in Rust.
        .event::<RemotePaneListOutput>("loop.pane_list")
        .event::<RemotePaneTextEvent>("loop.pane_text")
        .event::<RemotePaneResetEvent>("loop.pane_reset")
        // GUI conversation view v1 (decision 2026-xx-gui-conversation D2): the
        // session conversation frame payloads are schema-anchored here so the
        // gateway and the apps consume GENERATED wire types. The native bridge
        // never emits these events — the gateway adapter frames them from the
        // pi extension tap over its own SSE surface; these declarations fix
        // the payload contracts (field names, identity keys, redacted bounded
        // text) in Rust. SSE frame names are these event names minus the
        // `loop.` prefix. Appended after the pane events so every existing
        // event id stays stable (additive third frame family).
        .event::<RemoteSessionListOutput>("loop.session_list")
        .event::<ConversationUserMessage>("loop.user_message")
        .event::<ConversationAssistantDelta>("loop.assistant_delta")
        .event::<ConversationAssistantMessage>("loop.assistant_message")
        .event::<ConversationToolCallStarted>("loop.tool_call_started")
        .event::<ConversationToolCallEnded>("loop.tool_call_ended")
        .event::<ConversationLifecycle>("loop.lifecycle")
        .event::<ConversationSteerQueued>("loop.steer_queued")
        .event::<RemoteSessionResetEvent>("loop.conversation_reset")
        // Gap-analysis wire families (docs/research/loop-gap-analysis.md):
        // schema-anchored declarative events the native bridge does not emit
        // or interpret. The orchestrator/adapters frame them over their own
        // transports; these declarations fix the payload contracts in Rust so
        // downstream surfaces consume GENERATED wire types. Appended after
        // the conversation events so every existing event id stays stable.
        // G1 context lifecycle: orchestrator summarization observations.
        .event::<ContextSummaryEvent>("loop.context_summary")
        // G4a sandbox capability: honest adapter isolation declarations for
        // doctor-style reporting (absence declares `none`, never inferred).
        .event::<SandboxCapabilityReport>("loop.sandbox_capabilities")
        // G17 usage: optional upstream-reported usage records; estimated and
        // observed figures are distinguished on the wire (`basis`).
        .event::<UsageRecordEvent>("loop.usage_recorded")
        // G13 lifecycle hooks: adapter typed event seam; hook outcomes are
        // evidence only — core completion judgment stays invariant.
        .event::<LifecycleHookEvent>("loop.lifecycle_hook")
        .build();
        package.register_ffi_with_default(FfiFormat::Json);
        package
    })
}

#[cfg(test)]
mod routing_tests {
    use super::*;

    fn candidate(id: &str, compute_class: ComputeClass, cost_weight: u16) -> ComputeCandidateInput {
        ComputeCandidateInput {
            id: id.into(),
            compute_class,
            capabilities: ComputeCapabilitiesInput {
                coding: 0,
                reasoning: 0,
                tools: 1,
                vision: 0,
                long_context: 0,
            },
            latency: 0,
            cost_weight,
            available: true,
        }
    }

    fn requirements(
        minimum: ComputeClass,
        maximum: ComputeClass,
        risk: RoutingRisk,
    ) -> CapabilityRequirementsInput {
        CapabilityRequirementsInput {
            capabilities: ComputeCapabilitiesInput {
                coding: 0,
                reasoning: 0,
                tools: 0,
                vision: 0,
                long_context: 0,
            },
            minimum_compute: minimum,
            maximum_compute: maximum,
            risk,
            high_risk_floor: ComputeClass::Strong,
            critical_risk_floor: ComputeClass::Frontier,
        }
    }

    fn eligible(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    #[test]
    fn select_candidate_prefers_the_cheapest_eligible_candidate() {
        let output = select_candidate(SelectCandidateInput {
            candidates: vec![
                candidate("expensive", ComputeClass::Fast, 90),
                candidate("cheap", ComputeClass::Fast, 10),
            ],
            eligible_candidate_ids: eligible(&["expensive", "cheap"]),
            requirements: requirements(ComputeClass::Fast, ComputeClass::Strong, RoutingRisk::Low),
        })
        .unwrap();
        assert_eq!(output.candidate_id, "cheap");
        assert_eq!(output.compute_class, ComputeClass::Fast);
    }

    #[test]
    fn select_candidate_applies_the_risk_floor() {
        let output = select_candidate(SelectCandidateInput {
            candidates: vec![
                candidate("tiny", ComputeClass::Tiny, 1),
                candidate("strong", ComputeClass::Strong, 50),
            ],
            eligible_candidate_ids: eligible(&["tiny", "strong"]),
            requirements: requirements(
                ComputeClass::Tiny,
                ComputeClass::Frontier,
                RoutingRisk::High,
            ),
        })
        .unwrap();
        // High risk floors the effective minimum at Strong, so the cheap
        // tiny candidate is rejected by the loop-core decision.
        assert_eq!(output.candidate_id, "strong");
    }

    #[test]
    fn select_candidate_respects_maximum_compute_and_eligibility() {
        let output = select_candidate(SelectCandidateInput {
            candidates: vec![
                candidate("frontier", ComputeClass::Frontier, 1),
                candidate("eligible-strong", ComputeClass::Strong, 40),
                candidate("ineligible-fast", ComputeClass::Fast, 1),
            ],
            eligible_candidate_ids: eligible(&["frontier", "eligible-strong"]),
            requirements: requirements(ComputeClass::Tiny, ComputeClass::Strong, RoutingRisk::Low),
        })
        .unwrap();
        assert_eq!(output.candidate_id, "eligible-strong");
    }

    #[test]
    fn select_candidate_enforces_capability_requirements() {
        let mut sighted = candidate("sighted", ComputeClass::Fast, 20);
        sighted.capabilities.vision = 1;
        let output = select_candidate(SelectCandidateInput {
            candidates: vec![candidate("blind", ComputeClass::Fast, 1), sighted],
            eligible_candidate_ids: eligible(&["blind", "sighted"]),
            requirements: CapabilityRequirementsInput {
                capabilities: ComputeCapabilitiesInput {
                    coding: 0,
                    reasoning: 0,
                    tools: 0,
                    vision: 1,
                    long_context: 0,
                },
                minimum_compute: ComputeClass::Fast,
                maximum_compute: ComputeClass::Strong,
                risk: RoutingRisk::Low,
                high_risk_floor: ComputeClass::Strong,
                critical_risk_floor: ComputeClass::Frontier,
            },
        })
        .unwrap();
        assert_eq!(output.candidate_id, "sighted");
    }

    #[test]
    fn cleanup_disposition_is_exposed_without_creating_attention() {
        let output = evaluate_cleanup_disposition(EvaluateCleanupDispositionInput {
            refusal_code: RefusalCode::RunNotTerminal,
        })
        .unwrap();

        assert!(matches!(output.disposition, CleanupDisposition::Defer));
    }

    #[test]
    fn failure_policy_returns_a_core_terminalization_outcome() {
        let output = evaluate_failure_policy(EvaluateFailurePolicyInput {
            failure_class: FailureClass::Assertion,
            retries_used: 0,
            task_kind: TaskKind::Integration,
            failure_policy: FailurePolicy::default(),
            terminalization_policy: TerminalizationPolicy::default(),
        })
        .unwrap();

        assert!(matches!(output.action, FailurePolicyAction::FailTask));
        assert_eq!(
            output.dependents,
            Some(DependencyTerminalization::BlockTerminal)
        );
        assert_eq!(output.run, Some(RunFailureAction::Fail));
        assert_eq!(output.retry_scope, None);
    }

    #[test]
    fn select_candidate_rejects_when_no_candidate_qualifies() {
        let mut offline = candidate("offline", ComputeClass::Fast, 1);
        offline.available = false;
        let error = select_candidate(SelectCandidateInput {
            candidates: vec![offline],
            eligible_candidate_ids: eligible(&["offline"]),
            requirements: requirements(ComputeClass::Fast, ComputeClass::Strong, RoutingRisk::Low),
        })
        .unwrap_err();
        assert_eq!(error.code(), "no_sufficient_candidate");
        assert_eq!(
            error.message(),
            "no eligible compute candidate satisfies task constraints"
        );
    }
}
