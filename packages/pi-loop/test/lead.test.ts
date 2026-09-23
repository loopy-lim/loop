import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SnapshotOutput, TaskContextOutput, TaskSpecInput } from "@loop/protocol";

import {
  registerLoopExtension,
  runLoopPlan,
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
  expect(result.systemPrompt).toContain("dependency result summaries");
  expect(result.systemPrompt).toContain("exact read and write ownership");
  expect(result.systemPrompt).toContain("Implement feature X");

  const tool = host.tools.get("loop_run")!;
  const tasksDescription = tool.parameters.properties.tasksJson.description as string;
  expect(tasksDescription).toContain("TaskSpecInput[]");
  expect(tasksDescription).toContain('"completionChecks"');
  expect(tasksDescription).toContain('"preferredCompute"');
});

test("loop_run validates the DAG and delegates execution to Loop", async () => {
  const host = fakePi();
  const calls: unknown[] = [];
  const updates: string[] = [];
  const backend = fakeBackend({
    async run(input) {
      calls.push(input);
      input.onProgress?.({
        ...snapshot(input.runId),
        state: "active",
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
    ...emptySnapshot("run-limited"),
    tasks: Array.from({ length: 6 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: `Task ${index + 1}`,
      kind: "implementation" as const,
      state: "ready" as const,
      preferredCompute: "fast" as const,
      attempt: 0,
      dependencies: [],
      readScope: [],
      writeScope: ["src/**"],
      blockedBy: [],
      activities: [],
    })),
  } satisfies SnapshotOutput;
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

test("loop control commands preserve free-form messages and render discovery and task detail", async () => {
  const host = fakePi();
  const calls: string[] = [];
  const notifications: string[] = [];
  const backend = fakeBackend({
    async pause(runId) {
      calls.push(`pause:${runId}`);
      return { ...snapshot(runId), state: "paused" };
    },
    async steer(runId, taskId, message) {
      calls.push(`steer:${runId}:${taskId}:${message}`);
      return snapshot(runId);
    },
    async resolve(runId, attentionId, resolution) {
      calls.push(`resolve:${runId}:${attentionId}:${resolution}`);
      return snapshot(runId);
    },
    async task(runId, taskId) {
      calls.push(`task:${runId}:${taskId}`);
      return taskContext(taskId);
    },
    async runs() {
      calls.push("runs");
      return [{ runId: "restart-me", state: "paused" }];
    },
  });
  registerLoopExtension(host.api, backend, undefined, limits);
  const piContext = context(notifications);
  const command = host.commands.get("loop")!;

  await command.handler("pause run-1", piContext);
  await command.handler("steer run-1 all prioritize verification evidence", piContext);
  await command.handler("resolve run-1 attention-1 approved with rollback", piContext);
  await command.handler("task run-1 impl", piContext);
  await command.handler("runs", piContext);

  expect(calls).toEqual([
    "pause:run-1",
    "steer:run-1:all:prioritize verification evidence",
    "resolve:run-1:attention-1:approved with rollback",
    "task:run-1:impl",
    "runs",
  ]);
  expect(notifications.some((value) => value.includes("Dependencies: research"))).toBe(true);
  expect(notifications.at(-1)).toContain("restart-me · paused");
});

test("loop_run reports observer interruption as still running", async () => {
  const host = fakePi();
  const notifications: string[] = [];
  registerLoopExtension(host.api, fakeBackend({
    async run(input) {
      input.signal.throwIfAborted();
      return {
        status: "running",
        tasks: input.tasks.length,
        escalations: [],
        providersByTask: {},
        startedAt: {},
        finishedAt: {},
      };
    },
  }), undefined, limits);

  const result = await host.tools.get("loop_run")!.execute(
    "tool-running",
    {
      intent: "Continue in the detached owner",
      runId: "run-detached",
      tasksJson: JSON.stringify([task("impl", "implementation", [], ["src/**"])]),
    },
    new AbortController().signal,
    undefined,
    context(notifications),
  );

  expect(result.content[0]?.text).toContain("Execution continues in the detached owner");
  expect(result.content[0]?.text).toContain("Next: /loop status run-detached");
});

test("observer abort resolves a running summary instead of a false failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-observer-abort-"));
  const executable = join(directory, "fake-loop");
  writeFileSync(executable, [
    "#!/usr/bin/env bun",
    "process.stdin.resume();",
    "process.on('SIGTERM', () => process.exit(0));",
    "console.log(JSON.stringify({ type: 'snapshot', value: {} }));",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  chmodSync(executable, 0o755);
  const previous = process.env.LOOP_BIN;
  process.env.LOOP_BIN = executable;
  const controller = new AbortController();
  try {
    const pending = runLoopPlan({
      intent: "Keep executing",
      tasks: [task("impl", "implementation", [], ["src/**"])],
      runId: "run-observer",
      cwd: directory,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ status: "running", tasks: 1 });
  } finally {
    if (previous === undefined) delete process.env.LOOP_BIN;
    else process.env.LOOP_BIN = previous;
  }
});

test("terminal summary returns to Pi even when the observer process stays alive", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-observer-completed-"));
  const executable = join(directory, "fake-loop");
  writeFileSync(executable, [
    "#!/usr/bin/env bun",
    "process.stdin.resume();",
    "console.log(JSON.stringify({ type: 'snapshot', value: { state: 'completed' } }));",
    "console.log(JSON.stringify({ type: 'summary', value: { status: 'completed', tasks: 1 } }));",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  chmodSync(executable, 0o755);
  const previous = process.env.LOOP_BIN;
  process.env.LOOP_BIN = executable;
  const controller = new AbortController();
  try {
    const pending = runLoopPlan({ intent: "Complete", tasks: [task("impl", "implementation", [], ["src/**"])], runId: "completed-run", cwd: directory, signal: controller.signal });
    const result = await Promise.race([pending, Bun.sleep(300).then(() => ({ status: "still-waiting" }))]);
    expect(result.status).toBe("completed");
  } finally {
    controller.abort();
    if (previous === undefined) delete process.env.LOOP_BIN;
    else process.env.LOOP_BIN = previous;
    rmSync(directory, { recursive: true, force: true });
  }
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

function task(
  id: string,
  kind: TaskSpecInput["kind"],
  dependencies: string[],
  writeScope: string[],
): TaskSpecInput {
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
  const current = snapshot("run-x");
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
      return current;
    },
    async cancel() {
      return { ...current, state: "cancelled" as const };
    },
    async pause() {
      return { ...current, state: "paused" as const };
    },
    async resume() {
      return current;
    },
    async steer() {
      return current;
    },
    async resolve() {
      return current;
    },
    async task(_runId, taskId) {
      return taskContext(taskId);
    },
    async runs() {
      return [{ runId: current.runId, state: current.state }];
    },
    async models() {
      return ["fast · configured-model"];
    },
    ...overrides,
  };
}

function emptySnapshot(runId: string): SnapshotOutput {
  return {
    runId,
    state: "active",
    tasks: [],
    activeWorkers: [],
    openAttentionIds: [],
    attention: [],
    intent: "Test intent",
    workingDirectory: "/project",
    guidance: [],
    lastSequence: 0,
  };
}

function snapshot(runId: string): SnapshotOutput {
  return {
    ...emptySnapshot(runId),
    tasks: [{
      id: "impl",
      title: "Implement",
      kind: "implementation",
      state: "running",
      attempt: 1,
      preferredCompute: "fast",
      dependencies: ["research"],
      readScope: ["src/**"],
      writeScope: ["src/impl.ts"],
      blockedBy: [],
      activities: ["Editing renderer"],
    }],
  };
}

function taskContext(taskId: string): TaskContextOutput {
  return {
    intent: "Test intent",
    workingDirectory: "/project",
    task: task(taskId, "implementation", ["research"], ["src/impl.ts"]),
    attempt: 1,
    dependencyResults: [{
      taskId: "research",
      title: "Research",
      summary: "Found the generated contract",
    }],
    previousChecks: [],
    guidance: [],
  };
}

function context(notifications: string[] = []) {
  return {
    cwd: "/project",
    ui: { notify(message: string) { notifications.push(message); } },
  };
}
