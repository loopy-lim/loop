import { describe, expect, test } from "bun:test";

import type {
  AttentionSnapshotOutput,
  GoalCriterionStatusOutput,
  SnapshotOutput,
} from "@loop/protocol";

import {
  attentionCause,
  attentionCriteria,
  attentionEvidencePath,
  attentionResolutions,
  attentionSeverity,
  renderAttention,
} from "../src/attention";

const limits = {
  statusLineLimit: 8,
  attentionLineLimit: 6,
  findingsLineLimit: 5,
  listLineLimit: 8,
  lineTextLimit: 160,
};

const nowMs = 1_000_000;

function attention(overrides: Partial<AttentionSnapshotOutput> = {}): AttentionSnapshotOutput {
  return {
    id: "failure-run-1-impl-0-timeout-exhausted",
    kind: "failure",
    summary: "Worker timeout retry budget exhausted: exit 1",
    taskId: "impl",
    openedAtMs: nowMs - 185_000,
    ...overrides,
  };
}

function criterion(overrides: Partial<GoalCriterionStatusOutput> = {}): GoalCriterionStatusOutput {
  return {
    id: "pair-check",
    description: "Pair check passes",
    taskId: "impl",
    checkIds: ["tests"],
    state: "pending",
    ...overrides,
  };
}

function snapshot(overrides: Partial<SnapshotOutput> = {}): SnapshotOutput {
  return {
    runId: "run-1",
    state: "attention",
    intent: "intent",
    workingDirectory: "/repo",
    guidance: [],
    goalCriteria: [],
    openAttentionIds: [],
    attention: [],
    lastSequence: 0,
    tasks: [],
    activeWorkers: [],
    ...overrides,
  };
}

function open(items: AttentionSnapshotOutput[]): SnapshotOutput {
  return snapshot({
    attention: items,
    openAttentionIds: items.map((item) => item.id),
    goalCriteria: [criterion(), criterion({ id: "types-check", description: "Types pass" })],
  });
}

describe("attention composition policy", () => {
  test("severity is derived deterministically from kind", () => {
    expect(attentionSeverity("failure")).toBe("high");
    expect(attentionSeverity("conflict")).toBe("high");
    expect(attentionSeverity("approval")).toBe("medium");
    expect(attentionSeverity("decision")).toBe("medium");
    expect(attentionSeverity("question")).toBe("low");
  });

  test("resolutions match the CLI resolve vocabulary per kind", () => {
    expect(attentionResolutions("failure")).toEqual(["retry", "cancel"]);
    expect(attentionResolutions("approval")).toEqual(["approve", "reject"]);
    expect(attentionResolutions("question")).toEqual(["answer"]);
    expect(attentionResolutions("decision")).toEqual(["answer"]);
    expect(attentionResolutions("conflict")).toEqual(["answer"]);
  });

  test("evidence path extraction finds saved artifact paths", () => {
    const path = "/repo/mytest.db.artifacts/run-1/impl/tests-ab12cd34-5678abcdef.txt";
    expect(attentionEvidencePath(`Redacted output artifact saved: ${path}`)).toBe(path);
    expect(attentionEvidencePath(`failed: exit 1. saved: ${path}.`)).toBe(path);
    expect(attentionEvidencePath("no artifact here")).toBeUndefined();
    expect(attentionEvidencePath("")).toBeUndefined();
  });

  test("criteria are the affected task's unverified goal criteria", () => {
    const view = open([attention(), attention({ id: "other", taskId: "review" })]);
    expect(attentionCriteria(view, view.attention[0]!)).toEqual(["pair-check", "types-check"]);
    expect(
      attentionCriteria(
        snapshot({ goalCriteria: [criterion({ state: "verified" })] }),
        attention(),
      ),
    ).toEqual([]);
    expect(attentionCriteria(snapshot(), attention({ taskId: null }))).toEqual([]);
  });

  test("cause flattens newlines and never clips length", () => {
    const long = "x".repeat(500);
    expect(attentionCause(`line one\nline two\r\nline three`)).toBe("line one line two line three");
    expect(attentionCause(`  ${long}  `)).toBe(long);
    expect(attentionCause("   ")).toBeUndefined();
  });
});

