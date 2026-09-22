import { compactLines, type OutputLimits } from "@loop/presentation";

export function renderModels(models: string[], limits: OutputLimits): string {
  if (models.length === 0) return "No models configured";
  return compactLines(models, {
    lineLimit: limits.listLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more models`,
  }).join("\n");
}
