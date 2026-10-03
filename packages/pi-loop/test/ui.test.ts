import { expect, test } from "bun:test";

import type { SnapshotOutput, TaskContextOutput } from "@loop/protocol";

import {
  compactFindings,
  renderAttention,
  renderGraph,
  renderModels,
  renderRunSummary,
  renderRuns,
  renderSnapshot,
  renderStatus,
  renderTaskContext,
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
  const output = renderRunSummary(
    {
      tasks: 7,
      implementationBranches: 2,
      checksPassed: true,
      escalations: [{ taskId: "impl-b", from: "fast", to: "strong" }],
      changedFiles: 6,
    },
    limits,
  );
  expect(output).toContain("✓ 7 tasks");
  expect(output).toContain("↗ 1 task escalated from fast → strong");
  expect(output.split("\n").length).toBeLessThanOrEqual(8);
});

test("model and worker lists keep first occurrence and original order", () => {
  expect(renderModels(["fast · a", "strong · b", "fast · a"], limits)).toBe("fast · a\nstrong · b");
  expect(
    renderWorkers(
      [
        { id: "w1", provider: "zai", state: "running" },
        { id: "w2", provider: "zai", state: "running" },
        { id: "w1", provider: "zai", state: "running" },
      ],
      limits,
    ),
  ).toBe("w1 · zai · running\nw2 · zai · running");
});

test("completed task status and graph favor successful result over an old failed attempt", () => {
  const complete: SnapshotOutput = {
    runId: "repaired",
    state: "completed",
    intent: "Fix contract",
    workingDirectory: "/project",
    guidance: [],
    goalCriteria: [],
    lastSequence: 8,
    activeWorkers: [],
    openAttentionIds: [],
    attention: [],
    tasks: [
      {
        id: "impl",
        title: "Implement",
        kind: "implementation",
        state: "done",
        attempt: 4,
        preferredCompute: "fast",
        dependencies: [],
        readScope: [],
        writeScope: ["src/file.ts"],
        blockedBy: [],
        activities: [],
        lastFailure: "old contract mismatch",
        resultSummary: "native check passed",
      },
    ],
  };
  for (const action of ["status", "graph"]) {
    const output = renderSnapshot(action, complete, limits);
    expect(output).toContain("native check passed");
    expect(output).not.toContain("old contract mismatch");
  }
});

test("default status stays within eight lines and answers current progress", () => {
  const output = renderStatus(
    {
      runId: "8K2",
      stages: Array.from({ length: 9 }, (_, index) => ({
        name: index === 2 ? "Implementation" : `Stage ${index + 1}`,
        done: index === 2 ? 2 : 0,
        total: index === 2 ? 4 : 1,
        state: index === 2 ? ("working" as const) : ("waiting" as const),
      })),
      workers: 3,
      attention: 0,
    },
    limits,
  );
  expect(output.split("\n").length).toBeLessThanOrEqual(8);
  expect(output).toContain("Implementation 2/4 ●");
  expect(output).toContain("Workers: 3 · Attention: 0");
  expect(output.split("\n").at(-2)).toMatch(/^… \d+ more status lines$/);
});

test("attention stays within six lines and findings are exception-driven", () => {
  const attention = renderAttention(
    {
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
    },
    limits,
  );
  expect(attention.split("\n").length).toBeLessThanOrEqual(6);
  expect(attention).toContain("Choose migration mode");
  expect(attention).toContain("… 3 more options");

  const findings = compactFindings(
    Array.from({ length: 9 }, (_, index) => ({
      severity: index % 2 ? ("FIX" as const) : ("BLOCK" as const),
      finding: `finding-${index}`,
      evidence: `evidence-${index}`,
      action: `action-${index}`,
    })),
    limits,
  );
  expect(findings).toHaveLength(5);
  expect(
    findings.slice(0, 4).map((entry) => entry.kind === "finding" && entry.value.severity),
  ).toEqual(["BLOCK", "BLOCK", "BLOCK", "BLOCK"]);
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
  ] as const) {
    expect(output.split("\n")).toHaveLength(8);
    expect(output.split("\n").at(-1)).toBe(summary);
  }
});

test("generated snapshots render graph state, activity, results, failures, and scopes compactly", () => {
  const snapshot = richSnapshot();

  const graph = renderSnapshot("graph", snapshot, limits);
  expect(graph).toContain("research ← root");
  expect(graph).toContain("impl ← research");
  expect(graph).toContain("blocked: review");
  expect(graph).toContain("r: src/**");
  expect(graph).toContain("w: src/impl.ts");

  const status = renderSnapshot("status", snapshot, limits);
  expect(status).toContain("Inspecting call sites");
  expect(status).toContain("Found the protocol seam");
  expect(status).toContain("Typecheck failed");
  expect(status.split("\n").length).toBeLessThanOrEqual(8);
});

test("snapshot attention is actionable and preserves the next command within six lines", () => {
  const snapshot = richSnapshot({
    attention: Array.from({ length: 7 }, (_, index) => ({
      id: `attention-${index + 1}`,
      kind: "approval" as const,
      summary: `Approve option ${index + 1}`,
      taskId: "impl",
    })),
    openAttentionIds: Array.from({ length: 7 }, (_, index) => `attention-${index + 1}`),
  });

  const output = renderSnapshot("attention", snapshot, limits);
  expect(output.split("\n").length).toBeLessThanOrEqual(6);
  expect(output).toContain("approval attention-1 · impl · Approve option 1");
  expect(output.split("\n").at(-1)).toBe("Next: /loop resolve render-run attention-1 <resolution>");
});

