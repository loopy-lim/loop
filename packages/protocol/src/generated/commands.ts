// ── rustra generated ────────────────────────────────────────
// File:   commands.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  rust-probe schema → ts renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

import type { AddTaskInput, Array_of_EventOutput, Array_of_RunListOutput, ClaimRunnableTasksInput, CleanupRunInput, CleanupRunOutput, CompareTracesInput, CompareTracesOutput, ConfigureRunInput, CreateRunInput, DecisionInput, EvaluateSurfaceRemovalInput, EvaluateWorktreeRemovalInput, ExecutionLeaseInput, GetTraceInput, GetTraceOutput, ListRunsInput, OperationOutput, PolicyEvaluationOutput, PrepareRunInput, ReconcileTaskInput, RecordActivityInput, RecordCheckReceiptsInput, ReleaseExecutionInput, RequestAttentionInput, ResolveAttentionInput, RunInput, RunPlanOutput, SelectCandidateInput, SelectCandidateOutput, SnapshotOutput, SteerRunInput, StopVerificationInput, SubmitPlanInput, SubmitPlanOutput, SubscribeEventsInput, TaskContextInput, TaskContextOutput, TaskIdsOutput, UpdateTaskInput, VerificationInput, WorkerInput, WorkerResultInput } from './types.js';
import { createGeneratedFields2, invokeGenerated, invokeGeneratedFields1, invokeGeneratedFields3 } from '@rustra/types';
import type { InvokeOptions } from '@rustra/types';

export function addTask(input: AddTaskInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(4, 'addTask', input, options);
}
addTask.commandId = 'addTask';

export const cancelRun = createGeneratedFields2<RunInput, OperationOutput>(13, 'cancelRun', "databasePath", "runId", 'cancelRun');

export function claimExecution(input: ExecutionLeaseInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(33, 'claimExecution', input, options);
}
claimExecution.commandId = 'claimExecution';

export function claimRunnableTasks(input: ClaimRunnableTasksInput, options?: InvokeOptions): Promise<TaskIdsOutput> {
  return invokeGenerated<TaskIdsOutput>(6, 'claimRunnableTasks', input, options);
}
claimRunnableTasks.commandId = 'claimRunnableTasks';

export function cleanupRun(input: CleanupRunInput, options?: InvokeOptions): Promise<CleanupRunOutput> {
  return invokeGenerated<CleanupRunOutput>(20, 'cleanupRun', input, options);
}
cleanupRun.commandId = 'cleanupRun';

export function compareTraces(input: CompareTracesInput, options?: InvokeOptions): Promise<CompareTracesOutput> {
  return invokeGenerated<CompareTracesOutput>(24, 'compareTraces', input, options);
}
compareTraces.commandId = 'compareTraces';

export function configureRun(input: ConfigureRunInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(26, 'configureRun', input, options);
}
configureRun.commandId = 'configureRun';

export const confirmPaused = createGeneratedFields2<RunInput, OperationOutput>(15, 'confirmPaused', "databasePath", "runId", 'confirmPaused');

export const createRun = createGeneratedFields2<CreateRunInput, SnapshotOutput>(1, 'createRun', "databasePath", "runId", 'createRun');

export const evaluateSurfaceRemoval = createGeneratedFields2<EvaluateSurfaceRemovalInput, PolicyEvaluationOutput>(22, 'evaluateSurfaceRemoval', "surfaceId", "isOwnedByLoop", 'evaluateSurfaceRemoval');

export function evaluateWorktreeRemoval(input: EvaluateWorktreeRemovalInput, options?: InvokeOptions): Promise<PolicyEvaluationOutput> {
  return invokeGenerated<PolicyEvaluationOutput>(21, 'evaluateWorktreeRemoval', input, options);
}
evaluateWorktreeRemoval.commandId = 'evaluateWorktreeRemoval';

export const getRun = createGeneratedFields2<RunInput, SnapshotOutput>(2, 'getRun', "databasePath", "runId", 'getRun');

export const getRunPlan = createGeneratedFields2<RunInput, RunPlanOutput>(27, 'getRunPlan', "databasePath", "runId", 'getRunPlan');

export const getSnapshot = createGeneratedFields2<RunInput, SnapshotOutput>(18, 'getSnapshot', "databasePath", "runId", 'getSnapshot');

export function getTaskContext(input: TaskContextInput, options?: InvokeOptions): Promise<TaskContextOutput> {
  return invokeGeneratedFields3<TaskContextOutput>(28, 'getTaskContext', input, input["databasePath"], input["runId"], input["taskId"], options);
}
getTaskContext.commandId = 'getTaskContext';

export const getTrace = createGeneratedFields2<GetTraceInput, GetTraceOutput>(23, 'getTrace', "databasePath", "runId", 'getTrace');

export function listRuns(input: ListRunsInput, options?: InvokeOptions): Promise<Array_of_RunListOutput> {
  return invokeGeneratedFields1<Array_of_RunListOutput>(37, 'listRuns', input, input["databasePath"], options);
}
listRuns.commandId = 'listRuns';

export const pauseRun = createGeneratedFields2<RunInput, OperationOutput>(14, 'pauseRun', "databasePath", "runId", 'pauseRun');

export function prepareRun(input: PrepareRunInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(25, 'prepareRun', input, options);
}
prepareRun.commandId = 'prepareRun';

export function reconcileTask(input: ReconcileTaskInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(36, 'reconcileTask', input, options);
}
reconcileTask.commandId = 'reconcileTask';

export function recordActivity(input: RecordActivityInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(31, 'recordActivity', input, options);
}
recordActivity.commandId = 'recordActivity';

export function recordCheckReceipts(input: RecordCheckReceiptsInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(29, 'recordCheckReceipts', input, options);
}
recordCheckReceipts.commandId = 'recordCheckReceipts';

export function recordDecision(input: DecisionInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(10, 'recordDecision', input, options);
}
recordDecision.commandId = 'recordDecision';

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
  return invokeGeneratedFields3<OperationOutput>(35, 'releaseExecution', input, input["databasePath"], input["runId"], input["owner"], options);
}
releaseExecution.commandId = 'releaseExecution';

export function renewExecution(input: ExecutionLeaseInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(34, 'renewExecution', input, options);
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
  return invokeGenerated<SelectCandidateOutput>(38, 'selectCandidate', input, options);
}
selectCandidate.commandId = 'selectCandidate';

export function steerRun(input: SteerRunInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(32, 'steerRun', input, options);
}
steerRun.commandId = 'steerRun';

export function stopVerification(input: StopVerificationInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(30, 'stopVerification', input, options);
}
stopVerification.commandId = 'stopVerification';

export function submitPlan(input: SubmitPlanInput, options?: InvokeOptions): Promise<SubmitPlanOutput> {
  return invokeGenerated<SubmitPlanOutput>(3, 'submitPlan', input, options);
}
submitPlan.commandId = 'submitPlan';

export function subscribeEvents(input: SubscribeEventsInput, options?: InvokeOptions): Promise<Array_of_EventOutput> {
  return invokeGenerated<Array_of_EventOutput>(19, 'subscribeEvents', input, options);
}
subscribeEvents.commandId = 'subscribeEvents';

export function updateTask(input: UpdateTaskInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(5, 'updateTask', input, options);
}
updateTask.commandId = 'updateTask';
