#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use loop_core::event::{Event, EventKind, ProjectionError, RunProjection};
use loop_core::graph::GraphError;
use loop_core::policy::ComputeClass;
use loop_core::run::RunState;
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskId, TaskKind, TaskState, VerificationEvidence,
    WorkOwnership,
};

fn implementation_task() -> Task {
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

#[test]
fn new_tasks_are_rejected_while_run_is_pausing_or_cancelling() {
    for state in [RunState::Pausing, RunState::Cancelling] {
        let mut projection = RunProjection::default();
        projection
            .apply(&Event::new("run-1", EventKind::RunCreated))
            .unwrap();
        projection.run_state = Some(state);
        let result = projection.apply(&Event::new(
            "run-1",
            EventKind::TaskCreated(implementation_task()),
        ));
        assert!(result.is_err(), "task inserted while {state}");
        assert!(projection.tasks.is_empty());
    }
    for state in [RunState::Active, RunState::Paused, RunState::Attention] {
        let mut projection = RunProjection::default();
        projection
            .apply(&Event::new("run-1", EventKind::RunCreated))
            .unwrap();
        projection.run_state = Some(state);
        projection
            .apply(&Event::new(
                "run-1",
                EventKind::TaskCreated(implementation_task()),
            ))
            .unwrap();
        assert_eq!(projection.tasks.len(), 1);
    }
}

#[test]
fn event_reducer_only_completes_a_task_after_verification_evidence() {
    let mut projection = RunProjection::default();
    let events = [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(implementation_task())),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::VerificationPassed {
                task_id: TaskId::from("impl"),
                evidence: VerificationEvidence::new([("tests", true)]),
            },
        ),
        Event::new("run-1", EventKind::RunCompleted),
    ];
    for event in &events {
        projection.apply(event).unwrap();
    }
    assert_eq!(projection.run_state, Some(RunState::Completed));
    assert_eq!(
        projection.tasks[&TaskId::from("impl")].state,
        TaskState::Done
    );
    assert!(projection.active_workers.is_empty());
}

#[test]
fn verification_failure_retries_at_the_next_compute_class() {
    let mut projection = RunProjection::default();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(implementation_task())),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::VerificationFailed {
                task_id: TaskId::from("impl"),
                reason: "tests failed".into(),
            },
        ),
    ] {
        projection.apply(&event).unwrap();
    }
    let task = &projection.tasks[&TaskId::from("impl")];
    assert_eq!(task.state, TaskState::Ready);
    assert_eq!(task.attempt, 1);
    assert_eq!(task.preferred_compute, ComputeClass::Balanced);
}

#[test]
fn exhausted_verification_moves_the_task_to_human_attention() {
    let mut task = implementation_task();
    task.max_attempts = 1;
    let mut projection = RunProjection::default();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(task)),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::VerificationFailed {
                task_id: TaskId::from("impl"),
                reason: "still failing".into(),
            },
        ),
    ] {
        projection.apply(&event).unwrap();
    }
    assert_eq!(
        projection.tasks[&TaskId::from("impl")].state,
        TaskState::Attention
    );
}

#[test]
fn interrupted_transport_failure_retries_within_the_attempt_ladder() {
    let mut projection = RunProjection::default();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(implementation_task())),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::VerificationClassifiedFailure {
                task_id: TaskId::from("impl"),
                failure_class: loop_core::policy::FailureClass::Interrupted,
                reason: "Error: Connection error.".into(),
            },
        ),
    ] {
        projection.apply(&event).unwrap();
    }
    // Below the retry limit a transport fault re-enters the dispatch lane:
    // the run stays dispatchable and no attention is raised.
    assert_eq!(projection.run_state, Some(RunState::Active));
    assert_eq!(
        projection.tasks[&TaskId::from("impl")].state,
        TaskState::Ready
    );
    assert_eq!(projection.tasks[&TaskId::from("impl")].attempt, 1);
    assert!(projection.attention.is_empty());
    assert!(!projection.has_open_attention());
}

#[test]
fn exhausted_ladder_parks_an_interrupted_transport_failure_in_attention() {
    let mut task = implementation_task();
    task.max_attempts = 1;
    let mut projection = RunProjection::default();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(task)),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::VerificationClassifiedFailure {
                task_id: TaskId::from("impl"),
                failure_class: loop_core::policy::FailureClass::Interrupted,
                reason: "Error: Connection error.".into(),
            },
        ),
    ] {
        projection.apply(&event).unwrap();
    }
    // With the ladder spent, the transport fault holds the task for a human
    // decision (the bridge then appends the failure AttentionCreated).
    assert_eq!(
        projection.tasks[&TaskId::from("impl")].state,
        TaskState::Attention
    );
    assert_eq!(projection.tasks[&TaskId::from("impl")].attempt, 1);
    assert!(projection.attention.is_empty());
}

#[test]
fn stopped_work_outside_cancellation_becomes_recovery_attention() {
    let mut projection = RunProjection::default();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(implementation_task())),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerStopped {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
    ] {
        projection.apply(&event).unwrap();
    }
    assert_eq!(projection.run_state, Some(RunState::Attention));
    assert_eq!(
        projection.tasks[&TaskId::from("impl")].state,
        TaskState::Attention
    );
    assert!(projection.has_open_attention());
}

