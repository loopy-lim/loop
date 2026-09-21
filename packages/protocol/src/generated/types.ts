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

export type RunState = 'active' | 'attention' | 'completed' | 'failed' | 'cancelled';

export type TaskSnapshotOutput = {
  id: string;
  title: string;
  kind: TaskKind;
  state: TaskState;
  attempt: number;
  preferredCompute: ComputeClass;
};

export type TaskState = 'pending' | 'ready' | 'running' | 'verifying' | 'attention' | 'blocked' | 'done' | 'failed' | 'cancelled';

export type ActiveWorkerOutput = {
  id: string;
  taskId: string;
};

export type CheckResultInput = {
  id: string;
  passed: boolean;
};

export type AttentionKind = 'question' | 'decision' | 'approval' | 'conflict' | 'failure';

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

export type ClaimRunnableTasksInput = {
  databasePath: string;
  runId: string;
  runningTaskIds: string[];
  maxWorkers: number;
  maxFrontierWorkers: number;
};

export type TaskIdsOutput = {
  taskIds: string[];
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
};

export type WorkerResultInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  workerId: string;
  success: boolean;
  summary: string;
};

export type WorkerInput = {
  databasePath: string;
  runId: string;
  taskId: string;
  workerId: string;
};

export type RequestAttentionInput = {
  databasePath: string;
  runId: string;
  attentionId: string;
  kind: AttentionKind;
  summary: string;
  taskId?: string | null;
};

export type ResolveAttentionInput = {
  databasePath: string;
  runId: string;
  attentionId: string;
  resolution: string;
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
