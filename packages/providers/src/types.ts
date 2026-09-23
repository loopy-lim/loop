import type { ComputeClass, TaskContextOutput } from "@loop/protocol";

/**
 * Worker lifecycle vocabulary mirroring loop-core `WorkerState` (serde
 * snake_case). `lost` is the only terminal-without-result state — adapters
 * that end a session without a usable result report `lost` and carry the
 * failure detail in `WorkerResult.failure` instead of a `failed` status.
 *
 * Frozen-contract exception (docs/decisions/2026-09-24-evolution-roadmap.md,
 * 실행 1): this union is hand-written on purpose. Nothing in the generated
 * protocol carries `WorkerState`, so there is nothing to generate it from.
 * The strings below are a frozen contract with the Rust serde form in
 * `crates/loop-core/src/run/worker.rs` — change both together or not at all.
 */
export type WorkerState = "starting" | "running" | "completed" | "lost" | "cancelled";

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
  failure?: {
    kind: ProviderFailureKind;
    retryable: boolean;
  };
}

export type ProviderEvent =
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  | { type: "lifecycle"; status: WorkerState }
  | { type: "session"; sessionId: string }
  | { type: "final"; summary: string };

export interface AgentProvider {
  readonly id: string;
  capabilities(): Promise<ProviderCapabilities>;
  start(input: StartWorkerInput): Promise<WorkerHandle>;
  resume?(sessionId: string, input: ResumeWorkerInput): Promise<WorkerHandle>;
  cancel(workerId: string): Promise<void>;
  release?(workerId: string): Promise<void>;
  status(workerId: string): Promise<WorkerState>;
  result(workerId: string): Promise<WorkerResult>;
  subscribe?(workerId: string, listener: (event: ProviderEvent) => void): () => void;
}
