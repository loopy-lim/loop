import { expect, test } from "bun:test";
import type { EventOutput } from "@loop/protocol";
import { guidanceStatus } from "../src/guidance-status";

function event(sequence: number, type: string, data: Record<string, unknown>): EventOutput {
  return { sequence, payloadJson: JSON.stringify({ run_id: "run-1", kind: { type, data } }) };
}

test("guidance view separates recording and worker delivery without exposing message text", () => {
  const statuses = guidanceStatus(
    [
      event(4, "guidance_added", { task_id: "impl", message: "private correction text" }),
      event(5, "guidance_added", { task_id: "impl", message: "second correction" }),
      event(6, "guidance_delivered", {
        task_id: "impl",
        worker_id: "worker-1",
        through_sequence: 4,
      }),
    ],
    "impl",
  );

  expect(statuses).toEqual([
    { sequence: 4, taskId: "impl", state: "delivered" },
    { sequence: 5, taskId: "impl", state: "recorded" },
  ]);
  expect(JSON.stringify(statuses)).not.toContain("private correction text");
  expect(JSON.stringify(statuses)).not.toContain("second correction");
});

test("run-wide guidance is shown for the selected task and later watermark applies after replay", () => {
  const statuses = guidanceStatus(
    [
      event(2, "guidance_delivered", {
        task_id: "impl",
        worker_id: "worker-1",
        through_sequence: 7,
      }),
      event(3, "guidance_added", { task_id: null, message: "all tasks" }),
      event(8, "guidance_added", { task_id: "other", message: "not impl" }),
    ],
    "impl",
  );
  expect(statuses).toEqual([{ sequence: 3, taskId: null, state: "delivered" }]);
});

test("a delivered correction is checked only after stable-source receipts and a later verification pass", () => {
  const events = [
    event(4, "guidance_added", { task_id: "impl", message: "change criterion" }),
    event(5, "guidance_delivered", { task_id: "impl", worker_id: "w1", through_sequence: 4 }),
    event(6, "check_receipts_recorded", {
      task_id: "impl",
      checks: [{ id: "unit", source: { beforeFingerprint: "same", afterFingerprint: "same" } }],
    }),
    event(7, "verification_passed", { task_id: "impl" }),
  ];
  expect(guidanceStatus(events, "impl")).toEqual([
    { sequence: 4, taskId: "impl", state: "checked" },
  ]);
  expect(guidanceStatus([events[0]!, events[2]!, events[3]!, events[1]!], "impl")).toEqual([
    { sequence: 4, taskId: "impl", state: "checked" },
  ]);
  expect(guidanceStatus(events.slice(0, 3), "impl")[0]?.state).toBe("delivered");
  expect(
    guidanceStatus(
      [
        events[0]!,
        events[1]!,
        event(6, "check_receipts_recorded", { task_id: "impl", checks: [{ id: "unit" }] }),
        events[3]!,
      ],
      "impl",
    )[0]?.state,
  ).toBe("delivered");
});
