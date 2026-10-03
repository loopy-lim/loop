import { expect, test } from "bun:test";
import type { SnapshotOutput } from "@loop/protocol";
import { classifyRunHealth } from "../src/health";
import * as protocol from "@loop/protocol";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCli } from "../src/main";

const base: SnapshotOutput = {
  runId: "run",
  state: "active",
  tasks: [
    {
      id: "work",
      title: "Work",
      kind: "implementation",
      state: "ready",
      attempt: 0,
      preferredCompute: "fast",
      dependencies: [],
      readScope: [],
      writeScope: [],
      blockedBy: [],
      activities: [],
      resultSummary: null,
      lastFailure: null,
    },
  ],
  activeWorkers: [],
  openAttentionIds: [],
  attention: [],
  intent: "Work",
  workingDirectory: ".",
  guidance: [],
  goalCriteria: [],
  lastSequence: 1,
  executionOwner: null,
  executionExpiresAt: null,
};

test("health classification distinguishes stopped owners from paused and active work", () => {
  const now = 1000;
  expect(classifyRunHealth(base, now)).toBe("owner_missing_ready");
  expect(
    classifyRunHealth({ ...base, executionOwner: "owner", executionExpiresAt: 1500 }, now),
  ).toBeNull();
  expect(
    classifyRunHealth({ ...base, executionOwner: "owner", executionExpiresAt: 999 }, now),
  ).toBe("owner_missing_ready");
  expect(
    classifyRunHealth({ ...base, activeWorkers: [{ id: "worker", taskId: "work" }] }, now),
  ).toBe("owner_lost_in_flight");
  expect(classifyRunHealth({ ...base, state: "paused" }, now)).toBeNull();
  expect(classifyRunHealth({ ...base, state: "attention" }, now)).toBeNull();
  expect(classifyRunHealth({ ...base, state: "completed" }, now)).toBeNull();
});

test("health command reports unfinished runs without starting an owner", async () => {
  await protocol.rustra.ready();
  const directory = mkdtempSync(join(tmpdir(), "loop-health-"));
  const databasePath = join(directory, "run.db");
  await protocol.prepareRun({
    databasePath,
    runId: "orphan",
    intent: "Work",
    workingDirectory: directory,
    tasks: [
      {
        id: "work",
        title: "Work",
        kind: "implementation",
        dependencies: [],
        readScope: [],
        writeScope: ["result.txt"],
        requirements: ["Result exists"],
        completionChecks: [
          {
            id: "result",
            command: "test",
            args: ["-f", "result.txt"],
            workingDirectory: null,
            timeoutMs: 1000,
          },
        ],
        preferredCompute: "fast",
        minimumCompute: "fast",
        maximumCompute: "fast",
        maxAttempts: 1,
      },
    ],
  });
  const output: string[] = [];
  const code = await runCli(
    [
      "health",
      "--config",
      join(resolve(import.meta.dir, "../../.."), "config"),
      "--database",
      databasePath,
      "--json",
    ],
    {
      io: { stdout: (value) => output.push(value), stderr: (value) => output.push(value) },
    },
  );
  expect(code).toBe(0);
  expect(JSON.parse(output.join("")).findings).toEqual([
    { runId: "orphan", kind: "owner_missing_ready" },
  ]);
});
