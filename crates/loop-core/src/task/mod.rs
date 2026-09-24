mod contract;
mod decomposition;
mod kind;
mod ownership;
mod state;
mod task;

pub use contract::{
    CompletionCheck, CompletionContract, CompletionCoverage, EvidenceLevel, VerificationEvidence,
};
pub use decomposition::{
    Assumption, DecompositionContract, DependencyConsumption, SemanticAccess,
    SemanticConflictResolution, SemanticTouchpoint,
};
pub use kind::TaskKind;
pub use ownership::WorkOwnership;
pub use state::TaskState;
pub use task::{Task, TaskBuildError, TaskBuilder, TaskId, TaskTransitionError};
