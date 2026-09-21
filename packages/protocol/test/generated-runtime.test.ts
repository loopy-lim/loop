import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRun, getSnapshot, rustra, submitPlan } from "../src/generated/bun";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "loop-rustra-"));
const databasePath = join(temporaryDirectory, "loop.sqlite");

beforeAll(async () => {
  await rustra.ready();
});

afterAll(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("generated Bun commands drive a complete persisted plan setup", async () => {
  const created = await createRun({ databasePath, runId: "generated-run" });
  expect(created.state).toBe("active");

  const submitted = await submitPlan({
    databasePath,
    runId: "generated-run",
    tasks: [
      {
        id: "research",
        title: "Inspect the repository",
        kind: "research",
        dependencies: [],
        readScope: ["**/*"],
        writeScope: [],
        requirements: [],
        completionChecks: [
          {
            id: "evidence-recorded",
            command: "true",
            args: [],
            workingDirectory: null,
            timeoutMs: 1_000,
          },
        ],
        preferredCompute: "fast",
        minimumCompute: "tiny",
        maximumCompute: "strong",
        maxAttempts: 2,
      },
    ],
  });
  expect(submitted.taskCount).toBe(1);

  const snapshot = await getSnapshot({ databasePath, runId: "generated-run" });
  expect(snapshot.tasks).toHaveLength(1);
  expect(snapshot.tasks[0]?.kind).toBe("research");
  expect(snapshot.activeWorkers).toEqual([]);
});

test("generated TypeScript preserves Rust enum domains", () => {
  const generated = readFileSync(
    resolve(import.meta.dir, "../src/generated/types.ts"),
    "utf8",
  );
  expect(generated).toContain("export type TaskKind =");
  expect(generated).toContain("export type ComputeClass =");
  expect(generated).not.toContain("kind: string;");
  expect(generated).not.toContain("preferredCompute: string;");
});
