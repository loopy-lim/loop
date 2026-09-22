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
    tabId: "w1:t2",
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
    ["pane", "rename", "w1:p2", "loop-task-1"],
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
    ["agent", "prompt", "loop-task-1", "Implement task 1"],
  ]);
});

test("propagates prompt delivery failures and closes only the new worker tab", async () => {
  const calls: string[][] = [];
  const runner: HerdrRunner = {
    async run(_command, args) {
      calls.push(args);
      if (args[0] === "workspace") {
        return result({ result: { workspace: { workspace_id: "w1" }, root_pane: { pane_id: "w1:p1" } } });
      }
      if (args[0] === "tab" && args[1] === "create") {
        return result({ result: { tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p2" } } });
      }
      if (args[0] === "agent" && args[1] === "prompt") {
        return { exitCode: 1, stdout: "", stderr: JSON.stringify({ error: { code: "agent_blocked", message: "prompt rejected" } }) };
      }
      return result({ result: {} });
    },
  };
  const runtime = new HerdrWorkerRuntime({ runner });

  await expect(runtime.start({
    projectRoot: "/project",
    runId: "run-prompt-failure",
    taskId: "task",
    worktree: "/project",
    execution: { type: "agent", kind: "codex", args: [] },
    prompt: "do work",
    waitForPrompt: true,
  })).rejects.toThrow("agent_blocked");

  expect(calls).toContainEqual(["agent", "prompt", "loop-task", "do work"]);
  expect(calls).toContainEqual(["tab", "close", "w1:t2"]);
  expect(calls.some((args) => args[0] === "workspace" && args[1] === "close")).toBe(false);
});

test("reattaches with opaque identifiers and maps Herdr lifecycle states", async () => {
  const runner = scriptedRunner();
  const runtime = new HerdrWorkerRuntime({ runner });
  const handle = {
    workerId: "loop-task-1",
    workspaceId: "w1",
    tabId: "w1:t2",
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
    ["agent", "get", "loop-task-1"],
    ["tab", "close", "w1:t2"],
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
  expect(runner.calls[2]).toEqual(["pane", "run", "w7:p2", "bun", "test"]);
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
        stderr: JSON.stringify({ error: { code: "agent_blocked", message: "Authorization: Basic secret" } }),
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
  await expect(
    runtime.start({
      projectRoot: "/project",
      runId: "run-2",
      taskId: "task",
      worktree: "/project",
      execution: { type: "command", command: "true", args: [] },
      prompt: "",
    }),
  ).rejects.not.toThrow(/secret/);
});

test("cancel force-closes only a worker tab after grace and confirms it stopped", async () => {
  const calls: string[][] = [];
  let closed = false;
  const runner: HerdrRunner = {
    async run(_command, args) {
      calls.push(args);
      if (args[0] === "agent" && args[1] === "get") {
        if (closed) return { exitCode: 1, stdout: "", stderr: JSON.stringify({ error: { code: "agent_not_found", message: "gone" } }) };
        return result({ result: { agent: { agent_status: "working" } } });
      }
      if (args[0] === "tab" && args[1] === "close") {
        closed = true;
        return result({ result: {} });
      }
      return result({ result: {} });
    },
  };
  const runtime = new HerdrWorkerRuntime({ runner, cancelGraceMs: 10, cancelPollMs: 0 });
  const handle = { workerId: "worker", workspaceId: "caller-workspace", tabId: "worker-tab", paneId: "worker-pane", taskId: "task", agentName: "worker" };

  await runtime.cancel(handle);

  expect(calls).toContainEqual(["tab", "close", "worker-tab"]);
  expect(calls.some((args) => args[0] === "workspace" && args[1] === "close")).toBe(false);
});

test("cancel rejects when the worker tab cannot be force-closed", async () => {
  const calls: string[][] = [];
  const runner: HerdrRunner = {
    async run(_command, args) {
      calls.push(args);
      if (args[0] === "agent" && args[1] === "get") {
        return result({ result: { agent: { agent_status: "working" } } });
      }
      if (args[0] === "tab" && args[1] === "close") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: JSON.stringify({ error: { code: "tab_close_failed", message: "still open" } }),
        };
      }
      return result({ result: {} });
    },
  };
  const runtime = new HerdrWorkerRuntime({ runner, cancelGraceMs: 0, cancelPollMs: 0 });
  const handle = { workerId: "worker", workspaceId: "caller-workspace", tabId: "worker-tab", paneId: "worker-pane", taskId: "task", agentName: "worker" };

  await expect(runtime.cancel(handle)).rejects.toThrow("tab_close_failed");

  expect(calls).toContainEqual(["tab", "close", "worker-tab"]);
  expect(calls.some((args) => args[0] === "workspace" && args[1] === "close")).toBe(false);
});

test("closes workspace using herdr workspace close driven through injected runner", async () => {
  const runner = scriptedRunner();
  const runtime = new HerdrWorkerRuntime({ runner });

  await runtime.start({
    projectRoot: "/project",
    runId: "run-close",
    taskId: "task-1",
    worktree: "/project",
    execution: { type: "command", command: "true", args: [] },
    prompt: "",
  });

  const res = await runtime.closeWorkspace("run-close");
  expect(res).toEqual({ closed: true, reason: "workspace_closed" });
  expect(runner.calls).toContainEqual(["workspace", "close", "w1"]);
});

test("falls back to tab-close when workspace close fails", async () => {
  const calls: string[][] = [];
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "create") {
        return result({
          result: {
            workspace: { workspace_id: "w21" },
            root_pane: { pane_id: "w21:p1" },
          },
        });
      }
      if (args[0] === "tab" && args[1] === "create") {
        return result({
          result: {
            tab: { tab_id: "w21:t2" },
            root_pane: { pane_id: "w21:p2" },
          },
        });
      }
      if (args[0] === "workspace" && args[1] === "close") {
        return {
          exitCode: 2,
          stdout: "",
          stderr: JSON.stringify({ error: { code: "unknown_command", message: "unknown command: workspace close" } }),
        };
      }
      if (args[0] === "tab" && args[1] === "list") {
        return result({
          result: {
            tabs: [
              { tab_id: "w21:t1", number: 1 },
              { tab_id: "w21:t2", number: 2 },
            ],
          },
        });
      }
      if (args[0] === "tab" && args[1] === "close") {
        return result({ result: { type: "ok" } });
      }
      return result({ result: {} });
    },
  };

  const runtime = new HerdrWorkerRuntime({ runner });
  await runtime.start({
    projectRoot: "/project",
    runId: "run-fallback",
    taskId: "task-1",
    worktree: "/project",
    execution: { type: "command", command: "true", args: [] },
    prompt: "",
  });

  const res = await runtime.closeWorkspace("run-fallback");
  expect(res).toEqual({ closed: true, reason: "tabs_closed" });
  expect(calls).toContainEqual(["workspace", "close", "w21"]);
  expect(calls).toContainEqual(["tab", "list", "--workspace", "w21"]);
  expect(calls).toContainEqual(["tab", "close", "w21:t1"]);
  expect(calls).toContainEqual(["tab", "close", "w21:t2"]);
});

