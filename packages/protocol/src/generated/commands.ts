// ── rustra generated ────────────────────────────────────────
// File:   commands.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  rust-probe schema → ts renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

import type { AddGoalTaskInput, AddTaskInput, AppendGoalCriteriaInput, Array_of_EventOutput, Array_of_RunListOutput, ClaimRunnableTasksInput, CleanupDispositionOutput, CleanupRunInput, CleanupRunOutput, CompareTracesInput, CompareTracesOutput, ConfigureRunInput, CreateRunInput, DecisionInput, EvaluateCleanupDispositionInput, EvaluateFailurePolicyInput, EvaluateSurfaceRemovalInput, EvaluateWorktreeRemovalInput, ExecutionLeaseInput, FailurePolicyOutput, GetTraceInput, GetTraceOutput, ListRunsInput, OperationOutput, PolicyEvaluationOutput, PrepareGoalRunInput, PrepareRunInput, PrepareRunPreflightInput, PromoteSteerInput, PromoteSteerOutput, ReconcileTaskInput, RecordActivityInput, RecordCheckReceiptsInput, RecordGuidanceDeliveredInput, RecordTaskOutputInput, ReleaseExecutionInput, RequestAttentionInput, ResolveAttentionInput, RunGraphInput, RunGraphOutput, RunInput, RunPlanOutput, SelectCandidateInput, SelectCandidateOutput, SnapshotOutput, SteerRunInput, StopVerificationInput, SubmitPlanInput, SubmitPlanOutput, SubscribeEventsInput, TaskContextInput, TaskContextOutput, TaskIdsOutput, UpdateTaskInput, VerificationInput, WorkerInput, WorkerResultInput } from './types.js';
import { createGeneratedFields2, invokeGenerated, invokeGeneratedFields1, invokeGeneratedFields3 } from '@rustra/types';
import type { InvokeOptions } from '@rustra/types';

export function addGoalTask(input: AddGoalTaskInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(29, 'addGoalTask', input, options);
}
addGoalTask.commandId = 'addGoalTask';

export function addTask(input: AddTaskInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(4, 'addTask', input, options);
}
addTask.commandId = 'addTask';

export function appendGoalCriteria(input: AppendGoalCriteriaInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(28, 'appendGoalCriteria', input, options);
}
appendGoalCriteria.commandId = 'appendGoalCriteria';

export const cancelRun = createGeneratedFields2<RunInput, OperationOutput>(13, 'cancelRun', "databasePath", "runId", 'cancelRun');

export function claimExecution(input: ExecutionLeaseInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(39, 'claimExecution', input, options);
}
claimExecution.commandId = 'claimExecution';

export function claimRunnableTasks(input: ClaimRunnableTasksInput, options?: InvokeOptions): Promise<TaskIdsOutput> {
  return invokeGenerated<TaskIdsOutput>(6, 'claimRunnableTasks', input, options);
}
claimRunnableTasks.commandId = 'claimRunnableTasks';

export function cleanupRun(input: CleanupRunInput, options?: InvokeOptions): Promise<CleanupRunOutput> {
  return invokeGenerated<CleanupRunOutput>(21, 'cleanupRun', input, options);
}
cleanupRun.commandId = 'cleanupRun';

export function compareTraces(input: CompareTracesInput, options?: InvokeOptions): Promise<CompareTracesOutput> {
  return invokeGenerated<CompareTracesOutput>(25, 'compareTraces', input, options);
}
compareTraces.commandId = 'compareTraces';

export function configureRun(input: ConfigureRunInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(30, 'configureRun', input, options);
}
configureRun.commandId = 'configureRun';

export const confirmPaused = createGeneratedFields2<RunInput, OperationOutput>(15, 'confirmPaused', "databasePath", "runId", 'confirmPaused');

export const createRun = createGeneratedFields2<CreateRunInput, SnapshotOutput>(1, 'createRun', "databasePath", "runId", 'createRun');

