import { expect, test } from "bun:test";
import type { GoalCriterionInput, TaskSpecInput } from "@loop/protocol";
import { validateGoalPlan } from "../src/lead/decompose";

function task(
  id: string,
  requirements: string[],
  checkIds: string[],
  dependencies: string[] = [],
): TaskSpecInput {
  return {
    id,
    title: id,
    kind: "implementation",
    dependencies,
    readScope: ["src/**"],
    writeScope: [`src/${id}.ts`],
    requirements,
    completionChecks: checkIds.map((checkId) => ({
      id: checkId,
      command: "bun",
      args: ["test"],
      workingDirectory: null,
      timeoutMs: 1000,
    })),
    preferredCompute: "fast",
    minimumCompute: "tiny",
    maximumCompute: "strong",
    maxAttempts: 2,
    routing: {
      risk: "low",
      required: { coding: 1, reasoning: 1, tools: 1, vision: 0, long_context: 0 },
    },
  };
}

function criterion(taskId: string, description: string, checkIds: string[]): GoalCriterionInput {
  return { id: `${taskId}:${description}`, taskId, description, checkIds };
}

test("each requirement has an explicit, task-local executable check mapping", () => {
  const implementation = task("impl", ["renders", "persists"], ["ui", "storage"]);
  expect(
    validateGoalPlan({
      tasks: [implementation],
      criteria: [criterion("impl", "renders", ["ui"]), criterion("impl", "persists", ["storage"])],
    }).criteria.map((item) => item.checkIds),
  ).toEqual([["ui"], ["storage"]]);
  expect(() =>
    validateGoalPlan({ tasks: [implementation], criteria: [criterion("impl", "renders", ["ui"])] }),
  ).toThrow(/persists/);
  expect(() =>
    validateGoalPlan({
      tasks: [implementation],
      criteria: [
        criterion("impl", "renders", ["storage"]),
        criterion("impl", "persists", ["missing"]),
      ],
    }),
  ).toThrow(/missing/);
});

test("multi-implementation plans need one downstream integration gate", () => {
  const left = task("left", ["left works"], ["left-check"]);
  const right = task("right", ["right works"], ["right-check"]);
  const criteria = [
    criterion("left", "left works", ["left-check"]),
    criterion("right", "right works", ["right-check"]),
  ];
  expect(() => validateGoalPlan({ tasks: [left, right], criteria })).toThrow(/integration/);
  const integration = {
    ...task("integrate", ["combined result works"], ["combined"], ["left", "right"]),
    kind: "integration" as const,
  };
  expect(
    validateGoalPlan({
      tasks: [left, right, integration],
      criteria: [...criteria, criterion("integrate", "combined result works", ["combined"])],
    }).tasks,
  ).toHaveLength(3);
  expect(() =>
    validateGoalPlan({
      tasks: [left, right, { ...integration, dependencies: ["left"] }],
      criteria: [...criteria, criterion("integrate", "combined result works", ["combined"])],
    }),
  ).toThrow(/right/);
});
