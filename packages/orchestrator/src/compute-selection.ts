import type { TaskSpecInput } from "@loop/protocol";

/**
 * Provider-selection bias over a task's declared compute range
 * (task dispatch-scaling, 2026-xx).
 *
 * - "cheapest" (default): the deterministic Rust router
 *   (`policy::routing::select_candidate`) picks the least costly sufficient
 *   class inside `[preferredCompute, maximumCompute]` — the historical and
 *   configured behavior.
 * - "strongest": the task is routed at the CEILING of its own declared range
 *   (`preferredCompute := maximumCompute`), so providers run the strongest
 *   configured compute class — maximum reasoning tokens — whenever the task
 *   allows one. The declared range is never widened, and the Rust risk floor
 *   still applies inside the unchanged core decision; a task that already
 *   caps `maximumCompute` at its `preferredCompute` is unaffected.
 *
 * Degrade rule: when no available candidate satisfies the ceiling, callers
 * fall back to the task's declared floor instead of failing the run — the
 * bias spends more compute when possible and never makes routing stricter
 * than the configured default.
 */
export type ComputeSelection = "cheapest" | "strongest";

export const DEFAULT_COMPUTE_SELECTION: ComputeSelection = "cheapest";

/**
 * Returns the task spec handed to `ProviderRegistry.selectForTask`.
 * "cheapest" (and a task whose range already collapses to one class)
 * returns the SAME reference — callers can use identity to detect that no
 * ceiling attempt is needed.
 */
export function selectionTaskFor(task: TaskSpecInput, selection: ComputeSelection): TaskSpecInput {
  if (selection !== "strongest" || task.maximumCompute === task.preferredCompute) return task;
  return { ...task, preferredCompute: task.maximumCompute };
}
