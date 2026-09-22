import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import * as protocol from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";

import { formatBenchmarkReport, runCli, type CliIo } from "../src/main";

const root = resolve(import.meta.dir, "../../..");
const exampleConfig = join(root, "config", "persona-benchmark.example.toml");

test("benchmark run executes the example config end to end on fake providers only", async () => {
  await protocol.rustra.ready();
  const databasePath = join(mkdtempSync(join(tmpdir(), "loop-cli-benchmark-")), "loop.sqlite");
  const capture = output();

  const exitCode = await runCli(
    [
      "benchmark",
      "run",
      exampleConfig,
      "--config",
      join(root, "config"),
      "--database",
      databasePath,
      "--json",
    ],
    {
      io: capture.io,
      providers: new ProviderRegistry([
        new FakeProvider("cli-bench", ["tiny", "fast", "balanced"], { delayMs: 1 }),
      ]),
    },
  );

  expect(exitCode).toBe(0);
  const report = JSON.parse(capture.stdout()) as {
    benchmark: { name: string; intent: string; profiles: string[]; iterations: number };
    runs: Array<{ runId: string; profile: string; iteration: number; status: string; summary: { tasks_created: number; tasks_completed: number } }>;
    comparison: { rankings: Array<{ label: string }> };
  };
  expect(report.benchmark).toMatchObject({
    name: "persona-benchmark-auth",
    profiles: ["plan-first", "spike-first", "tdd-first"],
    iterations: 1,
  });
  expect(report.runs).toHaveLength(3);
  for (const run of report.runs) {
    expect(run.status).toBe("completed");
    expect(run.summary.tasks_created).toBe(3);
    expect(run.summary.tasks_completed).toBe(3);
    expect(run.runId).toContain(run.profile);
  }
  expect(report.comparison.rankings).toHaveLength(3);
  expect(new Set(report.comparison.rankings.map((ranking) => ranking.label)))
    .toEqual(new Set(report.runs.map((run) => run.runId)));
});

test("benchmark usage errors are stable and never touch providers", async () => {
  const missing = output();
  expect(await runCli(["benchmark"], { io: missing.io })).toBe(2);
  expect(missing.stderr()).toContain("benchmark requires 'run <config-path>'");

  const unknown = output();
  expect(await runCli(["benchmark", "compare", exampleConfig], { io: unknown.io })).toBe(2);
  expect(unknown.stderr()).toContain("benchmark requires 'run <config-path>'");
});

test("human benchmark report is bounded, ranks first-class runs, and flags imperfect ones", () => {
  const limits = {
    statusLineLimit: 8,
    attentionLineLimit: 6,
    findingsLineLimit: 5,
    listLineLimit: 4,
    lineTextLimit: 160,
  };
  const report = {
    benchmark: {
      name: "demo",
      intent: "Implement JWT validation middleware",
      profiles: ["plan-first", "tdd-first"] as Array<"plan-first" | "tdd-first">,
      iterations: 1,
    },
    runs: [
      {
        runId: "demo-plan-first-1-aaaa",
        profile: "plan-first" as const,
        iteration: 1,
        status: "completed" as const,
        summary: { tasks_created: 3, tasks_completed: 3, verification_passes: 3, verification_failures: 0, attention_created: 0 },
        score: { reliability: 1000, autonomy: 1000, first_pass: 1000 },
      },
      {
        runId: "demo-tdd-first-1-bbbb",
        profile: "tdd-first" as const,
        iteration: 1,
        status: "attention" as const,
        summary: { tasks_created: 3, tasks_completed: 2, verification_passes: 3, verification_failures: 1, attention_created: 1 },
        score: { reliability: 667, autonomy: 0, first_pass: 750 },
      },
    ],
    comparison: {
      rankings: [
        { label: "demo-plan-first-1-aaaa", score: { reliability: 1000, autonomy: 1000, first_pass: 1000 } },
        { label: "demo-tdd-first-1-bbbb", score: { reliability: 667, autonomy: 0, first_pass: 750 } },
      ],
    },
  };

  const text = formatBenchmarkReport(report as never, limits);
  const lines = text.trim().split("\n");
  expect(lines[0]).toBe("Benchmark: demo");
  expect(lines[1]).toBe("Intent: Implement JWT validation middleware");
  expect(lines[2]).toBe("Profiles: plan-first, tdd-first · 1 iteration(s) each");
  expect(lines).toContain("✓ plan-first iter 1 · demo-plan-first-1-aaaa · completed · tasks 3/3 · attempts 3 · retries 0 · attention 0");
  expect(lines).toContain("! tdd-first iter 1 · demo-tdd-first-1-bbbb · attention · tasks 2/3 · attempts 4 · retries 1 · attention 1");
  expect(lines).toContain("Ranking (total score, highest first)");
  expect(lines).toContain("1. demo-plan-first-1-aaaa · total 3000 (reliability 1000 · autonomy 1000 · first-pass 1000)");
  expect(lines).toContain("2. demo-tdd-first-1-bbbb · total 1417 (reliability 667 · autonomy 0 · first-pass 750)");

  const bounded = formatBenchmarkReport(
    {
      ...report,
      runs: [...report.runs, ...report.runs, ...report.runs, ...report.runs],
      comparison: { rankings: [...report.comparison.rankings, ...report.comparison.rankings, ...report.comparison.rankings, ...report.comparison.rankings] },
    } as never,
    limits,
  );
  expect(bounded.trim().split("\n").at(-1)).toBe("… 13 more report lines (use --json for the full report)");
});

function output(): { io: CliIo; stdout(): string; stderr(): string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
  };
}