#[test]
fn generic_ready_event_cannot_bypass_verification_reconciliation() {
    let mut projection = RunProjection::default();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(implementation_task())),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFinished {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
    ] {
        projection.apply(&event).unwrap();
    }
    assert!(projection
        .apply(&Event::new(
            "run-1",
            EventKind::TaskReady(TaskId::from("impl")),
        ))
        .is_err());
    assert_eq!(
        projection.tasks[&TaskId::from("impl")].state,
        TaskState::Verifying
    );
}

fn corrective_task() -> Task {
    Task::builder(
        TaskId::from("repair"),
        "corrective repair",
        TaskKind::Implementation,
    )
    .ownership(WorkOwnership::new(std::iter::empty::<&str>(), ["src/**"]))
    .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
    .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
    .build()
    .unwrap()
}

fn failed_task_projection() -> RunProjection {
    let mut projection = RunProjection::default();
    for event in [
        Event::new("run-1", EventKind::RunCreated),
        Event::new("run-1", EventKind::TaskCreated(implementation_task())),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ),
        Event::new(
            "run-1",
            EventKind::WorkerFailed {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
                reason: "exhausted".into(),
            },
        ),
    ] {
        projection.apply(&event).unwrap();
    }
    projection
}

#[test]
fn add_task_directive_wiring_creates_a_corrective_prerequisite_then_redispatches() {
    let mut projection = failed_task_projection();
    assert_eq!(
        projection.tasks[&TaskId::from("impl")].state,
        TaskState::Failed
    );
    // The bridge's add_task directive emits exactly this sequence: the
    // corrective contract lands as a new task, becomes a prerequisite of the
    // failed task, then the failed task re-enters dispatch.
    for event in [
        Event::new("run-1", EventKind::TaskCreated(corrective_task())),
        Event::new(
            "run-1",
            EventKind::TaskDependencyAdded {
                task_id: TaskId::from("impl"),
                depends_on: TaskId::from("repair"),
            },
        ),
        Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
    ] {
        projection.apply(&event).unwrap();
    }
    assert_eq!(
        projection.tasks[&TaskId::from("impl")].dependencies,
        vec![TaskId::from("repair")]
    );
    assert_eq!(
        projection.tasks[&TaskId::from("impl")].state,
        TaskState::Ready
    );
    assert_eq!(
        projection.tasks[&TaskId::from("repair")].state,
        TaskState::Pending
    );
}

#[test]
fn add_task_directive_wiring_rejects_missing_duplicate_and_cyclic_dependencies() {
    // Missing corrective: the dependency must exist.
    let mut projection = failed_task_projection();
    let missing = projection.apply(&Event::new(
        "run-1",
        EventKind::TaskDependencyAdded {
            task_id: TaskId::from("impl"),
            depends_on: TaskId::from("repair"),
        },
    ));
    assert!(
        matches!(missing, Err(ProjectionError::TaskNotFound(id)) if id == TaskId::from("repair"))
    );

    // Duplicate wiring: the dependency is already present.
    let mut projection = failed_task_projection();
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::TaskCreated(corrective_task()),
        ))
        .unwrap();
    let added = Event::new(
        "run-1",
        EventKind::TaskDependencyAdded {
            task_id: TaskId::from("impl"),
            depends_on: TaskId::from("repair"),
        },
    );
    projection.apply(&added).unwrap();
    assert!(matches!(
        projection.apply(&added),
        Err(ProjectionError::DependencyAlreadyPresent { .. })
    ));

    // Cycle: the corrective task must not depend on its own dependent.
    let mut projection = failed_task_projection();
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::TaskCreated(corrective_task()),
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::TaskDependencyAdded {
                task_id: TaskId::from("impl"),
                depends_on: TaskId::from("repair"),
            },
        ))
        .unwrap();
    assert!(matches!(
        projection.apply(&Event::new(
            "run-1",
            EventKind::TaskDependencyAdded {
                task_id: TaskId::from("repair"),
                depends_on: TaskId::from("impl"),
            },
        )),
        Err(ProjectionError::Graph(GraphError::Cycle { .. }))
    ));
}

