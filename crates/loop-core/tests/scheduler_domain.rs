use std::collections::BTreeSet;

use loop_core::attention::{Attention, AttentionKind, AttentionResolution, AttentionState};
use loop_core::graph::{GraphError, TaskGraph};
use loop_core::policy::{
    next_compute_class, select_candidate, CapabilityRequirements, ComputeCandidate,
    ComputeCapabilities, ComputeClass, Risk,
};
use loop_core::scheduler::{Capacity, Scheduler};
use loop_core::task::{
    CompletionCheck, CompletionContract, Task, TaskId, TaskKind, TaskState, VerificationEvidence,
    WorkOwnership,
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
        task("decision", TaskKind::Decision, &[], &[]),
        task("research", TaskKind::Research, &[], &[]),
    ])
    .unwrap();
    let claimed = Scheduler::new(Capacity::new(4, 1)).claim_runnable(&graph, &[]);
    assert_eq!(claimed, vec![TaskId::from("decision")]);
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
