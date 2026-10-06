import { expect, test } from "bun:test";

import type { AttentionSnapshotOutput, TaskSpecInput } from "@loop/protocol";

import {
  describeBlockedConstraints,
  isRoutingConstraintFailure,
  renderAttentionQuestion,
} from "./attention-question";
import type { OutputLimits } from "@loop/presentation";

const limits: OutputLimits = {
  statusLineLimit: 8,
  attentionLineLimit: 6,
  findingsLineLimit: 5,
  listLineLimit: 8,
  lineTextLimit: 160,
};

const failure: AttentionSnapshotOutput = {
  id: "provider-run-1-impl-0",
  kind: "failure",
  summary: "no eligible compute candidate satisfies task constraints",
  taskId: "impl",
};

test("every attention renders as an answerable question with options", () => {
  for (const kind of [
    "question",
    "decision",
    "approval",
    "conflict",
    "failure",
  ] as const) {
    const rendered = renderAttentionQuestion(
      { ...failure, kind, summary: `the run needs your call (${kind})` },
      limits,
    );
    expect(rendered).toContain("Decision needed: the run needs your call");
    expect(rendered).toContain("Answerable options — ");
  }
});

test("a failure attention advertises the full bridge resolution vocabulary", () => {
  const rendered = renderAttentionQuestion(failure, limits);
  for (const option of [
    "retry",
    "defer",
    "cancel",
    "add_task",
    "correctiveTask",
    "relax_routing",
  ]) {
    expect(rendered).toContain(option);
  }
});

test("an unknown attention still renders an answerable decision question", () => {
  const rendered = renderAttentionQuestion(undefined, limits);
  expect(rendered).toContain("Loop attention ? (decision)");
  expect(rendered).toContain("Decision needed: Decision needed");
  expect(rendered).toContain("Answerable options — ");
});

const constrainedSpec: TaskSpecInput = {
  id: "impl",
  title: "Implement the fix",
  kind: "implementation",
  dependencies: [],
  readScope: [],
  writeScope: ["crates/**"],
  requirements: [],
  completionChecks: [],
  preferredCompute: "balanced",
  minimumCompute: "balanced",
  maximumCompute: "strong",
  routing: {
    risk: "high",
    required: { coding: 2, reasoning: 1, tools: 2, vision: 0, long_context: 0 },
  },
  maxAttempts: 3,
};

test("a batch-absence failure is detected and names the blocked constraints it can relax", () => {
  expect(isRoutingConstraintFailure(failure.summary)).toBe(true);
  expect(isRoutingConstraintFailure("worker lease expired")).toBe(false);
  const rendered = renderAttentionQuestion(
    failure,
    limits,
    describeBlockedConstraints(constrainedSpec),
  );
  expect(rendered).toContain("Blocked constraints — ");
  expect(rendered).toContain("requires coding=2 reasoning=1 tools=2");
  expect(rendered).toContain("risk high");
  expect(rendered).toContain("compute balanced..strong");
  // The same render still carries the answerable options, including the
  // relaxation path that targets exactly these constraints.
  expect(rendered).toContain("relax_routing");
});

test("a batch-absence failure without a task spec still renders an answerable question", () => {
  const rendered = renderAttentionQuestion(failure, limits);
  expect(rendered).not.toContain("Blocked constraints");
  expect(rendered).toContain("Decision needed: no eligible compute candidate");
  expect(rendered).toContain("Answerable options — ");
});

test("constraint description falls back to named requirements when routing levels are absent", () => {
  const rendered = describeBlockedConstraints({
    ...constrainedSpec,
    requirements: ["rust", "typescript"],
    routing: null,
  });
  expect(rendered).toContain("requires rust typescript");
  expect(rendered).not.toContain("risk");
  expect(rendered).toContain("compute balanced..strong");
});
