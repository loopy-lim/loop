use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::task::TaskId;

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Active,
    Attention,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Run {
    pub id: String,
    pub state: RunState,
    pub tasks: Vec<TaskId>,
}
