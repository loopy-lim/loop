mod contract;
mod kind;
mod ownership;
mod state;
mod task;

pub use contract::{CompletionCheck, CompletionContract, VerificationEvidence};
pub use kind::TaskKind;
pub use ownership::WorkOwnership;
pub use state::TaskState;
pub use task::{Task, TaskBuildError, TaskBuilder, TaskId, TaskTransitionError};
