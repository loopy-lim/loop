import { expect, test } from "bun:test";
import { GatewayService } from "../src/service";
import { RunEventLog } from "../src/events";
import { FakeRuntime, makeSnapshot } from "./helpers";

test("reaper re-dispatches expired active leases but not live or attention runs", async () => {
  const runtime = new FakeRuntime();
  runtime.durableRuns = [{ runId: "orphan", state: "active" }, { runId: "live", state: "active" }, { runId: "held", state: "active" }];
  runtime.emit(makeSnapshot({ runId: "orphan", executionExpiresAt: 10 }));
  runtime.emit(makeSnapshot({ runId: "live", executionExpiresAt: 200 }));
  runtime.emit(makeSnapshot({ runId: "held", state: "attention" }));
  const calls: string[] = [];
  const service = new GatewayService({
    runtime, log: new RunEventLog(1, 100), planningLimit: 1, nowMs: () => 100,
    planner: { begin() {}, async recover(id) { calls.push(id); } },
  });
  await service.reapExpiredLeases();
  await Promise.resolve();
  expect(calls).toEqual(["orphan"]);
});

test("reaper retries after a failed hand-off and does not overlap a live attempt", async () => {
  const runtime = new FakeRuntime();
  runtime.durableRuns = [{ runId: "orphan", state: "active" }];
  runtime.emit(makeSnapshot({ runId: "orphan", executionExpiresAt: 10 }));
  let calls = 0;
  let rejectFirst!: (error: Error) => void;
  const service = new GatewayService({
    runtime, log: new RunEventLog(1, 100), planningLimit: 1, nowMs: () => 100,
    planner: { begin() {}, recover() { calls++; return calls === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : Promise.resolve(); } },
  });
  await service.reapExpiredLeases();
  expect(calls).toBe(1);
  rejectFirst(new Error("store unavailable"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await service.reapExpiredLeases();
  expect(calls).toBe(2);
});
