import { expect, test } from "bun:test";
import { orchestratorPlanner } from "../src/planner";

test("failed execution hand-off retries after the old lease expires", async () => {
  const calls: string[] = [];
  let retried!: () => void;
  const retry = new Promise<void>((resolve) => { retried = resolve; });
  const planner = orchestratorPlanner({
    workingDirectory: "/tmp",
    execution: {
      async prepare() { calls.push("prepare"); },
      async execute(id) {
        calls.push(id);
        if (calls.filter((call) => call === id).length === 1) throw new Error("owner lost");
        retried();
      },
    },
  });
  planner.begin({ runId: "run-retry", prompt: "retry", clientContext: null }, {
    markPlanning() {}, planningFailed() {},
  });
  await Promise.race([retry, new Promise((_, reject) => setTimeout(() => reject(new Error("retry timed out")), 7_000))]);
  expect(calls).toEqual(["prepare", "run-retry", "run-retry"]);
}, 10_000);
