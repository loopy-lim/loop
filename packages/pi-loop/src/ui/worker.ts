import { compactLines, type OutputLimits } from "@loop/presentation";

export interface WorkerView {
  id: string;
  provider: string;
  model?: string;
  state: string;
}

export function renderWorkers(workers: WorkerView[], limits: OutputLimits): string {
  if (workers.length === 0) return "No active workers";
  return compactLines(
    workers.map((worker) =>
      [worker.id, worker.provider, worker.model, worker.state].filter(Boolean).join(" · ")
    ),
    {
      lineLimit: limits.listLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => `… ${omitted} more workers`,
    },
  )
    .join("\n");
}
