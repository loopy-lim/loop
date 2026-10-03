import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "@loop/protocol";
import type { TaskSpecInput } from "@loop/protocol";
import { FakeProvider, ProviderRegistry, type StartWorkerInput } from "@loop/providers";

import { Orchestrator } from "../src/coordinator";
import { CompletionVerifier } from "../src/completion";
import { DEFAULT_COMPUTE_SELECTION, selectionTaskFor } from "../src/compute-selection";

beforeAll(() => protocol.rustra.ready());

const verifier = new CompletionVerifier({
  run: async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false }),
});

function fixture(overrides: Partial<TaskSpecInput> = {}): TaskSpecInput {
  return {
    id: "a",
    title: "a",
    kind: "research",
    dependencies: [],
    readScope: [],
    writeScope: [],
    requirements: ["done"],
    completionChecks: [
      { id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1_000 },
    ],
    preferredCompute: "balanced",
    minimumCompute: "tiny",
    maximumCompute: "frontier",
    routing: {
      risk: "low",
      required: { coding: 0, reasoning: 0, tools: 0, vision: 0, long_context: 0 },
    },
    maxAttempts: 2,
    ...overrides,
  };
}

function implementationFixture(id: string, writeScope: string[]): TaskSpecInput {
  return fixture({
    id,
    title: id,
    kind: "implementation",
    writeScope,
    preferredCompute: "frontier",
    maximumCompute: "frontier",
  });
}

class ClassRecordingProvider extends FakeProvider {
  readonly startedClasses: StartWorkerInput["computeClass"][] = [];
  override async start(input: StartWorkerInput) {
    this.startedClasses.push(input.computeClass);
    return super.start(input);
  }
}

class UnavailableProvider extends FakeProvider {
  override async capabilities() {
    return { ...(await super.capabilities()), available: false };
  }
}

function orchestrator(
  providers: FakeProvider[],
  options: {
    maxWorkers?: number;
    maxFrontierWorkers?: number;
    computeSelection?: "cheapest" | "strongest";
  } = {},
) {
  const routing = Object.fromEntries(
    providers.map((provider, index) => [provider.id, { costWeight: 1 + index, latency: 1 }]),
  );
  return new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry(providers, routing),
    maxWorkers: options.maxWorkers ?? 2,
    maxFrontierWorkers: options.maxFrontierWorkers ?? 2,
    completionVerifier: verifier,
    ...(options.computeSelection ? { computeSelection: options.computeSelection } : {}),
  });
}

test("selectionTaskFor: cheapest keeps the task untouched; strongest routes at the declared ceiling", () => {
  const task = fixture();
  expect(DEFAULT_COMPUTE_SELECTION).toBe("cheapest");
  expect(selectionTaskFor(task, "cheapest")).toBe(task);
  const biased = selectionTaskFor(task, "strongest");
  expect(biased).not.toBe(task);
  expect(biased.preferredCompute).toBe("frontier");
  expect(biased.maximumCompute).toBe("frontier");
  expect(biased.routing).toBe(task.routing);
  // A task whose range already collapses to one class is returned unchanged.
  const collapsed = fixture({ preferredCompute: "strong", maximumCompute: "strong" });
  expect(selectionTaskFor(collapsed, "strongest")).toBe(collapsed);
});

test("cheapest selection keeps the router at the least costly sufficient class", async () => {
  const balanced = new ClassRecordingProvider("balanced-lane", ["balanced"]);
  const frontier = new ClassRecordingProvider("frontier-lane", ["frontier"]);
  const directory = mkdtempSync(join(tmpdir(), "loop-compute-cheap-"));
  const summary = await orchestrator([balanced, frontier], { computeSelection: "cheapest" }).run({
    databasePath: join(directory, "run.db"),
    runId: "cheapest",
    tasks: [fixture()],
    workingDirectory: directory,
  });
  expect(summary.status).toBe("completed");
  expect(summary.providersByTask.a).toEqual(["balanced-lane"]);
  expect(balanced.startedClasses).toEqual(["balanced"]);
  expect(frontier.startedClasses).toEqual([]);
});

test("strongest selection routes at the ceiling of the declared compute range", async () => {
  const balanced = new ClassRecordingProvider("balanced-lane", ["balanced"]);
  const frontier = new ClassRecordingProvider("frontier-lane", ["frontier"]);
  const directory = mkdtempSync(join(tmpdir(), "loop-compute-strong-"));
  const summary = await orchestrator([balanced, frontier], { computeSelection: "strongest" }).run({
    databasePath: join(directory, "run.db"),
    runId: "strongest",
    tasks: [fixture()],
    workingDirectory: directory,
  });
  expect(summary.status).toBe("completed");
  expect(summary.providersByTask.a).toEqual(["frontier-lane"]);
  expect(frontier.startedClasses).toEqual(["frontier"]);
});

test("strongest selection degrades to the declared floor when the ceiling is unavailable", async () => {
  const balanced = new ClassRecordingProvider("balanced-lane", ["balanced"]);
  const frontier = new UnavailableProvider("frontier-lane", ["frontier"]);
  const directory = mkdtempSync(join(tmpdir(), "loop-compute-degrade-"));
  const summary = await orchestrator([balanced, frontier], { computeSelection: "strongest" }).run({
    databasePath: join(directory, "run.db"),
    runId: "strongest-degrade",
    tasks: [fixture()],
    workingDirectory: directory,
  });
  expect(summary.status).toBe("completed");
  expect(summary.providersByTask.a).toEqual(["balanced-lane"]);
  const snapshot = await protocol.getSnapshot({
    databasePath: join(directory, "run.db"),
    runId: "strongest-degrade",
  });
  // The degrade is recorded as run activity, never as attention.
  const activities = snapshot.tasks.flatMap((task) => task.activities).join("\n");
  expect(activities).toContain("routed at the declared floor");
  expect(snapshot.attention).toHaveLength(0);
});

test("independent frontier tasks dispatch concurrently up to the configured worker limit", async () => {
  const frontier = new FakeProvider("frontier-lane", ["frontier"], { delayMs: 50 });
  const directory = mkdtempSync(join(tmpdir(), "loop-compute-parallel-"));
  const summary = await orchestrator([frontier], {
    maxWorkers: 3,
    maxFrontierWorkers: 3,
    computeSelection: "strongest",
  }).run({
    databasePath: join(directory, "run.db"),
    runId: "parallel-frontier",
    tasks: [
      implementationFixture("a", ["src/a/**"]),
      implementationFixture("b", ["src/b/**"]),
      implementationFixture("c", ["src/c/**"]),
    ],
    workingDirectory: directory,
  });
  expect(summary.status).toBe("completed");
  // Probe evidence (2026-xx): with the historical max_frontier_workers = 1 the
  // scheduler claimed exactly one of these tasks per round; the configured
  // limit now admits the whole ready frontier.
  expect(frontier.maxConcurrent).toBe(3);
});

test("tasks with overlapping write scopes still serialize", async () => {
  const frontier = new FakeProvider("frontier-lane", ["frontier"], { delayMs: 50 });
  const directory = mkdtempSync(join(tmpdir(), "loop-compute-serialize-"));
  const summary = await orchestrator([frontier], { maxWorkers: 3, maxFrontierWorkers: 3 }).run({
    databasePath: join(directory, "run.db"),
    runId: "serialize-overlap",
    tasks: [
      implementationFixture("a", ["src/shared/**"]),
      implementationFixture("b", ["src/shared/**"]),
    ],
    workingDirectory: directory,
  });
  expect(summary.status).toBe("completed");
  expect(frontier.maxConcurrent).toBe(1);
});
