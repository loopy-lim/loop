import { compactLines, type OutputLimits } from "@loop/presentation";

export interface AttentionView {
  kind: "question" | "decision" | "approval" | "conflict" | "failure";
  summary: string;
  options: string[];
  question: string;
}

export function renderAttention(view: AttentionView, limits: OutputLimits): string {
  const options = compactLines(
    view.options.map((option, index) => `${index + 1}. ${option}`),
    {
      lineLimit: 3,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => `… ${omitted} more options`,
    },
  );
  return compactLines([`Attention · ${view.kind}`, view.summary, ...options, view.question], {
    lineLimit: limits.attentionLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more attention lines`,
  }).join("\n");
}
