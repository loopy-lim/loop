use loop_bridge::{
    ClaimRunnableTasksInput, CleanupRunInput, CompletionCheckInput, CreateRunInput,
    RequestAttentionInput, ResolveAttentionInput, RunInput, SubmitPlanInput, TaskSpecInput,
    WorkerInput, WorkerResultInput, cancel_run, claim_runnable_tasks, cleanup_run, create_run,
    get_snapshot, loop_package, record_worker_result, record_worker_started, request_attention,
    resolve_attention, submit_plan,
};
use loop_core::attention::AttentionKind;
use loop_core::policy::ComputeClass;
use loop_core::run::RunState;
use loop_core::task::{TaskKind, TaskState};

fn research(id: &str) -> TaskSpecInput {
    TaskSpecInput {
        id: id.into(),
        title: id.into(),
        kind: TaskKind::Research,
        dependencies: vec![],
        read_scope: vec![],
        write_scope: vec![],
        requirements: vec![],
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
        max_attempts: 3,
    }
}

#[test]
fn high_level_commands_create_plan_and_claim_ready_tasks() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("loop.db").display().to_string();
    create_run(CreateRunInput {
        database_path: database_path.clone(),
        run_id: "run-1".into(),
    })
    .unwrap();
    let submitted = submit_plan(SubmitPlanInput {
        database_path: database_path.clone(),
        run_id: "run-1".into(),
        tasks: vec![research("research-a"), research("research-b")],
    })
    .unwrap();
    assert_eq!(submitted.task_count, 2);

    let claimed = claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path,
        run_id: "run-1".into(),
        running_task_ids: vec![],
        max_workers: 2,
        max_frontier_workers: 1,
        execution_owner: None,
    })
    .unwrap();
    assert_eq!(claimed.task_ids, vec!["research-a", "research-b"]);
}

#[test]
fn rustra_package_exposes_the_orchestration_contract() {
    let schema = loop_package().live_schema();
    let commands = schema["commands"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|command| command["name"].as_str())
        .collect::<std::collections::BTreeSet<_>>();
    for required in [
        "createRun",
        "getRun",
        "submitPlan",
        "addTask",
        "updateTask",
        "claimRunnableTasks",
        "recordWorkerStarted",
        "recordWorkerResult",
        "recordVerification",
        "recordDecision",
        "requestAttention",
        "resolveAttention",
        "cancelRun",
        "resumeRun",
        "getSnapshot",
        "subscribeEvents",
        "cleanupRun",
    ] {
        assert!(commands.contains(required), "missing command {required}");
    }
    let events = schema["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|event| event["name"].as_str())
        .collect::<std::collections::BTreeSet<_>>();
    assert!(events.contains("loop.run_changed"));
}

#[test]
fn approval_attention_pauses_claims_until_it_is_resolved() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("loop.db").display().to_string();
    create_run(CreateRunInput {
        database_path: database_path.clone(),
        run_id: "approval-run".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: database_path.clone(),
        run_id: "approval-run".into(),
        tasks: vec![research("destructive-task")],
    })
    .unwrap();
    request_attention(RequestAttentionInput {
        database_path: database_path.clone(),
        run_id: "approval-run".into(),
        attention_id: "approval-1".into(),
        kind: AttentionKind::Approval,
        summary: "Confirm destructive migration".into(),
        task_id: None,
        execution_owner: None,
    })
    .unwrap();

    let paused = claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path: database_path.clone(),
        run_id: "approval-run".into(),
        running_task_ids: vec![],
        max_workers: 1,
        max_frontier_workers: 1,
        execution_owner: None,
    })
    .unwrap();
    assert!(paused.task_ids.is_empty());

    resolve_attention(ResolveAttentionInput {
        database_path: database_path.clone(),
        run_id: "approval-run".into(),
        attention_id: "approval-1".into(),
        resolution: "approved".into(),
    })
    .unwrap();
    let resumed = claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path,
        run_id: "approval-run".into(),
        running_task_ids: vec![],
        max_workers: 1,
        max_frontier_workers: 1,
        execution_owner: None,
    })
    .unwrap();
    assert_eq!(resumed.task_ids, vec!["destructive-task"]);
}

