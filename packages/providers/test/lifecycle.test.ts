import { afterEach, expect, test } from "bun:test";

import { DEFAULT_RUN_TIMEOUT_MS, NodeProcessRunner } from "../src/process";
import { CodexProvider } from "../src/codex/adapter";
import { normalizeProcessResult } from "../src/process-provider";
import type { StartWorkerInput } from "../src/types";

const strayPids = new Set<number>();

afterEach(() => {
  for (const pid of strayPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The cancellation path already stopped it.
    }
  }
  strayPids.clear();
});

test.skipIf(process.platform === "win32")(
  "NodeProcessRunner cancels the entire process group and waits for descendants",
  async () => {
    const runner = new NodeProcessRunner({ cancelGraceMs: 100 });
    const script = [
      'const { spawn } = require("node:child_process")',
      'const child = spawn(process.execPath, ["-e", "process.on(\\"SIGTERM\\", () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" })',
      "child.unref()",
      "console.log(child.pid)",
      'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 20))',
      "setInterval(() => {}, 1000)",
    ].join(";");
    const running = runner.start(process.execPath, ["-e", script]);
    const pid = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("missing descendant pid")), 2_000);
      const unsubscribe = running.subscribe?.((event) => {
        const parsed = Number.parseInt(event.chunk.trim(), 10);
        if (!Number.isInteger(parsed)) return;
        clearTimeout(timeout);
        unsubscribe?.();
        strayPids.add(parsed);
        resolve(parsed);
      });
    });

    await running.cancel();

    expect(isAlive(pid)).toBe(false);
    strayPids.delete(pid);
  },
);

test("NodeProcessRunner leaves a stalled worker running before its deadline, then kills it and reports retryable timeout", async () => {
  const runner = new NodeProcessRunner({ runTimeoutMs: 120, cancelGraceMs: 20 });
  const running = runner.start(process.execPath, [
    "-e",
    "process.stdout.write(String(process.pid) + '\\n'); setInterval(() => {}, 1000)",
  ]);
  let settled = false;
  void running.result.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(settled).toBe(false);

  const processResult = await running.result;
  const result = normalizeProcessResult(processResult);
  const childPid = Number(processResult.stdout.trim());

  expect(result.success).toBe(false);
  expect(result.failure).toEqual({ kind: "timeout", retryable: true });
  expect(result.summary).toContain("timed out");
  expect(Number.isInteger(childPid)).toBe(true);
  expect(() => process.kill(childPid, 0)).toThrow();
});

test("NodeProcessRunner applies a 30 minute default run deadline", async () => {
  expect(DEFAULT_RUN_TIMEOUT_MS).toBe(30 * 60 * 1000);
});

test("NodeProcessRunner probe remains asynchronous while enforcing its deadline", async () => {
  const runner = new NodeProcessRunner({ probeTimeoutMs: 40, cancelGraceMs: 20 });
  let eventLoopAdvanced = false;
  setTimeout(() => {
    eventLoopAdvanced = true;
  }, 5);

  const result = await runner.probe(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);

  expect(eventLoopAdvanced).toBe(true);
  expect(result.exitCode).not.toBe(0);
});

test.skipIf(process.platform === "win32")(
  "NodeProcessRunner drains final stdout after leader exit without waiting forever on pipes",
  async () => {
    const runner = new NodeProcessRunner({ drainTimeoutMs: 100 });
    const script = [
      'const { spawn } = require("node:child_process")',
      'const child = spawn(process.execPath, ["-e", "setTimeout(() => console.log(\\"late-final\\"), 20)"], { stdio: ["ignore", 1, 2] })',
      "child.unref()",
      'console.log("early")',
    ].join(";");

    const result = await runner.start(process.execPath, ["-e", script]).result;

    expect(result.stdout).toContain("early");
    expect(result.stdout).toContain("late-final");
  },
);

test("process providers release only completed worker sessions", async () => {
  let cancelled = false;
  const runner = {
    async probe() {
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    start() {
      return {
        id: "process-release",
        result: Promise.resolve({ exitCode: 0, stdout: "done", stderr: "" }),
        cancel: async () => {
          cancelled = true;
        },
      };
    },
  };
  const provider = new CodexProvider({ cwd: "/project", runner, computeClasses: ["balanced"] });
  const handle = await provider.start(input);
  await provider.result(handle.id);

  await provider.release!(handle.id);

  expect(cancelled).toBe(true);
  expect(provider.status(handle.id)).rejects.toThrow("unknown worker");
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const input: StartWorkerInput = {
  runId: "run-1",
  taskId: "task-1",
  title: "task",
  kind: "implementation",
  computeClass: "strong",
  attempt: 0,
  requirements: ["edit files"],
};
