import { compactLines, type OutputLimits } from "@loop/presentation";

export interface WorkerView {
  id: string;
  provider: string;
  model?: string;
  state: string;
}

export function renderWorkers(workers: WorkerView[], limits: OutputLimits): string {
  if (workers.length === 0) return "No active workers";
  const seen = new Set<string>();
  const unique = workers.filter(worker => {
    if (seen.has(worker.id)) return false;
    seen.add(worker.id);
    return true;
  });
  return compactLines(
    unique.map((worker) =>
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
