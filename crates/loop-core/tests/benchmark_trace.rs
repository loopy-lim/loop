use loop_core::benchmark::{compare_traces, TraceSummary};
use loop_core::event::{Event, EventKind};
use loop_core::task::TaskId;

fn worker_event(kind: fn(TaskId, String) -> EventKind, task: &str, worker: &str) -> Event {
    Event::new("run-1", kind(TaskId::from(task), worker.into()))
}

fn verification(kind: fn(TaskId, String) -> EventKind, task: &str, reason: &str) -> Event {
    Event::new("run-1", kind(TaskId::from(task), reason.into()))
}

#[test]
fn empty_event_slices_produce_an_empty_summary() {
    let summary = TraceSummary::from_events(&[]);
    assert_eq!(summary, TraceSummary::default());
    assert_eq!(summary.total_events, 0);
    assert_eq!(summary.elapsed_ms, None);
    assert_eq!(summary.score(), Default::default());
}

#[test]
fn a_clean_run_aggregates_without_retries_or_attention() {
    let task = TaskId::from("impl");
    let events = vec![
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(test_task())),
        Event::new("run-1", EventKind::TaskReady(task.clone())),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: task.clone(),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: task.clone(),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::VerificationPassed {
                task_id: task.clone(),
                evidence: loop_core::task::VerificationEvidence::new([("tests", true)]),
            },
        ),
        Event::new("run-1", EventKind::TaskCompleted(task.clone())),
        Event::new("run-1", EventKind::RunCompleted),
    ];
    let summary = TraceSummary::from_events(&events);
    assert_eq!(summary.total_events, 8);
    assert_eq!(summary.tasks_created, 1);
    assert_eq!(summary.tasks_completed, 1);
    assert_eq!(summary.worker_starts, 1);
    assert_eq!(summary.worker_finishes, 1);
    assert_eq!(summary.worker_failures, 0);
    assert_eq!(summary.verification_passes, 1);
    assert_eq!(summary.verification_failures, 0);
    assert_eq!(summary.attempts(), 1);
    assert_eq!(summary.retries(), 0);
    assert_eq!(summary.attention_created, 0);
    assert_eq!(summary.attention_resolved, 0);
}

#[test]
fn retried_verification_counts_failures_as_retries() {
    let task = TaskId::from("impl");
    let mut events = vec![Event::new("run-1", EventKind::TaskCreated(test_task()))];
    for worker in ["worker-1", "worker-2"] {
        events.push(worker_event(
            |task_id, worker_id| EventKind::WorkerStarted { task_id, worker_id },
            "impl",
            worker,
        ));
        events.push(worker_event(
            |task_id, worker_id| EventKind::WorkerFinished { task_id, worker_id },
            "impl",
            worker,
        ));
        events.push(verification(
            |task_id, reason| EventKind::VerificationFailed { task_id, reason },
            "impl",
            "tests failed",
        ));
    }
    events.push(worker_event(
        |task_id, worker_id| EventKind::WorkerStarted { task_id, worker_id },
        "impl",
        "worker-3",
    ));
    events.push(worker_event(
        |task_id, worker_id| EventKind::WorkerFinished { task_id, worker_id },
        "impl",
        "worker-3",
    ));
    events.push(Event::new(
        "run-1",
        EventKind::VerificationPassed {
            task_id: task.clone(),
            evidence: loop_core::task::VerificationEvidence::new([("tests", true)]),
        },
    ));
    let summary = TraceSummary::from_events(&events);
    assert_eq!(summary.worker_starts, 3);
    assert_eq!(summary.verification_failures, 2);
    assert_eq!(summary.verification_passes, 1);
    assert_eq!(summary.attempts(), 3);
    assert_eq!(summary.retries(), 2);
}

