use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::attention::{Attention, AttentionResolution};
use crate::policy::{ArtifactKind, FailureClass};
use crate::task::{Task, TaskId, VerificationEvidence};

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub struct Artifact {
    pub id: String,
    pub kind: ArtifactKind,
    pub target: String,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
pub struct GoalCriterion {
    pub id: String,
    pub description: String,
    pub task_id: TaskId,
    pub check_ids: Vec<String>,
}

impl Artifact {
    pub fn new(id: impl Into<String>, kind: ArtifactKind, target: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            kind,
            target: target.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Event {
    pub run_id: String,
    pub kind: EventKind,
}

impl Event {
    pub fn new(run_id: impl Into<String>, kind: EventKind) -> Self {
        Self {
            run_id: run_id.into(),
            kind,
        }
    }
}

pub fn worker_recovery_attention(run_id: &str, task_id: &TaskId, worker_id: &str) -> Attention {
    Attention::for_task(
        format!("recovery-{run_id}-{worker_id}"),
        crate::attention::AttentionKind::Failure,
        format!(
            "Worker {worker_id} stopped outside cancellation; confirm it is stopped before retrying"
        ),
        task_id.clone(),
    )
}

pub fn verification_recovery_attention(run_id: &str, task_id: &TaskId) -> Attention {
    Attention::for_task(
        format!("recovery-{run_id}-{task_id}-verification"),
        crate::attention::AttentionKind::Failure,
        "Verification stopped outside cancellation; confirm it is stopped before retrying",
        task_id.clone(),
    )
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum EventKind {
    RunCreated,
    RunConfigured {
        intent: String,
        working_directory: String,
    },
    GoalCriteriaDeclared(Vec<GoalCriterion>),
    GuidanceAdded {
        task_id: Option<TaskId>,
        message: String,
    },
    GuidanceDelivered {
        task_id: TaskId,
        worker_id: String,
        through_sequence: i64,
    },
    TaskOutputRecorded {
        task_id: TaskId,
        summary: String,
    },
    CheckReceiptsRecorded {
        task_id: TaskId,
        checks: Vec<CheckReceipt>,
    },
    TaskActivityRecorded {
        task_id: TaskId,
        activity: String,
    },
    TaskCreated(Task),
    TaskReady(TaskId),
    WorkerStarted {
        task_id: TaskId,
        worker_id: String,
    },
    WorkerFinished {
        task_id: TaskId,
        worker_id: String,
    },
    WorkerFailed {
        task_id: TaskId,
        worker_id: String,
        reason: String,
    },
    VerificationPassed {
        task_id: TaskId,
        evidence: VerificationEvidence,
    },
    VerificationFailed {
        task_id: TaskId,
        reason: String,
    },
    VerificationClassifiedFailure {
        task_id: TaskId,
        failure_class: FailureClass,
        reason: String,
    },
    AttentionCreated(Attention),
    AttentionResolved {
        attention_id: String,
        resolution: AttentionResolution,
    },
    DecisionRecorded {
        decision_id: String,
        task_id: Option<TaskId>,
        value: String,
    },
    TaskCompleted(TaskId),
    RunCompleted,
    RunPauseRequested,
    RunPaused,
    RunCancellationRequested,
    VerificationStopped {
        task_id: TaskId,
    },
    TaskExecutionReconciled {
        task_id: TaskId,
    },
    WorkerStopped {
        task_id: TaskId,
        worker_id: String,
    },
    RunCancelled,
    RunResumed,
    ArtifactCreated(Artifact),
    ArtifactRemovalRequested {
        artifact_id: String,
        kind: ArtifactKind,
    },
    ArtifactRemoved {
        artifact_id: String,
        kind: ArtifactKind,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckReceipt {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub working_directory: String,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub duration_ms: u64,
    #[serde(default)]
    pub output_artifact: Option<String>,
    #[serde(default)]
    pub source: Option<SourceReceipt>,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReceipt {
    /// Digest of the declared read/write scope around the completion check batch.
    pub before_fingerprint: String,
    pub after_fingerprint: String,
    /// Repository paths observed to change while a worker ran. Shared-tree
    /// observations cannot establish which actor wrote them.
    pub observed_changed_paths: Vec<String>,
    pub observed_outside_write_scope: Vec<String>,
}

impl SourceReceipt {
    pub fn is_stable(&self) -> bool {
        !self.before_fingerprint.is_empty() && self.before_fingerprint == self.after_fingerprint
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Guidance {
    pub task_id: Option<TaskId>,
    pub message: String,
}
