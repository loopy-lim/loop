import { expect, test } from "bun:test";

import type { SnapshotOutput, TaskSnapshotOutput } from "@loop/protocol";

import { renderSnapshot } from "../src/snapshot";
import { formatElapsed, workingLine } from "../src/working";

const limits = {
  statusLineLimit: 8,
  attentionLineLimit: 6,
  findingsLineLimit: 5,
  listLineLimit: 8,
  lineTextLimit: 160,
};

function task(overrides: Partial<TaskSnapshotOutput> = {}): TaskSnapshotOutput {
  return {
    id: "impl",
    title: "Fix pair check",
    kind: "implementation",
    state: "running",
    attempt: 1,
    preferredCompute: "fast",
    dependencies: [],
    readScope: [],
    writeScope: [],
    blockedBy: [],
    activities: ["[lifecycle] starting", "wrote src/a.ts"],
    ...overrides,
  };
}

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
    tasks: [task()],
    activeWorkers: [{ id: "run-1:impl:1:w", taskId: "impl" }],
    ...overrides,
  };
}

test("formatElapsed compacts seconds, minutes, and hours", () => {
  expect(formatElapsed(0)).toBe("0s");
  expect(formatElapsed(-5)).toBe("0s");
  expect(formatElapsed(Number.NaN)).toBe("0s");
  expect(formatElapsed(42_000)).toBe("42s");
  expect(formatElapsed(65_000)).toBe("1m05s");
  expect(formatElapsed(3_600_000 + 420_000)).toBe("1h07m");
});

test("workingLine shows the running task title, elapsed time, and latest activity", () => {
  expect(workingLine(snapshot(), 42_000)).toBe("Working: Fix pair check · 42s · wrote src/a.ts");
  // Elapsed is caller-supplied; without it the line still marks progress.
  expect(workingLine(snapshot())).toBe("Working: Fix pair check · wrote src/a.ts");
});

test("workingLine falls back to a running count and survives missing activity", () => {
  const multiple = snapshot({
    tasks: [
      task({ id: "a", title: "A", activities: ["reading src/a.ts"] }),
      task({ id: "b", title: "B", activities: [] }),
    ],
  });
  expect(workingLine(multiple, 65_000)).toBe("Working: 2 running tasks · 1m05s · reading src/a.ts");

  const idle = snapshot({ tasks: [task({ state: "ready", activities: [] })] });
  expect(workingLine(idle)).toBe("Working: 0 running tasks");
});

test("workingLine is undefined unless the run is actively working", () => {
  for (const state of ["attention", "completed", "failed", "paused"] as const) {
    expect(workingLine(snapshot({ state }))).toBeUndefined();
  }
});

test("status renders the working line for active runs and stays within the budget", () => {
  const output = renderSnapshot("status", snapshot(), limits, { elapsedMs: 42_000 });
  const lines = output.split("\n");
  expect(lines).toContain("Working: Fix pair check · 42s · wrote src/a.ts");
  expect(lines.indexOf("Working: Fix pair check · 42s · wrote src/a.ts")).toBe(2);
  expect(lines.length).toBeLessThanOrEqual(limits.statusLineLimit);
});

test("status omits the working line for non-active runs even with elapsed time", () => {
  const output = renderSnapshot("status", snapshot({ state: "completed" }), limits, {
    elapsedMs: 42_000,
  });
  expect(output).not.toContain("Working:");
});
