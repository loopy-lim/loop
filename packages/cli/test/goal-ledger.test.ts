import { expect, test } from "bun:test";
import type { EventOutput, GoalCriterionStatusOutput } from "@loop/protocol";
import { formatGoalLedger, goalLedger } from "../src/goal-ledger";

function event(sequence: number, type: string, data: unknown): EventOutput {
  return { sequence, payloadJson: JSON.stringify({ run_id: "run-1", kind: { type, data } }) };
}

function criterionMeta(overrides: Partial<GoalCriterionStatusOutput>): GoalCriterionStatusOutput {
  return {
    id: "original-criterion",
    description: "behavior works",
    taskId: "original",
    checkIds: ["unit"],
    state: "pending",
    ...overrides,
  };
}

const limits = {
  statusLineLimit: 8,
  attentionLineLimit: 6,
  findingsLineLimit: 5,
  listLineLimit: 20,
  lineTextLimit: 200,
};

test("ledger joins snapshot criteria with receipts, evidence, and steer provenance", () => {
  const view = goalLedger(
    {
      runId: "run-1",
      runState: "active",
      tasks: [
        { id: "original", state: "done" },
        { id: "correction", state: "verifying" },
      ],
      criteria: [
        criterionMeta({ state: "verified" }),
        criterionMeta({
          id: "steer-criterion",
          description: "corrected behavior works",
          taskId: "correction",
          state: "pending",
        }),
      ],
    },
    [
      event(10, "task_created", { id: "correction", dependencies: ["original"] }),
      event(11, "guidance_added", {
        task_id: "correction",
        message: "private steer message must not leak",
      }),
      event(12, "goal_criteria_declared", [
        {
          id: "steer-criterion",
          description: "corrected behavior works",
          task_id: "correction",
          check_ids: ["unit"],
        },
      ]),
      event(14, "check_receipts_recorded", {
        task_id: "original",
        checks: [
          {
            id: "unit",
            exitCode: 0,
            timedOut: false,
            source: {
              beforeFingerprint: "abc",
              afterFingerprint: "abc",
              observedOutsideWriteScope: [],
            },
          },
        ],
      }),
      event(15, "verification_passed", {
        task_id: "original",
        evidence: { checks: { unit: true } },
      }),
    ],
  );

  expect(view.total).toBe(2);
  expect(view.verified).toBe(1);
  expect(view.criteria[0]).toMatchObject({
    id: "original-criterion",
    taskId: "original",
    taskState: "done",
    fromSteer: false,
    state: "verified",
    checks: [
      {
        checkId: "unit",
        receipts: 1,
        lastExitCode: 0,
        lastTimedOut: false,
        lastSourceStable: true,
        lastOutOfScopePaths: [],
        evidencePassed: true,
      },
    ],
  });
  expect(view.criteria[1]).toMatchObject({
    id: "steer-criterion",
    taskState: "verifying",
    fromSteer: true,
    checks: [{ checkId: "unit", receipts: 0, lastExitCode: null, evidencePassed: null }],
  });
  // Steer guidance text is provenance-private; the ledger view never exposes it.
  expect(JSON.stringify(view)).not.toContain("private steer message must not leak");
});

test("steer provenance requires the contiguous promotion batch order", () => {
  const meta = {
    runId: "run-1",
    runState: "active",
    tasks: [{ id: "correction", state: "pending" }],
    criteria: [criterionMeta({ id: "steer-criterion", taskId: "correction", checkIds: ["unit"] })],
  };
  // Same three events with a gap between guidance and declaration: not a
  // promotion batch, so the criterion keeps its original provenance.
  const nonAdjacent = goalLedger(meta, [
    event(10, "task_created", { id: "correction", dependencies: ["original"] }),
    event(11, "guidance_added", { task_id: "correction", message: "adjust" }),
    event(20, "goal_criteria_declared", [
      { id: "steer-criterion", description: "x", task_id: "correction", check_ids: ["unit"] },
    ]),
  ]);
  expect(nonAdjacent.criteria[0]?.fromSteer).toBe(false);

  // Guidance scoped to a different task directly before a declaration is
  // also not a promotion of that criterion's task.
  const otherTaskGuidance = goalLedger(meta, [
    event(10, "guidance_added", { task_id: "other", message: "adjust" }),
    event(11, "goal_criteria_declared", [
      { id: "steer-criterion", description: "x", task_id: "correction", check_ids: ["unit"] },
    ]),
  ]);
  expect(otherTaskGuidance.criteria[0]?.fromSteer).toBe(false);
});

