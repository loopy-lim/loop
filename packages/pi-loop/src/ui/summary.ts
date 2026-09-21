export interface RunSummaryView {
  tasks: number;
  implementationBranches: number;
  checksPassed: boolean;
  escalations: Array<{ taskId: string; from: string; to: string }>;
  changedFiles?: number;
}

export function renderRunSummary(view: RunSummaryView): string {
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
  return lines.slice(0, 8).join("\n");
}
