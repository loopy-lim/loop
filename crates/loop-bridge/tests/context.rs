use loop_bridge::*;
use loop_core::{policy::ComputeClass, task::TaskKind};

#[test]
fn worker_result_and_dependency_context_are_durable_and_relevant() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("context.db").display().to_string();
    let input = || RunInput {
        database_path: path.clone(),
        run_id: "run".into(),
    };
    create_run(CreateRunInput {
        database_path: path.clone(),
        run_id: "run".into(),
    })
    .unwrap();
    configure_run(ConfigureRunInput {
        database_path: path.clone(),
        run_id: "run".into(),
        intent: "User intent".into(),
        working_directory: "/project".into(),
    })
    .unwrap();
    let task = |id: &str, dependencies: Vec<String>| TaskSpecInput {
        id: id.into(),
        title: id.into(),
        kind: TaskKind::Research,
        dependencies,
        read_scope: vec!["docs/**".into()],
        write_scope: vec![],
        requirements: vec!["Find evidence".into()],
        persona: None,
        completion_checks: vec![CompletionCheckInput {
            id: "check".into(),
            command: "true".into(),
            args: vec![],
            working_directory: None,
            timeout_ms: 1000,
        }],
        preferred_compute: ComputeClass::Fast,
        minimum_compute: ComputeClass::Fast,
        maximum_compute: ComputeClass::Fast,
        routing: None,
        max_attempts: 2,
    };
    submit_plan(SubmitPlanInput {
        database_path: path.clone(),
        run_id: "run".into(),
        tasks: vec![task("a", vec![]), task("b", vec!["a".into()])],
    })
    .unwrap();
    claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path: path.clone(),
        run_id: "run".into(),
        running_task_ids: vec![],
        max_workers: 2,
        max_frontier_workers: 1,
        execution_owner: None,
    })
    .unwrap();
    record_worker_started(WorkerInput {
        database_path: path.clone(),
        run_id: "run".into(),
        task_id: "a".into(),
        worker_id: "worker-a".into(),
        execution_owner: None,
    })
    .unwrap();
    record_worker_result(WorkerResultInput {
        database_path: path.clone(),
        run_id: "run".into(),
        task_id: "a".into(),
        worker_id: "worker-a".into(),
        success: true,
        summary: "The upstream finding".into(),
        execution_owner: None,
    })
    .unwrap();
    record_verification(VerificationInput {
        database_path: path.clone(),
        run_id: "run".into(),
        task_id: "a".into(),
        passed: true,
        checks: vec![CheckResultInput {
            id: "check".into(),
            passed: true,
        }],
        reason: "".into(),
        execution_owner: None,
    })
    .unwrap();
    steer_run(SteerRunInput {
        database_path: path.clone(),
        run_id: "run".into(),
        task_id: Some("b".into()),
        message: "Keep compatibility".into(),
    })
    .unwrap();
    let context = get_task_context(TaskContextInput {
        database_path: path.clone(),
        run_id: "run".into(),
        task_id: "b".into(),
    })
    .unwrap();
    assert_eq!(context.intent, "User intent");
    assert_eq!(context.dependency_results.len(), 1);
    assert_eq!(
        context.dependency_results[0].summary,
        "The upstream finding"
    );
    assert_eq!(context.guidance, vec!["Keep compatibility"]);
    assert_eq!(context.task.read_scope, vec!["docs/**"]);
    let snapshot = get_snapshot(input()).unwrap();
    assert_eq!(snapshot.tasks[1].dependencies, vec!["a"]);
    assert!(snapshot.tasks[1].blocked_by.is_empty());
    assert!(snapshot.last_sequence > 0);
}

#[test]
fn invalid_prepared_plan_never_leaves_a_partial_run() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("atomic.db").display().to_string();
    assert!(
        prepare_run(PrepareRunInput {
            database_path: path.clone(),
            run_id: "invalid".into(),
            intent: "test".into(),
            working_directory: "/project".into(),
            tasks: vec![]
        })
        .is_err()
    );
    assert!(
        get_snapshot(RunInput {
            database_path: path,
            run_id: "invalid".into()
        })
        .is_err()
    );
}
