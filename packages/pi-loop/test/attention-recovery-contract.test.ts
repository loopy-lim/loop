import { expect, test } from "bun:test";

import type {
  SnapshotOutput,
  TaskContextOutput,
  TaskSpecInput,
} from "@loop/protocol";
import { derivePersonaVocabulary } from "@loop/orchestrator/persona";

import {
  registerLoopExtension,
  type LoopLeadBackend,
  type PiExtensionApi,
} from "../src/extension";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

const limits = {
  statusLineLimit: 8,
  attentionLineLimit: 6,
  findingsLineLimit: 5,
  listLineLimit: 8,
  lineTextLimit: 160,
};
const settings = { limits, vocabulary: derivePersonaVocabulary({}) };

function fakePi() {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const hooks = new Map<string, any>();
  const events = new Map<string, Array<any>>();
  const api: PiExtensionApi & { sendMessage?: (message: any, options?: any) => void } = {
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    registerCommand(name: string, options: any) {
      commands.set(name, options);
    },
    on(event: string, handler: any) {
      hooks.set(event, handler);
      events.set(event, [...(events.get(event) ?? []), handler]);
    },
  };
  return { api, tools, commands, hooks, events };
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
    goalCriteria: [],
    lastSequence: 0,
  };
}

const batchAbsenceAttention = {
  id: "failure-1",
  kind: "failure" as const,
  summary: "no eligible compute candidate satisfies task constraints",
  taskId: "impl",
  openedAtMs: null,
};

function attentionSnapshot(runId: string): SnapshotOutput {
  return {
    ...emptySnapshot(runId),
    state: "attention",
    openAttentionIds: ["failure-1"],
    attention: [batchAbsenceAttention],
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
  } as SnapshotOutput;
}

/** The failed task's spec: the routing constraints no batch candidate
 * satisfies, as `describeBlockedConstraints` reads them. */
function failedTaskSpec(): TaskSpecInput {
  return {
    id: "impl",
    title: "Implement",
    kind: "implementation",
    dependencies: [],
    readScope: [],
    writeScope: ["src/**"],
    requirements: ["requirement"],
    completionChecks: [
      {
        id: "tests",
        command: "bun",
        args: ["test"],
        workingDirectory: null,
        timeoutMs: 120_000,
      },
    ],
    preferredCompute: "fast",
    minimumCompute: "tiny",
    maximumCompute: "strong",
    routing: {
      risk: "high",
      required: { coding: 0, reasoning: 2, tools: 1, vision: 0, long_context: 0 },
    },
    maxAttempts: 3,
  };
}

function taskContext(spec: TaskSpecInput): TaskContextOutput {
  return {
    intent: "Test intent",
    workingDirectory: "/project",
    task: spec,
    attempt: 1,
    dependencyResults: [],
    previousChecks: [],
    guidance: [],
  };
}

function context() {
  return {
    cwd: "/project",
    ui: { notify() {}, setStatus() {} },
  };
}

/** The correctiveTask payload the Lead resolves with, matching the tool
 * parameter schema and the bridge's `CorrectiveTaskInput` wire shape. */
const correctiveTask = {
  id: "repair-check",
  title: "Make the flaky check deterministic",
  writeScope: ["src/checks/**"],
  requirements: ["the failing check passes on a clean checkout"],
  completionChecks: [
    {
      id: "verify-repair",
      command: "cargo",
      args: ["test", "-p", "check"],
      workingDirectory: null,
      timeoutMs: 120_000,
    },
  ],
};

test("the loop_resolve tool hands the corrective contract to the bridge as one embedded add_task token", async () => {
  const host = fakePi();
  const calls: string[] = [];
  const backend = fakeBackend({
    async resolve(runId, attentionId, resolution) {
      calls.push(`resolve:${runId}:${attentionId}:${resolution}`);
      return { ...attentionSnapshot(runId), state: "active", openAttentionIds: [], attention: [] };
    },
    async resume(runId) {
      calls.push(`resume:${runId}`);
      return { ...attentionSnapshot(runId), state: "active", openAttentionIds: [], attention: [] };
    },
  });
  registerLoopExtension(host.api, backend, undefined, settings);

  await host.tools.get("loop_resolve")?.execute(
    "resolve",
    {
      runId: "run-x",
      attentionId: "failure-1",
      resolution: "add_task",
      correctiveTask,
    },
    new AbortController().signal,
    undefined,
    context(),
  );

  // The resolution string is the only Lead→bridge channel: the contract
  // must travel embedded in the add_task token, byte-for-byte the JSON the
  // bridge parser strips with its `add_task:` prefix.
  expect(calls).toEqual([
    `resolve:run-x:failure-1:add_task:${JSON.stringify(correctiveTask)}`,
    "resume:run-x",
  ]);

  // The embedded payload deserializes into the bridge's structured
  // CorrectiveTaskInput: exact camelCase keys, required fields present.
  const embedded = JSON.parse(
    calls[0]?.slice("resolve:run-x:failure-1:add_task:".length),
  ) as Record<string, unknown>;
  expect(Object.keys(embedded).sort()).toEqual([
    "completionChecks",
    "id",
    "requirements",
    "title",
    "writeScope",
  ]);
  const check = must((embedded.completionChecks as Array<Record<string, unknown>>)[0]);
  expect(Object.keys(check).sort()).toEqual([
    "args",
    "command",
    "id",
    "timeoutMs",
    "workingDirectory",
  ]);
});