#[test]
fn worker_failures_and_attention_are_counted_separately() {
    let task = TaskId::from("impl");
    let attention = loop_core::attention::Attention::for_task(
        "attention-1",
        loop_core::attention::AttentionKind::Failure,
        "needs a human",
        task.clone(),
    );
    let events = vec![
        Event::new("run-1", EventKind::TaskCreated(test_task())),
        worker_event(
            |task_id, worker_id| EventKind::WorkerStarted { task_id, worker_id },
            "impl",
            "worker-1",
        ),
        worker_event(
            |task_id, worker_id| EventKind::WorkerFailed {
                task_id,
                worker_id,
                reason: "crashed".into(),
            },
            "impl",
            "worker-1",
        ),
        Event::new("run-1", EventKind::AttentionCreated(attention)),
        Event::new(
            "run-1",
            EventKind::AttentionResolved {
                attention_id: "attention-1".into(),
                resolution: loop_core::attention::AttentionResolution::Approved,
            },
        ),
    ];
    let summary = TraceSummary::from_events(&events);
    assert_eq!(summary.worker_failures, 1);
    assert_eq!(summary.attention_created, 1);
    assert_eq!(summary.attention_resolved, 1);
    let score = summary.score();
    assert_eq!(score.autonomy, 1000);
    assert_eq!(score.reliability, 0);
}

#[test]
fn scoring_rewards_completion_and_penalizes_retries_and_unresolved_attention() {
    let clean = TraceSummary {
        total_events: 8,
        tasks_created: 1,
        tasks_completed: 1,
        worker_starts: 1,
        worker_finishes: 1,
        verification_passes: 1,
        attention_created: 0,
        ..TraceSummary::default()
    };
    let clean_score = clean.score();
    assert_eq!(clean_score.reliability, 1000);
    assert_eq!(clean_score.autonomy, 1000);
    assert_eq!(clean_score.first_pass, 1000);
    assert_eq!(clean_score.total(), 3000);

    let mut retried = clean;
    retried.verification_failures = 3;
    let retried_score = retried.score();
    assert_eq!(retried_score.first_pass, 250);
    assert_eq!(retried_score.total(), 2250);

    let mut blocked = clean;
    blocked.attention_created = 2;
    blocked.attention_resolved = 1;
    assert_eq!(blocked.score().autonomy, 500);

    let mut nothing_created = clean;
    nothing_created.tasks_completed = 0;
    assert_eq!(nothing_created.score().reliability, 0);
}

#[test]
fn comparison_ranks_by_total_score_and_breaks_ties_by_label() {
    let strong = TraceSummary {
        total_events: 8,
        tasks_created: 2,
        tasks_completed: 2,
        worker_starts: 2,
        worker_finishes: 2,
        verification_passes: 2,
        attention_created: 0,
        ..TraceSummary::default()
    };
    let mut weak = strong;
    weak.tasks_completed = 1;
    weak.verification_failures = 1;
    let tie_a = TraceSummary {
        total_events: 4,
        tasks_created: 1,
        tasks_completed: 1,
        worker_starts: 1,
        worker_finishes: 1,
        verification_passes: 1,
        attention_created: 0,
        ..TraceSummary::default()
    };
    let tie_b = tie_a;

    let comparison = compare_traces([
        ("tdd-first", weak),
        ("plan-first", strong),
        ("spike-first", tie_a),
        ("plan-first-2", tie_b),
    ]);
    let labels: Vec<&str> = comparison
        .rankings
        .iter()
        .map(|ranking| ranking.label.as_str())
        .collect();
    assert_eq!(
        labels,
        vec!["plan-first", "plan-first-2", "spike-first", "tdd-first"]
    );
    let best = comparison.best().unwrap();
    assert_eq!(best.label, "plan-first");
    assert_eq!(best.score.total(), 3000);
}

#[test]
fn comparison_over_no_traces_has_no_best() {
    let comparison = compare_traces(std::iter::empty::<(&str, TraceSummary)>());
    assert!(comparison.rankings.is_empty());
    assert!(comparison.best().is_none());
}

fn test_task() -> loop_core::task::Task {
    use loop_core::policy::ComputeClass;
    use loop_core::task::{CompletionCheck, CompletionContract, Task, TaskKind, WorkOwnership};
    Task::builder(
        TaskId::from("impl"),
        "implementation",
        TaskKind::Implementation,
    )
    .ownership(WorkOwnership::new(std::iter::empty::<&str>(), ["src/**"]))
    .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
    .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
    .build()
    .unwrap()
}
