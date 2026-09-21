import { expect, test } from "bun:test";

import {
  registerLoopExtension,
  type LoopLeadBackend,
  type PiExtensionApi,
} from "../src/extension";

test("natural-language Pi turns receive the Loop Lead contract", async () => {
  const host = fakePi();
  registerLoopExtension(host.api, fakeBackend());

  const hook = host.hooks.get("before_agent_start")!;
  const result = await hook(
    { prompt: "Implement feature X", systemPrompt: "base" },
    context(),
  );

  expect(result.systemPrompt).toContain("interactive Lead for Loop");
  expect(result.systemPrompt).toContain("call loop_run exactly once");
  expect(result.systemPrompt).toContain("Implement feature X");
});

test("loop_run validates the DAG and delegates execution to Loop", async () => {
  const host = fakePi();
  const calls: unknown[] = [];
  const updates: string[] = [];
  const backend = fakeBackend({
    async run(input) {
      calls.push(input);
      input.onProgress?.({
        runId: input.runId,
        state: "active",
        tasks: [],
        activeWorkers: [],
        openAttentionIds: [],
      });
      return {
        status: "completed",
        tasks: input.tasks.length,
        escalations: [],
        providersByTask: {},
        startedAt: {},
        finishedAt: {},
      };
    },
  });
  registerLoopExtension(host.api, backend);

  const tool = host.tools.get("loop_run")!;
  const result = await tool.execute(
    "tool-1",
    {
      intent: "Implement feature X",
      runId: "run-x",
      tasksJson: JSON.stringify([task("research", "research", [], []), task(
        "implementation",
        "implementation",
        ["research"],
        ["src/**"],
      )]),
    },
    new AbortController().signal,
    (update: { content: Array<{ text: string }> }) => updates.push(update.content[0]?.text ?? ""),
    context(),
  );

  expect(calls).toHaveLength(1);
  expect(updates.some((update) => update.includes("State: active"))).toBe(true);
  expect(result.content[0]?.text).toContain("State: completed");
});

function task(id: string, kind: string, dependencies: string[], writeScope: string[]) {
  return {
    id,
    title: id,
    kind,
    dependencies,
    readScope: [],
    writeScope,
    requirements: [],
    completionChecks: [{
      id: "tests",
      command: "bun",
      args: ["test"],
      workingDirectory: null,
      timeoutMs: 120_000,
    }],
    preferredCompute: "fast",
    minimumCompute: "tiny",
    maximumCompute: "strong",
    maxAttempts: 3,
  };
}

function fakePi() {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const hooks = new Map<string, any>();
  const api: PiExtensionApi = {
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    registerCommand(name, options) {
      commands.set(name, options);
    },
    on(event, handler) {
      hooks.set(event, handler);
    },
  };
  return { api, tools, commands, hooks };
}

function fakeBackend(overrides: Partial<LoopLeadBackend> = {}): LoopLeadBackend {
  const snapshot = {
    runId: "run-x",
    state: "active" as const,
    tasks: [],
    activeWorkers: [],
    openAttentionIds: [],
  };
  return {
    async run(input) {
      return {
        status: "completed",
        tasks: input.tasks.length,
        escalations: [],
        providersByTask: {},
        startedAt: {},
        finishedAt: {},
      };
    },
    async snapshot() {
      return snapshot;
    },
    async cancel() {
      return { ...snapshot, state: "cancelled" as const };
    },
    async resume() {
      return snapshot;
    },
    async models() {
      return ["fast · configured-model"];
    },
    ...overrides,
  };
}

function context() {
  return {
    cwd: "/project",
    ui: { notify() {} },
  };
}
