// Unit-test modules use `unwrap`/`expect` freely; the workspace deny lints
// apply to production paths only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

mod migration;
mod schema;
mod sqlite;
mod trace;

pub use sqlite::{
    bounded_renewal, EventRecord, InterruptedClaim, InterruptedExecution, RenewalOutcome,
    SqliteStore, StoreError, RENEW_MAX_ATTEMPTS, RENEW_RETRY_DELAY_MS, RENEW_THRESHOLD_DIVISOR,
};
pub use trace::{RunTraceReport, TaskTrace};
