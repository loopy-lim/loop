// Unit-test modules use `unwrap`/`expect` freely; the workspace deny lints
// apply to production paths only.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

mod migration;
mod schema;
mod sqlite;
mod trace;

pub use sqlite::{
    EventRecord, InterruptedClaim, InterruptedExecution, SqliteStore, StoreError,
};
pub use trace::{RunTraceReport, TaskTrace};
