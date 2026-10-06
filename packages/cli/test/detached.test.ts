import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as protocol from "@loop/protocol";
import { Orchestrator } from "@loop/orchestrator";
import { FakeProvider, ProviderRegistry } from "@loop/providers";
import { waitForOwnerReady } from "../src/dispatcher";

/** Minimal durable snapshot for observer tests: all required protocol fields. */
function snapshotFixture(
  overrides: Partial<protocol.SnapshotOutput> & { runId: string },
): protocol.SnapshotOutput {
  return {
    state: "active",
    tasks: [],
    activeWorkers: [],
    openAttentionIds: [],
    attention: [],
    intent: "observer fixture",
    workingDirectory: ".",
    guidance: [],
    goalCriteria: [],
    lastSequence: 0,
    executionOwner: null,
    executionExpiresAt: null,
    ...overrides,
  };
}

test("detached handoff waits for this child lease, rejects a stopped owner, and accepts fast terminal", async () => {
  const active = {
    runId: "run-1",
    state: "active",
    lastSequence: 1,
    executionOwner: "99:other",
    executionExpiresAt: Date.now() + 5_000,
  } as protocol.SnapshotOutput;
  const owner = { pid: 42, exitCode: null, signalCode: null } as ChildProcess;
  let polls = 0;
  const accepted = await waitForOwnerReady({
    owner,
    snapshot: async () => {
      polls++;
      return polls === 1 ? active : { ...active, executionOwner: "42:nonce" };
    },
    ownerGraceMs: 300,
  });
  expect(accepted.executionOwner).toBe("42:nonce");
  expect(polls).toBe(2);
  await expect(
    waitForOwnerReady({
      owner: { ...owner, exitCode: 1 } as ChildProcess,
      snapshot: async () => active,
      ownerGraceMs: 20,
    }),
  ).rejects.toThrow("run-1");
  await expect(
    waitForOwnerReady({
      owner,
      snapshot: async () => ({
        ...active,
        state: "completed",
        executionOwner: null,
        executionExpiresAt: null,
      }),
      ownerGraceMs: 20,
    }),
  ).resolves.toMatchObject({ state: "completed" });
  await expect(
    waitForOwnerReady({ owner, snapshot: async () => active, ownerGraceMs: 20 }),
  ).rejects.toThrow("lease");
});

test("detached owner completes the persisted graph after its UI observer exits", async () => {
  await protocol.rustra.ready();
  const directory = mkdtempSync(join(tmpdir(), "loop-detached-"));
  const input = { databasePath: join(directory, "run.db"), runId: "detached" };
  await new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 2,
  }).prepare({
    ...input,
    workingDirectory: directory,
    intent: "Persist across UI exits",
    tasks: ["a", "b"].map((id) => ({
      id,
      title: id,
      kind: "research",
      dependencies: id === "b" ? ["a"] : [],
      readScope: [],
      writeScope: [],
      requirements: [],
      completionChecks: [{ id: "check", command: "true", args: [], timeoutMs: 1000 }],
      preferredCompute: "fast",
      minimumCompute: "fast",
      maximumCompute: "fast",
      maxAttempts: 1,
    })),
  });
  const observer = spawn(
    process.execPath,
    [join(import.meta.dir, "fixtures/detached-observer.ts"), input.databasePath],
    { cwd: resolve(import.meta.dir, "../../.."), stdio: ["ignore", "pipe", "pipe"] },
  );
  let ownerPid = 0;
  try {
    ownerPid = await new Promise<number>((fulfil, reject) => {
      observer.stdout.once("data", (chunk) => fulfil(Number(String(chunk).trim())));
      observer.once("error", reject);
      observer.once("exit", (code) => reject(new Error(`observer exited ${code}`)));
    });
    expect(ownerPid).toBeGreaterThan(0);
    const closed = new Promise<void>((fulfil) => observer.once("close", () => fulfil()));
    observer.kill("SIGTERM");
    await closed;
    const deadline = Date.now() + 8000;
    while ((await protocol.getSnapshot(input)).state !== "completed") {
      if (Date.now() > deadline) throw new Error(JSON.stringify(await protocol.getSnapshot(input)));
      await Bun.sleep(50);
    }
    const snapshot = await protocol.getSnapshot(input);
    expect(snapshot.tasks.map((task) => task.state)).toEqual(["done", "done"]);
    expect(
      (await protocol.getTaskContext({ ...input, taskId: "b" })).dependencyResults[0]?.summary,
    ).toBe("a complete");
  } finally {
    observer.kill("SIGKILL");
    if (ownerPid) {
      try {
        process.kill(ownerPid, "SIGTERM");
      } catch {}
    }
  }
}, 10000);

test("observer reports a dead execution owner instead of polling forever", async () => {
  const { observeRun } = await import("../src/dispatcher");
  await protocol.rustra.ready();
  const input = {
    databasePath: join(mkdtempSync(join(tmpdir(), "loop-owner-failed-")), "run.db"),
    runId: "failed-owner",
  };
  await protocol.createRun(input);
  const owner = spawn(process.execPath, ["--eval", "process.exit(2)"], { stdio: "ignore" });
  await new Promise<void>((fulfil) => owner.once("exit", () => fulfil()));
  await expect(
    observeRun({ snapshot: () => protocol.getSnapshot(input), onSnapshot: () => {}, owner }),
  ).rejects.toThrow("Execution owner stopped");
});

