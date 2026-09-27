import { describe, expect, test } from "bun:test";

import { mirrorPaneLabel, workerLabel, workerRunMarker } from "../src/client";

describe("workerLabel", () => {
  test("formats taskId·kind·attempt with the documented aliases", () => {
    expect(workerLabel({ taskId: "impl-protocol-unify", kind: "implementation", attempt: 0 }))
      .toBe("impl-protocol-unify·impl·a0");
    expect(workerLabel({ taskId: "fact-simplify-audit", kind: "research", attempt: 1 }))
      .toBe("fact-simplify-audit·research·a1");
    expect(workerLabel({ taskId: "gate-release", kind: "verification", attempt: 2 }))
      .toBe("gate-release·verify·a2");
    expect(workerLabel({ taskId: "d-1", kind: "decision", attempt: 0 }))
      .toBe("d-1·decision·a0");
    expect(workerLabel({ taskId: "bridge-codegen", kind: "integration", attempt: 0 }))
      .toBe("bridge-codegen·integration·a0");
  });

  test("unknown kinds fall back to a compact sanitized slug", () => {
    expect(workerLabel({ taskId: "t-1", kind: "Exploratory Audit", attempt: 0 }))
      .toBe("t-1·explorat·a0");
    expect(workerLabel({ taskId: "t-1", kind: "???", attempt: 3 }))
      .toBe("t-1·work·a3");
  });

  test("long taskIds preserve the taskId first and keep the suffix intact within 32 chars", () => {
    const taskId = "implement-search-and-replace-across-the-monorepo";
    const label = workerLabel({ taskId, kind: "implementation", attempt: 12 });
    expect(label.length).toBeLessThanOrEqual(32);
    expect(label.endsWith("·impl·a12")).toBe(true);
    expect(label.startsWith("implement-search")).toBe(true);
    // The rule is deterministic: same input, same label.
    expect(label).toBe(workerLabel({ taskId, kind: "implementation", attempt: 12 }));
  });

  test("an empty taskId degrades to a placeholder instead of an empty head", () => {
    expect(workerLabel({ taskId: "  ", kind: "research", attempt: 0 })).toBe("task·research·a0");
  });

  test("worker tabs include a stable run marker within Herdr's label limit", () => {
    const first = workerLabel({ taskId: "implement-normalize-tags", kind: "implementation", attempt: 0, runId: "loop-9dae9271-53a0" });
    const second = workerLabel({ taskId: "implement-normalize-tags", kind: "implementation", attempt: 0, runId: "loop-0207f6a8-ad7b" });
    expect(first).not.toBe(second);
    expect(first).toEndWith(`·${workerRunMarker("loop-9dae9271-53a0")}`);
    expect(first.length).toBeLessThanOrEqual(32);
    expect(first).toStartWith("implement-");
  });
});

describe("mirrorPaneLabel", () => {
  test("prefixes the shared taskId vocabulary", () => {
    expect(mirrorPaneLabel("t-1")).toBe("mirror·t-1");
    expect(mirrorPaneLabel("impl-protocol-unify")).toBe("mirror·impl-protocol-unify");
  });

  test("caps long taskIds at the same 32-character label budget", () => {
    const label = mirrorPaneLabel("x".repeat(64));
    expect(label.length).toBeLessThanOrEqual(32);
    expect(label).toBe(`mirror·${"x".repeat(25)}`);
  });
});
