use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::task::TaskKind;

/// Terminal state assigned to descendants that require a failed task.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DependencyTerminalization {
    #[default]
    BlockTerminal,
    Cancel,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IndependentBranchAction {
    #[default]
    Continue,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunFailureAction {
    #[default]
    Continue,
    Fail,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalizationOutcome {
    pub dependents: DependencyTerminalization,
    pub independent_branches: IndependentBranchAction,
    pub run: RunFailureAction,
}

/// Failure propagation rules owned by core rather than an executor adapter.
#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalizationPolicy {
    pub dependents: DependencyTerminalization,
    pub independent_branches: IndependentBranchAction,
    pub fail_run_for_serial_task: bool,
}

impl Default for TerminalizationPolicy {
    fn default() -> Self {
        Self {
            dependents: DependencyTerminalization::BlockTerminal,
            independent_branches: IndependentBranchAction::Continue,
            fail_run_for_serial_task: true,
        }
    }
}

impl TerminalizationPolicy {
    pub const fn outcome(self, failed_task_kind: TaskKind) -> TerminalizationOutcome {
        TerminalizationOutcome {
            dependents: self.dependents,
            independent_branches: self.independent_branches,
            run: if self.fail_run_for_serial_task && failed_task_kind.is_serial() {
                RunFailureAction::Fail
            } else {
                RunFailureAction::Continue
            },
        }
    }
}
