// ── rustra generated ────────────────────────────────────────
// File:   events.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  rust-probe schema → ts renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

export type ContextSummaryReason = 'budgetThreshold' | 'explicit';

export type RemoteSessionResetReason = 'cursorUnavailable' | 'sessionGone' | 'slowConsumer';

export type ConversationLifecyclePhase = 'sessionStarted' | 'turnStarted' | 'turnEnded' | 'sessionEnded';

export type LifecycleHookPhase = 'workerStarted' | 'workerEnded' | 'turnStarted' | 'turnEnded' | 'toolCallStarted' | 'toolCallEnded';

export type LifecycleHookOutcome = 'completed' | 'failed' | 'skipped';

export type RemotePaneSummary = {
  paneId: string;
  /** Human label (herdr pane label/title); null when the pane has none. */
  label?: string | null;
  /** Loop task id when derivable (e.g. the `mirror·<taskId>` mirror-pane label convention); null when the pane is not task-associated. */
  taskId?: string | null;
  workspaceId: string;
  state: RemotePaneState;
};

export type RemotePaneState = 'active' | 'idle' | 'blocked' | 'done' | 'unobserved' | 'unknown';

export type RemotePaneResetReason = 'cursorUnavailable' | 'paneGone' | 'slowConsumer';

export type SandboxCapabilityDeclaration = {
  /** Adapter-reported identity label (e.g. "codex", "herdr"); opaque to the bridge. */
  adapterId: string;
  isolation: SandboxIsolation;
  /** True when the adapter can confine writes to the declared write scope at the OS level; false means write scope is a scheduler contract only. */
  filesystemScoped: boolean;
  /** True when the adapter can block worker network egress. */
  networkIsolated: boolean;
  /** Bounded human note on the mechanism and its limits; null when the flags say everything the adapter can honestly claim. */
  detail?: string | null;
};

export type SandboxIsolation = 'none' | 'partial' | 'enforced';

export type RemoteSessionSummary = {
  sessionId: string;
  /** Correlated run, when the worker was started with a run marker. */
  runId?: string | null;
  /** Correlated task, when the worker was started with a task marker. */
  taskId?: string | null;
  /** Owning worker, when the session backs a registered worker. */
  workerId?: string | null;
  /** Execution lane the session runs on (adapter-reported label). */
  lane: string;
  /** Human label for list rendering; null when the session has none. */
  title?: string | null;
  state: RemoteSessionState;
};

export type RemoteSessionState = 'live' | 'ended' | 'unobserved';

export type UsageMetadata = {
  /** Prompt (input) tokens; null when unreported. */
  inputTokens?: number | bigint | null;
  /** Completion (output) tokens; null when unreported. */
  outputTokens?: number | bigint | null;
  /** Cache-read tokens when the upstream reports a separate cache axis. */
  cacheReadTokens?: number | bigint | null;
  basis: UsageBasis;
  /** Bounded decimal-string cost in `currency`; null when unpriced. */
  cost?: string | null;
  /** ISO 4217 code for `cost`; null when unpriced. */
  currency?: string | null;
};

export type UsageBasis = 'observed' | 'estimated';

export type ConversationUserMessageSource = 'interactive' | 'steer' | 'api';

export type RemoteSessionAssetRef = {
  /** Gateway-assigned attachment identity; addresses the body endpoint. */
  attachmentId: string;
  /** Bounded RFC 2045 media type (`type/subtype`), e.g. `image/png`. */
  mimeType: string;
  /** Decoded body size in bytes; advisory render metadata (sizing/labels). */
  byteLen: number;
};

/** 선언된 rustra 이벤트 이름 (Rust `PackageBuilder::event`). */
export type RustraEventName = 'loop.assistant_delta' | 'loop.assistant_message' | 'loop.context_summary' | 'loop.conversation_reset' | 'loop.lifecycle' | 'loop.lifecycle_hook' | 'loop.pane_list' | 'loop.pane_reset' | 'loop.pane_text' | 'loop.run_changed' | 'loop.sandbox_capabilities' | 'loop.session_list' | 'loop.steer_queued' | 'loop.tool_call_ended' | 'loop.tool_call_started' | 'loop.usage_recorded' | 'loop.user_message';

