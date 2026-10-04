import {
  cleanupBullet,
  compactLines,
  emptyState,
  moreItems,
  renderSnapshot,
  separator,
  statusGlyph,
  type OutputLimits,
  type SnapshotRenderOptions,
} from "@loop/presentation";
import type { AgentComparisonReport, BenchmarkReport } from "@loop/orchestrator";
import type { SnapshotOutput } from "@loop/protocol";

export function formatSnapshot(
  command: string,
  snapshot: SnapshotOutput,
  limits: OutputLimits,
  options?: SnapshotRenderOptions,
): string {
  return (
    renderSnapshot(command, snapshot, limits, options).replace("Next: /loop", "Next: loop") + "\n"
  );
}

export function formatCleanupSnapshot(
  snapshot: import("@loop/protocol").CleanupRunOutput & { removedHerdrWorkspaces?: string[] },
  limits: OutputLimits,
  dryRun: boolean,
): string {
  const prefix = dryRun ? "[DRY RUN] " : "";
  const removedHerdrWorkspaces = snapshot.removedHerdrWorkspaces ?? [];
  const herdrRemoved = removedHerdrWorkspaces.length;
  const lines = [
    `${prefix}Cleanup Report`,
    `Removed: ${snapshot.removedArtifacts.length} artifacts` +
      (herdrRemoved ? `, ${herdrRemoved} leaked workspaces` : ""),
    `Skipped: ${snapshot.skippedArtifacts.length}`,
  ];
  if (herdrRemoved > 0) {
    lines.push(...removedHerdrWorkspaces.map((w) => `${cleanupBullet} Workspace ${w} (leaked)`));
  }
  if (snapshot.removedArtifacts.length > 0) {
    lines.push(...snapshot.removedArtifacts.map((a) => `${cleanupBullet} ${a}`));
  }
  if (snapshot.skippedArtifacts.length > 0) {
    lines.push(
      ...snapshot.skippedArtifacts.map((a) => `${statusGlyph.warning} ${a.artifact} (${a.reason})`),
    );
  }

  return `${compactLines(lines, {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "lines"),
  }).join("\n")}\n`;
}

export function formatBenchmarkReport(report: BenchmarkReport, limits: OutputLimits): string {
  const { benchmark } = report;
  const lines = [
    `Benchmark: ${benchmark.name}`,
    `Intent: ${benchmark.intent}`,
    `Profiles: ${benchmark.profiles.join(", ")} ${separator.list} ${benchmark.iterations} iteration(s) each`,
  ];
  for (const run of report.runs) {
    const created = run.summary.tasks_created ?? 0;
    const completed = run.summary.tasks_completed ?? 0;
    const attempts =
      (run.summary.verification_passes ?? 0) + (run.summary.verification_failures ?? 0);
    lines.push(
      `${run.status === "completed" ? statusGlyph.success : statusGlyph.warning} ${run.profile} iter ${run.iteration} ${separator.list} ${run.runId}` +
        ` ${separator.list} ${run.status} ${separator.list} tasks ${completed}/${created} ${separator.list} attempts ${attempts}` +
        ` ${separator.list} retries ${run.summary.verification_failures ?? 0} ${separator.list} attention ${run.summary.attention_created ?? 0}`,
    );
  }
  lines.push("Ranking (total score, highest first)");
  report.comparison.rankings.forEach((ranking, index) => {
    const total = ranking.score.reliability + ranking.score.autonomy + ranking.score.first_pass;
    lines.push(
      `${index + 1}. ${ranking.label} ${separator.list} total ${total}` +
        ` (reliability ${ranking.score.reliability} ${separator.list} autonomy ${ranking.score.autonomy} ${separator.list} first-pass ${ranking.score.first_pass})`,
    );
  });
  return `${compactLines(lines, {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "report lines", "use --json for the full report"),
  }).join("\n")}\n`;
}

export function formatAgentComparison(report: AgentComparisonReport, limits: OutputLimits): string {
  const ranked = [...report.rows].sort(
    (a, b) =>
      b.verifiedCriteria - a.verifiedCriteria ||
      a.scopeViolations.length - b.scopeViolations.length ||
      (a.summary.verification_failures ?? 0) - (b.summary.verification_failures ?? 0) ||
      a.elapsedMs - b.elapsedMs ||
      a.providerId.localeCompare(b.providerId),
  );
  const lines = [
    `Agent comparison: ${report.name}`,
    `Source commit: ${report.sourceCommit.slice(0, 12)}`,
    `Trials: ${report.rows.length} ${separator.list} actual cost unmeasured`,
    ...ranked.map(
      (row, index) =>
        `${index + 1}. ${row.providerId} iter ${row.iteration} ${separator.list} ${row.status} ${separator.list} criteria ${row.verifiedCriteria}/${row.totalCriteria} ${separator.list} scope ${row.scopeViolations.length} ${separator.list} retries ${row.summary.verification_failures ?? 0} ${separator.list} ${row.elapsedMs}ms`,
    ),
  ];
  return `${compactLines(lines, {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "trials", "use --json for the full report"),
  }).join("\n")}\n`;
}

export function formatModelList(
  models: Array<{ computeClass: string; id: string }>,
  limits: OutputLimits,
): string {
  if (models.length === 0) return `${emptyState.noModels}\n`;
  return `${compactLines(
    models.map((model) => `${model.computeClass} ${separator.list} ${model.id}`),
    {
      lineLimit: limits.listLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => moreItems(omitted, "models"),
    },
  ).join("\n")}\n`;
}

export function formatDoctorChecks(
  checks: Array<{ name: string; ok: boolean; detail: string; auth?: string }>,
  limits: OutputLimits,
): string {
  const ordered = [...checks].sort((left, right) => Number(left.ok) - Number(right.ok));
  const failed = checks.filter((check) => !check.ok).length;
  const passed = checks.length - failed;
  const lines = [
    "Loop doctor",
    ...ordered.map((check) => {
      const auth = check.auth ? `; auth ${check.auth}` : "";
      return `${check.ok ? statusGlyph.success : statusGlyph.warning} ${check.name}: ${check.detail}${auth}`;
    }),
  ];
  return `${compactLines(lines, {
    lineLimit: limits.listLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "checks", `${failed} failed, ${passed} passed`),
  }).join("\n")}\n`;
}
