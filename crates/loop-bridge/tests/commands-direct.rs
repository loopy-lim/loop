use loop_bridge::{
    AddTaskInput, ClaimRunnableTasksInput, CompletionCheckInput, CreateRunInput, DecisionInput,
    RunInput, SubmitPlanInput, SubscribeEventsInput, TaskSpecInput, UpdateTaskInput, WorkerInput,
    add_task, claim_runnable_tasks, confirm_paused, create_run, get_run, pause_run,
    record_decision, record_worker_started, record_worker_stopped, resume_run, submit_plan,
    subscribe_events, update_task,
};
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
        max_attempts: 3,
    }
}

fn research_with_dependencies(id: &str, dependencies: Vec<String>) -> TaskSpecInput {
    let mut task = research(id);
    task.dependencies = dependencies;
    task
}

fn task_state(snapshot: &loop_bridge::SnapshotOutput, task_id: &str) -> TaskState {
    snapshot
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .unwrap_or_else(|| panic!("task {task_id} missing from snapshot"))
        .state
}

#[test]
fn get_run_returns_the_live_run_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("get-run.db").display().to_string();
    create_run(CreateRunInput {
        database_path: database_path.clone(),
        run_id: "get-run".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: database_path.clone(),
        run_id: "get-run".into(),
        tasks: vec![research("solo")],
    })
    .unwrap();

    let snapshot = get_run(RunInput {
        database_path: database_path.clone(),
        run_id: "get-run".into(),
    })
    .unwrap();
    assert_eq!(snapshot.run_id, "get-run");
    assert_eq!(snapshot.state, RunState::Active);
    assert_eq!(snapshot.tasks.len(), 1);
    assert_eq!(task_state(&snapshot, "solo"), TaskState::Pending);
    assert!(snapshot.last_sequence >= 2, "created + task events logged");

    let missing = get_run(RunInput {
        database_path,
        run_id: "no-such-run".into(),
    })
    .unwrap_err();
    assert!(missing.to_string().contains("snapshot_failed"));
}

#[test]
fn add_task_appends_a_task_to_an_existing_plan() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("add-task.db").display().to_string();
    create_run(CreateRunInput {
        database_path: database_path.clone(),
        run_id: "add-run".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: database_path.clone(),
        run_id: "add-run".into(),
        tasks: vec![research("seed")],
    })
    .unwrap();

    let added = add_task(AddTaskInput {
        database_path: database_path.clone(),
        run_id: "add-run".into(),
        task: research_with_dependencies("added", vec!["seed".into()]),
    })
    .unwrap();
    assert!(added.accepted);

    let snapshot = get_run(RunInput {
        database_path: database_path.clone(),
        run_id: "add-run".into(),
    })
    .unwrap();
    assert_eq!(snapshot.tasks.len(), 2);
    let appended = snapshot
        .tasks
        .iter()
        .find(|task| task.id == "added")
        .expect("appended task is part of the plan");
    assert_eq!(appended.state, TaskState::Pending);
    assert_eq!(appended.dependencies, vec!["seed"]);
    assert_eq!(appended.blocked_by, vec!["seed"]);

    let unknown_run = add_task(AddTaskInput {
        database_path: database_path.clone(),
        run_id: "no-such-run".into(),
        task: research("orphan"),
    })
    .unwrap_err();
    assert!(unknown_run.to_string().contains("run_not_found"));

    let missing_dependency = add_task(AddTaskInput {
        database_path: database_path.clone(),
        run_id: "add-run".into(),
        task: research_with_dependencies("dangling", vec!["ghost".into()]),
    })
    .unwrap_err();
    assert!(missing_dependency.to_string().contains("invalid_graph"));

    let duplicate = add_task(AddTaskInput {
        database_path: database_path.clone(),
        run_id: "add-run".into(),
        task: research("seed"),
    })
    .unwrap_err();
    assert!(duplicate.to_string().contains("invalid_graph"));

    let unchanged = get_run(RunInput {
        database_path,
        run_id: "add-run".into(),
    })
    .unwrap();
    assert_eq!(
        unchanged.tasks.len(),
        2,
        "rejected adds leave the plan intact"
    );
}

#[test]
fn update_task_exposes_only_the_ready_transition() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("update-task.db").display().to_string();
    create_run(CreateRunInput {
        database_path: database_path.clone(),
        run_id: "update-run".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: database_path.clone(),
        run_id: "update-run".into(),
        tasks: vec![research("pending-task")],
    })
    .unwrap();

    let ready = update_task(UpdateTaskInput {
        database_path: database_path.clone(),
        run_id: "update-run".into(),
        task_id: "pending-task".into(),
        state: TaskState::Ready,
    })
    .unwrap();
    assert!(ready.accepted);
    let snapshot = get_run(RunInput {
        database_path: database_path.clone(),
        run_id: "update-run".into(),
    })
    .unwrap();
    assert_eq!(task_state(&snapshot, "pending-task"), TaskState::Ready);

    let idempotent = update_task(UpdateTaskInput {
        database_path: database_path.clone(),
        run_id: "update-run".into(),
        task_id: "pending-task".into(),
        state: TaskState::Ready,
    })
    .unwrap();
    assert!(idempotent.accepted);

    let other_state = update_task(UpdateTaskInput {
        database_path: database_path.clone(),
        run_id: "update-run".into(),
        task_id: "pending-task".into(),
        state: TaskState::Done,
    })
    .unwrap_err();
    assert!(other_state.to_string().contains("invalid_task_update"));

    let unknown_task = update_task(UpdateTaskInput {
        database_path: database_path.clone(),
        run_id: "update-run".into(),
        task_id: "no-such-task".into(),
        state: TaskState::Ready,
    })
    .unwrap_err();
    assert!(unknown_task.to_string().contains("task_not_found"));
}

