import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TaskSpecInput } from "@loop/protocol";
import { derivePersonaVocabulary, KIND_DEFAULT_PERSONAS } from "@loop/orchestrator/persona";

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
  workerVisibility: "off" as "off",
  workerActivityLines: 5,
  workerPaneLimit: 4,
};

const VALID_IDS = "implementer, reviewer, debugger, architect, designer";

// Disk-independent default-install fixture: the compile-time persona floor
// with no registry (matches the derivation for an uninstalled personas dir).
const settings = { limits, vocabulary: derivePersonaVocabulary({}) };

test("loop_run forwards a per-task persona into the submitted plan", async () => {
  const host = fakePi();
  const submitted: TaskSpecInput[][] = [];
  const backend = fakeBackend({
    async run(input) {
      submitted.push(input.tasks);
      return completed(input.tasks.length);
    },
  });
  registerLoopExtension(host.api, backend, undefined, settings);

  await host.tools.get("loop_run")!.execute(
    "tool-persona",
    {
      intent: "Implement feature X",
      runId: "run-persona",
      tasksJson: JSON.stringify([
        task("decision", "decision", [], ["docs/adr.md"], "architect"),
        task("implementation", "implementation", ["decision"], ["src/**"]),
      ]),
    },
    new AbortController().signal,
    undefined,
    context(),
  );

  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toHaveLength(2);
  expect(submitted[0][0].persona).toBe("architect");
  expect(submitted[0][1].persona).toBeNull();
});

test("loop_run rejects unknown persona ids at submission and lists the valid ids", async () => {
  const host = fakePi();
  let dispatched = false;
  const backend = fakeBackend({
    async run() {
      dispatched = true;
      return completed(1);
    },
  });
  registerLoopExtension(host.api, backend, undefined, settings);

  const pending = host.tools.get("loop_run")!.execute(
    "tool-persona-invalid",
    {
      intent: "Implement feature X",
      runId: "run-persona-invalid",
      tasksJson: JSON.stringify([
        task("implementation", "implementation", [], ["src/**"], "wizard"),
      ]),
    },
    new AbortController().signal,
    undefined,
    context(),
  );

  expect(pending).rejects.toThrow(/unknown persona 'wizard'/);
  expect(pending).rejects.toThrow(new RegExp(`Valid persona ids: ${VALID_IDS}`));
  await pending.catch(() => {});
  expect(dispatched).toBe(false);
});

test("absent, blank, and unpadded persona values forward as null or the trimmed id", async () => {
  const host = fakePi();
  const submitted: TaskSpecInput[][] = [];
  const backend = fakeBackend({
    async run(input) {
      submitted.push(input.tasks);
      return completed(input.tasks.length);
    },
  });
  registerLoopExtension(host.api, backend, undefined, settings);

  await host.tools.get("loop_run")!.execute(
    "tool-persona-absent",
    {
      intent: "Implement feature X",
      runId: "run-persona-absent",
      tasksJson: JSON.stringify([
        task("research", "research", [], []),
        { ...task("review", "verification", ["research"], []), persona: "" },
        { ...task("impl", "implementation", ["research"], ["src/**"]), persona: "  " },
        { ...task("audit", "verification", ["impl"], ["src/**"]), persona: " reviewer " },
      ]),
    },
    new AbortController().signal,
    undefined,
    context(),
  );

  expect(submitted[0]?.map((value) => value.persona)).toEqual([
    null,
    null,
    null,
    "reviewer",
  ]);
});

test("loop_run tool description documents the optional persona field and kind defaults", () => {
  const host = fakePi();
  registerLoopExtension(host.api, fakeBackend(), undefined, settings);

  const tool = host.tools.get("loop_run")!;
  expect(tool.description).toContain("optional persona id");
  expect(tool.description).toContain("implementer | reviewer | debugger | architect");
  expect(tool.description).toContain("verification→reviewer");
  expect(tool.description).toContain("integration→architect");

  const tasksDescription = tool.parameters.properties.tasksJson.description as string;
  expect(tasksDescription).toContain('"persona"');
  expect(tasksDescription).toContain("unknown ids are rejected at submission");
  expect(tasksDescription).toContain("research→debugger");
});

