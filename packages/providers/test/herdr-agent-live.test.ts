import { expect, test } from "bun:test";
import { HerdrWorkerRuntime, type HerdrRunner } from "@loop/herdr";
import { classifyFailure } from "../src/process-provider";

import { FakeProvider, HerdrAgentProvider, MirroringProvider, type StartWorkerInput } from "../src";

/**
 * Live conversation tab contracts (docs/decisions/2026-09-24-herdr-live-conversation-tabs.md):
 * per-kind launch argv, the `agent prompt` steer surface, and the
 * already-gone → `pane get` status fallback. Everything runs against a fake
 * HerdrRunner — no herdr binary, no agent process, no paid model call.
 */

const input: StartWorkerInput = {
  runId: "run-1",
  taskId: "task-1",
  title: "task",
  kind: "implementation",
  computeClass: "strong",
  attempt: 0,
  requirements: ["edit files"],
  workingDirectory: "/project/task",
};

interface LaunchScript {
  /** Extra argv after `--` in `agent start` (what composition's visibleAgent builds). */
  args: readonly string[];
  kind: "pi" | "codex" | "agy";
}

/**
 * Fake runner for a full happy-path interactive lifecycle: launch → prompt →
 * working → done → readable transcript. Agent verbs can be flipped to
 * already-gone errors per test.
 */
