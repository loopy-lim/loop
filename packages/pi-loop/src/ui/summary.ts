import type { RunSummary } from "@loop/orchestrator";
import { compactLines, type OutputLimits } from "@loop/presentation";

export interface RunSummaryView {
  tasks: number;
  implementationBranches: number;
  checksPassed: boolean;
  escalations: Array<{ taskId: string; from: string; to: string }>;
  changedFiles?: number;
}

export function renderRunSummary(view: RunSummaryView, limits: OutputLimits): string {
  const lines = [
    "Done",
    "",
    `✓ ${view.tasks} tasks`,
    `✓ ${view.implementationBranches} parallel implementation branches`,
    view.checksPassed ? "✓ checks passed" : "! checks need attention",
  ];
  if (view.escalations.length > 0) {
    const first = view.escalations[0];
    lines.push(
      `↗ ${view.escalations.length} task${view.escalations.length === 1 ? "" : "s"} escalated from ${first.from} → ${first.to}`,
    );
  }
  if (view.changedFiles !== undefined) lines.push(`Changed: ${view.changedFiles} files`);
  return compactLines(lines, {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more status lines`,
  }).join("\n");
}

export function renderLoopRunSummary(
  runId: string,
  summary: RunSummary,
  limits: OutputLimits,
): string {
  return compactLines([
    `Run ${runId}`,
    `State: ${summary.status}`,
    `Tasks: ${summary.tasks}`,
    `Escalations: ${summary.escalations.length}`,
    summary.status === "completed" ? "Verification: passed" : "Verification: attention required",
  ], {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more status lines`,
  }).join("\n");
}
