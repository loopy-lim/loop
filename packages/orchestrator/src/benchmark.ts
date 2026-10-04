import { randomUUID } from "node:crypto";

import type {
  CompareTracesOutput,
  TaskSpecInput,
  TraceComparison,
  TraceScore,
  TraceSummary,
} from "@loop/protocol";
import type { ProviderRegistry } from "@loop/providers";
import { parse as parseToml } from "smol-toml";

import { Orchestrator, type RunSummary } from "./coordinator";
import { ConfigError } from "./config";
import type { OrchestrationControl } from "./control";

/**
 * Workflow profile names, matching loop-core's `WorkflowProfile` kebab-case
 * serialization. The profile-to-DAG mapping lives here, in the orchestrator
 * fixture layer, so loop-core never sees prompt text or task shapes. Mirror-
 * pinned to the Rust enum by test/lockstep.test.ts (serde kebab-case and the
 * core `as_str` mapping must both agree with this union).
 */
export type WorkflowProfileName = "plan-first" | "spike-first" | "tdd-first";

export const WORKFLOW_PROFILE_NAMES: readonly WorkflowProfileName[] = [
  "plan-first",
  "spike-first",
  "tdd-first",
];

/**
 * Orchestration control extended with the read-only trace commands, so the
 * same protocol connection both runs workloads and reports their traces.
 */
export type BenchmarkControl = OrchestrationControl &
  Pick<typeof import("@loop/protocol"), "getTrace" | "compareTraces">;

export interface BenchmarkConfig {
  name: string;
  intent: string;
  profiles: WorkflowProfileName[];
  iterations: number;
}

export interface BenchmarkScenario {
  profile: WorkflowProfileName;
  tasks: TaskSpecInput[];
}

export interface BenchmarkRunRequest {
  control: BenchmarkControl;
  providers: ProviderRegistry;
  databasePath: string;
  benchmark: BenchmarkConfig;
  workingDirectory: string;
  maxWorkers?: number;
  maxFrontierWorkers?: number;
  signal?: AbortSignal;
}

export interface BenchmarkRunRow {
  runId: string;
  profile: WorkflowProfileName;
  iteration: number;
  status: RunSummary["status"];
  summary: TraceSummary;
  score: TraceScore;
}

export interface BenchmarkReport {
  benchmark: BenchmarkConfig;
  runs: BenchmarkRunRow[];
  comparison: TraceComparison;
}

export function parseBenchmarkConfig(text: string, source = "benchmark config"): BenchmarkConfig {
  let document: Record<string, unknown>;
  try {
    const parsed: unknown = parseToml(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("top-level value must be a table");
    }
    document = parsed as Record<string, unknown>;
  } catch (error) {
    throw new ConfigError("benchmark.parse_failed", `failed to parse ${source}: ${String(error)}`);
  }
  const name = requireText(document.name, "name", source);
  const intent = requireText(document.intent, "intent", source);
  const profiles = parseProfiles(document.profiles, source);
  const iterations =
    document.iterations === undefined
      ? 1
      : requirePositiveInteger(document.iterations, "iterations", source);
  return { name, intent, profiles, iterations };
}

/**
 * DAG fixture for one workflow profile. Every profile shares the same gate
 * shape — an investigative front stage, one implementation stage, and a final
 * verification gate — so traces differ only where the workflow differs: which
 * evidence the front stage must produce before implementation may start.
 */
