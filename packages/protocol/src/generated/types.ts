// ── rustra generated ────────────────────────────────────────
// File:   types.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  rust-probe schema → ts renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

export type { EngineClient, RustraError } from '@rustra/types';
export { RustraCommandError } from '@rustra/types';

export type TaskSpecInput = {
  id: string;
  title: string;
  kind: TaskKind;
  dependencies: string[];
  readScope: string[];
  writeScope: string[];
  requirements: string[];
  persona?: string | null;
  completionChecks: CompletionCheckInput[];
  preferredCompute: ComputeClass;
  minimumCompute: ComputeClass;
  maximumCompute: ComputeClass;
  maxAttempts: number;
};

export type TaskKind = 'research' | 'decision' | 'implementation' | 'verification' | 'integration';

export type CompletionCheckInput = {
  id: string;
  command: string;
  args: string[];
  workingDirectory?: string | null;
  timeoutMs: number | bigint;
};

export type ComputeClass = 'deterministic' | 'typed_decision' | 'tiny' | 'fast' | 'balanced' | 'strong' | 'frontier';

export type SkippedArtifactOutput = {
  artifact: string;
  reason: string;
};

/**
 * Per-run row of a benchmark report: aggregated metrics plus derived score.
 */
export type TraceReportEntry = {
  runId: string;
  summary: TraceSummary;
  score: TraceScore;
};

/**
 * Aggregate, deterministic metrics for one run's ordered event sequence.
 *
 * Every counter is derived purely from event kinds; `elapsed_ms` is the only wall-clock field and is never invented here — a caller with a clock (such as a store query joining recorded timings) may fill it in.
 */
export type TraceSummary = {
  total_events?: number;
  tasks_created?: number;
  tasks_completed?: number;
  worker_starts?: number;
  worker_finishes?: number;
  worker_failures?: number;
  verification_passes?: number;
  verification_failures?: number;
  attention_created?: number;
  attention_resolved?: number;
  elapsed_ms?: number | bigint | null;
};

/**
 * Deterministic comparison score for a [`TraceSummary`].
 *
 * Each component is per-mille (0..=1000); `total` is therefore 0..=3000.
 */
export type TraceScore = {
  /** Completed tasks out of created tasks. */
  reliability: number;
  /** Resolved attention out of created attention; a run that never needed attention scores full marks. */
  autonomy: number;
  /** Verification passes out of verification attempts. */
  first_pass: number;
};

export type TraceComparison = {
  rankings: TraceRanking[];
};

export type TraceRanking = {
  label: string;
  score: TraceScore;
};

export type RunState = 'active' | 'pausing' | 'paused' | 'cancelling' | 'attention' | 'completed' | 'failed' | 'cancelled';

export type TaskSnapshotOutput = {
  id: string;
  title: string;
  kind: TaskKind;
  state: TaskState;
  attempt: number;
  preferredCompute: ComputeClass;
  dependencies: string[];
  readScope: string[];
  writeScope: string[];
  blockedBy: string[];
  lastFailure?: string | null;
  activities: string[];
  resultSummary?: string | null;
};

export type TaskState = 'pending' | 'ready' | 'running' | 'verifying' | 'attention' | 'blocked' | 'done' | 'failed' | 'cancelled';

export type ActiveWorkerOutput = {
  id: string;
  taskId: string;
};

export type AttentionSnapshotOutput = {
  id: string;
  kind: AttentionKind;
  summary: string;
  taskId?: string | null;
};

export type AttentionKind = 'question' | 'decision' | 'approval' | 'conflict' | 'failure';

export type DependencyResultOutput = {
  taskId: string;
  title: string;
  summary: string;
};

export type CheckReceipt = {
  id: string;
  command: string;
  args: string[];
  workingDirectory: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number | bigint;
};

export type RunListOutput = {
  runId: string;
  state: RunState;
};

export type CheckResultInput = {
  id: string;
  passed: boolean;
};

export type ComputeCandidateInput = {
  id: string;
  computeClass: ComputeClass;
  capabilities: ComputeCapabilitiesInput;
  latency: number;
  costWeight: number;
  available: boolean;
};

/**
 * Capability scores advertised for a compute candidate (loop-core `ComputeCapabilities` mirror; the core type lacks a JSON schema derive, so the bridge carries its own wire form and converts on entry).
 */
export type ComputeCapabilitiesInput = {
  coding: number;
  reasoning: number;
  tools: number;
  vision: number;
  longContext: number;
};

export type CapabilityRequirementsInput = {
  capabilities: ComputeCapabilitiesInput;
  minimumCompute: ComputeClass;
  maximumCompute: ComputeClass;
  risk: RoutingRisk;
};

/**
 * Task risk driving the compute-class floor (loop-core `Risk` mirror).
 */
export type RoutingRisk = 'low' | 'medium' | 'high' | 'critical';

export type EventOutput = {
  sequence: number | bigint;
  payloadJson: string;
};

export type AddTaskInput = {
  databasePath: string;
  runId: string;
  task: TaskSpecInput;
};

export type OperationOutput = {
  accepted: boolean;
};

export type RunInput = {
  databasePath: string;
  runId: string;
};