test("the latest receipt and latest evidence win as the linked check result", () => {
  const view = goalLedger(
    {
      runId: "run-1",
      runState: "active",
      tasks: [{ id: "original", state: "done" }],
      criteria: [criterionMeta({ checkIds: ["unit", "lint"] })],
    },
    [
      event(5, "check_receipts_recorded", {
        task_id: "original",
        checks: [
          { id: "unit", exitCode: 1, timedOut: false, source: null },
          { id: "lint", exitCode: 0, timedOut: false, source: null },
        ],
      }),
      event(6, "check_receipts_recorded", {
        task_id: "original",
        checks: [
          {
            id: "unit",
            exitCode: 0,
            timedOut: false,
            source: {
              beforeFingerprint: "a",
              afterFingerprint: "b",
              observedOutsideWriteScope: ["src/elsewhere.ts"],
            },
          },
        ],
      }),
      event(7, "verification_passed", {
        task_id: "original",
        evidence: { checks: { lint: false } },
      }),
      event(8, "verification_passed", {
        task_id: "original",
        evidence: { checks: { lint: true } },
      }),
    ],
  );

  expect(view.criteria[0]?.checks).toEqual([
    {
      checkId: "unit",
      receipts: 2,
      lastExitCode: 0,
      lastTimedOut: false,
      lastSourceStable: false,
      lastOutOfScopePaths: ["src/elsewhere.ts"],
      evidencePassed: null,
    },
    {
      checkId: "lint",
      receipts: 1,
      lastExitCode: 0,
      lastTimedOut: false,
      lastSourceStable: null,
      lastOutOfScopePaths: [],
      evidencePassed: true,
    },
  ]);
});

test("format renders glyphs, steer markers, and stays within the declared line limits", () => {
  const ledger = goalLedger(
    {
      runId: "run-1",
      runState: "active",
      tasks: [{ id: "correction", state: "verifying" }],
      criteria: [
        criterionMeta({ state: "verified" }),
        criterionMeta({
          id: "steer-criterion",
          description: "corrected behavior works",
          taskId: "correction",
        }),
      ],
    },
    [
      event(10, "task_created", { id: "correction", dependencies: ["original"] }),
      event(11, "guidance_added", { task_id: "correction", message: "adjust" }),
      event(12, "goal_criteria_declared", [
        {
          id: "steer-criterion",
          description: "corrected behavior works",
          task_id: "correction",
          check_ids: ["unit"],
        },
      ]),
    ],
  );

  const text = formatGoalLedger(ledger, limits);
  expect(text).toContain("Goal ledger · run-1 · active");
  expect(text).toContain("Verified 1/2");
  expect(text).toContain(`✓ original-criterion · verified · task original · unit (no receipt)`);
  expect(text).toContain(`! steer-criterion · pending · task correction (steer)`);

  const compact = formatGoalLedger(ledger, { ...limits, listLineLimit: 3 });
  expect(compact).toContain("… 2 more criteria (use --json for the full report)");

  const empty = formatGoalLedger(
    goalLedger({ runId: "run-1", runState: "active", tasks: [], criteria: [] }, []),
    limits,
  );
  expect(empty).toContain("Verified 0/0");
  expect(empty).toContain("No goal criteria declared for this run");
});
