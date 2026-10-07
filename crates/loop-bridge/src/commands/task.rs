//! Task lifecycle commands: plan submission, task transitions, runnable
//! claims, worker lifecycle records, and verification records — plus the
//! shared wire-input → core-`Task` converters used across the bridge.

use super::{
    OperationOutput, append_and_notify, append_and_notify_owned, append_batch_and_notify,
    append_batch_and_notify_owned, append_owned, bridge_error, notify_run_changed, store,
};
use loop_core::attention::{Attention, AttentionKind};
use loop_core::event::{Event, EventKind};
use loop_core::graph::TaskGraph;
use loop_core::policy::{ComputeClass, ContextBudgetPolicy, FailureClass, FailurePolicy};
use loop_core::run::WorkerState;
use loop_core::scheduler::{Capacity, ClaimDecision, ClaimOutcome, DispatchGate, Scheduler};
use loop_core::task::{
    Assumption, CompletionCheck, CompletionContract, CompletionCoverage, DecompositionContract,
    DependencyConsumption, EvidenceLevel, SemanticAccess, SemanticConflictResolution,
    SemanticTouchpoint, Task, TaskId, TaskKind, TaskState, VerificationEvidence, WorkOwnership,
};
use loop_store::{SqliteStore, StoreError};
use rustra::prelude::*;

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
pub struct SubmitPlanOutput {
    pub task_count: u32,
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
    pub state: Option<WorkerState>,
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
    pub state: Option<WorkerState>,
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

/// Wire mirror of loop-core's `ClaimDecision`: why a `claimRunnableTasks`
/// attempt returned what it returned. `task_ids` is empty unless the outcome
/// is `claimed`; the bridge never decides, it relays the scheduler verdict
/// (claimed / paused / attention-held / empty) so the orchestrator can tell a
/// hold apart from genuinely exhausted work without a snapshot race.
#[bridge_type]
pub struct TaskIdsOutput {
    pub outcome: loop_core::scheduler::ClaimOutcome,
    pub task_ids: Vec<String>,
}

pub(crate) fn register_task_plan(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(
        builder,
        submit_plan,
        add_task,
        update_task,
        claim_runnable_tasks
    )
}

pub(crate) fn register_task_workers(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(
        builder,
        record_worker_started,
        record_worker_result,
        record_verification
    )
}

pub(crate) fn register_task_stop(builder: rustra::PackageBuilder) -> rustra::PackageBuilder {
    register!(builder, record_worker_stopped)
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
    let sequence = store.append_task(&event).map_err(|error| match error {
        StoreError::RunNotFound(_) => bridge_error("run_not_found", error),
        StoreError::Graph(_) | StoreError::Task(_) => bridge_error("invalid_graph", error),
        _ => bridge_error("add_task_failed", error),
    })?;
    notify_run_changed(&input.run_id, sequence);
    Ok(OperationOutput {
        accepted: true,
        ..OperationOutput::default()
    })
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
        return Ok(OperationOutput {
            accepted: true,
            ..OperationOutput::default()
        });
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
    Ok(OperationOutput {
        accepted: true,
        ..OperationOutput::default()
    })
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
    let gate = DispatchGate {
        run_state: projection.run_state,
        has_open_attention: projection.has_open_attention(),
    };
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
    // Deterministic verdict lives in loop-core; this command only relays it
    // and materializes the Pending→Ready transitions for claimed work.
    let decision = Scheduler::new(Capacity::new(
        usize::from(input.max_workers.max(1)),
        usize::from(input.max_frontier_workers.max(1)),
    ))
    .claim(&graph, &running, gate);
    let (outcome, claimed) = match &decision {
        ClaimDecision::Claimed(claimed) => {
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
            (ClaimOutcome::Claimed, claimed.clone())
        }
        ClaimDecision::Paused => (ClaimOutcome::Paused, Vec::new()),
        ClaimDecision::AttentionHeld => (ClaimOutcome::AttentionHeld, Vec::new()),
        ClaimDecision::Empty => (ClaimOutcome::Empty, Vec::new()),
    };
    debug_assert_eq!(claimed.is_empty(), outcome != ClaimOutcome::Claimed);
    Ok(TaskIdsOutput {
        outcome,
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
                // timeouts) classify as Interrupted, which retries inside the
                // attempt ladder and only parks in Attention once the ladder
                // is exhausted. Prompt-budget overflows (inventory R2) are
                // the mirror case: they reproduce identically on every retry
                // of the same context, so they classify deterministic-
                // terminal (InvalidContract) after one attempt instead of as
                // Environment retry fodder.
                let failure_class = FailureClass::classify_transport(&failure_summary)
                    .or_else(|| ContextBudgetPolicy::classify_limit_failure(&failure_summary))
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
    Ok(OperationOutput {
        accepted: true,
        ..OperationOutput::default()
    })
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
    let source_drift = !input.checks.is_empty()
        && projection.checks.get(&task_id).is_some_and(|receipts| {
            receipts.iter().any(|receipt| {
                receipt
                    .source
                    .as_ref()
                    .is_some_and(|source| !source.is_stable())
            })
        });
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
            _ => {
                FailureClass::classify_transport(&input.reason).unwrap_or(FailureClass::Environment)
            }
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
    Ok(OperationOutput {
        accepted: true,
        ..OperationOutput::default()
    })
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

#[cfg(test)]
mod claim_relay_tests {
    use super::*;
    use crate::commands::SubmitPlanInput;
    use crate::commands::guidance::{
        RequestAttentionInput, ResolveAttentionInput, request_attention, resolve_attention,
    };
    use crate::commands::run::{CreateRunInput, RunInput, create_run, pause_run, resume_run};
    use loop_core::policy::ComputeClass;
    use loop_core::task::TaskKind;

    /// The bridge must relay loop-core's dispatch verdict verbatim: every
    /// hold (paused, attention-held, exhausted) yields an empty `task_ids`,
    /// and only `claimed` carries ids. No projection-field re-derivation
    /// belongs in this command.
    #[test]
    fn claim_runnable_tasks_relays_the_core_dispatch_verdict() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("loop.db").display().to_string();
        let run_id = "claim-verdict";
        create_run(CreateRunInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
        })
        .unwrap();
        submit_plan(SubmitPlanInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
            tasks: vec![task_spec("only")],
        })
        .unwrap();

        fn claim(database_path: &str, run_id: &str, running: Vec<String>) -> TaskIdsOutput {
            claim_runnable_tasks(ClaimRunnableTasksInput {
                database_path: database_path.into(),
                run_id: run_id.into(),
                running_task_ids: running,
                max_workers: 1,
                max_frontier_workers: 1,
                execution_owner: None,
            })
            .unwrap()
        }

        let claimed = claim(&database_path, run_id, vec![]);
        assert_eq!(claimed.outcome, ClaimOutcome::Claimed);
        assert_eq!(claimed.task_ids, vec!["only"]);

        pause_run(RunInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
        })
        .unwrap();
        let paused = claim(&database_path, run_id, vec![]);
        assert_eq!(paused.outcome, ClaimOutcome::Paused);
        assert!(paused.task_ids.is_empty());

        resume_run(RunInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
        })
        .unwrap();
        let capacity_held = claim(&database_path, run_id, vec!["only".into()]);
        assert_eq!(capacity_held.outcome, ClaimOutcome::Empty);
        assert!(capacity_held.task_ids.is_empty());

