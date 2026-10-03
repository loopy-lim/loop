/**
 * TEMPORARY wire seam — read-side view of the v1 gateway wire contract.
 *
 * Source of truth: docs/decisions/2026-xx-remote-app-architecture.md §4.
 * The Rust-owned payloads live in `crates/loop-bridge` and reach TypeScript as
 * Rustra-generated types in `packages/protocol`. That regeneration is pending
 * (bridge-protocol-types output is not in this tree yet), so the app carries
 * this single, auditable read-side surface instead of scattering assumptions.
 *
 * Contract rules encoded here:
 * - `u64`/`bigint` values (e.g. `lastSequence`) arrive as decimal STRINGS.
 * - IDs are opaque, case-sensitive UTF-8 strings; the app never parses them.
 * - SSE frame `event` names discriminate payloads; `data` carries no extra
 *   discriminant.
 * - Timestamps are UTC RFC 3339 strings.
 *
 * Swap-out: when `packages/protocol` re-exports the generated remote gateway
 * types, delete this file and import from `@loop/protocol` instead.
 */

/** RemoteRunStatus projection (Rust-owned mapping; the app never re-derives it). */
export type RemoteRunStatus =
  | "accepted"
  | "planning"
  | "running"
  | "attention"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskCounts = {
  pending: number;
  running: number;
  attention: number;
  done: number;
  failed: number;
  cancelled: number;
};

/** Optional per-submit client context. Display only; never credentials. */
export type ClientContext = {
  displayName?: string | null;
};

/** POST /v1/runs request body. */
export type SubmitPromptInput = {
  prompt: string;
  clientContext?: ClientContext | null;
};

/** Summary projection shared by list entries and the submit response. */
export type RemoteRunSummary = {
  runId: string;
  status: RemoteRunStatus;
  terminal: boolean;
  createdAt: string;
  updatedAt: string;
  /** Decimal string per contract; null before a durable Loop run exists. */
  lastSequence: string | null;
  taskCounts: TaskCounts;
};

export type RemoteTaskStatus =
  | "pending"
  | "running"
  | "attention"
  | "done"
  | "failed"
  | "cancelled";

export type RemoteTask = {
  taskId: string;
  status: RemoteTaskStatus;
  attempt: number;
  summary: string | null;
};

export type RemoteAttention = {
  attentionId: string;
  taskId: string;
  kind: string;
  message: string;
};

/** Full run projection returned by GET /v1/runs/{runId} and `status` events. */
export type RemoteRun = RemoteRunSummary & {
  tasks: RemoteTask[];
  /** Oldest-open attention, or null. */
  attention: RemoteAttention | null;
};

/** 202 Accepted body for POST /v1/runs. */
export type SubmitPromptAccepted = {
  run: RemoteRunSummary;
};

/** GET /v1/runs response page. */
export type RemoteRunPage = {
  runs: RemoteRunSummary[];
  nextCursor: string | null;
};

/** Common SSE event envelope fields (event name discriminates the variant). */
export type RemoteRunEventEnvelope = {
  version: number;
  runId: string;
  occurredAt: string;
};

export type RemoteRunStatusEvent = RemoteRunEventEnvelope & {
  run: RemoteRun;
};

export type RemoteRunOutputEvent = RemoteRunEventEnvelope & {
  taskId: string;
  /** Opaque dedupe key within the run. */
  activityId: string;
  /** One bounded logical activity (max 8 KiB after gateway truncation). */
  text: string;
  truncated: boolean;
};

export type RemoteRunResetReason = "cursor_unavailable" | "slow_consumer";

export type RemoteRunResetEvent = RemoteRunEventEnvelope & {
  reason: RemoteRunResetReason;
  run: RemoteRun;
};

export type RemoteRunTerminalEvent = RemoteRunEventEnvelope & {
  run: RemoteRun;
};

// ——— Terminal mirror v1 pane frames (decision 2026-xx-terminal-mirror) ———
// Generated names: crates/loop-bridge/src/pane.rs → @loop/protocol generated
// events (`RustraEventPayloads["loop.pane_*"]`); this read-side seam mirrors
// them until the app can import the generated module directly.

/** Pane state vocabulary (Rust `RemotePaneState`; codegen camelCase rule). */
export type RemotePaneState = "active" | "idle" | "blocked" | "done" | "unobserved" | "unknown";

export type RemotePaneSummary = {
  paneId: string;
  label?: string | null;
  /** Loop task id when derivable (e.g. `mirror·<taskId>` mirror panes). */
  taskId?: string | null;
  workspaceId: string;
  state: RemotePaneState;
};

/** GET /v1/panes response body. */
export type RemotePaneListOutput = {
  panes: RemotePaneSummary[];
};

/** One pane screen-buffer snapshot frame (SSE `pane_text`).
 * `revision` is a decimal string per the u64 wire rule. */
export type RemotePaneTextEvent = {
  paneId: string;
  revision: string;
  /** Snapshot-derived screen-buffer text (redacted server-side). */
  text: string;
  truncated: boolean;
  occurredAt: string;
};

export type RemotePaneResetReason = "cursorUnavailable" | "paneGone" | "slowConsumer";

/** Pane stream convergence frame (SSE `pane_reset`); paneGone terminates. */
export type RemotePaneResetEvent = RemotePaneTextEvent & {
  reason: RemotePaneResetReason;
};

/** Discriminated union keyed by the pane SSE `event` name. */
export type PaneStreamEvent =
  | { kind: "pane_text"; frame: RemotePaneTextEvent }
  | { kind: "pane_reset"; frame: RemotePaneResetEvent };

/** Discriminated union keyed by the SSE `event` name. */
export type RunStreamEvent =
  | { kind: "status"; frame: RemoteRunStatusEvent }
  | { kind: "output"; frame: RemoteRunOutputEvent }
  | { kind: "reset"; frame: RemoteRunResetEvent }
  | { kind: "terminal"; frame: RemoteRunTerminalEvent }
  | { kind: "error"; frame: GatewayProblem };

/** RFC 9457 problem body shared by HTTP errors and SSE `error` data. */
export type GatewayProblem = {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId: string;
  retryable: boolean;
  fields: Record<string, string> | null;
};

/** Maximum prompt size in UTF-8 bytes (ADR §4.1). */
export const MAX_PROMPT_BYTES = 64 * 1024;

/** Client-side mirror of the submit schema check (trim non-empty, <= 64 KiB). */
export function validatePrompt(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return "prompt must not be empty";
  }
  if (new TextEncoder().encode(trimmed).byteLength > MAX_PROMPT_BYTES) {
    return "prompt must be at most 65536 bytes";
  }
  return null;
}
