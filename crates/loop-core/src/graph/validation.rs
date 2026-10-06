use std::collections::{BTreeMap, BTreeSet};

use thiserror::Error;

use crate::task::{SemanticAccess, SemanticConflictResolution, SemanticTouchpoint, Task, TaskId};

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum GraphError {
    #[error("task id is duplicated")]
    DuplicateTask,
    #[error("task {task} depends on missing task {dependency}")]
    MissingDependency { task: TaskId, dependency: TaskId },
    #[error("task dependency cycle contains {task}")]
    Cycle { task: TaskId },
    #[error("task {task} is missing its decomposition contract")]
    MissingDecompositionContract { task: TaskId },
    #[error("task {task} has a weak decomposition contract: {reason}")]
    WeakContract { task: TaskId, reason: String },
    #[error(
        "task {task} does not map requirement {requirement} to artifact, semantics, and evidence"
    )]
    RequirementCoverageMissing { task: TaskId, requirement: String },
    #[error("task {task} has no consumption contract for dependency {dependency}")]
    DependencyConsumptionMissing { task: TaskId, dependency: TaskId },
    #[error("tasks {left} and {right} have an unresolved semantic conflict at {touchpoint}")]
    UnresolvedSemanticConflict {
        left: TaskId,
        right: TaskId,
        touchpoint: String,
    },
}

pub(super) fn validate(tasks: &BTreeMap<TaskId, Task>) -> Result<(), GraphError> {
    for task in tasks.values() {
        for dependency in &task.dependencies {
            if !tasks.contains_key(dependency) {
                return Err(GraphError::MissingDependency {
                    task: task.id.clone(),
                    dependency: dependency.clone(),
                });
            }
        }
    }
    let mut complete = BTreeSet::new();
    let mut visiting = BTreeSet::new();
    for id in tasks.keys() {
        visit(id, tasks, &mut visiting, &mut complete)?;
    }
    Ok(())
}

pub(super) fn validate_preflight(tasks: &BTreeMap<TaskId, Task>) -> Result<(), GraphError> {
    for task in tasks.values() {
        validate_task_contract(task)?;
    }
    let values: Vec<_> = tasks.values().collect();
    for (index, left) in values.iter().enumerate() {
        for right in values.iter().skip(index + 1) {
            validate_semantic_pair(left, right, tasks)?;
        }
    }
    Ok(())
}

fn validate_task_contract(task: &Task) -> Result<(), GraphError> {
    if task.kind.requires_explicit_write_scope() && task.ownership.write_scope.is_empty() {
        return Err(GraphError::WeakContract {
            task: task.id.clone(),
            reason: "required write scope is empty".into(),
        });
    }
    if task.requirements.is_empty() || task.requirements.iter().any(|item| item.trim().is_empty()) {
        return Err(GraphError::WeakContract {
            task: task.id.clone(),
            reason: "requirements must be explicit".into(),
        });
    }
    let contract = task.decomposition_contract.as_ref().ok_or_else(|| {
        GraphError::MissingDecompositionContract {
            task: task.id.clone(),
        }
    })?;
    if contract.defaults.is_empty()
        || contract.defaults.iter().any(|item| item.trim().is_empty())
        || contract.assumptions.is_empty()
        || contract.assumptions.iter().any(|item| !item.is_complete())
    {
        return Err(GraphError::WeakContract {
            task: task.id.clone(),
            reason: "defaults and complete assumptions are required".into(),
        });
    }
    if contract
        .semantic_touchpoints
        .iter()
        .any(|touchpoint| touchpoint.id.trim().is_empty())
    {
        return Err(GraphError::WeakContract {
            task: task.id.clone(),
            reason: "semantic touchpoint ids cannot be empty".into(),
        });
    }

    let consumed: BTreeSet<_> = contract
        .consumes
        .iter()
        .filter(|item| item.has_input())
        .map(|item| item.dependency.clone())
        .collect();
    for dependency in &task.dependencies {
        if !consumed.contains(dependency) {
            return Err(GraphError::DependencyConsumptionMissing {
                task: task.id.clone(),
                dependency: dependency.clone(),
            });
        }
    }
    if contract
        .consumes
        .iter()
        .any(|item| !task.dependencies.contains(&item.dependency) || !item.has_input())
    {
        return Err(GraphError::WeakContract {
            task: task.id.clone(),
            reason: "consumes must reference a direct dependency and a non-empty input".into(),
        });
    }

    let weak_commands = ["true", ":", "echo"];
    if task.completion_contract.checks.iter().any(|check| {
        weak_commands.contains(&check.command.trim().to_ascii_lowercase().as_str())
            || check.coverage.as_ref().is_some_and(|coverage| {
                coverage.requirements.is_empty()
                    || coverage.artifacts.is_empty()
                    || coverage.semantics.is_empty()
                    || coverage
                        .requirements
                        .iter()
                        .any(|item| item.trim().is_empty())
                    || coverage.artifacts.iter().any(|item| item.trim().is_empty())
                    || coverage.semantics.iter().any(|item| item.trim().is_empty())
            })
    }) {
        return Err(GraphError::WeakContract {
            task: task.id.clone(),
            reason: "completion checks need artifact, semantics, and evidence coverage".into(),
        });
    }
    for requirement in &task.requirements {
        let covered = task.completion_contract.checks.iter().any(|check| {
            check
                .coverage
                .as_ref()
                .is_some_and(|coverage| coverage.requirements.contains(requirement))
        });
        if !covered {
            return Err(GraphError::RequirementCoverageMissing {
                task: task.id.clone(),
                requirement: requirement.clone(),
            });
        }
    }
    if task.completion_contract.checks.iter().any(|check| {
        check.coverage.as_ref().is_some_and(|coverage| {
            coverage
                .requirements
                .iter()
                .any(|requirement| !task.requirements.contains(requirement))
        })
    }) {
        return Err(GraphError::WeakContract {
            task: task.id.clone(),
            reason: "completion coverage references an unknown requirement".into(),
        });
    }

    let mut failure_classes = BTreeSet::new();
    if contract.failure_policy.validate().is_err()
        || contract.failure_policy.retry_budgets.iter().any(|budget| {
            !failure_classes.insert(budget.failure_class)
                || budget.backoff.multiplier == 0
                || (budget.backoff.max_delay_ms > 0
                    && budget.backoff.initial_delay_ms > budget.backoff.max_delay_ms)
        })
    {
        return Err(GraphError::WeakContract {
            task: task.id.clone(),
            reason: "retry budgets must target only nondeterministic failure classes, be unique, and have bounded valid backoff".into(),
        });
    }
    Ok(())
}

