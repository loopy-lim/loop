use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AttentionResolution {
    Answer(String),
    Approved,
    Rejected(String),
    Retry,
    Cancel,
}
