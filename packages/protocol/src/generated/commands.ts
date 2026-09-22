// ── rustra generated ────────────────────────────────────────
// File:   commands.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  rust-probe schema → ts renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

import type { AddTaskInput, Array_of_EventOutput, ClaimRunnableTasksInput, CleanupRunInput, CleanupRunOutput, CreateRunInput, DecisionInput, EvaluateSurfaceRemovalInput, EvaluateWorktreeRemovalInput, OperationOutput, PolicyEvaluationOutput, RequestAttentionInput, ResolveAttentionInput, RunInput, SnapshotOutput, SubmitPlanInput, SubmitPlanOutput, SubscribeEventsInput, TaskIdsOutput, UpdateTaskInput, VerificationInput, WorkerInput, WorkerResultInput } from './types.js';
import { createGeneratedFields2, invokeGenerated } from '@rustra/types';
import type { InvokeOptions } from '@rustra/types';

export function addTask(input: AddTaskInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(4, 'addTask', input, options);
}
addTask.commandId = 'addTask';

export const cancelRun = createGeneratedFields2<RunInput, OperationOutput>(13, 'cancelRun', "databasePath", "runId", 'cancelRun');

export function claimRunnableTasks(input: ClaimRunnableTasksInput, options?: InvokeOptions): Promise<TaskIdsOutput> {
  return invokeGenerated<TaskIdsOutput>(6, 'claimRunnableTasks', input, options);
}
claimRunnableTasks.commandId = 'claimRunnableTasks';

export function cleanupRun(input: CleanupRunInput, options?: InvokeOptions): Promise<CleanupRunOutput> {
  return invokeGenerated<CleanupRunOutput>(17, 'cleanupRun', input, options);
}
cleanupRun.commandId = 'cleanupRun';

export const createRun = createGeneratedFields2<CreateRunInput, SnapshotOutput>(1, 'createRun', "databasePath", "runId", 'createRun');

export const evaluateSurfaceRemoval = createGeneratedFields2<EvaluateSurfaceRemovalInput, PolicyEvaluationOutput>(19, 'evaluateSurfaceRemoval', "surfaceId", "isOwnedByLoop", 'evaluateSurfaceRemoval');

export function evaluateWorktreeRemoval(input: EvaluateWorktreeRemovalInput, options?: InvokeOptions): Promise<PolicyEvaluationOutput> {
  return invokeGenerated<PolicyEvaluationOutput>(18, 'evaluateWorktreeRemoval', input, options);
}
evaluateWorktreeRemoval.commandId = 'evaluateWorktreeRemoval';

export const getRun = createGeneratedFields2<RunInput, SnapshotOutput>(2, 'getRun', "databasePath", "runId", 'getRun');

export const getSnapshot = createGeneratedFields2<RunInput, SnapshotOutput>(15, 'getSnapshot', "databasePath", "runId", 'getSnapshot');

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

export function requestAttention(input: RequestAttentionInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(11, 'requestAttention', input, options);
}
requestAttention.commandId = 'requestAttention';

export function resolveAttention(input: ResolveAttentionInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(12, 'resolveAttention', input, options);
}
resolveAttention.commandId = 'resolveAttention';

export const resumeRun = createGeneratedFields2<RunInput, OperationOutput>(14, 'resumeRun', "databasePath", "runId", 'resumeRun');

export function submitPlan(input: SubmitPlanInput, options?: InvokeOptions): Promise<SubmitPlanOutput> {
  return invokeGenerated<SubmitPlanOutput>(3, 'submitPlan', input, options);
}
submitPlan.commandId = 'submitPlan';

export function subscribeEvents(input: SubscribeEventsInput, options?: InvokeOptions): Promise<Array_of_EventOutput> {
  return invokeGenerated<Array_of_EventOutput>(16, 'subscribeEvents', input, options);
}
subscribeEvents.commandId = 'subscribeEvents';

export function updateTask(input: UpdateTaskInput, options?: InvokeOptions): Promise<OperationOutput> {
  return invokeGenerated<OperationOutput>(5, 'updateTask', input, options);
}
updateTask.commandId = 'updateTask';
