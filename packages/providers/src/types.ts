import type { TaskContextOutput } from "@loop/protocol";

export type WorkerStatus = "starting" | "running" | "completed" | "failed" | "cancelled";

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
  computeClasses: string[];
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
  computeClass: string;
  attempt: number;
  requirements: string[];
  workingDirectory?: string;
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
  | { type: "lifecycle"; status: WorkerStatus }
  | { type: "session"; sessionId: string }
  | { type: "final"; summary: string };

export interface AgentProvider {
  readonly id: string;
  capabilities(): Promise<ProviderCapabilities>;
  start(input: StartWorkerInput): Promise<WorkerHandle>;
  resume?(sessionId: string, input: ResumeWorkerInput): Promise<WorkerHandle>;
  cancel(workerId: string): Promise<void>;
  release?(workerId: string): Promise<void>;
  status(workerId: string): Promise<WorkerStatus>;
  result(workerId: string): Promise<WorkerResult>;
  subscribe?(workerId: string, listener: (event: ProviderEvent) => void): () => void;
}
