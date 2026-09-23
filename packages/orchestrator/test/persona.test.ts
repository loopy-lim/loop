import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "@loop/protocol";
import type { TaskContextOutput, TaskSpecInput } from "@loop/protocol";
import { FakeProvider, ProviderRegistry, type StartWorkerInput } from "@loop/providers";

import { loadPersonaRegistry } from "../src/config";
import { Orchestrator } from "../src/coordinator";
import { CompletionVerifier } from "../src/completion";
import type { OrchestrationControl } from "../src/control";
import { KIND_DEFAULT_PERSONAS, resolvePersona } from "../src/persona";
import { executeTask } from "../src/task-execution";

const registry = {
  implementer: "IMPLEMENTER TEXT",
  reviewer: "REVIEWER TEXT",
  debugger: "DEBUGGER TEXT",
  architect: "ARCHITECT TEXT",
};

test("resolvePersona injects the registry text for an explicit persona id", () => {
  const resolution = resolvePersona({ requested: "architect", kind: "implementation", registry });
  expect(resolution).toEqual({ id: "architect", instructions: "ARCHITECT TEXT" });
  expect(resolution.warning).toBeUndefined();
});

test("resolvePersona falls back to the kind default for null, absent, and blank personas", () => {
  expect(resolvePersona({ requested: null, kind: "implementation", registry })).toEqual({
    id: "implementer",
    instructions: "IMPLEMENTER TEXT",
  });
  expect(resolvePersona({ requested: null, kind: "decision", registry })).toEqual({
    id: "architect",
    instructions: "ARCHITECT TEXT",
  });
  expect(resolvePersona({ requested: null, kind: "verification", registry })).toEqual({
    id: "reviewer",
    instructions: "REVIEWER TEXT",
  });
  expect(resolvePersona({ requested: null, kind: "research", registry })).toEqual({
    id: "debugger",
    instructions: "DEBUGGER TEXT",
  });
  expect(resolvePersona({ requested: null, kind: "integration", registry })).toEqual({
    id: "architect",
    instructions: "ARCHITECT TEXT",
  });
  expect(resolvePersona({ kind: "verification", registry })).toEqual({
    id: "reviewer",
    instructions: "REVIEWER TEXT",
  });
  expect(resolvePersona({ requested: "   ", kind: "research", registry })).toEqual({
    id: "debugger",
    instructions: "DEBUGGER TEXT",
  });
});

test("resolvePersona warns and falls back to the kind default for unknown ids", () => {
  const resolution = resolvePersona({ requested: "pirate", kind: "decision", registry });
  expect(resolution.id).toBe("architect");
  expect(resolution.instructions).toBe("ARCHITECT TEXT");
  expect(resolution.warning).toBe("[persona] unknown id 'pirate' — fell back to 'architect' (kind=decision)");
});

test("resolvePersona omits the section with a warning when the kind default is missing", () => {
  const unknownWithoutDefault = resolvePersona({ requested: "pirate", kind: "research", registry: {} });
  expect(unknownWithoutDefault.instructions).toBeUndefined();
  expect(unknownWithoutDefault.warning).toBe(
    "[persona] unknown id 'pirate' — no default persona for kind=research; section omitted",
  );
  const missingDefault = resolvePersona({
    requested: null,
    kind: "implementation",
    registry: { reviewer: "REVIEWER TEXT" },
  });
  expect(missingDefault.instructions).toBeUndefined();
  expect(missingDefault.warning).toBe(
    "[persona] default persona 'implementer' missing for kind=implementation; section omitted",
  );
});

test("resolvePersona stays silent when personas are not configured at all", () => {
  expect(resolvePersona({ requested: null, kind: "research", registry: {} })).toEqual({});
  expect(resolvePersona({ requested: null, kind: "integration", registry: {} })).toEqual({});
});

test("KIND_DEFAULT_PERSONAS covers every task kind", () => {
  expect(Object.keys(KIND_DEFAULT_PERSONAS).sort()).toEqual([
    "decision",
    "implementation",
    "integration",
    "research",
    "verification",
  ]);
});

test("designer persona is explicit-only and loadable from the repository registry", () => {
  // No task kind defaults to designer: it is requested explicitly via TaskSpecInput.persona.
  expect(Object.values(KIND_DEFAULT_PERSONAS)).not.toContain("designer");
  const repository = loadPersonaRegistry(join(import.meta.dir, "..", "..", "..", "config"));
  for (const id of ["architect", "debugger", "designer", "implementer", "reviewer"]) {
    expect(repository[id]).toBeTypeOf("string");
  }
  expect(repository.designer).toContain("디자이너");
  const resolution = resolvePersona({ requested: "designer", kind: "decision", registry: repository });
  expect(resolution).toEqual({ id: "designer", instructions: repository.designer });
});

