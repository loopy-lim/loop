import { expect, test } from "bun:test";

import { HerdrAgentProvider } from "../src/herdr-agent";
import { HerdrWorkerRuntime, NodeHerdrRunner, type HerdrRunner } from "@loop/herdr";
import { NodeProcessRunner } from "../src/process";
import { ZaiApiProvider } from "../src/zai/api";
import type { StartWorkerInput, WorkerResult } from "../src/types";

/**
 * ts C5 timeout coverage: every provider execution lane must fail an
 * unresponsive call deterministically — a retryable `timeout` (the existing
 * stall-timeout outcome vocabulary) inside its declared bound — so the
 * orchestrator's fallback chain and retry ladder take over instead of the run
 * waiting forever. The orchestrator stall watchdog remains the umbrella for
 * `provider.result`/`repair`; these tests pin the per-lane bounds underneath
 * it (process family 30min default, herdr agent 30min + 15s control commands,
 * AGY turns 600s — already covered in antigravity-persistent.test.ts, Z.AI
 * requests 600s).
 */

function workerInput(): StartWorkerInput {
  return {
    runId: "run-timeout",
    taskId: "task-1",
    title: "Implement task 1",
    kind: "worker",
    computeClass: "fast",
    attempt: 0,
    requirements: ["must terminate"],
    context: {
      intent: "CONTEXT_INTENT_ONLY",
      workingDirectory: "/project",
      task: {
        id: "task-1",
        title: "Context task title",
        kind: "implementation",
        dependencies: [],
        readScope: ["packages/providers/**"],
        writeScope: ["packages/providers/src/**"],
        requirements: ["Use generated context"],
        completionChecks: [],
        preferredCompute: "fast",
        minimumCompute: "fast",
        maximumCompute: "fast",
        maxAttempts: 2,
      },
      attempt: 0,
      dependencyResults: [],
      previousChecks: [],
      guidance: [],
    },
  };
}

test("a silent process lane is failed as a retryable timeout within the run deadline", async () => {
  const runner = new NodeProcessRunner({
    runTimeoutMs: 150,
    cancelGraceMs: 100,
    killWaitMs: 300,
    drainTimeoutMs: 10,
  });
  const startedAt = Date.now();
  const running = runner.start(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const result = await running.result;
  const elapsedMs = Date.now() - startedAt;
  // Deterministic stall outcome inside the bound: the retry-class timeout
  // wording (mapped to failure kind `timeout` by classifyFailure) and a
  // non-zero exit from the forced stop. The exact exit code races between the
  // runTimer's 124 and the SIGTERM drain, so only the wording is pinned.
  expect(elapsedMs).toBeLessThan(5_000);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("timed out after 150ms");
});

test("a herdr agent that never leaves running hits its run deadline as a retryable timeout", async () => {
  const runner: HerdrRunner = {
    async run(_command, args) {
      if (args[0] === "workspace") {
        return ok({
          result: {
            workspace: { workspace_id: "workspace-1" },
            root_pane: { pane_id: "workspace-1:p1" },
          },
        });
      }
      if (args[0] === "tab" && args[1] === "create") {
        return ok({
          result: { tab: { tab_id: "workspace-1:t2" }, root_pane: { pane_id: "workspace-1:p2" } },
        });
      }
      if (args[0] === "agent" && args[1] === "get") {
        return ok({ result: { agent: { agent_status: "running" } } });
      }
      return ok({ result: {} });
    },
  };
  const provider = new HerdrAgentProvider({
    id: "herdr-timeout",
    runtime: new HerdrWorkerRuntime({ runner, cancelGraceMs: 100, cancelPollMs: 0 }),
    kind: "pi",
    projectRoot: "/project",
    computeClasses: ["fast"],
    pollIntervalMs: 0,
    startGraceMs: 10_000,
    runDeadlineMs: 150,
  });
  const startedAt = Date.now();
  const handle = await provider.start(workerInput());
  const result: WorkerResult = await provider.result(handle.id);
  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeLessThan(5_000);
  expect(result.success).toBe(false);
  expect(result.summary).toContain("run deadline");
  expect(result.failure).toMatchObject({ kind: "timeout", retryable: true });
});

test("a hung herdr control command is bounded by the runner deadline", async () => {
  // Every HerdrWorkerRuntime call (status/steer/read/cancel/cleanup) runs
  // through this runner, so its deadline is what keeps the agent adapter's
  // status-poll loop from hanging on an unresponsive `herdr` CLI.
  const herdr = new NodeHerdrRunner({ timeoutMs: 150, cancelGraceMs: 100 });
  const startedAt = Date.now();
  const result = await herdr.run(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeLessThan(5_000);
  expect(result.exitCode).toBe(124);
  expect(result.stderr).toContain("Herdr command timed out after 150ms");
});

test("a zai api endpoint that never responds is failed as a retryable timeout within the request deadline", async () => {
  const provider = new ZaiApiProvider({
    id: "zai-api-timeout",
    baseUrl: "https://api.example.test",
    apiKey: "key",
    model: "glm-test",
    mode: "general",
    computeClasses: ["fast"],
    requestTimeoutMs: 100,
    fetch: ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("This operation was aborted")),
        );
      })) as unknown as typeof fetch,
  });
  const startedAt = Date.now();
  const handle = await provider.start(workerInput());
  const result: WorkerResult = await provider.result(handle.id);
  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeLessThan(5_000);
  expect(result.success).toBe(false);
  expect(result.summary).toContain("timed out after 100ms");
  expect(result.failure).toMatchObject({ kind: "timeout", retryable: true });
});

test("an explicit cancel of a pending zai api request keeps the cancelled classification", async () => {
  const provider = new ZaiApiProvider({
    id: "zai-api-cancel",
    baseUrl: "https://api.example.test",
    apiKey: "key",
    model: "glm-test",
    mode: "general",
    computeClasses: ["fast"],
    fetch: ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("This operation was aborted")),
        );
      })) as unknown as typeof fetch,
  });
  const handle = await provider.start(workerInput());
  await provider.cancel(handle.id);
  const result: WorkerResult = await provider.result(handle.id);
  expect(result.success).toBe(false);
  expect(result.failure).toMatchObject({ kind: "cancelled", retryable: false });
});

function ok(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}
