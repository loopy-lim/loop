#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::collections::BTreeSet;

use loop_core::attention::{Attention, AttentionKind, AttentionResolution, AttentionState};
use loop_core::graph::{GraphError, TaskGraph};
use loop_core::policy::{
    next_compute_class, select_candidate, CapabilityRequirements, ComputeCandidate,
    ComputeCapabilities, ComputeClass, Risk,
};
use loop_core::scheduler::{Capacity, ClaimSkip, ClaimSkipReason, Scheduler};
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskBuildError, TaskId, TaskKind, TaskState,
    VerificationEvidence, WorkOwnership,
};

fn task(id: &str, kind: TaskKind, dependencies: &[&str], writes: &[&str]) -> Task {
    Task::builder(TaskId::from(id), id, kind)
        .dependencies(dependencies.iter().copied().map(TaskId::from))
        .ownership(WorkOwnership::new(
            std::iter::empty::<&str>(),
            writes.iter().copied(),
        ))
        .compute(ComputeClass::Fast, ComputeClass::Tiny, ComputeClass::Strong)
        .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
        .build()
        .unwrap()
}

fn frontier_task(id: &str, writes: &[&str]) -> Task {
    Task::builder(TaskId::from(id), id, TaskKind::Implementation)
        .ownership(WorkOwnership::new(
            std::iter::empty::<&str>(),
            writes.iter().copied(),
        ))
        .compute(
            ComputeClass::Frontier,
            ComputeClass::Tiny,
            ComputeClass::Frontier,
        )
        .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
        .build()
        .unwrap()
}

#[test]
fn graph_rejects_missing_dependencies_and_cycles() {
    let missing = TaskGraph::new([task("a", TaskKind::Research, &["missing"], &[])]);
    assert!(matches!(missing, Err(GraphError::MissingDependency { .. })));

    let cycle = TaskGraph::new([
        task("a", TaskKind::Research, &["b"], &[]),
        task("b", TaskKind::Research, &["a"], &[]),
    ]);
    assert!(matches!(cycle, Err(GraphError::Cycle { .. })));
}

#[test]
fn scheduler_claims_only_ready_non_conflicting_tasks_within_capacity() {
    let mut graph = TaskGraph::new([
        task("research-a", TaskKind::Research, &[], &[]),
        task("research-b", TaskKind::Research, &[], &[]),
        task(
            "impl-a",
            TaskKind::Implementation,
            &["research-a"],
            &["crates/core/**"],
        ),
        task(
            "impl-b",
            TaskKind::Implementation,
            &["research-b"],
            &["packages/ui/**"],
        ),
        task(
            "impl-conflict",
            TaskKind::Implementation,
            &["research-b"],
            &["crates/core/src/**"],
        ),
    ])
    .unwrap();

    let first = Scheduler::new(Capacity::new(2, 1)).claim_runnable(&graph, &[]);
    assert_eq!(
        first,
        vec![TaskId::from("research-a"), TaskId::from("research-b")]
    );

    graph.task_mut(&TaskId::from("research-a")).unwrap().state = TaskState::Done;
    graph.task_mut(&TaskId::from("research-b")).unwrap().state = TaskState::Done;
    let second = Scheduler::new(Capacity::new(3, 1)).claim_runnable(&graph, &[]);
    assert_eq!(second, vec![TaskId::from("impl-a"), TaskId::from("impl-b")]);
}

#[test]
fn decision_and_integration_tasks_are_serialized() {
    let graph = TaskGraph::new([
        task("decision", TaskKind::Decision, &[], &["decisions/**"]),
        task("research", TaskKind::Research, &[], &[]),
    ])
    .unwrap();
    let claimed = Scheduler::new(Capacity::new(4, 1)).claim_runnable(&graph, &[]);
    assert_eq!(claimed, vec![TaskId::from("decision")]);
}

#[test]
fn non_conflicting_sibling_is_claimed_while_a_serial_task_runs() {
    let mut graph = TaskGraph::new([
        task("decision", TaskKind::Decision, &[], &["decisions/**"]),
        task(
            "impl-overlap",
            TaskKind::Implementation,
            &[],
            &["decisions/approval.md"],
        ),
        task("research", TaskKind::Research, &[], &[]),
    ])
    .unwrap();
    graph.task_mut(&TaskId::from("decision")).unwrap().state = TaskState::Running;

    let plan = Scheduler::new(Capacity::new(4, 1)).claim_plan(&graph, &[TaskId::from("decision")]);
    assert_eq!(plan.claimed, vec![TaskId::from("research")]);
    assert_eq!(
        plan.skipped,
        vec![ClaimSkip::new(
            TaskId::from("impl-overlap"),
            ClaimSkipReason::ScopeOverlap {
                with: TaskId::from("decision"),
            },
        )]
    );
    assert_eq!(plan.skipped[0].activity(), "scope-overlap-with decision");
}

