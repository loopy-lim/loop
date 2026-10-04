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

test("workingLine ages the persisted last-progress timestamp", () => {
  const now = 1_000_000;
  const fresh = snapshot({ tasks: [task({ lastProgressMs: now - 42_000 })] });
  expect(workingLine(fresh, 42_000, now)).toBe(
    "Working: Fix pair check · 42s · progress 42s · wrote src/a.ts",
  );
  // Worst-case reading: one silent worker makes the whole run suspect.
  const mixed = snapshot({
    tasks: [
      task({ id: "a", title: "A", activities: [], lastProgressMs: now - 1_000 }),
      task({ id: "b", title: "B", activities: [], lastProgressMs: now - 125_000 }),
    ],
  });
  expect(workingLine(mixed, undefined, now)).toBe("Working: 2 running tasks · progress 2m05s");
  // Snapshots without progress timestamps render exactly as before.
  expect(workingLine(snapshot(), 42_000, now)).toBe(
    "Working: Fix pair check · 42s · wrote src/a.ts",
  );
  // Future timestamps are clock corrections, not staleness.
  const future = snapshot({ tasks: [task({ lastProgressMs: now + 5_000 })] });
  expect(workingLine(future, undefined, now)).toBe(
    "Working: Fix pair check · progress 0s · wrote src/a.ts",
  );
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

test("status marks stale running tasks with their last-progress age", () => {
  const now = 1_000_000;
  const output = renderSnapshot(
    "status",
    snapshot({ tasks: [task({ lastProgressMs: now - 125_000 })] }),
    limits,
    { nowMs: now },
  );
  expect(output).toContain("progress: 2m05s ago");
  // Terminal tasks carry no progress-age detail.
  const done = renderSnapshot(
    "status",
    snapshot({ tasks: [task({ state: "done", lastProgressMs: now - 125_000 })] }),
    limits,
    { nowMs: now },
  );
  expect(done).not.toContain("progress:");
});

test("attention rendering ages each open item", () => {
  const now = 1_000_000;
  const output = renderSnapshot(
    "attention",
    snapshot({
      openAttentionIds: ["atn-1"],
      attention: [
        {
          openedAtMs: now - 250_000,
          id: "atn-1",
          kind: "failure",
          summary: "boom",
          taskId: "impl",
        },
      ],
    }),
    limits,
    { nowMs: now },
  );
  expect(output).toContain("waited 4m10s");
  // Items without an opening timestamp render exactly as before.
  const timeless = renderSnapshot(
    "attention",
    snapshot({
      openAttentionIds: ["atn-2"],
      attention: [{ id: "atn-2", kind: "failure", summary: "boom", taskId: "impl" }],
    }),
    limits,
    { nowMs: now },
  );
  expect(timeless).not.toContain("waited");
});
