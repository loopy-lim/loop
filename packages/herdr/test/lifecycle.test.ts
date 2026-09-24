import { expect, test } from "bun:test";

import { HerdrWorkerRuntime, type HerdrRunner, type HerdrWorkerInput } from "../src";

test("starts a recognized agent in its own tab and submits its task", async () => {
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
    // One no-focus tab per worker — the live-tabs placement rule.
    ["tab", "create", "--workspace", "w1", "--cwd", "/project/.worktrees/task-1", "--label", "loop-task-1", "--no-focus"],
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

test("labels the worker tab with taskId·kind·attempt while the identifier keeps the worker name", async () => {
  const runner = scriptedRunner();
  const runtime = new HerdrWorkerRuntime({ runner });

  const worker = await runtime.start({
    projectRoot: "/project",
    runId: "run-1",
    taskId: "impl-protocol-unify",
    workerName: "run-1-impl-protocol-unify",
    label: { kind: "implementation", attempt: 0 },
    worktree: "/project",
    execution: { type: "agent", kind: "pi", args: [] },
    prompt: "",
  });

  // Identity (workerId/agentName, the session resume handle) is unchanged.
  expect(worker.workerId).toBe("loop-run-1-impl-protocol-unify");
  expect(worker.agentName).toBe("loop-run-1-impl-protocol-unify");
  // Display surfaces carry the taskId vocabulary instead.
  expect(runner.calls).toContainEqual([
    "tab", "create", "--workspace", "w1", "--cwd", "/project", "--label", "impl-protocol-unify·impl·a0", "--no-focus",
  ]);
  expect(runner.calls).toContainEqual(["pane", "rename", "w1:p2", "impl-protocol-unify·impl·a0"]);
  expect(runner.calls).toContainEqual(["agent", "start", "loop-run-1-impl-protocol-unify", "--kind", "pi", "--pane", "w1:p2"]);
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
  expect(calls.some((args) => args[0] === "pane" && args[1] === "close")).toBe(false);
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

  // Caller-anchored: the worker gets a sibling tab of the caller's workspace.
  expect(runner.calls[0]).toEqual([
    "tab",
    "create",
    "--workspace",
    "w7",
    "--cwd",
    "/project",
    "--label",
    "loop-tests",
    "--no-focus",
  ]);
  expect(runner.calls[1]).toEqual(["pane", "rename", "w7:p2", "loop-tests"]);
  expect(runner.calls.flat()).not.toContain("workspace");
  expect(runner.calls[2]).toEqual(["pane", "run", "w7:p2", "bun", "test"]);
});

test("anchors mirror tabs to the caller workspace without creating a Loop workspace", async () => {
  const runner = scriptedRunner();
  const runtime = new HerdrWorkerRuntime({ runner });

  const pane = await runtime.createPane(
    "run-3",
    "task-3",
    "/project",
    "/project",
    "task-3",
    { workspaceId: "w7", paneId: "w7:p4" },
  );

  expect(pane).toEqual({
    workerId: "mirror·task-3",
    workspaceId: "w7",
    tabId: "w7:t2",
    paneId: "w7:p2",
    taskId: "task-3",
  });
  expect(runner.calls[0]).toEqual([
    "tab",
    "create",
    "--workspace",
    "w7",
    "--cwd",
    "/project",
    "--label",
    "mirror·task-3",
    "--no-focus",
  ]);
  expect(runner.calls[1]).toEqual(["pane", "rename", "w7:p2", "mirror·task-3"]);
  expect(runner.calls.flat()).not.toContain("workspace");
});

test("falls back to a dedicated loop-<runId> workspace when no caller is given", async () => {
  const runner = scriptedRunner();
  const runtime = new HerdrWorkerRuntime({ runner });

  const pane = await runtime.createPane("run-fallback", "task-4", "/project", "/project", "task-4");

  expect(pane.workspaceId).toBe("w1");
  expect(runner.calls[0]).toEqual([
    "workspace",
    "create",
    "--cwd",
    "/project",
    "--label",
    "loop-run-fallback",
    "--no-focus",
  ]);
  // Without a caller the mirror opens as a tab of the loop-<runId> workspace.
  expect(runner.calls[1]).toEqual([
    "tab", "create", "--workspace", "w1", "--cwd", "/project", "--label", "mirror·task-4", "--no-focus",
  ]);
  expect(runner.calls[2]).toEqual(["pane", "rename", "w1:p2", "mirror·task-4"]);
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
      if (args[0] === "pane" && args[1] === "get") {
        // Status fallback (live-tabs ADR §5): with the agent record gone the
        // pane is observed instead — and after the tab close it is gone too.
        if (closed) return { exitCode: 1, stdout: "", stderr: JSON.stringify({ error: { code: "pane_not_found", message: "pane gone" } }) };
        return result({ result: { pane: { agent_status: "working" } } });
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
        return result({ result: { tab: { tab_id: "w21:t2" }, root_pane: { pane_id: "w21:p2" } } });
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
            tab: { tab_id: "w1:t1" },
          },
        });
      }
      if (args[0] === "tab" && args[1] === "create") {
        const caller = args.includes("w7");
        return result({
          result: caller
            ? { tab: { tab_id: "w7:t2" }, root_pane: { pane_id: "w7:p2" } }
            : { tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p2" } },
        });
      }
      if (args[0] === "agent" && args[1] === "get") {
        // Real herdr payload field is agent_status, not state.
        return result({ result: { agent: { agent_status: "done" } } });
      }
      if (args[0] === "agent" && args[1] === "read") {
        // Real herdr `read` prints raw pane text, not the JSON envelope.
        return { exitCode: 0, stdout: "worker output", stderr: "" };
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

test("purgeLeakedWorkspaces scans workspace labels only and never inspects caller-anchored tabs", async () => {
  const calls: string[][] = [];
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "list") {
        return result({
          result: {
            workspaces: [
              // Caller-anchored mirror panes are tabs inside a user workspace:
              // the label never matches, and no tab-level scan may discover them.
              { label: "user-workspace", workspace_id: "u1" },
            ],
          },
        });
      }
      return result({ result: {} });
    },
  };

  const runtime = new HerdrWorkerRuntime({ runner });
  const removed = await runtime.purgeLeakedWorkspaces(false);
  expect(removed).toEqual([]);
  expect(calls.some((args) => args[0] === "tab")).toBe(false);
  expect(calls.some((args) => args[0] === "workspace" && args[1] === "close")).toBe(false);
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

test("runInPane hosts the steer relay process via pane run", async () => {
  const calls: string[][] = [];
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      calls.push(args);
      return result({ result: {} });
    },
  };
  const runtime = new HerdrWorkerRuntime({ runner });

  await runtime.runInPane("w1:p9", "bun", ["/repo/packages/cli/src/main.ts", "__steer-relay", "run-9", "t-1", "--database", "/tmp/loop.sqlite"]);

  expect(calls).toEqual([
    ["pane", "run", "w1:p9", "bun", "/repo/packages/cli/src/main.ts", "__steer-relay", "run-9", "t-1", "--database", "/tmp/loop.sqlite"],
  ]);
});

