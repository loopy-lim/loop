/**
 * Wire payload surface of the Loop gateway (ADR §4):
 * docs/decisions/2026-xx-remote-app-architecture.md
 *
 * TEMPORARY seam — same status as `apps/loop-mobile/src/gateway/wire.ts`.
 * The authoritative payloads are Rust-owned types in `crates/loop-bridge`
 * (`SubmitPromptInput`, `RemoteRunSummary`, `RemoteRun`, `RemoteRunPage`,
 * `RemoteRunStatusEvent`, ...), generated into `packages/protocol` by
 * Rustra. That regeneration is not in this tree yet, so the gateway carries
 * this single auditable module instead of scattering string literals.
 *
 * Contract rules encoded here (ADR §4.1):
 * - `u64`/`bigint` values (`lastSequence`) travel as decimal STRINGS.
 * - IDs are opaque, case-sensitive UTF-8 strings; never parsed.
 * - The SSE `event` name discriminates payloads; `data` has no duplicate
 *   discriminant field.
 * - Timestamps are UTC RFC 3339 strings.
 *
 * Swap-out: when `packages/protocol` exports the generated remote gateway
 * types, delete this file and re-export from `@loop/protocol` instead.
 */

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

export function emptyTaskCounts(): TaskCounts {
  return { pending: 0, running: 0, attention: 0, done: 0, failed: 0, cancelled: 0 };
}

/** Optional per-submit client context. Display only; never credentials. */
export type ClientContext = {
  displayName?: string | null;
};

/** POST /v1/runs request body (generated `SubmitPromptInput` shape). */
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

/** Full run projection: GET /v1/runs/{runId} body and `status` event payload. */
export type RemoteRun = RemoteRunSummary & {
  tasks: RemoteTask[];
  /** Oldest-open attention, or null. */
  attention: RemoteAttention | null;
};

/** 202 Accepted body for POST /v1/runs (generated `SubmitPromptAccepted`). */
export type SubmitPromptAccepted = {
  run: RemoteRunSummary;
};

/** GET /v1/runs response page (generated `RemoteRunPage`). */
export type RemoteRunPage = {
  runs: RemoteRunSummary[];
  nextCursor: string | null;
};

/** Common SSE envelope fields; the SSE `event` name discriminates variants. */
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

/** Protocol version stamped on every SSE envelope. */
export const WIRE_VERSION = 1;

/** Maximum prompt size in UTF-8 bytes (ADR §4.1). */
export const MAX_PROMPT_BYTES = 64 * 1024;

/** Maximum display-name length in graphemes (ADR §4.3). */
export const MAX_DISPLAY_NAME_GRAPHEMES = 80;

/** Maximum single output text size in UTF-8 bytes before truncation (ADR §4.5). */
export const MAX_OUTPUT_BYTES = 8 * 1024;

/** Maximum run summary length in UTF-8 bytes (ADR §4.2). */
export const MAX_SUMMARY_BYTES = 2 * 1024;

/** Ring buffer of recent events kept per run, in process memory (ADR §4.5). */
export const REPLAY_BUFFER_FRAMES = 1024;

// ——— Terminal mirror v1 pane bounds (decision 2026-xx-terminal-mirror D2/D5) ———

/** Pane observation poll interval in ms (same axis as BoundedPaneSender's
 * 250 ms coalescing; decision D2). */
export const PANE_POLL_MS = 250;

/** Pane read window in lines (herdr `pane.read` recent_unwrapped; the
 * HerdrWorkerRuntime read precedent). */
export const PANE_READ_LINES = 80;

/** Maximum single pane text frame size in UTF-8 bytes before `truncated:
 * true` (decision D5; pane-family override of MAX_OUTPUT_BYTES). */
export const MAX_PANE_TEXT_BYTES = 16 * 1024;

/** Ring buffer of recent frames kept per pane, in process memory (decision D5
 * pane variant of REPLAY_BUFFER_FRAMES). */
export const PANE_REPLAY_BUFFER_FRAMES = 512;

/** Upstream bound: panes actually read per tick. Over-cap panes are marked
 * `unobserved` in the inventory only (decision D5). */
export const MAX_OBSERVED_PANES = 16;

/** Agent-session reconciliation interval in ms (herdr-agent-session.ts):
 * slow tick — registration is eventual UI state, not a stream (a few seconds
 * to first visibility is the operator-perceivable budget). */
export const AGENT_SESSION_POLL_MS = 2_000;

// ——— GUI conversation v1 session bounds (decision 2026-xx-gui-conversation D2/D3) ———

/** Minimum assistant delta merge interval in ms (decision D4 §2; the
 * BoundedPaneSender axis). Tokens are never forwarded one-by-one. */
export const SESSION_MERGE_FLUSH_MS = 250;

/** Merge pump interval in ms (production; tests drive ticks manually). */
export const SESSION_MERGE_TICK_MS = 50;

/** Maximum single conversation frame text size in UTF-8 bytes before
 * `*_truncated: true` (decision D2; pane-family bound). */
export const SESSION_MAX_FRAME_BYTES = 16 * 1024;

/** Ring buffer of recent frames kept per session, in process memory (decision
 * D3; pane-family precedent of PANE_REPLAY_BUFFER_FRAMES). */
export const SESSION_REPLAY_BUFFER_FRAMES = 512;

/** Per-connection outbound queue limits (ADR §4.5). */
export const QUEUE_MAX_FRAMES = 256;
export const QUEUE_MAX_BYTES = 1024 * 1024;

/** SSE keepalive interval in milliseconds (ADR §4.5). */
export const HEARTBEAT_MS = 15_000;
