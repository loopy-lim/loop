//! Bridge command surface, decomposed into command families.
//!
//! Layout (one module per family, re-exported from here so the public API —
//! command names and wire types — is unchanged):
//!
//! - [`run`] — run lifecycle: create/pause/resume/cancel, snapshot, graph,
//!   event subscription
//! - [`task`] — task lifecycle: plan submission, task transitions, claims,
//!   worker and verification records
//! - [`guidance`] — guidance·attention: durable decisions, attention
//!   request/resolution, guidance delivery watermarks
//! - [`cleanup`] — cleanup: retention-bounded purge and removal policy
//!   evaluations
//! - [`benchmark`] — benchmark·trace: trace scoring/comparison plus the
//!   routing and failure-policy evaluators
//!
//! Error mapping stays in this module: every command funnels store access and
//! event appends through [`bridge_error`], [`store`], and the `append*`
//! helpers, so wire error codes have a single owner.

mod benchmark;
mod cleanup;
mod guidance;
mod run;
mod task;

pub use benchmark::*;
pub use cleanup::*;
pub use guidance::*;
pub use run::*;
pub use task::*;

pub(crate) use task::{task_from_input, task_from_preflight_input};

use loop_core::event::Event;
use loop_store::SqliteStore;
use rustra::prelude::*;
use std::sync::OnceLock;

use crate::context_summary::ContextSummaryEvent;
use crate::conversation::{
    ConversationAssistantDelta, ConversationAssistantMessage, ConversationLifecycle,
    ConversationSteerQueued, ConversationToolCallEnded, ConversationToolCallStarted,
    ConversationUserMessage, RemoteSessionListOutput, RemoteSessionResetEvent,
};
use crate::events::RunChangedEvent;
use crate::execution::{register_execution, register_preflight};
use crate::hooks::LifecycleHookEvent;
use crate::pane::{RemotePaneListOutput, RemotePaneResetEvent, RemotePaneTextEvent};
use crate::sandbox::SandboxCapabilityReport;
use crate::usage::UsageRecordEvent;

#[bridge_type]
#[derive(Default)]
pub struct OperationOutput {
    pub accepted: bool,
    /// Directive evidence for attention resolutions: what the resolution
    /// changed and where. Absent for plain accept/no-op operations.
    #[serde(default)]
    pub summary: Option<String>,
    /// Granted relaxation steps (e.g. `tools 1→0`) — the durable-evidence
    /// mirror of the `TaskRoutingUpdated` events committed by the resolve.
    #[serde(default)]
    pub routing_relaxations: Vec<String>,
    /// Task that received a `TaskReady` re-dispatch in this resolution, if
    /// any (already-queued work needs no re-dispatch).
    #[serde(default)]
    pub redispatched_task_id: Option<String>,
}

pub(crate) fn bridge_error(code: &'static str, error: impl std::fmt::Display) -> RustraError {
    RustraError::custom(code, error.to_string())
}

pub(crate) fn store(path: &str) -> Result<SqliteStore> {
    SqliteStore::open(path).map_err(|error| bridge_error("store_error", error))
}

pub(crate) fn append(path: &str, event: Event) -> Result<OperationOutput> {
    let mut store = store(path)?;
    append_and_notify(&mut store, &event, "event_append_failed")?;
    Ok(OperationOutput {
        accepted: true,
        ..OperationOutput::default()
    })
}

pub(crate) fn append_owned(
    path: &str,
    event: Event,
    owner: Option<&str>,
) -> Result<OperationOutput> {
    let mut store = store(path)?;
    append_and_notify_owned(&mut store, &event, owner, "event_append_failed")?;
    Ok(OperationOutput {
        accepted: true,
        ..OperationOutput::default()
    })
}

fn append_and_notify(
    store: &mut SqliteStore,
    event: &Event,
    error_code: &'static str,
) -> Result<i64> {
    let sequence = store
        .append(event)
        .map_err(|error| bridge_error(error_code, error))?;
    notify_run_changed(&event.run_id, sequence);
    Ok(sequence)
}

