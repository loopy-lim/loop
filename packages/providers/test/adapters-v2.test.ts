import { expect, test } from "bun:test";
import { HerdrWorkerRuntime, type HerdrRunner } from "@loop/herdr";

import {
  AntigravityProvider,
  CodexProvider,
  FakeProvider,
  PiProvider,
  HerdrAgentProvider,
  ProviderRegistry,
  ZaiApiProvider,
  ZaiCliProvider,
  type ProcessRunner,
  type StartWorkerInput,
  normalizeProcessResult,
} from "../src";

class UnavailableProvider extends FakeProvider {
  override async capabilities() {
    return { ...(await super.capabilities()), available: false };
  }
}

class FakeRunner implements ProcessRunner {
  calls: Array<{ command: string; args: string[] }> = [];
  listeners = new Set<(event: { stream: "stdout" | "stderr"; chunk: string }) => void>();

  async probe(command: string, args: string[]) {
    this.calls.push({ command, args });
    if (args[0] === "models") {
      return { exitCode: 0, stdout: JSON.stringify({ models: ["gemini-3.1-pro"] }), stderr: "" };
    }
    return { exitCode: 0, stdout: "ok", stderr: "" };
  }

  start(command: string, args: string[]) {
    this.calls.push({ command, args });
    return {
      id: "process-1",
      result: Promise.resolve({
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
          JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: "done" },
          }),
        ].join("\n"),
        stderr: "",
      }),
      cancel: async () => {},
      subscribe: (listener: (event: { stream: "stdout" | "stderr"; chunk: string }) => void) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
    };
  }

  emit(stream: "stdout" | "stderr", chunk: string) {
    for (const listener of this.listeners) listener({ stream, chunk });
  }
}

