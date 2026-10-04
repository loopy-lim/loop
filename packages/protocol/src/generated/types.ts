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
  routing?: TaskRouting | null;
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

export type TaskRouting = {
  risk: Risk;
  required: ComputeCapabilities;
};

export type Risk = 'low' | 'medium' | 'high' | 'critical';

export type ComputeCapabilities = {
  coding: number;
  reasoning: number;
  tools: number;
  vision: number;
  long_context: number;
};

export type GoalCriterionInput = {
  id: string;
  description: string;
  taskId: string;
  checkIds: string[];
};

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
  /** Epoch milliseconds of the latest durable worker start or task activity. Includes sub-second precision for newly recorded events. */
  lastProgressMs?: number | bigint | null;
  resultSummary?: string | null;
};

export type TaskState = 'pending' | 'ready' | 'running' | 'verifying' | 'attention' | 'blocked' | 'done' | 'failed' | 'cancelled';

export type ActiveWorkerOutput = {
  id: string;
  taskId: string;
};

export type AttentionSnapshotOutput = {
  openedAtMs?: number | bigint | null;
  id: string;
  kind: AttentionKind;
  summary: string;
  taskId?: string | null;
};

export type AttentionKind = 'question' | 'decision' | 'approval' | 'conflict' | 'failure';

export type GoalCriterionStatusOutput = {
  id: string;
  description: string;
  taskId: string;
  checkIds: string[];
  state: GoalCriterionState;
};

export type GoalCriterionState = 'pending' | 'verified';

export type RefusalCode = 'run_not_terminal' | 'worktree_unmerged' | 'worktree_dirty' | 'path_is_project_root' | 'path_outside_project' | 'surface_not_owned' | 'external_session';

export type CleanupDisposition = 'defer' | 'skip' | 'require_decision';

/**
 * Infrastructure-neutral classification of an execution or verification failure.
 */
export type FailureClass = 'assertion' | 'timeout' | 'process_start' | 'invalid_contract' | 'interrupted' | 'environment';

/**
 * Deterministic retry decision table. Missing classes fail closed, and deterministic failure classes fail closed even when a budget exists: retry is only ever granted for nondeterministic verification failures ([`FailureClass::is_nondeterministic`]). The deterministic terminal policy — first assertion (or invalid-contract, process-start) failure is terminal — holds regardless of configuration.
 */
export type FailurePolicy = {
  retryBudgets: RetryBudget[];
  onUnbudgetedFailure: OnExhaustion;
};

/**
 * Retry budget for one failure class. `max_retries` excludes the initial try.
 */
export type RetryBudget = {
  failureClass: FailureClass;
  scope: RetryScope;
  maxRetries: number;
  backoff: BackoffPolicy;
  onExhaustion: OnExhaustion;
};

/**
 * The smallest operation a retry budget permits the executor to repeat.
 */
export type RetryScope = 'check' | 'candidate' | 'worker' | 'compute';

/**
 * Bounded exponential backoff. A multiplier of one represents fixed backoff.
 */
export type BackoffPolicy = {
  initialDelayMs: number | bigint;
  multiplier: number;
  maxDelayMs: number | bigint;
};

/**
 * What the executor must do when no retry remains.
 */
export type OnExhaustion = 'fail_task' | 'require_attention';

/**
 * Failure propagation rules owned by core rather than an executor adapter.
 */
export type TerminalizationPolicy = {
  dependents: DependencyTerminalization;
  independentBranches: IndependentBranchAction;
  failRunForSerialTask: boolean;
};

/**
 * Terminal state assigned to descendants that require a failed task.
 */
export type DependencyTerminalization = 'block_terminal' | 'cancel';

export type IndependentBranchAction = 'continue';

export type FailurePolicyAction = 'retry' | 'failTask' | 'requireAttention';

export type RunFailureAction = 'continue' | 'fail';

export type GraphOwnerHealth = 'live' | 'missing' | 'expired' | 'inactive';

export type GraphNodeOutput = {
  id: string;
  title: string;
  kind: TaskKind;
  state: TaskState;
  dependencies: string[];
  blockedBy: string[];
  readScope: string[];
  writeScope: string[];
  workers: string[];
  attempt: number;
  resultSummary?: string | null;
  lastFailure?: string | null;
};

export type DecompositionContractOutput = {
  defaults: string[];
  assumptions: AssumptionInput[];
  semanticTouchpoints: SemanticTouchpointInput[];
  consumes: DependencyConsumptionInput[];
  completionCoverage: CompletionCoverageInput[];
  failurePolicy: FailurePolicy;
};

export type AssumptionInput = {
  assumption: string;
  evidence: string;
  ifFalse: string;
  revisit: string;
};

export type SemanticTouchpointInput = {
  id: string;
  access: SemanticAccess;
  conflictResolution: SemanticConflictResolution;
};

export type SemanticAccess = 'consume' | 'modify';

export type SemanticConflictResolution = 'unresolved' | 'serialize' | 'dependency_order';

export type DependencyConsumptionInput = {
  dependency: string;
  decisions: string[];
  artifacts: string[];
  checks: string[];
  risks: string[];
};

export type CompletionCoverageInput = {
  checkId: string;
  requirements: string[];
  artifacts: string[];
  semantics: string[];
  evidenceLevel: EvidenceLevel;
};

export type EvidenceLevel = 'static' | 'unit' | 'fake' | 'integration' | 'live';

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
  outputArtifact?: string | null;
  source?: SourceReceipt | null;
};

export type SourceReceipt = {
  /** Digest of the declared read/write scope around the completion check batch. */
  beforeFingerprint: string;
  afterFingerprint: string;
  /** Repository paths observed to change while a worker ran. Shared-tree observations cannot establish which actor wrote them. */
  observedChangedPaths: string[];
  observedOutsideWriteScope: string[];
};

