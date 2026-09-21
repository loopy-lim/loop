import { describe, expect, test } from "bun:test";

import {
  HerdrLifecycleReporter,
  registerHerdrLifecycle,
  type HerdrLifecycleState,
} from "../src/herdr-lifecycle";

function insideHerdr(overrides: Record<string, string> = {}) {
  return {
    HERDR_ENV: "1",
    HERDR_PANE_ID: "w1:p1",
    HERDR_BIN_PATH: "/usr/local/bin/herdr",
    ...overrides,
  };
}

describe("HerdrLifecycleReporter", () => {
  test("makes no calls outside Herdr", async () => {
    const calls: string[][] = [];
    const reporter = new HerdrLifecycleReporter({
      environment: {},
      runner: async (args) => {
        calls.push(args);
      },
    });
    await reporter.report("idle");
    await reporter.report("working");
    await reporter.release();
    expect(calls).toEqual([]);
  });

  test("uses monotonic seq values and argv-only report/release inside Herdr", async () => {
    const calls: string[][] = [];
    const reporter = new HerdrLifecycleReporter({
      environment: insideHerdr(),
      runner: async (args) => {
        calls.push(args);
      },
    });
    await reporter.report("idle");
    await reporter.report("working");
    await reporter.report("idle");
    await reporter.release();

    expect(calls).toHaveLength(4);
    for (const args of calls) {
      expect(args).not.toContain("-c");
      expect(args[0]).toBe("/usr/local/bin/herdr");
    }
    const seqs = calls
      .filter((args) => args.includes("report-agent"))
      .map((args) => Number(args[args.indexOf("--seq") + 1]));
    expect(seqs).toEqual([0, 1, 2]);
    expect(calls[3].slice(1)).toEqual([
      "pane",
      "release-agent",
      "--pane",
      "w1:p1",
      "--source",
      "loop:lead",
      "--agent",
      "loop",
    ]);
  });

  test("reports idle on session start and end, working on agent start, release on shutdown", async () => {
    const states: (HerdrLifecycleState | "release")[] = [];
    const reporter: HerdrLifecycleReporter = new HerdrLifecycleReporter({
      environment: insideHerdr(),
      runner: async (args) => {
        states.push(args.includes("release-agent") ? "release" : (args[args.indexOf("--state") + 1] as HerdrLifecycleState));
      },
    });
    const handlers = new Map<string, () => Promise<void> | void>();
    registerHerdrLifecycle(
      {
        on(event, handler) {
          handlers.set(event, handler);
        },
      },
      reporter,
    );
    await handlers.get("session_start")?.();
    await handlers.get("agent_start")?.();
    await handlers.get("agent_end")?.();
    await handlers.get("session_shutdown")?.();

    expect(states).toEqual(["idle", "working", "idle", "release"]);
  });
});
