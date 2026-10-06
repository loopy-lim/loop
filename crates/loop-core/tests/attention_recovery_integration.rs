#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Integration proof for the two attention-recovery chains, on the combined
//! result of the recovery-gap fix (core relaxation ladder + corrective-task
//! contract) and the answerable-question rendering contract:
//!
//! 1. a batch-candidate-absence failure resolved with the `relax_routing`
//!    mitigation records the graduated step as evidence and re-qualifies the
//!    blocked task for placement against the same candidate pool that just
//!    rejected it;
//! 2. a failure resolved with the `add_task` correctiveTask contract lands
//!    as a real corrective task that gates the failed task before its
//!    re-dispatch.
//!
//! These are the exact event sequences the bridge commits after parsing a
//! Lead resolution; replaying them through the core reducer proves the
//! bridge→core segment end to end.
use std::collections::BTreeSet;

use loop_core::attention::{Attention, AttentionKind, AttentionResolution, CorrectiveTask};
use loop_core::event::{Event, EventKind, RunProjection};
use loop_core::policy::{
    select_candidate, CapabilityRequirements, ComputeCandidate, ComputeCapabilities, ComputeClass,
    Risk, RoutingError, TaskRouting,
};
use loop_core::run::RunState;
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskId, TaskKind, WorkOwnership,
};

const BATCH_ABSENCE: &str = "no eligible compute candidate satisfies task constraints";

fn constrained_task() -> Task {
    Task::builder(TaskId::from("impl"), "Implement", TaskKind::Implementation)
        .ownership(WorkOwnership::new(std::iter::empty::<&str>(), ["src/**"]))
        .requirements(["requirement"])
        .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
        .routing(TaskRouting {
            risk: Risk::Low,
            required: ComputeCapabilities::new(0, 0, 1, 0, 0),
        })
        .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
        .build()
        .unwrap()
}

/// The batch: one machine, and it advertises no tools capability — the only
/// reason the task above cannot be placed.
fn batch() -> Vec<ComputeCandidate> {
    vec![ComputeCandidate::new(
        "node-1",
        ComputeClass::Fast,
        ComputeCapabilities::new(1, 1, 0, 1, 1),
        10,
        1,
    )]
}

fn requirements(routing: TaskRouting) -> CapabilityRequirements {
    let required = routing.required;
    CapabilityRequirements::new(
        required.coding,
        required.reasoning,
        required.tools,
        required.vision,
        required.long_context,
    )
    .with_compute_range(ComputeClass::Tiny, ComputeClass::Strong)
    .with_risk(routing.risk)
}

fn eligible(candidates: &[ComputeCandidate]) -> BTreeSet<String> {
    candidates.iter().map(|c| c.id.clone()).collect()
}

fn apply(projection: &mut RunProjection, events: &[Event]) {
    for event in events {
        projection
            .apply(event)
            .unwrap_or_else(|error| panic!("event must replay: {error}"));
    }
}

#[test]
fn the_relax_routing_mitigation_requalifies_a_batch_blocked_task_for_placement() {
    let candidates = batch();
    let mut projection = RunProjection::default();

    // The batch-absence dead end: the task is queued, but no candidate in
    // the batch satisfies its routing constraints, so a Failure attention is
    // raised and the task parks for a decision.
    apply(
        &mut projection,
        &[
            Event::new("run-1", EventKind::RunCreated),
            Event::new("run-1", EventKind::TaskCreated(constrained_task())),
            Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
            Event::new(
                "run-1",
                EventKind::AttentionCreated(Attention::for_task(
                    "failure-1",
                    AttentionKind::Failure,
                    BATCH_ABSENCE,
                    TaskId::from("impl"),
                )),
            ),
        ],
    );
    assert_eq!(
        select_candidate(
            &candidates,
            &eligible(&candidates),
            &requirements(projection.tasks[&TaskId::from("impl")].routing),
        ),
        Err(RoutingError::NoSufficientCandidate),
        "precondition: the recorded constraints must reject the whole batch"
    );

    // The mitigation choice: resolve with `relax_routing`, then commit the
    // one ladder step the core policy grants (exactly what the bridge does
    // after parsing the Lead's answer).
    let relaxation = projection.tasks[&TaskId::from("impl")]
        .routing
        .relax_step()
        .expect("a nonzero constraint must grant a step");
    assert_eq!(relaxation.describe(), "tools 1→0");
    apply(
        &mut projection,
        &[
            Event::new(
                "run-1",
                EventKind::AttentionResolved {
                    attention_id: "failure-1".into(),
                    resolution: AttentionResolution::RelaxRouting,
                },
            ),
            Event::new(
                "run-1",
                EventKind::TaskRoutingUpdated {
                    task_id: TaskId::from("impl"),
                    relaxation,
                    reason: "attention:failure-1 relax_routing".into(),
                },
            ),
            Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        ],
    );

    // The relaxation is durable evidence and the task is placed again —
    // against the same batch that just rejected it.
    let task = &projection.tasks[&TaskId::from("impl")];
    assert_eq!(task.routing.required.tools, 0);
    assert_eq!(task.routing.risk, Risk::Low);
    assert_eq!(task.state, loop_core::task::TaskState::Ready);
    assert_eq!(projection.run_state, Some(RunState::Active));
    assert_eq!(
        projection.attention["failure-1"].resolution,
        Some(AttentionResolution::RelaxRouting)
    );
    assert_eq!(
        select_candidate(
            &candidates,
            &eligible(&candidates),
            &requirements(task.routing),
        ),
        Ok(&candidates[0]),
        "the mitigation choice must end in a real placement"
    );
}