#[test]
fn approval_attention_rejects_plain_answers_and_rejection_cancels() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("loop.db").display().to_string();
    create_run(CreateRunInput {
        database_path: database_path.clone(),
        run_id: "approval-resolution".into(),
    })
    .unwrap();
    request_attention(RequestAttentionInput {
        database_path: database_path.clone(),
        run_id: "approval-resolution".into(),
        attention_id: "approval".into(),
        kind: AttentionKind::Approval,
        summary: "Confirm".into(),
        task_id: None,
        execution_owner: None,
    })
    .unwrap();
    assert!(
        resolve_attention(ResolveAttentionInput {
            database_path: database_path.clone(),
            run_id: "approval-resolution".into(),
            attention_id: "approval".into(),
            resolution: "yes".into(),
        })
        .is_err()
    );
    resolve_attention(ResolveAttentionInput {
        database_path: database_path.clone(),
        run_id: "approval-resolution".into(),
        attention_id: "approval".into(),
        resolution: "rejected: unsafe".into(),
    })
    .unwrap();
    assert_eq!(
        get_snapshot(RunInput {
            database_path,
            run_id: "approval-resolution".into(),
        })
        .unwrap()
        .state,
        RunState::Cancelled
    );
}

#[test]
fn exhausted_worker_failure_creates_retryable_human_attention() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("loop.db").display().to_string();
    create_run(CreateRunInput {
        database_path: database_path.clone(),
        run_id: "failure-run".into(),
    })
    .unwrap();
    let mut task = research("fragile");
    task.max_attempts = 1;
    submit_plan(SubmitPlanInput {
        database_path: database_path.clone(),
        run_id: "failure-run".into(),
        tasks: vec![task],
    })
    .unwrap();
    let claimed = claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path: database_path.clone(),
        run_id: "failure-run".into(),
        running_task_ids: vec![],
        max_workers: 1,
        max_frontier_workers: 1,
        execution_owner: None,
    })
    .unwrap();
    assert_eq!(claimed.task_ids, vec!["fragile"]);
    record_worker_started(WorkerInput {
        database_path: database_path.clone(),
        run_id: "failure-run".into(),
        task_id: "fragile".into(),
        worker_id: "worker-1".into(),
        execution_owner: None,
    })
    .unwrap();
    record_worker_result(WorkerResultInput {
        database_path: database_path.clone(),
        run_id: "failure-run".into(),
        task_id: "fragile".into(),
        worker_id: "worker-1".into(),
        success: false,
        summary: "failed after escalation".into(),
        execution_owner: None,
    })
    .unwrap();
    let paused = get_snapshot(RunInput {
        database_path: database_path.clone(),
        run_id: "failure-run".into(),
    })
    .unwrap();
    assert_eq!(paused.state, RunState::Attention);
    assert_eq!(paused.tasks[0].state, TaskState::Attention);
    assert_eq!(paused.open_attention_ids.len(), 1);

    resolve_attention(ResolveAttentionInput {
        database_path: database_path.clone(),
        run_id: "failure-run".into(),
        attention_id: paused.open_attention_ids[0].clone(),
        resolution: "retry".into(),
    })
    .unwrap();
    let resumed = get_snapshot(RunInput {
        database_path,
        run_id: "failure-run".into(),
    })
    .unwrap();
    assert_eq!(resumed.state, RunState::Active);
    assert_eq!(resumed.tasks[0].state, TaskState::Ready);
}