function liveRunner(
  script: LaunchScript & {
    agentStatuses?: string[];
    agentGoneAfter?: number;
  },
): HerdrRunner & { calls: string[][] } {
  const calls: string[][] = [];
  let polls = 0;
  return {
    calls,
    async run(_command, args) {
      calls.push(args);
      if (args[0] === "workspace") {
        return ok({
          result: { workspace: { workspace_id: "w1" }, root_pane: { pane_id: "w1:p1" } },
        });
      }
      if (args[0] === "tab" && args[1] === "create") {
        return ok({ result: { tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p2" } } });
      }
      if (args[0] === "agent" && args[1] === "start") {
        return ok({
          result: { agent: { name: args[2], agent_status: "idle", interactive_ready: true } },
          argv: [script.kind],
          type: "agent_started",
        });
      }
      if (args[0] === "agent" && args[1] === "get") {
        const poll = polls++;
        if (script.agentGoneAfter !== undefined && poll >= script.agentGoneAfter) {
          return err("agent_not_found", "agent record pruned");
        }
        const statuses = script.agentStatuses ?? ["working", "done"];
        return ok({
          result: { agent: { agent_status: statuses[Math.min(poll, statuses.length - 1)] } },
        });
      }
      if (args[0] === "agent" && args[1] === "read") {
        // A pruned agent record fails reads too — the pane is the remaining
        // snapshot surface (live-tabs ADR §5).
        if (script.agentGoneAfter !== undefined) {
          return err("agent_not_found", "agent record pruned");
        }
        return { exitCode: 0, stdout: "agent transcript tail", stderr: "" };
      }
      return ok({ result: {} });
    },
  };
}

test.each([
  { kind: "pi" as const, args: ["--model", "gpt-5.3-codex-spark"] },
  { kind: "codex" as const, args: ["--sandbox", "workspace-write", "--model", "gpt-5.5-codex"] },
  { kind: "agy" as const, args: ["--sandbox", "--model", "gemini-3.1-pro"] },
])("launches the live $kind conversation TUI with its kind-specific argv", async (script) => {
  const runner = liveRunner(script);
  const provider = new HerdrAgentProvider({
    id: `${script.kind}:live`,
    runtime: new HerdrWorkerRuntime({ runner }),
    kind: script.kind,
    projectRoot: "/project",
    computeClasses: ["strong"],
    args: [...script.args],
    pollIntervalMs: 0,
  });

  const handle = await provider.start(input);
  expect(await provider.result(handle.id)).toMatchObject({ success: true });
  expect(runner.calls).toContainEqual([
    "agent",
    "start",
    "loop-run-1-task-1",
    "--kind",
    script.kind,
    "--pane",
    "w1:p2",
    "--",
    ...script.args,
  ]);
  expect(runner.calls).toContainEqual([
    "agent",
    "prompt",
    "loop-run-1-task-1",
    expect.stringContaining("task"),
  ]);
});

test("steer delivers one agent prompt call into the live conversation", async () => {
  const runner = liveRunner({ kind: "pi", args: ["--model", "m1"], agentStatuses: ["working"] });
  const provider = new HerdrAgentProvider({
    id: "pi:steer",
    runtime: new HerdrWorkerRuntime({ runner }),
    kind: "pi",
    projectRoot: "/project",
    computeClasses: ["fast"],
    args: ["--model", "m1"],
    pollIntervalMs: 0,
  });
  const handle = await provider.start(input);

  const message = "pivot: use plan 'B'\nsecond line";
  await provider.steer!(handle.id, message);

  // The initial prompt uses the same verb; the steer call is the one carrying
  // the message verbatim as a single argv element.
  const steerCalls = runner.calls.filter(
    (args) => args[0] === "agent" && args[1] === "prompt" && args[3] === message,
  );
  expect(steerCalls).toEqual([["agent", "prompt", "loop-run-1-task-1", message]]);
});

test("steer rejects workers whose conversation already ended", async () => {
  const runner = liveRunner({ kind: "codex", args: [] });
  const provider = new HerdrAgentProvider({
    id: "codex:steer-done",
    runtime: new HerdrWorkerRuntime({ runner }),
    kind: "codex",
    projectRoot: "/project",
    computeClasses: ["strong"],
    args: [],
    pollIntervalMs: 0,
  });
  const handle = await provider.start(input);
  await provider.result(handle.id);

  await expect(provider.steer!(handle.id, "too late")).rejects.toThrow(/no longer running/);
});

test("completed worker tab closes when its resources are released", async () => {
  const runner = liveRunner({ kind: "pi", args: [] });
  const provider = new HerdrAgentProvider({
    id: "pi:review",
    runtime: new HerdrWorkerRuntime({ runner }),
    kind: "pi",
    projectRoot: "/project",
    computeClasses: ["fast"],
    pollIntervalMs: 0,
  });
  const handle = await provider.start(input);
  expect(await provider.result(handle.id)).toMatchObject({ success: true });
  await provider.release(handle.id);
  expect(runner.calls).toContainEqual(["tab", "close", "w1:t2"]);
});

test("interactive Pi quota exhaustion is a provider failure, not a completed worker", async () => {
  const runner = liveRunner({
    kind: "pi",
    args: [],
    agentStatuses: ["working", "idle", "working", "idle"],
  });
  let reads = 0;
  const provider = new HerdrAgentProvider({
    id: "pi:quota",
    runtime: new HerdrWorkerRuntime({
      runner: {
        async run(command, args) {
          if (args[0] === "agent" && args[1] === "read") {
            reads += 1;
            return reads === 1
              ? {
                  exitCode: 0,
                  stdout:
                    "Error: 429: rate limit reached\n── Retrying (1/3) in 2s...\n/project (main)\n0.6%/1.0M (auto)\n🎭 implementer",
                  stderr: "",
                }
              : {
                  exitCode: 0,
                  stdout:
                    "Error: 429: rate limit reached\nError: Retry failed after 3 attempts: 429: rate limit reached\n/project (main)\n0.6%/1.0M (auto)\n🎭 implementer",
                  stderr: "",
                };
          }
          return runner.run(command, args);
        },
      },
    }),
    kind: "pi",
    projectRoot: "/project",
    computeClasses: ["fast"],
    pollIntervalMs: 0,
  });
  const handle = await provider.start(input);
  expect(await provider.result(handle.id)).toMatchObject({
    success: false,
    failure: { kind: "quota", retryable: true },
  });
  expect(reads).toBe(2);
  await provider.release(handle.id);
  expect(runner.calls).toContainEqual(["tab", "close", "w1:t2"]);
});

test("a bare HTTP 429 retry failure is classified as quota", () => {
  expect(classifyFailure("Error: Retry failed after 3 attempts: 429")).toBe("quota");
});

test("steer propagates agent_blocked so the recorded-steer fallback keeps the message", async () => {
  const runner = liveRunner({ kind: "agy", args: [], agentStatuses: ["working"] });
  let prompts = 0;
  const runtime = new HerdrWorkerRuntime({
    runner: {
      async run(_cmd, args) {
        if (args[0] === "agent" && args[1] === "prompt") {
          // The initial launch prompt passes; steer attempts get blocked.
          prompts += 1;
          if (prompts > 1) return err("agent_blocked", "prompt rejected while blocked");
        }
        return (runner as HerdrRunner).run("herdr", args);
      },
    },
  });
  const provider = new HerdrAgentProvider({
    id: "agy:steer-blocked",
    runtime,
    kind: "agy",
    projectRoot: "/project",
    computeClasses: ["frontier"],
    args: [],
    pollIntervalMs: 0,
  });
  const handle = await provider.start(input);

  await expect(provider.steer!(handle.id, "unblock please")).rejects.toThrow(/agent_blocked/);
});

test("status polling falls back to the pane when the agent record disappears mid-run", async () => {
  const runner = liveRunner({ kind: "pi", args: [], agentGoneAfter: 1 });
  // Pane observation: the TUI process exited, and only the pane snapshot remains.
  const paneCalls: string[][] = [];
  const runtime = new HerdrWorkerRuntime({
    runner: {
      async run(_cmd, args) {
        if (args[0] === "pane" && args[1] === "get") {
          paneCalls.push(args);
          return ok({ result: { pane: { state: "exited" } } });
        }
        if (args[0] === "pane" && args[1] === "read") {
          paneCalls.push(args);
          return { exitCode: 0, stdout: "final pane tail", stderr: "" };
        }
        return (runner as HerdrRunner).run("herdr", args);
      },
    },
  });
  const provider = new HerdrAgentProvider({
    id: "pi:gone",
    runtime,
    kind: "pi",
    projectRoot: "/project",
    computeClasses: ["fast"],
    args: [],
    pollIntervalMs: 0,
  });

  const handle = await provider.start(input);
  expect(await provider.result(handle.id)).toMatchObject({
    success: true,
    summary: "final pane tail",
  });
  expect(paneCalls).toContainEqual(["pane", "get", "w1:p2"]);
  expect(paneCalls).toContainEqual(["pane", "read", "w1:p2", "--lines", "80"]);
});

test("a fully vanished worker is termination-confirmed, not lost", async () => {
  const runtime = new HerdrWorkerRuntime({
    runner: {
      async run(_cmd, args) {
        if (args[0] === "workspace") {
          return ok({
            result: { workspace: { workspace_id: "w1" }, root_pane: { pane_id: "w1:p1" } },
          });
        }
        if (args[0] === "tab" && args[1] === "create") {
          return ok({ result: { tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p2" } } });
        }
        if (args[0] === "agent" && args[1] === "start") {
          return ok({ result: { agent: { name: args[2], interactive_ready: true } } });
        }
        if (args[0] === "agent" && (args[1] === "get" || args[1] === "read")) {
          return err("agent_not_found", "agent record pruned");
        }
        if (args[0] === "pane" && (args[1] === "get" || args[1] === "read")) {
          return err("tab_not_found", "tab closed");
        }
        return ok({ result: {} });
      },
    },
  });
  const provider = new HerdrAgentProvider({
    id: "codex:vanished",
    runtime,
    kind: "codex",
    projectRoot: "/project",
    computeClasses: ["strong"],
    args: [],
    pollIntervalMs: 0,
  });

  const handle = await provider.start(input);
  const result = await provider.result(handle.id);

  // ADR §5: pane/tab gone is termination confirmed — completed without a
  // readable transcript, never a lost/unknown session.
  expect(result.success).toBe(false);
  expect(result.summary).toBe("Herdr worker completed without readable output");
  expect(result.failure).toEqual({ kind: "incomplete_output", retryable: true });
  expect(await provider.status(handle.id)).toBe("completed");
});

test("a live agent that lost interactive readiness surfaces as a retryable loss", async () => {
  const runtime = new HerdrWorkerRuntime({
    runner: {
      async run(_cmd, args) {
        if (args[0] === "workspace") {
          return ok({
            result: { workspace: { workspace_id: "w1" }, root_pane: { pane_id: "w1:p1" } },
          });
        }
        if (args[0] === "tab" && args[1] === "create") {
          return ok({ result: { tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p2" } } });
        }
        if (args[0] === "agent" && args[1] === "start") {
          return ok({ result: { agent: { name: args[2], interactive_ready: true } } });
        }
        if (args[0] === "agent" && args[1] === "get") {
          // pi's silent print-mode fallback: working, exit 0, but no live TUI.
          return ok({ result: { agent: { agent_status: "working", interactive_ready: false } } });
        }
        if (args[0] === "agent" && args[1] === "read") {
          return { exitCode: 0, stdout: "worker kept running headless", stderr: "" };
        }
        return ok({ result: {} });
      },
    },
  });
  const provider = new HerdrAgentProvider({
    id: "pi:silent-fallback",
    runtime,
    kind: "pi",
    projectRoot: "/project",
    computeClasses: ["fast"],
    args: [],
    pollIntervalMs: 0,
  });

  const handle = await provider.start(input);
  const result = await provider.result(handle.id);

  expect(result.success).toBe(false);
  expect(result.failure).toEqual({ kind: "process_error", retryable: true });
  expect(await provider.status(handle.id)).toBe("lost");
});

test("MirroringProvider forwards steer to the wrapped live provider and rejects headless ones", async () => {
  const runner = liveRunner({ kind: "pi", args: [], agentStatuses: ["working"] });
  const provider = new HerdrAgentProvider({
    id: "pi:wrapped",
    runtime: new HerdrWorkerRuntime({ runner }),
    kind: "pi",
    projectRoot: "/project",
    computeClasses: ["fast"],
    args: [],
    pollIntervalMs: 0,
  });
  const seen: string[] = [];
  const wrapped = new MirroringProvider(provider, (_workerId, line) => {
    seen.push(line);
  });
  const handle = await wrapped.start(input);

  await wrapped.steer!(handle.id, "steer through the decorator");

  expect(runner.calls).toContainEqual([
    "agent",
    "prompt",
    "loop-run-1-task-1",
    "steer through the decorator",
  ]);

  const headless = new MirroringProvider(new FakeProvider("fake", ["fast"]), () => {});
  const fakeHandle = await headless.start(input);
  await expect(headless.steer!(fakeHandle.id, "no conversation here")).rejects.toThrow(
    /does not support steer/,
  );
});

function ok(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}

function err(code: string, message: string) {
  return { exitCode: 1, stdout: "", stderr: JSON.stringify({ error: { code, message } }) };
}