export type RunListOutput = {
  runId: string;
  state: RunState;
};

export type PreflightTaskSpecInput = {
  task: TaskSpecInput;
  defaults: string[];
  assumptions: AssumptionInput[];
  semanticTouchpoints: SemanticTouchpointInput[];
  consumes: DependencyConsumptionInput[];
  completionCoverage: CompletionCoverageInput[];
  failurePolicy: FailurePolicy;
};

/**
 * Wire shape of a steer-mailbox delivery record (ADR M-TL2): the mailbox appends one of these per live worker after a successful `provider.steer`, marking every `GuidanceAdded` at or below `through_sequence` as received by that worker's task. The delivery watermark projection lives in loop-core; this type is only the transport form (see `record_guidance_delivered`).
 */
export type GuidanceDeliveredEvent = {
  taskId: string;
  workerId: string;
  throughSequence: number | bigint;
};

export type CheckResultInput = {
  id: string;
  passed: boolean;
};

/**
 * Lifecycle vocabulary for a worker as observed at the adapter boundary.
 *
 * This enum is the domain source of the worker-status vocabulary. The bridge carries this type through the optional `state` fields on `WorkerInput` and `WorkerResultInput`, generating the protocol `WorkerState`. These observations do not change the existing worker result policy; absent state remains valid for callers that only report success and summary. Adapters should consume the generated type rather than maintain a copy.
 *
 * Vocabulary correspondence (decided here, once):
 *
 * - `starting` / `running` / `completed` / `cancelled` map one-to-one to the adapter session lifecycle. - `lost` is the only terminal-without-result state. An adapter session that ends without a usable result (process exit, API failure, blocked or unobservable agent) reports `lost`; the failure taxonomy and retryability stay adapter-side in the worker result. Recovery uses the same term for a worker that can no longer be observed after a restart.
 *
 * There is deliberately no `failed` variant: the graph does not distinguish "worker failed" from "worker lost" as a state — both reconcile through the recorded worker result, and the run-level failure vocabulary already lives in [`crate::run::RunState`] and task events.
 */
export type WorkerState = 'starting' | 'running' | 'completed' | 'lost' | 'cancelled';

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
  highRiskFloor: ComputeClass;
  criticalRiskFloor: ComputeClass;
};

/**
 * Task risk driving the compute-class floor (loop-core `Risk` mirror).
 */
export type RoutingRisk = 'low' | 'medium' | 'high' | 'critical';

export type EventOutput = {
  sequence: number | bigint;
  payloadJson: string;
};

export type AddGoalTaskInput = {
  databasePath: string;
  runId: string;
  task: TaskSpecInput;
  criteria: GoalCriterionInput[];
};

export type OperationOutput = {
  accepted: boolean;
};

export type AddTaskInput = {
  databasePath: string;
  runId: string;
  task: TaskSpecInput;
};

export type AppendGoalCriteriaInput = {
  databasePath: string;
  runId: string;
  criteria: GoalCriterionInput[];
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
  goalCriteria: GoalCriterionStatusOutput[];
  lastSequence: number | bigint;
  executionOwner?: string | null;
  executionExpiresAt?: number | bigint | null;
};

export type EvaluateCleanupDispositionInput = {
  refusalCode: RefusalCode;
};

export type CleanupDispositionOutput = {
  disposition: CleanupDisposition;
};

export type EvaluateFailurePolicyInput = {
  failureClass: FailureClass;
  retriesUsed: number;
  taskKind: TaskKind;
  failurePolicy: FailurePolicy;
  terminalizationPolicy: TerminalizationPolicy;
};

export type FailurePolicyOutput = {
  action: FailurePolicyAction;
  retryScope?: RetryScope | null;
  delayMs?: number | bigint | null;
  dependents?: DependencyTerminalization | null;
  independentBranches?: IndependentBranchAction | null;
  run?: RunFailureAction | null;
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

export type RunGraphInput = {
  databasePath: string;
  runId: string;
  nowMs: number | bigint;
};

export type RunGraphOutput = {
  runId: string;
  state: RunState;
  lastSequence: string;
  ownerHealth: GraphOwnerHealth;
  openAttentionCount: number;
  nodes: GraphNodeOutput[];
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
  decompositionContract?: DecompositionContractOutput | null;
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

export type PrepareGoalRunInput = {
  databasePath: string;
  runId: string;
  intent: string;
  workingDirectory: string;
  tasks: TaskSpecInput[];
  criteria: GoalCriterionInput[];
};

export type PrepareRunInput = {
  databasePath: string;
  runId: string;
  intent: string;
  workingDirectory: string;
  tasks: TaskSpecInput[];
};

export type PrepareRunPreflightInput = {
  databasePath: string;
  runId: string;
  intent: string;
  workingDirectory: string;
  tasks: PreflightTaskSpecInput[];
};

export type PromoteSteerInput = {
  databasePath: string;
  runId: string;
  message: string;
  task: TaskSpecInput;
  criteria: GoalCriterionInput[];
};

export type PromoteSteerOutput = {
  accepted: boolean;
  runId: string;
  taskId: string;
  criterionIds: string[];
  summary: string;
  evidenceTests: string[];
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

export type RecordGuidanceDeliveredInput = {
  databasePath: string;
  runId: string;
  guidance: GuidanceDeliveredEvent;
  executionOwner?: string | null;
};

export type RecordTaskOutputInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  summary: string;
  executionOwner?: string | null;
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
  state?: WorkerState | null;
};

export type WorkerInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  workerId: string;
  executionOwner?: string | null;
  state?: WorkerState | null;
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
