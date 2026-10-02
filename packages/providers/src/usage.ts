import type { RustraEventPayloads, SandboxCapabilityDeclaration, UsageMetadata } from "@loop/protocol";

/** Wire shape of one usage observation (G17): the `loop.usage_recorded` event payload. */
export type UsageRecordEvent = RustraEventPayloads["loop.usage_recorded"];

import { redactProviderText } from "./redact";
import { noSandboxDeclaration } from "./sandbox";
import type {
  AgentProvider,
  ProviderCapabilities,
  ProviderEvent,
  StartWorkerInput,
  WorkerHandle,
  WorkerResult,
  WorkerState,
} from "./types";

/**
 * Optional usage metadata collection (gap analysis G17 — 사용량·비용 기록,
 * 도입).
 *
 * Usage is recorded ONLY when the upstream reports it; nothing here invents
 * or estimates figures. `basis: "observed"` marks upstream-reported actuals;
 * `basis: "estimated"` is reserved for locally derived numbers and must be
 * labeled as an estimate by every reporting surface. Money is a decimal
 * string, never floating point, and token totals never mix bases.
 */

export interface UsageRecordContext {
  runId: string;
  taskId?: string;
  workerId?: string;
  occurredAt?: string;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Raw decimal-string costs keyed by currency, unaggregated (money math stays downstream). */
  costsByCurrency: Record<string, string[]>;
  records: number;
}

export interface UsageTotalsByBasis {
  observed: UsageTotals;
  estimated: UsageTotals;
}

export class UsageCollector {
  readonly #records: UsageRecordEvent[] = [];
  readonly #listeners = new Set<(record: UsageRecordEvent) => void>();

  record(usage: UsageMetadata, context: UsageRecordContext): UsageRecordEvent {
    const event: UsageRecordEvent = {
      runId: context.runId,
      taskId: context.taskId,
      workerId: context.workerId,
      usage: normalizeUsage(usage),
      occurredAt: context.occurredAt ?? new Date().toISOString(),
    };
    this.#records.push(event);
    for (const listener of this.#listeners) listener(event);
    return event;
  }

  events(): readonly UsageRecordEvent[] {
    return [...this.#records];
  }

  drain(): UsageRecordEvent[] {
    return this.#records.splice(0, this.#records.length);
  }

  onRecord(listener: (record: UsageRecordEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Token totals per basis; unreported (null) axes contribute zero. Bases are never mixed. */
  totals(): UsageTotalsByBasis {
    const byBasis: UsageTotalsByBasis = { observed: emptyTotals(), estimated: emptyTotals() };
    for (const record of this.#records) {
      const bucket = byBasis[record.usage.basis];
      bucket.inputTokens += Number(record.usage.inputTokens ?? 0);
      bucket.outputTokens += Number(record.usage.outputTokens ?? 0);
      bucket.cacheReadTokens += Number(record.usage.cacheReadTokens ?? 0);
      bucket.records += 1;
      const cost = record.usage.cost;
      const currency = record.usage.currency;
      if (cost && currency) (bucket.costsByCurrency[currency] ??= []).push(cost);
    }
    return byBasis;
  }
}

/**
 * Parses upstream-reported usage out of a JSON payload or JSON line (G17).
 * Returns null unless at least one recognized token axis is present, so
 * unrelated JSON lines never fabricate zero-token records. Parsed figures
 * are `observed` — they came from the upstream.
 */
export function parseUsageMetadata(value: unknown): UsageMetadata | undefined {
  let record: Record<string, unknown> | undefined;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      record = findUsageRecord(parsed);
    } catch {
      return undefined;
    }
  } else {
    record = findUsageRecord(value);
  }
  if (!record) return undefined;
  const usage: UsageMetadata = {
    inputTokens: readCount(record.input_tokens ?? record.prompt_tokens ?? record.inputTokens),
    outputTokens: readCount(record.output_tokens ?? record.completion_tokens ?? record.outputTokens),
    cacheReadTokens: readCount(record.cache_read_tokens ?? record.cache_read_input_tokens ?? record.cacheReadTokens),
    basis: "observed",
    cost: readCost(record.cost ?? record.total_cost ?? record.total_cost_usd),
    currency: readCurrency(record.currency),
  };
  const reported = usage.inputTokens !== null || usage.outputTokens !== null || usage.cacheReadTokens !== null;
  return reported ? usage : undefined;
}

function findUsageRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (hasUsageKey(record)) return record;
  if (record.usage && typeof record.usage === "object") {
    const nested = record.usage as Record<string, unknown>;
    if (hasUsageKey(nested)) return nested;
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const found = findUsageRecord(child);
      if (found) return found;
    }
  }
  return undefined;
}

