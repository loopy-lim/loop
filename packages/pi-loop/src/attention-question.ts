import type {
  AttentionKind,
  AttentionSnapshotOutput,
  ComputeCapabilities,
  ComputeClass,
  Risk,
  TaskSpecInput,
} from "@loop/protocol";

import { compactLines, singleLine, type OutputLimits } from "@loop/presentation";

/**
 * The answerable-question vocabulary per attention kind: every attention is
 * rendered as a question that names the decision to make and the exact
 * options that can resolve it. The failure rows mirror the bridge
 * resolution parser (`retry | defer | cancel | add_task | relax_routing`)
 * so an option advertised here is always accepted there.
 */
function answerableOptions(kind: AttentionKind): string[] {
  switch (kind) {
    case "question":
    case "decision":
      return ["answer in this conversation with your decision"];
    case "conflict":
      return ["answer in this conversation with the resolution to enforce"];
    case "approval":
      return ["loop_resolve approved · loop_resolve rejected <reason>"];
    case "failure":
      return [
        "loop_resolve retry · defer · cancel · relax_routing (steps one routing constraint down and re-dispatches)",
        "loop_resolve add_task with correctiveTask { id, title, writeScope, requirements, completionChecks }",
      ];
  }
}

const routingConstraintFailureMark = "no eligible compute candidate";

/**
 * True when a failure summary reports the batch-absence dead end: no
 * compute candidate satisfied the task's routing constraints. That dead
 * end is only answerable when the user can see which constraint blocked
 * it, so the renderer pairs it with `describeBlockedConstraints`.
 */
export function isRoutingConstraintFailure(
  summary: string | undefined,
): boolean {
  return (summary ?? "").includes(routingConstraintFailureMark);
}

/**
 * Names the routing constraints a batch-absence failure ran into — the
 * required capability levels (nonzero only), the risk ceiling, and the
 * compute-class window — so the user can decide which one to relax with
 * `relax_routing` (or bypass with `add_task`). Reads the failed task's
 * spec, not the attention record: the summary alone carries no
 * constraints.
 */
export function describeBlockedConstraints(spec: TaskSpecInput): string {
  const required: ComputeCapabilities =
    spec.routing?.required ??
    ({ coding: 0, reasoning: 0, tools: 0, vision: 0, long_context: 0 } as ComputeCapabilities);
  const levels = Object.entries(required)
    .filter(([, level]) => level > 0)
    .map(([name, level]) => `${name}=${level}`)
    .join(" ");
  const risk: Risk | undefined = spec.routing?.risk;
  // Never length-clipped: the line is bounded by construction (five
  // capability levels, one risk, two compute classes) and is the
  // actionable evidence the user relaxes against.
  return [
      levels ? `requires ${levels}` : `requires ${spec.requirements.join(" ") || "no capability level"}`,
      ...(risk ? [`risk ${risk}`] : []),
      `compute ${spec.minimumCompute as ComputeClass}..${spec.maximumCompute as ComputeClass}`,
    ].join(" · ");
}

/**
 * Renders one attention item as an answerable question: the explanation
 * (the recorded summary) plus the options that resolve it. Every kind gets
 * both, so a Lead can always answer without consulting a second source.
 * `blockedConstraints` (see `describeBlockedConstraints`) adds the
 * constraint line for a batch-absence failure.
 */
export function renderAttentionQuestion(
  detail: AttentionSnapshotOutput | undefined,
  limits: OutputLimits,
  blockedConstraints?: string,
): string {
  const kind: AttentionKind = detail?.kind ?? "decision";
  const explanation = singleLine(
    detail?.summary?.trim() || "Decision needed",
    limits.lineTextLimit,
  );
  return compactLines(
    [
      `Loop attention ${detail?.id ?? "?"} (${kind})`,
      `Decision needed: ${explanation}`,
      ...(blockedConstraints
        ? [`Blocked constraints — ${blockedConstraints}`]
        : []),
      ...answerableOptions(kind).map(
        (options) => `Answerable options — ${options}`,
      ),
    ],
    {
      lineLimit: limits.attentionLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => `… ${omitted} more`,
    },
  ).join("\n");
}
