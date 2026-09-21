use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize,
)]
#[serde(rename_all = "snake_case")]
pub enum ComputeClass {
    Deterministic,
    TypedDecision,
    Tiny,
    Fast,
    Balanced,
    Strong,
    Frontier,
}

pub const fn next_compute_class(current: ComputeClass) -> Option<ComputeClass> {
    match current {
        ComputeClass::Deterministic => Some(ComputeClass::TypedDecision),
        ComputeClass::TypedDecision => Some(ComputeClass::Tiny),
        ComputeClass::Tiny => Some(ComputeClass::Fast),
        ComputeClass::Fast => Some(ComputeClass::Balanced),
        ComputeClass::Balanced => Some(ComputeClass::Strong),
        ComputeClass::Strong => Some(ComputeClass::Frontier),
        ComputeClass::Frontier => None,
    }
}
