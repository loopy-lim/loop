import { beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "@loop/protocol";
import type { TaskSpecInput } from "@loop/protocol";
import { FailingProvider, FakeProvider, ProviderRegistry, SlowProvider } from "@loop/providers";
import { Orchestrator } from "../src";
import { loadLoopConfig } from "../src/config";
import { buildProviderRegistry } from "../src/composition";

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

test("composition preserves model ranking and groups shared upstream quota without network calls", async () => {
  const config = loadLoopConfig({ configDirectory: join(import.meta.dir, "../../../config") });
  config.providers = { zai: { enabled: true, mode: "api", endpoint: "https://invalid.example", apiKeyEnv: "TEST_ONLY_KEY" } };
  config.output.workerVisibility = "off";
  config.models = [
    { id: "a-expensive", provider: "zai", computeClass: "fast", capabilities: { coding: 1, reasoning: 1, tools: 1, vision: 0, longContext: 1 }, latency: 5, costWeight: 1 },
    { id: "z-cheap", provider: "zai", computeClass: "fast", capabilities: { coding: 1, reasoning: 1, tools: 1, vision: 0, longContext: 1 }, latency: 0, costWeight: 1 },
  ];
  const registry = buildProviderRegistry({ config, projectRoot: process.cwd(), environment: { TEST_ONLY_KEY: "not-a-credential" } });
  expect((await registry.select("fast")).id).toBe("zai:z-cheap");
  await expect(registry.select("fast", new Set(["zai:z-cheap"]))).rejects.toThrow();
});

test("configured volume classes have non-ZAI fallback without widening compute constraints", async () => {
  const config = loadLoopConfig({ configDirectory: join(import.meta.dir, "../../../config") });
  const models = config.models.filter(model => model.provider !== "local");
  const registry = new ProviderRegistry(models.map(model => new FakeProvider(`${model.provider}:${model.id}`, [model.computeClass])), Object.fromEntries(models.map(model => [`${model.provider}:${model.id}`, { costWeight: model.costWeight, latency: model.latency }])));
  const zaiIds = new Set(models.filter(model => model.id.includes("glm-")).map(model => `${model.provider}:${model.id}`));
  for (const compute of ["tiny", "fast", "balanced"] as const) {
    expect(zaiIds.has((await registry.select(compute)).id)).toBe(true);
    expect(zaiIds.has((await registry.select(compute, zaiIds)).id)).toBe(false);
  }
});

test("transient worker failure retries within budget and then completes", async () => {
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
  const snapshot = await protocol.getSnapshot({
    databasePath: join(directory, "loop.db"),
    runId: "milestone",
  });
  expect(snapshot.tasks.find(item => item.id === "impl-b")).toMatchObject({ state: "done", attempt: 1 });
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

test("exhausted transient retries terminalize the task and run without attention", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-exhausted-"));
  const databasePath = join(directory, "loop.db");
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FailingProvider("always-fails", ["fast", "balanced", "strong"])]),
    maxWorkers: 1,
  });
  const failing = task("fragile", "implementation", [], ["src/**"]);
  failing.maxAttempts = 2;

  const result = await orchestrator.run({ databasePath, runId: "exhausted", tasks: [failing] });
  const snapshot = await protocol.getSnapshot({ databasePath, runId: "exhausted" });

  expect(result.status as string).toBe("failed");
  expect(snapshot.state).toBe("failed");
  expect(snapshot.tasks[0]).toMatchObject({ state: "failed", attempt: 2 });
  expect(snapshot.attention).toHaveLength(0);
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

test("failed completion check is returned to a new worker attempt with its failure evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-verification-repair-"));
  const databasePath = join(directory, "loop.db");
  const markerPath = join(directory, "implementation.txt");
  await writeFile(markerPath, "broken");
  class RepairingProvider extends FakeProvider {
    starts: string[] = [];
    previousFailures: Array<string | null | undefined> = [];

    override async start(input: Parameters<FakeProvider["start"]>[0]) {
      this.starts.push(`${input.taskId}:${input.attempt}`);
      this.previousFailures.push(input.context?.previousFailure);
      if (input.attempt === 1) await writeFile(markerPath, "fixed");
      return super.start(input);
    }
  }
  const provider = new RepairingProvider("fast", ["fast", "balanced", "strong"]);
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 1,
  });
  const repairable = task("repairable", "implementation", [], ["src/**"]);
  repairable.maxAttempts = 3;
  repairable.completionChecks = [{
    id: "expected-content",
    command: process.execPath,
    args: ["--eval", `process.exit(require("node:fs").readFileSync(${JSON.stringify(markerPath)}, "utf8") === "fixed" ? 0 : 7)`],
    workingDirectory: null,
    timeoutMs: 5_000,
  }];

  const dependent = task("after-repair", "verification", ["repairable"]);
  const result = await orchestrator.run({ databasePath, runId: "verification-repair", tasks: [repairable, dependent] });
  const snapshot = await protocol.getSnapshot({ databasePath, runId: "verification-repair" });

  expect(result.status).toBe("completed");
  expect(provider.starts).toEqual(["repairable:0", "repairable:1", "after-repair:0"]);
  expect(provider.previousFailures[1]).toContain("expected-content: exit 7");
  expect(snapshot.tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "repairable", state: "done", attempt: 1 }),
    expect.objectContaining({ id: "after-repair", state: "done", attempt: 0 }),
  ]));
  expect(snapshot.attention).toHaveLength(0);
});

