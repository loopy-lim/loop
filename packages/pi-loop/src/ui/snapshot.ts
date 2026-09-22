import { compactLines, type OutputLimits } from "@loop/presentation";
import type { SnapshotOutput } from "@loop/protocol";

export function renderSnapshot(
  command: string,
  snapshot: SnapshotOutput,
  limits: OutputLimits,
): string {
  if (command === "graph") {
    if (snapshot.tasks.length === 0) return "No tasks";
    return compactLines(snapshot.tasks.map((task) => `${task.id} · ${task.state}`), {
      lineLimit: limits.listLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => `… ${omitted} more tasks`,
    }).join("\n");
  }
  if (command === "workers") {
    if (snapshot.activeWorkers.length === 0) return "No active workers";
    return compactLines(
      snapshot.activeWorkers.map((worker) => `${worker.id} · ${worker.taskId}`),
      {
        lineLimit: limits.listLineLimit,
        lineTextLimit: limits.lineTextLimit,
        overflow: (omitted) => `… ${omitted} more workers`,
      },
    ).join("\n");
  }
  if (command === "attention") {
    if (snapshot.openAttentionIds.length === 0) return "OK";
    return compactLines(
      [`Attention: ${snapshot.openAttentionIds.length} open`, ...snapshot.openAttentionIds],
      {
        lineLimit: limits.attentionLineLimit,
        lineTextLimit: limits.lineTextLimit,
        overflow: (omitted) => `… ${omitted} more attention items`,
      },
    ).join("\n");
  }
  const done = snapshot.tasks.filter((task) => task.state === "done").length;
  return compactLines([
    `Run ${snapshot.runId}`,
    `State: ${snapshot.state}`,
    `Tasks: ${done}/${snapshot.tasks.length}`,
    `Workers: ${snapshot.activeWorkers.length}`,
    `Attention: ${snapshot.openAttentionIds.length}`,
  ], {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more status lines`,
  }).join("\n");
}
