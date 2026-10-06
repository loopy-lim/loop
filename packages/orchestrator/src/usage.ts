import type { RustraEventPayloads, UsageBasis, UsageMetadata } from "@loop/protocol";

/**
 * G17 — 사용량 기록 (docs/research/loop-gap-analysis.md, 도입).
 *
 * Boundary: the ledger is an orchestrator-boundary recorder. It only ever
 * stores figures an upstream (adapter/provider) reported — it never invents,
 * extrapolates, or prices usage. `basis` separates observed from estimated
 * figures at every aggregation step, so a derived total can never be
 * presented as a measured cost. Money is exact decimal-string arithmetic —
 * floating-point money never enters the ledger.
 */

/** Normalized record shape accepted by the ledger (the generated wire event payload). */
export type UsageRecord = RustraEventPayloads["loop.usage_recorded"];

export interface UsageAxisTotals {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  /** Per-currency exact decimal sums; absent when no record was priced. */
  cost?: Record<string, string>;
}

export interface UsageBasisTotals {
  basis: UsageBasis;
  recordCount: number;
  totals: UsageAxisTotals;
}

export interface UsageSummary {
  runId: string;
  /** Empty when nothing was recorded — surfaces must say "no usage reported", not 0. */
  bases: UsageBasisTotals[];
  recordCount: number;
}

export interface UsageLedgerOptions {
  /** Now function for deterministic tests. */
  now?: () => Date;
}

const BASES: readonly UsageBasis[] = ["observed", "estimated"];

