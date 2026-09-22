import { compactLines, type OutputLimits, singleLine } from "@loop/presentation";

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

export function renderStatus(view: StatusView, limits: OutputLimits): string {
  const symbol = {
    done: "✓",
    working: "●",
    waiting: "○",
    failed: "!",
  } as const;
  const runLine = `Run ${view.runId}`;
  const workersLine = `Workers: ${view.workers} · Attention: ${view.attention}`;
  const stageLines = view.stages.map((stage) =>
    `${stage.name} ${stage.done}/${stage.total} ${symbol[stage.state]}`
  );
  if (limits.statusLineLimit < 3) {
    return compactLines([runLine, ...stageLines, workersLine], {
      lineLimit: limits.statusLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => `… ${omitted} more status lines`,
    }).join("\n");
  }
  const stageBudget = limits.statusLineLimit - 2;
  const stages = compactLines(
    stageLines,
    {
      lineLimit: stageBudget,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => `… ${omitted} more status lines`,
    },
  );
  return [
    singleLine(runLine, limits.lineTextLimit),
    ...stages,
    singleLine(workersLine, limits.lineTextLimit),
  ]
    .join("\n");
}
