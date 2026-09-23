import { beforeAll, expect, test } from "bun:test";

import * as protocol from "@loop/protocol";
import { MirroringProvider } from "@loop/providers";

import type { LoopConfig } from "../src/config";
import { buildProviderRegistry, StoreActivitySink, type ActivityRecorder } from "../src/composition";

beforeAll(() => protocol.rustra.ready());

test("StoreActivitySink records lifecycle lines immediately and throttles output renders at 1 Hz", async () => {
  const recorded: Array<{ runId: string; taskId: string; activity: string }> = [];
  const recorder: ActivityRecorder = {
    async recordActivity(input) {
      recorded.push({ runId: input.runId, taskId: input.taskId, activity: input.activity });
    },
  };
  const sink = new StoreActivitySink(recorder, "/tmp/loop.sqlite");

  // Lines published before the worker registers are dropped (no context yet).
  await sink.publish("w1", "[message] orphan");

  await sink.onWorkerStart({ workerId: "w1", runId: "run-1", taskId: "t-1" });
  await sink.publish("w1", "[lifecycle] starting t-1");
  await sink.publish("w1", "[message] one"); // dropped: lifecycle reset the 1 Hz window
  await sink.publish("w1", "[message] two"); // dropped: inside the 1 Hz window
  await sink.publish("w1", "[result] done"); // immediate: result bypasses the throttle
  await sink.onWorkerFinish("w1");
  await sink.publish("w1", "[message] after finish"); // dropped: mapping gone

  expect(recorded).toEqual([
    { runId: "run-1", taskId: "t-1", activity: "[lifecycle] starting t-1" },
    { runId: "run-1", taskId: "t-1", activity: "[result] done" },
  ]);

  // After the 1 Hz window expires, rendered output lines record again.
  await sink.onWorkerStart({ workerId: "w2", runId: "run-1", taskId: "t-1" });
  await sink.publish("w2", "[message] fresh");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sink.publish("w2", "[message] after window");
  expect(recorded.slice(2)).toEqual([
    { runId: "run-1", taskId: "t-1", activity: "[message] fresh" },
    { runId: "run-1", taskId: "t-1", activity: "[message] after window" },
  ]);
});

function loopConfig(workerVisibility: LoopConfig["output"]["workerVisibility"]): LoopConfig {
  return {
    configDirectory: "/config",
    databasePath: "/tmp/loop-visibility.sqlite",
    scheduler: { maxWorkers: 2, maxFrontierWorkers: 1 },
    routing: {
      defaultComputeClass: "fast",
      highRiskFloor: "strong",
      criticalRiskFloor: "frontier",
      escalation: ["fast", "strong"],
    },
    output: {
      statusLineLimit: 8,
      attentionLineLimit: 6,
      findingsLineLimit: 5,
      listLineLimit: 8,
      lineTextLimit: 160,
      workerVisibility,
      workerActivityLines: 5,
      workerPaneLimit: 4,
    },
    lead: { command: "pi", provider: "zai", model: "glm-5.3-flashx" },
    models: [{
      id: "flashx",
      provider: "pi",
      computeClass: "fast",
      capabilities: { coding: 3, reasoning: 3, tools: 3, vision: 0, longContext: 0 },
      latency: 3,
      costWeight: 1,
    }],
    providers: { pi: { command: "pi", enabled: true, mode: "interactive" } },
    personas: {},
  };
}

test("visibility off leaves every provider unwrapped (byte-identical baseline)", async () => {
  const registry = buildProviderRegistry({
    config: loopConfig("off"),
    projectRoot: "/project",
    environment: {},
  });
  const provider = await registry.select("fast");
  expect(provider instanceof MirroringProvider).toBe(false);
});

test("watch visibility wraps providers in the mirroring decorator", async () => {
  const recorded: unknown[] = [];
  const registry = buildProviderRegistry({
    config: loopConfig("watch"),
    projectRoot: "/project",
    environment: {},
    activityRecorder: { async recordActivity(input) { recorded.push(input); } },
  });
  const provider = await registry.select("fast");
  expect(provider instanceof MirroringProvider).toBe(true);
});

test("panes visibility without a recorder still wraps providers for panes", async () => {
  const registry = buildProviderRegistry({
    config: loopConfig("panes"),
    projectRoot: "/project",
    environment: {},
  });
  const provider = await registry.select("fast");
  expect(provider instanceof MirroringProvider).toBe(true);
});