class FailingRunner extends FakeRunner {
  override start(command: string, args: string[]) {
    this.calls.push({ command, args });
    return {
      id: "failed-process",
      result: Promise.resolve({
        exitCode: 1,
        stdout: "",
        stderr: "Authorization: Basic secret-value",
      }),
      cancel: async () => {},
      subscribe: (listener: (event: { stream: "stdout" | "stderr"; chunk: string }) => void) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
    };
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

test("Codex adapter probes the official surface and normalizes a completed worker", async () => {
  const runner = new FakeRunner();
  const provider = new CodexProvider({
    runner,
    cwd: "/project",
    model: "configured-model",
    sandbox: "workspace-write",
  });
  expect((await provider.capabilities()).available).toBe(true);
  const handle = await provider.start(input);
  const events: string[] = [];
  const unsubscribe = provider.subscribe(handle.id, (event) => {
    if (event.type === "output") events.push(event.text);
  });
  runner.emit("stdout", "worker started");
  unsubscribe();
  expect((await provider.result(handle.id)).summary).toBe("done");
  expect((await provider.result(handle.id)).sessionId).toBe("thread-1");
  expect(events).toEqual(["worker started"]);
  expect(runner.calls.some((call) => call.command === "codex" && call.args.includes("exec"))).toBe(true);
  expect(runner.calls.flatMap((call) => call.args)).toContain("workspace-write");
  expect(runner.calls.find((call) => call.args.includes("exec"))?.args).toContain("/project/task");
  expect(runner.calls.find((call) => call.args.includes("exec"))?.args.at(-1))
    .toContain("CONTEXT_INTENT_ONLY");
  expect(runner.calls.flatMap((call) => call.args)).not.toContain(expect.stringContaining("API_KEY"));
});

test("pi provider launches headless pi with the configured model pattern", async () => {
  const runner = new FakeRunner();
  const provider = new PiProvider({
    runner,
    cwd: "/project",
    command: "pi",
    provider: "zai",
    model: "zai/glm-5.3-flash",
    computeClasses: ["fast"],
  });
  await provider.start(input);
  const launch = runner.calls.at(-1)!;
  expect(launch.command).toBe("pi");
  expect(launch.args).toContain("--provider");
  expect(launch.args).toContain("zai");
  expect(launch.args).toContain("--model");
  expect(launch.args).toContain("zai/glm-5.3-flash");
  expect(launch.args).toContain("-p");
  expect(launch.args.at(-1)).toContain("CONTEXT_INTENT_ONLY");
  expect(launch.args).not.toContain("--sandbox");
});

test("Z.AI CLI provider uses the shared generated worker context", async () => {
  const runner = new FakeRunner();
  const provider = new ZaiCliProvider({ runner, cwd: "/project" });

  await provider.start(input);

  const launch = runner.calls.at(-1)!;
  expect(launch.args[launch.args.indexOf("--prompt") + 1]).toContain("CONTEXT_INTENT_ONLY");
});

test("Codex resume uses only arguments supported by the installed resume surface", async () => {
  const runner = new FakeRunner();
  const provider = new CodexProvider({
    runner,
    cwd: "/project",
    model: "configured-model",
    sandbox: "workspace-write",
    approveForMe: true,
  });
  await provider.resume("session-1", { ...input, previousWorkerId: "old" });
  const launch = runner.calls.at(-1)!;
  expect(launch.args.slice(0, 4)).toEqual(["exec", "resume", "session-1", "--json"]);
  expect(launch.args).not.toContain("--sandbox");
  expect(launch.args).not.toContain("--approve-for-me");
});

test("Antigravity adapter discovers models and uses stream-json execution", async () => {
  const runner = new FakeRunner();
  const provider = new AntigravityProvider({ runner, cwd: "/project" });
  const capabilities = await provider.capabilities();
  expect(capabilities.available).toBe(true);
  expect(capabilities.models).toEqual(["gemini-3.1-pro"]);
  await provider.start(input);
  const launch = runner.calls.find((call) => call.command === "agy" && call.args.includes("--output-format"));
  expect(launch?.args).toEqual([
    "--output-format",
    "stream-json",
    "--sandbox",
    "--print",
    expect.stringContaining("CONTEXT_INTENT_ONLY"),
  ]);
  await provider.resume("conversation-1", { ...input, previousWorkerId: "old" });
  expect(runner.calls.at(-1)?.args).toEqual([
    "--output-format",
    "stream-json",
    "--sandbox",
    "--conversation",
    "conversation-1",
    "--print",
    expect.stringContaining("CONTEXT_INTENT_ONLY"),
  ]);
});

test("process provider maps failures and redacts credentials", async () => {
  const provider = new CodexProvider({ runner: new FailingRunner(), cwd: "/project" });
  const handle = await provider.start(input);
  const result = await provider.result(handle.id);
  expect(result.success).toBe(false);
  expect(result.failure?.kind).toBe("authentication");
  expect(result.summary).not.toContain("secret-value");
  expect(result.summary).toContain("[redacted]");
});

test("machine-readable nested final events are normalized and empty success is incomplete", () => {
  expect(normalizeProcessResult({
    exitCode: 0,
    stdout: JSON.stringify({
      type: "result",
      payload: { message: { content: "nested final" } },
      conversation_id: "conversation-1",
    }),
    stderr: "",
  })).toEqual({
    success: true,
    summary: "nested final",
    sessionId: "conversation-1",
  });
  expect(normalizeProcessResult({ exitCode: 0, stdout: "", stderr: "" }).failure?.kind)
    .toBe("incomplete_output");
});

test("Antigravity stream-json result response is normalized as the final summary", () => {
  const result = normalizeProcessResult({
    exitCode: 0,
    stdout: JSON.stringify({
      event: "result",
      result: {
        conversation_id: "conversation-agy",
        status: "SUCCESS",
        response: "LOOP_AGY_STREAM_OK\n",
      },
    }),
    stderr: "",
  });

  expect(result).toEqual({
    success: true,
    summary: "LOOP_AGY_STREAM_OK\n",
    sessionId: "conversation-agy",
  });
});

test("Z.AI API adapter keeps the key in the header", async () => {
  let authorization = "";
  let prompt = "";
  const provider = new ZaiApiProvider({
    id: "zai-api",
    baseUrl: "https://example.invalid/v1",
    apiKey: "secret-value",
    model: "configured-model",
    mode: "general",
    fetch: async (_url, init) => {
      authorization = String((init?.headers as Record<string, string>).Authorization);
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string }>;
      };
      prompt = body.messages[0]?.content ?? "";
      return new Response(JSON.stringify({ choices: [{ message: { content: "done" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const handle = await provider.start(input);
  expect((await provider.result(handle.id)).summary).toBe("done");
  expect(authorization).toBe("Bearer secret-value");
  expect(prompt).toContain("CONTEXT_INTENT_ONLY");
  expect(JSON.stringify(await provider.status(handle.id))).not.toContain("secret-value");
  await provider.release!(handle.id);
  expect(provider.status(handle.id)).rejects.toThrow("unknown worker");
});

test("Z.AI API adapter redacts provider errors", async () => {
  const provider = new ZaiApiProvider({
    baseUrl: "https://example.invalid/v1",
    apiKey: "secret-value",
    model: "configured-model",
    mode: "general",
    fetch: async () => new Response(
      JSON.stringify({ error: { message: "Bearer secret-value rejected" } }),
      { status: 401, headers: { "content-type": "application/json" } },
    ),
  });
  const handle = await provider.start(input);
  const result = await provider.result(handle.id);
  expect(result.success).toBe(false);
  expect(result.summary).not.toContain("secret-value");
});

test("provider selection skips an unavailable adapter", async () => {
  const unavailable = new UnavailableProvider("missing-cli", ["fast"]);
  const available = new FakeProvider("available", ["fast"]);
  const selected = await new ProviderRegistry([unavailable, available]).select("fast");
  expect(selected.id).toBe("available");
});

test("interactive provider delegates agent lifecycle to Herdr", async () => {
  const calls: string[][] = [];
  const herdrRunner: HerdrRunner = {
    async run(_command, args) {
      calls.push(args);
      if (args[0] === "workspace") {
        return ok({
          result: {
            workspace: { workspace_id: "workspace-1" },
            root_pane: { pane_id: "workspace-1:p1" },
          },
        });
      }
      if (args[0] === "tab" && args[1] === "create") {
        return ok({ result: { tab: { tab_id: "workspace-1:t2" }, root_pane: { pane_id: "workspace-1:p2" } } });
      }
      if (args[0] === "agent" && args[1] === "get") {
        return ok({ result: { agent: { agent_status: "done" } } });
      }
      if (args[0] === "agent" && args[1] === "read") {
        // herdr `read` returns raw pane text, not JSON.
        return { exitCode: 0, stdout: "verified worker output", stderr: "" };
      }
      return ok({ result: {} });
    },
  };
  const provider = new HerdrAgentProvider({
    id: "codex-visible",
    runtime: new HerdrWorkerRuntime({ runner: herdrRunner }),
    kind: "codex",
    projectRoot: "/project",
    computeClasses: ["strong"],
    args: ["--sandbox", "workspace-write"],
    pollIntervalMs: 0,
  });

  const handle = await provider.start(input);
  expect(await provider.result(handle.id)).toMatchObject({
    success: true,
    summary: "verified worker output",
  });
  expect(calls).toContainEqual(expect.arrayContaining([
    "agent",
    "start",
    "--kind",
    "codex",
    "--sandbox",
    "workspace-write",
  ]));
  expect(calls.some((args) => args[0] === "agent" && args[1] === "prompt")).toBe(true);
  const promptCall = calls.find((args) => args[0] === "agent" && args[1] === "prompt");
  expect(promptCall?.[3]).toContain("CONTEXT_INTENT_ONLY");
});

test("prompt delivery rejection fails startup instead of reading stale status", async () => {
  const herdrRunner: HerdrRunner = {
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
        return ok({ result: { tab: { tab_id: "workspace-1:t2" }, root_pane: { pane_id: "workspace-1:p2" } } });
      }
      if (args[0] === "agent" && args[1] === "prompt") {
        // herdr exits 0 but prints non-JSON (observed in cleanup-support-r3).
        return { exitCode: 0, stdout: "agent turn state lost", stderr: "" };
      }
      if (args[0] === "agent" && args[1] === "get") {
        return ok({ result: { agent: { agent_status: "done" } } });
      }
      if (args[0] === "agent" && args[1] === "read") {
        return { exitCode: 0, stdout: "work finished despite the hiccup", stderr: "" };
      }
      return ok({ result: {} });
    },
  };
  const provider = new HerdrAgentProvider({
    id: "resilient",
    runtime: new HerdrWorkerRuntime({ runner: herdrRunner }),
    kind: "pi",
    projectRoot: "/project",
    computeClasses: ["fast"],
    pollIntervalMs: 0,
  });

  await expect(provider.start(input)).rejects.toThrow("Herdr returned invalid JSON");
});

test("Herdr idle state cannot turn stale pane text into a successful result", async () => {
  let reads = 0;
  const herdrRunner: HerdrRunner = {
    async run(_command, args) {
      if (args[0] === "workspace") {
        return ok({ result: { workspace: { workspace_id: "workspace-1" }, root_pane: { pane_id: "workspace-1:p1" } } });
      }
      if (args[0] === "tab" && args[1] === "create") {
        return ok({ result: { tab: { tab_id: "workspace-1:t2" }, root_pane: { pane_id: "workspace-1:p2" } } });
      }
      if (args[0] === "agent" && args[1] === "get") {
        return ok({ result: { agent: { agent_status: "idle" } } });
      }
      if (args[0] === "agent" && args[1] === "read") {
        reads += 1;
        return { exitCode: 0, stdout: "stale output from an earlier turn", stderr: "" };
      }
      return ok({ result: {} });
    },
  };
  const provider = new HerdrAgentProvider({
    id: "idle-safe",
    runtime: new HerdrWorkerRuntime({ runner: herdrRunner }),
    kind: "codex",
    projectRoot: "/project",
    computeClasses: ["strong"],
    pollIntervalMs: 0,
    startGraceMs: 10,
  });

  const handle = await provider.start(input);
  const result = await provider.result(handle.id);

  expect(result.success).toBe(false);
  expect(result.failure?.kind).toBe("incomplete_output");
  expect(reads).toBe(0);
});

test("Herdr cancellation waits for the active turn and release closes only the worker tab", async () => {
  const calls: string[][] = [];
  let observedStatus = "working";
  const herdrRunner: HerdrRunner = {
    async run(_command, args) {
      calls.push(args);
      if (args[0] === "workspace" && args[1] === "create") {
        return ok({
          result: {
            workspace: { workspace_id: "workspace-owned-by-caller" },
            tab: { tab_id: "caller-tab" },
            root_pane: { pane_id: "caller-pane" },
          },
        });
      }
      if (args[0] === "tab" && args[1] === "create") {
        return ok({ result: { tab: { tab_id: "worker-tab" }, root_pane: { pane_id: "worker-pane" } } });
      }
      if (args[0] === "agent" && args[1] === "get") {
        return ok({ result: { agent: { agent_status: observedStatus } } });
      }
      return ok({ result: {} });
    },
  };
  const provider = new HerdrAgentProvider({
    id: "herdr-lifecycle",
    runtime: new HerdrWorkerRuntime({ runner: herdrRunner, cancelGraceMs: 500, cancelPollMs: 0 }),
    kind: "codex",
    projectRoot: "/project",
    computeClasses: ["strong"],
    pollIntervalMs: 0,
  });
  const handle = await provider.start(input);

  let cancelled = false;
  const cancellation = provider.cancel(handle.id).then(() => {
    cancelled = true;
  });
  await Bun.sleep(10);
  expect(cancelled).toBe(false);

  observedStatus = "done";
  await cancellation;
  expect(await provider.status(handle.id)).toBe("cancelled");
  expect((await provider.result(handle.id)).failure?.kind).toBe("cancelled");

  await provider.release!(handle.id);
  expect(calls).toContainEqual(["tab", "close", "worker-tab"]);
  expect(calls.some((args) => args[0] === "workspace" && args[1] === "close")).toBe(false);
  expect(provider.status(handle.id)).rejects.toThrow("unknown worker");
});

function ok(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value), stderr: "" };
}
