//! `record_guidance_delivered` bridge command (ADR M-TL2).
//!
//! The command appends the Rust-first `GuidanceDelivered` event; the store's
//! reducer owns the per-task ascending-only delivery watermark, so ordering
//! regressions and duplicates fail the append deterministically and a replay
//! of the log rebuilds the identical watermark.

use loop_bridge::{
    AddTaskInput, ClaimRunnableTasksInput, CompletionCheckInput, CreateRunInput,
    ExecutionLeaseInput, GuidanceDeliveredEvent, RecordGuidanceDeliveredInput, TaskSpecInput,
    WorkerInput, add_task, claim_execution, claim_runnable_tasks, create_run,
    record_guidance_delivered, record_worker_started,
};
use loop_core::event::{Event, RunProjection};
use loop_core::policy::ComputeClass;
use loop_core::task::{TaskId, TaskKind};
use loop_store::SqliteStore;

const RUN_ID: &str = "guidance-run";

fn task_spec(id: &str) -> TaskSpecInput {
    TaskSpecInput {
        id: id.into(),
        title: id.into(),
        kind: TaskKind::Implementation,
        dependencies: vec![],
        read_scope: vec![],
        write_scope: vec!["src/**".into()],
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
        routing: None,
        max_attempts: 3,
    }
}

fn delivery_input(
    database_path: &str,
    task_id: &str,
    worker_id: &str,
    through_sequence: i64,
) -> RecordGuidanceDeliveredInput {
    RecordGuidanceDeliveredInput {
        database_path: database_path.into(),
        run_id: RUN_ID.into(),
        guidance: GuidanceDeliveredEvent {
            task_id: task_id.into(),
            worker_id: worker_id.into(),
            through_sequence,
        },
        execution_owner: Some("orchestrator".into()),
    }
}

fn watermark(database_path: &str, task_id: &str) -> i64 {
    SqliteStore::open(database_path)
        .unwrap()
        .projection(RUN_ID)
        .unwrap()
        .guidance_delivered_through
        .get(&TaskId::from(task_id))
        .copied()
        .unwrap_or(0)
}

/// A run with one claimed task and one live worker — the state in which the
/// steer mailbox holds a registered target.
fn prepared_run(database_path: &str) {
    create_run(CreateRunInput {
        database_path: database_path.into(),
        run_id: RUN_ID.into(),
    })
    .unwrap();
    add_task(AddTaskInput {
        database_path: database_path.into(),
        run_id: RUN_ID.into(),
        task: task_spec("impl"),
    })
    .unwrap();
    claim_execution(ExecutionLeaseInput {
        database_path: database_path.into(),
        run_id: RUN_ID.into(),
        owner: "orchestrator".into(),
        now_ms: 0,
        ttl_ms: 30_000,
    })
    .unwrap();
    claim_runnable_tasks(ClaimRunnableTasksInput {
        database_path: database_path.into(),
        run_id: RUN_ID.into(),
        running_task_ids: vec![],
        max_workers: 1,
        max_frontier_workers: 1,
        execution_owner: Some("orchestrator".into()),
    })
    .unwrap();
    record_worker_started(WorkerInput {
        database_path: database_path.into(),
        run_id: RUN_ID.into(),
        task_id: "impl".into(),
        worker_id: "worker-1".into(),
        execution_owner: Some("orchestrator".into()),
    })
    .unwrap();
}

#[test]
fn successful_delivery_appends_an_ascending_watermark() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("delivered.db").display().to_string();
    prepared_run(&database_path);

    record_guidance_delivered(delivery_input(&database_path, "impl", "worker-1", 7)).unwrap();
    record_guidance_delivered(delivery_input(&database_path, "impl", "worker-1", 9)).unwrap();

    assert_eq!(watermark(&database_path, "impl"), 9);
}

#[test]
fn out_of_order_and_duplicate_deliveries_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("regressed.db").display().to_string();
    prepared_run(&database_path);

    record_guidance_delivered(delivery_input(&database_path, "impl", "worker-1", 9)).unwrap();

    let duplicate =
        record_guidance_delivered(delivery_input(&database_path, "impl", "worker-1", 9));
    assert!(duplicate.is_err(), "equal sequence must not pass the watermark");
    let regression = record_guidance_delivered(delivery_input(&database_path, "impl", "worker-1", 5));
    assert!(regression.is_err(), "lower sequence must not pass the watermark");

    // Both rejections left the watermark unchanged.
    assert_eq!(watermark(&database_path, "impl"), 9);
}

#[test]
fn malformed_delivery_input_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("malformed.db").display().to_string();
    prepared_run(&database_path);

    let empty_worker = record_guidance_delivered(delivery_input(&database_path, "impl", "  ", 3));
    assert!(empty_worker.is_err(), "worker id is required");

    let non_positive = record_guidance_delivered(delivery_input(&database_path, "impl", "worker-1", 0));
    assert!(non_positive.is_err(), "through_sequence must be positive");

    let unknown_task =
        record_guidance_delivered(delivery_input(&database_path, "no-such-task", "worker-1", 3));
    assert!(unknown_task.is_err(), "delivery requires a known task");

    assert_eq!(watermark(&database_path, "impl"), 0);
}

#[test]
fn delivery_replay_rebuilds_the_same_watermark() {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("replay.db").display().to_string();
    prepared_run(&database_path);
    record_guidance_delivered(delivery_input(&database_path, "impl", "worker-1", 7)).unwrap();
    record_guidance_delivered(delivery_input(&database_path, "impl", "worker-1", 11)).unwrap();

    let events: Vec<Event> = SqliteStore::open(&database_path)
        .unwrap()
        .events(RUN_ID)
        .unwrap();

    // Deterministic replay: applying the recorded log to a fresh projection
    // reproduces the stored watermark exactly.
    let mut projection = RunProjection::default();
    for event in &events {
        projection.apply(event).unwrap();
    }
    assert_eq!(
        projection.guidance_delivered_through.get(&TaskId::from("impl")),
        Some(&11)
    );
    assert_eq!(watermark(&database_path, "impl"), 11);
}
