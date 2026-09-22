use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::task::TaskId;

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Active,
    Pausing,
    Paused,
    Cancelling,
    Attention,
    Completed,
    Failed,
    Cancelled,
}

impl RunState {
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

impl std::fmt::Display for RunState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Active => write!(f, "active"),
            Self::Pausing => write!(f, "pausing"),
            Self::Paused => write!(f, "paused"),
            Self::Cancelling => write!(f, "cancelling"),
            Self::Attention => write!(f, "attention"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl std::str::FromStr for RunState {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(Self::Active),
            "pausing" => Ok(Self::Pausing),
            "paused" => Ok(Self::Paused),
            "cancelling" => Ok(Self::Cancelling),
            "attention" => Ok(Self::Attention),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(format!("unknown run state: {other}")),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Run {
    pub id: String,
    pub state: RunState,
    pub tasks: Vec<TaskId>,
}
