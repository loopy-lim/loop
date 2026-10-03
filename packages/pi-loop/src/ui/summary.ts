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
  const [first] = view.escalations;
  if (first !== undefined) {
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
  const completed = summary.status === "completed";
  const lines = completed
    ? [
        `Run ${runId}`,
        `State: ${summary.status}`,
        "Goal: complete",
        `Tasks: ${summary.tasks}`,
        `Escalations: ${summary.escalations.length}`,
        "Verification: passed",
      ]
    : [
        `Run ${runId}`,
        `State: ${summary.status}`,
        "Goal: incomplete",
        `Tasks: ${summary.tasks}`,
        "Remaining: original acceptance criteria are not fully verified.",
        continuationLine(runId, summary.status),
      ];
  return compactLines(lines, {
    lineLimit: completed ? limits.statusLineLimit : limits.attentionLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more status lines`,
  }).join("\n");
}

function continuationLine(runId: string, status: RunSummary["status"]): string {
  if (status === "attention") {
    return `Next: /loop attention ${runId}; resolve reported items; /loop resume ${runId}`;
  }
  if (status === "paused") return `Next: /loop resume ${runId}`;
  return "Next: submit a follow-up request carrying the unresolved acceptance criteria.";
}