describe("attention rendering", () => {
  test("single attention renders kind, severity, id, task, waited, criteria, cause, evidence, resolutions", () => {
    const path = "/repo/mytest.db.artifacts/run-1/impl/tests-ab12cd34-5678abcdef.txt";
    const item = attention({
      summary: `Worker timeout retry budget exhausted: exit 1\nRedacted output artifact saved: ${path}`,
    });
    const output = renderAttention(open([item]), limits, { nowMs });
    const lines = output.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe(
      "failure · high · failure-run-1-impl-0-timeout-exhausted · task impl · waited 3m05s",
    );
    expect(lines[1]).toBe("  criteria: pair-check, types-check");
    expect(lines[2]).toContain("  cause: Worker timeout retry budget exhausted: exit 1");
    expect(lines[3]).toBe(`  evidence: ${path}`);
    expect(lines[4]).toBe("  resolutions: retry / cancel");
    expect(lines[5]).toBe(
      "Next: /loop resolve run-1 failure-run-1-impl-0-timeout-exhausted <resolution>",
    );
  });

  test("the actionable cause line is never truncated, even beyond lineTextLimit", () => {
    const longCause = `budget exhausted: ${"x".repeat(400)}`;
    const output = renderAttention(open([attention({ summary: longCause })]), limits, { nowMs });
    expect(output).toContain(`cause: ${longCause}`);
    // The old renderer clipped every line at lineTextLimit (160) behind an
    // ellipsis; the enriched view must keep the whole cause.
    expect(output).not.toContain("…");
    expect(output).toContain(longCause.slice(-40));
  });

  test("ids and paths render verbatim in monospace discipline", () => {
    const path = "/repo/mytest.db.artifacts/run-1/impl/check-99aa.txt";
    const output = renderAttention(
      open([attention({ summary: `saved: ${path}` })]),
      limits,
      { nowMs },
    );
    expect(output).toContain("failure-run-1-impl-0-timeout-exhausted");
    expect(output).toContain(`evidence: ${path}`);
    expect(output).not.toContain('"');
    expect(output).not.toContain("'`");
  });

  test("approval and question attentions advertise their own resolutions", () => {
    const approval = renderAttention(
      open([attention({ kind: "approval", id: "gate-1", summary: "Approve deploy" })]),
      limits,
      { nowMs },
    );
    expect(approval).toContain("approval · medium · gate-1");
    expect(approval).toContain("resolutions: approve / reject");
    const question = renderAttention(
      open([attention({ kind: "question", id: "ask-1", summary: "Which schema?" })]),
      limits,
      { nowMs },
    );
    expect(question).toContain("question · low · ask-1");
    expect(question).toContain("resolutions: answer");
  });

  test("multiple attentions keep the line budget and never truncate any cause", () => {
    const longCause = (n: number) => `cause text number ${n} ${"y".repeat(300)}`;
    const items = Array.from({ length: 4 }, (_, index) =>
      attention({
        id: `attention-${index + 1}`,
        summary: longCause(index + 1),
        kind: (["failure", "approval", "question", "decision"] as const)[index],
      }),
    );
    const output = renderAttention(open(items), limits, { nowMs });
    const lines = output.split("\n");
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(lines[0]).toBe("Attention: 4 open");
    expect(lines.at(-1)).toBe("Next: /loop resolve run-1 attention-1 <resolution>");
    // Four compact lines fit the six-line budget, so nothing is omitted;
    // every compact line still carries its whole cause.
    expect(output).toContain(longCause(1));
    expect(output).toContain(longCause(2));
    expect(output).toContain(longCause(3));
    expect(output).toContain(longCause(4));
    expect(output).not.toContain("…");
  });

  test("compact lines carry kind, id, task, waited, cause, severity, and resolutions", () => {
    const items = Array.from({ length: 4 }, (_, index) =>
      attention({ id: `attention-${index + 1}`, kind: "approval", summary: `Approve ${index + 1}` }),
    );
    const lines = renderAttention(open(items), limits, { nowMs }).split("\n");
    expect(lines[1]).toBe(
      "approval attention-1 · impl · waited 3m05s · Approve 1 · medium · resolutions approve / reject",
    );
  });

  test("seven open attentions stay within six lines with the next command preserved", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      id: `attention-${index + 1}`,
      kind: "approval" as const,
      summary: `Approve option ${index + 1}`,
      taskId: "impl",
      openedAtMs: null,
    }));
    const output = renderAttention(snapshot({ attention: items, openAttentionIds: items.map((item) => item.id) }), limits);
    const lines = output.split("\n");
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(output).toContain("approval attention-1 · impl · Approve option 1");
    expect(lines.at(-1)).toBe("Next: /loop resolve run-1 attention-1 <resolution>");
  });

  test("attention overflow stays bounded when compact lines exhaust the budget", () => {
    const items = Array.from({ length: 7 }, (_, index) =>
      attention({ id: `attention-${index + 1}`, summary: `Cause ${index + 1}` }),
    );
    const output = renderAttention(open(items), limits, { nowMs });
    const lines = output.split("\n");
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(lines[0]).toBe("Attention: 7 open");
    expect(lines).toContain("… 4 more attention items");
    expect(lines.at(-1)).toBe("Next: /loop resolve run-1 attention-1 <resolution>");
  });

  test("unknown open ids fall back to the bare-id list the CLI pins", () => {
    const output = renderAttention(
      snapshot({
        openAttentionIds: Array.from({ length: 7 }, (_, index) => `attention-${index + 1}`),
      }),
      { ...limits, attentionLineLimit: 4 },
    );
    expect(output.split("\n")).toEqual([
      "Attention: 7 open",
      "attention-1",
      "… 6 more attention items",
      "Next: /loop resolve run-1 attention-1 <resolution>",
    ]);
  });

  test("no open attention renders the OK empty state", () => {
    expect(renderAttention(snapshot(), limits)).toBe("OK");
  });

  test("a one-line budget keeps only the next command", () => {
    const output = renderAttention(open([attention()]), { ...limits, attentionLineLimit: 1 });
    expect(output).toBe(
      "Next: /loop resolve run-1 failure-run-1-impl-0-timeout-exhausted <resolution>",
    );
  });
});
