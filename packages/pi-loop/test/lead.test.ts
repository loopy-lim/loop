import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SnapshotOutput, TaskContextOutput, TaskSpecInput } from "@loop/protocol";
import { derivePersonaVocabulary } from "@loop/orchestrator/persona";
import { workerRunMarker } from "@loop/herdr";

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
// Disk-independent fixture matching a default install: the compile-time
// persona floor with no registry (the same derivation the default settings
// path would produce for an uninstalled personas directory).
const settings = { limits, vocabulary: derivePersonaVocabulary({}) };

test("natural-language Pi turns receive the Loop Lead contract", async () => {
  const host = fakePi();
  registerLoopExtension(host.api, fakeBackend(), undefined, settings);

  const hook = host.hooks.get("before_agent_start")!;
  const result = await hook(
    { prompt: "Implement feature X", systemPrompt: "base" },
    context(),
  );

  expect(result.systemPrompt).toContain("interactive Lead for Loop");
  expect(result.systemPrompt).toContain("call loop_run exactly once");
  expect(result.systemPrompt).toContain("Do not deeply debug, investigate root causes, or implement the change yourself");
  expect(result.systemPrompt).toContain("minimum path and contract context");
  expect(result.systemPrompt).toContain("same parallel frontier");
  expect(result.systemPrompt).toContain("non-overlapping implementation tasks");
  expect(result.systemPrompt).toContain("Keep dependency-ordered work sequential");
  expect(result.systemPrompt).toContain("serialize decision and integration tasks");
  expect(result.systemPrompt).toContain("Do not add ceremonial research or decision tasks");
  expect(result.systemPrompt).toContain("dependency result summaries");
  expect(result.systemPrompt).toContain("exact read and write ownership");
  expect(result.systemPrompt).toContain("Loop owns verification");
  expect(result.systemPrompt).toContain("acceptance criteria");
  expect(result.systemPrompt).toContain("separate verification task only for material risk");
  expect(result.systemPrompt).toContain("executable checks that cover each acceptance criterion");
  expect(result.systemPrompt).toContain("If a verifier reports FAIL");
  expect(result.systemPrompt).toContain("Do not poll or sleep after loop_run returns");
  expect(result.systemPrompt).toContain("For changed acceptance criteria, add a dependent task");
  expect(result.systemPrompt).toContain("Never claim that guidance was implemented from delivery alone");
  expect(result.systemPrompt).toContain("previous run ended in attention, paused, cancelled, or otherwise incomplete");
  expect(result.systemPrompt).toContain("Do not invent unavailable run or task details");
  expect(result.systemPrompt).toContain("Implement feature X");

  const tool = host.tools.get("loop_run")!;
  const tasksDescription = tool.parameters.properties.tasksJson.description as string;
  expect(tasksDescription).toContain("TaskSpecInput[]");
  expect(tasksDescription).toContain('"completionChecks"');
  expect(tasksDescription).toContain('"preferredCompute"');
  expect(host.tools.get("loop_steer")?.description).toContain("Use loop_add_task for changed acceptance criteria");
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
  registerLoopExtension(host.api, backend, undefined, settings);

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

test("loop_run distinguishes completed goals from attention and gives a continuation path", async () => {
  const completedHost = fakePi();
  registerLoopExtension(completedHost.api, fakeBackend(), undefined, settings);
  const completed = await completedHost.tools.get("loop_run")!.execute(
    "tool-completed",
    {
      intent: "Finish every acceptance criterion",
      runId: "run-completed",
      tasksJson: JSON.stringify([task("implementation", "implementation", [], ["src/**"])]),
    },
    new AbortController().signal,
    undefined,
    context(),
  );

  const attentionHost = fakePi();
  registerLoopExtension(attentionHost.api, fakeBackend({
    async run(input) {
      return {
        status: "attention",
        tasks: input.tasks.length,
        escalations: [],
        providersByTask: {},
        startedAt: {},
        finishedAt: {},
      };
    },
  }), undefined, settings);
  const attention = await attentionHost.tools.get("loop_run")!.execute(
    "tool-attention",
    {
      intent: "Finish every acceptance criterion",
      runId: "run-attention",
      tasksJson: JSON.stringify([task("implementation", "implementation", [], ["src/**"])]),
    },
    new AbortController().signal,
    undefined,
    context(),
  );

  expect(completed.content[0]?.text).toContain("Goal: complete");
  expect(completed.content[0]?.text).toContain("Verification: passed");
  expect(completed.content[0]?.text).not.toContain("Goal: incomplete");
  expect(attention.content[0]?.text).toContain("Goal: incomplete");
  expect(attention.content[0]?.text).toContain("Remaining: original acceptance criteria are not fully verified");
  expect(attention.content[0]?.text).toContain("Answer the attention here");
  expect(attention.content[0]?.text).not.toContain("/loop");
  expect(attention.content[0]?.text).not.toContain("Goal: complete");
  expect(attention.content[0]?.text).not.toContain("Verification: passed");
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
  const customSettings = { limits: customLimits, vocabulary: derivePersonaVocabulary({}) };
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
  registerLoopExtension(host.api, backend, undefined, customSettings);
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
  registerLoopExtension(host.api, backend, undefined, settings);
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

test("natural-language tools use the bound run and preserve the user's steering text", async () => {
  const host = fakePi();
  const calls: string[] = [];
  const backend = fakeBackend({
    async run(input) { return { status: "running", tasks: input.tasks.length, escalations: [], providersByTask: {}, startedAt: {}, finishedAt: {} }; },
    async steer(runId, taskId, message) { calls.push(`steer:${runId}:${taskId}:${message}`); return snapshot(runId); },
    async addTask(runId, task) { calls.push(`add:${runId}:${task.id}`); return { ...snapshot(runId), lastSequence: 2 }; },
    async pause(runId) { calls.push(`pause:${runId}`); return { ...snapshot(runId), state: "paused", lastSequence: 3 }; },
  });
  registerLoopExtension(host.api, backend, undefined, settings);
  const piContext = context();
  await host.tools.get("loop_run")!.execute("start", { intent: "Fix", runId: "run-x", tasksJson: JSON.stringify([task("impl", "implementation", [], ["src/**"])]) }, new AbortController().signal, undefined, piContext);
  await host.hooks.get("before_agent_start")!({ prompt: "지금 작업에서 X는 빼줘", systemPrompt: "base" }, piContext);
  await host.tools.get("loop_steer")!.execute("steer", { taskId: "impl" }, new AbortController().signal, undefined, piContext);
  await host.tools.get("loop_add_task")!.execute("add", { taskJson: JSON.stringify(task("verify", "verification", ["impl"], [])) }, new AbortController().signal, undefined, piContext);
  await host.tools.get("loop_control")!.execute("pause", { action: "pause" }, new AbortController().signal, undefined, piContext);
  expect(calls).toEqual(["steer:run-x:impl:지금 작업에서 X는 빼줘", "add:run-x:verify", "pause:run-x"]);
});

test("session start restores one run in this directory and avoids ambiguous auto-attach", async () => {
  const host = fakePi();
  const statuses: string[] = [];
  const piContext = { ...context(), ui: { notify() {}, setStatus(_key: string, value?: string) { statuses.push(value ?? ""); } }, sessionManager: { getBranch: () => [{ type: "custom", customType: "loop-run-binding", data: { runId: "run-x", workingDirectory: "/project" } }] } };
  registerLoopExtension(host.api, fakeBackend(), undefined, settings);
  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);
  expect(statuses.some(value => value.includes("Loop active"))).toBe(true);
  await host.events.get("session_shutdown")?.at(-1)?.({}, piContext);

  const ambiguous = fakePi();
  const messages: string[] = [];
  const backend = fakeBackend({ async runs() { return [{ runId: "a", state: "active" }, { runId: "b", state: "active" }]; }, async snapshot(runId) { return snapshot(runId); } });
  registerLoopExtension(ambiguous.api, backend, undefined, settings);
  await ambiguous.events.get("session_start")?.at(-1)?.({}, { ...context(), ui: { notify() {}, setStatus(_key: string, value?: string) { messages.push(value ?? ""); } }, sessionManager: { getBranch: () => [] } });
  expect(messages).toContain("2 Loop runs · choose one in conversation");
});

test("Pi remains usable when the run database cannot be read at startup", async () => {
  const host = fakePi();
  const statuses: string[] = [];
  registerLoopExtension(host.api, fakeBackend({ async runs() { throw new Error("database unavailable"); } }), undefined, settings);
  const piContext = { ...context(), ui: { notify() {}, setStatus(_key: string, value?: string) { statuses.push(value ?? ""); } }, sessionManager: { getBranch: () => [] } };
  await expect(host.events.get("session_start")?.at(-1)?.({}, piContext)).resolves.toBeUndefined();
  expect(statuses).toContain("Loop status unavailable");
});

test("last branch binding wins and a different directory does not revive an older run", async () => {
  const host = fakePi();
  registerLoopExtension(host.api, fakeBackend({ async runs() { return []; } }), undefined, settings);
  const piContext = { ...context(), sessionManager: { getBranch: () => [
    { type: "custom", customType: "loop-run-binding", data: { runId: "old", workingDirectory: "/project" } },
    { type: "custom", customType: "loop-run-binding", data: { runId: "new", workingDirectory: "/elsewhere" } },
  ] } };
  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  const status = await host.tools.get("loop_status")!.execute("status", {}, new AbortController().signal, undefined, piContext);
  expect(status.content[0]?.text).toBe("No active Loop run in this directory.");
});

test("a slow old branch restore cannot replace a newer branch binding", async () => {
  const host = fakePi();
  let releaseOld!: (value: SnapshotOutput) => void;
  const oldSnapshot = new Promise<SnapshotOutput>(resolve => { releaseOld = resolve; });
  let branch = [{ type: "custom", customType: "loop-run-binding", data: { runId: "old", workingDirectory: "/project" } }];
  registerLoopExtension(host.api, fakeBackend({ async snapshot(runId) { return runId === "old" ? oldSnapshot : snapshot(runId); } }), undefined, settings);
  const piContext = { ...context(), sessionManager: { getBranch: () => branch } };
  const slow = host.events.get("session_start")?.at(-1)?.({}, piContext);
  branch = [{ type: "custom", customType: "loop-run-binding", data: { runId: "new", workingDirectory: "/project" } }];
  await host.events.get("session_tree")?.at(-1)?.({}, piContext);
  releaseOld(snapshot("old"));
  await slow;
  const status = await host.tools.get("loop_status")!.execute("status", {}, new AbortController().signal, undefined, piContext);
  expect(status.details.runId).toBe("new");
});

test("new run refuses another active goal in the same directory even without a binding", async () => {
  const host = fakePi();
  registerLoopExtension(host.api, fakeBackend({ async runs() { return [{ runId: "other", state: "active" }]; }, async snapshot(runId) { return snapshot(runId); } }), undefined, settings);
  await expect(host.tools.get("loop_run")!.execute("new", { intent: "Another goal", tasksJson: JSON.stringify([task("impl", "implementation", [], ["src/**"])]) }, new AbortController().signal, undefined, context())).rejects.toThrow("other");
});

test("new run waits while an earlier run is still cancelling", async () => {
  const host = fakePi();
  registerLoopExtension(host.api, fakeBackend({ async runs() { return [{ runId: "draining", state: "cancelling" }]; }, async snapshot(runId) { return { ...snapshot(runId), state: "cancelling" }; } }), undefined, settings);
  await expect(host.tools.get("loop_run")!.execute("new", { intent: "Next goal", tasksJson: JSON.stringify([task("impl", "implementation", [], ["src/**"])]) }, new AbortController().signal, undefined, context())).rejects.toThrow("draining");
});

test("ambiguous runs can be listed and a status read does not switch the control target", async () => {
  const host = fakePi();
  const paused: string[] = [];
  registerLoopExtension(host.api, fakeBackend({
    async runs() { return [{ runId: "a", state: "active" }, { runId: "b", state: "active" }]; },
    async snapshot(runId) { return { ...snapshot(runId), intent: runId === "a" ? "Fix login" : "Fix build" }; },
    async pause(runId) { paused.push(runId); return { ...snapshot(runId), state: "paused" }; },
  }), undefined, settings);
  const piContext = context();
  const listed = await host.tools.get("loop_status")!.execute("list", {}, new AbortController().signal, undefined, piContext);
  expect(listed.content[0]?.text).toContain("Fix login");
  expect(listed.content[0]?.text).toContain("Fix build");
  await host.tools.get("loop_select_run")!.execute("select", { runId: "a" }, new AbortController().signal, undefined, piContext);
  await host.tools.get("loop_status")!.execute("inspect", { runId: "b" }, new AbortController().signal, undefined, piContext);
  await host.tools.get("loop_control")!.execute("pause", { action: "pause" }, new AbortController().signal, undefined, piContext);
  expect(paused).toEqual(["a"]);
});

test("Pi Lead refuses to steer a completed task while a descendant verifier is running", async () => {
  const host = fakePi();
  const steered: string[] = [];
  const backend = fakeBackend({
    async snapshot(runId) {
      return {
        ...snapshot(runId),
        tasks: [
          { ...snapshot(runId).tasks[0]!, id: "implementation", state: "done" },
          { ...snapshot(runId).tasks[0]!, id: "verification", kind: "verification", state: "running", dependencies: ["implementation"], writeScope: [] },
        ],
      };
    },
    async steer(_runId, taskId) { steered.push(taskId); return snapshot("run-x"); },
  });
  registerLoopExtension(host.api, backend, undefined, settings);
  const piContext = context();
  await host.tools.get("loop_select_run")!.execute("select", { runId: "run-x" }, new AbortController().signal, undefined, piContext);
  const instructions = await host.hooks.get("before_agent_start")!({ prompt: "Also support underscores", systemPrompt: "base" }, piContext);
  expect(instructions.systemPrompt).toContain("If the bound run is terminal and the user has an unfinished requirement, start a follow-up run");

  await expect(host.tools.get("loop_steer")!.execute("steer", { taskId: "implementation" }, new AbortController().signal, undefined, piContext))
    .rejects.toThrow(/completed.*dependent task/i);
  expect(steered).toEqual([]);
});

test("Pi attention status gives a conversational resolution path", async () => {
  const host = fakePi();
  registerLoopExtension(host.api, fakeBackend({ async snapshot(runId) { return { ...snapshot(runId), state: "attention", openAttentionIds: ["approval-1"], attention: [{ id: "approval-1", kind: "approval", summary: "Approve migration" }] }; } }), undefined, settings);
  const output = await host.tools.get("loop_status")!.execute("attention", { runId: "run-x", action: "attention" }, new AbortController().signal, undefined, context());
  expect(output.content[0]?.text).toContain("Approve migration");
  expect(output.content[0]?.text).toContain("Answer the relevant item here");
  expect(output.content[0]?.text).not.toContain("/loop");
});

test("observer records one final message with check evidence across session restoration", async () => {
  const host = fakePi();
  const entries: Array<{ type: string; customType: string; data: unknown }> = [{ type: "custom", customType: "loop-run-binding", data: { runId: "run-x", workingDirectory: "/project" } }];
  const messages: Array<{ customType: string; content: string }> = [];
  host.api.appendEntry = (customType, data) => entries.push({ type: "custom", customType, data });
  host.api.sendMessage = message => { messages.push(message); };
  const backend = fakeBackend({
    async snapshot() { return { ...snapshot("run-x"), state: "completed", tasks: [{ ...snapshot("run-x").tasks[0]!, state: "done", resultSummary: "Fixed the bug" }], lastSequence: 7 }; },
    async task(_runId, taskId) { return { ...taskContext(taskId), previousChecks: [{ id: "focused", command: "bun", args: ["test"], workingDirectory: "/project", exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 }] }; },
  });
  registerLoopExtension(host.api, backend, undefined, settings);
  const piContext = { ...context(), ui: { notify() {}, setStatus() {} }, sessionManager: { getBranch: () => entries } };
  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);
  expect(messages.filter(message => message.customType === "loop-final")).toHaveLength(1);
  expect(messages.find(message => message.customType === "loop-final")?.content).toContain("checks focused");
  expect(messages.find(message => message.customType === "loop-final")?.content).toContain("Verified tasks: 1/1");
  expect(messages.filter(message => message.customType === "loop-final-review")).toHaveLength(1);
  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);
  expect(messages.filter(message => message.customType === "loop-final")).toHaveLength(1);
  expect(messages.filter(message => message.customType === "loop-final-review")).toHaveLength(1);
  await host.events.get("session_shutdown")?.at(-1)?.({}, piContext);
});

test("Pi Lead reviews a completed goal once and does not recursively review its automatic follow-up", async () => {
  const host = fakePi();
  const entries: Array<{ type: string; customType: string; data: unknown }> = [
    { type: "custom", customType: "loop-run-binding", data: { runId: "run-first", workingDirectory: "/project" } },
  ];
  const messages: Array<{ customType: string; content: string; display: boolean; triggerTurn?: boolean }> = [];
  host.api.appendEntry = (customType, data) => entries.push({ type: "custom", customType, data });
  host.api.sendMessage = (message, options) => { messages.push({ ...message, triggerTurn: options?.triggerTurn }); };
  const backend = fakeBackend({
    async run(input) {
      return { status: "running", tasks: input.tasks.length, escalations: [], providersByTask: {}, startedAt: {}, finishedAt: {} };
    },
    async snapshot(runId) {
      return {
        ...emptySnapshot(runId),
        state: "completed",
        tasks: [{ ...snapshot(runId).tasks[0]!, state: "done" }],
        lastSequence: 8,
      };
    },
  });
  registerLoopExtension(host.api, backend, undefined, settings);
  const piContext = { ...context(), ui: { notify() {}, setStatus() {} }, sessionManager: { getBranch: () => entries } };
  await host.hooks.get("before_agent_start")!({ prompt: "Fix the original bug", systemPrompt: "base" }, piContext);
  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);

  expect(messages.filter(message => message.customType === "loop-final")).toHaveLength(1);
  const review = messages.find(message => message.customType === "loop-final-review");
  expect(review).toMatchObject({ display: false, triggerTurn: true });
  expect(review?.content).toContain("original goal");

  await host.events.get("message_start")?.at(-1)?.({ message: { role: "custom", customType: "loop-final-review" } }, piContext);
  await expect(host.tools.get("loop_steer")!.execute("review-steer", { taskId: "all" }, new AbortController().signal, undefined, piContext))
    .rejects.toThrow("latest user message");
  await host.tools.get("loop_run")!.execute("follow-up", {
    intent: "Finish the uncovered requirement",
    runId: "run-follow-up",
    tasksJson: JSON.stringify([task("finish", "implementation", [], ["src/**"])]),
  }, new AbortController().signal, undefined, piContext);
  await Bun.sleep(20);

  expect(messages.filter(message => message.customType === "loop-final")).toHaveLength(2);
  expect(messages.filter(message => message.customType === "loop-final-review")).toHaveLength(1);
  await host.events.get("agent_end")?.at(-1)?.({}, piContext);
  await host.hooks.get("before_agent_start")!({ prompt: "Another user correction", systemPrompt: "base" }, piContext);
  await host.events.get("message_start")?.at(-1)?.({ message: { role: "user" } }, piContext);
  await host.tools.get("loop_run")!.execute("user-correction", {
    intent: "Apply the later user correction",
    runId: "run-user-correction",
    tasksJson: JSON.stringify([task("correction", "implementation", [], ["src/**"])]),
  }, new AbortController().signal, undefined, piContext);
  await Bun.sleep(20);
  expect(messages.filter(message => message.customType === "loop-final")).toHaveLength(3);
  expect(messages.filter(message => message.customType === "loop-final-review")).toHaveLength(2);
  await host.events.get("session_shutdown")?.at(-1)?.({}, piContext);
});