// ---------------------------------------------------------------------------
// Live conversation tabs (docs/decisions/2026-09-24-herdr-live-conversation-tabs.md)

const liveTabHandle = {
  workerId: "loop-task-1",
  workspaceId: "w1",
  tabId: "w1:t2",
  paneId: "w1:p2",
  taskId: "task-1",
  agentName: "loop-task-1",
};

function errorResult(code: string, message: string) {
  return {
    exitCode: 1,
    stdout: "",
    stderr: JSON.stringify({ error: { code, message } }),
  };
}

test("retries agent_pane_busy rejections during pane initialization before prompting", async () => {
  let startAttempts = 0;
  const calls: string[][] = [];
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      calls.push(args);
      if (args[0] === "workspace") {
        return result({ result: { workspace: { workspace_id: "w1" }, root_pane: { pane_id: "w1:p1" } } });
      }
      if (args[0] === "tab" && args[1] === "create") {
        return result({ result: { tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p2" } } });
      }
      if (args[0] === "agent" && args[1] === "start") {
        startAttempts += 1;
        if (startAttempts < 3) {
          return errorResult(
            "agent_pane_busy",
            "agent target pane w1:p2 is not an available shell",
          );
        }
        return result({ result: { agent: { name: "loop-task-1", interactive_ready: true } } });
      }
      return result({ result: {} });
    },
  };
  const runtime = new HerdrWorkerRuntime({ runner });

  const worker = await runtime.start({
    projectRoot: "/project",
    runId: "run-busy",
    taskId: "task-1",
    worktree: "/project",
    execution: { type: "agent", kind: "pi", args: ["--model", "m1"] },
    prompt: "do work",
    waitForPrompt: true,
  });

  expect(worker.agentName).toBe("loop-task-1");
  expect(startAttempts).toBe(3);
  expect(calls).toContainEqual(["agent", "prompt", "loop-task-1", "do work"]);
});

test("an agent start that acknowledges interactive_ready: false fails the launch", async () => {
  const calls: string[][] = [];
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      calls.push(args);
      if (args[0] === "workspace") {
        return result({ result: { workspace: { workspace_id: "w1" }, root_pane: { pane_id: "w1:p1" } } });
      }
      if (args[0] === "tab" && args[1] === "create") {
        return result({ result: { tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p2" } } });
      }
      if (args[0] === "agent" && args[1] === "start") {
        // pi's silent non-TTY fallback would look exactly like this: started,
        // exit 0, but no live conversation TUI (live-tabs ADR §6).
        return result({ result: { agent: { name: "loop-task-1", interactive_ready: false } } });
      }
      return result({ result: {} });
    },
  };
  const runtime = new HerdrWorkerRuntime({ runner });

  await expect(runtime.start({
    projectRoot: "/project",
    runId: "run-unready",
    taskId: "task-1",
    worktree: "/project",
    execution: { type: "agent", kind: "pi", args: [] },
    prompt: "do work",
    waitForPrompt: true,
  })).rejects.toThrow(/agent_not_interactive/);

  expect(calls).toContainEqual(["tab", "close", "w1:t2"]);
  expect(calls.some((args) => args[0] === "agent" && args[1] === "prompt")).toBe(false);
  expect(calls.some((args) => args[0] === "workspace" && args[1] === "close")).toBe(false);
});

test("status falls back to pane observation when the agent record is already gone", async () => {
  const runner = paneFallbackRunner({
    agentGone: errorResult("agent_not_found", "agent record pruned"),
    panePayload: { result: { pane: { state: "exited" } } },
  });
  const runtime = new HerdrWorkerRuntime({ runner });

  await expect(runtime.status(liveTabHandle)).resolves.toBe("completed");
  expect(runner.calls).toEqual([
    ["agent", "get", "loop-task-1"],
    ["pane", "get", "w1:p2"],
  ]);
});

test("status maps a surviving pane's live agent state through the fallback", async () => {
  const runner = paneFallbackRunner({
    agentGone: errorResult("agent_not_running", "agent record gone"),
    panePayload: { result: { pane: { agent_status: "working" } } },
  });
  const runtime = new HerdrWorkerRuntime({ runner });

  await expect(runtime.status(liveTabHandle)).resolves.toBe("running");
});

test("status confirms termination when both the agent record and the pane are gone", async () => {
  const runner = paneFallbackRunner({
    agentGone: errorResult("agent_not_found", "agent record pruned"),
    paneGone: errorResult("pane_not_found", "pane gone"),
  });
  const runtime = new HerdrWorkerRuntime({ runner });

  await expect(runtime.status(liveTabHandle)).resolves.toBe("completed");
});

test("status propagates hard pane errors from the fallback instead of guessing", async () => {
  const runner = paneFallbackRunner({
    agentGone: errorResult("agent_not_found", "agent record pruned"),
    paneGone: errorResult("herdr_error", "server unavailable"),
  });
  const runtime = new HerdrWorkerRuntime({ runner });

  await expect(runtime.status(liveTabHandle)).rejects.toThrow(/herdr_error/);
});

test("status propagates non-gone agent errors without touching the pane fallback", async () => {
  const runner = paneFallbackRunner({
    agentGone: errorResult("permission_denied", "agent listing denied"),
  });
  const runtime = new HerdrWorkerRuntime({ runner });

  await expect(runtime.status(liveTabHandle)).rejects.toThrow(/permission_denied/);
  expect(runner.calls).toEqual([["agent", "get", "loop-task-1"]]);
});

test("status treats a live agent that lost interactive readiness as failed", async () => {
  const runner: HerdrRunner = {
    async run() {
      return result({ result: { agent: { agent_status: "working", interactive_ready: false } } });
    },
  };
  const runtime = new HerdrWorkerRuntime({ runner });

  await expect(runtime.status(liveTabHandle)).resolves.toBe("failed");
});

test("status keeps a live interactive_ready agent running and tolerates an absent field", async () => {
  const runtime = new HerdrWorkerRuntime({
    runner: {
      async run() {
        return result({ result: { agent: { agent_status: "working", interactive_ready: true } } });
      },
    },
  });
  await expect(runtime.status(liveTabHandle)).resolves.toBe("running");

  const legacy = new HerdrWorkerRuntime({
    runner: {
      async run() {
        return result({ result: { agent: { agent_status: "working" } } });
      },
    },
  });
  await expect(legacy.status(liveTabHandle)).resolves.toBe("running");
});

test("read falls back to the pane snapshot when the agent record is gone", async () => {
  const runner = paneFallbackRunner({
    agentGone: errorResult("agent_not_found", "agent record pruned"),
  });
  const runtime = new HerdrWorkerRuntime({ runner });

  await expect(runtime.read(liveTabHandle, 40)).resolves.toBe("pane tail");
  expect(runner.calls).toEqual([
    ["agent", "read", "loop-task-1", "--source", "recent-unwrapped", "--lines", "40"],
    ["pane", "read", "w1:p2", "--lines", "40"],
  ]);
});

test("read returns an empty snapshot when the agent record and pane are both gone", async () => {
  const runner = paneFallbackRunner({
    agentGone: errorResult("agent_not_running", "agent record gone"),
    paneGone: errorResult("tab_not_found", "tab gone"),
  });
  const runtime = new HerdrWorkerRuntime({ runner });

  await expect(runtime.read(liveTabHandle)).resolves.toBe("");
});

test("read propagates hard pane errors from the fallback", async () => {
  const runner = paneFallbackRunner({
    agentGone: errorResult("agent_not_found", "agent record pruned"),
    paneGone: errorResult("herdr_error", "server unavailable"),
  });
  const runtime = new HerdrWorkerRuntime({ runner });

  await expect(runtime.read(liveTabHandle)).rejects.toThrow(/herdr_error/);
});

test("steer delivers one agent prompt call and skips empty messages", async () => {
  const calls: string[][] = [];
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      calls.push(args);
      return result({ result: {} });
    },
  };
  const runtime = new HerdrWorkerRuntime({ runner });

  await runtime.steer(liveTabHandle, "pivot: use the fallback plan");
  await runtime.steer(liveTabHandle, "");

  expect(calls).toEqual([["agent", "prompt", "loop-task-1", "pivot: use the fallback plan"]]);
});

