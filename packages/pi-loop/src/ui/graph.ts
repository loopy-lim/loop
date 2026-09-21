import type { TaskSpecInput } from "@loop/protocol";

export function renderGraph(tasks: TaskSpecInput[]): string {
  return tasks
    .map((task) =>
      task.dependencies.length === 0
        ? task.id
        : `${task.dependencies.join(" + ")} → ${task.id}`
    )
    .join("\n");
}
