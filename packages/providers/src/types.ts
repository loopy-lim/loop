import type {
  ComputeClass,
  SandboxCapabilityDeclaration,
  TaskContextOutput,
  UsageMetadata,
  WorkerState,
} from "@loop/protocol";

import type { WorkerOutputContract } from "./json-output";

/**
 * Worker lifecycle vocabulary, re-exposed from the generated protocol
 * (`@loop/protocol`). The domain source is loop-core `WorkerState` (serde
 * snake_case); codegen carries it through the optional `state` fields on
 * `WorkerInput`/`WorkerResultInput`. `lost` is the only terminal-without-result
 * state — adapters that end a session without a usable result report `lost`
 * and carry the failure detail in `WorkerResult.failure` instead of a `failed`
 * status.
 *
 * Supersedes the frozen-contract hand-written copy (docs/decisions/
 * 2026-09-24-evolution-roadmap.md, 실행 1 후속 결정 2026-09-30, 안 B): the
 * generated protocol now carries `WorkerState`, so consumers must not keep a
 * local union.
 */
export type { WorkerState };

export type ProviderFailureKind =
  | "unavailable"
  | "authentication"
  | "quota"
  | "cancelled"
  | "timeout"
  | "incomplete_output"
  | "process_error";

export interface ProviderCapabilities {
  available: boolean;
  models?: string[];
  computeClasses: ComputeClass[];
  tools: boolean;
  vision: boolean;
  structuredOutput: boolean;
  resumableSession: boolean;
}

export interface StartWorkerInput {
  context?: TaskContextOutput;
  runId: string;
  taskId: string;
  title: string;
  kind: string;
  computeClass: ComputeClass;
  attempt: number;
  requirements: string[];
  workingDirectory?: string;
  /**
   * Already-resolved persona prompt text (worker persona contract D4). The
   * orchestrator resolves registry/config here; adapters render the opaque
   * string only.
   */
  personaInstructions?: string;
  /** Worker output contract (G16): request a machine-readable final JSON result. */
  output?: WorkerOutputContract;
}

export interface ResumeWorkerInput extends StartWorkerInput {
  previousWorkerId: string;
}

export interface WorkerHandle {
  id: string;
  sessionId?: string;
}

export interface WorkerResult {
  success: boolean;
  summary: string;
  sessionId?: string;
  /**
   * Upstream-reported usage (G17). Present ONLY when the upstream reported
   * it; adapters never invent figures. Collection/aggregation lives in
   * `usage.ts` (UsageCollector).
   */
  usage?: UsageMetadata;
  failure?: {
    kind: ProviderFailureKind;
    retryable: boolean;
  };
}

export type ProviderEvent =
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  | { type: "lifecycle"; status: WorkerState }
  | { type: "session"; sessionId: string }
  | { type: "final"; summary: string }
  /** Stream-level upstream usage report (G17); recorded by UsageTrackingProvider. */
  | { type: "usage"; usage: UsageMetadata };

export interface AgentProvider {
  readonly id: string;
  capabilities(): Promise<ProviderCapabilities>;
  /**
   * Honestly-declared OS isolation around worker execution (G4a). Absent
   * means `isolation: none` — reporting surfaces declare absence explicitly
   * via `collectSandboxCapabilities` (sandbox.ts); write scopes are never
   * interpreted as isolation.
   */
  sandboxDeclaration?(): SandboxCapabilityDeclaration;
  start(input: StartWorkerInput): Promise<WorkerHandle>;
  resume?(sessionId: string, input: ResumeWorkerInput): Promise<WorkerHandle>;
  cancel(workerId: string): Promise<void>;
  release?(workerId: string): Promise<void>;
  status(workerId: string): Promise<WorkerState>;
  result(workerId: string): Promise<WorkerResult>;
  /** Continue one completed interactive worker conversation to repair a failed external check. */
  repair?(workerId: string, feedback: string): Promise<WorkerResult>;
  subscribe?(workerId: string, listener: (event: ProviderEvent) => void): () => void;
  /**
   * Optional live-conversation steering channel (live-tabs ADR §4,
   * 2026-09-24): delivers a message into a running worker's interactive
   * conversation (`agent prompt` surface — typed into the TUI editor, never
   * raw key injection). Providers without a live conversation surface omit
   * it; rejections (e.g. `agent_blocked`) propagate to the caller, where the
   * recorded-steer contract keeps the message in the run history.
   */
  steer?(workerId: string, message: string): Promise<void>;
}
