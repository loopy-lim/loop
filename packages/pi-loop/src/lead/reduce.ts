import { compactItems, type OutputLimits, singleLine } from "@loop/presentation";

export interface ReviewFinding {
  severity: "BLOCK" | "FIX";
  finding: string;
  evidence: string;
  action: string;
}

export type CompactFinding =
  | { kind: "finding"; value: ReviewFinding }
  | { kind: "overflow"; omitted: number; text: string };

export function compactFindings(findings: ReviewFinding[], limits: OutputLimits): CompactFinding[] {
  const sorted = [...findings].sort(
    (left, right) => severityRank(left.severity) - severityRank(right.severity),
  );
  const compacted = compactItems(sorted, limits.findingsLineLimit);
  const visible = compacted.items.map((value) => ({ kind: "finding" as const, value }));
  if (compacted.omitted === 0) return visible;
  return [
    ...visible,
    {
      kind: "overflow",
      omitted: compacted.omitted,
      text: singleLine(`… ${compacted.omitted} more findings`, limits.lineTextLimit),
    },
  ];
}

function severityRank(value: ReviewFinding["severity"]): number {
  return value === "BLOCK" ? 0 : 1;
}
