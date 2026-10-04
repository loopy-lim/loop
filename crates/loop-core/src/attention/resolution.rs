use serde::{Deserialize, Serialize};

use crate::task::{CompletionCheck, TaskId};

/// The corrective-task contract carried by the `add_task` failure directive.
/// The payload is the durable decision record: it fixes what the repair is
/// (title, requirements) and how completion is judged (completion checks)
/// before any corrective work is dispatched. Write scope travels with the
/// payload so the derived task cannot grow an unbounded blast radius.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CorrectiveTask {
    pub id: TaskId,
    pub title: String,
    pub write_scope: Vec<String>,
    pub requirements: Vec<String>,
    pub completion_checks: Vec<CompletionCheck>,
}

impl CorrectiveTask {
    pub fn new(
        id: impl Into<TaskId>,
        title: impl Into<String>,
        write_scope: impl IntoIterator<Item = impl Into<String>>,
        requirements: impl IntoIterator<Item = impl Into<String>>,
        completion_checks: impl IntoIterator<Item = CompletionCheck>,
    ) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            write_scope: write_scope.into_iter().map(Into::into).collect(),
            requirements: requirements.into_iter().map(Into::into).collect(),
            completion_checks: completion_checks.into_iter().collect(),
        }
    }

    /// A corrective contract is well formed only when it names explicit
    /// requirements and at least one identifiable check. Anything weaker
    /// would re-create the failure the directive is meant to repair; the
    /// derived task build rejects the remaining shape violations (scopes,
    /// timeouts) at dispatch time.
    pub fn is_well_formed(&self) -> bool {
        !self.id.as_str().trim().is_empty()
            && !self.title.trim().is_empty()
            && !self.requirements.is_empty()
            && self.requirements.iter().all(|item| !item.trim().is_empty())
            && !self.completion_checks.is_empty()
            && {
                let mut ids = std::collections::BTreeSet::new();
                self.completion_checks
                    .iter()
                    .all(|check| !check.id.trim().is_empty() && ids.insert(check.id.as_str()))
            }
    }
}

/// The closed directive vocabulary a Failure-kind attention resolves into.
/// Each directive fixes one effect on the failed task's execution contract:
///
/// - [`FailureDirective::Retry`] re-dispatches the failed task (`TaskReady`).
/// - [`FailureDirective::AddTask`] records the corrective contract, inserts
///   the corrective task as a new prerequisite of the failed task, then
///   re-dispatches (`TaskCreated` + `TaskDependencyAdded` + `TaskReady`).
/// - [`FailureDirective::Defer`] parks the task in `Attention` without
///   re-dispatching; re-dispatch stays an explicit later decision.
/// - [`FailureDirective::Cancel`] cancels execution.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FailureDirective {
    Retry,
    AddTask(CorrectiveTask),
    Defer,
    Cancel,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AttentionResolution {
    Answer(String),
    Approved,
    Rejected(String),
    Retry,
    AddTask(CorrectiveTask),
    Defer,
    Cancel,
}

impl AttentionResolution {
    /// The directive this resolution carries, if it belongs to the failure
    /// directive vocabulary. Free text and approval verdicts are not
    /// directives — core rejects them as Failure resolutions.
    pub fn as_failure_directive(&self) -> Option<FailureDirective> {
        match self {
            Self::Retry => Some(FailureDirective::Retry),
            Self::AddTask(corrective) => Some(FailureDirective::AddTask(corrective.clone())),
            Self::Defer => Some(FailureDirective::Defer),
            Self::Cancel => Some(FailureDirective::Cancel),
            Self::Answer(_) | Self::Approved | Self::Rejected(_) => None,
        }
    }

    pub fn is_failure_directive(&self) -> bool {
        self.as_failure_directive().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_directive_vocabulary_maps_to_failure_directives() {
        let corrective = CorrectiveTask::new(
            "repair",
            "title",
            ["src/**"],
            ["requirement"],
            [CompletionCheck::new("verify")],
        );
        assert_eq!(
            AttentionResolution::Retry.as_failure_directive(),
            Some(FailureDirective::Retry)
        );
        assert_eq!(
            AttentionResolution::AddTask(corrective.clone()).as_failure_directive(),
            Some(FailureDirective::AddTask(corrective))
        );
        assert_eq!(
            AttentionResolution::Defer.as_failure_directive(),
            Some(FailureDirective::Defer)
        );
        assert_eq!(
            AttentionResolution::Cancel.as_failure_directive(),
            Some(FailureDirective::Cancel)
        );
        for non_directive in [
            AttentionResolution::Answer("free text".into()),
            AttentionResolution::Approved,
            AttentionResolution::Rejected("reason".into()),
        ] {
            assert_eq!(non_directive.as_failure_directive(), None);
        }
    }
}