test("loop_run validation and prose reflect a configured persona vocabulary", async () => {
  // A user adds config/personas/pirate.md and overrides decision→designer:
  // the registry addition joins the valid ids (registry drift fix) and the
  // kind-default override flows into both the tool description and the
  // tasksJson prompt prose — statically derived prose would not track this.
  const vocabulary = derivePersonaVocabulary(
    {
      implementer: "IMPL",
      reviewer: "REV",
      debugger: "DBG",
      architect: "ARCH",
      designer: "DES",
      pirate: "YARR",
    },
    { ...KIND_DEFAULT_PERSONAS, decision: "designer" },
  );
  const host = fakePi();
  const submitted: TaskSpecInput[][] = [];
  const backend = fakeBackend({
    async run(input) {
      submitted.push(input.tasks);
      return completed(input.tasks.length);
    },
  });
  registerLoopExtension(host.api, backend, undefined, { limits, vocabulary });

  await host.tools.get("loop_run")!.execute(
    "tool-persona-vocabulary",
    {
      intent: "Implement feature X",
      runId: "run-persona-vocabulary",
      tasksJson: JSON.stringify([
        task("decision", "decision", [], ["docs/adr.md"], "pirate"),
        task("implementation", "implementation", ["decision"], ["src/**"]),
      ]),
    },
    new AbortController().signal,
    undefined,
    context(),
  );
  expect(submitted[0]?.map((value) => value.persona)).toEqual(["pirate", null]);

  const pending = host.tools.get("loop_run")!.execute(
    "tool-persona-vocabulary-invalid",
    {
      intent: "Implement feature X",
      runId: "run-persona-vocabulary-invalid",
      tasksJson: JSON.stringify([
        task("implementation", "implementation", [], ["src/**"], "wizard"),
      ]),
    },
    new AbortController().signal,
    undefined,
    context(),
  );
  expect(pending).rejects.toThrow(
    new RegExp(`Valid persona ids: implementer, reviewer, debugger, designer, architect, pirate`),
  );
  await pending.catch(() => {});

  const tool = host.tools.get("loop_run")!;
  expect(tool.description).toContain("decision→designer");
  expect(tool.description).toContain("pirate");
  // designer is now a kind default; pirate (registry-only) is the explicit-only remainder.
  expect(tool.description).toContain("pirate is explicit-request only");
  expect(tool.description).not.toContain("designer is explicit-request only");

  const tasksDescription = tool.parameters.properties.tasksJson.description as string;
  expect(tasksDescription).toContain("implementer | reviewer | debugger | designer | architect | pirate");
  expect(tasksDescription).toContain("decision→designer");
});

test("runLoopPlan serializes persona into the SubmitPlanInput stdin payload", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-persona-stdin-"));
  const executable = join(directory, "fake-loop");
  const stdinCapture = join(directory, "stdin.json");
  writeFileSync(executable, [
    "#!/usr/bin/env bun",
    "import { writeFileSync } from 'node:fs';",
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => (input += chunk));",
    "process.stdin.on('end', () => {",
    "  writeFileSync(process.env.OUT, input);",
    "  console.log(JSON.stringify({ runId: 'run-persona-stdin', state: 'active', ownerPid: 42 }));",
    "});",
  ].join("\n"));
  chmodSync(executable, 0o755);
  const previousBin = process.env.LOOP_BIN;
  const previousOut = process.env.OUT;
  process.env.LOOP_BIN = executable;
  process.env.OUT = stdinCapture;
  try {
    await runLoopPlan({
      intent: "Implement feature X",
      // Normalized task inputs as produced by the loop_run tool path: persona is
      // an explicit id or null, never absent.
      tasks: [
        task("decision", "decision", [], ["docs/adr.md"], "architect"),
        task("implementation", "implementation", ["decision"], ["src/**"], null),
      ],
      runId: "run-persona-stdin",
      cwd: directory,
      signal: new AbortController().signal,
    });

    const payload = JSON.parse(readFileSync(stdinCapture, "utf8")) as {
      intent: string;
      runId: string;
      tasks: TaskSpecInput[];
    };
    expect(payload.intent).toBe("Implement feature X");
    expect(payload.runId).toBe("run-persona-stdin");
    expect(payload.tasks[0].persona).toBe("architect");
    expect(payload.tasks[1].persona).toBeNull();
  } finally {
    if (previousBin === undefined) delete process.env.LOOP_BIN;
    else process.env.LOOP_BIN = previousBin;
    if (previousOut === undefined) delete process.env.OUT;
    else process.env.OUT = previousOut;
    rmSync(directory, { recursive: true, force: true });
  }
});

function task(
  id: string,
  kind: TaskSpecInput["kind"],
  dependencies: string[],
  writeScope: string[],
  persona?: string | null,
): TaskSpecInput {
  return {
    id,
    title: id,
    kind,
    dependencies,
    readScope: [],
    writeScope,
    requirements: [],
    ...(persona === undefined ? {} : { persona }),
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
  return {
    async run() {
      return completed(1);
    },
    async snapshot() {
      throw new Error("not used in persona tests");
    },
    async cancel() {
      throw new Error("not used in persona tests");
    },
    async pause() {
      throw new Error("not used in persona tests");
    },
    async resume() {
      throw new Error("not used in persona tests");
    },
    async steer() {
      throw new Error("not used in persona tests");
    },
    async resolve() {
      throw new Error("not used in persona tests");
    },
    async task() {
      throw new Error("not used in persona tests");
    },
    async guidance() {
      throw new Error("not used in persona tests");
    },
    async runs() {
      return [];
    },
    async models() {
      return [];
    },
    async addTask() {
      throw new Error("not used in persona tests");
    },
    ...overrides,
  };
}

function completed(tasks: number) {
  return {
    status: "completed" as const,
    tasks,
    escalations: [],
    providersByTask: {},
    startedAt: {},
    finishedAt: {},
  };
}

function context() {
  return {
    cwd: "/project",
    ui: { notify() {} },
  };
}