test("loadPersonaRegistry reads md bodies as trimmed text and tolerates gaps", () => {
  const configDirectory = mkdtempSync(join(tmpdir(), "loop-personas-"));
  mkdirSync(join(configDirectory, "personas"));
  writeFileSync(join(configDirectory, "personas", "implementer.md"), "  IMPL\n");
  writeFileSync(join(configDirectory, "personas", "empty.md"), "\n \n");
  writeFileSync(join(configDirectory, "personas", "notes.txt"), "not a persona");
  expect(loadPersonaRegistry(configDirectory)).toEqual({ implementer: "IMPL" });
  expect(loadPersonaRegistry(mkdtempSync(join(tmpdir(), "loop-personas-none-")))).toEqual({});
});

beforeAll(() => protocol.rustra.ready());
const verifier = new CompletionVerifier({
  run: async () => ({ exitCode: 0, stdout: "verification evidence", stderr: "", timedOut: false }),
});
function spec(id: string, kind: TaskSpecInput["kind"], persona?: string | null): TaskSpecInput {
  return {
    id,
    title: id,
    kind,
    dependencies: [],
    readScope: [],
    writeScope: kind === "decision" || kind === "implementation" || kind === "integration" ? [".loop/persona"] : [],
    requirements: [],
    persona,
    completionChecks: [{ id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 }],
    preferredCompute: "fast",
    minimumCompute: "fast",
    maximumCompute: "fast",
    maxAttempts: 2,
  };
}

function contextFor(task: TaskSpecInput): TaskContextOutput {
  return {
    intent: "Per-worker persona support",
    workingDirectory: "/project",
    task,
    attempt: 0,
    dependencyResults: [],
    previousChecks: [],
    guidance: [],
  };
}

function fakeControl(recorded: Array<{ success: boolean; summary: string }>): OrchestrationControl {
  return {
    recordWorkerResult: async (call: { success: boolean; summary: string }) => {
      recorded.push({ success: call.success, summary: call.summary });
    },
    recordCheckReceipts: async () => {},
    recordVerification: async () => {},
    recordActivity: async () => {},
    recordWorkerStopped: async () => {},
    requestAttention: async () => {},
  } as unknown as OrchestrationControl;
}

test("executeTask injects resolved persona instructions and prepends warnings to the result summary", async () => {
  const received: Array<StartWorkerInput & { personaInstructions?: string }> = [];
  class CapturingProvider extends FakeProvider {
    override async start(input: StartWorkerInput) {
      received.push(input);
      return super.start(input);
    }
  }
  const provider = new CapturingProvider("fake", ["fast"], { delayMs: 1 });
  const recorded: Array<{ success: boolean; summary: string }> = [];
  const input = { databasePath: join(mkdtempSync(join(tmpdir(), "loop-persona-exec-")), "run.db"), runId: "run", executionOwner: "test" };
  const run = (task: TaskSpecInput) =>
    executeTask({
      input,
      context: contextFor(task),
      workerId: `w-${task.id}`,
      provider,
      control: fakeControl(recorded),
      verifier,
      personas: { architect: "ARCHITECT TEXT", reviewer: "REVIEWER TEXT" },
    }).done;

  await run(spec("explicit", "research", "architect"));
  await run(spec("defaulted", "verification"));
  await run(spec("unknown", "decision", "pirate"));

  const prompts = new Map(received.map((worker) => [worker.taskId, worker]));
  expect(prompts.get("explicit")?.personaInstructions).toBe("ARCHITECT TEXT");
  expect(prompts.get("defaulted")?.personaInstructions).toBe("REVIEWER TEXT");
  expect(prompts.get("unknown")?.personaInstructions).toBe("ARCHITECT TEXT");

  const summaries = recorded.map((call) => call.summary);
  expect(summaries[0]).toBe("explicit complete");
  expect(summaries[1]).toBe("defaulted complete");
  expect(summaries[2]).toBe(
    "[persona] unknown id 'pirate' — fell back to 'architect' (kind=decision)\nunknown complete",
  );
});

beforeAll(() => protocol.rustra.ready());

// The durable path (Lead → bridge → TaskContextOutput) echoes persona only
// once loop-core persists it (D2 follow-up in crates/, outside this task's
// write scope). Until then the orchestrator sees persona-less contexts and
// this test pins the designed degradation: kind defaults still apply.
test("orchestrator resolves kind-default personas for durable persona-less contexts", async () => {
  const received: Array<StartWorkerInput & { personaInstructions?: string }> = [];
  class CapturingProvider extends FakeProvider {
    override async start(input: StartWorkerInput) {
      received.push(input);
      return super.start(input);
    }
  }
  const provider = new CapturingProvider("fake", ["fast"], { delayMs: 1 });
  const directory = mkdtempSync(join(tmpdir(), "loop-persona-run-"));
  const input = { databasePath: join(directory, "run.db"), runId: "run" };
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 2,
    completionVerifier: verifier,
    personas: { architect: "ARCHITECT TEXT", reviewer: "REVIEWER TEXT" },
  });
  const summary = await orchestrator.run({
    ...input,
    tasks: [spec("defaulted", "verification")],
    workingDirectory: directory,
  });
  expect(summary.status).toBe("completed");
  expect(received[0]?.personaInstructions).toBe("REVIEWER TEXT");
  const snapshot = await protocol.getSnapshot(input);
  expect(snapshot.tasks[0]?.resultSummary).toBe("defaulted complete");
});
