use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::AttentionResolution;
use crate::task::TaskId;

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AttentionKind {
    Question,
    Decision,
    Approval,
    Conflict,
    Failure,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AttentionState {
    Open,
    Resolved,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Attention {
    pub id: String,
    pub kind: AttentionKind,
    pub summary: String,
    pub state: AttentionState,
    pub resolution: Option<AttentionResolution>,
    pub task_id: Option<TaskId>,
}

impl Attention {
    pub fn new(id: impl Into<String>, kind: AttentionKind, summary: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            kind,
            summary: summary.into(),
            state: AttentionState::Open,
            resolution: None,
            task_id: None,
        }
    }

    pub fn for_task(
        id: impl Into<String>,
        kind: AttentionKind,
        summary: impl Into<String>,
        task_id: TaskId,
    ) -> Self {
        Self {
            task_id: Some(task_id),
            ..Self::new(id, kind, summary)
        }
    }

    pub fn resolve(&mut self, resolution: AttentionResolution) -> Result<(), AttentionError> {
        if self.state == AttentionState::Resolved {
            return Err(AttentionError::AlreadyResolved);
        }
        self.state = AttentionState::Resolved;
        self.resolution = Some(resolution);
        Ok(())
    }
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum AttentionError {
    #[error("attention is already resolved")]
    AlreadyResolved,
}