        request_attention(RequestAttentionInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
            attention_id: "hold-1".into(),
            kind: loop_core::attention::AttentionKind::Approval,
            summary: "Approve the claim verdict test".into(),
            task_id: None,
            execution_owner: None,
        })
        .unwrap();
        let attention_held = claim(&database_path, run_id, vec![]);
        assert_eq!(attention_held.outcome, ClaimOutcome::AttentionHeld);
        assert!(attention_held.task_ids.is_empty());

        resolve_attention(ResolveAttentionInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
            attention_id: "hold-1".into(),
            resolution: "approved".into(),
            corrective_task: None,
        })
        .unwrap();
        let resumed = claim(&database_path, run_id, vec![]);
        assert_eq!(resumed.outcome, ClaimOutcome::Claimed);
        assert_eq!(resumed.task_ids, vec!["only"]);
    }

    fn task_spec(id: &str) -> TaskSpecInput {
        TaskSpecInput {
            id: id.into(),
            title: id.into(),
            kind: TaskKind::Implementation,
            dependencies: vec![],
            read_scope: vec![],
            write_scope: vec!["src/**".into()],
            requirements: vec![format!("requirement-{id}")],
            persona: None,
            completion_checks: vec![CompletionCheckInput {
                id: "tests".into(),
                command: "true".into(),
                args: vec![],
                working_directory: None,
                timeout_ms: 1_000,
            }],
            preferred_compute: ComputeClass::Fast,
            minimum_compute: ComputeClass::Tiny,
            maximum_compute: ComputeClass::Strong,
            routing: None,
            max_attempts: 3,
        }
    }
}

