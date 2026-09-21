import { expect, test } from "bun:test";

import { HerdrWorkerRuntime, type HerdrRunner } from "../src";

test("starts a recognized agent in a no-focus Herdr pane and submits its task", async () => {
  const runner = scriptedRunner();
  const runtime = new HerdrWorkerRuntime({ runner });

  const worker = await runtime.start({
    projectRoot: "/project",
    runId: "run-1",
    taskId: "task-1",
    worktree: "/project/.worktrees/task-1",
    execution: { type: "agent", kind: "codex", args: ["--sandbox", "workspace-write"] },
    prompt: "Implement task 1",
    waitForPrompt: true,
  });

  expect(worker).toEqual({
    workerId: "loop-task-1",
    workspaceId: "w1",
    paneId: "w1:p2",
    taskId: "task-1",
    agentName: "loop-task-1",
  });
  expect(runner.calls).toEqual([
    ["workspace", "create", "--cwd", "/project", "--label", "loop-run-1", "--no-focus"],
    [
      "tab",
      "create",
      "--workspace",
      "w1",
      "--cwd",
      "/project/.worktrees/task-1",
      "--label",
      "loop-task-1",
      "--no-focus",
    ],
    [
      "agent",
      "start",
      "loop-task-1",
      "--kind",
      "codex",
      "--pane",
      "w1:p2",
      "--",
      "--sandbox",
      "workspace-write",
    ],
    ["agent", "prompt", "loop-task-1", "Implement task 1", "--wait", "--timeout", "300000"],
  ]);
});

test("reattaches with opaque identifiers and maps Herdr lifecycle states", async () => {
  const runner = scriptedRunner();
  const runtime = new HerdrWorkerRuntime({ runner });
  const handle = {
    workerId: "loop-task-1",
    workspaceId: "w1",
    paneId: "w1:p2",
    taskId: "task-1",
    agentName: "loop-task-1",
  };

  expect(await runtime.status(handle)).toBe("completed");
  expect(await runtime.read(handle, 40)).toBe("worker output");
  await runtime.cancel(handle);
  await runtime.cleanup(handle);

  expect(runner.calls).toEqual([
    ["agent", "get", "loop-task-1"],
    ["agent", "read", "loop-task-1", "--source", "recent-unwrapped", "--lines", "40"],
    ["agent", "send-keys", "loop-task-1", "ctrl+c"],
    ["pane", "close", "w1:p2"],
  ]);
});

test("uses an explicit caller pane instead of creating a workspace", async () => {
  const runner = scriptedRunner();
  const runtime = new HerdrWorkerRuntime({ runner });

  await runtime.start({
    projectRoot: "/project",
    runId: "run-2",
    taskId: "tests",
    worktree: "/project",
    caller: { workspaceId: "w7", paneId: "w7:p4" },
    execution: { type: "command", command: "bun", args: ["test"] },
    prompt: "",
  });

  expect(runner.calls[0]).toContain("w7");
  expect(runner.calls.flat()).not.toContain("workspace");
  expect(runner.calls[1]).toEqual(["pane", "run", "w7:p2", "bun", "test"]);
});

test("long requested agent names stay unique within Herdr's 32-character limit", async () => {
  const runtime = new HerdrWorkerRuntime({ runner: scriptedRunner() });
  const common = "loop-12345678-1234-1234-1234-123456789012-lead";
  const first = await runtime.start({
    projectRoot: "/project",
    runId: "run-long",
    taskId: "lead-a",
    workerName: `${common}-a`,
    worktree: "/project",
    execution: { type: "agent", kind: "pi", args: [] },
    prompt: "",
  });
  const second = await runtime.start({
    projectRoot: "/project",
    runId: "run-long",
    taskId: "lead-b",
    workerName: `${common}-b`,
    worktree: "/project",
    execution: { type: "agent", kind: "pi", args: [] },
    prompt: "",
  });

  expect(first.workerId).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
  expect(second.workerId).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
  expect(first.workerId).not.toBe(second.workerId);
});

test("surfaces redacted structured Herdr errors", async () => {
  const runtime = new HerdrWorkerRuntime({
    runner: {
      run: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: JSON.stringify({ error: { code: "agent_blocked", message: "token=secret" } }),
      }),
    },
  });

  await expect(
    runtime.start({
      projectRoot: "/project",
      runId: "run",
      taskId: "task",
      worktree: "/project",
      execution: { type: "command", command: "true", args: [] },
      prompt: "",
    }),
  ).rejects.toThrow(/agent_blocked.*\[credential\]=\[redacted\]/);
});

function scriptedRunner(): HerdrRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(_command, args) {
      calls.push(args);
      if (args[0] === "workspace") {
        return result({
          result: {
            workspace: { workspace_id: "w1" },
            root_pane: { pane_id: "w1:p1" },
          },
        });
      }
      if (args[0] === "tab" && args[1] === "create") {
        return result({ result: { root_pane: { pane_id: args.includes("w7") ? "w7:p2" : "w1:p2" } } });
      }
      if (args[0] === "agent" && args[1] === "get") {
        return result({ result: { agent: { state: "done" } } });
      }
      if (args[0] === "agent" && args[1] === "read") {
        return result({ result: { output: "worker output" } });
      }
      return result({ result: {} });
    },
  };
}

function result(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}
