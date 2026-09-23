use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Lifecycle vocabulary for a worker as observed at the adapter boundary.
///
/// This enum is the domain source of the worker-status vocabulary. Nothing
/// in the bridge transports it today: `ActiveWorkerOutput` carries only
/// `id`/`taskId`, and adapters expose worker status through `status()`
/// without crossing the bridge. The vocabulary stays Rust-side until a bridge
/// consumer actually asks for worker state (`docs/decisions/2026-09-24-evolution-roadmap.md`,
/// 실행 1).
///
/// The TypeScript union `WorkerState` in `packages/providers/src/types.ts`
/// is a deliberate frozen-contract copy of this enum's serde form, not
/// generated output — its strings must change in lockstep with this enum or
/// not at all.
///
/// Vocabulary correspondence (decided here, once):
///
/// - `starting` / `running` / `completed` / `cancelled` map one-to-one to the
///   adapter session lifecycle.
/// - `lost` is the only terminal-without-result state. An adapter session that
///   ends without a usable result (process exit, API failure, blocked or
///   unobservable agent) reports `lost`; the failure taxonomy and retryability
///   stay adapter-side in the worker result. Recovery uses the same term for a
///   worker that can no longer be observed after a restart.
///
/// There is deliberately no `failed` variant: the graph does not distinguish
/// "worker failed" from "worker lost" as a state — both reconcile through the
/// recorded worker result, and the run-level failure vocabulary already lives
/// in [`crate::run::RunState`] and task events.
#[derive(Clone, Copy, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerState {
    Starting,
    Running,
    Completed,
    Lost,
    Cancelled,
}

impl WorkerState {
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Lost | Self::Cancelled)
    }
}

#[cfg(test)]
mod tests {
    use super::WorkerState;

    #[test]
    fn serde_vocabulary_is_snake_case_and_lost_not_failed() {
        assert_eq!(serde_json::to_string(&WorkerState::Lost).unwrap(), "\"lost\"");
        assert_eq!(
            serde_json::to_string(&WorkerState::Starting).unwrap(),
            "\"starting\""
        );
        assert_eq!(
            serde_json::to_string(&WorkerState::Running).unwrap(),
            "\"running\""
        );
        assert_eq!(
            serde_json::to_string(&WorkerState::Completed).unwrap(),
            "\"completed\""
        );
        assert_eq!(
            serde_json::to_string(&WorkerState::Cancelled).unwrap(),
            "\"cancelled\""
        );
        assert!(serde_json::from_str::<WorkerState>("\"failed\"").is_err());
    }

    #[test]
    fn terminal_states_are_completed_lost_cancelled() {
        assert!(WorkerState::Completed.is_terminal());
        assert!(WorkerState::Lost.is_terminal());
        assert!(WorkerState::Cancelled.is_terminal());
        assert!(!WorkerState::Starting.is_terminal());
        assert!(!WorkerState::Running.is_terminal());
    }

    #[test]
    fn every_variant_round_trips() {
        for state in [
            WorkerState::Starting,
            WorkerState::Running,
            WorkerState::Completed,
            WorkerState::Lost,
            WorkerState::Cancelled,
        ] {
            let encoded = serde_json::to_string(&state).unwrap();
            assert_eq!(
                serde_json::from_str::<WorkerState>(&encoded).unwrap(),
                state
            );
        }
    }
}
