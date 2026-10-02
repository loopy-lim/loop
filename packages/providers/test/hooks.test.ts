import { describe, expect, test } from "bun:test";

import {
  HOOK_OUTPUT_LIMIT,
  LifecycleHookRunner,
  ProcessHookExecutor,
  HookedProvider,
  type HookExecutor,
  type LifecycleHookDefinition,
} from "../src/hooks";
import { defaultToolMediationPolicy } from "../src/mediation";
import { FakeProvider } from "../src/fake";
import type { ProcessResult } from "../src/process";
import type { StartWorkerInput } from "../src/types";

function fakeExecutor(handler: (command: string, args: string[]) => Partial<ProcessResult> | Promise<never>): HookExecutor {
  return {
    async run(command, args) {
      const result = await handler(command, args);
      return { exitCode: 0, stdout: "", stderr: "", ...result };
    },
  };
}

const clock = () => new Date("2026-01-01T00:00:00Z");

const input: StartWorkerInput = {
  runId: "run-1",
  taskId: "task-1",
  title: "task",
  kind: "implementation",
  computeClass: "fast",
  attempt: 0,
  requirements: [],
};

describe("lifecycle hook runner (G13)", () => {
  test("runs matching hooks and records completed evidence", async () => {
    const runner = new LifecycleHookRunner({
      definitions: [
        { hookId: "format", phase: "workerEnded", command: "bun", args: ["format"], cwd: "/repo" },
        { hookId: "wrong-phase", phase: "workerStarted", command: "bun", args: ["lint"] },
      ],
      executor: fakeExecutor(() => ({ exitCode: 0, stdout: "formatted\n" })),
      clock,
    });
    const events = await runner.run("workerEnded", { runId: "run-1", taskId: "task-1" });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      hookId: "format",
      phase: "workerEnded",
      outcome: "completed",
      runId: "run-1",
      taskId: "task-1",
      output: "formatted",
      truncated: false,
      exitCode: 0,
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(runner.events()).toHaveLength(1);
  });

  test("non-zero exits record failed evidence without throwing", async () => {
    const runner = new LifecycleHookRunner({
      definitions: [{ hookId: "policy", phase: "turnEnded", command: "check-policy" }],
      executor: fakeExecutor(() => ({ exitCode: 2, stderr: "policy violation" })),
      clock,
    });
    const events = await runner.run("turnEnded");
    expect(events[0].outcome).toBe("failed");
    expect(events[0].exitCode).toBe(2);
    expect(events[0].output).toContain("policy violation");
  });

  test("unrunnable hooks are skipped and timed-out hooks fail", async () => {
    const runner = new LifecycleHookRunner({
      definitions: [
        { hookId: "missing", phase: "workerStarted", command: "definitely-missing-binary" },
        { hookId: "slow", phase: "workerStarted", command: "slow-hook", timeoutMs: 10 },
      ],
      executor: {
        run(_command, _args, options) {
          if (_command === "slow-hook") {
            return Promise.resolve({ exitCode: 1, stdout: "", stderr: `hook timed out after ${options.timeoutMs}ms` });
          }
          throw new Error("spawn definite-mismatch ENOENT");
        },
      },
      clock,
    });
    const events = await runner.run("workerStarted");
    const byHook = new Map(events.map((event) => [event.hookId, event]));
    expect(byHook.get("missing")?.outcome).toBe("skipped");
    expect(byHook.get("slow")?.outcome).toBe("failed");
    expect(byHook.get("slow")?.exitCode).toBeNull();
  });

  test("mediation denies destructive hook commands as skipped evidence (G5 integration)", async () => {
    const runner = new LifecycleHookRunner({
      definitions: [{ hookId: "wipe", phase: "workerEnded", command: "sudo rm -rf /" }],
      executor: fakeExecutor(() => {
        throw new Error("must not execute");
      }),
      mediation: defaultToolMediationPolicy(),
      clock,
    });
    const events = await runner.run("workerEnded");
    expect(events[0].outcome).toBe("skipped");
    expect(events[0].output).toContain("mediation denied");
    expect(events[0].output).toContain("deny");
  });

  test("hook output is truncated at the frame bound", async () => {
    const runner = new LifecycleHookRunner({
      definitions: [{ hookId: "chatty", phase: "workerEnded", command: "chatty" }],
      executor: fakeExecutor(() => ({
        exitCode: 0,
        stdout: "filler line\n".repeat((HOOK_OUTPUT_LIMIT / 11) + 40),
      })),
      clock,
    });
    const events = await runner.run("workerEnded");
    expect(events[0].truncated).toBe(true);
    expect(events[0].output.length).toBeLessThanOrEqual(HOOK_OUTPUT_LIMIT);
  });

  test("hook output is redacted before it is recorded", async () => {
    const runner = new LifecycleHookRunner({
      definitions: [{ hookId: "leaky", phase: "workerEnded", command: "leak" }],
      executor: fakeExecutor(() => ({ exitCode: 0, stdout: "api_key = supersecret-value" })),
      clock,
    });
    const events = await runner.run("workerEnded");
    expect(events[0].output).toContain("[redacted]");
    expect(events[0].output).not.toContain("supersecret-value");
  });

  test("emission seam notifies subscribers synchronously per event", async () => {
    const runner = new LifecycleHookRunner({
      definitions: [{ hookId: "notify", phase: "workerStarted", command: "noop" }],
      executor: fakeExecutor(() => ({ exitCode: 0, stdout: "ok" })),
      clock,
    });
    const seen: string[] = [];
    runner.onEvent((event) => seen.push(event.hookId));
    await runner.run("workerStarted");
    expect(seen).toEqual(["notify"]);
  });
});

