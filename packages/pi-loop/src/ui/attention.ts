export interface AttentionView {
  kind: "question" | "decision" | "approval" | "conflict" | "failure";
  summary: string;
  options: string[];
  question: string;
}

export function renderAttention(view: AttentionView): string {
  return [
    `Attention · ${view.kind}`,
    view.summary,
    ...view.options.slice(0, 3).map((option, index) => `${index + 1}. ${option}`),
    view.question,
  ]
    .slice(0, 6)
    .join("\n");
}
