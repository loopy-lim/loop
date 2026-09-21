use serde::{Deserialize, Serialize};

use crate::attention::{Attention, AttentionResolution};
use crate::task::{Task, TaskId, VerificationEvidence};

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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum EventKind {
    RunCreated,
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
    RunCancelled,
    RunResumed,
}
