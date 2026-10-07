import type { OperationOutput, TaskRouting } from "@loop/protocol";

/**
 * Dispatcher-side auto-relax policy for routing failures
 * (`docs/decisions/2026-xx-attention-agent-auto-resolution`).
 *
 * When no eligible compute candidate satisfies a task's declared routing
 * constraints, the dispatcher must try the core-owned relaxation ladder
 * before parking the run on a human. The core owns every decision the
 * ladder needs: each `relax_routing` resolution grants exactly one
 * downgrade-only step (`TaskRouting::relax_step`), records it as durable
 * `TaskRoutingUpdated` evidence, and re-dispatches; a spent ladder is
 * refused with `relaxation_exhausted`. This module carries only what the
 * ADR assigns to the orchestrator: the attempt budget, the per-task audit
 * of granted steps, and the exhaustion summary the standing attention is
 * enriched with. The ladder order never crosses the seam, so no Rust
 * domain policy is mirrored here.
 */

/**
 * Auto-relax attempt budget per task, per dispatch loop. Core's deepest
 * realistic ladder — every capability declared at 2 plus the three risk
 * steps — is 13 grants (`relax_ladder` test in loop-core), so 16 walks any
 * sane contract to its spent-ladder verdict. A declared contract deep
 * enough to outlive the budget is an anomaly that should park on a human
 * with the recorded history instead of degrading forever.
 */
export const MAX_AUTO_RELAX_STEPS = 16;

/** Bridge error code the router refuses with when no candidate qualifies. */
const ROUTING_FAILURE_CODE = "no_sufficient_candidate";

/** Bridge error code core refuses `relax_routing` with when the ladder is spent. */
const RELAXATION_EXHAUSTED_CODE = "relaxation_exhausted";

function bridgeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** True when a dispatch-time selection failure is a routing shortfall. */
export function isRoutingFailure(error: unknown): boolean {
  return bridgeErrorCode(error) === ROUTING_FAILURE_CODE;
}

/** True when core refused a `relax_routing` resolution because the ladder is spent. */
export function isRelaxationExhausted(error: unknown): boolean {
  return bridgeErrorCode(error) === RELAXATION_EXHAUSTED_CODE;
}

/** One granted ladder step and the receipt summary that carried it. */
export interface RelaxGrant {
  /** Durable step evidence, e.g. `tools 1→0` (mirror of the `TaskRoutingUpdated` event). */
  step: string;
  /** The resolve receipt summary, e.g. `relaxed tools 1→0 on task a; re-dispatched`. */
  receipt: string;
}

/**
 * Per-task audit of granted auto-relax steps for one dispatch loop. The
 * durable record lives in the event log; this ledger only bounds the
 * dispatcher's own attempts and feeds the exhaustion summary.
 */
export class RoutingRelaxLedger {
  readonly #grants = new Map<string, RelaxGrant[]>();

  grants(taskId: string): readonly RelaxGrant[] {
    return this.#grants.get(taskId) ?? [];
  }

  count(taskId: string): number {
    return this.grants(taskId).length;
  }

  budgetLeft(taskId: string): boolean {
    return this.count(taskId) < MAX_AUTO_RELAX_STEPS;
  }

  record(taskId: string, grant: RelaxGrant): void {
    const history = this.#grants.get(taskId) ?? [];
    history.push(grant);
    this.#grants.set(taskId, history);
  }

  /** Routing succeeded after relief; the ledger's job for this task is done. */
  clear(taskId: string): void {
    this.#grants.delete(taskId);
  }
}

/** Human-readable surviving constraint floor, aligned with the route reason format. */
export function describeRoutingConstraints(routing: TaskRouting | null | undefined): string {
  if (!routing) return "no declared routing constraints";
  const { risk, required } = routing;
  return `risk ${risk}; required coding ${required.coding}, reasoning ${required.reasoning}, tools ${required.tools}, vision ${required.vision}, context ${required.long_context}`;
}

/**
 * Builds the exhaustion attention summary: the consumed relaxation history
 * and the options that remain. Required by the auto-relax contract — an
 * attention may only stand here after the ladder (or the budget) is spent,
 * and it must carry what was tried and what a resolver can still do.
 */
export function routingExhaustionSummary(input: {
  taskId: string;
  grants: readonly RelaxGrant[];
  routing: TaskRouting | null | undefined;
  limitHit: boolean;
}): string {
  const history = input.grants.length
    ? input.grants.map((grant) => grant.step).join(", ")
    : "no step was granted in this dispatch";
  const verdict = input.limitHit
    ? `Auto-relax budget (${MAX_AUTO_RELAX_STEPS}) spent for task ${input.taskId} after ${input.grants.length} step(s): ${history}.`
    : `Routing ladder exhausted for task ${input.taskId} after ${input.grants.length} step(s): ${history}.`;
  return [
    verdict,
    `Surviving constraints: ${describeRoutingConstraints(input.routing)}.`,
    "No eligible compute candidate satisfies them.",
    "Remaining options: restore an eligible compute candidate (availability or eligibility), lower the task's declared compute range or capability requirements, or resolve this attention with retry, defer, or cancel.",
  ].join(" ");
}

/** Extracts the granted step from a successful `relax_routing` receipt. */
export function grantedRelaxStep(receipt: OperationOutput): RelaxGrant {
  const step = receipt.routingRelaxations?.[0] ?? "relaxation granted";
  return { step, receipt: receipt.summary ?? step };
}