test("a repeatedly failing completion check requests attention after its attempt budget", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-verification-failure-"));
  const databasePath = join(directory, "loop.db");
  const counterPath = join(directory, "verification-attempts.txt");
  await writeFile(counterPath, "0");
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FakeProvider("fast", ["fast", "balanced", "strong"])]),
    maxWorkers: 1,
  });
  const unverified = task("unverified", "implementation", [], ["src/**"]);
  unverified.maxAttempts = 3;
  unverified.completionChecks = [
    {
      id: "deterministic-assertion",
      command: process.execPath,
      args: [
        "--eval",
        `const fs = require("node:fs"); const path = ${JSON.stringify(counterPath)}; const count = Number(fs.readFileSync(path, "utf8")); fs.writeFileSync(path, String(count + 1)); process.exit(7);`,
      ],
      workingDirectory: null,
      timeoutMs: 5_000,
    },
  ];

  const result = await orchestrator.run({ databasePath, runId: "verification-failure", tasks: [unverified] });
  const snapshot = await protocol.getSnapshot({ databasePath, runId: "verification-failure" });

  expect(await readFile(counterPath, "utf8")).toBe("3");
  expect(result.status as string).toBe("attention");
  expect(snapshot.tasks[0]).toMatchObject({ state: "attention", attempt: 3 });
  expect(snapshot.tasks[0]?.state).not.toBe("done");
  expect(snapshot.openAttentionIds).toHaveLength(1);
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

test("retry exhaustion blocks descendants while an independent branch continues", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-branch-terminalization-"));
  const databasePath = join(directory, "loop.db");
  const provider = new FakeProvider("fast", ["fast", "balanced", "strong"], { failures: { doomed: 10 }, delayMs: 5 });
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 2,
  });
  const doomed = task("doomed", "implementation", [], ["src/doomed/**"]);
  doomed.maxAttempts = 2;
  const dependent = task("dependent", "verification", ["doomed"]);
  const independent = task("independent", "implementation", [], ["src/independent/**"]);

  const result = await orchestrator.run({
    databasePath,
    runId: "branch-terminalization",
    tasks: [doomed, dependent, independent],
  });
  const snapshot = await protocol.getSnapshot({ databasePath, runId: "branch-terminalization" });
  const states = Object.fromEntries(snapshot.tasks.map(item => [item.id, item.state]));

  expect(result.status as string).toBe("failed");
  expect(states).toEqual({ doomed: "failed", dependent: "blocked", independent: "done" });
  expect(result.startedAt.independent).toBeDefined();
  expect(result.finishedAt.independent).toBeDefined();
  expect(snapshot.attention).toHaveLength(0);
});

for (const kind of ["decision", "integration"] as const) {
  test(`failed serial ${kind} task terminalizes the run`, async () => {
    const directory = await mkdtemp(join(tmpdir(), `loop-${kind}-failure-`));
    const databasePath = join(directory, "loop.db");
    const provider = new FakeProvider("fast", ["fast"], { failures: { serial: 10 } });
    const orchestrator = new Orchestrator({
      control: protocol,
      providers: new ProviderRegistry([provider]),
      maxWorkers: 2,
    });
    const serial = task("serial", kind, [], [`.loop/${kind}`]);
    serial.maxAttempts = 1;

    const result = await orchestrator.run({ databasePath, runId: `${kind}-failure`, tasks: [serial] });
    const snapshot = await protocol.getSnapshot({ databasePath, runId: `${kind}-failure` });

    expect(result.status as string).toBe("failed");
    expect(snapshot.state).toBe("failed");
    expect(snapshot.tasks[0]?.state).toBe("failed");
    expect(snapshot.attention).toHaveLength(0);
  });
}
