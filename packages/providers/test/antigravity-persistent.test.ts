import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { AgyStreamDriver } from "../src/antigravity/driver";
import { AgyPersistentProvider } from "../src/antigravity/persistent";
import type { StartWorkerInput, ProviderEvent } from "../src/types";

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
      queueMicrotask(() => child.emit("close", 0, null));
    },
  };
  child.pid = 424242;
  child.exitCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    return true;
  };
  return { child, written };
}

function spawnScript(child: FakeChild, onSpawn?: () => void) {
  const spawnProcess = (() => {
    onSpawn?.();
    // emit init asynchronously, like a real process
    queueMicrotask(() =>
      child.stdout.emit(
        "data",
        `${JSON.stringify({ event: "init", conversation_id: "conv-1" })}\n`,
      ),
    );
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
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
      preferredCompute: "strong",
      minimumCompute: "fast",
      maximumCompute: "frontier",
      maxAttempts: 3,
    },
    attempt: 1,
    dependencyResults: [],
    previousChecks: [],
    guidance: [],
  },
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
    await driver.dispose();
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
    await driver.dispose();
  });

  test("passes conversation id on resume-style construction", async () => {
    const { child } = fakeChild();
    let capturedArgs: string[] | undefined;
    const spawnProcess = ((_command: string, args: string[]) => {
      capturedArgs = args;
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    const driver = AgyStreamDriver.start({
      cwd: "/project",
      conversationId: "conv-9",
      spawnProcess,
    });
    expect(driver.conversationId).toBe("conv-9");
    expect(capturedArgs).toContain("--conversation");
    expect(capturedArgs?.[capturedArgs?.indexOf("--conversation") + 1]).toBe("conv-9");
    expect(capturedArgs).toContain("--input-format");
    await driver.dispose();
  });

  test("cancel resolves only after the persistent child closes", async () => {
    const { child } = fakeChild();
    child.kill = () => {
      child.killed = true;
      return true;
    };
    const driver = AgyStreamDriver.start({
      cwd: "/project",
      spawnProcess: spawnScript(child),
      turnTimeoutMs: 5_000,
    });
    const turn = driver.turn("keep working");
    let stopped = false;
    const cancellation = driver.cancel(0).then(() => {
      stopped = true;
    });

    await Bun.sleep(10);
    expect(stopped).toBe(false);
    child.emit("close", null, "SIGTERM");
    await cancellation;

    expect((await turn).failure?.kind).toBe("cancelled");
  });
});

describe("AgyPersistentProvider", () => {
  test("streams redacted activity before the turn completes and unsubscribes", async () => {
    const { child } = fakeChild();
    const driver = AgyStreamDriver.start({
      cwd: "/project",
      spawnProcess: spawnScript(child),
      turnTimeoutMs: 5000,
    });
    const provider = new AgyPersistentProvider({
      id: "agy-progress",
      cwd: "/project",
      computeClasses: ["balanced"],
      driverFactory: () => driver,
    });
    const handle = await provider.start(input);
    const events: ProviderEvent[] = [];
    const unsubscribe = provider.subscribe(handle.id, (event) => events.push(event));
    try {
      child.stdout.emit(
        "data",
        JSON.stringify({
          event: "step_update",
          step_update: { text_delta: "Checking graph dependencies" },
        }) + "\n",
      );
      child.stderr.emit("data", "Authorization: Bearer provider-secret\nretrying transport");
      expect(events).toContainEqual({
        type: "output",
        stream: "stdout",
        text: "Checking graph dependencies",
      });
      expect(JSON.stringify(events)).toContain("retrying transport");
      expect(JSON.stringify(events)).not.toContain("provider-secret");
      expect(await provider.status(handle.id)).toBe("running");
      const count = events.length;
      unsubscribe();
      child.stdout.emit(
        "data",
        JSON.stringify({ event: "step_update", step_update: { text_delta: "more work" } }) + "\n",
      );
      expect(events).toHaveLength(count);
    } finally {
      child.stdout.emit(
        "data",
        JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "done" } }) + "\n",
      );
      await provider.result(handle.id);
      await provider.release(handle.id);
    }
  });

  test("a timed-out turn reports failure and releases its process before reuse", async () => {
    const { child } = fakeChild();
    const driver = AgyStreamDriver.start({
      cwd: "/project",
      spawnProcess: spawnScript(child),
      turnTimeoutMs: 20,
    });
    const provider = new AgyPersistentProvider({
      id: "agy-timeout",
      cwd: "/project",
      computeClasses: ["balanced"],
      driverFactory: () => driver,
    });
    const handle = await provider.start(input);
    const result = await provider.result(handle.id);
    await provider.release(handle.id);
    expect(result.success).toBe(false);
    expect(result.failure?.kind).toBe("timeout");
    expect(driver.running).toBe(false);
    await expect(provider.status(handle.id)).rejects.toThrow("unknown worker");
  });

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
      computeClasses: ["strong"],
      driverFactory: () => driver as never,
    });
    const handle = await provider.start(input);
    expect(handle.id).toBe("run-1:task-1:1");
    const result = await provider.result(handle.id);
    expect(result.success).toBe(true);
    expect(result.summary).toBe("done");
    expect(result.sessionId).toBe("conv-77");
    expect(turns[0]).toContain("CONTEXT_INTENT_ONLY");
    expect(turns[0]).toContain("packages/providers/src/**");
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
      computeClasses: ["strong"],
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

  test("cancel waits for the driver and active turn to stop", async () => {
    const turn = deferred<{
      ok: boolean;
      response: string;
      conversationId: string;
      failure: { kind: "cancelled"; retryable: false };
    }>();
    const stopped = deferred<void>();
    const driver = {
      turn: () => turn.promise,
      cancel: () =>
        stopped.promise.then(() => {
          turn.resolve({
            ok: false,
            response: "",
            conversationId: "conv-cancel",
            failure: { kind: "cancelled", retryable: false },
          });
        }),
      dispose: async () => undefined,
      get conversationId() {
        return "conv-cancel";
      },
    };
    const provider = new AgyPersistentProvider({
      id: "antigravity:test",
      cwd: "/project",
      computeClasses: ["strong"],
      driverFactory: () => driver as never,
    });
    const handle = await provider.start(input);

    let cancelled = false;
    const cancellation = provider.cancel(handle.id).then(() => {
      cancelled = true;
    });
    await Promise.resolve();
    expect(cancelled).toBe(false);

    stopped.resolve();
    await cancellation;
    expect(await provider.status(handle.id)).toBe("cancelled");
    expect((await provider.result(handle.id)).failure?.kind).toBe("cancelled");
  });

  test("release disposes the worker process and removes its session", async () => {
    let disposed = false;
    const driver = {
      turn: async () => ({ ok: true, response: "done", conversationId: "conv-release" }),
      cancel: async () => undefined,
      dispose: async () => {
        disposed = true;
      },
      get conversationId() {
        return "conv-release";
      },
    };
    const provider = new AgyPersistentProvider({
      id: "antigravity:test",
      cwd: "/project",
      computeClasses: ["strong"],
      driverFactory: () => driver as never,
    });
    const handle = await provider.start(input);
    await provider.result(handle.id);

    await provider.release?.(handle.id);

    expect(disposed).toBe(true);
    expect(provider.status(handle.id)).rejects.toThrow("unknown worker");
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
