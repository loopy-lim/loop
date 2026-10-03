/**
 * Real planner lane of the gateway (decision 2026-xx-real-run-planner D1/D2).
 *
 * The seam (`PromptPlannerPort`) is unchanged: the planner owns prompt→plan
 * translation and durable plan submission. This module provides the default
 * deterministic-local planner: it decomposes the prompt into Loop's standard
 * graph template (research → decision → implementation → verification) with
 * no provider or model call, commits it through the orchestrator's own
 * prepare path (the CLI `__execute-plan` precedent), and hands execution to
 * the host-owned `LoopRuntime` fire-and-forget.
 *
 * A model-backed plan lane (Pi adapter, decision D1-a) is a follow-up
 * decision; until it lands this planner is the only lane, and cost gating
 * stays in composition: workers only ever run under the provider registry
 * the composition root assembled (deterministic-local unless the operator
 * explicitly opts into loop config).
 */

import type { TaskSpecInput } from "@loop/protocol";

import type { PromptPlannerPort } from "./service";

/** Execution hand-off seam: the narrow part of LoopRuntime a planner may touch. */
export interface RunExecutionPort {
  prepare(input: {
    runId: string;
    intent: string;
    tasks: TaskSpecInput[];
    workingDirectory: string;
  }): Promise<void>;
  execute(runId: string, signal?: AbortSignal): Promise<unknown>;
}

/** Prompt head used in task titles; bounded so titles stay scannable. */
const TITLE_PROMPT_LIMIT = 80;

function promptHead(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  return collapsed.length > TITLE_PROMPT_LIMIT
    ? `${collapsed.slice(0, TITLE_PROMPT_LIMIT - 3)}...`
    : collapsed;
}

/**
 * Deterministic prompt→graph template (decision D1-b). Four standard tasks,
 * each with a real, free, read-only completion check that asserts the
 * workspace context the task assumes — deliberately not an `echo` stub.
 */
export function templatePlan(prompt: string): TaskSpecInput[] {
  const head = promptHead(prompt);
  return [
    {
      id: "research",
      title: `Research context: ${head}`,
      kind: "research",
      dependencies: [],
      readScope: ["."],
      writeScope: ["docs/research"],
      requirements: [
        prompt,
        "Investigate the existing code and documents this task touches; record findings under docs/research before any change.",
      ],
      completionChecks: [
        {
          id: "workspace-is-git-worktree",
          command: "git",
          args: ["rev-parse", "--is-inside-work-tree"],
          timeoutMs: 10_000,
        },
      ],
      preferredCompute: "fast",
      minimumCompute: "tiny",
      maximumCompute: "balanced",
      maxAttempts: 1,
    },
    {
      id: "decision",
      title: `Decide approach: ${head}`,
      kind: "decision",
      dependencies: ["research"],
      readScope: ["."],
      writeScope: ["docs/decisions"],
      requirements: [
        prompt,
        "Pick the smallest sound approach given the research findings; record the decision, alternatives, and rationale under docs/decisions.",
      ],
      completionChecks: [
        {
          id: "history-resolvable",
          command: "git",
          args: ["rev-parse", "--verify", "HEAD"],
          timeoutMs: 10_000,
        },
      ],
      preferredCompute: "fast",
      minimumCompute: "tiny",
      maximumCompute: "balanced",
      maxAttempts: 1,
    },
    {
      id: "implementation",
      title: `Implement: ${head}`,
      kind: "implementation",
      dependencies: ["decision"],
      readScope: ["."],
      writeScope: ["."],
      requirements: [
        prompt,
        "Implement the decided approach with the smallest structural change that honors the repo boundaries.",
      ],
      completionChecks: [
        {
          id: "worktree-queryable",
          command: "git",
          args: ["status", "--porcelain"],
          timeoutMs: 10_000,
        },
      ],
      preferredCompute: "fast",
      minimumCompute: "tiny",
      maximumCompute: "balanced",
      maxAttempts: 1,
    },
    {
      id: "verification",
      title: `Verify outcome: ${head}`,
      kind: "verification",
      dependencies: ["implementation"],
      readScope: ["."],
      writeScope: ["docs/findings"],
      requirements: [
        prompt,
        "Run the repository's own verification commands for the changed surfaces and record the evidence under docs/findings.",
      ],
      completionChecks: [
        {
          id: "head-resolvable",
          command: "git",
          args: ["log", "-1", "--format=%H"],
          timeoutMs: 10_000,
        },
      ],
      preferredCompute: "fast",
      minimumCompute: "tiny",
      maximumCompute: "balanced",
      maxAttempts: 1,
    },
  ];
}

export type OrchestratorPlannerOptions = {
  /** Host-owned execution seam (composition root supplies LoopRuntime). */
  execution: RunExecutionPort;
  /** Absolute project root the run executes in; never requestable by clients. */
  workingDirectory: string;
  /** Plan template override (tests inject reduced graphs). */
  template?: (prompt: string) => TaskSpecInput[];
  /** Aborted with host shutdown so in-flight executions cancel cleanly. */
  signal?: AbortSignal;
};

/**
 * The real planner (decision D6): durable plan via the orchestrator's prepare
 * path, then a fire-and-forget `execute` hand-off. Planning failures surface
 * through the handle; execution failures surface through the run's store
 * state, which the gateway's snapshot pump projects onto the wire.
 */
export function orchestratorPlanner(options: OrchestratorPlannerOptions): PromptPlannerPort {
  const template = options.template ?? templatePlan;
  return {
    begin(input, handle) {
      handle.markPlanning(input.runId);
      void (async () => {
        try {
          await options.execution.prepare({
            runId: input.runId,
            intent: input.prompt,
            tasks: template(input.prompt),
            workingDirectory: options.workingDirectory,
          });
        } catch {
          handle.planningFailed(input.runId);
          return;
        }
        options.execution.execute(input.runId, options.signal).catch(() => {
          // Contained on purpose: the orchestrator has already recorded the
          // failure/attention in the store; the snapshot pump reports it.
        });
      })();
    },
  };
}