test("Pi Lead shows measured handoff and final time only in the originating session", async () => {
  const host = fakePi();
  const entries: Array<{ type: string; customType: string; data: unknown }> = [];
  const messages: Array<{ customType: string; content: string }> = [];
  host.api.appendEntry = (customType, data) => { entries.push({ type: "custom", customType, data }); };
  host.api.sendMessage = message => { messages.push(message); };
  const backend = fakeBackend({
    async run(input) { return { status: "running", tasks: input.tasks.length, escalations: [], providersByTask: {}, startedAt: {}, finishedAt: {} }; },
    async snapshot(runId) { return { ...emptySnapshot(runId), state: "completed", tasks: [{ ...snapshot(runId).tasks[0]!, state: "done" }], lastSequence: 3 }; },
  });
  registerLoopExtension(host.api, backend, undefined, settings);
  const piContext = { ...context(), ui: { notify() {}, setStatus() {} }, sessionManager: { getBranch: () => entries } };
  await host.hooks.get("before_agent_start")!({ prompt: "Finish this change", systemPrompt: "base" }, piContext);
  const handoff = await host.tools.get("loop_run")!.execute("timed", {
    intent: "Finish this change",
    runId: "timed-run",
    tasksJson: JSON.stringify([task("impl", "implementation", [], ["src/**"])]),
  }, new AbortController().signal, undefined, piContext);
  expect(handoff.content[0]?.text).toMatch(/요청→인계 \d+\.\d초/);
  await Bun.sleep(20);
  const final = messages.find(message => message.customType === "loop-final")?.content;
  expect(final).toMatch(/요청→결과 \d+\.\d초/);
  expect(final?.split("\n").length).toBeLessThanOrEqual(8);

  const restored = fakePi();
  const restoredMessages: Array<{ customType: string; content: string }> = [];
  restored.api.sendMessage = message => { restoredMessages.push(message); };
  registerLoopExtension(restored.api, backend, undefined, settings);
  const restoredContext = { ...piContext, sessionManager: { getBranch: () => entries.filter(entry => entry.customType === "loop-run-binding") } };
  await restored.events.get("session_start")?.at(-1)?.({}, restoredContext);
  await Bun.sleep(20);
  expect(restoredMessages.find(message => message.customType === "loop-final")?.content).not.toContain("요청→결과");
  await host.events.get("session_shutdown")?.at(-1)?.({}, piContext);
  await restored.events.get("session_shutdown")?.at(-1)?.({}, restoredContext);
});

