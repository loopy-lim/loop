import { expect, test } from "bun:test";

import {
  compactFindings,
  renderAttention,
  renderRunSummary,
  renderStatus,
  validateDecomposition,
} from "../src";

test("completed run summary stays compact", () => {
  const output = renderRunSummary({
    tasks: 7,
    implementationBranches: 2,
    checksPassed: true,
    escalations: [{ taskId: "impl-b", from: "fast", to: "strong" }],
    changedFiles: 6,
  });
  expect(output).toContain("✓ 7 tasks");
  expect(output).toContain("↗ 1 task escalated from fast → strong");
  expect(output.split("\n").length).toBeLessThanOrEqual(8);
});

test("default status stays within eight lines and answers current progress", () => {
  const output = renderStatus({
    runId: "8K2",
    stages: [
      { name: "Research", done: 3, total: 3, state: "done" },
      { name: "Decision", done: 1, total: 1, state: "done" },
      { name: "Implementation", done: 2, total: 4, state: "working" },
      { name: "Verification", done: 0, total: 2, state: "waiting" },
    ],
    workers: 3,
    attention: 0,
  });
  expect(output.split("\n").length).toBeLessThanOrEqual(8);
  expect(output).toContain("Implementation 2/4 ●");
  expect(output).toContain("Workers: 3 · Attention: 0");
});

test("attention stays within six lines and findings are exception-driven", () => {
  const attention = renderAttention({
    kind: "decision",
    summary: "Choose migration mode",
    options: ["online: no downtime", "offline: simpler rollback"],
    question: "Which trade-off should Loop use?",
  });
  expect(attention.split("\n").length).toBeLessThanOrEqual(6);

  const findings = compactFindings(
    Array.from({ length: 9 }, (_, index) => ({
      severity: index % 2 ? "FIX" as const : "BLOCK" as const,
      finding: `finding-${index}`,
      evidence: `evidence-${index}`,
      action: `action-${index}`,
    })),
  );
  expect(findings).toHaveLength(5);
  expect(compactFindings([])).toEqual([]);
});

test("Lead decomposition rejects missing dependencies and write ownership", () => {
  expect(() =>
    validateDecomposition([
      {
        id: "impl",
        title: "implementation",
        kind: "implementation",
        dependencies: ["missing"],
        readScope: [],
        writeScope: [],
        requirements: [],
        completionChecks: [
          {
            id: "tests",
            command: "bun",
            args: ["test"],
            workingDirectory: null,
            timeoutMs: 120_000,
          },
        ],
        preferredCompute: "fast",
        minimumCompute: "tiny",
        maximumCompute: "strong",
        maxAttempts: 3,
      },
    ]),
  ).toThrow();
});