test("a correctiveTask outside the add_task resolution is refused before reaching the bridge", async () => {
  const host = fakePi();
  const calls: string[] = [];
  const backend = fakeBackend({
    async resolve(runId, attentionId, resolution) {
      calls.push(`resolve:${runId}:${attentionId}:${resolution}`);
      return attentionSnapshot(runId);
    },
  });
  registerLoopExtension(host.api, backend, undefined, settings);

  let message = "";
  await host.tools
    .get("loop_resolve")?.execute(
      "resolve",
      { runId: "run-x", attentionId: "failure-1", resolution: "retry", correctiveTask },
      new AbortController().signal,
      undefined,
      context(),
    )
    .catch((error: Error) => {
      message = error.message;
    });
  expect(message).toContain("correctiveTask is only valid with the add_task resolution");
  expect(calls).toEqual([]);
});

test("a batch-absence failure announces its blocked constraints and its mitigation ends in a re-dispatch", async () => {
  const host = fakePi();
  const messages: Array<{ customType: string; content: string }> = [];
  host.api.sendMessage = (message: any) => {
    messages.push(message);
  };
  const calls: string[] = [];
  const backend = fakeBackend({
    // The sole active run in this directory: restore binds to it and starts
    // observing.
    async runs() {
      return [{ runId: "run-x", state: "attention" as const }];
    },
    async snapshot(runId) {
      return attentionSnapshot(runId);
    },
    async task(_runId, taskId) {
      calls.push(`task:${taskId}`);
      return taskContext(failedTaskSpec());
    },
    async resolve(runId, attentionId, resolution) {
      calls.push(`resolve:${runId}:${attentionId}:${resolution}`);
      return {
        ...attentionSnapshot(runId),
        state: "active",
        openAttentionIds: [],
        attention: [],
        tasks: attentionSnapshot(runId).tasks,
      };
    },
    async resume(runId) {
      calls.push(`resume:${runId}`);
      return { ...attentionSnapshot(runId), state: "active", openAttentionIds: [], attention: [] };
    },
  });
  registerLoopExtension(host.api, backend, undefined, settings);
  const piContext = context();

  // The observer announces the batch-absence failure as an answerable
  // question: the decision explanation, the blocked constraints read from
  // the failed task's spec, and the options the bridge parser accepts.
  await host.events.get("session_start")?.at(-1)?.({}, piContext);
  await Bun.sleep(20);
  const announced = messages.find((message) => message.customType === "loop-attention");
  expect(announced?.content).toContain("Loop attention failure-1 (failure)");
  expect(announced?.content).toContain(
    "Decision needed: no eligible compute candidate satisfies task constraints",
  );
  expect(announced?.content).toContain(
    "Blocked constraints — requires reasoning=2 tools=1 · risk high · compute tiny..strong",
  );
  expect(announced?.content).toContain(
    "Answerable options — loop_resolve retry · defer · cancel · relax_routing",
  );
  expect(announced?.content).toContain("add_task with correctiveTask");
  expect(calls).toEqual(["task:impl"]);

  // Choosing the mitigation: the exact bridge vocabulary reaches the
  // bridge and the run is re-dispatched (owner restart).
  await host.tools.get("loop_resolve")?.execute(
    "resolve",
    {
      runId: "run-x",
      attentionId: "failure-1",
      resolution: "relax_routing",
    },
    new AbortController().signal,
    undefined,
    piContext,
  );
  expect(calls).toEqual(["task:impl", "resolve:run-x:failure-1:relax_routing", "resume:run-x"]);
});

function fakeBackend(overrides: Partial<LoopLeadBackend> = {}): LoopLeadBackend {
  const current = emptySnapshot("run-x");
  return {
    async run() {
      return {
        status: "completed",
        tasks: 0,
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
      return taskContext({
        ...failedTaskSpec(),
        id: taskId,
      });
    },
    async guidance() {
      return "No guidance recorded for this task\n";
    },
    async runs() {
      return [];
    },
    async models() {
      return ["fast · configured-model"];
    },
    async promoteSteer(_runId, _message, task, criteria) {
      return {
        accepted: true,
        runId: "run-x",
        taskId: task.id,
        criterionIds: criteria.map((criterion) => criterion.id),
        summary: `steer promoted to criteria on dependent task ${task.id}`,
        evidenceTests: [],
      };
    },
    ...overrides,
  };
}