/** 이벤트 이름 → 페이로드 타입 매핑. */
export type RustraEventPayloads = {
  'loop.assistant_delta': {
  messageId: string;
  /** Bounded, redacted merged-delta text (append to the buffer). */
  delta: string;
  /** UTC RFC 3339 timestamp of the gateway merge. */
  occurredAt: string;
};
  'loop.assistant_message': {
  messageId: string;
  /** Bounded, redacted final text. */
  text: string;
  /** True when the final text exceeded the frame byte bound and was cut. */
  truncated: boolean;
  /** UTC RFC 3339 timestamp of the tap observation. */
  occurredAt: string;
};
  'loop.context_summary': {
  runId: string;
  taskId: string;
  /** Worker attempt the summarized context belonged to. */
  attempt: number;
  reason: ContextSummaryReason;
  /** Advisory entries folded into the summary (activity notes, retry history). Preserved entries are never counted here. */
  summarizedEntryCount: number;
  /** Preserved entries passed through untouched (completion contract, decision records, failure evidence, guidance). */
  preservedEntryCount: number;
  /** Bounded, redacted summary text that replaced the folded entries. */
  summary: string;
  /** True when `summary` exceeded the frame byte bound and was cut. */
  truncated: boolean;
  /** UTC RFC 3339 timestamp of the summarization. */
  occurredAt: string;
};
  'loop.conversation_reset': {
  reason: RemoteSessionResetReason;
  /** UTC RFC 3339 timestamp of the gateway observation. */
  occurredAt: string;
};
  'loop.lifecycle': {
  phase: ConversationLifecyclePhase;
  /** UTC RFC 3339 timestamp of the tap observation. */
  occurredAt: string;
};
  'loop.lifecycle_hook': {
  /** Adapter-assigned hook identity (its own hook-system name); opaque to the bridge. */
  hookId: string;
  phase: LifecycleHookPhase;
  outcome: LifecycleHookOutcome;
  /** Correlated run, when the hook ran inside a run-scoped worker. */
  runId?: string | null;
  /** Correlated task, when the hook ran inside a task-scoped worker. */
  taskId?: string | null;
  /** Bounded, redacted hook output (formatter logs, policy findings). */
  output: string;
  /** True when `output` exceeded the frame byte bound and was cut. */
  truncated: boolean;
  /** Hook process exit code, when the hook ran a process. */
  exitCode?: number | null;
  /** UTC RFC 3339 timestamp of the hook observation. */
  occurredAt: string;
};
  'loop.pane_list': {
  panes: RemotePaneSummary[];
};
  'loop.pane_reset': {
  paneId: string;
  reason: RemotePaneResetReason;
  /** Latest known snapshot counter at reset time; decimal string on the wire. */
  revision: number | bigint;
  text: string;
  truncated: boolean;
  /** UTC RFC 3339 timestamp of the gateway observation. */
  occurredAt: string;
};
  'loop.pane_text': {
  paneId: string;
  /** Monotonic herdr snapshot counter; decimal string on the JSON wire. */
  revision: number | bigint;
  /** Screen-buffer snapshot text (redacted, UTF-8 bounded by the gateway). */
  text: string;
  /** True when the snapshot exceeded the frame byte bound and was cut. */
  truncated: boolean;
  /** UTC RFC 3339 timestamp of the gateway observation. */
  occurredAt: string;
};
  'loop.run_changed': {
  runId: string;
  lastSequence: number | bigint;
};
  'loop.sandbox_capabilities': {
  capabilities: SandboxCapabilityDeclaration[];
};
  'loop.session_list': {
  sessions: RemoteSessionSummary[];
};
  'loop.steer_queued': {
  /** Steer acceptance identity; pairs the app's local pending marker. */
  steerId: string;
  /** Bounded, redacted steer text. */
  text: string;
  /** The run the steer was accepted against (adapter correlation). */
  runId: string;
  /** UTC RFC 3339 timestamp of the gateway acceptance. */
  occurredAt: string;
};
  'loop.tool_call_ended': {
  toolCallId: string;
  /** Bounded, redacted result text for the card's collapsed view. */
  resultText: string;
  /** True when `result_text` exceeded the frame byte bound and was cut. */
  resultTruncated: boolean;
  /** True renders the card's error state; the run state is unaffected. */
  isError: boolean;
  /** UTC RFC 3339 timestamp of the tap observation. */
  occurredAt: string;
};
  'loop.tool_call_started': {
  /** Tap-assigned tool-call identity (pi `toolCallId` correlation); the card's idempotent render key. */
  toolCallId: string;
  toolName: string;
  /** Bounded, redacted JSON encoding of the call arguments. */
  argsJson: string;
  /** True when `args_json` exceeded the frame byte bound and was cut. */
  argsTruncated: boolean;
  /** UTC RFC 3339 timestamp of the tap observation. */
  occurredAt: string;
};
  'loop.usage_recorded': {
  runId: string;
  /** Worker task the usage belongs to; null for run-level usage. */
  taskId?: string | null;
  /** Adapter worker identity; opaque correlation label. */
  workerId?: string | null;
  usage: UsageMetadata;
  /** UTC RFC 3339 timestamp of the observation window end. */
  occurredAt: string;
};
  'loop.user_message': {
  /** Tap-assigned message identity; the app's idempotent render key. */
  messageId: string;
  /** Bounded, redacted input text. */
  text: string;
  source: ConversationUserMessageSource;
  /** Number of image attachments observed in this input. The honest observed count; `attachments` is the referenceable subset (bodies the gateway actually holds), so it may be smaller (D5). */
  imageCount: number;
  /** Reference-shaped attachment metadata. Bodies are served out-of-band at `GET /v1/sessions/{sessionId}/attachments/{attachmentId}` — never inline (ring-buffer/replay budget, D5). */
  attachments: RemoteSessionAssetRef[];
  /** UTC RFC 3339 timestamp of the tap observation. */
  occurredAt: string;
};
};

/** 플랫폼 구독 함수 — RN `subscribeEvent` / Tauri 래퍼 등. */
export type SubscribeFn = <N extends RustraEventName>(
  name: N,
  callback: (payload: RustraEventPayloads[N]) => void,
) => (() => void) | Promise<() => void>;

/** 타입 안전 이벤트 구독 — 페이로드가 자동으로 좁혀진다. */
export function onRustraEvent<N extends RustraEventName>(
  subscribe: SubscribeFn,
  name: N,
  callback: (payload: RustraEventPayloads[N]) => void,
): (() => void) | Promise<() => void> {
  return subscribe(name, callback as (payload: RustraEventPayloads[N]) => void);
}
