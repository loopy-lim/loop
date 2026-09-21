use thiserror::Error;

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum CoreError {
    #[error("invalid graph: {0}")]
    InvalidGraph(String),
    #[error("invalid task state: {0}")]
    InvalidState(String),
    #[error("completion contract failed: {0}")]
    CompletionContract(String),
    #[error("capacity exhausted")]
    CapacityExhausted,
    #[error("human attention is required: {0}")]
    AttentionRequired(String),
}