function isUsageBasis(value: unknown): value is UsageBasis {
  return value === "observed" || value === "estimated";
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Parsed decimal string: sign, integer part, fraction, fraction length. */
function parseDecimalString(value: string) {
  const match = /^-?\d+(\.\d+)?$/.exec(value.trim());
  if (!match) throw new Error(`usage cost is not a decimal string: ${JSON.stringify(value)}`);
  const negative = value.trim().startsWith("-");
  const [whole, fraction = ""] = value.trim().replace(/^-/, "").split(".");
  if (whole === undefined)
    throw new Error(`usage cost is not a decimal string: ${JSON.stringify(value)}`);
  return { negative, whole: BigInt(whole), fraction, scale: fraction.length };
}

/**
 * Exact decimal-string addition (no float money): aligns scales as integers
 * and re-renders the sum.
 */
export function addDecimalStrings(left: string, right: string): string {
  const a = parseDecimalString(left);
  const b = parseDecimalString(right);
  const scale = Math.max(a.scale, b.scale);
  const align = (entry: ReturnType<typeof parseDecimalString>) =>
    entry.whole * 10n ** BigInt(scale) + BigInt(entry.fraction.padEnd(scale, "0") || "0");
  const sum = (a.negative ? -1n : 1n) * align(a) + (b.negative ? -1n : 1n) * align(b);
  const negative = sum < 0n;
  const digits = (negative ? -sum : sum).toString().padStart(scale + 1, "0");
  const text = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${text}` : text;
}

/**
 * In-memory, per-run usage recorder. Adapters push `UsageRecordEvent`-shaped
 * observations (only when the upstream reported usage); the run summary and
 * presentation consume basis-separated totals. Records are never mixed
 * across bases, and axes left unreported stay unreported.
 */
export class UsageLedger {
  readonly #records = new Map<string, UsageRecord[]>();
  readonly #now: () => Date;

  constructor(options: UsageLedgerOptions = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Records one usage observation. Throws on records that would corrupt the
   * honesty contract (unknown basis, negative or non-integer token counts,
   * non-decimal cost) — a rejected record is a defect in the collecting
   * surface, never something to coerce.
   */
  record(record: UsageRecord): void {
    if (!record.runId?.trim()) throw new Error("usage record requires runId");
    if (!isUsageBasis(record.usage?.basis))
      throw new Error(
        `usage record basis must be "observed" or "estimated", got ${JSON.stringify(record.usage?.basis)}`,
      );
    for (const axis of ["inputTokens", "outputTokens", "cacheReadTokens"] as const) {
      const value: unknown = record.usage[axis];
      if (value != null && !nonNegativeInteger(value)) {
        throw new Error(`usage record ${axis} must be a non-negative integer or null`);
      }
    }
    const cost = record.usage.cost;
    if (cost != null && !/^-?\d+(\.\d+)?$/.test(cost)) {
      throw new Error(`usage record cost must be a decimal string, got ${JSON.stringify(cost)}`);
    }
    if (cost != null && !record.usage.currency?.trim()) {
      throw new Error("usage record cost requires a currency");
    }
    const normalized: UsageRecord = {
      ...record,
      usage: normalizeUsage(record.usage),
      occurredAt: record.occurredAt || this.#now().toISOString(),
    };
    const records = this.#records.get(normalized.runId);
    if (records) records.push(normalized);
    else this.#records.set(normalized.runId, [normalized]);
  }

  /** All records observed for a run, in arrival order. */
  records(runId: string): readonly UsageRecord[] {
    return this.#records.get(runId) ?? [];
  }

  /** Basis-separated, run-scoped totals. Bases with no records are omitted. */
  summary(runId: string): UsageSummary {
    const records = this.records(runId);
    const bases: UsageBasisTotals[] = [];
    for (const basis of BASES) {
      const scoped = records.filter((record) => record.usage.basis === basis);
      if (scoped.length === 0) continue;
      bases.push({
        basis,
        recordCount: scoped.length,
        totals: totalize(scoped.map((record) => record.usage)),
      });
    }
    return { runId, bases, recordCount: records.length };
  }

  /** Per-task view used by run summaries; tasks without records are omitted. */
  summaryByTask(runId: string): Array<{ taskId: string; summary: UsageSummary }> {
    const records = this.records(runId);
    const byTask = new Map<string, UsageRecord[]>();
    for (const record of records) {
      if (!record.taskId) continue;
      const scoped = byTask.get(record.taskId);
      if (scoped) scoped.push(record);
      else byTask.set(record.taskId, [record]);
    }
    return [...byTask.entries()].map(([taskId, scoped]) => ({
      taskId,
      summary: {
        runId,
        recordCount: scoped.length,
        bases: BASES.filter((basis) => scoped.some((record) => record.usage.basis === basis)).map(
          (basis) => {
            const filtered = scoped.filter((record) => record.usage.basis === basis);
            return {
              basis,
              recordCount: filtered.length,
              totals: totalize(filtered.map((record) => record.usage)),
            };
          },
        ),
      },
    }));
  }
}

function normalizeUsage(usage: UsageMetadata): UsageMetadata {
  return {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    cacheReadTokens: usage.cacheReadTokens ?? null,
    basis: usage.basis,
    cost: usage.cost ?? null,
    currency: usage.currency ?? null,
  };
}

function totalize(usages: UsageMetadata[]): UsageAxisTotals {
  const totals: UsageAxisTotals = {};
  const sumAxis = (axis: "inputTokens" | "outputTokens" | "cacheReadTokens") => {
    const values = usages
      .map((usage) => usage[axis])
      .filter((value): value is number => value != null);
    if (values.length > 0) totals[axis] = values.reduce((left, right) => left + right, 0);
  };
  sumAxis("inputTokens");
  sumAxis("outputTokens");
  sumAxis("cacheReadTokens");
  const byCurrency = new Map<string, string>();
  for (const usage of usages) {
    if (usage.cost == null || !usage.currency) continue;
    const previous = byCurrency.get(usage.currency);
    byCurrency.set(usage.currency, previous ? addDecimalStrings(previous, usage.cost) : usage.cost);
  }
  if (byCurrency.size > 0) totals.cost = Object.fromEntries(byCurrency);
  return totals;
}