fn append_and_notify_owned(
    store: &mut SqliteStore,
    event: &Event,
    owner: Option<&str>,
    error_code: &'static str,
) -> Result<i64> {
    append_batch_and_notify_owned(store, std::slice::from_ref(event), owner, error_code)
}

pub(crate) fn append_batch_and_notify(
    store: &mut SqliteStore,
    events: &[Event],
    error_code: &'static str,
) -> Result<i64> {
    let sequence = store
        .append_batch(events)
        .map_err(|error| bridge_error(error_code, error))?;
    if let Some(event) = events.last() {
        notify_run_changed(&event.run_id, sequence);
    }
    Ok(sequence)
}

pub(crate) fn append_batch_and_notify_owned(
    store: &mut SqliteStore,
    events: &[Event],
    owner: Option<&str>,
    error_code: &'static str,
) -> Result<i64> {
    let sequence = store
        .append_batch_owned(events, owner)
        .map_err(|error| bridge_error(error_code, error))?;
    if let Some(event) = events.last() {
        notify_run_changed(&event.run_id, sequence);
    }
    Ok(sequence)
}

fn notify_run_changed(run_id: &str, last_sequence: i64) {
    loop_package().emit(
        "loop.run_changed",
        RunChangedEvent {
            run_id: run_id.to_string(),
            last_sequence,
        },
    );
}

pub fn loop_package() -> &'static Package {
    static PACKAGE: OnceLock<Package> = OnceLock::new();
    PACKAGE.get_or_init(|| {
        // Wire contract: `commandId` in the generated schema is the 1-based
        // registration order, so the family register chain below must
        // reproduce the original single-chain order exactly. The ordering is
        // locked by `registration_tests` against the frozen id table.
        let base = run::register_run_entry(Package::builder("loop.orchestration"));
        let base = task::register_task_plan(base);
        let base = task::register_task_workers(base);
        let base = guidance::register_decision_attention(base);
        let base = run::register_run_lifecycle(base);
        let base = task::register_task_stop(base);
        let base = run::register_run_queries(base);
        let base = cleanup::register_cleanup(base);
        let base = benchmark::register_trace(base);
        let base = register_execution(base);
        let base = benchmark::register_policy(base);
        let base = register_preflight(base);
        let builder = guidance::register_guidance_delivery(base);
        let package = builder
            .event::<RunChangedEvent>("loop.run_changed")
            // Terminal mirror v1 (decision 2026-xx-terminal-mirror D3): the pane
            // frame payloads are schema-anchored here so the gateway and the apps
            // consume GENERATED wire types. The native bridge never emits these
            // events — the gateway adapter frames them from herdr pane
            // observations over its own SSE surface; these declarations fix the
            // payload contracts (field names, u64 decimal-string rule) in Rust.
            .event::<RemotePaneListOutput>("loop.pane_list")
            .event::<RemotePaneTextEvent>("loop.pane_text")
            .event::<RemotePaneResetEvent>("loop.pane_reset")
            // GUI conversation view v1 (decision 2026-xx-gui-conversation D2): the
            // session conversation frame payloads are schema-anchored here so the
            // gateway and the apps consume GENERATED wire types. The native bridge
            // never emits these events — the gateway adapter frames them from the
            // pi extension tap over its own SSE surface; these declarations fix
            // the payload contracts (field names, identity keys, redacted bounded
            // text) in Rust. SSE frame names are these event names minus the
            // `loop.` prefix. Appended after the pane events so every existing
            // event id stays stable (additive third frame family).
            .event::<RemoteSessionListOutput>("loop.session_list")
            .event::<ConversationUserMessage>("loop.user_message")
            .event::<ConversationAssistantDelta>("loop.assistant_delta")
            .event::<ConversationAssistantMessage>("loop.assistant_message")
            .event::<ConversationToolCallStarted>("loop.tool_call_started")
            .event::<ConversationToolCallEnded>("loop.tool_call_ended")
            .event::<ConversationLifecycle>("loop.lifecycle")
            .event::<ConversationSteerQueued>("loop.steer_queued")
            .event::<RemoteSessionResetEvent>("loop.conversation_reset")
            // Gap-analysis wire families (docs/research/loop-gap-analysis.md):
            // schema-anchored declarative events the native bridge does not emit
            // or interpret. The orchestrator/adapters frame them over their own
            // transports; these declarations fix the payload contracts in Rust so
            // downstream surfaces consume GENERATED wire types. Appended after
            // the conversation events so every existing event id stays stable.
            // G1 context lifecycle: orchestrator summarization observations.
            .event::<ContextSummaryEvent>("loop.context_summary")
            // G4a sandbox capability: honest adapter isolation declarations for
            // doctor-style reporting (absence declares `none`, never inferred).
            .event::<SandboxCapabilityReport>("loop.sandbox_capabilities")
            // G17 usage: optional upstream-reported usage records; estimated and
            // observed figures are distinguished on the wire (`basis`).
            .event::<UsageRecordEvent>("loop.usage_recorded")
            // G13 lifecycle hooks: adapter typed event seam; hook outcomes are
            // evidence only — core completion judgment stays invariant.
            .event::<LifecycleHookEvent>("loop.lifecycle_hook")
            .build();
        package.register_ffi_with_default(FfiFormat::Json);
        package
    })
}

