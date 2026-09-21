mod event;
mod reducer;

pub use event::{Artifact, Event, EventKind};
pub use reducer::{ArtifactRecord, ArtifactState, ProjectionError, RunProjection};

