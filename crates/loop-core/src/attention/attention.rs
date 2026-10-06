use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::AttentionResolution;
use crate::task::TaskId;

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AttentionKind {
    Question,
    Decision,
    Approval,
    Conflict,
    Failure,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AttentionState {
    Open,
    Resolved,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Attention {
    pub id: String,
    pub kind: AttentionKind,
    pub summary: String,
    pub state: AttentionState,
    pub resolution: Option<AttentionResolution>,
    pub task_id: Option<TaskId>,
}

impl Attention {
    pub fn new(id: impl Into<String>, kind: AttentionKind, summary: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            kind,
            summary: summary.into(),
            state: AttentionState::Open,
            resolution: None,
            task_id: None,
        }
    }

    pub fn for_task(
        id: impl Into<String>,
        kind: AttentionKind,
        summary: impl Into<String>,
        task_id: TaskId,
    ) -> Self {
        Self {
            task_id: Some(task_id),
            ..Self::new(id, kind, summary)
        }
    }

    /// Accepts a resolution only when it belongs to this attention's kind.
    /// Failure attentions resolve exclusively through the directive
    /// vocabulary ([`AttentionResolution::Retry`], [`AttentionResolution::AddTask`],
    /// [`AttentionResolution::RelaxRouting`], [`AttentionResolution::Defer`],
    /// [`AttentionResolution::Cancel`]); free text and approval verdicts are
    /// rejected. The `add_task` and `relax_routing` directives additionally
    /// require a task-bound attention, and the corrective contract must be
    /// well formed.
    pub fn resolve(&mut self, resolution: AttentionResolution) -> Result<(), AttentionError> {
        if self.state == AttentionState::Resolved {
            return Err(AttentionError::AlreadyResolved);
        }
        let allowed = match (&self.kind, &resolution) {
            (_, AttentionResolution::Cancel) => true,
            (AttentionKind::Approval, AttentionResolution::Approved) => true,
            (AttentionKind::Approval, AttentionResolution::Rejected(_)) => true,
            (AttentionKind::Failure, AttentionResolution::Retry)
            | (AttentionKind::Failure, AttentionResolution::Defer)
            | (AttentionKind::Failure, AttentionResolution::RelaxRouting) => true,
            (AttentionKind::Failure, AttentionResolution::AddTask(corrective)) => {
                self.task_id.is_some() && corrective.is_well_formed()
            }
            (
                AttentionKind::Question | AttentionKind::Decision | AttentionKind::Conflict,
                AttentionResolution::Answer(_),
            ) => true,
            _ => false,
        };
        if !allowed {
            return Err(AttentionError::InvalidResolution);
        }
        self.state = AttentionState::Resolved;
        self.resolution = Some(resolution);
        Ok(())
    }
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum AttentionError {
    #[error("attention is already resolved")]
    AlreadyResolved,
    #[error("resolution is not valid for this attention kind")]
    InvalidResolution,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attention::CorrectiveTask;
    use crate::task::CompletionCheck;

    fn corrective() -> CorrectiveTask {
        CorrectiveTask::new(
            "repair-check",
            "Make the flaky check deterministic",
            ["src/checks/**"],
            ["the failing check passes on a clean checkout"],
            [CompletionCheck::command(
                "verify-repair",
                "cargo",
                ["test", "-p", "check"],
                None,
                120_000,
            )],
        )
    }

    fn resolution_error(
        kind: AttentionKind,
        task_id: Option<TaskId>,
        resolution: AttentionResolution,
    ) -> Option<AttentionError> {
        let mut attention = match task_id {
            Some(task_id) => Attention::for_task("a-1", kind, "summary", task_id),
            None => Attention::new("a-1", kind, "summary"),
        };
        attention.resolve(resolution).err()
    }

    #[test]
    fn failure_attention_accepts_only_the_directive_vocabulary() {
        let task_id = TaskId::from("impl");
        for resolution in [
            AttentionResolution::Retry,
            AttentionResolution::Defer,
            AttentionResolution::Cancel,
            AttentionResolution::AddTask(corrective()),
        ] {
            let mut attention = Attention::for_task(
                "a-1",
                AttentionKind::Failure,
                "worker failed",
                task_id.clone(),
            );
            attention
                .resolve(resolution.clone())
                .unwrap_or_else(|error| panic!("{resolution:?} must resolve a failure: {error}"));
            assert_eq!(attention.state, AttentionState::Resolved);
            assert_eq!(attention.resolution, Some(resolution));
        }
    }

    #[test]
    fn failure_attention_rejects_free_text_and_verdict_resolutions() {
        // Pinned contract: failure resolutions are directives, not prose or
        // approval verdicts. Free text must flow through question/decision
        // attentions instead.
        let task_id = TaskId::from("impl");
        for resolution in [
            AttentionResolution::Answer("please just rerun it".into()),
            AttentionResolution::Approved,
            AttentionResolution::Rejected("no".into()),
        ] {
            let error = resolution_error(
                AttentionKind::Failure,
                Some(task_id.clone()),
                resolution.clone(),
            )
            .unwrap_or_else(|| panic!("{resolution:?} must be rejected for a failure"));
            assert_eq!(error, AttentionError::InvalidResolution);
        }
    }

    #[test]
    fn failure_add_task_requires_a_task_bound_well_formed_corrective_contract() {
        let unbound = resolution_error(
            AttentionKind::Failure,
            None,
            AttentionResolution::AddTask(corrective()),
        );
        assert_eq!(unbound, Some(AttentionError::InvalidResolution));

        let blank_requirements = CorrectiveTask::new(
            "repair-check",
            "title",
            ["src/**"],
            ["  "],
            [CompletionCheck::new("verify-repair")],
        );
        let no_checks = CorrectiveTask::new("repair-check", "title", ["src/**"], ["fix"], []);
        let duplicate_check_ids = CorrectiveTask::new(
            "repair-check",
            "title",
            ["src/**"],
            ["fix"],
            [CompletionCheck::new("same"), CompletionCheck::new("same")],
        );
        for malformed in [blank_requirements, no_checks, duplicate_check_ids] {
            let error = resolution_error(
                AttentionKind::Failure,
                Some(TaskId::from("impl")),
                AttentionResolution::AddTask(malformed),
            );
            assert_eq!(error, Some(AttentionError::InvalidResolution));
        }
    }

    #[test]
    fn non_failure_attentions_reject_the_failure_directives() {
        let task_id = TaskId::from("impl");
        for kind in [
            AttentionKind::Approval,
            AttentionKind::Question,
            AttentionKind::Decision,
            AttentionKind::Conflict,
        ] {
            for resolution in [
                AttentionResolution::Retry,
                AttentionResolution::Defer,
                AttentionResolution::AddTask(corrective()),
            ] {
                let error = resolution_error(kind, Some(task_id.clone()), resolution.clone());
                assert_eq!(
                    error,
                    Some(AttentionError::InvalidResolution),
                    "{resolution:?} must not resolve a {kind:?} attention"
                );
            }
        }
    }

    #[test]
    fn cancel_resolves_any_kind_and_resolution_is_one_shot() {
        for kind in [
            AttentionKind::Approval,
            AttentionKind::Question,
            AttentionKind::Failure,
        ] {
            let mut attention = Attention::new("a-1", kind, "summary");
            attention.resolve(AttentionResolution::Cancel).unwrap();
            let error = attention.resolve(AttentionResolution::Retry).unwrap_err();
            assert_eq!(error, AttentionError::AlreadyResolved);
        }
    }
}
