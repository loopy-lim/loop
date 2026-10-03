import type { ContextSummaryReason, RustraEventPayloads, TaskContextOutput } from "@loop/protocol";

/**
 * G1 — 컨텍스트 수명 관리 (docs/research/loop-gap-analysis.md §3.1).
 *
 * Boundary: summarization lives in the orchestrator because folding advisory
 * context may involve a compute call, which must never enter `loop-core`.
 * The policy below is deterministic (bounded-head folding); a provider-backed
 * summarizer can later replace the fold step without moving the boundary.
 *
 * Preservation invariant: the completion contract (`task`: requirements,
 * completion checks, scopes), guidance, failure evidence (`previousFailure`
 * and every failed or timed-out check receipt, verbatim), dependency/decision
 * result records, and the decomposition contract are NEVER folded. Only
 * advisory history — passed-check output bodies and the previous attempt's
 * result summary (retry history) — is folded, and only when the advisory set
 * exceeds the configured byte budget. When the preserved set alone exceeds
 * the budget, the preserved set still passes through untouched: the budget
 * is advisory-first and never overrides the invariant.
 */
export interface ContextLifecyclePolicy {
  /**
   * Fold fires when the advisory set exceeds this UTF-8 byte budget.
   * 0 disables automatic summarization entirely (context passes unchanged).
   */
  advisoryByteBudget: number;
  /** Preserved head size per folded advisory entry, in UTF-8 bytes. */
  summaryEntryBytes: number;
  /** Cap on the folded summary text, in UTF-8 bytes. */
  summaryByteCap: number;
}

export const DEFAULT_CONTEXT_LIFECYCLE_POLICY: ContextLifecyclePolicy = {
  advisoryByteBudget: 24_000,
  summaryEntryBytes: 400,
  summaryByteCap: 4_000,
};

/**
 * One summarization observation, shaped so callers can attach run/task
 * identity and publish it verbatim as the `loop.context_summary` wire event
 * (bridge codegen, G1). The event carries only counts and the folded summary
 * text — never the dropped content.
 */
export interface ContextFold {
  reason: ContextSummaryReason;
  /** Advisory entries folded into the summary (passed-check bodies, retry history). */
  summarizedEntryCount: number;
  /** Entries passed through untouched (receipts kept, guidance, dependency results). */
  preservedEntryCount: number;
  /** Bounded summary text that replaced the folded advisory bodies. */
  summary: string;
  /** True when `summary` exceeded the byte cap and was cut. */
  truncated: boolean;
  /** Advisory context bytes before and after the fold. */
  advisoryBytesBefore: number;
  advisoryBytesAfter: number;
  /** UTC RFC 3339 timestamp of the summarization. */
  occurredAt: string;
}

const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/** UTF-8-bounded head of `text`; never splits a multi-byte sequence. */
export function byteHead(text: string, limit: number): string {
  if (limit <= 0) return "";
  if (byteLength(text) <= limit) return text;
  let head = "";
  for (const char of text) {
    if (byteLength(head) + byteLength(char) > limit) break;
    head += char;
  }
  return head;
}

/** A receipt is failure evidence (preserved verbatim) iff it did not pass. */
function isFailureEvidence(receipt: TaskContextOutput["previousChecks"][number]): boolean {
  return receipt.exitCode !== 0 || receipt.timedOut;
}

/** Advisory (foldable) context size in UTF-8 bytes: passed-check output
 * bodies plus the previous attempt's result summary. Preservation-invariant
 * content is never measured here — the budget must never pressure the
 * preserved set.
 */
export function measureAdvisoryContext(context: TaskContextOutput): number {
  let total = 0;
  for (const receipt of context.previousChecks) {
    if (isFailureEvidence(receipt)) continue;
    total += byteLength(receipt.stdout) + byteLength(receipt.stderr);
  }
  if (context.resultSummary) total += byteLength(context.resultSummary);
  return total;
}

