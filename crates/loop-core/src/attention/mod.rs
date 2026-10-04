mod attention;
mod resolution;

pub use attention::{Attention, AttentionError, AttentionKind, AttentionState};
pub use resolution::{AttentionResolution, CorrectiveTask, FailureDirective};
