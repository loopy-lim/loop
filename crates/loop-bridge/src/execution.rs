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
    let task = projection.tasks.get(&task_id)
        .ok_or_else(|| bridge_error("task_not_found", &task_id))?;
    let mut checks = input.checks;
    for check in &mut checks {
        if let Some(source) = &mut check.source {
            source.observed_outside_write_scope = task.ownership
                .observed_outside_write_scope(&source.observed_changed_paths);
        }
    }
    append_owned(
        &input.database_path,
        Event::new(
            input.run_id,
            EventKind::CheckReceiptsRecorded {
                task_id,
                checks,
            },
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
        configure_run,
        get_run_plan,
        get_task_context,
        record_check_receipts,
        stop_verification,
        record_activity,
        steer_run,
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