test("explicitly cancelled runs report their result without starting an automatic review", async () => {
  const host = fakePi();
  const entries = [{ type: "custom", customType: "loop-run-binding", data: { runId: "run-cancelled", workingDirectory: "/project" } }];
  const messages: Array<{ customType: string }> = [];
  host.api.sendMessage = message => { messages.push(message); };
  registerLoopExtension(host.api, fakeBackend({
    async snapshot(runId) { return { ...emptySnapshot(runId), state: "cancelled", lastSequence: 2 }; },
  }), undefined, settings);
  const piContext = { ...context(), ui: { notify() {}, setStatus() {} }, sessionManager: { getBranch: () => entries } };

  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);

  expect(messages.map(message => message.customType)).toEqual(["loop-final"]);
  await host.events.get("session_shutdown")?.at(-1)?.({}, piContext);
});

test("Pi widget follows active work and attention, then clears after completion", async () => {
  const host = fakePi();
  const widgets: Array<string[] | undefined> = [];
  let latest: SnapshotOutput = { ...snapshot("run-x"), lastSequence: 1 };
  const piContext = {
    ...context(),
    ui: {
      notify() {},
      setStatus() {},
      setWidget(key: string, lines: string[] | undefined) {
        expect(key).toBe("loop-run");
        widgets.push(lines);
      },
    },
    sessionManager: { getBranch: () => [{ type: "custom", customType: "loop-run-binding", data: { runId: "run-x", workingDirectory: "/project" } }] },
  };
  registerLoopExtension(host.api, fakeBackend({ async snapshot() { return latest; } }), undefined, settings);

  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);
  expect(widgets.at(-1)).toEqual(["Loop · active · 0/1 verified", "Working: Implement · ask here to adjust"]);

  latest = { ...latest, state: "attention", lastSequence: 2, openAttentionIds: ["a1"], attention: [{ id: "a1", kind: "question", summary: "Choose scope" }] };
  await Bun.sleep(550);
  expect(widgets.at(-1)).toEqual(["Loop · attention · 0/1 verified", "Decision: Choose scope · answer here"]);

  latest = { ...latest, state: "completed", lastSequence: 3, openAttentionIds: [], attention: [], tasks: [{ ...latest.tasks[0]!, state: "done" }] };
  await Bun.sleep(550);
  expect(widgets.at(-1)).toBeUndefined();
  await host.events.get("session_shutdown")?.at(-1)?.({}, piContext);
});