fn validate_semantic_pair(
    left: &Task,
    right: &Task,
    tasks: &BTreeMap<TaskId, Task>,
) -> Result<(), GraphError> {
    // `validate_preflight` runs `validate_task_contract` for every task
    // before pair checks, so these contracts are already guaranteed to
    // exist; a miss is reported through the same error instead of an
    // invariant panic.
    let left_contract = left.decomposition_contract.as_ref().ok_or_else(|| {
        GraphError::MissingDecompositionContract {
            task: left.id.clone(),
        }
    })?;
    let right_contract = right.decomposition_contract.as_ref().ok_or_else(|| {
        GraphError::MissingDecompositionContract {
            task: right.id.clone(),
        }
    })?;
    let left_touchpoints = &left_contract.semantic_touchpoints;
    let right_touchpoints = &right_contract.semantic_touchpoints;
    for left_touchpoint in left_touchpoints {
        for right_touchpoint in right_touchpoints {
            if !semantic_touchpoints_conflict(left_touchpoint, right_touchpoint) {
                continue;
            }
            let requires_order = matches!(
                left_touchpoint.conflict_resolution,
                SemanticConflictResolution::DependencyOrder
            ) || matches!(
                right_touchpoint.conflict_resolution,
                SemanticConflictResolution::DependencyOrder
            );
            let unresolved = matches!(
                left_touchpoint.conflict_resolution,
                SemanticConflictResolution::Unresolved
            ) || matches!(
                right_touchpoint.conflict_resolution,
                SemanticConflictResolution::Unresolved
            ) || (requires_order
                && !depends_on(&left.id, &right.id, tasks)
                && !depends_on(&right.id, &left.id, tasks));
            if unresolved {
                return Err(GraphError::UnresolvedSemanticConflict {
                    left: left.id.clone(),
                    right: right.id.clone(),
                    touchpoint: left_touchpoint.id.clone(),
                });
            }
        }
    }
    Ok(())
}

fn semantic_touchpoints_conflict(left: &SemanticTouchpoint, right: &SemanticTouchpoint) -> bool {
    left.id == right.id
        && (left.access == SemanticAccess::Modify || right.access == SemanticAccess::Modify)
}

fn depends_on(task: &TaskId, dependency: &TaskId, tasks: &BTreeMap<TaskId, Task>) -> bool {
    tasks.get(task).is_some_and(|task| {
        task.dependencies
            .iter()
            .any(|candidate| candidate == dependency || depends_on(candidate, dependency, tasks))
    })
}

fn visit(
    id: &TaskId,
    tasks: &BTreeMap<TaskId, Task>,
    visiting: &mut BTreeSet<TaskId>,
    complete: &mut BTreeSet<TaskId>,
) -> Result<(), GraphError> {
    if complete.contains(id) {
        return Ok(());
    }
    if !visiting.insert(id.clone()) {
        return Err(GraphError::Cycle { task: id.clone() });
    }
    // `validate` confirmed every dependency exists before traversal runs, so
    // the lookup below cannot miss; a miss is treated defensively as having
    // no dependencies instead of panicking on the map index.
    let Some(task) = tasks.get(id) else {
        return Ok(());
    };
    for dependency in &task.dependencies {
        visit(dependency, tasks, visiting, complete)?;
    }
    visiting.remove(id);
    complete.insert(id.clone());
    Ok(())
}