function hasUsageKey(record: Record<string, unknown>): boolean {
  return ["input_tokens", "prompt_tokens", "inputTokens", "output_tokens", "completion_tokens", "outputTokens", "cache_read_tokens", "cache_read_input_tokens", "cacheReadTokens"]
    .some((key) => key in record);
}

function readCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "bigint" && value >= 0n) return Number(value);
  return null;
}

function readCost(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return redactProviderText(value.toString(), 64);
  }
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  return null;
}

function readCurrency(value: unknown): string | null {
  if (typeof value === "string" && /^[A-Z]{3}$/.test(value.trim())) return value.trim();
  return null;
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

function emptyTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costsByCurrency: {}, records: 0 };
}

/**
 * Adapter-side usage tracking wrapper (G17): funnels usage reported by the
 * inner provider — result-level `WorkerResult.usage` and stream-level
 * `usage` events — into a collector with run/task/worker correlation.
 * Pass-through in every other respect.
 */
export class UsageTrackingProvider implements AgentProvider {
  readonly #inner: AgentProvider;
  readonly #correlation = new Map<string, { runId: string; taskId: string }>();

  constructor(inner: AgentProvider) {
    this.#inner = inner;
  }

  get id(): string {
    return this.#inner.id;
  }

  /** G4a: declarations pass through the tracking wrapper unchanged (absence stays declared). */
  sandboxDeclaration(): SandboxCapabilityDeclaration {
    return this.#inner.sandboxDeclaration?.() ?? noSandboxDeclaration(this.id);
  }

  get inner(): AgentProvider {
    return this.#inner;
  }

  readonly collector = new UsageCollector();

  capabilities(): Promise<ProviderCapabilities> {
    return this.#inner.capabilities();
  }

  async start(input: StartWorkerInput): Promise<WorkerHandle> {
    const handle = await this.#inner.start(input);
    this.#correlation.set(handle.id, { runId: input.runId, taskId: input.taskId });
    return handle;
  }

  async cancel(workerId: string): Promise<void> {
    return this.#inner.cancel(workerId);
  }

  async status(workerId: string): Promise<WorkerState> {
    return this.#inner.status(workerId);
  }

  async result(workerId: string): Promise<WorkerResult> {
    const result = await this.#inner.result(workerId);
    if (result.usage) this.#record(result.usage, workerId);
    return result;
  }

  subscribe?(workerId: string, listener: (event: ProviderEvent) => void): () => void {
    const innerSubscribe = this.#inner.subscribe?.bind(this.#inner);
    if (!innerSubscribe) return () => {};
    return innerSubscribe(workerId, (event) => {
      if (event.type === "usage") this.#record(event.usage, workerId);
      listener(event);
    });
  }

  async release?(workerId: string): Promise<void> {
    this.#correlation.delete(workerId);
    await this.#inner.release?.(workerId);
  }

  #record(usage: UsageMetadata, workerId: string): void {
    const correlation = this.#correlation.get(workerId);
    this.collector.record(usage, {
      runId: correlation?.runId ?? "unattributed",
      taskId: correlation?.taskId,
      workerId,
    });
  }
}