#[cfg(test)]
mod registration_tests {
    use super::*;
    use std::collections::BTreeMap;

    /// Frozen wire contract (packages/protocol/src/generated/schema.json):
    /// `commandId` is the 1-based registration order, so the family register
    /// chain in `loop_package` must reproduce this table exactly. Change an
    /// entry only together with regenerated protocol artifacts.
    const FROZEN_COMMAND_IDS: &[(&str, u16)] = &[
        ("createRun", 1),
        ("getRun", 2),
        ("submitPlan", 3),
        ("addTask", 4),
        ("updateTask", 5),
        ("claimRunnableTasks", 6),
        ("recordWorkerStarted", 7),
        ("recordWorkerResult", 8),
        ("recordVerification", 9),
        ("recordDecision", 10),
        ("requestAttention", 11),
        ("resolveAttention", 12),
        ("cancelRun", 13),
        ("pauseRun", 14),
        ("confirmPaused", 15),
        ("recordWorkerStopped", 16),
        ("resumeRun", 17),
        ("getSnapshot", 18),
        ("getRunGraph", 19),
        ("subscribeEvents", 20),
        ("cleanupRun", 21),
        ("evaluateWorktreeRemoval", 22),
        ("evaluateSurfaceRemoval", 23),
        ("getTrace", 24),
        ("compareTraces", 25),
        ("prepareRun", 26),
        ("prepareGoalRun", 27),
        ("appendGoalCriteria", 28),
        ("addGoalTask", 29),
        ("configureRun", 30),
        ("getRunPlan", 31),
        ("getTaskContext", 32),
        ("recordCheckReceipts", 33),
        ("stopVerification", 34),
        ("recordActivity", 35),
        ("recordTaskOutput", 36),
        ("steerRun", 37),
        ("promoteSteer", 38),
        ("claimExecution", 39),
        ("renewExecution", 40),
        ("releaseExecution", 41),
        ("reconcileTask", 42),
        ("recycleInterruptedExecution", 43),
        ("listRuns", 44),
        ("selectCandidate", 45),
        ("evaluateFailurePolicy", 46),
        ("evaluateCleanupDisposition", 47),
        ("prepareRunPreflight", 48),
        ("recordGuidanceDelivered", 49),
    ];

    #[test]
    fn registration_locks_the_frozen_wire_command_ids() {
        let schema = loop_package().live_schema();
        let commands = schema["commands"].as_array().expect("schema commands");
        let actual: BTreeMap<String, u16> = commands
            .iter()
            .map(|command| {
                (
                    command["name"].as_str().expect("command name").to_string(),
                    u16::try_from(command["commandId"].as_u64().expect("command id"))
                        .expect("command id fits u16"),
                )
            })
            .collect();
        let expected: BTreeMap<String, u16> = FROZEN_COMMAND_IDS
            .iter()
            .map(|(name, id)| ((*name).to_string(), *id))
            .collect();
        assert_eq!(actual, expected);
    }
}
