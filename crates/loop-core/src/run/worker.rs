use serde::{Deserialize, Serialize};

use crate::task::TaskId;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerState {
    Starting,
    Running,
    Completed,
    Lost,
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Worker {
    pub id: String,
    pub task_id: TaskId,
    pub state: WorkerState,
}
