import { beforeAll, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";

import {
  WORKFLOW_PROFILE_NAMES,
  benchmarkScenario,
  parseBenchmarkConfig,
  runBenchmark,
  type BenchmarkConfig,
} from "../src";
import { ConfigError } from "../src/config";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

beforeAll(async () => {
  await protocol.rustra.ready();
});

function benchmark(): BenchmarkConfig {
  return {
    name: "bench",
    intent: "Implement JWT validation middleware",
    profiles: [...WORKFLOW_PROFILE_NAMES],
    iterations: 2,
  };
}

test("every profile DAG keeps the same gate shape with a workflow-specific front stage", () => {
  const plan = benchmarkScenario("plan-first", "ship auth");
  const spike = benchmarkScenario("spike-first", "ship auth");
  const tdd = benchmarkScenario("tdd-first", "ship auth");

  expect(plan.tasks.map((task) => task.id)).toEqual(["design", "implement", "verify"]);
  expect(spike.tasks.map((task) => task.id)).toEqual(["spike", "refactor", "verify"]);
  expect(tdd.tasks.map((task) => task.id)).toEqual(["write-tests", "implement", "verify"]);

  for (const scenario of [plan, spike, tdd]) {
    expect(scenario.tasks).toHaveLength(3);
    expect(scenario.tasks[0]?.kind).toBe("research");
    expect(scenario.tasks[1]?.kind).toBe("implementation");
    expect(scenario.tasks[1]?.dependencies).toEqual([must(scenario.tasks[0]).id]);
    expect(scenario.tasks[2]?.kind).toBe("verification");
    expect(scenario.tasks[2]?.dependencies).toEqual([must(scenario.tasks[1]).id]);
    expect(scenario.tasks[2]?.writeScope).toEqual([]);
    for (const task of scenario.tasks) {
      expect(task.completionChecks).toHaveLength(1);
      expect(task.maxAttempts).toBe(3);
    }
  }
});

test("benchmark runs every profile and iteration and ranks all traces deterministically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-benchmark-"));
  const report = await runBenchmark({
    control: protocol,
    providers: new ProviderRegistry([
      new FakeProvider("bench-fast", ["tiny", "fast", "balanced"], { delayMs: 2 }),
    ]),
    databasePath: join(directory, "loop.db"),
    benchmark: benchmark(),
    workingDirectory: directory,
    maxWorkers: 2,
  });

  expect(report.runs).toHaveLength(6);
  expect(new Set(report.runs.map((run) => run.runId)).size).toBe(6);
  expect(report.runs.map((run) => run.profile)).toEqual([
    "plan-first",
    "plan-first",
    "spike-first",
    "spike-first",
    "tdd-first",
    "tdd-first",
  ]);
  for (const [index, run] of report.runs.entries()) {
    expect(run.iteration).toBe((index % 2) + 1);
    expect(run.status).toBe("completed");
    expect(run.summary.tasks_created).toBe(3);
    expect(run.summary.tasks_completed).toBe(3);
    expect(run.summary.worker_starts).toBe(3);
    expect(run.summary.verification_passes).toBe(3);
    expect(run.summary.verification_failures).toBe(0);
    expect(run.summary.attention_created).toBe(0);
    expect(run.score).toEqual({ reliability: 1000, autonomy: 1000, first_pass: 1000 });
  }

  expect(report.comparison.rankings).toHaveLength(6);
  const totals = report.comparison.rankings.map(
    (ranking) => ranking.score.reliability + ranking.score.autonomy + ranking.score.first_pass,
  );
  expect(totals.toSorted((a, b) => b - a)).toEqual(totals);
  const labels = report.comparison.rankings.map((ranking) => ranking.label);
  expect(labels.toSorted()).toEqual(labels);
});

test("scripted worker failures surface in the trace and demote the ranking", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loop-benchmark-flaky-"));
  const flaky = new FakeProvider("bench-flaky", ["tiny", "fast", "balanced"], {
    delayMs: 2,
    failures: { implement: 1 },
  });
  const clean = new FakeProvider("bench-clean", ["tiny", "fast", "balanced"], { delayMs: 2 });
  const shared = join(directory, "loop.db");
  const benchmarkConfig: BenchmarkConfig = {
    name: "flaky",
    intent: "Implement JWT validation middleware",
    profiles: ["plan-first"],
    iterations: 1,
  };

  const failed = await runBenchmark({
    control: protocol,
    providers: new ProviderRegistry([flaky]),
    databasePath: shared,
    benchmark: benchmarkConfig,
    workingDirectory: directory,
    maxWorkers: 1,
  });
  const passed = await runBenchmark({
    control: protocol,
    providers: new ProviderRegistry([clean]),
    databasePath: shared,
    benchmark: benchmarkConfig,
    workingDirectory: directory,
    maxWorkers: 1,
  });

  const flakyRun = must(failed.runs[0]);
  expect(flakyRun.status).toBe("completed");
  expect(flakyRun.summary.worker_starts).toBe(4);
  expect(flakyRun.summary.verification_failures).toBe(1);
  expect(flakyRun.summary.verification_passes).toBe(3);
  expect(flakyRun.score.first_pass).toBe(750);

  const combined = await protocol.compareTraces({
    databasePath: shared,
    runIds: [must(passed.runs[0]).runId, flakyRun.runId],
  });
  expect(combined.comparison.rankings[0]?.label).toBe(passed.runs[0]?.runId);
  expect(combined.comparison.rankings[1]?.label).toBe(flakyRun.runId);
});

/** Parse helper that returns the thrown error (or undefined when valid). */
const invalid = (text: string): unknown => {
  try {
    parseBenchmarkConfig(text);
    return undefined;
  } catch (error) {
    return error;
  }
};

test("benchmark config parsing validates names, profiles, and iterations", () => {
  expect(
    parseBenchmarkConfig(`
name = "auth"
intent = "Implement JWT validation"
profiles = ["tdd-first", "plan-first"]
iterations = 2
`),
  ).toEqual({
    name: "auth",
    intent: "Implement JWT validation",
    profiles: ["tdd-first", "plan-first"],
    iterations: 2,
  });
  expect(
    parseBenchmarkConfig(`
name = "auth"
intent = "Implement JWT validation"
profiles = ["plan-first"]
`).iterations,
  ).toBe(1);

  const malformed = invalid(`profiles = ["plan-first"`) as ConfigError | undefined;
  expect(malformed).toBeInstanceOf(ConfigError);
  expect(malformed?.code).toBe("benchmark.parse_failed");

  const missingName = invalid(`intent = "y"\nprofiles = ["plan-first"]\n`) as
    | ConfigError
    | undefined;
  expect(missingName).toBeInstanceOf(ConfigError);
  expect(missingName?.code).toBe("benchmark.invalid");

  expect((invalid(`name = "x"\nintent = "y"\nprofiles = []\n`) as ConfigError).code).toBe(
    "benchmark.invalid",
  );
  expect(
    (invalid(`name = "x"\nintent = "y"\nprofiles = ["waterfall"]\n`) as ConfigError).message,
  ).toContain("unknown workflow profile");
  expect(
    (invalid(`name = "x"\nintent = "y"\nprofiles = ["plan-first", "plan-first"]\n`) as ConfigError)
      .message,
  ).toContain("duplicate");
  expect(
    (invalid(`name = "x"\nintent = ""\nprofiles = ["plan-first"]\n`) as ConfigError).message,
  ).toContain("intent");
  expect(
    (
      invalid(
        `name = "x"\nintent = "y"\nprofiles = ["plan-first"]\niterations = 0\n`,
      ) as ConfigError
    ).message,
  ).toContain("iterations");
});