#[test]
fn record_decision_persists_a_durable_decision_event() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("decision.db").display().to_string();
    create_run(CreateRunInput {
        database_path: database_path.clone(),
        run_id: "decision-run".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: database_path.clone(),
        run_id: "decision-run".into(),
        tasks: vec![research("decider")],
    })
    .unwrap();

    let recorded = record_decision(DecisionInput {
        database_path: database_path.clone(),
        run_id: "decision-run".into(),
        decision_id: "decision-1".into(),
        task_id: Some("decider".into()),
        value: "keep sqlite as the only store".into(),
    })
    .unwrap();
    assert!(recorded.accepted);

    let events = subscribe_events(SubscribeEventsInput {
        database_path,
        run_id: "decision-run".into(),
        after_sequence: 0,
        limit: 100,
    })
    .unwrap();
    let decision = events
        .iter()
        .map(|event| serde_json::from_str::<serde_json::Value>(&event.payload_json).unwrap())
        .find(|payload| payload["kind"]["type"] == "decision_recorded")
        .expect("decision event is durable in the log");
    assert_eq!(decision["kind"]["data"]["decision_id"], "decision-1");
    assert_eq!(decision["kind"]["data"]["task_id"], "decider");
    assert_eq!(
        decision["kind"]["data"]["value"],
        "keep sqlite as the only store"
    );
}

#[test]
fn pause_run_and_confirm_paused_transition_the_run_state() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("pause.db").display().to_string();
    create_run(CreateRunInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
        tasks: vec![research("pausable")],
    })
    .unwrap();

    // An idle run pauses immediately: the request collapses to Paused.
    pause_run(RunInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
    })
    .unwrap();
    let idle = get_run(RunInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
    })
    .unwrap();
    assert_eq!(idle.state, RunState::Paused);

    resume_run(RunInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
    })
    .unwrap();
    let resumed = get_run(RunInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
    })
    .unwrap();
    assert_eq!(resumed.state, RunState::Active);

    // With a worker in flight the same request holds at Pausing until the
    // worker stops and the pause is confirmed.
    claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
        running_task_ids: vec![],
        max_workers: 1,
        max_frontier_workers: 1,
        execution_owner: None,
    })
    .unwrap();
    record_worker_started(WorkerInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
        task_id: "pausable".into(),
        worker_id: "worker-1".into(),
        execution_owner: None,
    })
    .unwrap();
    pause_run(RunInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
    })
    .unwrap();
    let pausing = get_run(RunInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
    })
    .unwrap();
    assert_eq!(pausing.state, RunState::Pausing);

    record_worker_stopped(WorkerInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
        task_id: "pausable".into(),
        worker_id: "worker-1".into(),
        execution_owner: None,
    })
    .unwrap();
    confirm_paused(RunInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
    })
    .unwrap();
    let paused = get_run(RunInput {
        database_path: database_path.clone(),
        run_id: "pause-run".into(),
    })
    .unwrap();
    assert_eq!(paused.state, RunState::Paused);
    assert_eq!(task_state(&paused, "pausable"), TaskState::Attention);
}

#[test]
fn subscribe_events_streams_events_after_a_sequence_cursor() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("events.db").display().to_string();
    create_run(CreateRunInput {
        database_path: database_path.clone(),
        run_id: "events-run".into(),
    })
    .unwrap();
    submit_plan(SubmitPlanInput {
        database_path: database_path.clone(),
        run_id: "events-run".into(),
        tasks: vec![research("first"), research("second")],
    })
    .unwrap();

    let all = subscribe_events(SubscribeEventsInput {
        database_path: database_path.clone(),
        run_id: "events-run".into(),
        after_sequence: 0,
        limit: 100,
    })
    .unwrap();
    assert_eq!(all.len(), 3, "run created plus two task events");
    let sequences: Vec<_> = all.iter().map(|event| event.sequence).collect();
    assert!(
        sequences.windows(2).all(|pair| pair[0] < pair[1]),
        "events stream in ascending sequence order: {sequences:?}"
    );
    let first = serde_json::from_str::<serde_json::Value>(&all[0].payload_json).unwrap();
    assert_eq!(first["run_id"], "events-run");
    assert_eq!(first["kind"]["type"], "run_created");

    record_decision(DecisionInput {
        database_path: database_path.clone(),
        run_id: "events-run".into(),
        decision_id: "decision-1".into(),
        task_id: None,
        value: "cursor the log instead of polling snapshots".into(),
    })
    .unwrap();

    let tail = subscribe_events(SubscribeEventsInput {
        database_path: database_path.clone(),
        run_id: "events-run".into(),
        after_sequence: 3,
        limit: 100,
    })
    .unwrap();
    assert_eq!(tail.len(), 1, "only events after the cursor are returned");
    assert!(tail[0].sequence > 3);
    let decision = serde_json::from_str::<serde_json::Value>(&tail[0].payload_json).unwrap();
    assert_eq!(decision["kind"]["type"], "decision_recorded");

    let clamped = subscribe_events(SubscribeEventsInput {
        database_path: database_path.clone(),
        run_id: "events-run".into(),
        after_sequence: 0,
        limit: 2,
    })
    .unwrap();
    assert_eq!(clamped.len(), 2, "limit bounds the batch size");
    assert_eq!(clamped[0].sequence, 1);

    let drained = subscribe_events(SubscribeEventsInput {
        database_path: database_path.clone(),
        run_id: "events-run".into(),
        after_sequence: 4,
        limit: 100,
    })
    .unwrap();
    assert!(drained.is_empty(), "a caught-up cursor yields no events");
}
