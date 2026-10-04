#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use loop_core::attention::{Attention, AttentionKind, AttentionResolution};
use loop_core::benchmark::TraceSummary;
use loop_core::event::{Event, EventKind};
use loop_core::policy::ComputeClass;
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskId, TaskKind, VerificationEvidence,
    WorkOwnership,
};
use loop_store::{RunTraceReport, SqliteStore, StoreError};

#[test]
fn trace_report_aggregates_run_counts_and_per_task_rows() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = SqliteStore::open(dir.path().join("trace.sqlite")).unwrap();
    append_plan_run(&mut store);

    let report = store.trace_report("bench-plan-1").unwrap();
    assert_eq!(report.run_id, "bench-plan-1");
    assert_eq!(report.summary.total_events, 20);
    assert_eq!(report.summary.tasks_created, 2);
    assert_eq!(report.summary.tasks_completed, 2);
    assert_eq!(report.summary.worker_starts, 3);
    assert_eq!(report.summary.worker_finishes, 3);
    assert_eq!(report.summary.worker_failures, 0);
    assert_eq!(report.summary.verification_passes, 2);
    assert_eq!(report.summary.verification_failures, 1);
    assert_eq!(report.summary.attention_created, 1);
    assert_eq!(report.summary.attention_resolved, 1);

    let ids: Vec<&str> = report.tasks.iter().map(|t| t.task_id.as_str()).collect();
    assert_eq!(ids, ["plan", "impl"]);
    let plan = &report.tasks[0];
    assert_eq!(plan.attempts, 1);
    assert_eq!(plan.verification_passes, 1);
    assert_eq!(plan.duration_events(), Some(3));
    let implementation = &report.tasks[1];
    assert_eq!(implementation.attempts, 2);
    assert_eq!(implementation.verification_failures, 1);
    assert_eq!(implementation.attention_created, 1);
    assert_eq!(implementation.output_recorded_seq, Some(12));
    assert_eq!(implementation.duration_events(), Some(7));

    // Repeated queries over unchanged run data are identical.
    assert_eq!(store.trace_report("bench-plan-1").unwrap(), report);
}

#[test]
fn trace_report_derives_durations_from_recorded_timestamps() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("timing.sqlite");
    {
        let mut store = SqliteStore::open(&path).unwrap();
        append_plan_run(&mut store);
    }
    // Rewrite recorded timestamps deterministically: one step per sequence.
    {
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute("UPDATE events SET created_at = 1000000 + 10 * seq", [])
            .unwrap();
    }
    let store = SqliteStore::open(&path).unwrap();
    let report = store.trace_report("bench-plan-1").unwrap();
    assert_eq!(report.first_event_at, Some(1_000_010));
    assert_eq!(report.last_event_at, Some(1_000_200));
    assert_eq!(report.summary.elapsed_ms, Some(190_000));
    assert_eq!(report.tasks[0].first_ready_at, Some(1_000_040));
    assert_eq!(report.tasks[0].duration_ms(), Some(30_000));
    assert_eq!(report.tasks[1].duration_ms(), Some(70_000));
}

#[test]
fn progress_and_attention_timestamps_survive_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("progress.sqlite");
    {
        let mut store = SqliteStore::open(&path).unwrap();
        append_plan_run(&mut store);
    }
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute("UPDATE events SET created_at = 1000 + seq, created_at_ms = NULL", [])
        .unwrap();
    drop(connection);
    let store = SqliteStore::open(&path).unwrap();
    assert_eq!(
        store.last_progress_ms("bench-plan-1", "impl").unwrap(),
        Some(1014_000)
    );
    assert_eq!(
        store.last_progress_ms("bench-plan-1", "missing").unwrap(),
        None
    );
    assert_eq!(
        store
            .attention_opened_ms("bench-plan-1", "att-impl")
            .unwrap(),
        Some(1018_000)
    );
}

