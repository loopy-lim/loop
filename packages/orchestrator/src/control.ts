export type OrchestrationControl = Pick<
  typeof import("@loop/protocol"),
  | "createRun"
  | "submitPlan"
  | "requestAttention"
  | "getSnapshot"
  | "claimRunnableTasks"
  | "recordWorkerStarted"
  | "recordWorkerResult"
  | "recordVerification"
  | "cancelRun"
  | "resumeRun"
  | "subscribeEvent"
  | "cleanupRun"
  | "evaluateWorktreeRemoval"
  | "evaluateSurfaceRemoval"
>;