#[cfg(test)]
mod prompt_limit_classification_tests {
    //! Inventory R2 (docs/defects/limits-inventory.md): a prompt-budget
    //! failure reproduces identically on every retry of the same context, so
    //! it must classify as InvalidContract (deterministic, terminal) instead
    //! of Environment (which burned the whole attempt ladder on a failure no
    //! retry could repair).

    use super::*;
    use crate::commands::{CreateRunInput, create_run};
    use crate::execution::{ExecutionLeaseInput, claim_execution};

    fn task_spec(id: &str) -> TaskSpecInput {
        TaskSpecInput {
            id: id.into(),
            title: id.into(),
            kind: TaskKind::Implementation,
            dependencies: vec![],
            read_scope: vec![],
            write_scope: vec!["src/**".into()],
            requirements: vec![format!("requirement-{id}")],
            persona: None,
            completion_checks: vec![CompletionCheckInput {
                id: "tests".into(),
                command: "true".into(),
                args: vec![],
                working_directory: None,
                timeout_ms: 1_000,
            }],
            preferred_compute: ComputeClass::Fast,
            minimum_compute: ComputeClass::Tiny,
            maximum_compute: ComputeClass::Strong,
            routing: None,
            max_attempts: 3,
        }
    }

    #[test]
    fn prompt_limit_failure_skips_the_retry_ladder_as_invalid_contract() {
        let dir = tempfile::tempdir().unwrap();
        let database_path = dir.path().join("loop.db").display().to_string();
        let run_id = "prompt-limit";
        create_run(CreateRunInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
        })
        .unwrap();
        submit_plan(SubmitPlanInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
            tasks: vec![task_spec("t1")],
        })
        .unwrap();
        claim_execution(ExecutionLeaseInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
            owner: "owner".into(),
            now_ms: 0,
            ttl_ms: 60_000,
        })
        .unwrap();
        claim_runnable_tasks(ClaimRunnableTasksInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
            running_task_ids: vec![],
            max_workers: 1,
            max_frontier_workers: 1,
            execution_owner: Some("owner".into()),
        })
        .unwrap();
        record_worker_started(WorkerInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
            task_id: "t1".into(),
            worker_id: "w-t1".into(),
            execution_owner: Some("owner".into()),
            state: None,
        })
        .unwrap();

        // The exact reason text the provider's prompt assembler throws with.
        record_worker_result(WorkerResultInput {
            database_path: database_path.clone(),
            run_id: run_id.into(),
            task_id: "t1".into(),
            worker_id: "w-t1".into(),
            success: false,
            summary: "Worker prompt essential contract field exceeds 6000 characters; split the task or shorten guidance before dispatch".into(),
            execution_owner: Some("owner".into()),
            state: None,
        })
        .unwrap();

        let projection = store(&database_path).unwrap().projection(run_id).unwrap();
        let task = projection.tasks.get(&TaskId::from("t1")).unwrap();
        assert_eq!(
            task.state,
            TaskState::Failed,
            "a deterministic prompt-limit failure must not re-enter the Ready retry ladder"
        );
        assert_eq!(task.attempt, 1, "exactly one attempt is consumed");
    }
}
