export type HerdrExecution =
  | { type: "agent"; kind: "pi" | "codex" | "agy"; args: string[] }
  | { type: "command"; command: string; args: string[] };

export interface HerdrCaller {
  workspaceId: string;
  paneId: string;
}

export interface HerdrWorkerInput {
  projectRoot: string;
  runId: string;
  taskId: string;
  workerName?: string;
  worktree: string;
  caller?: HerdrCaller;
  execution: HerdrExecution;
  prompt: string;
  waitForPrompt?: boolean;
}

export interface HerdrWorkerHandle {
  workerId: string;
  workspaceId: string;
  paneId: string;
  taskId: string;
  agentName?: string;
}

export type HerdrWorkerState = "running" | "blocked" | "completed" | "failed" | "unknown";