#[test]
fn add_task_directive_wiring_is_rejected_for_dispatched_or_terminal_work() {
    for (task_state, prepare) in [
        (
            TaskState::Running,
            vec![
                Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
                Event::new(
                    "run-1",
                    EventKind::WorkerStarted {
                        task_id: TaskId::from("impl"),
                        worker_id: "worker-1".into(),
                    },
                ),
            ],
        ),
        (
            TaskState::Done,
            vec![
                Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
                Event::new(
                    "run-1",
                    EventKind::WorkerStarted {
                        task_id: TaskId::from("impl"),
                        worker_id: "worker-1".into(),
                    },
                ),
                Event::new(
                    "run-1",
                    EventKind::WorkerFinished {
                        task_id: TaskId::from("impl"),
                        worker_id: "worker-1".into(),
                    },
                ),
                Event::new(
                    "run-1",
                    EventKind::VerificationPassed {
                        task_id: TaskId::from("impl"),
                        evidence: VerificationEvidence::new([("tests", true)]),
                    },
                ),
            ],
        ),
    ] {
        let mut projection = RunProjection::default();
        projection
            .apply(&Event::new("run-1", EventKind::RunCreated))
            .unwrap();
        projection
            .apply(&Event::new(
                "run-1",
                EventKind::TaskCreated(implementation_task()),
            ))
            .unwrap();
        projection
            .apply(&Event::new(
                "run-1",
                EventKind::TaskCreated(corrective_task()),
            ))
            .unwrap();
        for event in prepare {
            projection.apply(&event).unwrap();
        }
        assert_eq!(projection.tasks[&TaskId::from("impl")].state, task_state);
        let wired = projection.apply(&Event::new(
            "run-1",
            EventKind::TaskDependencyAdded {
                task_id: TaskId::from("impl"),
                depends_on: TaskId::from("repair"),
            },
        ));
        assert!(
            matches!(wired, Err(ProjectionError::DependencyAddState(_))),
            "{task_state:?} work must not accept new prerequisites"
        );
    }
}

fn routed_task() -> Task {
    Task::builder(
        TaskId::from("impl"),
        "implementation",
        TaskKind::Implementation,
    )
    .ownership(WorkOwnership::new(std::iter::empty::<&str>(), ["src/**"]))
    .routing(loop_core::policy::TaskRouting {
        risk: loop_core::policy::Risk::High,
        required: loop_core::policy::ComputeCapabilities::new(0, 2, 1, 0, 0),
    })
    .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
    .build()
    .unwrap()
}

/// The batch-candidate-absence recovery: a `relax_routing` resolution lands
/// as a TaskRoutingUpdated event, and replaying the event lowers exactly the
/// recorded constraint (durable evidence in the log, deterministic replay).
#[test]
fn routing_update_applies_only_the_recorded_downgrade_to_parked_work() {
    use loop_core::policy::{CapabilityKind, RoutingRelaxation};
    let mut projection = RunProjection::default();
    projection
        .apply(&Event::new("run-1", EventKind::RunCreated))
        .unwrap();
    projection
        .apply(&Event::new("run-1", EventKind::TaskCreated(routed_task())))
        .unwrap();
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::TaskReady(TaskId::from("impl")),
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::AttentionCreated(loop_core::attention::Attention::for_task(
                "provider-run-1-impl-0",
                loop_core::attention::AttentionKind::Failure,
                "no eligible compute candidate satisfies task constraints",
                TaskId::from("impl"),
            )),
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::TaskRoutingUpdated {
                task_id: TaskId::from("impl"),
                relaxation: RoutingRelaxation::Capability {
                    capability: CapabilityKind::Tools,
                    from: 1,
                    to: 0,
                },
                reason: "attention:provider-run-1-impl-0 relax_routing".into(),
            },
        ))
        .unwrap();
    let routing = &projection.tasks[&TaskId::from("impl")].routing;
    assert_eq!(routing.required.tools, 0);
    assert_eq!(routing.required.reasoning, 2, "one step only");
    assert_eq!(routing.risk, loop_core::policy::Risk::High);
}

#[test]
fn routing_update_is_rejected_for_running_work_and_forged_upgrades() {
    use loop_core::policy::{CapabilityKind, RoutingRelaxation};
    let mut projection = RunProjection::default();
    projection
        .apply(&Event::new("run-1", EventKind::RunCreated))
        .unwrap();
    projection
        .apply(&Event::new("run-1", EventKind::TaskCreated(routed_task())))
        .unwrap();
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::TaskReady(TaskId::from("impl")),
        ))
        .unwrap();
    projection
        .apply(&Event::new(
            "run-1",
            EventKind::WorkerStarted {
                task_id: TaskId::from("impl"),
                worker_id: "worker-1".into(),
            },
        ))
        .unwrap();
    let running = projection.apply(&Event::new(
        "run-1",
        EventKind::TaskRoutingUpdated {
            task_id: TaskId::from("impl"),
            relaxation: RoutingRelaxation::Capability {
                capability: CapabilityKind::Tools,
                from: 1,
                to: 0,
            },
            reason: "mid-execution".into(),
        },
    ));
    assert!(matches!(
        running,
        Err(ProjectionError::RoutingUpdateState(_))
    ));

    projection.run_state = Some(RunState::Attention);
    projection
        .tasks
        .get_mut(&TaskId::from("impl"))
        .unwrap()
        .state = TaskState::Attention;
    let forged = projection.apply(&Event::new(
        "run-1",
        EventKind::TaskRoutingUpdated {
            task_id: TaskId::from("impl"),
            relaxation: RoutingRelaxation::Capability {
                capability: CapabilityKind::Reasoning,
                from: 2,
                to: 3,
            },
            reason: "forged upgrade".into(),
        },
    ));
    assert!(matches!(
        forged,
        Err(ProjectionError::Routing(
            loop_core::policy::RoutingError::RelaxationNotDowngrade
        ))
    ));
}
