import type { ToolAnnotations } from "./types";

export type ApprovalDecision = "allow" | "ask";

/**
 * Codex-style approval classification from MCP tool annotations.
 *
 * Pure function: no pi API, no UI, no cache. Missing hints take the MCP
 * defaults — a tool is not read-only and may be destructive or reach an open
 * world — so unannotated tools always ask.
 *
 * - `destructiveHint === true` always asks, even alongside `readOnlyHint`.
 * - `readOnlyHint === true` (and not destructive) allows without asking.
 * - Otherwise ask unless the tool explicitly declares both
 *   `destructiveHint: false` and `openWorldHint: false`.
 */
export function classifyApproval(annotations?: ToolAnnotations): ApprovalDecision {
  if (annotations?.destructiveHint === true) return "ask";
  if (annotations?.readOnlyHint === true) return "allow";
  const destructive = annotations?.destructiveHint ?? true;
  const openWorld = annotations?.openWorldHint ?? true;
  return destructive || openWorld ? "ask" : "allow";
}

/** Human-readable trigger summary for the approval dialog title. */
export function describeApprovalTrigger(annotations?: ToolAnnotations): string {
  if (annotations?.destructiveHint === true) return "destructive";
  if (annotations?.readOnlyHint === true) return "unexpected read-only hint";
  if ((annotations?.destructiveHint ?? true) && (annotations?.openWorldHint ?? true))
    return "possibly destructive, open world";
  if (annotations?.destructiveHint ?? true) return "possibly destructive";
  return "open world";
}
