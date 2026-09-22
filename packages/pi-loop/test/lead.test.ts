import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  registerLoopExtension,
  type LoopLeadBackend,
  type PiExtensionApi,
} from "../src/extension";

const limits = {
  statusLineLimit: 8,
  attentionLineLimit: 6,
  findingsLineLimit: 5,
  listLineLimit: 8,
  lineTextLimit: 160,
};

test("natural-language Pi turns receive the Loop Lead contract", async () => {
  const host = fakePi();
  registerLoopExtension(host.api, fakeBackend(), undefined, limits);

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
  registerLoopExtension(host.api, backend, undefined, limits);

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

test("Pi updates, notify, tool result, and commands share injected output limits", async () => {
  const host = fakePi();
  const updates: string[] = [];
  const notifications: string[] = [];
  const customLimits = {
    ...limits,
    statusLineLimit: 3,
    attentionLineLimit: 3,
    listLineLimit: 3,
  };
  const snapshot = {
    runId: "run-limited",
    state: "active" as const,
    tasks: Array.from({ length: 6 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: `Task ${index + 1}`,
      kind: "implementation" as const,
      state: "ready" as const,
      preferredCompute: "fast" as const,
      workerId: null,
      attempt: 0,
      selectedCompute: null,
    })),
    activeWorkers: [],
    openAttentionIds: [],
  };
  const backend = fakeBackend({
    async run(input) {
      input.onProgress?.(snapshot);
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
    async models() {
      return Array.from({ length: 6 }, (_, index) => `fast · model-${index + 1}`);
    },
  });
  registerLoopExtension(host.api, backend, undefined, customLimits);
  const piContext = context(notifications);

  const result = await host.tools.get("loop_run")!.execute(
    "tool-limited",
    {
      intent: "Implement bounded output",
      runId: "run\r\nlimited",
      tasksJson: JSON.stringify([task("implementation", "implementation", [], ["src/**"])]),
    },
    new AbortController().signal,
    (update: { content: Array<{ text: string }> }) => updates.push(update.content[0]?.text ?? ""),
    piContext,
  );
  await host.commands.get("loop")!.handler("graph run-limited", piContext);
  await host.commands.get("loop")!.handler("models", piContext);

  expect(updates.every((value) => value.split("\n").length <= 3)).toBe(true);
  expect(updates[0]?.split("\n")).toHaveLength(2);
  expect(updates[0]).not.toMatch(/\r/);
  expect(result.content[0]?.text.split("\n").length).toBeLessThanOrEqual(3);
  expect(notifications[0]).toBe(result.content[0]?.text);
  expect(notifications.every((value) => value.split("\n").length <= 3)).toBe(true);
  expect(notifications.at(-2)?.split("\n").at(-1)).toBe("… 4 more tasks");
  expect(notifications.at(-1)?.split("\n").at(-1)).toBe("… 4 more models");
});

test("Pi extension does not hide output configuration errors behind defaults", () => {
  const previous = process.env.LOOP_CONFIG_DIR;
  process.env.LOOP_CONFIG_DIR = join(mkdtempSync(join(tmpdir(), "loop-pi-config-error-")), "missing");
  try {
    expect(() => registerLoopExtension(fakePi().api, fakeBackend())).toThrow(/missing configuration file/);
  } finally {
    if (previous === undefined) delete process.env.LOOP_CONFIG_DIR;
    else process.env.LOOP_CONFIG_DIR = previous;
  }
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

function context(notifications: string[] = []) {
  return {
    cwd: "/project",
    ui: { notify(message: string) { notifications.push(message); } },
  };
}
