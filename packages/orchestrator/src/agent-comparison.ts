import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { GoalCriterionInput, TaskSpecInput, TraceScore, TraceSummary } from "@loop/protocol";
import type { ProviderRegistry } from "@loop/providers";
import type { BenchmarkControl } from "./benchmark";
import { Orchestrator, type RunSummary } from "./coordinator";

export interface AgentComparisonRequest {
  control: BenchmarkControl;
  providers: ProviderRegistry | ((workspace: string) => ProviderRegistry);
  databasePath: string;
  sourceDirectory: string;
  workspaceRoot: string;
  name: string;
  intent: string;
  tasks: TaskSpecInput[];
  criteria: GoalCriterionInput[];
  candidateIds: string[];
  iterations: number;
}

export interface AgentComparisonRow {
  runId: string;
  providerId: string;
  iteration: number;
  sourceCommit: string;
  workspace: string;
  status: RunSummary["status"];
  verifiedCriteria: number;
  totalCriteria: number;
  scopeViolations: string[];
  elapsedMs: number;
  summary: TraceSummary;
  score: TraceScore;
}

export interface AgentComparisonReport {
  name: string;
  sourceCommit: string;
  rows: AgentComparisonRow[];
  /** Actual provider billing is not exposed by this runtime. */
  costMeasured: false;
}

/** Compare providers on the same committed source and identical goal contract. */
export async function runAgentComparison(request: AgentComparisonRequest): Promise<AgentComparisonReport> {
  if (!request.name.trim() || !request.intent.trim() || request.tasks.length === 0 || request.criteria.length === 0) throw new Error("comparison needs a name, intent, tasks, and explicit criteria");
  if (!Number.isInteger(request.iterations) || request.iterations < 1 || request.iterations > 20) throw new Error("comparison iterations must be between 1 and 20");
  if (request.candidateIds.length < 2 || new Set(request.candidateIds).size !== request.candidateIds.length) throw new Error("comparison needs at least two distinct provider IDs");
  const source = realpathSync(request.sourceDirectory);
  const root = realpathSync(request.workspaceRoot);
  if (root === source || root.startsWith(`${source}${sep}`)) throw new Error("comparison workspaces must be outside the source repository");
  const top = git(source, "rev-parse", "--show-toplevel");
  if (realpathSync(top) !== source) throw new Error("comparison source must be the Git repository root");
  if (git(source, "status", "--porcelain")) throw new Error("comparison source must be clean so every provider sees one committed state");
  const sourceCommit = git(source, "rev-parse", "HEAD");
  const rows: AgentComparisonRow[] = [];
  for (let iteration = 1; iteration <= request.iterations; iteration++) {
    for (const providerId of request.candidateIds) {
      const trial = mkdtempSync(join(root, "trial-"));
      const workspace = join(trial, "repo");
      command("git", ["clone", "--quiet", "--no-hardlinks", source, workspace]);
      git(workspace, "checkout", "--quiet", "--detach", sourceCommit);
      const provider = (typeof request.providers === "function" ? request.providers(workspace) : request.providers).only(providerId);
      const runId = `agent-${request.name.replace(/[^a-zA-Z0-9._-]/g, "-")}-${iteration}-${randomUUID().slice(0, 8)}`;
      const orchestrator = new Orchestrator({ control: request.control, providers: provider, maxWorkers: 1 });
      const started = Date.now();
      const result = await orchestrator.run({
        databasePath: resolve(request.databasePath), runId, intent: request.intent,
        workingDirectory: workspace, tasks: request.tasks, criteria: request.criteria,
      });
      const elapsedMs = Date.now() - started;
      const snapshot = await request.control.getSnapshot({ databasePath: request.databasePath, runId });
      const trace = await request.control.getTrace({ databasePath: request.databasePath, runId });
      const scopeViolations = new Set<string>();
      for (const task of request.tasks) {
        const context = await request.control.getTaskContext({ databasePath: request.databasePath, runId, taskId: task.id });
        for (const check of context.previousChecks) for (const path of check.source?.observedOutsideWriteScope ?? []) scopeViolations.add(path);
      }
      rows.push({ runId, providerId, iteration, sourceCommit, workspace, status: result.status,
        verifiedCriteria: snapshot.goalCriteria.filter(item => item.state === "verified").length,
        totalCriteria: snapshot.goalCriteria.length, scopeViolations: [...scopeViolations].sort(), elapsedMs,
        summary: trace.summary, score: trace.score });
    }
  }
  return { name: request.name, sourceCommit, rows, costMeasured: false };
}

function git(directory: string, ...args: string[]): string {
  return command("git", ["-C", directory, ...args]);
}

function command(executable: string, args: string[]): string {
  const result = spawnSync(executable, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${executable} command failed: ${result.stderr.trim().slice(0, 300)}`);
  return result.stdout.trim();
}
