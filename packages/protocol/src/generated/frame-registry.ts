// ── rustra generated ────────────────────────────────────────
// File:   frame-registry.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  schema → ts codec renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

import { addTaskCodec, cancelRunCodec, claimRunnableTasksCodec, cleanupRunCodec, createRunCodec, getRunCodec, getSnapshotCodec, recordDecisionCodec, recordVerificationCodec, recordWorkerResultCodec, recordWorkerStartedCodec, requestAttentionCodec, resolveAttentionCodec, resumeRunCodec, submitPlanCodec, subscribeEventsCodec, updateTaskCodec } from './frame-codecs.js';

export const frameRegistry = new Map<string, import('@rustra/types').FrameCodec<any, any>>([
  // route: postcard
  ['addTask', addTaskCodec],
  // route: postcard
  ['cancelRun', cancelRunCodec],
  // route: postcard
  ['claimRunnableTasks', claimRunnableTasksCodec],
  // route: postcard
  ['cleanupRun', cleanupRunCodec],
  // route: postcard
  ['createRun', createRunCodec],
  // route: postcard
  ['getRun', getRunCodec],
  // route: postcard
  ['getSnapshot', getSnapshotCodec],
  // route: postcard
  ['recordDecision', recordDecisionCodec],
  // route: postcard
  ['recordVerification', recordVerificationCodec],
  // route: postcard
  ['recordWorkerResult', recordWorkerResultCodec],
  // route: postcard
  ['recordWorkerStarted', recordWorkerStartedCodec],
  // route: postcard
  ['requestAttention', requestAttentionCodec],
  // route: postcard
  ['resolveAttention', resolveAttentionCodec],
  // route: postcard
  ['resumeRun', resumeRunCodec],
  // route: postcard
  ['submitPlan', submitPlanCodec],
  // route: postcard
  ['subscribeEvents', subscribeEventsCodec],
  // route: postcard
  ['updateTask', updateTaskCodec],
]);
