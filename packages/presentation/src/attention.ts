import type {
  AttentionKind,
  AttentionSnapshotOutput,
  SnapshotOutput,
} from "@loop/protocol";

import { compactLines, singleLine, type OutputLimits } from "./compact";
import { emptyState, moreItems, separator } from "./tokens";
import { formatElapsed } from "./working";

/**
 * Attention rendering for the presentation layer (`renderSnapshot` command
 * "attention"), rebuilt for the reliability-hardening intent: every open
 * attention surfaces kind/severity, the affected task and its unverified
 * goal criteria, a one-line cause, the evidence artifact path when the
 * summary carries one, and the resolutions valid for its kind.
 *
 * Composition happens entirely in the presentation layer from the existing
 * SnapshotOutput contract (kind, taskId, summary, goalCriteria) — the
 * generated protocol types are not widened for display.
 *
 * Typography discipline (design-foundations.md D1): lowercase field labels,
 * the shared `·` separator, a two-space indent for detail lines, and no
 * glyphs beyond the token vocabulary. Ids and paths are rendered verbatim —
 * never truncated, never re-quoted — because terminals render them in
 * monospace. The actionable cause line is flattened to one line but never
 * length-clipped: a long failure reason survives whole instead of vanishing
 * behind an ellipsis.
 */

export type AttentionSeverity = "high" | "medium" | "low";

/**
 * Deterministic presentation policy for how hard an attention tugs: errors
 * and competing writes (failure, conflict) are high; authority gates
 * (approval, decision) are medium; an open question is low. Kind itself
 * stays first in the identity line — severity refines, never replaces.
 */
export function attentionSeverity(kind: AttentionKind): AttentionSeverity {
  switch (kind) {
    case "failure":
    case "conflict":
      return "high";
    case "approval":
    case "decision":
      return "medium";
    case "question":
      return "low";
  }
}

/**
 * Resolution tokens valid for the kind, mirroring the bridge resolution
 * parser (`parse_resolution` in loop-bridge guidance.rs — the single
 * source the core acceptance rules enforce): failure answers with retry,
 * defer, cancel, add_task, or relax_routing; approval with approved or
 * rejected (never approve/reject, which the parser reads as free text and
 * the core refuses); and question, decision, and conflict with a
 * free-text answer. Every token advertised here is accepted there.
 */
export function attentionResolutions(kind: AttentionKind): string[] {
  switch (kind) {
    case "failure":
      return ["retry", "defer", "cancel", "add_task", "relax_routing"];
    case "approval":
      return ["approved", "rejected"];
    case "question":
    case "decision":
    case "conflict":
      return ["answer"];
  }
}

/**
 * Extract the evidence artifact path embedded in an attention summary, if
 * any. Orchestrator summaries carry check artifacts as
 * `Redacted output artifact saved: <abs path>`; the general form matches any
 * `<database>.artifacts/…` path so older summaries keep working.
 */