export function evaluateCleanupDisposition(input: EvaluateCleanupDispositionInput, options?: InvokeOptions): Promise<CleanupDispositionOutput> {
  return invokeGeneratedFields1<CleanupDispositionOutput>(46, 'evaluateCleanupDisposition', input, input["refusalCode"], options);
}
evaluateCleanupDisposition.commandId = 'evaluateCleanupDisposition';

export function evaluateFailurePolicy(input: EvaluateFailurePolicyInput, options?: InvokeOptions): Promise<FailurePolicyOutput> {
  return invokeGenerated<FailurePolicyOutput>(45, 'evaluateFailurePolicy', input, options);
}
evaluateFailurePolicy.commandId = 'evaluateFailurePolicy';

export const evaluateSurfaceRemoval = createGeneratedFields2<EvaluateSurfaceRemovalInput, PolicyEvaluationOutput>(23, 'evaluateSurfaceRemoval', "surfaceId", "isOwnedByLoop", 'evaluateSurfaceRemoval');

export function evaluateWorktreeRemoval(input: EvaluateWorktreeRemovalInput, options?: InvokeOptions): Promise<PolicyEvaluationOutput> {
  return invokeGenerated<PolicyEvaluationOutput>(22, 'evaluateWorktreeRemoval', input, options);
}
evaluateWorktreeRemoval.commandId = 'evaluateWorktreeRemoval';

export const getRun = createGeneratedFields2<RunInput, SnapshotOutput>(2, 'getRun', "databasePath", "runId", 'getRun');

export function getRunGraph(input: RunGraphInput, options?: InvokeOptions): Promise<RunGraphOutput> {
  return invokeGeneratedFields3<RunGraphOutput>(19, 'getRunGraph', input, input["databasePath"], input["runId"], input["nowMs"], options);
}
getRunGraph.commandId = 'getRunGraph';

export const getRunPlan = createGeneratedFields2<RunInput, RunPlanOutput>(31, 'getRunPlan', "databasePath", "runId", 'getRunPlan');

export const getSnapshot = createGeneratedFields2<RunInput, SnapshotOutput>(18, 'getSnapshot', "databasePath", "runId", 'getSnapshot');

export function getTaskContext(input: TaskContextInput, options?: InvokeOptions): Promise<TaskContextOutput> {
  return invokeGeneratedFields3<TaskContextOutput>(32, 'getTaskContext', input, input["databasePath"], input["runId"], input["taskId"], options);
}
getTaskContext.commandId = 'getTaskContext';

export const getTrace = createGeneratedFields2<GetTraceInput, GetTraceOutput>(24, 'getTrace', "databasePath", "runId", 'getTrace');

export function listRuns(input: ListRunsInput, options?: InvokeOptions): Promise<Array_of_RunListOutput> {
  return invokeGeneratedFields1<Array_of_RunListOutput>(43, 'listRuns', input, input["databasePath"], options);
}
listRuns.commandId = 'listRuns';

export const pauseRun = createGeneratedFields2<RunInput, OperationOutput>(14, 'pauseRun', "databasePath", "runId", 'pauseRun');

export function prepareGoalRun(input: PrepareGoalRunInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(27, 'prepareGoalRun', input, options);
}
prepareGoalRun.commandId = 'prepareGoalRun';

export function prepareRun(input: PrepareRunInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(26, 'prepareRun', input, options);
}
prepareRun.commandId = 'prepareRun';

export function prepareRunPreflight(input: PrepareRunPreflightInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(47, 'prepareRunPreflight', input, options);
}
prepareRunPreflight.commandId = 'prepareRunPreflight';

/**
 * Promote a mid-run user steer into the goal graph: the correction becomes
 * a new dependent task and a new goal criterion in one atomic append, so
 * the existing `RunCompleted` gate keeps the run open until the promoted
 * criterion verifies. Plain guidance without a criterion is still served
 * by `steer_run`; this command is for requirements that must be enforced.
 */
export function promoteSteer(input: PromoteSteerInput, options?: InvokeOptions): Promise<PromoteSteerOutput> {
  return invokeGenerated<PromoteSteerOutput>(38, 'promoteSteer', input, options);
}
promoteSteer.commandId = 'promoteSteer';