#[test]
fn retry_resolution_is_idempotent_for_ready_tasks() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("retry-ready.db").display().to_string();
    create_run(CreateRunInput {
        database_path: path.clone(),
        run_id: "retry-ready".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: path.clone(),
        run_id: "retry-ready".into(),
        tasks: vec![research("a")],
    })
    .unwrap();
    claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path: path.clone(),
        run_id: "retry-ready".into(),
        running_task_ids: vec![],
        max_workers: 1,
        max_frontier_workers: 1,
        execution_owner: None,
    })
    .unwrap();
    request_attention(RequestAttentionInput {
        database_path: path.clone(),
        run_id: "retry-ready".into(),
        attention_id: "provider-failure".into(),
        kind: AttentionKind::Failure,
        summary: "provider unavailable".into(),
        task_id: Some("a".into()),
        execution_owner: None,
    })
    .unwrap();
    resolve_attention(ResolveAttentionInput {
        database_path: path.clone(),
        run_id: "retry-ready".into(),
        attention_id: "provider-failure".into(),
        resolution: "retry".into(),
    })
    .unwrap();
    let snapshot = get_snapshot(RunInput {
        database_path: path,
        run_id: "retry-ready".into(),
    })
    .unwrap();
    assert_eq!(snapshot.state, RunState::Active);
    assert_eq!(snapshot.tasks[0].state, TaskState::Ready);
}

#[test]
fn retry_cannot_bypass_reconciliation_for_verifying_work() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("retry-verifying.db").display().to_string();
    create_run(CreateRunInput {
        database_path: path.clone(),
        run_id: "retry-verifying".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: path.clone(),
        run_id: "retry-verifying".into(),
        tasks: vec![research("a")],
    })
    .unwrap();
    claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path: path.clone(),
        run_id: "retry-verifying".into(),
        running_task_ids: vec![],
        max_workers: 1,
        max_frontier_workers: 1,
        execution_owner: None,
    })
    .unwrap();
    record_worker_started(WorkerInput {
        database_path: path.clone(),
        run_id: "retry-verifying".into(),
        task_id: "a".into(),
        worker_id: "worker".into(),
        execution_owner: None,
    })
    .unwrap();
    record_worker_result(WorkerResultInput {
        database_path: path.clone(),
        run_id: "retry-verifying".into(),
        task_id: "a".into(),
        worker_id: "worker".into(),
        success: true,
        summary: "done".into(),
        execution_owner: None,
    })
    .unwrap();
    request_attention(RequestAttentionInput {
        database_path: path.clone(),
        run_id: "retry-verifying".into(),
        attention_id: "recovery".into(),
        kind: AttentionKind::Failure,
        summary: "verification uncertain".into(),
        task_id: Some("a".into()),
        execution_owner: None,
    })
    .unwrap();
    assert!(
        resolve_attention(ResolveAttentionInput {
            database_path: path.clone(),
            run_id: "retry-verifying".into(),
            attention_id: "recovery".into(),
            resolution: "retry".into(),
        })
        .is_err()
    );
    let snapshot = get_snapshot(RunInput {
        database_path: path,
        run_id: "retry-verifying".into(),
    })
    .unwrap();
    assert_eq!(snapshot.tasks[0].state, TaskState::Verifying);
    assert_eq!(snapshot.open_attention_ids, vec!["recovery"]);
}

#[test]
fn cleanup_run_dry_run_and_execution_and_idempotency() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("loop.db").display().to_string();

    create_run(CreateRunInput {
        database_path: database_path.clone(),
        run_id: "run-term".into(),
    })
    .unwrap();

    cancel_run(RunInput {
        database_path: database_path.clone(),
        run_id: "run-term".into(),
    })
    .unwrap();

    // Dry run does not delete
    let dry_output = cleanup_run(CleanupRunInput {
        database_path: database_path.clone(),
        run_id: "run-term".into(),
        keep_recent: 0,
        dry_run: true,
    })
    .unwrap();
    assert_eq!(dry_output.removed_artifacts, vec!["run-term"]);
    assert!(dry_output.skipped_artifacts.is_empty());

    // Still exists
    assert!(
        get_snapshot(RunInput {
            database_path: database_path.clone(),
            run_id: "run-term".into(),
        })
        .is_ok()
    );

    // Actual execution deletes
    let exec_output = cleanup_run(CleanupRunInput {
        database_path: database_path.clone(),
        run_id: "run-term".into(),
        keep_recent: 0,
        dry_run: false,
    })
    .unwrap();
    assert_eq!(exec_output.removed_artifacts, vec!["run-term"]);
    assert!(exec_output.skipped_artifacts.is_empty());

    // Now it's gone
    assert!(
        get_snapshot(RunInput {
            database_path: database_path.clone(),
            run_id: "run-term".into(),
        })
        .is_err()
    );

    // Double-cleanup on already-deleted run is idempotent
    let idempotent_output = cleanup_run(CleanupRunInput {
        database_path: database_path.clone(),
        run_id: "run-term".into(),
        keep_recent: 0,
        dry_run: false,
    })
    .unwrap();
    assert!(idempotent_output.removed_artifacts.is_empty());
    assert!(idempotent_output.skipped_artifacts.is_empty());
}

