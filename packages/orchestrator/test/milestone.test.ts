import { beforeAll, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "@loop/protocol";
import type { TaskSpecInput } from "@loop/protocol";
import { FailingProvider, FakeProvider, ProviderRegistry, SlowProvider } from "@loop/providers";
import { Orchestrator } from "../src";

class UnavailableProvider extends FakeProvider {
  override async capabilities() {
    return { ...(await super.capabilities()), available: false };
  }
}

beforeAll(async () => {
  await protocol.rustra.ready();
});

function task(
  id: string,
  kind: TaskSpecInput["kind"],
  dependencies: string[] = [],
  writes: string[] = [],
): TaskSpecInput {
  return {
    id,
    title: id,
    kind,
    dependencies,
    readScope: [],
    writeScope: writes,
    requirements: [],
    completionChecks: [
      {
        id: "worker-result",
        command: process.execPath,
        args: ["--eval", "process.exit(0)"],
        workingDirectory: null,
        timeoutMs: 5_000,
      },
    ],
    preferredCompute: "fast",
    minimumCompute: "tiny",
    maximumCompute: "strong",
    maxAttempts: 3,
  };
}

test("first milestone runs the DAG, bounds concurrency, and escalates one deliberate failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-milestone-"));
  const fast = new FakeProvider("fast", ["tiny", "fast"], {
    delayMs: 15,
    failures: { "impl-b": 1 },
  });
  const strong = new FakeProvider("strong", ["balanced", "strong", "frontier"], {
    delayMs: 5,
  });
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([fast, strong]),
    maxWorkers: 3,
  });
  const result = await orchestrator.run({
    databasePath: join(directory, "loop.db"),
    runId: "milestone",
    tasks: [
      task("research-a", "research"),
      task("research-b", "research"),
      task("research-c", "research"),
      task("decision", "decision", ["research-a", "research-b", "research-c"], [".loop/decision"]),
      task("impl-a", "implementation", ["decision"], ["crates/a/**"]),
      task("impl-b", "implementation", ["decision"], ["packages/b/**"]),
      task("verification", "verification", ["impl-a", "impl-b"]),
    ],
  });

  expect(result.status).toBe("completed");
  expect(result.tasks).toBe(7);
  expect(fast.maxConcurrent).toBe(3);
  expect(result.escalations).toContainEqual({
    taskId: "impl-b",
    from: "fast",
    to: "strong",
  });
  expect(result.providersByTask["impl-b"]).toEqual(["fast", "strong"]);
  expect(result.startedAt.decision).toBeGreaterThanOrEqual(result.finishedAt["research-a"]);
  expect(result.startedAt.decision).toBeGreaterThanOrEqual(result.finishedAt["research-b"]);
  expect(result.startedAt.decision).toBeGreaterThanOrEqual(result.finishedAt["research-c"]);
});

test("cancellation stops active providers and persists a cancelled run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-cancel-"));
  const slow = new SlowProvider("slow", ["fast", "balanced", "strong"]);
  const controller = new AbortController();
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([slow]),
    maxWorkers: 1,
  });
  const pending = orchestrator.run({
    databasePath: join(directory, "loop.db"),
    runId: "cancelled",
    tasks: [task("slow-task", "research")],
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 20);
  const result = await pending;
  expect(result.status).toBe("cancelled");
  expect(slow.cancelled).toBe(1);
});

test("exhausted automatic escalation returns compact human attention instead of crashing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-attention-"));
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FailingProvider("always-fails", ["fast"])]),
    maxWorkers: 1,
  });
  const failing = task("fragile", "implementation", [], ["src/**"]);
  failing.maxAttempts = 1;
  const result = await orchestrator.run({
    databasePath: join(directory, "loop.db"),
    runId: "needs-human",
    tasks: [failing],
  });
  expect(result.status).toBe("attention");
});

test("missing provider capability becomes human attention before workers start", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-missing-provider-"));
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new UnavailableProvider("missing", ["fast", "balanced", "strong"])]),
    maxWorkers: 1,
  });
  const result = await orchestrator.run({
    databasePath: join(directory, "loop.db"),
    runId: "missing-provider",
    tasks: [task("research", "research")],
  });
  expect(result.status).toBe("attention");
});

test("worker success does not complete a task when its completion command fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-verification-failure-"));
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FakeProvider("fast", ["fast"])]),
    maxWorkers: 1,
  });
  const unverified = task("unverified", "implementation", [], ["src/**"]);
  unverified.maxAttempts = 1;
  unverified.completionChecks = [
    {
      id: "deliberate-failure",
      command: process.execPath,
      args: ["--eval", "process.exit(7)"],
      workingDirectory: null,
      timeoutMs: 5_000,
    },
  ];

  const result = await orchestrator.run({
    databasePath: join(directory, "loop.db"),
    runId: "verification-failure",
    tasks: [unverified],
  });

  expect(result.status).toBe("attention");
  const snapshot = await protocol.getSnapshot({
    databasePath: join(directory, "loop.db"),
    runId: "verification-failure",
  });
  expect(snapshot.tasks[0]?.state).toBe("attention");
});

test("overlapping implementation write scopes are serialized", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-write-serialization-"));
  const provider = new FakeProvider("fast", ["fast"], { delayMs: 10 });
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 2,
  });
  const left = task("left", "implementation", [], ["src/shared/**"]);
  const right = task("right", "implementation", [], ["src/shared/module/**"]);
  left.maximumCompute = "fast";
  right.maximumCompute = "fast";

  const result = await orchestrator.run({
    databasePath: join(directory, "loop.db"),
    runId: "serialized-writes",
    tasks: [left, right],
  });

  expect(result.status).toBe("completed");
  expect(provider.maxConcurrent).toBe(1);
  expect(result.startedAt.right).toBeGreaterThanOrEqual(result.finishedAt.left);
});