test("run discovery and generated task context stay bounded and show execution evidence", () => {
  const runs = renderRuns(
    Array.from({ length: 10 }, (_, index) => ({
      runId: `run-${index + 1}`,
      state: index === 0 ? ("attention" as const) : ("active" as const),
    })),
    limits,
  );
  expect(runs.split("\n")).toHaveLength(8);
  expect(runs.split("\n").at(-1)).toBe("… 3 more runs");

  const context: TaskContextOutput = {
    intent: "Implement compact status",
    workingDirectory: "/project",
    task: {
      id: "impl",
      title: "Implement rendering",
      kind: "implementation",
      dependencies: ["research"],
      readScope: ["packages/protocol/**"],
      writeScope: ["packages/presentation/**"],
      requirements: ["Keep status within eight lines"],
      completionChecks: [
        {
          id: "tests",
          command: "bun",
          args: ["test", "packages/pi-loop"],
          workingDirectory: null,
          timeoutMs: 120_000,
        },
      ],
      preferredCompute: "fast",
      minimumCompute: "tiny",
      maximumCompute: "strong",
      maxAttempts: 3,
    },
    attempt: 2,
    dependencyResults: [
      {
        taskId: "research",
        title: "Inspect protocol",
        summary: "SnapshotOutput owns the display fields",
      },
    ],
    resultSummary: "Renderer implemented with generated types",
    previousFailure: "Previous typecheck failed",
    previousChecks: [
      {
        id: "tests",
        command: "bun",
        args: ["test"],
        workingDirectory: "/project",
        exitCode: 1,
        stdout: "",
        stderr: "expected status line",
        timedOut: false,
        durationMs: 12,
        source: {
          beforeFingerprint: "before",
          afterFingerprint: "after",
          observedChangedPaths: ["packages/presentation/src/snapshot.ts", "docs/other.md"],
          observedOutsideWriteScope: ["docs/other.md"],
        },
      },
    ],
    guidance: ["Preserve the generated type boundary"],
  };
  const detail = renderTaskContext(context, limits);
  expect(detail).toContain("Dependencies: research");
  expect(detail).toContain("Read: packages/protocol/**");
  expect(detail).toContain("Write: packages/presentation/**");
  expect(detail).toContain("Result research: SnapshotOutput owns the display fields");
  expect(detail).toContain("Result: Renderer implemented with generated types");
  expect(detail).toContain("Failure: Previous typecheck failed");
  expect(detail).toContain(
    "Check tests · exit 1 · source changed · 1 path(s) outside write scope (writer unknown) · expected status line",
  );
  expect(detail.split("\n").length).toBeLessThanOrEqual(8);
});

test("status prioritizes attention and active work before completed history", () => {
  const snapshot = richSnapshot({
    tasks: [
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `done-${index + 1}`,
        title: `Done ${index + 1}`,
        kind: "implementation" as const,
        state: "done" as const,
        attempt: 1,
        preferredCompute: "fast" as const,
        dependencies: [],
        readScope: [],
        writeScope: [],
        blockedBy: [],
        activities: [],
        resultSummary: "complete",
      })),
      {
        id: "current",
        title: "Current work",
        kind: "implementation",
        state: "running",
        attempt: 1,
        preferredCompute: "fast",
        dependencies: [],
        readScope: [],
        writeScope: ["src/current.ts"],
        blockedBy: [],
        activities: ["Editing current work"],
      },
    ],
  });

  const output = renderSnapshot("status", snapshot, limits);
  expect(output).toContain("current · running · Current work · activity: Editing current work");
  expect(output).not.toContain("done-5");
  expect(output.split("\n").length).toBeLessThanOrEqual(8);
});

test("every renderer normalizes line breaks and caps lines at 160 graphemes", () => {
  const output = renderWorkers(
    [
      {
        id: `worker\r\n${"👩🏽‍💻".repeat(200)}`,
        provider: "pi",
        state: "working",
      },
    ],
    limits,
  );
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

function richSnapshot(overrides: Partial<SnapshotOutput> = {}): SnapshotOutput {
  return {
    runId: "render-run",
    state: "attention",
    tasks: [
      {
        id: "research",
        title: "Inspect protocol",
        kind: "research",
        state: "done",
        attempt: 1,
        preferredCompute: "fast",
        dependencies: [],
        readScope: ["packages/protocol/**"],
        writeScope: [],
        blockedBy: [],
        activities: [],
        resultSummary: "Found the protocol seam",
      },
      {
        id: "impl",
        title: "Implement rendering",
        kind: "implementation",
        state: "blocked",
        attempt: 2,
        preferredCompute: "fast",
        dependencies: ["research"],
        readScope: ["src/**"],
        writeScope: ["src/impl.ts"],
        blockedBy: ["review"],
        activities: ["Inspecting call sites"],
        lastFailure: "Typecheck failed",
      },
    ],
    activeWorkers: [],
    openAttentionIds: ["review"],
    attention: [{ id: "review", kind: "approval", summary: "Approve the edit", taskId: "impl" }],
    intent: "Implement compact status",
    workingDirectory: "/project",
    guidance: [],
    goalCriteria: [],
    lastSequence: 12,
    ...overrides,
  };
}
