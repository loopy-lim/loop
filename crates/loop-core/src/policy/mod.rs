mod cleanup;
mod compute_class;
mod context_budget;
mod failure;
mod routing;
mod stall;
mod terminalization;
mod verification;

pub use cleanup::{
    evaluate_external_session_removal, evaluate_run_record_removal, evaluate_surface_removal,
    evaluate_worktree_path, evaluate_worktree_removal, ArtifactKind, CleanupDisposition,
    CleanupRefusal, PurgeAction, PurgePlan, RefusalCode, RetentionPolicy,
};
pub use compute_class::{next_compute_class, ComputeClass};
pub use context_budget::{
    ClampedText, ContextBudgetPolicy, ReductionPass, DEFAULT_COMPACTED_BODY_CHARS,
    DEFAULT_DEPENDENCY_SUMMARY_CHARS, DEFAULT_MAX_FIELD_CHARS, DEFAULT_MAX_PROMPT_CHARS,
    PROMPT_OVERHEAD_CHARS, utf16_head, utf16_len,
};
pub use failure::{
    BackoffPolicy, FailureClass, FailurePolicy, OnExhaustion, RetryBudget, RetryOutcome, RetryScope,
};
pub use routing::{
    select_candidate, CapabilityKind, CapabilityRequirements, ComputeCandidate,
    ComputeCapabilities, Risk, RoutingError, RoutingRelaxation, TaskRouting,
};
pub use stall::{progress_freshness, ProgressFreshness};
pub use terminalization::{
    DependencyTerminalization, IndependentBranchAction, RunFailureAction, TerminalizationOutcome,
    TerminalizationPolicy,
};
pub use verification::{
    focused_rerun_check_ids, is_check_side_effect_path, CheckOutcome, FocusedRerun,
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
    fn timeout_retry_exhaustion_can_require_attention() {
        let policy = FailurePolicy::new(
            [RetryBudget::new(
                FailureClass::Timeout,
                RetryScope::Worker,
                1,
                BackoffPolicy::none(),
                OnExhaustion::RequireAttention,
            )],
            OnExhaustion::FailTask,
        );

        assert_eq!(
            policy.evaluate(FailureClass::Timeout, 0),
            RetryOutcome::Retry {
                scope: RetryScope::Worker,
                delay_ms: 0,
            }
        );
        assert_eq!(
            policy.evaluate(FailureClass::Timeout, 1),
            RetryOutcome::Exhausted(OnExhaustion::RequireAttention)
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
    fn only_nondeterministic_classes_are_retryable() {
        for class in [
            FailureClass::Timeout,
            FailureClass::Interrupted,
            FailureClass::Environment,
        ] {
            assert!(class.is_nondeterministic(), "{class:?} must be retryable");
        }
        for class in [
            FailureClass::Assertion,
            FailureClass::InvalidContract,
            FailureClass::ProcessStart,
        ] {
            assert!(!class.is_nondeterministic(), "{class:?} must be terminal");
        }
    }

    #[test]
    fn nondeterministic_verification_failure_retries_within_budget() {
        let policy = FailurePolicy::new(
            [RetryBudget::new(
                FailureClass::Environment,
                RetryScope::Check,
                1,
                BackoffPolicy::fixed(25),
                OnExhaustion::RequireAttention,
            )],
            OnExhaustion::FailTask,
        );

        assert_eq!(
            policy.evaluate(FailureClass::Environment, 0),
            RetryOutcome::Retry {
                scope: RetryScope::Check,
                delay_ms: 25,
            }
        );
        assert_eq!(
            policy.evaluate(FailureClass::Environment, 1),
            RetryOutcome::Exhausted(OnExhaustion::RequireAttention)
        );
    }

    #[test]
    fn deterministic_assertion_failure_is_terminal_even_when_budgeted() {
        let policy = FailurePolicy::new(
            [RetryBudget::new(
                FailureClass::Assertion,
                RetryScope::Check,
                5,
                BackoffPolicy::fixed(50),
                OnExhaustion::RequireAttention,
            )],
            OnExhaustion::RequireAttention,
        );

        // First deterministic assertion failure is terminal; the budget must
        // not grant a retry and exhaustion must fail the task, not request
        // attention.
        assert_eq!(
            policy.evaluate(FailureClass::Assertion, 0),
            RetryOutcome::Exhausted(OnExhaustion::FailTask)
        );
        assert_eq!(
            policy.evaluate(FailureClass::Assertion, 5),
            RetryOutcome::Exhausted(OnExhaustion::FailTask)
        );
    }

    #[test]
    fn validation_rejects_budgets_on_deterministic_classes() {
        let deterministic = FailurePolicy::new(
            [RetryBudget::new(
                FailureClass::ProcessStart,
                RetryScope::Worker,
                1,
                BackoffPolicy::none(),
                OnExhaustion::FailTask,
            )],
            OnExhaustion::FailTask,
        );
        assert!(deterministic.validate().is_err());

        let assertion = FailurePolicy::new(
            [RetryBudget::new(
                FailureClass::Assertion,
                RetryScope::Check,
                1,
                BackoffPolicy::none(),
                OnExhaustion::FailTask,
            )],
            OnExhaustion::FailTask,
        );
        assert!(assertion
            .validate()
            .err()
            .is_some_and(|message| message.contains("assertion")));

        let nondeterministic = FailurePolicy::new(
            [RetryBudget::new(
                FailureClass::Interrupted,
                RetryScope::Worker,
                1,
                BackoffPolicy::none(),
                OnExhaustion::RequireAttention,
            )],
            OnExhaustion::FailTask,
        );
        assert!(nondeterministic.validate().is_ok());

        let empty = FailurePolicy::default();
        assert!(empty.validate().is_ok());
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