test("steer keeps messages with whitespace, quotes, and newlines as one argv element", async () => {
  const seen: string[][] = [];
  const runner: HerdrRunner = {
    async run(_cmd, args) {
      seen.push(args);
      return result({ result: {} });
    },
  };
  const runtime = new HerdrWorkerRuntime({ runner });
  const message = "line one\nline \"two\" with 'quotes' & $shell \u{1F9E0}";

  await runtime.steer(liveTabHandle, message);

  expect(seen).toEqual([["agent", "prompt", "loop-task-1", message]]);
});

test("steer rejects command workers without an interactive conversation", async () => {
  const runtime = new HerdrWorkerRuntime({ runner: scriptedRunner() });
  const { agentName: _commandWorkersHaveNoAgent, ...commandHandle } = liveTabHandle;

  await expect(runtime.steer(commandHandle, "hello")).rejects.toThrow(/no interactive agent conversation/);
});

test("steer propagates agent_blocked rejections for the recorded-steer fallback", async () => {
  const runtime = new HerdrWorkerRuntime({
    runner: {
      async run() {
        return errorResult("agent_blocked", "prompt rejected while blocked");
      },
    },
  });

  await expect(runtime.steer(liveTabHandle, "hello")).rejects.toThrow(/agent_blocked/);
});