test("treats already-gone workspace as success-with-reason", async () => {
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      if (args[0] === "workspace" && args[1] === "create") {
        return result({
          result: {
            workspace: { workspace_id: "w30" },
            root_pane: { pane_id: "w30:p1" },
          },
        });
      }
      if (args[0] === "tab" && args[1] === "create") {
        return result({ result: { tab: { tab_id: "w30:t2" }, root_pane: { pane_id: "w30:p2" } } });
      }
      if (args[0] === "workspace" && args[1] === "close") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: JSON.stringify({ error: { code: "workspace_not_found", message: "workspace w30 not found" } }),
        };
      }
      return result({ result: {} });
    },
  };

  const runtime = new HerdrWorkerRuntime({ runner });
  await runtime.start({
    projectRoot: "/project",
    runId: "run-gone",
    taskId: "task-1",
    worktree: "/project",
    execution: { type: "command", command: "true", args: [] },
    prompt: "",
  });

  const res = await runtime.closeWorkspace("run-gone");
  expect(res).toEqual({ closed: true, reason: "already_gone" });
});

test("returns already_gone when closing an untracked runId", async () => {
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      if (args[0] === "workspace" && args[1] === "list") {
        return result({ result: { workspaces: [] } });
      }
      return result({ result: {} });
    },
  };

  const runtime = new HerdrWorkerRuntime({ runner });
  const res = await runtime.closeWorkspace("run-never-started");
  expect(res).toEqual({ closed: true, reason: "already_gone" });
});

test("propagates an untracked workspace lookup failure instead of claiming absence", async () => {
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      expect(args).toEqual(["workspace", "list"]);
      return {
        exitCode: 1,
        stdout: "",
        stderr: JSON.stringify({
          error: { code: "permission_denied", message: "workspace listing denied" },
        }),
      };
    },
  };

  const runtime = new HerdrWorkerRuntime({ runner });
  await expect(runtime.closeWorkspace("run-unobservable")).rejects.toThrow(
    /permission_denied.*workspace listing denied/,
  );
});

test("rejects a malformed workspace list instead of claiming absence", async () => {
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      expect(args).toEqual(["workspace", "list"]);
      return result({ result: {} });
    },
  };

  const runtime = new HerdrWorkerRuntime({ runner });
  await expect(runtime.closeWorkspace("run-unobservable")).rejects.toThrow(
    /workspace list response is missing workspaces/,
  );
});

