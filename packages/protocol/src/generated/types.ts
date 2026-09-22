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
  activity?: string | null;
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