test("Pi widget names the active worker's selectable Herdr tab", async () => {
  const host = fakePi();
  const widgets: Array<string[] | undefined> = [];
  const active = {
    ...snapshot("run-x"),
    lastSequence: 1,
    activeWorkers: [{ id: "worker-1", taskId: "impl" }],
  };
  registerLoopExtension(host.api, fakeBackend({ async snapshot() { return active; } }), undefined, {
    ...settings,
    herdrVisible: true,
  });
  const piContext = {
    ...context(),
    ui: { notify() {}, setStatus() {}, setWidget(_key: string, lines: string[] | undefined) { widgets.push(lines); } },
    sessionManager: { getBranch: () => [{ type: "custom", customType: "loop-run-binding", data: { runId: "run-x", workingDirectory: "/project" } }] },
  };
  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);
  expect(widgets.at(-1)?.[1]).toContain("impl");
  expect(widgets.at(-1)?.[1]).toContain("Herdr tab");
  expect(widgets.at(-1)?.[1]).toContain(workerRunMarker("run-x"));
  await host.events.get("session_shutdown")?.at(-1)?.({}, piContext);
});

test("inspecting or controlling another run leaves the bound Pi widget on its run", async () => {
  const host = fakePi();
  const widgets: Array<string[] | undefined> = [];
  let boundSequence = 1;
  const piContext = {
    ...context(),
    ui: {
      notify() {},
      setStatus() {},
      setWidget(_key: string, lines: string[] | undefined) { widgets.push(lines); },
    },
    sessionManager: { getBranch: () => [{ type: "custom", customType: "loop-run-binding", data: { runId: "a", workingDirectory: "/project" } }] },
  };
  registerLoopExtension(host.api, fakeBackend({
    async snapshot(runId) { return { ...snapshot(runId), lastSequence: runId === "a" ? boundSequence : 100 }; },
    async pause(runId) { return { ...snapshot(runId), state: "paused", lastSequence: 100 }; },
  }), undefined, settings);

  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);
  expect(widgets.at(-1)?.[0]).toContain("Loop · active");

  await host.commands.get("loop")!.handler("status b", piContext);
  await host.tools.get("loop_control")!.execute("pause-b", { action: "pause", runId: "b" }, new AbortController().signal, undefined, piContext);
  expect(widgets.at(-1)?.[0]).toContain("Loop · active");
  const currentStatus = await host.tools.get("loop_status")!.execute("status-a", {}, new AbortController().signal, undefined, piContext);
  expect(currentStatus.details.runId).toBe("a");

  boundSequence = 2;
  await Bun.sleep(550);
  expect(widgets.at(-1)?.[0]).toContain("Loop · active");
  await host.events.get("session_shutdown")?.at(-1)?.({}, piContext);
});