test("watching an active run without any owner ends with actionable recovery", async () => {
  const { observeRun } = await import("../src/dispatcher");
  await protocol.rustra.ready();
  const input = {
    databasePath: join(mkdtempSync(join(tmpdir(), "loop-owner-missing-")), "run.db"),
    runId: "missing-owner",
  };
  await protocol.createRun(input);
  await expect(
    observeRun({
      snapshot: () => protocol.getSnapshot(input),
      onSnapshot: () => {},
      ownerGraceMs: 20,
    }),
  ).rejects.toThrow("Execution owner is not responding");
});

test("observer re-polls after owner exit so a terminal record is not mistaken for a dead owner", async () => {
  const { observeRun } = await import("../src/dispatcher");
  const active = snapshotFixture({
    runId: "race",
    lastSequence: 1,
    executionOwner: "42:nonce",
    executionExpiresAt: Date.now() + 10_000,
  });
  let polls = 0;
  const seen: string[] = [];
  // Poll 1 sees the owner already exited while the snapshot still says
  // active; poll 2 is the re-read that observes the terminal record.
  const completed = await observeRun({
    snapshot: async () => {
      polls++;
      return polls === 1 ? active : { ...active, state: "completed", lastSequence: 2 };
    },
    onSnapshot: (snapshot) => seen.push(snapshot.state),
    owner: { pid: 42, exitCode: 0, signalCode: null } as ChildProcess,
  });
  expect(completed).toEqual({ status: "completed", tasks: 0 });
  expect(polls).toBe(2);
  expect(seen).toEqual(["active", "completed"]);
  // The same re-read protects a crashed owner that wrote its failure first.
  polls = 0;
  const failed = await observeRun({
    snapshot: async () => {
      polls++;
      return polls === 1 ? active : { ...active, state: "failed", lastSequence: 2 };
    },
    onSnapshot: () => {},
    owner: { pid: 42, exitCode: 1, signalCode: null } as ChildProcess,
  });
  expect(failed.status).toBe("failed");
});

test("clean owner exit without a live lease ends observation instead of throwing", async () => {
  const { observeRun } = await import("../src/dispatcher");
  const snapshot = snapshotFixture({ runId: "clean-exit", lastSequence: 4 });
  const result = await observeRun({
    snapshot: async () => snapshot,
    onSnapshot: () => {},
    owner: { pid: 42, exitCode: 0, signalCode: null } as ChildProcess,
  });
  expect(result).toEqual({ status: "active", tasks: 0 });
});

test("clean owner exit with a still-live lease keeps reporting the run as stalled", async () => {
  const { observeRun } = await import("../src/dispatcher");
  const snapshot = snapshotFixture({
    runId: "clean-stall",
    lastSequence: 1,
    executionOwner: "42:nonce",
    executionExpiresAt: Date.now() + 10_000,
  });
  await expect(
    observeRun({
      snapshot: async () => snapshot,
      onSnapshot: () => {},
      owner: { pid: 42, exitCode: 0, signalCode: null } as ChildProcess,
    }),
  ).rejects.toThrow("Execution owner stopped before the run finished");
});

test("spawned owner output is appended to a log file next to the database", async () => {
  const { spawnOwner, ownerLogPath } = await import("../src/dispatcher");
  const directory = mkdtempSync(join(tmpdir(), "loop-owner-log-"));
  const databasePath = join(directory, "run.db");
  expect(ownerLogPath(databasePath)).toBe(join(directory, "run.db.owner.log"));
  const script = join(directory, "noisy-owner.sh");
  await Bun.write(script, "#!/bin/sh\necho owner-stdout-line\necho owner-stderr-line >&2\n");
  chmodSync(script, 0o755);
  const owner = await spawnOwner({
    executable: script,
    runId: "log-test",
    databasePath,
    cwd: directory,
  });
  await new Promise<void>((fulfil) => owner.once("exit", () => fulfil()));
  const log = await Bun.file(ownerLogPath(databasePath)).text();
  expect(log).toContain("owner-stdout-line");
  expect(log).toContain("owner-stderr-line");
  expect(log).toContain("owner log-test spawn");
});

test("loop resume fails loudly when the spawned owner never starts", async () => {
  const { runCli } = await import("../src/main");
  await protocol.rustra.ready();
  const directory = mkdtempSync(join(tmpdir(), "loop-resume-loud-"));
  const databasePath = join(directory, "run.db");
  await protocol.prepareRun({
    databasePath,
    runId: "resume-loud",
    intent: "Resume reports owner failure",
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
  const failingOwner = join(directory, "failing-owner.sh");
  await Bun.write(failingOwner, "#!/bin/sh\nexit 3\n");
  chmodSync(failingOwner, 0o755);
  const output: string[] = [];
  const code = await runCli(
    [
      "resume",
      "resume-loud",
      "--config",
      join(resolve(import.meta.dir, "../../.."), "config"),
      "--database",
      databasePath,
    ],
    {
      io: { stdout: (value) => output.push(value), stderr: (value) => output.push(value) },
      executablePath: failingOwner,
    },
  );
  expect(code).toBe(1);
  expect(output.join("")).toContain(
    "Execution owner stopped before lease confirmation for run resume-loud",
  );
});
