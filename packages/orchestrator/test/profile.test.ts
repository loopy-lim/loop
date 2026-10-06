import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "@loop/protocol";
import type { ComputeClass, TaskSpecInput } from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";
import { FakeModelClient, TurnLoopProvider } from "@loop/turnloop";

import { Orchestrator } from "../src";
import { ConfigError, loadLoopConfig, type ModelProfile } from "../src/config";
import { buildProviderRegistry } from "../src/composition";

beforeAll(() => protocol.rustra.ready());

const repoConfig = join(import.meta.dir, "../../../config");

function profile(id: string, computeClass: ComputeClass): ModelProfile {
  return {
    id,
    provider: "pi",
    computeClass,
    capabilities: { coding: 1, reasoning: 1, tools: 1, vision: 0, longContext: 1 },
    latency: 1,
    costWeight: 1,
  };
}

function configWith(models: ModelProfile[]) {
  const config = loadLoopConfig({ configDirectory: repoConfig });
  config.output.workerVisibility = "off";
  config.providers = { pi: { enabled: true, command: "pi", auth: "native" } };
  config.models = models;
  return config;
}

test("worker profiles default to the pi lane with zero behavior change", async () => {
  // No lane key at all, and an explicit lane = "pi", must compose identically:
  // both stay CLI-harness pi workers.
  const config = configWith([profile("m1", "fast"), { ...profile("m2", "balanced"), lane: "pi" }]);
  const registry = buildProviderRegistry({ config, projectRoot: "/repo" });

  const fast = await registry.select("fast");
  const balanced = await registry.select("balanced");
  for (const provider of [fast, balanced]) {
    expect(provider).not.toBeInstanceOf(TurnLoopProvider);
    expect(provider.constructor.name).toBe("PiProvider");
  }
  expect(fast.id).toBe("pi:m1");
  expect(balanced.id).toBe("pi:m2");
});

test("a profile selects the turnloop lane explicitly and keeps its provider identity", async () => {
  const config = configWith([{ ...profile("m1", "fast"), lane: "turnloop" }]);
  const registry = buildProviderRegistry({
    config,
    projectRoot: "/repo",
    turnloopWorker: (model) => {
      // Model ids flow into the binding only through configuration.
      expect(model.id).toBe("m1");
      return { modelClient: new FakeModelClient([{ kind: "message", text: "ok" }]) };
    },
  });

  const provider = await registry.select("fast");
  expect(provider).toBeInstanceOf(TurnLoopProvider);
  // Same id the pi lane would have used: routing/quota identity is provider
  // + model id, never the execution lane.
  expect(provider.id).toBe("pi:m1");
  // Quota-group routing metadata still resolves through the pi provider key:
  // excluding the profile's quota group leaves no eligible candidate.
  await expect(registry.select("fast", new Set(["pi:m1"]))).rejects.toThrow(
    /no eligible compute candidate|no provider supports/,
  );
});