test("final message prioritizes a late failed task over earlier successful tasks", async () => {
  const host = fakePi();
  const messages: string[] = [];
  host.api.sendMessage = message => { messages.push(message.content); };
  const tasks = Array.from({ length: 6 }, (_, index) => ({ ...snapshot("run-x").tasks[0]!, id: `task-${index}`, state: index === 5 ? "failed" as const : "done" as const, lastFailure: index === 5 ? "focused check failed" : null }));
  registerLoopExtension(host.api, fakeBackend({ async snapshot() { return { ...snapshot("run-x"), state: "failed", tasks, lastSequence: 9 }; } }), undefined, settings);
  const piContext = { ...context(), ui: { notify() {}, setStatus() {} }, sessionManager: { getBranch: () => [{ type: "custom", customType: "loop-run-binding", data: { runId: "run-x", workingDirectory: "/project" } }] } };
  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);
  expect(messages[0]).toContain("task-5: failed");
  expect(messages[0]).toContain("focused check failed");
  expect(messages[0]?.split("\n").length).toBeLessThanOrEqual(8);
  await host.events.get("session_shutdown")?.at(-1)?.({}, piContext);
});

test("Pi Lead surfaces a verifier FAIL even when executable checks marked the run completed", async () => {
  const host = fakePi();
  const messages: string[] = [];
  host.api.sendMessage = message => { messages.push(message.content); };
  const failedReview = {
    ...snapshot("run-x"),
    state: "completed" as const,
    lastSequence: 9,
    tasks: [
      { ...snapshot("run-x").tasks[0]!, id: "implementation", state: "done" as const, resultSummary: "Implemented" },
      { ...snapshot("run-x").tasks[0]!, id: "verification", kind: "verification" as const, state: "done" as const, resultSummary: "- Verdict: FAIL — missing edge-case test" },
    ],
  };
  registerLoopExtension(host.api, fakeBackend({ async snapshot() { return failedReview; } }), undefined, settings);
  const piContext = { ...context(), ui: { notify() {}, setStatus() {} }, sessionManager: { getBranch: () => [{ type: "custom", customType: "loop-run-binding", data: { runId: "run-x", workingDirectory: "/project" } }] } };

  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);
  expect(messages[0]).toContain("Review needed: verifier reported FAIL");
  expect(messages[0]?.split("\n").length).toBeLessThanOrEqual(8);
  const status = await host.tools.get("loop_status")!.execute("status", {}, new AbortController().signal, undefined, piContext);
  expect(status.content[0]?.text).toContain("Review needed: verifier reported FAIL");
  expect(status.content[0]?.text.split("\n").length).toBeLessThanOrEqual(8);
  await host.events.get("session_shutdown")?.at(-1)?.({}, piContext);
});

