import { singleLine } from "./compact";
import { emptyState, separator } from "./tokens";

/**
 * Structural view of the orchestrator's G17 usage summary (@loop/orchestrator
 * `UsageSummary`). Presentation depends only on @loop/protocol, so this view
 * is defined structurally here — the orchestrator type satisfies it without a
 * package dependency, and hand-copied domain types are avoided.
 */
export interface UsageSummaryView {
  recordCount: number;
  bases: Array<{
    basis: "observed" | "estimated";
    recordCount: number;
    totals: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      /** Per-currency exact decimal sums; never floats. */
      cost?: Record<string, string>;
    };
  }>;
}

export interface UsageRenderOptions {
  lineTextLimit: number;
}

function formatTokens(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.toLocaleString("en-US");
}

/**
 * G17 사용량 요약 렌더링: 기록된 관측만 표시하고, 추정치는 라벨로
 * 실측과 구별한다. 기록이 없으면 "none reported" — 0으로 채우지 않는다.
 */
export function renderUsage(usage: UsageSummaryView | undefined, options: UsageRenderOptions): string {
  if (!usage || usage.recordCount === 0) return `Usage: ${emptyState.noUsage}`;
  const lines = usage.bases.map((basis) => {
    const label = basis.basis === "estimated" ? "estimated (derived, not measured)" : "observed (reported)";
    const parts = [
      ...(basis.totals.inputTokens !== undefined ? [`in ${formatTokens(basis.totals.inputTokens)}`] : []),
      ...(basis.totals.outputTokens !== undefined ? [`out ${formatTokens(basis.totals.outputTokens)}`] : []),
      ...(basis.totals.cacheReadTokens !== undefined ? [`cache ${formatTokens(basis.totals.cacheReadTokens)}`] : []),
      ...Object.entries(basis.totals.cost ?? {}).map(([currency, cost]) => `${cost} ${currency}`),
    ];
    return singleLine(`Usage (${label}, ${basis.recordCount} record(s)): ${parts.length > 0 ? parts.join(` ${separator.list} `) : "reported axes only"}`, options.lineTextLimit);
  });
  return lines.join("\n");
}
