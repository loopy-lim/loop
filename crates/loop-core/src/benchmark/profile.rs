use std::fmt;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Deterministic development-workflow profiles a benchmark scenario can run under.
///
/// A profile names a workflow shape only; mapping a profile onto concrete task
/// sequences stays in orchestrator fixtures so this crate never sees prompt text.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkflowProfile {
    /// Design or planning tasks before implementation tasks.
    PlanFirst,
    /// An exploratory spike before a cleanup or refactor task.
    SpikeFirst,
    /// Test-writing tasks before implementation tasks.
    TddFirst,
}

impl WorkflowProfile {
    pub const ALL: [WorkflowProfile; 3] = [
        WorkflowProfile::PlanFirst,
        WorkflowProfile::SpikeFirst,
        WorkflowProfile::TddFirst,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PlanFirst => "plan-first",
            Self::SpikeFirst => "spike-first",
            Self::TddFirst => "tdd-first",
        }
    }
}

impl fmt::Display for WorkflowProfile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for WorkflowProfile {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        WorkflowProfile::ALL
            .into_iter()
            .find(|profile| profile.as_str() == s)
            .ok_or_else(|| format!("unknown workflow profile: {s}"))
    }
}
