import { expect, test } from "bun:test";

import {
  compactFindings,
  renderAttention,
  renderGraph,
  renderModels,
  renderRunSummary,
  renderStatus,
  renderWorkers,
  validateDecomposition,
} from "../src";

const limits = {
  statusLineLimit: 8,
  attentionLineLimit: 6,
  findingsLineLimit: 5,
  listLineLimit: 8,
  lineTextLimit: 160,
};

test("completed run summary stays compact", () => {
  const output = renderRunSummary({
    tasks: 7,
    implementationBranches: 2,
    checksPassed: true,
    escalations: [{ taskId: "impl-b", from: "fast", to: "strong" }],
    changedFiles: 6,
  }, limits);
  expect(output).toContain("✓ 7 tasks");
  expect(output).toContain("↗ 1 task escalated from fast → strong");
  expect(output.split("\n").length).toBeLessThanOrEqual(8);
});

test("default status stays within eight lines and answers current progress", () => {
  const output = renderStatus({
    runId: "8K2",
    stages: Array.from({ length: 9 }, (_, index) => ({
      name: index === 2 ? "Implementation" : `Stage ${index + 1}`,
      done: index === 2 ? 2 : 0,
      total: index === 2 ? 4 : 1,
      state: index === 2 ? "working" as const : "waiting" as const,
    })),
    workers: 3,
    attention: 0,
  }, limits);
  expect(output.split("\n").length).toBeLessThanOrEqual(8);
  expect(output).toContain("Implementation 2/4 ●");
  expect(output).toContain("Workers: 3 · Attention: 0");
  expect(output.split("\n").at(-2)).toMatch(/^… \d+ more status lines$/);
});

test("attention stays within six lines and findings are exception-driven", () => {
  const attention = renderAttention({
    kind: "decision",
    summary: "Choose\r\nmigration mode",
    options: [
      "online: no downtime",
      "offline: simpler rollback",
      "shadow: compare both",
      "later: defer",
      "never: cancel",
    ],
    question: "Which trade-off should Loop use?",
  }, limits);
  expect(attention.split("\n").length).toBeLessThanOrEqual(6);
  expect(attention).toContain("Choose migration mode");
  expect(attention).toContain("… 3 more options");

  const findings = compactFindings(
    Array.from({ length: 9 }, (_, index) => ({
      severity: index % 2 ? "FIX" as const : "BLOCK" as const,
      finding: `finding-${index}`,
      evidence: `evidence-${index}`,
      action: `action-${index}`,
    })),
    limits,
  );
  expect(findings).toHaveLength(5);
  expect(findings.slice(0, 4).map((entry) => entry.kind === "finding" && entry.value.severity))
    .toEqual(["BLOCK", "BLOCK", "BLOCK", "BLOCK"]);
  expect(findings.at(-1)).toEqual({
    kind: "overflow",
    omitted: 5,
    text: "… 5 more findings",
  });
  expect(compactFindings([], limits)).toEqual([]);
});

test("graph, workers, and models reserve their last line for exact overflow counts", () => {
  const graph = renderGraph(
    Array.from({ length: 10 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: `Task ${index + 1}`,
      kind: "implementation" as const,
      dependencies: [],
      readScope: [],
      writeScope: [],
      requirements: [],
      completionChecks: [],
      preferredCompute: "fast" as const,
      minimumCompute: "tiny" as const,
      maximumCompute: "strong" as const,
      maxAttempts: 2,
    })),
    limits,
  );
  const workers = renderWorkers(
    Array.from({ length: 10 }, (_, index) => ({
      id: `worker-${index + 1}`,
      provider: "pi",
      model: "zai/glm",
      state: "working",
    })),
    limits,
  );
  const models = renderModels(
    Array.from({ length: 10 }, (_, index) => `class-${index + 1} · model-${index + 1}`),
    limits,
  );

  for (const [output, summary] of [
    [graph, "… 3 more tasks"],
    [workers, "… 3 more workers"],
    [models, "… 3 more models"],
  ]) {
    expect(output.split("\n")).toHaveLength(8);
    expect(output.split("\n").at(-1)).toBe(summary);
  }
});

test("every renderer normalizes line breaks and caps lines at 160 graphemes", () => {
  const output = renderWorkers([{
    id: `worker\r\n${"👩🏽‍💻".repeat(200)}`,
    provider: "pi",
    state: "working",
  }], limits);
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

  expect(output).not.toMatch(/[\r\n]/);
  expect([...segmenter.segment(output)]).toHaveLength(160);
  expect(output.endsWith("…")).toBe(true);
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
