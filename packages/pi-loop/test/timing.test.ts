import { expect, test } from "bun:test";

import { LeadTiming, formatFinalTiming, formatHandoffTiming } from "../src/lead/timing";

test("measures one request through confirmed handoff and final display", () => {
  let now = 0;
  const timing = new LeadTiming(() => now);
  timing.beginTurn();
  now = 7_000;
  timing.beginSubmission("run-a");
  now = 7_200;
  const handoff = timing.confirmHandoff("run-a");
  expect(handoff).toMatchObject({ runId: "run-a", requestToHandoffMs: 7_200, submissionToHandoffMs: 200 });
  expect(timing.confirmHandoff("run-a")).toEqual(handoff);
  expect(formatHandoffTiming(handoff)).toBe("요청→인계 7.2초");

  now = 20_000;
  const final = timing.finishDisplay("run-a");
  expect(final).toMatchObject({ runId: "run-a", requestToResultMs: 20_000, handoffToResultMs: 12_800 });
  expect(formatFinalTiming(final)).toBe("요청→결과 20.0초");
  expect(timing.finishDisplay("run-a")).toBeUndefined();
});

test("a submission without a turn reports only measured phases", () => {
  let now = 1_000;
  const timing = new LeadTiming(() => now);
  timing.beginSubmission("run-a");
  now = 1_200;
  const handoff = timing.confirmHandoff("run-a");
  expect(handoff?.requestToHandoffMs).toBeUndefined();
  expect(formatHandoffTiming(handoff)).toBe("도구→인계 0.2초");
  now = 2_400;
  const final = timing.finishDisplay("run-a");
  expect(final?.requestToResultMs).toBeUndefined();
  expect(formatFinalTiming(final)).toBe("인계→결과 1.2초");
});

test("non-run turns, failed handoffs, and missing phases stay unmeasured", () => {
  let now = 0;
  const timing = new LeadTiming(() => now);
  timing.beginTurn();
  now = 100;
  timing.beginTurn();
  now = 200;
  timing.beginSubmission("failed");
  timing.forget("failed");
  expect(timing.confirmHandoff("failed")).toBeUndefined();
  expect(timing.finishDisplay("failed")).toBeUndefined();

  now = 300;
  timing.beginSubmission("restored");
  expect(timing.finishDisplay("restored")).toBeUndefined();
});

test("clock regression never produces a negative duration", () => {
  let now = 1_000;
  const timing = new LeadTiming(() => now);
  timing.beginTurn();
  now = 900;
  timing.beginSubmission("run-a");
  now = 950;
  const handoff = timing.confirmHandoff("run-a");
  expect(handoff?.requestToHandoffMs).toBeUndefined();
  expect(formatHandoffTiming(handoff)).toBe("도구→인계 0.1초");
  now = 800;
  const final = timing.finishDisplay("run-a");
  expect(final?.requestToResultMs).toBeUndefined();
  expect(formatFinalTiming(final)).toBeUndefined();
});
