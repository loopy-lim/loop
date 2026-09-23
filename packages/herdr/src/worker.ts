export type HerdrExecution =
  | { type: "agent"; kind: "pi" | "codex" | "agy"; args: string[] }
  | { type: "command"; command: string; args: string[] };

export interface HerdrCaller {
  workspaceId: string;
  paneId: string;
}

/**
 * Display-label ingredients, orthogonal to `workerName`: the worker identity
 * (agent session resume id) keeps the stable `workerName` form while tabs and
 * panes show the human-readable `<taskId>·<kind>·a<attempt>` rule.
 */
export interface HerdrWorkerLabel {
  kind: string;
  attempt: number;
}

export interface HerdrWorkerInput {
  projectRoot: string;
  runId: string;
  taskId: string;
  workerName?: string;
  label?: HerdrWorkerLabel;
  worktree: string;
  caller?: HerdrCaller;
  execution: HerdrExecution;
  prompt: string;
  waitForPrompt?: boolean;
}

export interface HerdrWorkerHandle {
  workerId: string;
  workspaceId: string;
  tabId: string;
  paneId: string;
  taskId: string;
  agentName?: string;
}

export type HerdrWorkerState = "idle" | "running" | "blocked" | "completed" | "failed" | "unknown";
