// ── rustra generated ────────────────────────────────────────
// File:   frame-registry.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  schema → ts codec renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

import { addGoalTaskCodec, addTaskCodec, appendGoalCriteriaCodec, cancelRunCodec, claimExecutionCodec, claimRunnableTasksCodec, cleanupRunCodec, compareTracesCodec, configureRunCodec, confirmPausedCodec, createRunCodec, evaluateCleanupDispositionComplexCodec, evaluateFailurePolicyComplexCodec, evaluateSurfaceRemovalCodec, evaluateWorktreeRemovalCodec, getRunCodec, getRunGraphCodec, getRunPlanCodec, getSnapshotCodec, getTaskContextCodec, getTraceCodec, listRunsCodec, pauseRunCodec, prepareGoalRunCodec, prepareRunCodec, prepareRunPreflightCodec, promoteSteerCodec, reconcileTaskCodec, recordActivityCodec, recordCheckReceiptsCodec, recordDecisionCodec, recordGuidanceDeliveredCodec, recordTaskOutputCodec, recordVerificationCodec, recordWorkerResultComplexCodec, recordWorkerStartedComplexCodec, recordWorkerStoppedComplexCodec, releaseExecutionCodec, renewExecutionCodec, requestAttentionCodec, resolveAttentionCodec, resumeRunCodec, selectCandidateCodec, steerRunCodec, stopVerificationCodec, submitPlanCodec, subscribeEventsCodec, updateTaskCodec } from './frame-codecs.js';

export const frameRegistry = new Map<string, import('@rustra/types').FrameCodec<any, any>>([
  // route: postcard
  ['addGoalTask', addGoalTaskCodec],
  // route: postcard
  ['addTask', addTaskCodec],
  // route: postcard
  ['appendGoalCriteria', appendGoalCriteriaCodec],
  // route: postcard
  ['cancelRun', cancelRunCodec],
  // route: postcard
  ['claimExecution', claimExecutionCodec],
  // route: postcard
  ['claimRunnableTasks', claimRunnableTasksCodec],
  // route: postcard
  ['cleanupRun', cleanupRunCodec],
  // route: postcard
  ['compareTraces', compareTracesCodec],
  // route: postcard
  ['configureRun', configureRunCodec],
  // route: postcard
  ['confirmPaused', confirmPausedCodec],
  // route: postcard
  ['createRun', createRunCodec],
  // route: complex
  ['evaluateCleanupDisposition', evaluateCleanupDispositionComplexCodec],
  // route: complex
  ['evaluateFailurePolicy', evaluateFailurePolicyComplexCodec],
  // route: postcard
  ['evaluateSurfaceRemoval', evaluateSurfaceRemovalCodec],
  // route: postcard
  ['evaluateWorktreeRemoval', evaluateWorktreeRemovalCodec],
  // route: postcard
  ['getRun', getRunCodec],
  // route: postcard
  ['getRunGraph', getRunGraphCodec],
  // route: postcard
  ['getRunPlan', getRunPlanCodec],
  // route: postcard
  ['getSnapshot', getSnapshotCodec],
  // route: postcard
  ['getTaskContext', getTaskContextCodec],
  // route: postcard
  ['getTrace', getTraceCodec],
  // route: postcard
  ['listRuns', listRunsCodec],
  // route: postcard
  ['pauseRun', pauseRunCodec],
  // route: postcard
  ['prepareGoalRun', prepareGoalRunCodec],
  // route: postcard
  ['prepareRun', prepareRunCodec],
  // route: postcard
  ['prepareRunPreflight', prepareRunPreflightCodec],
  // route: postcard
  ['promoteSteer', promoteSteerCodec],
  // route: postcard
  ['reconcileTask', reconcileTaskCodec],
  // route: postcard
  ['recordActivity', recordActivityCodec],
  // route: postcard
  ['recordCheckReceipts', recordCheckReceiptsCodec],
  // route: postcard
  ['recordDecision', recordDecisionCodec],
  // route: postcard
  ['recordGuidanceDelivered', recordGuidanceDeliveredCodec],
  // route: postcard
  ['recordTaskOutput', recordTaskOutputCodec],
  // route: postcard
  ['recordVerification', recordVerificationCodec],
  // route: complex
  ['recordWorkerResult', recordWorkerResultComplexCodec],
  // route: complex
  ['recordWorkerStarted', recordWorkerStartedComplexCodec],
  // route: complex
  ['recordWorkerStopped', recordWorkerStoppedComplexCodec],
  // route: postcard
  ['releaseExecution', releaseExecutionCodec],
  // route: postcard
  ['renewExecution', renewExecutionCodec],
  // route: postcard
  ['requestAttention', requestAttentionCodec],
  // route: postcard
  ['resolveAttention', resolveAttentionCodec],
  // route: postcard
  ['resumeRun', resumeRunCodec],
  // route: postcard
  ['selectCandidate', selectCandidateCodec],
  // route: postcard
  ['steerRun', steerRunCodec],
  // route: postcard
  ['stopVerification', stopVerificationCodec],
  // route: postcard
  ['submitPlan', submitPlanCodec],
  // route: postcard
  ['subscribeEvents', subscribeEventsCodec],
  // route: postcard
  ['updateTask', updateTaskCodec],
]);
