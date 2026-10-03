import type { SnapshotOutput } from "@loop/protocol";

export type RunHealthFinding =
  | "owner_missing_ready"
  | "owner_lost_in_flight"
  | "active_graph_stalled";

/** Read-only owner check. An expired lease never proves that a worker stopped. */
export function classifyRunHealth(
  snapshot: SnapshotOutput,
  nowMs = Date.now(),
): RunHealthFinding | null {
  if (snapshot.state !== "active" || snapshot.openAttentionIds.length > 0) return null;
  if (snapshot.executionExpiresAt != null && Number(snapshot.executionExpiresAt) > nowMs)
    return null;
  if (
    snapshot.activeWorkers.length > 0 ||
    snapshot.tasks.some((task) => task.state === "running" || task.state === "verifying")
  ) {
    return "owner_lost_in_flight";
  }
  const done = new Set(
    snapshot.tasks.filter((task) => task.state === "done").map((task) => task.id),
  );
  if (
    snapshot.tasks.some(
      (task) =>
        task.state === "ready" ||
        (task.state === "pending" &&
          task.blockedBy.length === 0 &&
          task.dependencies.every((id) => done.has(id))),
    )
  )
    return "owner_missing_ready";
  return snapshot.tasks.length > 0 ? "active_graph_stalled" : null;
}
