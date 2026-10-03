import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskSpecInput } from "@loop/protocol";

import {
  CODE_MAP_ENTRY_ID,
  buildScopeCodeMap,
  scopeRoots,
  withCodeMapEntry,
} from "../src/code-map";
import type { TaskContextOutput } from "@loop/protocol";

function task(overrides: Partial<TaskSpecInput> = {}): TaskSpecInput {
  return {
    id: "t1",
    title: "t1",
    kind: "implementation",
    dependencies: [],
    readScope: ["src/**"],
    writeScope: [],
    requirements: [],
    completionChecks: [],
    preferredCompute: "fast",
    minimumCompute: "fast",
    maximumCompute: "fast",
    maxAttempts: 1,
    ...overrides,
  };
}

test("scopeRoots keeps only literal leading directories", () => {
  expect(scopeRoots(["packages/core/src/**", "docs/*.md", "**/*.ts", "../escape/**"])).toEqual([
    "packages/core/src",
    "docs",
  ]);
});

test("buildScopeCodeMap lists scoped files with declaration names and respects caps", () => {
  const root = mkdtempSync(join(tmpdir(), "loop-code-map-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "alpha.ts"),
    "export interface Alpha {}\nexport function beta() {}\n",
  );
  mkdirSync(join(root, "outside"), { recursive: true });
  writeFileSync(join(root, "outside", "gamma.ts"), "export const gamma = 1;\n");

  const map = buildScopeCodeMap({ task: task({ readScope: ["src/**"] }), workingDirectory: root });
  expect(map).toBeDefined();
  expect(map).toContain("src/alpha.ts");
  expect(map).toContain("Alpha, beta");
  expect(map).not.toContain("outside/gamma.ts");
  expect(map!.length).toBeLessThanOrEqual(1_201);

  // Scopes that resolve to nothing yield no map (advisory never invents).
  expect(
    buildScopeCodeMap({ task: task({ readScope: ["missing/**"] }), workingDirectory: root }),
  ).toBeUndefined();
  expect(
    buildScopeCodeMap({ task: task({ readScope: [], writeScope: [] }), workingDirectory: root }),
  ).toBeUndefined();
});

test("withCodeMapEntry appends one bounded synthetic advisory entry", () => {
  const base: TaskContextOutput = {
    intent: "i",
    workingDirectory: "/repo",
    task: task(),
    attempt: 0,
    dependencyResults: [],
    resultSummary: null,
    previousChecks: [],
    guidance: [],
  };
  const mapped = withCodeMapEntry(base, "src/a.ts · A");
  expect(mapped.dependencyResults).toHaveLength(1);
  expect(mapped.dependencyResults[0]!.taskId).toBe(CODE_MAP_ENTRY_ID);
  expect(mapped.dependencyResults[0]!.title).toContain("advisory");
  expect(mapped.dependencyResults[0]!.summary).toBe("src/a.ts · A");
  // The input is never mutated, and an empty map injects nothing.
  expect(base.dependencyResults).toHaveLength(0);
  expect(withCodeMapEntry(base, "   ")).toBe(base);
  expect(withCodeMapEntry(base, undefined)).toBe(base);

  const oversized = "x".repeat(2_000);
  expect(
    withCodeMapEntry(base, oversized)!.dependencyResults[0]!.summary.length,
  ).toBeLessThanOrEqual(1_200);
});