function paneFallbackRunner(script: {
  agentGone: { exitCode: number; stdout: string; stderr: string };
  panePayload?: unknown;
  paneGone?: { exitCode: number; stdout: string; stderr: string };
}): HerdrRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(_cmd, args) {
      calls.push(args);
      if (args[0] === "agent") {
        return script.agentGone;
      }
      if (args[0] === "pane" && args[1] === "get") {
        if (script.paneGone) return script.paneGone;
        return result(script.panePayload ?? { result: {} });
      }
      if (args[0] === "pane" && args[1] === "read") {
        if (script.paneGone) return script.paneGone;
        return { exitCode: 0, stdout: "pane tail", stderr: "" };
      }
      return result({ result: {} });
    },
  };
}

// ---------------------------------------------------------------------------
// Worker placement: one tab per worker (live-tabs ADR placement rule,
// reinstated 2026-09-25 — docs/decisions/2026-09-24-herdr-live-conversation-tabs.md)

/**
 * Stateful fake mirroring the herdr 0.8.2 tab verb shapes the ADR surveyed:
 * tab creates open worker tabs in the anchor workspace, tab closes remove
 * them — so placement, cleanup, and sweep behavior are exercised against a
 * moving world. No split verbs exist here: the placement never uses them.
 */
function tabWorldRunner(options: { workspaceId?: string; rootPaneId?: string } = {}): HerdrRunner & { calls: string[][] } {
  const workspaceId = options.workspaceId ?? "w1";
  const rootPaneId = options.rootPaneId ?? `${workspaceId}:p1`;
  const rootTabId = `${workspaceId}:t1`;
  const openTabs = new Set<string>();
  const calls: string[][] = [];
  const rootIndex = Number(rootPaneId.split(":p")[1] ?? "1");
  let nextPane = Number.isFinite(rootIndex) && rootIndex > 0 ? rootIndex + 1 : 2;
  let nextTab = 2;
  return {
    calls,
    async run(_command, args) {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "create") {
        return result({
          result: {
            workspace: { workspace_id: workspaceId },
            root_pane: { pane_id: rootPaneId },
            tab: { tab_id: rootTabId },
          },
        });
      }
      if (args[0] === "tab" && args[1] === "create") {
        const tabId = `${workspaceId}:t${nextTab++}`;
        const paneId = `${workspaceId}:p${nextPane++}`;
        openTabs.add(tabId);
        return result({ result: { tab: { tab_id: tabId }, root_pane: { pane_id: paneId } } });
      }
      if (args[0] === "tab" && args[1] === "close") {
        if (!openTabs.delete(args[2]!)) {
          return errorResult("tab_not_found", `tab ${args[2]} not found`);
        }
        return result({ result: { type: "ok" } });
      }
      return result({ result: {} });
    },
  };
}

