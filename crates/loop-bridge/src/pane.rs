//! Wire frame family for the terminal mirror v1 (decision
//! `2026-xx-terminal-mirror` D3): herdr worker pane screen buffers streamed to
//! the remote app as bounded snapshot text frames.
//!
//! Boundary: these types live only in the bridge (transport form). The pane
//! concept never enters `loop-core`, and run/task domain events are never
//! promoted from pane identifiers. Pane frames are a separate SSE family from
//! run events (separate per-pane log, separate dedupe key `paneId + revision`).
//!
//! Contract notes:
//! - `revision` mirrors the herdr `PaneReadResult.revision` counter (uint64).
//!   On the HTTP/SSE JSON wire it travels as a DECIMAL STRING (ADR §4.1 u64
//!   rule; same precedent as the run family's `lastSequence`). The generated
//!   TypeScript union `number | bigint` describes the bridge/FFI form.
//! - Snapshot semantics: a text frame is the pane's screen-buffer snapshot at
//!   a revision, not a lossless delta stream. Multiple changes between
//!   observation polls coalesce into the latest snapshot (decision D2/D5).
//! - Pane text is screen-buffer text: the app must label it as
//!   snapshot-derived and never treat it as structured protocol output.

use rustra::prelude::*;

/// Lifecycle/state vocabulary of an observable pane (decision
/// `2026-xx-terminal-mirror` §6: fixed at M-TM1 from herdr
/// `pane.agent_status_changed` plus gateway-side observation marks).
/// Variant casing follows the bridge codegen's camelCase rule (wire:
/// `active`/`idle`/… single words; multi-word variants camelCase).
#[bridge_type]
pub enum RemotePaneState {
    /// herdr agent_status=working: the pane backs a live agent.
    Active,
    /// herdr agent_status=idle.
    Idle,
    /// herdr agent_status=blocked.
    Blocked,
    /// herdr agent_status=done.
    Done,
    /// Inventory-only mark: above the gateway's pane observation cap, so no
    /// pane stream is served for it (decision D5 upstream bound).
    Unobserved,
    /// herdr agent_status=unknown (no confident streaming source); apps
    /// render this pane as lifecycle-only.
    Unknown,
}

/// One subscribable pane in the terminal-mirror inventory.
#[bridge_type]
pub struct RemotePaneSummary {
    pub pane_id: String,
    /// Human label (herdr pane label/title); null when the pane has none.
    pub label: Option<String>,
    /// Loop task id when derivable (e.g. the `mirror·<taskId>` mirror-pane
    /// label convention); null when the pane is not task-associated.
    pub task_id: Option<String>,
    pub workspace_id: String,
    pub state: RemotePaneState,
}

/// GET /v1/panes response body: the pane inventory (decision D4).
#[bridge_type]
pub struct RemotePaneListOutput {
    pub panes: Vec<RemotePaneSummary>,
}

/// One pane text frame on `GET /v1/panes/{paneId}/events` (SSE event
/// `pane_text`): the pane's screen-buffer snapshot at `revision`.
#[bridge_type]
pub struct RemotePaneTextEvent {
    pub pane_id: String,
    /// Monotonic herdr snapshot counter; decimal string on the JSON wire.
    pub revision: u64,
    /// Screen-buffer snapshot text (redacted, UTF-8 bounded by the gateway).
    pub text: String,
    /// True when the snapshot exceeded the frame byte bound and was cut.
    pub truncated: bool,
    /// UTC RFC 3339 timestamp of the gateway observation.
    pub occurred_at: String,
}

/// Why a pane stream converged to a reset frame (decision D5). Variant
/// casing follows the bridge codegen's camelCase rule, so the wire values
/// are `cursorUnavailable` / `paneGone` / `slowConsumer` (the decision's
/// `cursor_unavailable` / `pane_gone` vocabulary, camelized by codegen).
#[bridge_type]
pub enum RemotePaneResetReason {
    /// The presented cursor is malformed, foreign, or points at evicted
    /// history; the client restarts from the latest snapshot.
    CursorUnavailable,
    /// The pane no longer exists (worker lifetime ended); the stream closes
    /// after this frame.
    PaneGone,
    /// The connection's outbound queue overflowed; identical in effect to
    /// `cursor_unavailable` (fresh start from the latest snapshot) but named
    /// for the cause, mirroring the run family's `slow_consumer`.
    SlowConsumer,
}

/// Pane stream reset frame (SSE event `pane_reset`): carries the pane's
/// latest known snapshot so a client converges without waiting for the next
/// revision change. Connection-local semantics match the run family (ADR
/// §4.5): resets are never buffered for replay.
#[bridge_type]
pub struct RemotePaneResetEvent {
    pub pane_id: String,
    pub reason: RemotePaneResetReason,
    /// Latest known snapshot counter at reset time; decimal string on the wire.
    pub revision: u64,
    pub text: String,
    pub truncated: bool,
    /// UTC RFC 3339 timestamp of the gateway observation.
    pub occurred_at: String,
}
