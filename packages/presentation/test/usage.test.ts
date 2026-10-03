import { expect, test } from "bun:test";

import type { SnapshotOutput } from "@loop/protocol";

import { renderSnapshot } from "../src/snapshot";
import { renderUsage, type UsageSummaryView } from "../src/usage";

const limits = {
  statusLineLimit: 8,
  attentionLineLimit: 6,
  findingsLineLimit: 5,
  listLineLimit: 8,
  lineTextLimit: 160,
};

function snapshot(overrides: Partial<SnapshotOutput> = {}): SnapshotOutput {
  return {
    runId: "run-1",
    state: "active",
    intent: "intent",
    workingDirectory: "/repo",
    guidance: [],
    goalCriteria: [],
    openAttentionIds: [],
    attention: [],
    lastSequence: 0,
    tasks: [
      {
        id: "t1",
        title: "t1",
        kind: "implementation",
        state: "running",
        attempt: 1,
        preferredCompute: "fast",
        dependencies: [],
        readScope: [],
        writeScope: [],
        blockedBy: [],
        activities: ["[lifecycle] starting", "wrote src/a.ts"],
      },
    ],
    activeWorkers: [{ id: "run-1:t1:1:w", taskId: "t1" }],
    ...overrides,
  };
}

test("worker lines carry task state and the latest activity (G18 요약 고도화)", () => {
  const output = renderSnapshot("workers", snapshot(), limits);
  expect(output).toContain("run-1:t1:1:w");
  expect(output).toContain("running");
  expect(output).toContain("wrote src/a.ts");
});

test("worker lines clamp to the shared line-text budget", () => {
  const base = snapshot();
  const output = renderSnapshot(
    "workers",
    snapshot({
      tasks: [{ ...base.tasks[0]!, activities: ["y".repeat(400)] }],
    }),
    limits,
  );
  const line = output.split("\n")[0]!;
  expect(line.length).toBeLessThanOrEqual(161); // singleLine clamps with an ellipsis
});

test("renderUsage reports only recorded usage and labels estimates", () => {
  expect(renderUsage(undefined, limits)).toContain("no usage reported");
  expect(renderUsage({ recordCount: 0, bases: [] }, limits)).toContain("no usage reported");

  const usage: UsageSummaryView = {
    recordCount: 2,
    bases: [
      {
        basis: "observed",
        recordCount: 1,
        totals: { inputTokens: 1234, outputTokens: 567, cost: { USD: "0.03" } },
      },
      {
        basis: "estimated",
        recordCount: 1,
        totals: { inputTokens: 999 },
      },
    ],
  };
  const output = renderUsage(usage, limits);
  expect(output).toContain("in 1,234");
  expect(output).toContain("out 567");
  expect(output).toContain("0.03 USD");
  expect(output).toContain("observed (reported)");
  expect(output).toContain("estimated (derived, not measured)");
});
