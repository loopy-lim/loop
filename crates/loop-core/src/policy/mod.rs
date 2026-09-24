mod cleanup;
mod compute_class;
mod failure;
mod routing;
mod terminalization;

pub use cleanup::{
    evaluate_external_session_removal, evaluate_run_record_removal, evaluate_surface_removal,
    evaluate_worktree_path, evaluate_worktree_removal, ArtifactKind, CleanupDisposition,
    CleanupRefusal, PurgeAction, PurgePlan, RefusalCode, RetentionPolicy,
};
pub use compute_class::{next_compute_class, ComputeClass};
pub use failure::{
    BackoffPolicy, FailureClass, FailurePolicy, OnExhaustion, RetryBudget, RetryOutcome, RetryScope,
};
pub use routing::{
    select_candidate, CapabilityRequirements, ComputeCandidate, ComputeCapabilities, Risk,
    RoutingError,
};
pub use terminalization::{
    DependencyTerminalization, IndependentBranchAction, RunFailureAction, TerminalizationOutcome,
    TerminalizationPolicy,
};

#[cfg(test)]
mod minimal_intervention_tests {
    use super::*;
    use crate::task::TaskKind;

    #[test]
    fn retry_budget_retries_only_before_exhaustion() {
        let budget = RetryBudget::new(
            FailureClass::Timeout,
            RetryScope::Check,
            2,
            BackoffPolicy::fixed(50),
            OnExhaustion::FailTask,
        );

        assert_eq!(
            budget.outcome(1),
            RetryOutcome::Retry {
                scope: RetryScope::Check,
                delay_ms: 50,
            }
        );
        assert_eq!(
            budget.outcome(2),
            RetryOutcome::Exhausted(OnExhaustion::FailTask)
        );
    }

    #[test]
    fn unbudgeted_failure_fails_closed() {
        let policy = FailurePolicy::default();

        assert_eq!(
            policy.evaluate(FailureClass::Assertion, 0),
            RetryOutcome::Exhausted(OnExhaustion::FailTask)
        );
        assert_eq!(
            policy.evaluate(FailureClass::InvalidContract, 0),
            RetryOutcome::Exhausted(OnExhaustion::FailTask)
        );
    }

    #[test]
    fn dependency_terminalization_preserves_independent_branches() {
        let policy = TerminalizationPolicy::default();

        assert_eq!(
            policy.outcome(TaskKind::Implementation),
            TerminalizationOutcome {
                dependents: DependencyTerminalization::BlockTerminal,
                independent_branches: IndependentBranchAction::Continue,
                run: RunFailureAction::Continue,
            }
        );
        assert_eq!(
            policy.outcome(TaskKind::Integration).run,
            RunFailureAction::Fail
        );
    }

    #[test]
    fn cleanup_classification_is_not_failure_attention() {
        assert_eq!(
            RefusalCode::RunNotTerminal.disposition(),
            CleanupDisposition::Defer
        );
        for code in [
            RefusalCode::PathIsProjectRoot,
            RefusalCode::PathOutsideProject,
            RefusalCode::SurfaceNotOwned,
            RefusalCode::ExternalSession,
        ] {
            assert_eq!(code.disposition(), CleanupDisposition::Skip);
        }
        for code in [RefusalCode::WorktreeDirty, RefusalCode::WorktreeUnmerged] {
            assert_eq!(code.disposition(), CleanupDisposition::RequireDecision);
        }
    }
}