#[test]
fn progress_milliseconds_persist_and_determine_freshness() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("precise.sqlite");
    {
        let mut store = SqliteStore::open(&path).unwrap();
        append_plan_run(&mut store);
    }
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute("UPDATE events SET created_at = 1000, created_at_ms = NULL", []).unwrap();
    connection.execute(
        "UPDATE events SET created_at_ms = 1000750 WHERE seq = 14",
        [],
    ).unwrap();
    drop(connection);
    let store = SqliteStore::open(&path).unwrap();
    let progress = store.last_progress_ms("bench-plan-1", "impl").unwrap().unwrap();
    assert_eq!(progress, 1_000_750);
    assert_eq!(1_001_000_i64.saturating_sub(progress), 250);
}

#[test]
fn trace_queries_follow_input_order_and_missing_runs_error() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = SqliteStore::open(dir.path().join("multi.sqlite")).unwrap();
    append_plan_run(&mut store);
    append_failure_run(&mut store);

    let reports = store
        .trace_reports(&["bench-tdd-1", "bench-plan-1"])
        .unwrap();
    let ids: Vec<&str> = reports.iter().map(|r| r.run_id.as_str()).collect();
    assert_eq!(ids, ["bench-tdd-1", "bench-plan-1"]);
    let tdd = &reports[0];
    assert_eq!(tdd.summary.total_events, 11);
    assert_eq!(tdd.summary.tasks_created, 2);
    assert_eq!(tdd.summary.tasks_completed, 1);
    assert_eq!(tdd.summary.worker_starts, 2);
    assert_eq!(tdd.summary.worker_finishes, 1);
    assert_eq!(tdd.summary.worker_failures, 1);
    assert_eq!(tdd.summary.verification_passes, 1);
    assert_eq!(tdd.summary.verification_failures, 0);
    let ids: Vec<&str> = tdd.tasks.iter().map(|t| t.task_id.as_str()).collect();
    assert_eq!(ids, ["tests", "spec"]);
    assert_eq!(tdd.tasks[0].attempts, 1);
    assert_eq!(tdd.tasks[0].worker_failures, 1);
    assert_eq!(tdd.tasks[0].completed_seq, None);
    assert_eq!(tdd.tasks[0].duration_events(), None);
    assert_eq!(tdd.tasks[1].verification_passes, 1);
    assert_eq!(tdd.tasks[1].duration_events(), Some(3));

    let summaries = store
        .trace_summaries(&["bench-plan-1", "bench-tdd-1"])
        .unwrap();
    assert_eq!(summaries[0].0, "bench-plan-1");
    assert_eq!(summaries[0].1.tasks_created, 2);
    assert_eq!(summaries[1].0, "bench-tdd-1");
    assert_eq!(summaries[1].1.total_events, 11);

    assert!(matches!(
        store.trace_report("missing-run"),
        Err(StoreError::RunNotFound(ref id)) if id == "missing-run"
    ));
    assert!(store
        .trace_reports(&["bench-tdd-1", "missing-run"])
        .is_err());
}

#[test]
fn store_aggregation_matches_core_event_aggregation() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = SqliteStore::open(dir.path().join("drift.sqlite")).unwrap();
    append_plan_run(&mut store);
    append_failure_run(&mut store);

    for run_id in ["bench-plan-1", "bench-tdd-1"] {
        let RunTraceReport { summary, .. } = store.trace_report(run_id).unwrap();
        let mut expected = TraceSummary::from_events(&store.events(run_id).unwrap());
        expected.elapsed_ms = summary.elapsed_ms;
        assert_eq!(summary, expected, "SQL aggregation drifted for {run_id}");
    }
}