test("opens one no-focus tab per worker and never splits the anchor pane", async () => {
  const runner = tabWorldRunner();
  const runtime = new HerdrWorkerRuntime({ runner });
  const input = (taskId: string): HerdrWorkerInput => ({
    projectRoot: "/project",
    runId: "run-tabs",
    taskId,
    worktree: "/project",
    execution: { type: "command", command: "true", args: [] },
    prompt: "",
  });

  const first = await runtime.start(input("task-1"));
  const second = await runtime.start(input("task-2"));
  const third = await runtime.start(input("task-3"));

  // Every worker gets its own no-focus tab of the same workspace — no
  // capacity limit, no demotion, no split-screen placement.
  expect(runner.calls).toContainEqual([
    "tab", "create", "--workspace", "w1", "--cwd", "/project", "--label", "loop-task-1", "--no-focus",
  ]);
  expect(runner.calls).toContainEqual([
    "tab", "create", "--workspace", "w1", "--cwd", "/project", "--label", "loop-task-2", "--no-focus",
  ]);
  expect(runner.calls).toContainEqual([
    "tab", "create", "--workspace", "w1", "--cwd", "/project", "--label", "loop-task-3", "--no-focus",
  ]);

  expect(first).toEqual({
    workerId: "loop-task-1",
    workspaceId: "w1",
    tabId: "w1:t2",
    paneId: "w1:p2",
    taskId: "task-1",
  });
  expect(second).toMatchObject({ tabId: "w1:t3", paneId: "w1:p3" });
  expect(third).toMatchObject({ tabId: "w1:t4", paneId: "w1:p4" });

  // Focus 비강탈 and no split/layout verbs anywhere.
  expect(runner.calls.some((args) => args.includes("--focus"))).toBe(false);
  expect(runner.calls.some((args) => args[0] === "pane" && (args[1] === "split" || args[1] === "layout"))).toBe(false);

  // Cleanup closes each worker's own tab; the workspace root tab survives.
  await runtime.cleanup(second);
  expect(runner.calls).toContainEqual(["tab", "close", "w1:t3"]);
  expect(runner.calls.some((args) => args[0] === "tab" && args[1] === "close" && args[2] === "w1:t1")).toBe(false);
});

