use loop_bridge::{
    ClaimRunnableTasksInput, CompletionCheckInput, CreateRunInput, RequestAttentionInput,
    ResolveAttentionInput, RunInput, SubmitPlanInput, TaskSpecInput, WorkerInput,
    WorkerResultInput, claim_runnable_tasks, create_run, get_snapshot, loop_package,
    record_worker_result, record_worker_started, request_attention, resolve_attention, submit_plan,
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
    })
    .unwrap();

    let paused = claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path: database_path.clone(),
        run_id: "approval-run".into(),
        running_task_ids: vec![],
        max_workers: 1,
        max_frontier_workers: 1,
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
    })
    .unwrap();
    assert_eq!(resumed.task_ids, vec!["destructive-task"]);
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
    })
    .unwrap();
    assert_eq!(claimed.task_ids, vec!["fragile"]);
    record_worker_started(WorkerInput {
        database_path: database_path.clone(),
        run_id: "failure-run".into(),
        task_id: "fragile".into(),
        worker_id: "worker-1".into(),
    })
    .unwrap();
    record_worker_result(WorkerResultInput {
        database_path: database_path.clone(),
        run_id: "failure-run".into(),
        task_id: "fragile".into(),
        worker_id: "worker-1".into(),
        success: false,
        summary: "failed after escalation".into(),
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
