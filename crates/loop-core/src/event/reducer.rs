use std::collections::{BTreeMap, VecDeque};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::attention::{Attention, AttentionState};
use crate::policy::{next_compute_class, ArtifactKind, FailureClass};
use crate::run::RunState;
use crate::task::{Task, TaskId, TaskState, TaskTransitionError};

use super::{
    verification_recovery_attention, worker_recovery_attention, CheckReceipt, Event, EventKind,
    Guidance,
};

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactState {
    Active,
    RemovalPending,
    Removed,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub struct ArtifactRecord {
    pub id: String,
    pub kind: ArtifactKind,
    pub target: String,
    pub state: ArtifactState,
}

impl ArtifactRecord {
    pub fn is_active(&self) -> bool {
        self.state == ArtifactState::Active
    }

    pub fn is_removal_pending(&self) -> bool {
        self.state == ArtifactState::RemovalPending
    }

    pub fn is_removed(&self) -> bool {
        self.state == ArtifactState::Removed
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct RunProjection {
    pub run_id: Option<String>,
    pub run_state: Option<RunState>,
    pub tasks: BTreeMap<TaskId, Task>,
    pub active_workers: BTreeMap<String, TaskId>,
    pub attention: BTreeMap<String, Attention>,
    pub failures: BTreeMap<TaskId, String>,
    pub artifacts: BTreeMap<String, ArtifactRecord>,
    pub intent: String,
    pub working_directory: String,
    pub guidance: Vec<Guidance>,
    pub outputs: BTreeMap<TaskId, String>,
    pub checks: BTreeMap<TaskId, Vec<CheckReceipt>>,
    pub activities: BTreeMap<TaskId, VecDeque<String>>,
}

/// Stored history cap for per-task worker activity. This is a deterministic
/// core policy (element cardinality only — no adapter, pane, or viewer
/// concepts); presentation budgets (how many lines a viewer shows) live
/// outside core.
pub const ACTIVITY_HISTORY_LIMIT: usize = 8;

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
            EventKind::RunConfigured {
                intent,
                working_directory,
            } => {
                self.require_controllable()?;
                if !self.working_directory.is_empty()
                    && self.working_directory != *working_directory
                {
                    return Err(ProjectionError::ContextMismatch);
                }
                self.intent = intent.clone();
                self.working_directory = working_directory.clone();
            }
            EventKind::GuidanceAdded { task_id, message } => {
                self.require_controllable()?;
                if let Some(id) = task_id {
                    self.task_mut(id)?;
                }
                self.guidance.push(Guidance {
                    task_id: task_id.clone(),
                    message: message.clone(),
                });
            }
            EventKind::TaskOutputRecorded { task_id, summary } => {
                self.task_mut(task_id)?;
                self.outputs.insert(task_id.clone(), summary.clone());
            }
            EventKind::CheckReceiptsRecorded { task_id, checks } => {
                self.task_mut(task_id)?;
                self.checks.insert(task_id.clone(), checks.clone());
            }
            EventKind::TaskActivityRecorded { task_id, activity } => {
                self.task_mut(task_id)?;
                let history = self.activities.entry(task_id.clone()).or_default();
                if history.len() >= ACTIVITY_HISTORY_LIMIT {
                    history.pop_front();
                }
                history.push_back(activity.clone());
            }
            EventKind::RunCreated => {
                if self.run_id.is_some() {
                    return Err(ProjectionError::RunAlreadyCreated);
                }
                self.run_id = Some(event.run_id.clone());
                self.run_state = Some(RunState::Active);
            }
            EventKind::TaskCreated(task) => {
                self.require_controllable()?;
                if !matches!(self.run_state, Some(RunState::Active | RunState::Paused | RunState::Attention)) {
                    return Err(ProjectionError::TaskInsertionState(self.run_state));
                }
                if self.tasks.insert(task.id.clone(), task.clone()).is_some() {
                    return Err(ProjectionError::TaskAlreadyCreated(task.id.clone()));
                }
            }
            EventKind::TaskReady(task_id) => {
                let task = self.task_mut(task_id)?;
                match task.state {
                    TaskState::Ready => {}
                    TaskState::Pending | TaskState::Attention | TaskState::Failed => {
                        task.transition(TaskState::Ready, None)?
                    }
                    TaskState::Blocked => {
                        return Err(ProjectionError::UnsafeReadyTransition(task_id.clone()));
                    }
                    TaskState::Running
                    | TaskState::Verifying
                    | TaskState::Cancelled
                    | TaskState::Done => {
                        return Err(ProjectionError::UnsafeReadyTransition(task_id.clone()));
                    }
                }
            }
            EventKind::WorkerStarted { task_id, worker_id } => {
                if self.run_state != Some(RunState::Active) || self.has_open_attention() {
                    return Err(ProjectionError::ActiveWorkers);
                }
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
                self.fail_run_when_all_tasks_are_terminal();
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
            EventKind::VerificationClassifiedFailure {
                task_id,
                failure_class,
                reason,
            } => {
                let terminalized = {
                    let task = self.task_mut(task_id)?;
                    if task.state != TaskState::Verifying {
                        return Err(ProjectionError::InvalidVerificationState(task_id.clone()));
                    }
                    task.attempt = task.attempt.saturating_add(1);
                    let deterministic = matches!(
                        failure_class,
                        FailureClass::Assertion | FailureClass::InvalidContract
                    );
                    if *failure_class == FailureClass::Interrupted {
                        task.transition(TaskState::Attention, None)?;
                        false
                    } else if deterministic || task.attempt >= task.max_attempts {
                        task.transition(TaskState::Failed, None)?;
                        true
                    } else {
                        if let Some(next) = next_compute_class(task.preferred_compute) {
                            task.preferred_compute = next.min(task.maximum_compute);
                        }
                        task.transition(TaskState::Ready, None)?;
                        false
                    }
                };
                self.failures.insert(task_id.clone(), reason.clone());
                if terminalized {
                    self.terminalize_dependents(task_id);
                    if self.tasks[task_id].kind.is_serial() {
                        self.run_state = Some(RunState::Failed);
                    } else {
                        self.fail_run_when_all_tasks_are_terminal();
                    }
                }
            }
            EventKind::AttentionCreated(attention) => {
                self.require_controllable()?;
                if !matches!(
                    self.run_state,
                    Some(RunState::Cancelling | RunState::Paused | RunState::Pausing)
                ) {
                    self.run_state = Some(RunState::Attention);
                }
                self.attention
                    .insert(attention.id.clone(), attention.clone());
            }
            EventKind::AttentionResolved {
                attention_id,
                resolution,
            } => {
                self.require_controllable()?;
                self.attention
                    .get_mut(attention_id)
                    .ok_or_else(|| ProjectionError::AttentionNotFound(attention_id.clone()))?
                    .resolve(resolution.clone())?;
                if !matches!(
                    self.run_state,
                    Some(RunState::Cancelling | RunState::Paused | RunState::Pausing)
                ) {
                    self.run_state = Some(if self.has_open_attention() {
                        RunState::Attention
                    } else {
                        RunState::Active
                    });
                }
            }
            EventKind::DecisionRecorded { .. } => {}
            EventKind::TaskCompleted(task_id) => {
                if self.task_mut(task_id)?.state != TaskState::Done {
                    return Err(ProjectionError::TaskNotVerified(task_id.clone()));
                }
            }
            EventKind::RunCompleted => {
                if self.run_state != Some(RunState::Active) || self.has_open_attention() {
                    return Err(ProjectionError::ActiveWorkers);
                }
                if self
                    .tasks
                    .values()
                    .any(|task| task.state != TaskState::Done)
                {
                    return Err(ProjectionError::IncompleteTasks);
                }
                self.run_state = Some(RunState::Completed);
            }
            EventKind::RunPauseRequested => {
                self.require_controllable()?;
                if self.run_state == Some(RunState::Cancelling) {
                    return Err(ProjectionError::ActiveWorkers);
                }
                self.run_state = Some(if self.has_in_flight_work() {
                    RunState::Pausing
                } else {
                    RunState::Paused
                });
            }
            EventKind::RunPaused => {
                if self.has_in_flight_work() {
                    return Err(ProjectionError::ActiveWorkers);
                }
                self.require_controllable()?;
                self.run_state = Some(RunState::Paused);
            }
            EventKind::RunCancellationRequested => {
                self.require_controllable()?;
                self.run_state = Some(RunState::Cancelling);
            }
            EventKind::TaskExecutionReconciled { task_id } => {
                self.require_controllable()?;
                let cancelling = self.run_state == Some(RunState::Cancelling);
                let task = self.task_mut(task_id)?;
                if !matches!(
                    task.state,
                    TaskState::Running
                        | TaskState::Verifying
                        | TaskState::Attention
                        | TaskState::Cancelled
                ) {
                    return Err(ProjectionError::InvalidVerificationState(task_id.clone()));
                }
                task.state = if cancelling {
                    TaskState::Cancelled
                } else {
                    TaskState::Ready
                };
                self.active_workers.retain(|_, id| id != task_id);
            }
            EventKind::VerificationStopped { task_id } => {
                let cancelling = self.run_state == Some(RunState::Cancelling);
                let task = self.task_mut(task_id)?;
                if task.state != TaskState::Verifying {
                    return Err(ProjectionError::InvalidVerificationState(task_id.clone()));
                }
                task.state = if cancelling {
                    TaskState::Cancelled
                } else {
                    TaskState::Attention
                };
                if !cancelling {
                    self.run_state = Some(RunState::Attention);
                    let attention = verification_recovery_attention(&event.run_id, task_id);
                    self.attention.insert(attention.id.clone(), attention);
                }
            }
            EventKind::WorkerStopped { task_id, worker_id } => {
                let cancelling = self.run_state == Some(RunState::Cancelling);
                if self.active_workers.remove(worker_id).as_ref() != Some(task_id) {
                    return Err(ProjectionError::WorkerMismatch(worker_id.clone()));
                }
                self.task_mut(task_id)?.state = if cancelling {
                    TaskState::Cancelled
                } else {
                    TaskState::Attention
                };
                if !cancelling {
                    self.run_state = Some(RunState::Attention);
                    let attention = worker_recovery_attention(&event.run_id, task_id, worker_id);
                    self.attention.insert(attention.id.clone(), attention);
                }
            }
            EventKind::RunCancelled => {
                if self.has_in_flight_work() {
                    return Err(ProjectionError::ActiveWorkers);
                }
                self.run_state = Some(RunState::Cancelled);
                for task in self.tasks.values_mut() {
                    if task.state != TaskState::Done {
                        task.state = TaskState::Cancelled;
                    }
                }
            }
            EventKind::RunResumed => {
                self.require_controllable()?;
                if self.run_state == Some(RunState::Cancelling) {
                    return Err(ProjectionError::ActiveWorkers);
                }
                self.run_state = Some(if self.has_open_attention() {
                    RunState::Attention
                } else if !self.tasks.is_empty()
                    && self.tasks.values().all(|t| t.state == TaskState::Done)
                {
                    RunState::Completed
                } else {
                    RunState::Active
                });
            }
            EventKind::ArtifactCreated(artifact) => {
                require_run(self)?;
                if self.artifacts.contains_key(&artifact.id) {
                    return Err(ProjectionError::ArtifactAlreadyCreated(artifact.id.clone()));
                }
                self.artifacts.insert(
                    artifact.id.clone(),
                    ArtifactRecord {
                        id: artifact.id.clone(),
                        kind: artifact.kind,
                        target: artifact.target.clone(),
                        state: ArtifactState::Active,
                    },
                );
            }
            EventKind::ArtifactRemovalRequested { artifact_id, .. } => {
                require_run(self)?;
                let artifact = self
                    .artifacts
                    .get_mut(artifact_id)
                    .ok_or_else(|| ProjectionError::ArtifactNotFound(artifact_id.clone()))?;
                artifact.state = ArtifactState::RemovalPending;
            }
            EventKind::ArtifactRemoved { artifact_id, .. } => {
                require_run(self)?;
                let artifact = self
                    .artifacts
                    .get_mut(artifact_id)
                    .ok_or_else(|| ProjectionError::ArtifactNotFound(artifact_id.clone()))?;
                artifact.state = ArtifactState::Removed;
            }
        }
        Ok(())
    }

    fn terminalize_dependents(&mut self, failed_task_id: &TaskId) {
        let mut terminalized = std::collections::BTreeSet::from([failed_task_id.clone()]);
        loop {
            let descendants: Vec<_> = self
                .tasks
                .values()
                .filter(|task| {
                    matches!(task.state, TaskState::Pending | TaskState::Ready)
                        && task
                            .dependencies
                            .iter()
                            .any(|dependency| terminalized.contains(dependency))
                })
                .map(|task| task.id.clone())
                .collect();
            if descendants.is_empty() {
                break;
            }
            for task_id in descendants {
                if let Some(task) = self.tasks.get_mut(&task_id) {
                    task.state = TaskState::Blocked;
                }
                terminalized.insert(task_id);
            }
        }
    }

    fn fail_run_when_all_tasks_are_terminal(&mut self) {
        if self.run_state != Some(RunState::Active) || self.tasks.is_empty() {
            return;
        }
        if self.tasks.values().all(|task| task.state.is_terminal())
            && self
                .tasks
                .values()
                .any(|task| matches!(task.state, TaskState::Failed | TaskState::Blocked))
        {
            self.run_state = Some(RunState::Failed);
        }
    }

    pub fn active_artifacts(&self) -> impl Iterator<Item = &ArtifactRecord> {
        self.artifacts.values().filter(|a| a.is_active())
    }

    pub fn has_in_flight_work(&self) -> bool {
        !self.active_workers.is_empty()
            || self.tasks.values().any(|t| t.state == TaskState::Verifying)
    }

    pub fn has_open_attention(&self) -> bool {
        self.attention
            .values()
            .any(|item| item.state == AttentionState::Open)
    }

    fn require_controllable(&self) -> Result<(), ProjectionError> {
        require_run(self)?;
        if self.run_state.is_some_and(RunState::is_terminal) {
            return Err(ProjectionError::TerminalRun);
        }
        Ok(())
    }

    pub fn is_artifact_removed(&self, id: &str) -> bool {
        self.artifacts.get(id).is_some_and(|a| a.is_removed())
    }

    pub fn drop_removed_artifacts(&mut self) {
        self.artifacts.retain(|_, a| !a.is_removed());
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
    #[error("tasks can only be added to active, paused, or attention runs; current state: {0:?}")]
    TaskInsertionState(Option<RunState>),
    #[error("run working directory cannot change after configuration")]
    ContextMismatch,
    #[error("terminal runs cannot be resumed or paused")]
    TerminalRun,
    #[error("active workers must be stopped or drained before confirming this operation")]
    ActiveWorkers,
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
    #[error("task requires lifecycle reconciliation before becoming ready: {0}")]
    UnsafeReadyTransition(TaskId),
    #[error("task has not passed its completion contract: {0}")]
    TaskNotVerified(TaskId),
    #[error("run still contains incomplete tasks")]
    IncompleteTasks,
    #[error("attention was not found: {0}")]
    AttentionNotFound(String),
    #[error("artifact has already been created: {0}")]
    ArtifactAlreadyCreated(String),
    #[error("artifact was not found: {0}")]
    ArtifactNotFound(String),
    #[error(transparent)]
    Transition(#[from] TaskTransitionError),
    #[error(transparent)]
    Attention(#[from] crate::attention::AttentionError),
}
