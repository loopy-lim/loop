import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as protocol from "@loop/protocol";
import type { SnapshotOutput } from "@loop/protocol";
import { nightlyDisposition, withNightlyLock } from "../src/nightly";
import { runCli } from "../src/main";

function snapshot(overrides: Partial<SnapshotOutput> = {}): SnapshotOutput {
  return {
    runId: "unfinished",
    state: "active",
    tasks: [
      {
        id: "task",
        title: "Task",
        kind: "implementation",
        state: "ready",
        attempt: 0,
        preferredCompute: "fast",
        dependencies: [],
        readScope: [],
        writeScope: ["src/**"],
        blockedBy: [],
        activities: [],
      },
    ],
    activeWorkers: [],
    openAttentionIds: [],
    attention: [],
    intent: "Finish",
    workingDirectory: "/tmp/repo",
    guidance: [],
    goalCriteria: [],
    lastSequence: 1,
    ...overrides,
  };
}

test("nightly resumes only active, idle runs with ready work", () => {
  const now = 1_000_000;
  expect(nightlyDisposition(snapshot(), now)).toBe("ready");
  expect(nightlyDisposition(snapshot({ state: "paused" }), now)).toBe("paused");
  expect(
    nightlyDisposition(snapshot({ state: "attention", openAttentionIds: ["decision"] }), now),
  ).toBe("attention");
  expect(
    nightlyDisposition(snapshot({ executionOwner: "owner", executionExpiresAt: now + 100 }), now),
  ).toBe("owned");
  expect(
    nightlyDisposition(snapshot({ activeWorkers: [{ id: "worker", taskId: "task" }] }), now),
  ).toBe("in-flight");
  expect(
    nightlyDisposition(snapshot({ tasks: [{ ...snapshot().tasks[0]!, state: "verifying" }] }), now),
  ).toBe("in-flight");
  expect(
    nightlyDisposition(snapshot({ tasks: [{ ...snapshot().tasks[0]!, state: "done" }] }), now),
  ).toBe("settlement");
  expect(
    nightlyDisposition(
      snapshot({ tasks: [{ ...snapshot().tasks[0]!, state: "blocked", blockedBy: ["failed"] }] }),
      now,
    ),
  ).toBe("stalled");
  expect(nightlyDisposition(snapshot({ tasks: [] }), now)).toBe("no-ready-task");
  expect(
    nightlyDisposition(snapshot({ executionOwner: "old", executionExpiresAt: now - 1 }), now),
  ).toBe("ready");
});

test("nightly command previews and launches only eligible saved work", async () => {
  await protocol.rustra.ready();
  const directory = mkdtempSync(join(tmpdir(), "loop-nightly-test-"));
  const databasePath = join(directory, "runs.db");
  const task = {
    id: "work",
    title: "Work",
    kind: "implementation" as const,
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
    preferredCompute: "fast" as const,
    minimumCompute: "fast" as const,
    maximumCompute: "fast" as const,
    maxAttempts: 1,
  };
  await protocol.prepareRun({
    databasePath,
    runId: "ready",
    intent: "Finish",
    workingDirectory: directory,
    tasks: [task],
  });
  await protocol.prepareRun({
    databasePath,
    runId: "held",
    intent: "Hold",
    workingDirectory: directory,
    tasks: [task],
  });
  await protocol.pauseRun({ databasePath, runId: "held" });
  const calls: string[] = [];
  const output: string[] = [];
  const options = {
    io: {
      stdout: (value: string) => output.push(value),
      stderr: (value: string) => output.push(value),
    },
    nightlyLaunch: async (runId: string) => {
      calls.push(runId);
    },
  };
  const args = [
    "nightly",
    "--config",
    join(resolve(import.meta.dir, "../../.."), "config"),
    "--database",
    databasePath,
    "--json",
  ];
  expect(await runCli(args, options)).toBe(0);
  expect(calls).toEqual([]);
  expect(JSON.parse(output.pop()!).rows).toContainEqual({ runId: "ready", disposition: "ready" });
  expect(await runCli([...args, "--execute"], options)).toBe(0);
  expect(calls).toEqual(["ready"]);
  expect(JSON.parse(output.pop()!).rows).toContainEqual({ runId: "held", disposition: "paused" });
});

test("nightly one-shot lock prevents overlapping invocations and cleans up", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "loop-nightly-lock-")), "nightly.lock");
  await withNightlyLock(path, async () => {
    expect(existsSync(path)).toBe(true);
    await expect(withNightlyLock(path, async () => "second")).rejects.toThrow(/already running/);
  });
  expect(existsSync(path)).toBe(false);
});