export function benchmarkScenario(profile: WorkflowProfileName, intent: string): BenchmarkScenario {
  const stages: Array<{
    id: string;
    title: string;
    kind: TaskSpecInput["kind"];
    requirement: string;
    writeScope: string;
  }> = (() => {
    switch (profile) {
      case "plan-first":
        return [
          {
            id: "design",
            title: "Design decomposition",
            kind: "research" as const,
            requirement: `Write the design for: ${intent}`,
            writeScope: "docs/design/**",
          },
          {
            id: "implement",
            title: "Implement to the design",
            kind: "implementation" as const,
            requirement: "Implement exactly the designed decomposition",
            writeScope: "src/**",
          },
        ];
      case "spike-first":
        return [
          {
            id: "spike",
            title: "Exploratory spike",
            kind: "research" as const,
            requirement: `Spike the riskiest unknown of: ${intent}`,
            writeScope: "spikes/**",
          },
          {
            id: "refactor",
            title: "Refactor spike into shape",
            kind: "implementation" as const,
            requirement: "Reduce the spike to the minimal clean implementation",
            writeScope: "src/**",
          },
        ];
      case "tdd-first":
        return [
          {
            id: "write-tests",
            title: "Write failing tests first",
            kind: "research" as const,
            requirement: `Encode acceptance tests for: ${intent}`,
            writeScope: "tests/**",
          },
          {
            id: "implement",
            title: "Implement until tests pass",
            kind: "implementation" as const,
            requirement: "Implement the minimum that passes the tests",
            writeScope: "src/**",
          },
        ];
    }
  })();
  stages.push({
    id: "verify",
    title: "Verify the result",
    kind: "verification",
    requirement: "Confirm the completion contract holds for the whole result",
    writeScope: "",
  });
  const tasks: TaskSpecInput[] = [];
  let previous: string | undefined;
  for (const stage of stages) {
    tasks.push({
      id: stage.id,
      title: stage.title,
      kind: stage.kind,
      dependencies: previous ? [previous] : [],
      readScope: [],
      writeScope: stage.writeScope ? [stage.writeScope] : [],
      requirements: [stage.requirement],
      completionChecks: [
        {
          id: `${stage.id}-check`,
          command: process.execPath,
          args: ["--eval", "process.exit(0)"],
          workingDirectory: null,
          timeoutMs: 5_000,
        },
      ],
      preferredCompute: "fast",
      minimumCompute: "tiny",
      maximumCompute: "strong",
      maxAttempts: 3,
    });
    previous = stage.id;
  }
  return { profile, tasks };
}

/**
 * Run the configured benchmark: every profile × iteration executes its DAG as
 * a fresh run (unique run id, so re-runs accumulate instead of colliding),
 * then all run traces are compared through the bridge command.
 */
export async function runBenchmark(request: BenchmarkRunRequest): Promise<BenchmarkReport> {
  const orchestrator = new Orchestrator({
    control: request.control,
    providers: request.providers,
    maxWorkers: request.maxWorkers ?? 1,
    maxFrontierWorkers: request.maxFrontierWorkers,
  });
  const runs: BenchmarkRunRow[] = [];
  for (const profile of request.benchmark.profiles) {
    for (let iteration = 1; iteration <= request.benchmark.iterations; iteration += 1) {
      if (request.signal?.aborted) break;
      const { tasks } = benchmarkScenario(profile, request.benchmark.intent);
      const runId = benchmarkRunId(request.benchmark.name, profile, iteration);
      const summary = await orchestrator.run({
        databasePath: request.databasePath,
        runId,
        tasks,
        intent: request.benchmark.intent,
        workingDirectory: request.workingDirectory,
        signal: request.signal,
      });
      const trace = await request.control.getTrace({ databasePath: request.databasePath, runId });
      runs.push({
        runId,
        profile,
        iteration,
        status: summary.status,
        summary: trace.summary,
        score: trace.score,
      });
    }
  }
  const comparison: TraceComparison =
    runs.length === 0
      ? { rankings: [] }
      : (
          (await request.control.compareTraces({
            databasePath: request.databasePath,
            runIds: runs.map((run) => run.runId),
          })) as CompareTracesOutput
        ).comparison;
  return { benchmark: request.benchmark, runs, comparison };
}

function benchmarkRunId(name: string, profile: WorkflowProfileName, iteration: number): string {
  const base = `${name}-${profile}-${iteration}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function parseProfiles(value: unknown, source: string): WorkflowProfileName[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError(
      "benchmark.invalid",
      `${source}: profiles must list at least one of ${WORKFLOW_PROFILE_NAMES.join(", ")}`,
    );
  }
  const seen = new Set<string>();
  const profiles: WorkflowProfileName[] = [];
  for (const [index, entry] of value.entries()) {
    if (
      typeof entry !== "string" ||
      !WORKFLOW_PROFILE_NAMES.includes(entry as WorkflowProfileName)
    ) {
      throw new ConfigError(
        "benchmark.invalid",
        `${source}: unknown workflow profile at profiles[${index}]; expected one of ${WORKFLOW_PROFILE_NAMES.join(", ")}`,
      );
    }
    if (seen.has(entry)) {
      throw new ConfigError(
        "benchmark.invalid",
        `${source}: duplicate workflow profile ${entry}; raise iterations instead`,
      );
    }
    seen.add(entry);
    profiles.push(entry as WorkflowProfileName);
  }
  return profiles;
}

function requireText(value: unknown, field: string, source: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError("benchmark.invalid", `${source}: ${field} must be a non-empty string`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string, source: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ConfigError("benchmark.invalid", `${source}: ${field} must be a positive integer`);
  }
  return value as number;
}