test("rejects a matching discovered workspace without a usable workspace id", async () => {
  for (const workspace of [
    { label: "loop-run-malformed-match" },
    { label: "loop-run-malformed-match", workspace_id: "" },
  ]) {
    const runner: HerdrRunner = {
      async run(_cmd, args) {
        expect(args).toEqual(["workspace", "list"]);
        return result({ result: { workspaces: [workspace] } });
      },
    };

    const runtime = new HerdrWorkerRuntime({ runner });
    await expect(runtime.closeWorkspace("run-malformed-match")).rejects.toThrow(
      /matching Herdr workspace is missing workspace_id/,
    );
  }
});

test("rejects a malformed fallback tab list for a rediscovered workspace", async () => {
  const calls: string[][] = [];
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") {
        return result({
          result: {
            workspaces: [
              { label: "loop-run-malformed-tabs", workspace_id: "w-malformed-tabs" },
            ],
          },
        });
      }
      if (args[0] === "workspace" && args[1] === "close") {
        return {
          exitCode: 2,
          stdout: "",
          stderr: JSON.stringify({
            error: { code: "unknown_command", message: "workspace close unsupported" },
          }),
        };
      }
      if (args[0] === "tab" && args[1] === "list") {
        return result({ result: {} });
      }
      return result({ result: {} });
    },
  };

  const runtime = new HerdrWorkerRuntime({ runner });
  await expect(runtime.closeWorkspace("run-malformed-tabs")).rejects.toThrow(
    /tab list response is missing tabs/,
  );
  expect(calls).not.toContainEqual(["tab", "close", expect.any(String)]);
});

test("rejects fallback tab listings without a usable tab id for a rediscovered workspace", async () => {
  for (const tabs of [[], [{ number: 1 }], [{ tab_id: "" }]]) {
    const runner: HerdrRunner = {
      async run(_cmd, args) {
        if (args[0] === "workspace" && args[1] === "list") {
          return result({
            result: {
              workspaces: [
                { label: "loop-run-tabs-without-id", workspace_id: "w-tabs-without-id" },
              ],
            },
          });
        }
        if (args[0] === "workspace" && args[1] === "close") {
          return {
            exitCode: 2,
            stdout: "",
            stderr: JSON.stringify({
              error: { code: "unknown_command", message: "workspace close unsupported" },
            }),
          };
        }
        if (args[0] === "tab" && args[1] === "list") {
          return result({ result: { tabs } });
        }
        return result({ result: {} });
      },
    };

    const runtime = new HerdrWorkerRuntime({ runner });
    await expect(runtime.closeWorkspace("run-tabs-without-id")).rejects.toThrow(
      /tab list did not identify any tabs/,
    );
  }
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
        return result({ result: { tab: { tab_id: args.includes("w7") ? "w7:t2" : "w1:t2" }, root_pane: { pane_id: args.includes("w7") ? "w7:p2" : "w1:p2" } } });
      }
      if (args[0] === "agent" && args[1] === "get") {
        // Real herdr payload field is agent_status, not state.
        return result({ result: { agent: { agent_status: "done" } } });
      }
      if (args[0] === "agent" && args[1] === "read") {
        // Real herdr `read` prints raw pane text, not the JSON envelope.
        return { exitCode: 0, stdout: "worker output", stderr: "" };
      }
      if (args[0] === "pane" && args[1] === "rename") {
        return result({ result: {} });
      }
      return result({ result: {} });
    },
  };
}

function result(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}

test("purgeLeakedWorkspaces lists workspaces and closes ones prefixed with loop-loop-", async () => {
  const calls: string[][] = [];
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") {
        return result({
          result: {
            workspaces: [
              { label: "loop-run-123", workspace_id: "w1" },
              { label: "loop-loop-leak1", workspace_id: "w2" },
              { label: "loop-loop-leak2", workspace_id: "w3" },
              { label: "my-workspace", workspace_id: "w4" },
            ]
          }
        });
      }
      return result({ result: {} });
    }
  };
  
  const runtime = new HerdrWorkerRuntime({ runner });
  const removed = await runtime.purgeLeakedWorkspaces(false);
  expect(removed).toEqual(["w2", "w3"]);
  expect(calls).toContainEqual(["workspace", "close", "w2"]);
  expect(calls).toContainEqual(["workspace", "close", "w3"]);
  expect(calls.some(c => c[0] === "workspace" && c[1] === "close" && (c[2] === "w1" || c[2] === "w4"))).toBe(false);
});

test("purgeLeakedWorkspaces skips deletion on dry run", async () => {
  const calls: string[][] = [];
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") {
        return result({
          result: {
            workspaces: [
              { label: "loop-loop-leak1", workspace_id: "w2" },
            ]
          }
        });
      }
      return result({ result: {} });
    }
  };
  
  const runtime = new HerdrWorkerRuntime({ runner });
  const removed = await runtime.purgeLeakedWorkspaces(true);
  expect(removed).toEqual(["w2"]);
  expect(calls.some(c => c[0] === "workspace" && c[1] === "close")).toBe(false);
});