test("observer resumes after attention and stops following the old session branch", async () => {
  const host = fakePi();
  const messages: string[] = [];
  const widgets: Array<string[] | undefined> = [];
  host.api.sendMessage = message => { messages.push(`${message.customType}:${message.content}`); };
  let latest = { ...snapshot("run-x"), lastSequence: 1 };
  let branch: Array<{ type: string; customType: string; data: unknown }> = [{ type: "custom", customType: "loop-run-binding", data: { runId: "run-x", workingDirectory: "/project" } }];
  registerLoopExtension(host.api, fakeBackend({ async snapshot() { return latest; }, async runs() { return []; } }), undefined, settings);
  const piContext = { ...context(), ui: { notify() {}, setStatus() {}, setWidget(_key: string, lines: string[] | undefined) { widgets.push(lines); } }, sessionManager: { getBranch: () => branch } };
  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);
  expect(widgets.at(-1)?.[0]).toContain("Loop · active");
  latest = { ...latest, state: "attention", lastSequence: 2, openAttentionIds: ["a1"], attention: [{ id: "a1", kind: "question", summary: "Choose scope" }] };
  await Bun.sleep(550);
  expect(messages.filter(value => value.startsWith("loop-attention:"))).toHaveLength(1);
  latest = { ...latest, state: "active", lastSequence: 3, openAttentionIds: [], attention: [] };
  await Bun.sleep(550);
  branch = [];
  await host.events.get("session_tree")?.at(-1)?.({}, piContext);
  expect(widgets.at(-1)).toBeUndefined();
  latest = { ...latest, state: "completed", lastSequence: 4 };
  await Bun.sleep(550);
  expect(messages.filter(value => value.startsWith("loop-final:"))).toHaveLength(0);
  await host.events.get("session_shutdown")?.at(-1)?.({}, piContext);
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
  }), undefined, settings);

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
  expect(result.content[0]?.text).toContain("Ask for progress or give corrections here");
});