/**
 * G1 fold step. Returns the context unchanged (with no fold record) when the
 * policy is disabled or the advisory set is within budget; otherwise returns
 * a summarized copy — preserved sets verbatim, advisory bodies replaced by
 * their bounded heads — plus the fold record for the `loop.context_summary`
 * event. The input context object is never mutated.
 */
export function summarizeTaskContext(
  context: TaskContextOutput,
  policy: ContextLifecyclePolicy,
  options: { reason?: ContextSummaryReason; occurredAt?: string } = {},
): { context: TaskContextOutput; fold?: ContextFold } {
  if (policy.advisoryByteBudget <= 0) return { context };
  const advisoryBytesBefore = measureAdvisoryContext(context);
  if (advisoryBytesBefore <= policy.advisoryByteBudget) return { context };

  const summaryLines: string[] = [];
  let summarizedEntryCount = 0;
  let summaryBytes = 0;
  let truncated = false;
  const appendLine = (line: string) => {
    // Bounded heads are the fold's design; `truncated` stays false unless the
    // total cap forces a line below its designed head (or drops it) — matching
    // the wire event's "summary exceeded the byte bound and was cut" contract.
    const remaining = Math.max(0, policy.summaryByteCap - summaryBytes);
    const designed = Math.max(0, policy.summaryEntryBytes);
    const bounded = byteHead(line, Math.min(designed, remaining));
    if (byteLength(bounded) < Math.min(byteLength(line), designed)) truncated = true;
    if (!bounded) return;
    summaryLines.push(bounded);
    summaryBytes += byteLength(bounded) + 1;
  };

  const previousChecks = context.previousChecks.map((receipt) => {
    if (isFailureEvidence(receipt)) return receipt;
    summarizedEntryCount += 1;
    appendLine(
      `check ${receipt.id}: exit ${receipt.exitCode} · ${receipt.stdout.trim() || receipt.stderr.trim() || "(empty output)"}`,
    );
    return {
      ...receipt,
      stdout: byteHead(receipt.stdout, policy.summaryEntryBytes),
      stderr: byteHead(receipt.stderr, policy.summaryEntryBytes),
    };
  });
  let resultSummary = context.resultSummary;
  if (resultSummary !== undefined && resultSummary !== null) {
    summarizedEntryCount += 1;
    appendLine(`previous attempt: ${resultSummary.trim()}`);
    resultSummary = byteHead(resultSummary, policy.summaryEntryBytes);
  }

  const passedReceipts = context.previousChecks.filter(
    (receipt) => !isFailureEvidence(receipt),
  ).length;
  const preservedEntryCount =
    context.previousChecks.length -
    passedReceipts +
    context.guidance.length +
    context.dependencyResults.length;
  const fold: ContextFold = {
    reason: options.reason ?? "budgetThreshold",
    summarizedEntryCount,
    preservedEntryCount,
    summary: summaryLines.join("\n"),
    truncated,
    advisoryBytesBefore,
    advisoryBytesAfter: measureAdvisoryContext({
      ...context,
      previousChecks,
      resultSummary: resultSummary ?? null,
    }),
    occurredAt: options.occurredAt ?? new Date().toISOString(),
  };
  return {
    context: { ...context, previousChecks, resultSummary: resultSummary ?? context.resultSummary },
    fold,
  };
}

/**
 * Attaches run/task identity to a fold record, producing the exact payload
 * of the generated `loop.context_summary` wire event (bridge codegen, G1).
 * Emitting surfaces (gateway/watch) publish this verbatim; the orchestrator's
 * durable record is the bounded activity line written at the fold point.
 */
export function toContextSummaryEvent(
  fold: ContextFold,
  identity: { runId: string; taskId: string; attempt: number },
): RustraEventPayloads["loop.context_summary"] {
  return {
    runId: identity.runId,
    taskId: identity.taskId,
    attempt: identity.attempt,
    reason: fold.reason,
    summarizedEntryCount: fold.summarizedEntryCount,
    preservedEntryCount: fold.preservedEntryCount,
    summary: fold.summary,
    truncated: fold.truncated,
    occurredAt: fold.occurredAt,
  };
}
