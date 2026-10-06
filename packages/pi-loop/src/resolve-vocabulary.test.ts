import { expect, test } from "bun:test";

import type { SnapshotOutput } from "@loop/protocol";

import {
  registerLoopExtension,
  type LoopLeadBackend,
  type PiExtensionApi,
} from "./extension";

const limits = {
  statusLineLimit: 8,
  attentionLineLimit: 6,
  findingsLineLimit: 5,
  listLineLimit: 8,
  lineTextLimit: 160,
};
// Disk-independent fixture matching a default install.
const settings = { limits, vocabulary: undefined };

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

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

function attentionSnapshot(): SnapshotOutput {
  return {
    runId: "run-x",
    state: "attention",
    tasks: [
      {
        id: "impl",
        title: "Implement",
        kind: "implementation",
        state: "ready",
        attempt: 1,
        preferredCompute: "fast",
        dependencies: [],
        readScope: [],
        writeScope: ["src/**"],
        blockedBy: [],
        activities: [],
      },
    ],
    activeWorkers: [],
    openAttentionIds: ["failure-1"],
    attention: [
      {
        id: "failure-1",
        kind: "failure",
        summary: "no eligible compute candidate satisfies task constraints",
        taskId: "impl",
      },
    ],
    intent: "Test intent",
    workingDirectory: "/project",
    guidance: [],
    goalCriteria: [],
    lastSequence: 0,
  };
}

function resolveBackend(calls: string[]): LoopLeadBackend {
  const captured = JSON.parse(JSON.stringify(attentionSnapshot())) as SnapshotOutput;
  return {
    async run() {
      return { status: "completed", tasks: 0, escalations: [], providersByTask: {}, startedAt: {}, finishedAt: {} };
    },
    async snapshot() {
      return captured;
    },
    async cancel() {
      return { ...captured, state: "cancelled" as const };
    },
    async pause() {
      return { ...captured, state: "paused" as const };
    },
    async resume() {
      return captured;
    },
    async steer() {
      return captured;
    },
    async resolve(runId, attentionId, resolution) {
      calls.push(`${runId}:${attentionId}:${resolution}`);
      return { ...captured, state: "active", openAttentionIds: [] };
    },
    async task() {
      throw new Error("not needed");
    },
    async guidance() {
      return "";
    },
    async runs() {
      return [];
    },
    async models() {
      return [];
    },
    async promoteSteer(_runId, _message, task, criteria) {
      return {
        accepted: true,
        runId: "run-x",
        taskId: task.id,
        criterionIds: criteria.map((criterion) => criterion.id),
        summary: "promoted",
        evidenceTests: [],
      };
    },
  };
}

function context() {
  return { cwd: "/project", ui: { notify() {} } };
}

const correctiveTask = {
  id: "repair-check",
  title: "Make the flaky check deterministic",
  writeScope: ["src/checks/**"],
  requirements: ["the failing check passes on a clean checkout"],
  completionChecks: [
    { id: "verify-repair", command: "cargo", args: ["test", "-p", "check"], timeoutMs: 120_000 },
  ],
};

test("loop_resolve carries the corrective contract inside the add_task directive", async () => {
  const host = fakePi();
  const calls: string[] = [];
  registerLoopExtension(host.api, resolveBackend(calls), undefined, settings as never);
  await must(host.tools.get("loop_resolve")).execute(
    "resolve",
    { runId: "run-x", attentionId: "failure-1", resolution: "add_task", correctiveTask },
    new AbortController().signal,
    undefined,
    context(),
  );
  expect(calls).toHaveLength(1);
  const [sent] = calls;
  expect(sent).toMatch(/^run-x:failure-1:add_task:/);
  const payload = JSON.parse(must(sent?.split("add_task:")[1])) as Record<string, unknown>;
  expect(payload).toEqual(correctiveTask);
});

test("loop_resolve refuses a corrective contract outside the add_task directive", async () => {
  const host = fakePi();
  const calls: string[] = [];
  registerLoopExtension(host.api, resolveBackend(calls), undefined, settings as never);
  await expect(
    must(host.tools.get("loop_resolve")).execute(
      "resolve",
      { runId: "run-x", attentionId: "failure-1", resolution: "retry", correctiveTask },
      new AbortController().signal,
      undefined,
      context(),
    ),
  ).rejects.toThrow(/add_task/);
  expect(calls).toEqual([]);
});

test("loop_resolve forwards the relax_routing directive verbatim", async () => {
  const host = fakePi();
  const calls: string[] = [];
  registerLoopExtension(host.api, resolveBackend(calls), undefined, settings as never);
  const tool = must(host.tools.get("loop_resolve"));
  expect(tool.description).toContain("relax_routing");
  await tool.execute(
    "resolve",
    { runId: "run-x", attentionId: "failure-1", resolution: "relax_routing" },
    new AbortController().signal,
    undefined,
    context(),
  );
  expect(calls).toEqual(["run-x:failure-1:relax_routing"]);
});
