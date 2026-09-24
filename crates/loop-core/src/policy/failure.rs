use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Infrastructure-neutral classification of an execution or verification failure.
#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Hash, JsonSchema, Ord, PartialEq, PartialOrd, Serialize,
)]
#[serde(rename_all = "snake_case")]
pub enum FailureClass {
    Assertion,
    Timeout,
    ProcessStart,
    InvalidContract,
    Interrupted,
    Environment,
}

/// The smallest operation a retry budget permits the executor to repeat.
#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RetryScope {
    Check,
    Candidate,
    Worker,
    Compute,
}

/// What the executor must do when no retry remains.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OnExhaustion {
    #[default]
    FailTask,
    RequireAttention,
}

/// Bounded exponential backoff. A multiplier of one represents fixed backoff.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackoffPolicy {
    pub initial_delay_ms: u64,
    pub multiplier: u16,
    pub max_delay_ms: u64,
}

impl BackoffPolicy {
    pub const fn none() -> Self {
        Self {
            initial_delay_ms: 0,
            multiplier: 1,
            max_delay_ms: 0,
        }
    }

    pub const fn fixed(delay_ms: u64) -> Self {
        Self {
            initial_delay_ms: delay_ms,
            multiplier: 1,
            max_delay_ms: delay_ms,
        }
    }

    pub const fn exponential(initial_delay_ms: u64, multiplier: u16, max_delay_ms: u64) -> Self {
        Self {
            initial_delay_ms,
            multiplier,
            max_delay_ms,
        }
    }

    /// `retries_used` is zero before the first retry.
    pub fn delay_ms(self, retries_used: u16) -> u64 {
        if self.initial_delay_ms == 0 {
            return 0;
        }
        let multiplier = u64::from(self.multiplier.max(1));
        let delay = (0..retries_used).fold(self.initial_delay_ms, |delay, _| {
            delay.saturating_mul(multiplier)
        });
        if self.max_delay_ms == 0 {
            delay
        } else {
            delay.min(self.max_delay_ms)
        }
    }
}

/// Retry budget for one failure class. `max_retries` excludes the initial try.
#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryBudget {
    pub failure_class: FailureClass,
    pub scope: RetryScope,
    pub max_retries: u16,
    pub backoff: BackoffPolicy,
    pub on_exhaustion: OnExhaustion,
}

impl RetryBudget {
    pub const fn new(
        failure_class: FailureClass,
        scope: RetryScope,
        max_retries: u16,
        backoff: BackoffPolicy,
        on_exhaustion: OnExhaustion,
    ) -> Self {
        Self {
            failure_class,
            scope,
            max_retries,
            backoff,
            on_exhaustion,
        }
    }

    pub fn outcome(self, retries_used: u16) -> RetryOutcome {
        if retries_used < self.max_retries {
            RetryOutcome::Retry {
                scope: self.scope,
                delay_ms: self.backoff.delay_ms(retries_used),
            }
        } else {
            RetryOutcome::Exhausted(self.on_exhaustion)
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum RetryOutcome {
    Retry { scope: RetryScope, delay_ms: u64 },
    Exhausted(OnExhaustion),
}

/// Deterministic retry decision table. Missing classes fail closed.
#[derive(Clone, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailurePolicy {
    pub retry_budgets: Vec<RetryBudget>,
    pub on_unbudgeted_failure: OnExhaustion,
}

impl FailurePolicy {
    pub fn new(
        retry_budgets: impl IntoIterator<Item = RetryBudget>,
        on_unbudgeted_failure: OnExhaustion,
    ) -> Self {
        Self {
            retry_budgets: retry_budgets.into_iter().collect(),
            on_unbudgeted_failure,
        }
    }

    pub fn evaluate(&self, failure_class: FailureClass, retries_used: u16) -> RetryOutcome {
        self.retry_budgets
            .iter()
            .find(|budget| budget.failure_class == failure_class)
            .copied()
            .map_or(
                RetryOutcome::Exhausted(self.on_unbudgeted_failure),
                |budget| budget.outcome(retries_used),
            )
    }
}