export function attentionEvidencePath(summary: string): string | undefined {
  const saved = summary.match(/Redacted output artifact saved: ([^\s]+)/);
  const candidate = saved?.[1] ?? summary.match(/\/[^\s`'"]*\.artifacts\/[^\s`'"]*/)?.[0];
  const path = candidate?.replace(/[.,;:)]+$/, "");
  return path || undefined;
}

/**
 * Goal-criterion ids owned by the affected task and not yet verified — the
 * work the operator's resolution unblocks. Verified criteria are no longer
 * affected; no taskId or no pending criteria yields an empty list.
 */
export function attentionCriteria(
  snapshot: SnapshotOutput,
  attention: AttentionSnapshotOutput,
): string[] {
  if (!attention.taskId) return [];
  return snapshot.goalCriteria
    .filter((criterion) => criterion.taskId === attention.taskId && criterion.state !== "verified")
    .map((criterion) => criterion.id);
}

/**
 * The attention's cause flattened to one line: newlines and collapsed
 * whitespace become single spaces. Deliberately not length-clipped — this is
 * the actionable line (see module doc). Undefined when the summary is empty.
 */
export function attentionCause(summary: string): string | undefined {
  const flattened = summary.replace(/\s+/g, " ").trim();
  return flattened.length > 0 ? flattened : undefined;
}

/** Age in milliseconds of a persisted instant (attention openedAtMs);
 * undefined when the record predates the field. Future instants clamp to 0 —
 * clock corrections are not staleness. */
function ageMs(instantMs: number | bigint | null | undefined, nowMs: number): number | undefined {
  if (instantMs === undefined || instantMs === null) return undefined;
  return Math.max(0, nowMs - Number(instantMs));
}

/** Everything the renderer needs for one attention: the full detail block
 * (identity, criteria, cause, evidence, resolutions), a one-line compact
 * form that still carries the untruncated cause and resolutions for
 * multi-attention budgets, and whether the open id resolved to a record at
 * all (unknown ids render bare, exactly as before). */
interface AttentionBlock {
  lines: string[];
  compactLine: string;
}

const DETAIL_INDENT = "  ";

function composeAttentionBlock(
  snapshot: SnapshotOutput,
  attention: AttentionSnapshotOutput,
  nowMs: number,
): AttentionBlock {
  const waited = ageMs(attention.openedAtMs, nowMs);
  const waitedLabel = waited === undefined ? undefined : `waited ${formatElapsed(waited)}`;
  const severity = attentionSeverity(attention.kind);
  const criteria = attentionCriteria(snapshot, attention);
  const cause = attentionCause(attention.summary);
  const evidence = attentionEvidencePath(attention.summary);
  const resolutions = attentionResolutions(attention.kind).join(" / ");
  return {
    lines: [
      [
        `${attention.kind} ${separator.list} ${severity} ${separator.list} ${attention.id}`,
        ...(attention.taskId ? [`task ${attention.taskId}`] : []),
        ...(waitedLabel ? [waitedLabel] : []),
      ].join(` ${separator.list} `),
      ...(criteria.length > 0 ? [`${DETAIL_INDENT}criteria: ${criteria.join(", ")}`] : []),
      ...(cause ? [`${DETAIL_INDENT}cause: ${cause}`] : []),
      ...(evidence ? [`${DETAIL_INDENT}evidence: ${evidence}`] : []),
      `${DETAIL_INDENT}resolutions: ${resolutions}`,
    ],
    compactLine: [
      `${attention.kind} ${attention.id}`,
      ...(attention.taskId ? [attention.taskId] : []),
      ...(waitedLabel ? [waitedLabel] : []),
      ...(cause ? [cause] : []),
      severity,
      `resolutions ${resolutions}`,
    ].join(` ${separator.list} `),
  };
}

function unknownBlock(id: string): AttentionBlock {
  return { lines: [id], compactLine: id };
}

export interface AttentionRenderOptions {
  /** Clock used to age open attention (openedAtMs); defaults to the render
   * time. Tests pass a fixed clock for deterministic output. */
  nowMs?: number;
}

/**
 * `Attention` view: the single open attention owns the whole detail block;
 * several open attentions each collapse to one compact line (cause still
 * whole) so the budget covers as many items as possible. With no details for
 * an open id the layout falls back to the bare-id list exactly as before. Line budget is
 * `attentionLineLimit`; the cause, id, and path lines are never clipped.
 */
export function renderAttention(
  snapshot: SnapshotOutput,
  limits: OutputLimits,
  options: AttentionRenderOptions = {},
): string {
  const openIds = snapshot.openAttentionIds;
  if (openIds.length === 0) return emptyState.attentionOk;
  const nowMs = options.nowMs ?? Date.now();
  const next = `Next: /loop resolve ${snapshot.runId} ${openIds[0]} <resolution>`;
  if (limits.attentionLineLimit <= 1) {
    return singleLine(next, limits.lineTextLimit);
  }
  const attentionById = new Map(snapshot.attention.map((item) => [item.id, item]));
  const blocks = openIds.map((id) => {
    const item = attentionById.get(id);
    return item ? composeAttentionBlock(snapshot, item, nowMs) : unknownBlock(id);
  });
  // Nothing known about any open attention: keep the legacy bare-id list,
  // which downstream surfaces (CLI) assert verbatim.
  if (openIds.every((id) => !attentionById.has(id))) {
    return renderLegacyAttention(openIds, next, limits);
  }
  // A single known attention owns the whole view: full block, no header,
  // so identity + criteria + cause + evidence + resolutions + next fits
  // the default six-line attention budget.
  if (blocks.length === 1) {
    return [...blocks[0]!.lines, next].join("\n");
  }
  return renderMultiAttention(openIds.length, blocks, next, limits);
}

/** Multi-attention layout: header, then one compact line per attention
 * (`kind id · task · waited · cause · severity · resolutions`, cause whole)
 * while at least one line remains for what follows; everything else collapses
 * to the overflow note. Uniform compact lines keep the layout predictable and
 * the next command preserved inside the six-line budget. */
function renderMultiAttention(
  openCount: number,
  blocks: AttentionBlock[],
  next: string,
  limits: OutputLimits,
): string {
  const budget = limits.attentionLineLimit - 2;
  if (budget <= 0) {
    return [
      singleLine(`Attention: ${openCount} open`, limits.lineTextLimit),
      singleLine(next, limits.lineTextLimit),
    ].join("\n");
  }
  const lines: string[] = [`Attention: ${openCount} open`];
  let remaining = budget;
  let omitted = 0;
  blocks.forEach((block, index) => {
    const isLast = index === blocks.length - 1;
    // More blocks may follow, so keep one line in reserve — either for the
    // next block's compact form or for the overflow note it will trigger.
    const reserve = isLast ? 0 : 1;
    if (remaining > reserve) {
      lines.push(block.compactLine);
      remaining -= 1;
    } else {
      // The block falls off the list; its overflow note consumes the line
      // the reserve was holding.
      omitted += 1;
      remaining -= 1;
    }
  });
  if (omitted > 0) {
    lines.push(singleLine(moreItems(omitted, "attention items"), limits.lineTextLimit));
  }
  lines.push(next);
  return lines.join("\n");
}

/** Legacy bare-id layout, byte-identical to the pre-enrichment renderer:
 * callers (CLI) pin its exact lines, and with no attention record there is
 * nothing to enrich anyway. */
function renderLegacyAttention(openIds: string[], next: string, limits: OutputLimits): string {
  const availableItems = Math.max(0, limits.attentionLineLimit - 2);
  const compacted = compactLines(openIds, {
    lineLimit: availableItems,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "attention items"),
  });
  return compactLines([`Attention: ${openIds.length} open`, ...compacted, next], {
    lineLimit: limits.attentionLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "attention lines"),
  }).join("\n");
}