test("a turnloop-lane profile without a model client is refused deterministically", () => {
  const config = configWith([{ ...profile("m1", "fast"), lane: "turnloop" }]);

  const refusal = (): string => {
    try {
      buildProviderRegistry({ config, projectRoot: "/repo" });
      throw new Error("expected composition to refuse the turnloop profile");
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  // Same input, same refusal — the CLI ships without a turnloop model client,
  // so lane = "turnloop" fails fast at composition instead of mid-run.
  const first = refusal();
  expect(first).toContain("config.turnloop_lane_unavailable");
  expect(first).toContain("pi:m1");
  expect(refusal()).toBe(first);

  // An explicit hook that yields no binding refuses identically.
  const withEmptyHook = (): string => {
    try {
      buildProviderRegistry({ config, projectRoot: "/repo", turnloopWorker: () => undefined });
      throw new Error("expected composition to refuse the turnloop profile");
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  expect(withEmptyHook()).toBe(first);
});

test("an unknown lane value is a stable configuration error", () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-config-lane-"));
  writeFileSync(
    join(directory, "models.toml"),
    `
[[models]]
id = "fast-model"
provider = "test"
compute_class = "fast"
lane = "warp"
capabilities = { coding = 1, reasoning = 1, tools = 1, vision = 0, long_context = 1 }
latency = 1
cost_weight = 1
`,
  );
  writeFileSync(
    join(directory, "policy.toml"),
    `
[scheduler]
max_parallel = 2
max_frontier_workers = 1

[routing]
default_compute_class = "fast"
high_risk_floor = "balanced"
critical_risk_floor = "strong"
escalation = ["balanced", "strong"]

[output]
status_line_limit = 8
attention_line_limit = 6
findings_line_limit = 5
list_line_limit = 8
line_text_limit = 160
`,
  );
  writeFileSync(
    join(directory, "providers.toml"),
    `
[lead]
command = "pi"
provider = "zai"
model = "glm-5.3-flashx"

[providers.test]
enabled = true
command = "test-agent"
`,
  );

  try {
    loadLoopConfig({ configDirectory: directory });
    throw new Error("expected configuration loading to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("config.unknown_worker_lane");
    expect((error as ConfigError).message).toContain("models[0].lane");
  }
});

/** Mixed-mode fixture task: same contract, different compute lane. */
const task = (id: string, computeClass: ComputeClass): TaskSpecInput => ({
  id,
  title: id,
  kind: "research",
  dependencies: [],
  readScope: [],
  writeScope: [],
  requirements: [],
  completionChecks: [
    { id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 },
  ],
  preferredCompute: computeClass,
  minimumCompute: computeClass,
  maximumCompute: computeClass,
  maxAttempts: 2,
});

/** Sorted event-shape keys for one lane's first matching event (byte-equality gate). */
const keysOf = (taskId: string, events: Array<{ type: string; data: Record<string, unknown> }>) =>
  Object.keys(events.find((event) => event.data.task_id === taskId) ?? {}).toSorted();

test("mixed-mode runs share one event-log contract (WorkerStarted/WorkerResult/GuidanceDelivered)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-profile-mixed-"));
  const input = { databasePath: join(directory, "run.db"), runId: "mixed" };
  const readEvents = async () => {
    const events = await protocol.subscribeEvents({ ...input, afterSequence: 0, limit: 1000 });
    return events.map((event) => {
      const payload = JSON.parse(event.payloadJson) as {
        kind?: { type?: string; data?: Record<string, unknown> };
      };
      return { type: payload.kind?.type ?? "", data: payload.kind?.data ?? {} };
    });
  };

  // One run, two lanes: the pi-lane FakeProvider serves the tiny task, the
  // turnloop adapter serves the fast task. No paid model calls — the
  // turnloop lane runs on the scripted FakeModelClient.
  const piLane = new FakeProvider("pi-lane", ["tiny"]);
  const loopLane = new TurnLoopProvider({
    id: "loop-lane",
    modelClient: new FakeModelClient([{ kind: "message", text: "turnloop work complete" }]),
    computeClasses: ["fast"],
  });
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([piLane, loopLane]),
    maxWorkers: 2,
  });
  await orchestrator.prepare({
    ...input,
    tasks: [task("pi-task", "tiny"), task("loop-task", "fast")],
    workingDirectory: directory,
  });
  // Run-wide guidance exists before any claim, so both lanes start with an
  // injected claim context and both must watermark it the same way.
  await protocol.steerRun({ ...input, taskId: null, message: "run-wide note" });
  const summary = await orchestrator.execute(input);
  expect(summary.status).toBe("completed");
  expect(summary.providersByTask["pi-task"]).toEqual(["pi-lane"]);
  expect(summary.providersByTask["loop-task"]).toEqual(["loop-lane"]);

  const started = (await readEvents()).filter((event) => event.type === "worker_started");
  const finished = (await readEvents()).filter((event) => event.type === "worker_finished");
  expect(started.map((event) => event.data.task_id).toSorted()).toEqual(["loop-task", "pi-task"]);
  expect(finished.map((event) => event.data.task_id).toSorted()).toEqual(["loop-task", "pi-task"]);

  // The contract is the event shape, not the adapter: pi and turnloop
  // workers produce byte-identical payload vocabularies.
  expect(keysOf("loop-task", started)).toEqual(keysOf("pi-task", started));
  expect(keysOf("loop-task", finished)).toEqual(keysOf("pi-task", finished));

  // GuidanceDelivered: both workers watermark the pre-run guidance through
  // the same claim-context injection path.
  await (async () => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const delivered = (await readEvents()).filter((event) => event.type === "guidance_delivered");
      if (
        delivered
          .map((event) => event.data.task_id)
          .toSorted()
          .join(",") === "loop-task,pi-task"
      ) {
        expect(keysOf("loop-task", delivered)).toEqual(keysOf("pi-task", delivered));
        return;
      }
      await Bun.sleep(10);
    }
    throw new Error("guidance_delivered never covered both lanes");
  })();
});