test("aborted handoff does not report a confirmed owner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-observer-abort-"));
  const executable = join(directory, "fake-loop");
  writeFileSync(executable, [
    "#!/usr/bin/env bun",
    "process.stdin.resume();",
    "process.on('SIGTERM', () => process.exit(1));",
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
    await expect(pending).rejects.toThrow();
  } finally {
    if (previous === undefined) delete process.env.LOOP_BIN;
    else process.env.LOOP_BIN = previous;
  }
});

test("confirmed handoff returns to Pi without waiting for owner completion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-observer-completed-"));
  const executable = join(directory, "fake-loop");
  writeFileSync(executable, [
    "#!/usr/bin/env bun",
    "process.stdin.resume();",
    "console.log(JSON.stringify({ runId: 'completed-run', state: 'active', ownerPid: 42 }));",
  ].join("\n"));
  chmodSync(executable, 0o755);
  const previous = process.env.LOOP_BIN;
  process.env.LOOP_BIN = executable;
  const controller = new AbortController();
  try {
    const pending = runLoopPlan({ intent: "Complete", tasks: [task("impl", "implementation", [], ["src/**"])], runId: "completed-run", cwd: directory, signal: controller.signal });
    const result = await Promise.race([pending, Bun.sleep(300).then(() => ({ status: "still-waiting" }))]);
    expect(result.status).toBe("running");
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
  const events = new Map<string, Array<any>>();
  const api: PiExtensionApi = {
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    registerCommand(name, options) {
      commands.set(name, options);
    },
    on(event, handler) {
      hooks.set(event, handler);
      events.set(event, [...(events.get(event) ?? []), handler]);
    },
  };
  return { api, tools, commands, hooks, events };
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
      return [];
    },
    async models() {
      return ["fast · configured-model"];
    },
    async addTask() {
      return current;
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
