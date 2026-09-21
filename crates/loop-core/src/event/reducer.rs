use std::collections::BTreeMap;

use thiserror::Error;

use crate::attention::Attention;
use crate::policy::next_compute_class;
use crate::run::RunState;
use crate::task::{Task, TaskId, TaskState, TaskTransitionError};

use super::{Event, EventKind};

#[derive(Clone, Debug, Default)]
pub struct RunProjection {
    pub run_id: Option<String>,
    pub run_state: Option<RunState>,
    pub tasks: BTreeMap<TaskId, Task>,
    pub active_workers: BTreeMap<String, TaskId>,
    pub attention: BTreeMap<String, Attention>,
    pub failures: BTreeMap<TaskId, String>,
}

impl RunProjection {
    pub fn apply(&mut self, event: &Event) -> Result<(), ProjectionError> {
        if self
            .run_id
            .as_deref()
            .is_some_and(|run_id| run_id != event.run_id)
        {
            return Err(ProjectionError::RunMismatch);
        }
        match &event.kind {
            EventKind::RunCreated => {
                if self.run_id.is_some() {
                    return Err(ProjectionError::RunAlreadyCreated);
                }
                self.run_id = Some(event.run_id.clone());
                self.run_state = Some(RunState::Active);
            }
            EventKind::TaskCreated(task) => {
                require_run(self)?;
                if self.tasks.insert(task.id.clone(), task.clone()).is_some() {
                    return Err(ProjectionError::TaskAlreadyCreated(task.id.clone()));
                }
            }
            EventKind::TaskReady(task_id) => {
                self.task_mut(task_id)?.transition(TaskState::Ready, None)?;
            }
            EventKind::WorkerStarted { task_id, worker_id } => {
                self.task_mut(task_id)?
                    .transition(TaskState::Running, None)?;
                self.active_workers
                    .insert(worker_id.clone(), task_id.clone());
            }
            EventKind::WorkerFinished { task_id, worker_id } => {
                if self.active_workers.remove(worker_id).as_ref() != Some(task_id) {
                    return Err(ProjectionError::WorkerMismatch(worker_id.clone()));
                }
                self.task_mut(task_id)?
                    .transition(TaskState::Verifying, None)?;
            }
            EventKind::WorkerFailed {
                task_id,
                worker_id,
                reason,
            } => {
                if self.active_workers.remove(worker_id).as_ref() != Some(task_id) {
                    return Err(ProjectionError::WorkerMismatch(worker_id.clone()));
                }
                self.task_mut(task_id)?
                    .transition(TaskState::Failed, None)?;
                self.failures.insert(task_id.clone(), reason.clone());
            }
            EventKind::VerificationPassed { task_id, evidence } => {
                self.task_mut(task_id)?
                    .transition(TaskState::Done, Some(evidence))?;
            }
            EventKind::VerificationFailed { task_id, reason } => {
                let task = self.task_mut(task_id)?;
                if task.state != TaskState::Verifying {
                    return Err(ProjectionError::InvalidVerificationState(task_id.clone()));
                }
                task.attempt = task.attempt.saturating_add(1);
                if task.attempt >= task.max_attempts {
                    task.transition(TaskState::Attention, None)?;
                } else {
                    if let Some(next) = next_compute_class(task.preferred_compute) {
                        task.preferred_compute = next.min(task.maximum_compute);
                    }
                    task.transition(TaskState::Ready, None)?;
                }
                self.failures.insert(task_id.clone(), reason.clone());
            }
            EventKind::AttentionCreated(attention) => {
                self.run_state = Some(RunState::Attention);
                self.attention
                    .insert(attention.id.clone(), attention.clone());
            }
            EventKind::AttentionResolved {
                attention_id,
                resolution,
            } => {
                self.attention
                    .get_mut(attention_id)
                    .ok_or_else(|| ProjectionError::AttentionNotFound(attention_id.clone()))?
                    .resolve(resolution.clone())?;
                self.run_state = Some(RunState::Active);
            }
            EventKind::DecisionRecorded { .. } => {}
            EventKind::TaskCompleted(task_id) => {
                if self.task_mut(task_id)?.state != TaskState::Done {
                    return Err(ProjectionError::TaskNotVerified(task_id.clone()));
                }
            }
            EventKind::RunCompleted => {
                if self
                    .tasks
                    .values()
                    .any(|task| task.state != TaskState::Done)
                {
                    return Err(ProjectionError::IncompleteTasks);
                }
                self.run_state = Some(RunState::Completed);
            }
            EventKind::RunCancelled => {
                self.run_state = Some(RunState::Cancelled);
                self.active_workers.clear();
            }
            EventKind::RunResumed => {
                self.run_state = Some(RunState::Active);
            }
        }
        Ok(())
    }

    fn task_mut(&mut self, id: &TaskId) -> Result<&mut Task, ProjectionError> {
        self.tasks
            .get_mut(id)
            .ok_or_else(|| ProjectionError::TaskNotFound(id.clone()))
    }
}

fn require_run(projection: &RunProjection) -> Result<(), ProjectionError> {
    if projection.run_id.is_some() {
        Ok(())
    } else {
        Err(ProjectionError::RunNotCreated)
    }
}

#[derive(Debug, Error)]
pub enum ProjectionError {
    #[error("run has not been created")]
    RunNotCreated,
    #[error("run has already been created")]
    RunAlreadyCreated,
    #[error("event belongs to another run")]
    RunMismatch,
    #[error("task has already been created: {0}")]
    TaskAlreadyCreated(TaskId),
    #[error("task was not found: {0}")]
    TaskNotFound(TaskId),
    #[error("worker did not own the task: {0}")]
    WorkerMismatch(String),
    #[error("verification occurred outside the verifying state: {0}")]
    InvalidVerificationState(TaskId),
    #[error("task has not passed its completion contract: {0}")]
    TaskNotVerified(TaskId),
    #[error("run still contains incomplete tasks")]
    IncompleteTasks,
    #[error("attention was not found: {0}")]
    AttentionNotFound(String),
    #[error(transparent)]
    Transition(#[from] TaskTransitionError),
    #[error(transparent)]
    Attention(#[from] crate::attention::AttentionError),
}