#[test]
fn resume_never_bypasses_unresolved_approval() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.db").display().to_string();
    create_run(CreateRunInput {
        database_path: path.clone(),
        run_id: "resume".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: path.clone(),
        run_id: "resume".into(),
        tasks: vec![research("a")],
    })
    .unwrap();
    request_attention(RequestAttentionInput {
        database_path: path.clone(),
        run_id: "resume".into(),
        attention_id: "approval".into(),
        kind: AttentionKind::Approval,
        summary: "Approval required".into(),
        task_id: None,
        execution_owner: None,
    })
    .unwrap();
    loop_bridge::resume_run(RunInput {
        database_path: path.clone(),
        run_id: "resume".into(),
    })
    .unwrap();
    let snapshot = get_snapshot(RunInput {
        database_path: path.clone(),
        run_id: "resume".into(),
    })
    .unwrap();
    assert_eq!(snapshot.state, RunState::Attention);
    assert!(
        claim_runnable_tasks(ClaimRunnableTasksInput {
            database_path: path,
            run_id: "resume".into(),
            running_task_ids: vec![],
            max_workers: 2,
            max_frontier_workers: 1,
            execution_owner: None,
        })
        .unwrap()
        .task_ids
        .is_empty()
    );
}

#[test]
fn resolving_one_attention_keeps_the_other_request_blocking() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.db").display().to_string();
    create_run(CreateRunInput {
        database_path: path.clone(),
        run_id: "multi".into(),
    })
    .unwrap();
    for id in ["one", "two"] {
        request_attention(RequestAttentionInput {
            database_path: path.clone(),
            run_id: "multi".into(),
            attention_id: id.into(),
            kind: AttentionKind::Approval,
            summary: "Approval required".into(),
            task_id: None,
            execution_owner: None,
        })
        .unwrap();
    }
    resolve_attention(ResolveAttentionInput {
        database_path: path.clone(),
        run_id: "multi".into(),
        attention_id: "one".into(),
        resolution: "approved".into(),
    })
    .unwrap();
    let snapshot = get_snapshot(RunInput {
        database_path: path,
        run_id: "multi".into(),
    })
    .unwrap();
    assert_eq!(snapshot.state, RunState::Attention);
    assert_eq!(snapshot.open_attention_ids, vec!["two"]);
}

