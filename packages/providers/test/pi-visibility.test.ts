import { expect, test, afterEach } from "bun:test";
import { HerdrWorkerRuntime, type HerdrRunner, type HerdrResult } from "@loop/herdr";
import { HerdrAgentProvider } from "../src/herdr-agent";

function scriptedRunner(): HerdrRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(_command: string, args: string[]): Promise<HerdrResult> {
      calls.push(args);
      if (args[0] === "tab" && args[1] === "create") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ result: { tab: { tab_id: "caller-ws:t-new" }, root_pane: { pane_id: "caller-ws:p-new" } } }),
          stderr: "",
        };
      }
      if (args[0] === "agent" && args[1] === "start") {
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }
      if (args[0] === "agent" && args[1] === "prompt") {
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }
      if (args[0] === "tab" && args[1] === "close") {
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }
      if (args[0] === "agent" && args[1] === "get") {
        // Mock status to satisfy release() waiting for result
        return {
          exitCode: 0,
          stdout: JSON.stringify({ result: { agent: { state: "completed" } } }),
          stderr: "",
        };
      }
      if (args[0] === "pane" && args[1] === "rename") {
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }
      if (args[0] === "agent" && args[1] === "read") {
        return { exitCode: 0, stdout: "mock result", stderr: "" };
      }
      throw new Error(`Unexpected call: ${args.join(" ")}`);
    },
  };
}

const origWsId = process.env.HERDR_WORKSPACE_ID;
const origPaneId = process.env.HERDR_PANE_ID;

afterEach(() => {
  if (origWsId !== undefined) process.env.HERDR_WORKSPACE_ID = origWsId;
  else delete process.env.HERDR_WORKSPACE_ID;
  if (origPaneId !== undefined) process.env.HERDR_PANE_ID = origPaneId;
  else delete process.env.HERDR_PANE_ID;
});

test("pi worker routes to caller workspace instead of creating a headless one", async () => {
  process.env.HERDR_WORKSPACE_ID = "caller-ws";
  process.env.HERDR_PANE_ID = "caller-ws:p1";
  
  const runner = scriptedRunner();
  const runtime = new HerdrWorkerRuntime({ runner });
  const provider = new HerdrAgentProvider({
    id: "test-pi",
    runtime,
    kind: "pi",
    projectRoot: "/project",
    computeClasses: [],
  });

  const worker = await provider.start({
    runId: "run-test",
    taskId: "task-test",
    title: "Test Task",
    kind: "task",
    computeClass: "fast",
    attempt: 0,
    requirements: [],
    workingDirectory: "/project",
  });

  expect(worker.id).toBe("loop-run-test-task-test");

  expect(runner.calls.slice(0, 4)).toEqual([
    ["tab", "create", "--workspace", "caller-ws", "--cwd", "/project", "--label", "task-test·task·a0", "--no-focus"],
    ["pane", "rename", "caller-ws:p-new", "task-test·task·a0"],
    ["agent", "start", "loop-run-test-task-test", "--kind", "pi", "--pane", "caller-ws:p-new"],
    ["agent", "prompt", "loop-run-test-task-test", "Loop worker task\n\ntitle=Test Task\nkind=task\nattempt=0"]
  ]);
  
  await provider.release!(worker.id);
  expect(runner.calls.at(-1)).toEqual(["tab", "close", "caller-ws:t-new"]);
});
