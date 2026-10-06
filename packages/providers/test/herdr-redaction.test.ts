import { expect, test } from "bun:test";
import { HerdrWorkerRuntime, type HerdrRunner } from "@loop/herdr";

import { HerdrAgentProvider, type ProviderEvent, type StartWorkerInput } from "../src";

// herdr `agent read` returns the raw pane text (last ~80 lines of the worker
// CLI). When the worker echoes credentials in commands or tool output, that
// raw text would otherwise flow unredacted into WorkerResult.summary and the
// `final` ProviderEvent (see docs/research/2026-09-herdr-redaction-verify.md).

const input: StartWorkerInput = {
  runId: "run-1",
  taskId: "task-1",
  title: "task",
  kind: "implementation",
  computeClass: "strong",
  attempt: 0,
  requirements: ["edit files"],
  workingDirectory: "/project/task",
  context: {
    intent: "CONTEXT_INTENT_ONLY",
    workingDirectory: "/project/task",
    task: {
      id: "task-1",
      title: "Context task title",
      kind: "implementation",
      dependencies: [],
      readScope: ["packages/providers/**"],
      writeScope: ["packages/providers/src/**"],
      requirements: ["Use generated context"],
      completionChecks: [],
      preferredCompute: "strong",
      minimumCompute: "fast",
      maximumCompute: "frontier",
      maxAttempts: 3,
    },
    attempt: 0,
    dependencyResults: [],
    previousChecks: [],
    guidance: ["Keep the adapter thin"],
  },
};

function ok(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}

function leakyRunner(agentStatus: string, paneText: string): HerdrRunner {
  return {
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
        return ok({ result: { agent: { agent_status: agentStatus } } });
      }
      if (args[0] === "agent" && args[1] === "read") {
        // herdr read prints the raw pane text, not JSON.
        return { exitCode: 0, stdout: paneText, stderr: "" };
      }
      return ok({ result: {} });
    },
  };
}

const leakyPaneText = [
  "ran the deployment step",
  "Authorization: Bearer secret-value",
  'curl -H "authorization: Basic secret-value" https://example.invalid',
  "export api_key=secret-value",
  '"token": "secret-value"',
  "done",
].join("\n");

test("Herdr success summary and final event redact credentials from raw pane text", async () => {
  const provider = new HerdrAgentProvider({
    id: "herdr-redact-success",
    runtime: new HerdrWorkerRuntime({ runner: leakyRunner("done", leakyPaneText) }),
    kind: "codex",
    projectRoot: "/project",
    computeClasses: ["strong"],
    pollIntervalMs: 0,
  });

  const handle = await provider.start(input);
  const events: ProviderEvent[] = [];
  provider.subscribe(handle.id, (event) => events.push(event));
  const result = await provider.result(handle.id);

  expect(result.success).toBe(true);
  expect(result.summary).not.toContain("secret-value");
  expect(result.summary).toContain("ran the deployment step");

  const finalEvent = events.find((event) => event.type === "final");
  expect(finalEvent).toBeDefined();
  expect(finalEvent?.type === "final" && finalEvent.summary).not.toContain("secret-value");

  await provider.release?.(handle.id);
});

test("Herdr failure summary redacts credentials from raw pane text", async () => {
  const provider = new HerdrAgentProvider({
    id: "herdr-redact-failure",
    runtime: new HerdrWorkerRuntime({ runner: leakyRunner("failed", leakyPaneText) }),
    kind: "pi",
    projectRoot: "/project",
    computeClasses: ["fast"],
    pollIntervalMs: 0,
  });

  const handle = await provider.start(input);
  const result = await provider.result(handle.id);

  expect(result.success).toBe(false);
  expect(result.failure?.kind).toBe("process_error");
  expect(result.summary).not.toContain("secret-value");
  expect(result.summary).toContain("ran the deployment step");

  await provider.release?.(handle.id);
});

test("Herdr worker completing with only credential output still reports readable output", async () => {
  const provider = new HerdrAgentProvider({
    id: "herdr-redact-empty",
    runtime: new HerdrWorkerRuntime({ runner: leakyRunner("done", "   \n") }),
    kind: "codex",
    projectRoot: "/project",
    computeClasses: ["strong"],
    pollIntervalMs: 0,
  });

  const handle = await provider.start(input);
  const result = await provider.result(handle.id);

  expect(result.success).toBe(false);
  expect(result.failure?.kind).toBe("incomplete_output");

  await provider.release?.(handle.id);
});
