export interface StageStatus {
  name: string;
  done: number;
  total: number;
  state: "done" | "working" | "waiting" | "failed";
}

export interface StatusView {
  runId: string;
  stages: StageStatus[];
  workers: number;
  attention: number;
}

export function renderStatus(view: StatusView): string {
  const symbol = {
    done: "✓",
    working: "●",
    waiting: "○",
    failed: "!",
  } as const;
  const stages = view.stages
    .slice(0, 6)
    .map((stage) => `${stage.name} ${stage.done}/${stage.total} ${symbol[stage.state]}`);
  return [
    `Run ${view.runId}`,
    ...stages,
    `Workers: ${view.workers} · Attention: ${view.attention}`,
  ]
    .slice(0, 8)
    .join("\n");
}
