import { beforeAll, expect, test } from "bun:test";

import { HerdrWorkerRuntime } from "@loop/herdr";
import * as protocol from "@loop/protocol";
import { FakeProvider, MirroringProvider } from "@loop/providers";

import type { LoopConfig } from "../src/config";
import { KIND_DEFAULT_PERSONAS } from "../src/persona";
import { buildProviderRegistry, StoreActivitySink, wrapForVisibility, type ActivityRecorder } from "../src/composition";

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
    personaKindDefaults: KIND_DEFAULT_PERSONAS,
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

test("panes visibility hosts the steer relay in each worker pane via the composition relayCommand", async () => {
  const calls: string[][] = [];
  const runner: import("@loop/herdr").HerdrRunner = {
    async run(_command, args) {
      calls.push(args);
      if (args[0] === "workspace") {
        return { exitCode: 0, stdout: JSON.stringify({ result: { workspace: { workspace_id: "ws-1" }, root_pane: { pane_id: "ws-1:p-root" } } }), stderr: "" };
      }
      if (args[0] === "tab" && args[1] === "create") {
        return { exitCode: 0, stdout: JSON.stringify({ result: { tab: { tab_id: `ws-1:t-${calls.length}` }, root_pane: { pane_id: `ws-1:p-${calls.length}` } } }), stderr: "" };
      }
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  };
  const herdr = new HerdrWorkerRuntime({ runner });
  const [provider] = wrapForVisibility(
    [new FakeProvider("fake:offline", ["fast"], { delayMs: 5 })],
    {
      config: loopConfig("panes"),
      projectRoot: "/project",
      environment: { HERDR_WORKSPACE_ID: "ws-lead", HERDR_PANE_ID: "ws-lead:p-lead" },
      herdr,
      relayCommand: (worker) => ({ command: "loop", args: ["__steer-relay", worker.runId, worker.taskId, "--database", "/tmp/loop-visibility.sqlite"] }),
    },
    herdr,
  );
  expect(provider instanceof MirroringProvider).toBe(true);

  const handle = await provider.start({
    runId: "run-1",
    taskId: "t-1",
    title: "Task one",
    kind: "implementation",
    computeClass: "fast",
    attempt: 0,
    requirements: [],
    workingDirectory: "/project/wt",
  });
  await provider.cancel(handle.id);

  const relayRun = calls.find((args) => args[0] === "pane" && args[1] === "run");
  expect(relayRun).toBeDefined();
  expect(relayRun).toContain("__steer-relay");
  expect(relayRun).toContain("run-1");
  expect(relayRun).toContain("t-1");
  expect(relayRun).toContain("/tmp/loop-visibility.sqlite");
});

test("panes visibility without herdr context never hosts a relay (headless no-op)", async () => {
  const calls: string[][] = [];
  const runner: import("@loop/herdr").HerdrRunner = {
    async run(_command, args) {
      calls.push(args);
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  };
  const herdr = new HerdrWorkerRuntime({ runner });
  const [provider] = wrapForVisibility(
    [new FakeProvider("fake:offline", ["fast"], { delayMs: 5 })],
    {
      config: loopConfig("panes"),
      projectRoot: "/project",
      environment: {},
      herdr,
      relayCommand: () => ({ command: "loop", args: ["__steer-relay"] }),
    },
    herdr,
  );
  const handle = await provider.start({
    runId: "run-1",
    taskId: "t-1",
    title: "Task one",
    kind: "implementation",
    computeClass: "fast",
    attempt: 0,
    requirements: [],
    workingDirectory: "/project/wt",
  });
  await provider.cancel(handle.id);
  expect(calls.some((args) => args[0] === "pane" && args[1] === "run")).toBe(false);
  expect(calls.some((args) => args[0] === "tab" && args[1] === "create")).toBe(false);
});