fn append_plan_run(store: &mut SqliteStore) {
    let run = "bench-plan-1";
    let events = vec![
        Event::new(run, EventKind::RunCreated),
        Event::new(run, EventKind::TaskCreated(task_with("plan", &[]))),
        Event::new(run, EventKind::TaskCreated(task_with("impl", &["plan"]))),
        Event::new(run, EventKind::TaskReady(TaskId::from("plan"))),
        started(run, "plan", "w-plan"),
        finished(run, "plan", "w-plan"),
        passed(run, "plan"),
        completed(run, "plan"),
        Event::new(run, EventKind::TaskReady(TaskId::from("impl"))),
        started(run, "impl", "w-impl-1"),
        finished(run, "impl", "w-impl-1"),
        Event::new(
            run,
            EventKind::TaskOutputRecorded {
                task_id: TaskId::from("impl"),
                summary: "spike notes".into(),
            },
        ),
        failed_verification(run, "impl", "tests failed"),
        started(run, "impl", "w-impl-2"),
        finished(run, "impl", "w-impl-2"),
        passed(run, "impl"),
        completed(run, "impl"),
        Event::new(
            run,
            EventKind::AttentionCreated(Attention::for_task(
                "att-impl",
                AttentionKind::Failure,
                "impl needs review",
                TaskId::from("impl"),
            )),
        ),
        Event::new(
            run,
            EventKind::AttentionResolved {
                attention_id: "att-impl".into(),
                resolution: AttentionResolution::Retry,
            },
        ),
        Event::new(run, EventKind::RunCompleted),
    ];
    record(store, &events);
}

fn append_failure_run(store: &mut SqliteStore) {
    let run = "bench-tdd-1";
    let events = vec![
        Event::new(run, EventKind::RunCreated),
        Event::new(run, EventKind::TaskCreated(task_with("tests", &[]))),
        Event::new(run, EventKind::TaskReady(TaskId::from("tests"))),
        started(run, "tests", "w-1"),
        Event::new(
            run,
            EventKind::WorkerFailed {
                task_id: TaskId::from("tests"),
                worker_id: "w-1".into(),
                reason: "crashed".into(),
            },
        ),
        Event::new(run, EventKind::TaskCreated(task_with("spec", &[]))),
        Event::new(run, EventKind::TaskReady(TaskId::from("spec"))),
        started(run, "spec", "w-2"),
        finished(run, "spec", "w-2"),
        passed(run, "spec"),
        completed(run, "spec"),
    ];
    record(store, &events);
}

/// Record events one at a time, mirroring how a run appends as it executes.
fn record(store: &mut SqliteStore, events: &[Event]) {
    for event in events {
        store.append(event).unwrap();
    }
}

fn task_with(id: &str, dependencies: &[&str]) -> Task {
    Task::builder(
        TaskId::from(id),
        format!("{id} work"),
        TaskKind::Implementation,
    )
    .ownership(WorkOwnership::new(std::iter::empty::<&str>(), ["src/**"]))
    .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
    .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
    .dependencies(dependencies.iter().map(|value| TaskId::from(*value)))
    .build()
    .unwrap()
}

fn started(run: &str, task: &str, worker: &str) -> Event {
    Event::new(
        run,
        EventKind::WorkerStarted {
            task_id: TaskId::from(task),
            worker_id: worker.into(),
        },
    )
}

fn finished(run: &str, task: &str, worker: &str) -> Event {
    Event::new(
        run,
        EventKind::WorkerFinished {
            task_id: TaskId::from(task),
            worker_id: worker.into(),
        },
    )
}

fn passed(run: &str, task: &str) -> Event {
    Event::new(
        run,
        EventKind::VerificationPassed {
            task_id: TaskId::from(task),
            evidence: VerificationEvidence::new([("tests", true)]),
        },
    )
}

fn failed_verification(run: &str, task: &str, reason: &str) -> Event {
    Event::new(
        run,
        EventKind::VerificationFailed {
            task_id: TaskId::from(task),
            reason: reason.into(),
        },
    )
}

fn completed(run: &str, task: &str) -> Event {
    Event::new(run, EventKind::TaskCompleted(TaskId::from(task)))
}