#[cfg(test)]
mod preflight_tests {
    use super::*;
    use crate::policy::{FailurePolicy, OnExhaustion};
    use crate::task::{
        Assumption, CompletionCheck, CompletionContract, CompletionCoverage, DecompositionContract,
        DependencyConsumption, EvidenceLevel, SemanticAccess, SemanticConflictResolution,
        SemanticTouchpoint, TaskKind, WorkOwnership,
    };

    fn contract_task(
        id: &str,
        dependencies: &[&str],
        touchpoints: Vec<SemanticTouchpoint>,
    ) -> Task {
        let requirement = format!("{id}-requirement");
        Task::builder(TaskId::from(id), id, TaskKind::Implementation)
            .dependencies(dependencies.iter().copied().map(TaskId::from))
            .ownership(WorkOwnership::new(
                std::iter::empty::<&str>(),
                [format!("src/{id}.rs")],
            ))
            .requirements([requirement.clone()])
            .completion_contract(CompletionContract::new([CompletionCheck::new(format!(
                "{id}-check"
            ))
            .coverage(CompletionCoverage::new(
                [requirement],
                [format!("src/{id}.rs")],
                ["required behavior"],
                EvidenceLevel::Unit,
            ))]))
            .decomposition_contract(DecompositionContract::new(
                ["preserve current behavior"],
                [Assumption::new(
                    "unit tests are offline",
                    "repository test suite",
                    "record missing live evidence",
                    "before release",
                )],
                touchpoints,
                dependencies.iter().map(|dependency| {
                    DependencyConsumption::new(
                        TaskId::from(*dependency),
                        Vec::<String>::new(),
                        [format!("src/{dependency}.rs")],
                        [format!("{dependency}-check")],
                        Vec::<String>::new(),
                    )
                }),
                FailurePolicy::new([], OnExhaustion::FailTask),
            ))
            .build()
            .unwrap()
    }

    #[test]
    fn preflight_rejects_weak_contract_and_unmapped_requirements() {
        let weak = Task::builder(TaskId::from("weak"), "weak", TaskKind::Implementation)
            .ownership(WorkOwnership::new(
                std::iter::empty::<&str>(),
                ["src/weak.rs"],
            ))
            .requirements(["requirement"])
            .completion_contract(CompletionContract::new([CompletionCheck::new("check")]))
            .build()
            .unwrap();

        assert!(matches!(
            crate::graph::TaskGraph::preflight([weak]),
            Err(GraphError::MissingDecompositionContract { .. })
        ));

        let mut unmapped = contract_task("unmapped", &[], vec![]);
        unmapped.completion_contract.checks[0].coverage = None;
        assert!(matches!(
            crate::graph::TaskGraph::preflight([unmapped]),
            Err(GraphError::RequirementCoverageMissing { .. })
        ));
    }

    #[test]
    fn preflight_rejects_unresolved_semantic_conflicts() {
        let touchpoint = || {
            SemanticTouchpoint::new(
                "generated-protocol",
                SemanticAccess::Modify,
                SemanticConflictResolution::Unresolved,
            )
        };

        assert!(matches!(
            crate::graph::TaskGraph::preflight([
                contract_task("a", &[], vec![touchpoint()]),
                contract_task("b", &[], vec![touchpoint()]),
            ]),
            Err(GraphError::UnresolvedSemanticConflict { .. })
        ));
    }

    #[test]
    fn preflight_accepts_explicitly_serialized_semantic_conflicts() {
        let touchpoint = || {
            SemanticTouchpoint::new(
                "generated-protocol",
                SemanticAccess::Modify,
                SemanticConflictResolution::Serialize,
            )
        };

        crate::graph::TaskGraph::preflight([
            contract_task("a", &[], vec![touchpoint()]),
            contract_task("b", &[], vec![touchpoint()]),
        ])
        .unwrap();
    }

    #[test]
    fn preflight_rejects_retry_budget_on_deterministic_assertion_class() {
        let mut deterministic_retry = contract_task("retry", &[], vec![]);
        deterministic_retry
            .decomposition_contract
            .as_mut()
            .unwrap()
            .failure_policy = FailurePolicy::new(
            [crate::policy::RetryBudget::new(
                crate::policy::FailureClass::Assertion,
                crate::policy::RetryScope::Check,
                2,
                crate::policy::BackoffPolicy::fixed(50),
                OnExhaustion::FailTask,
            )],
            OnExhaustion::FailTask,
        );

        assert!(matches!(
            crate::graph::TaskGraph::preflight([deterministic_retry]),
            Err(GraphError::WeakContract { reason, .. })
                if reason.contains("nondeterministic")
        ));
    }
}