#[test]
fn a_second_serial_task_waits_while_one_holds_the_world() {
    let mut graph = TaskGraph::new([
        task("decision-a", TaskKind::Decision, &[], &["decisions/a.md"]),
        task("decision-b", TaskKind::Decision, &[], &["decisions/b.md"]),
    ])
    .unwrap();
    graph.task_mut(&TaskId::from("decision-a")).unwrap().state = TaskState::Running;

    let plan =
        Scheduler::new(Capacity::new(4, 1)).claim_plan(&graph, &[TaskId::from("decision-a")]);
    assert!(plan.claimed.is_empty());
    assert_eq!(
        plan.skipped,
        vec![ClaimSkip::new(
            TaskId::from("decision-b"),
            ClaimSkipReason::SerialHeld,
        )]
    );
    assert_eq!(plan.skipped[0].activity(), "serial-held");
}

#[test]
fn empty_write_scope_is_not_a_universal_conflict() {
    let mut graph = TaskGraph::new([
        task("impl-b", TaskKind::Implementation, &[], &["b/**"]),
        task("research-a", TaskKind::Research, &[], &["a/**"]),
    ])
    .unwrap();
    // Runtime drift: a scope-requiring task whose write scope became empty
    // after submission. Submission-time validation rejects this at the
    // builder and graph gates; the scheduler must not additionally turn it
    // into a conflict with everything.
    graph
        .task_mut(&TaskId::from("impl-b"))
        .unwrap()
        .ownership
        .write_scope
        .clear();

    let plan = Scheduler::new(Capacity::new(4, 1)).claim_plan(&graph, &[]);
    assert_eq!(
        plan.claimed,
        vec![TaskId::from("impl-b"), TaskId::from("research-a")]
    );
}

#[test]
fn submission_rejects_scope_requiring_task_with_empty_write_scope() {
    let built = Task::builder(TaskId::from("impl"), "impl", TaskKind::Implementation)
        .ownership(WorkOwnership::new(
            std::iter::empty::<&str>(),
            std::iter::empty::<&str>(),
        ))
        .completion_contract(CompletionContract::new([CompletionCheck::new("tests")]))
        .build();
    assert!(matches!(built, Err(TaskBuildError::MissingWriteScope)));
}

#[test]
fn capacity_and_frontier_exhaustion_are_recorded_as_skip_reasons() {
    let mut graph = TaskGraph::new([
        task("fast-c", TaskKind::Research, &[], &["c/**"]),
        frontier_task("frontier-a", &["a/**"]),
        frontier_task("frontier-b", &["b/**"]),
        task("waiter-d", TaskKind::Research, &[], &["d/**"]),
    ])
    .unwrap();
    graph.task_mut(&TaskId::from("frontier-a")).unwrap().state = TaskState::Running;

    let plan =
        Scheduler::new(Capacity::new(3, 1)).claim_plan(&graph, &[TaskId::from("frontier-a")]);
    assert_eq!(
        plan.claimed,
        vec![TaskId::from("fast-c"), TaskId::from("waiter-d")]
    );
    assert_eq!(
        plan.skipped,
        vec![ClaimSkip::new(
            TaskId::from("frontier-b"),
            ClaimSkipReason::FrontierFull,
        )]
    );
    assert_eq!(plan.skipped[0].activity(), "frontier-full");
}

#[test]
fn worker_cap_exhaustion_is_recorded_per_task() {
    let mut graph = TaskGraph::new([
        task("running-a", TaskKind::Research, &[], &["a/**"]),
        task("waiter-b", TaskKind::Research, &[], &["b/**"]),
    ])
    .unwrap();
    graph.task_mut(&TaskId::from("running-a")).unwrap().state = TaskState::Running;

    let plan = Scheduler::new(Capacity::new(1, 1)).claim_plan(&graph, &[TaskId::from("running-a")]);
    assert!(plan.claimed.is_empty());
    assert_eq!(
        plan.skipped,
        vec![ClaimSkip::new(
            TaskId::from("waiter-b"),
            ClaimSkipReason::CapacityFull,
        )]
    );
    assert_eq!(plan.skipped[0].activity(), "capacity-full");
}

#[test]
fn done_requires_all_completion_contract_evidence() {
    let mut item = task("impl", TaskKind::Implementation, &[], &["src/**"]);
    item.transition(TaskState::Ready, None).unwrap();
    item.transition(TaskState::Running, None).unwrap();
    item.transition(TaskState::Verifying, None).unwrap();

    let missing = VerificationEvidence::new(std::iter::empty::<(&str, bool)>());
    assert!(item.transition(TaskState::Done, Some(&missing)).is_err());
    assert_eq!(item.state, TaskState::Verifying);

    let evidence = VerificationEvidence::new([("tests", true)]);
    item.transition(TaskState::Done, Some(&evidence)).unwrap();
    assert_eq!(item.state, TaskState::Done);
}

