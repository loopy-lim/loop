export interface ReviewFinding {
  severity: "BLOCK" | "FIX";
  finding: string;
  evidence: string;
  action: string;
}

export function compactFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings]
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity))
    .slice(0, 5);
}

function severityRank(value: ReviewFinding["severity"]): number {
  return value === "BLOCK" ? 0 : 1;
}