#[test]
fn the_add_task_corrective_contract_creates_the_repair_task_and_gates_the_failed_task() {
    // The correctiveTask contract exactly as the Lead tool embeds it in the
    // add_task token and the bridge deserializes into the core type.
    let corrective = CorrectiveTask::new(
        "repair-check",
        "Make the flaky check deterministic",
        ["src/checks/**"],
        ["the failing check passes on a clean checkout"],
        [CompletionCheck::command(
            "verify-repair",
            "cargo",
            ["test", "-p", "check"],
            None,
            120_000,
        )],
    );
    assert!(corrective.is_well_formed());

    let mut projection = RunProjection::default();
    apply(
        &mut projection,
        &[
            Event::new("run-1", EventKind::RunCreated),
            Event::new("run-1", EventKind::TaskCreated(constrained_task())),
            Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
            Event::new(
                "run-1",
                EventKind::AttentionCreated(Attention::for_task(
                    "failure-1",
                    AttentionKind::Failure,
                    BATCH_ABSENCE,
                    TaskId::from("impl"),
                )),
            ),
            Event::new(
                "run-1",
                EventKind::AttentionResolved {
                    attention_id: "failure-1".into(),
                    resolution: AttentionResolution::AddTask(corrective.clone()),
                },
            ),
        ],
    );

    // The bridge derives the corrective task from the contract (same
    // derivation as `corrective_task_spec`): an implementation task whose
    // scopes, requirements, and checks are exactly the recorded ones.
    let repair = Task::builder(
        corrective.id.clone(),
        corrective.title.clone(),
        TaskKind::Implementation,
    )
    .ownership(
        WorkOwnership::new(std::iter::empty::<String>(), corrective.write_scope.clone()),
    )
    .requirements(corrective.requirements.clone())
    .completion_contract(CompletionContract::new(
        corrective.completion_checks.iter().cloned(),
    ))
    .build()
    .expect("the corrective contract must build a valid task");
    apply(
        &mut projection,
        &[
            Event::new("run-1", EventKind::TaskCreated(repair)),
            Event::new(
                "run-1",
                EventKind::TaskDependencyAdded {
                    task_id: TaskId::from("impl"),
                    depends_on: TaskId::from("repair-check"),
                },
            ),
            Event::new("run-1", EventKind::TaskReady(TaskId::from("impl"))),
        ],
    );

    // The repair exists with the full contract, gates the failed task, and
    // the failed task is re-dispatched only behind it.
    let repair_task = &projection.tasks[&TaskId::from("repair-check")];
    assert_eq!(repair_task.title, "Make the flaky check deterministic");
    assert_eq!(
        repair_task.ownership.write_scope,
        vec!["src/checks/**".to_string()]
    );
    assert_eq!(
        repair_task.requirements,
        vec!["the failing check passes on a clean checkout".to_string()]
    );
    assert_eq!(
        repair_task
            .completion_contract
            .checks
            .iter()
            .map(|check| check.id.as_str())
            .collect::<Vec<_>>(),
        vec!["verify-repair"]
    );
    assert_eq!(repair_task.state, loop_core::task::TaskState::Pending);

    let failed = &projection.tasks[&TaskId::from("impl")];
    assert_eq!(failed.dependencies, vec![TaskId::from("repair-check")]);
    assert_eq!(failed.state, loop_core::task::TaskState::Ready);
    assert_eq!(projection.run_state, Some(RunState::Active));
    assert_eq!(
        projection.attention["failure-1"].resolution,
        Some(AttentionResolution::AddTask(corrective))
    );
}