export function reconcileTask(input: ReconcileTaskInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(42, 'reconcileTask', input, options);
}
reconcileTask.commandId = 'reconcileTask';

export function recordActivity(input: RecordActivityInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(35, 'recordActivity', input, options);
}
recordActivity.commandId = 'recordActivity';

export function recordCheckReceipts(input: RecordCheckReceiptsInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(33, 'recordCheckReceipts', input, options);
}
recordCheckReceipts.commandId = 'recordCheckReceipts';

export function recordDecision(input: DecisionInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(10, 'recordDecision', input, options);
}
recordDecision.commandId = 'recordDecision';

/**
 * Records that a live worker received guidance up to `through_sequence`
 * (ADR M-TL2 delivery watermark). The store's reducer enforces the
 * ascending-only watermark per task, so an out-of-order or duplicate
 * delivery record fails here instead of regressing the projection.
 */
export function recordGuidanceDelivered(input: RecordGuidanceDeliveredInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(48, 'recordGuidanceDelivered', input, options);
}
recordGuidanceDelivered.commandId = 'recordGuidanceDelivered';

export function recordTaskOutput(input: RecordTaskOutputInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(36, 'recordTaskOutput', input, options);
}
recordTaskOutput.commandId = 'recordTaskOutput';

export function recordVerification(input: VerificationInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(9, 'recordVerification', input, options);
}
recordVerification.commandId = 'recordVerification';

export function recordWorkerResult(input: WorkerResultInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(8, 'recordWorkerResult', input, options);
}
recordWorkerResult.commandId = 'recordWorkerResult';

export function recordWorkerStarted(input: WorkerInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(7, 'recordWorkerStarted', input, options);
}
recordWorkerStarted.commandId = 'recordWorkerStarted';

export function recordWorkerStopped(input: WorkerInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(16, 'recordWorkerStopped', input, options);
}
recordWorkerStopped.commandId = 'recordWorkerStopped';

export function releaseExecution(input: ReleaseExecutionInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGeneratedFields3<OperationOutput>(41, 'releaseExecution', input, input["databasePath"], input["runId"], input["owner"], options);
}
releaseExecution.commandId = 'releaseExecution';

export function renewExecution(input: ExecutionLeaseInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(40, 'renewExecution', input, options);
}
renewExecution.commandId = 'renewExecution';

export function requestAttention(input: RequestAttentionInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(11, 'requestAttention', input, options);
}
requestAttention.commandId = 'requestAttention';

export function resolveAttention(input: ResolveAttentionInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(12, 'resolveAttention', input, options);
}
resolveAttention.commandId = 'resolveAttention';

export const resumeRun = createGeneratedFields2<RunInput, OperationOutput>(17, 'resumeRun', "databasePath", "runId", 'resumeRun');

export function selectCandidate(input: SelectCandidateInput, options?: InvokeOptions): Promise<SelectCandidateOutput> {
  return invokeGenerated<SelectCandidateOutput>(44, 'selectCandidate', input, options);
}
selectCandidate.commandId = 'selectCandidate';

export function steerRun(input: SteerRunInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(37, 'steerRun', input, options);
}
steerRun.commandId = 'steerRun';

export function stopVerification(input: StopVerificationInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(34, 'stopVerification', input, options);
}
stopVerification.commandId = 'stopVerification';

export function submitPlan(input: SubmitPlanInput, options?: InvokeOptions): Promise<SubmitPlanOutput> {
  return invokeGenerated<SubmitPlanOutput>(3, 'submitPlan', input, options);
}
submitPlan.commandId = 'submitPlan';

export function subscribeEvents(input: SubscribeEventsInput, options?: InvokeOptions): Promise<Array_of_EventOutput> {
  return invokeGenerated<Array_of_EventOutput>(20, 'subscribeEvents', input, options);
}
subscribeEvents.commandId = 'subscribeEvents';

export function updateTask(input: UpdateTaskInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(5, 'updateTask', input, options);
}
updateTask.commandId = 'updateTask';
