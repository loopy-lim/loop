export interface WorkerView {
  id: string;
  provider: string;
  model?: string;
  state: string;
}

export function renderWorkers(workers: WorkerView[]): string {
  return workers
    .slice(0, 8)
    .map((worker) =>
      [worker.id, worker.provider, worker.model, worker.state].filter(Boolean).join(" · ")
    )
    .join("\n");
}