test("cleanup closes a caller-anchored worker's tab without touching the Lead's workspace", async () => {
  const runner = tabWorldRunner({ workspaceId: "w7", rootPaneId: "w7:p4" });
  const runtime = new HerdrWorkerRuntime({ runner });

  const worker = await runtime.start({
    projectRoot: "/project",
    runId: "run-caller-cleanup",
    taskId: "task-1",
    worktree: "/project",
    caller: { workspaceId: "w7", paneId: "w7:p4" },
    execution: { type: "command", command: "true", args: [] },
    prompt: "",
  });

  await runtime.cleanup(worker);
  expect(runner.calls).toContainEqual(["tab", "close", "w7:t2"]);
  // The caller's workspace, its tabs, and the anchor pane are untouchable.
  expect(runner.calls.some((args) => args[0] === "workspace" && args[1] === "close")).toBe(false);
  expect(runner.calls.some((args) => args[0] === "tab" && args[1] === "close" && args[2] === "w7:t1")).toBe(false);
  expect(runner.calls.some((args) => args[0] === "pane" && args[1] === "close")).toBe(false);
});

test("closeWorkspace sweeps a caller-anchored run's leftover worker tabs without touching the user's workspace", async () => {
  const runner = tabWorldRunner({ workspaceId: "w7", rootPaneId: "w7:p4" });
  const runtime = new HerdrWorkerRuntime({ runner });
  const input = (taskId: string): HerdrWorkerInput => ({
    projectRoot: "/project",
    runId: "run-sweep",
    taskId,
    worktree: "/project",
    caller: { workspaceId: "w7", paneId: "w7:p4" },
    execution: { type: "command", command: "true", args: [] },
    prompt: "",
  });

  await runtime.start(input("task-1"));
  await runtime.start(input("task-2"));

  const res = await runtime.closeWorkspace("run-sweep");
  expect(res).toEqual({ closed: true, reason: "surfaces_closed" });
  expect(runner.calls).toContainEqual(["tab", "close", "w7:t2"]);
  expect(runner.calls).toContainEqual(["tab", "close", "w7:t3"]);
  // The caller's workspace, its own tabs, and the anchor pane are untouchable.
  expect(runner.calls.some((args) => args[0] === "workspace" && args[1] === "close")).toBe(false);
  expect(runner.calls.some((args) => args[0] === "tab" && args[1] === "close" && args[2] === "w7:t1")).toBe(false);
  expect(runner.calls.some((args) => args[0] === "pane" && args[1] === "close")).toBe(false);
});

test("closeWorkspace tolerates worker tabs the user already closed on their own", async () => {
  const runner = tabWorldRunner({ workspaceId: "w7", rootPaneId: "w7:p4" });
  const runtime = new HerdrWorkerRuntime({ runner });

  const worker = await runtime.start({
    projectRoot: "/project",
    runId: "run-idempotent",
    taskId: "task-1",
    worktree: "/project",
    caller: { workspaceId: "w7", paneId: "w7:p4" },
    execution: { type: "command", command: "true", args: [] },
    prompt: "",
  });
  // The user closes the worker tab directly; Loop never observed it.
  await runner.run("herdr", ["tab", "close", worker.tabId]);

  const res = await runtime.closeWorkspace("run-idempotent");
  expect(res).toEqual({ closed: true, reason: "surfaces_closed" });
  // The sweep retries the tab close, hits tab_not_found, and swallows it.
  expect(runner.calls.filter((args) => args[0] === "tab" && args[1] === "close")).toHaveLength(2);
  expect(runner.calls.some((args) => args[0] === "workspace" && args[1] === "close")).toBe(false);
});

test("closePane closes the mirror tab this run created", async () => {
  const mirrorRunner = tabWorldRunner({ workspaceId: "w7", rootPaneId: "w7:p4" });
  const mirrorRuntime = new HerdrWorkerRuntime({ runner: mirrorRunner });

  const pane = await mirrorRuntime.createPane(
    "run-mirror",
    "task-9",
    "/project",
    "/project",
    "task-9",
    { workspaceId: "w7", paneId: "w7:p4" },
  );
  expect(pane).toMatchObject({ tabId: "w7:t2", paneId: "w7:p5" });
  await mirrorRuntime.closePane(pane.tabId);

  expect(mirrorRunner.calls).toContainEqual(["tab", "close", "w7:t2"]);
  expect(mirrorRunner.calls.some((args) => args[0] === "pane" && args[1] === "close")).toBe(false);
});