export type ExecutionLeaseInput = {
  databasePath: string;
  runId: string;
  owner: string;
  nowMs: number | bigint;
  ttlMs: number | bigint;
};

export type ClaimRunnableTasksInput = {
  databasePath: string;
  runId: string;
  runningTaskIds: string[];
  maxWorkers: number;
  maxFrontierWorkers: number;
  executionOwner?: string | null;
};

export type TaskIdsOutput = {
  taskIds: string[];
};

export type CleanupRunInput = {
  databasePath: string;
  runId: string;
  keepRecent: number;
  dryRun: boolean;
};

export type CleanupRunOutput = {
  removedArtifacts: string[];
  skippedArtifacts: SkippedArtifactOutput[];
};

export type CompareTracesInput = {
  databasePath: string;
  runIds: string[];
};

export type CompareTracesOutput = {
  /** One row per compared run, in input order (duplicates removed). */
  entries: TraceReportEntry[];
  /** Deterministic ranking by score, highest first. */
  comparison: TraceComparison;
};

export type ConfigureRunInput = {
  databasePath: string;
  runId: string;
  intent: string;
  workingDirectory: string;
};

export type CreateRunInput = {
  databasePath: string;
  runId: string;
};

export type SnapshotOutput = {
  runId: string;
  state: RunState;
  tasks: TaskSnapshotOutput[];
  activeWorkers: ActiveWorkerOutput[];
  openAttentionIds: string[];
  attention: AttentionSnapshotOutput[];
  intent: string;
  workingDirectory: string;
  guidance: string[];
  lastSequence: number | bigint;
  executionOwner?: string | null;
  executionExpiresAt?: number | bigint | null;
};

export type EvaluateSurfaceRemovalInput = {
  surfaceId: string;
  isOwnedByLoop: boolean;
};

export type PolicyEvaluationOutput = {
  allowed: boolean;
  refusalCode?: string | null;
  reason?: string | null;
};

export type EvaluateWorktreeRemovalInput = {
  projectRoot: string;
  worktreePath: string;
  isMerged: boolean;
  isClean: boolean;
};

export type RunPlanOutput = {
  intent: string;
  workingDirectory: string;
  tasks: TaskSpecInput[];
};

export type TaskContextInput = {
  databasePath: string;
  runId: string;
  taskId: string;
};

export type TaskContextOutput = {
  intent: string;
  workingDirectory: string;
  task: TaskSpecInput;
  attempt: number;
  dependencyResults: DependencyResultOutput[];
  resultSummary?: string | null;
  previousFailure?: string | null;
  previousChecks: CheckReceipt[];
  guidance: string[];
};

export type GetTraceInput = {
  databasePath: string;
  runId: string;
};

export type GetTraceOutput = {
  runId: string;
  summary: TraceSummary;
  score: TraceScore;
};

export type ListRunsInput = {
  databasePath: string;
};

export type Array_of_RunListOutput = RunListOutput[];

export type PrepareRunInput = {
  databasePath: string;
  runId: string;
  intent: string;
  workingDirectory: string;
  tasks: TaskSpecInput[];
};

export type ReconcileTaskInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  confirmedStopped: boolean;
};

export type RecordActivityInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  activity: string;
  executionOwner?: string | null;
};

export type RecordCheckReceiptsInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  checks: CheckReceipt[];
  executionOwner?: string | null;
};

export type DecisionInput = {
  databasePath: string;
  runId: string;
  decisionId: string;
  taskId?: string | null;
  value: string;
};

export type VerificationInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  passed: boolean;
  checks: CheckResultInput[];
  reason: string;
  executionOwner?: string | null;
};

export type WorkerResultInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  workerId: string;
  success: boolean;
  summary: string;
  executionOwner?: string | null;
};

export type WorkerInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  workerId: string;
  executionOwner?: string | null;
};

export type ReleaseExecutionInput = {
  databasePath: string;
  runId: string;
  owner: string;
};

export type RequestAttentionInput = {
  databasePath: string;
  runId: string;
  attentionId: string;
  kind: AttentionKind;
  summary: string;
  taskId?: string | null;
  executionOwner?: string | null;
};

export type ResolveAttentionInput = {
  databasePath: string;
  runId: string;
  attentionId: string;
  resolution: string;
};

export type SelectCandidateInput = {
  candidates: ComputeCandidateInput[];
  eligibleCandidateIds: string[];
  requirements: CapabilityRequirementsInput;
};

export type SelectCandidateOutput = {
  candidateId: string;
  computeClass: ComputeClass;
};

export type SteerRunInput = {
  databasePath: string;
  runId: string;
  taskId?: string | null;
  message: string;
};

export type StopVerificationInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  executionOwner?: string | null;
};

export type SubmitPlanInput = {
  databasePath: string;
  runId: string;
  tasks: TaskSpecInput[];
};

export type SubmitPlanOutput = {
  taskCount: number;
};

export type SubscribeEventsInput = {
  databasePath: string;
  runId: string;
  afterSequence: number | bigint;
  limit: number;
};

export type Array_of_EventOutput = EventOutput[];

export type UpdateTaskInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  state: TaskState;
};