describe("HookedProvider worker-boundary emission (G13)", () => {
  test("fires workerStarted and workerEnded without altering results", async () => {
    const runner = new LifecycleHookRunner({
      definitions: [
        { hookId: "on-start", phase: "workerStarted", command: "noop" },
        { hookId: "on-end", phase: "workerEnded", command: "noop" },
        { hookId: "failing-hook", phase: "workerEnded", command: "boom" },
      ],
      executor: fakeExecutor((command) => {
        if (command === "boom") return { exitCode: 1, stderr: "hook failed" };
        return { exitCode: 0, stdout: "ok" };
      }),
      clock,
    });
    const provider = new HookedProvider(new FakeProvider("fake", ["fast"]), runner);
    const handle = await provider.start(input);
    const result = await provider.result(handle.id);
    // Evidence-only invariant: a failed hook never overrides the worker result.
    expect(result.success).toBe(true);

    const byHook = new Map(runner.events().map((event) => [event.hookId, event]));
    expect(byHook.get("on-start")?.outcome).toBe("completed");
    expect(byHook.get("on-end")?.outcome).toBe("completed");
    expect(byHook.get("failing-hook")?.outcome).toBe("failed");
    expect(byHook.get("on-start")?.runId).toBe("run-1");
  });

  test("hook executor rejections cannot reject the worker result", async () => {
    const brokenRunner = {
      run: () => Promise.reject(new Error("runner exploded")),
    } as never as LifecycleHookRunner;
    const provider = new HookedProvider(new FakeProvider("fake", ["fast"]), brokenRunner);
    const handle = await provider.start(input);
    const result = await provider.result(handle.id);
    expect(result.success).toBe(true);
  });
});

describe("ProcessHookExecutor", () => {
  test("runs a real process through the process runner", async () => {
    const executor = new ProcessHookExecutor();
    const result = await executor.run(process.execPath, ["-e", "console.log('hook ran')"], { timeoutMs: 5_000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hook ran");
  });
});

test("hook definitions are matched by the fixed v1 phase vocabulary", async () => {
  const definitions: LifecycleHookDefinition[] = [
    { hookId: "tool-start", phase: "toolCallStarted", command: "noop" },
    { hookId: "tool-end", phase: "toolCallEnded", command: "noop" },
    { hookId: "turn-start", phase: "turnStarted", command: "noop" },
  ];
  const runner = new LifecycleHookRunner({ definitions, executor: fakeExecutor(() => ({ exitCode: 0 })), clock });
  expect((await runner.run("toolCallStarted")).map((event) => event.hookId)).toEqual(["tool-start"]);
  expect((await runner.run("turnEnded"))).toEqual([]);
});
