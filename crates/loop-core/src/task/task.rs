use std::fmt;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::policy::ComputeClass;

use super::{CompletionContract, TaskKind, TaskState, VerificationEvidence, WorkOwnership};

#[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct TaskId(String);

impl TaskId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<&str> for TaskId {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

impl From<String> for TaskId {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl fmt::Display for TaskId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Task {
    pub id: TaskId,
    pub title: String,
    pub kind: TaskKind,
    pub dependencies: Vec<TaskId>,
    pub ownership: WorkOwnership,
    pub requirements: Vec<String>,
    pub completion_contract: CompletionContract,
    pub preferred_compute: ComputeClass,
    pub minimum_compute: ComputeClass,
    pub maximum_compute: ComputeClass,
    pub attempt: u16,
    pub max_attempts: u16,
    pub state: TaskState,
}

impl Task {
    pub fn builder(id: TaskId, title: impl Into<String>, kind: TaskKind) -> TaskBuilder {
        TaskBuilder::new(id, title.into(), kind)
    }

    pub fn transition(
        &mut self,
        next: TaskState,
        evidence: Option<&VerificationEvidence>,
    ) -> Result<(), TaskTransitionError> {
        if next == TaskState::Done
            && (self.state != TaskState::Verifying
                || !evidence.is_some_and(|value| self.completion_contract.is_satisfied_by(value)))
        {
            return Err(TaskTransitionError::ContractNotSatisfied);
        }
        let allowed = matches!(
            (self.state, next),
            (TaskState::Pending, TaskState::Ready)
                | (TaskState::Pending, TaskState::Blocked)
                | (TaskState::Pending, TaskState::Cancelled)
                | (TaskState::Ready, TaskState::Running)
                | (TaskState::Ready, TaskState::Cancelled)
                | (TaskState::Running, TaskState::Verifying)
                | (TaskState::Running, TaskState::Attention)
                | (TaskState::Running, TaskState::Failed)
                | (TaskState::Running, TaskState::Cancelled)
                | (TaskState::Verifying, TaskState::Done)
                | (TaskState::Verifying, TaskState::Ready)
                | (TaskState::Verifying, TaskState::Attention)
                | (TaskState::Verifying, TaskState::Failed)
                | (TaskState::Attention, TaskState::Ready)
                | (TaskState::Attention, TaskState::Failed)
                | (TaskState::Attention, TaskState::Cancelled)
                | (TaskState::Blocked, TaskState::Ready)
                | (TaskState::Blocked, TaskState::Cancelled)
                | (TaskState::Failed, TaskState::Ready)
        );
        if !allowed {
            return Err(TaskTransitionError::Invalid {
                from: self.state,
                to: next,
            });
        }
        self.state = next;
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct TaskBuilder {
    task: Task,
}

impl TaskBuilder {
    fn new(id: TaskId, title: String, kind: TaskKind) -> Self {
        Self {
            task: Task {
                id,
                title,
                kind,
                dependencies: Vec::new(),
                ownership: WorkOwnership::default(),
                requirements: Vec::new(),
                completion_contract: CompletionContract::default(),
                preferred_compute: ComputeClass::Balanced,
                minimum_compute: ComputeClass::Tiny,
                maximum_compute: ComputeClass::Frontier,
                attempt: 0,
                max_attempts: 3,
                state: TaskState::Pending,
            },
        }
    }

    pub fn dependencies(mut self, values: impl IntoIterator<Item = TaskId>) -> Self {
        self.task.dependencies = values.into_iter().collect();
        self
    }

    pub fn ownership(mut self, ownership: WorkOwnership) -> Self {
        self.task.ownership = ownership;
        self
    }

    pub fn requirements(mut self, values: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.task.requirements = values.into_iter().map(Into::into).collect();
        self
    }

    pub fn completion_contract(mut self, contract: CompletionContract) -> Self {
        self.task.completion_contract = contract;
        self
    }

    pub fn compute(
        mut self,
        preferred: ComputeClass,
        minimum: ComputeClass,
        maximum: ComputeClass,
    ) -> Self {
        self.task.preferred_compute = preferred;
        self.task.minimum_compute = minimum;
        self.task.maximum_compute = maximum;
        self
    }

    pub fn max_attempts(mut self, value: u16) -> Self {
        self.task.max_attempts = value;
        self
    }

    pub fn build(mut self) -> Result<Task, TaskBuildError> {
        if self.task.id.as_str().trim().is_empty() || self.task.title.trim().is_empty() {
            return Err(TaskBuildError::EmptyIdentity);
        }
        if self.task.max_attempts == 0 {
            return Err(TaskBuildError::ZeroAttempts);
        }
        if self.task.kind.requires_explicit_write_scope()
            && self.task.ownership.write_scope.is_empty()
        {
            return Err(TaskBuildError::MissingWriteScope);
        }
        if self.task.completion_contract.checks.is_empty() {
            return Err(TaskBuildError::EmptyCompletionContract);
        }
        if self.task.minimum_compute > self.task.preferred_compute
            || self.task.preferred_compute > self.task.maximum_compute
        {
            return Err(TaskBuildError::InvalidComputeRange);
        }
        if self
            .task
            .ownership
            .read_scope
            .iter()
            .chain(&self.task.ownership.write_scope)
            .any(|scope| {
                scope.starts_with('/')
                    || scope.contains('\\')
                    || scope.contains(':')
                    || scope.split('/').any(|part| part == "..")
            })
        {
            return Err(TaskBuildError::InvalidScope);
        }
        let mut check_ids = std::collections::BTreeSet::new();
        if self.task.completion_contract.checks.iter().any(|check| {
            check.id.trim().is_empty()
                || check.command.trim().is_empty()
                || check.timeout_ms == 0
                || !check_ids.insert(&check.id)
        }) {
            return Err(TaskBuildError::InvalidCompletionCheck);
        }
        self.task.dependencies.sort();
        self.task.dependencies.dedup();
        Ok(self.task)
    }
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum TaskBuildError {
    #[error("completion checks need unique ids, commands and positive timeouts")]
    InvalidCompletionCheck,
    #[error("scopes must be project-relative and cannot contain parent traversal")]
    InvalidScope,
    #[error("this task kind requires an explicit write scope")]
    MissingWriteScope,
    #[error("task id and title are required")]
    EmptyIdentity,
    #[error("max_attempts must be greater than zero")]
    ZeroAttempts,
    #[error("completion contract must contain at least one check")]
    EmptyCompletionContract,
    #[error("compute range must contain the preferred class")]
    InvalidComputeRange,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum TaskTransitionError {
    #[error("completion contract is not satisfied")]
    ContractNotSatisfied,
    #[error("invalid task transition from {from:?} to {to:?}")]
    Invalid { from: TaskState, to: TaskState },
}
