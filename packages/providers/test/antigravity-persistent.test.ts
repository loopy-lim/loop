import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { AgyStreamDriver } from "../src/antigravity/driver";
import { AgyPersistentProvider } from "../src/antigravity/persistent";
import type { StartWorkerInput } from "../src/types";

interface FakeOut extends EventEmitter {
  setEncoding(): void;
}
interface FakeChild extends EventEmitter {
  stdout: FakeOut;
  stderr: FakeOut;
  stdin: { write(data: string, cb?: (error?: Error | null) => void): boolean; end(): void };
  pid: number;
  exitCode: number | null;
  killed: boolean;
  kill(): boolean;
}

function fakeChild() {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter() as FakeOut;
  child.stdout.setEncoding = () => undefined;
  child.stderr = new EventEmitter() as FakeOut;
  child.stderr.setEncoding = () => undefined;
  const written: string[] = [];
  child.stdin = {
    write(data: string, cb?: (error?: Error | null) => void): boolean {
      written.push(data);
      cb?.(null);
      return true;
    },
    end() {
      written.push("__end__");
    },
  };
  child.pid = 424242;
  child.exitCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return { child, written };
}

function spawnScript(child: FakeChild, onSpawn?: () => void) {
  const spawnProcess = ((() => {
    onSpawn?.();
    // emit init asynchronously, like a real process
    queueMicrotask(() => child.stdout.emit("data", `${JSON.stringify({ event: "init", conversation_id: "conv-1" })}\n`));
    return child;
  }) as unknown) as typeof import("node:child_process").spawn;
  return spawnProcess;
}

const input: StartWorkerInput = {
  runId: "run-1",
  taskId: "task-1",
  title: "Implement task 1",
  kind: "worker",
  computeClass: "strong",
  attempt: 1,
  requirements: ["must pass checks"],
};

describe("AgyStreamDriver", () => {
  test("spawns persistent stream-json agy and completes a turn", async () => {
    const { child, written } = fakeChild();
    const driver = AgyStreamDriver.start({
      cwd: "/project",
      model: "gemini-3.1-pro-high",
      spawnProcess: spawnScript(child),
      turnTimeoutMs: 5000,
    });

    const turn = driver.turn("Implement task 1");
    await Promise.resolve();
    expect(child.stdin.write).toBeTruthy();
    queueMicrotask(() =>
      child.stdout.emit(
        "data",
        `${JSON.stringify({
          event: "result",
          result: { status: "SUCCESS", response: "task complete", conversation_id: "conv-1" },
        })}\n`,
      ),
    );
    const result = await turn;
    expect(result.ok).toBe(true);
    expect(result.response).toBe("task complete");
    expect(result.conversationId).toBe("conv-1");
    expect(written[0]).toContain('"event":"user"');
    expect(written[0]).toContain("Implement task 1");
    driver.dispose();
  });

  test("fails closed on non-successful statuses", async () => {
    const { child } = fakeChild();
    const driver = AgyStreamDriver.start({
      cwd: "/project",
      spawnProcess: spawnScript(child),
      turnTimeoutMs: 5000,
    });
    const turn = driver.turn("hello");
    await Promise.resolve();
    queueMicrotask(() =>
      child.stdout.emit(
        "data",
        `${JSON.stringify({ event: "result", result: { status: "FAILURE", error: "quota exhausted" } })}\n`,
      ),
    );
    const result = await turn;
    expect(result.ok).toBe(false);
    expect(result.error).toBe("quota exhausted");
    driver.dispose();
  });

  test("passes conversation id on resume-style construction", () => {
    const { child } = fakeChild();
    let capturedArgs: string[] | undefined;
    const spawnProcess = ((_command: string, args: string[]) => {
      capturedArgs = args;
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    const driver = AgyStreamDriver.start({ cwd: "/project", conversationId: "conv-9", spawnProcess });
    expect(driver.conversationId).toBe("conv-9");
    expect(capturedArgs).toContain("--conversation");
    expect(capturedArgs![capturedArgs!.indexOf("--conversation") + 1]).toBe("conv-9");
    expect(capturedArgs).toContain("--input-format");
    driver.dispose();
  });
});

describe("AgyPersistentProvider", () => {
  test("start returns a resumable handle and folds the turn into a result", async () => {
    const turns: string[] = [];
    const driver = {
      turn: async (prompt: string) => {
        turns.push(prompt);
        return { ok: true, response: "done", conversationId: "conv-77" };
      },
      cancel: async () => undefined,
      dispose: () => undefined,
      get conversationId() {
        return "conv-77";
      },
    };
    const provider = new AgyPersistentProvider({
      id: "antigravity:test",
      cwd: "/project",
      model: "gemini-3.1-pro-high",
      driverFactory: () => driver as never,
    });
    const handle = await provider.start(input);
    expect(handle.id).toBe("run-1:task-1");
    const result = await provider.result(handle.id);
    expect(result.success).toBe(true);
    expect(result.summary).toBe("done");
    expect(result.sessionId).toBe("conv-77");
    expect(turns[0]).toContain("Implement task 1");
    expect(turns[0]).toContain("must pass checks");
  });

  test("resume reattaches the previous conversation", async () => {
    let captured: { conversationId?: string } | undefined;
    const driver = {
      turn: async () => ({ ok: true, response: "resumed", conversationId: "conv-77" }),
      cancel: async () => undefined,
      dispose: () => undefined,
      get conversationId() {
        return "conv-77";
      },
    };
    const provider = new AgyPersistentProvider({
      id: "antigravity:test",
      cwd: "/project",
      driverFactory: (options) => {
        captured = options;
        return driver as never;
      },
    });
    const handle = await provider.resume("conv-77", { ...input, previousWorkerId: "old" });
    expect(handle.sessionId).toBe("conv-77");
    expect(captured?.conversationId).toBe("conv-77");
    const result = await provider.result(handle.id);
    expect(result.success).toBe(true);
  });
});