#[test]
fn cancellation_requires_worker_acknowledgement_and_terminal_runs_do_not_resume() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.db").display().to_string();
    create_run(CreateRunInput {
        database_path: path.clone(),
        run_id: "cancel".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: path.clone(),
        run_id: "cancel".into(),
        tasks: vec![research("a")],
    })
    .unwrap();
    claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path: path.clone(),
        run_id: "cancel".into(),
        running_task_ids: vec![],
        max_workers: 1,
        max_frontier_workers: 1,
        execution_owner: None,
    })
    .unwrap();
    record_worker_started(WorkerInput {
        database_path: path.clone(),
        run_id: "cancel".into(),
        task_id: "a".into(),
        worker_id: "worker".into(),
        execution_owner: None,
    })
    .unwrap();
    cancel_run(RunInput {
        database_path: path.clone(),
        run_id: "cancel".into(),
    })
    .unwrap();
    let snapshot = get_snapshot(RunInput {
        database_path: path.clone(),
        run_id: "cancel".into(),
    })
    .unwrap();
    assert_eq!(snapshot.state.to_string(), "cancelling");
    assert_eq!(snapshot.active_workers.len(), 1);
    create_run(CreateRunInput {
        database_path: path.clone(),
        run_id: "terminal".into(),
    })
    .unwrap();
    cancel_run(RunInput {
        database_path: path.clone(),
        run_id: "terminal".into(),
    })
    .unwrap();
    assert!(
        loop_bridge::resume_run(RunInput {
            database_path: path,
            run_id: "terminal".into()
        })
        .is_err()
    );
}

#[test]
fn reconciled_orphans_require_stop_confirmation_and_reject_a_live_owner() {
    use loop_bridge::{
        ExecutionLeaseInput, ReconcileTaskInput, ReleaseExecutionInput, claim_execution,
        reconcile_task, release_execution,
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.db").display().to_string();
    create_run(CreateRunInput {
        database_path: path.clone(),
        run_id: "orphan".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: path.clone(),
        run_id: "orphan".into(),
        tasks: vec![research("a")],
    })
    .unwrap();
    claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path: path.clone(),
        run_id: "orphan".into(),
        running_task_ids: vec![],
        max_workers: 1,
        max_frontier_workers: 1,
        execution_owner: None,
    })
    .unwrap();
    record_worker_started(WorkerInput {
        database_path: path.clone(),
        run_id: "orphan".into(),
        task_id: "a".into(),
        worker_id: "lost".into(),
        execution_owner: None,
    })
    .unwrap();
    let reconcile = |confirmed_stopped| ReconcileTaskInput {
        database_path: path.clone(),
        run_id: "orphan".into(),
        task_id: "a".into(),
        confirmed_stopped,
    };
    assert!(reconcile_task(reconcile(false)).is_err());
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    claim_execution(ExecutionLeaseInput {
        database_path: path.clone(),
        run_id: "orphan".into(),
        owner: "live".into(),
        now_ms,
        ttl_ms: 5000,
    })
    .unwrap();
    assert!(reconcile_task(reconcile(true)).is_err());
    release_execution(ReleaseExecutionInput {
        database_path: path.clone(),
        run_id: "orphan".into(),
        owner: "live".into(),
    })
    .unwrap();
    reconcile_task(reconcile(true)).unwrap();
    let snapshot = get_snapshot(RunInput {
        database_path: path.clone(),
        run_id: "orphan".into(),
    })
    .unwrap();
    assert!(snapshot.active_workers.is_empty());
    assert_eq!(snapshot.tasks[0].state, loop_core::task::TaskState::Ready);
}

#[test]
fn stale_execution_owner_cannot_request_attention() {
    use loop_bridge::{ExecutionLeaseInput, claim_execution};

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.db").display().to_string();
    create_run(CreateRunInput {
        database_path: path.clone(),
        run_id: "attention-fence".into(),
    })
    .unwrap();
    assert!(
        claim_execution(ExecutionLeaseInput {
            database_path: path.clone(),
            run_id: "attention-fence".into(),
            owner: "current-owner".into(),
            now_ms: 0,
            ttl_ms: 5_000,
        })
        .unwrap()
        .accepted
    );

    assert!(
        request_attention(RequestAttentionInput {
            database_path: path.clone(),
            run_id: "attention-fence".into(),
            attention_id: "stale-attention".into(),
            kind: AttentionKind::Failure,
            summary: "stale owner failure".into(),
            task_id: None,
            execution_owner: Some("stale-owner".into()),
        })
        .is_err()
    );
    assert!(
        get_snapshot(RunInput {
            database_path: path,
            run_id: "attention-fence".into(),
        })
        .unwrap()
        .open_attention_ids
        .is_empty()
    );
}
