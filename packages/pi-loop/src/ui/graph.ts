import type { TaskSpecInput } from "@loop/protocol";
import { compactLines, type OutputLimits } from "@loop/presentation";

export function renderGraph(tasks: TaskSpecInput[], limits: OutputLimits): string {
  return compactLines(
    tasks.map((task) =>
      task.dependencies.length === 0
        ? task.id
        : `${task.dependencies.join(" + ")} → ${task.id}`
    ),
    {
      lineLimit: limits.listLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => `… ${omitted} more tasks`,
    },
  )
    .join("\n");
}