#[test]
fn candidate_selection_uses_the_lowest_sufficient_eligible_compute() {
    let candidates = vec![
        ComputeCandidate::new(
            "frontier",
            ComputeClass::Frontier,
            ComputeCapabilities::new(10, 10, 10, 10, 10),
            9,
            9,
        ),
        ComputeCandidate::new(
            "fast",
            ComputeClass::Fast,
            ComputeCapabilities::new(7, 6, 7, 0, 7),
            2,
            2,
        ),
        ComputeCandidate::new(
            "tiny",
            ComputeClass::Tiny,
            ComputeCapabilities::new(3, 3, 3, 0, 4),
            1,
            1,
        ),
    ];
    let requirements = CapabilityRequirements::new(6, 5, 6, 0, 6)
        .with_compute_range(ComputeClass::Tiny, ComputeClass::Strong)
        .with_risk(Risk::Medium);
    let selected = select_candidate(
        &candidates,
        &BTreeSet::from(["fast".to_string(), "tiny".to_string()]),
        &requirements,
    )
    .unwrap();
    assert_eq!(selected.id, "fast");
    assert_eq!(
        next_compute_class(ComputeClass::Fast),
        Some(ComputeClass::Balanced)
    );
    assert_eq!(next_compute_class(ComputeClass::Frontier), None);
}

#[test]
fn attention_lifecycle_is_explicit_and_idempotent() {
    let mut attention = Attention::new("attn-1", AttentionKind::Decision, "choose storage");
    assert_eq!(attention.state, AttentionState::Open);
    attention
        .resolve(AttentionResolution::Answer("sqlite".into()))
        .unwrap();
    assert_eq!(attention.state, AttentionState::Resolved);
    assert!(attention
        .resolve(AttentionResolution::Answer("memory".into()))
        .is_err());
}

#[test]
fn approval_attention_only_accepts_approval_outcomes() {
    let mut approval = Attention::new("approval", AttentionKind::Approval, "ship it");
    assert!(approval
        .resolve(AttentionResolution::Answer("yes".into()))
        .is_err());
    assert_eq!(approval.state, AttentionState::Open);
    approval.resolve(AttentionResolution::Approved).unwrap();
}

#[test]
fn readers_do_not_race_writers_and_root_scopes_overlap_everything() {
    let writer = task("a-writer", TaskKind::Implementation, &[], &["src/**"]);
    let mut reader = task("b-reader", TaskKind::Research, &[], &[]);
    reader.ownership = WorkOwnership::new(["src/a.rs"], std::iter::empty::<&str>());
    let graph = TaskGraph::new([writer, reader]).unwrap();
    assert_eq!(
        Scheduler::new(Capacity::new(2, 1)).claim_runnable(&graph, &[]),
        vec![TaskId::from("a-writer")]
    );
    let graph = TaskGraph::new([
        task("all", TaskKind::Implementation, &[], &["."]),
        task("other", TaskKind::Implementation, &[], &["docs/a.md"]),
    ])
    .unwrap();
    assert_eq!(
        Scheduler::new(Capacity::new(2, 1)).claim_runnable(&graph, &[]),
        vec![TaskId::from("all")]
    );
}

#[test]
fn glob_ownership_is_conservative_and_parent_traversal_is_rejected() {
    let graph = TaskGraph::new([
        task("a", TaskKind::Implementation, &[], &["src/*/shared.rs"]),
        task(
            "b",
            TaskKind::Implementation,
            &[],
            &["src/module/shared.rs"],
        ),
    ])
    .unwrap();
    assert_eq!(
        Scheduler::new(Capacity::new(2, 1)).claim_runnable(&graph, &[]),
        vec![TaskId::from("a")]
    );
    let ownership = WorkOwnership::new(["./"], ["../outside"]);
    assert_eq!(ownership.read_scope, vec!["."]);
    assert!(
        Task::builder(TaskId::from("unsafe"), "unsafe", TaskKind::Implementation)
            .ownership(ownership)
            .completion_contract(CompletionContract::new([CompletionCheck::new("check")]))
            .build()
            .is_err()
    );
}

#[test]
fn write_capable_tasks_require_an_explicit_write_scope() {
    let result = Task::builder(
        TaskId::from("unscoped"),
        "unscoped",
        TaskKind::Implementation,
    )
    .completion_contract(CompletionContract::new([CompletionCheck::new("check")]))
    .build();
    assert!(result.is_err());
}

#[test]
fn redispatch_of_a_ready_task_waits_for_its_corrective_prerequisite() {
    // The add_task failure directive leaves the failed task Ready with a
    // freshly created corrective prerequisite. Claimability stays a scheduler
    // verdict: the corrective is claimed first, and the failed task only
    // after the corrective is Done.
    let mut graph = TaskGraph::new([
        task("impl", TaskKind::Implementation, &["repair"], &["src/**"]),
        task("repair", TaskKind::Implementation, &[], &["src/**"]),
    ])
    .unwrap();
    graph.task_mut(&TaskId::from("impl")).unwrap().state = TaskState::Ready;

    let scheduler = Scheduler::new(Capacity::new(2, 2));
    let claimed = scheduler.claim_runnable(&graph, &[]);
    assert_eq!(claimed, vec![TaskId::from("repair")]);

    graph.task_mut(&TaskId::from("repair")).unwrap().state = TaskState::Done;
    let claimed = scheduler.claim_runnable(&graph, &[]);
    assert_eq!(claimed, vec![TaskId::from("impl")]);
}
