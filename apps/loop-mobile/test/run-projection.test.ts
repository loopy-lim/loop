/**
 * Unit tests for the run projection reducer (ADR §5.3 semantics):
 * authoritative replacement on status, activityId dedupe, reset stale-marking,
 * and terminal termination.
 */

import { describe, expect, test } from "bun:test";

import { RunProjection } from "../src/state/runProjection";
import type { RemoteRunStatusEvent } from "../src/gateway-client/wire";
import {
  OUTPUT_FRAME_1,
  OUTPUT_FRAME_2,
  RESET_FRAME,
  RUN,
  RUN_ID,
  STATUS_FRAME,
  TERMINAL_FRAME,
} from "./fixtures";

describe("RunProjection", () => {
  test("status replaces the authoritative run projection", () => {
    const projection = new RunProjection(RUN_ID);
    expect(projection.snapshot().run).toBeNull();

    projection.applyStatus(STATUS_FRAME);
    expect(projection.snapshot().run?.status).toBe("running");
    expect(projection.snapshot().stale).toBe(false);
  });

  test("output is appended in order and deduped by activityId", () => {
    const projection = new RunProjection(RUN_ID);
    projection.applyStatus(STATUS_FRAME);
    projection.applyOutput(OUTPUT_FRAME_1);
    projection.applyOutput(OUTPUT_FRAME_2);
    projection.applyOutput(OUTPUT_FRAME_1); // duplicate delivery

    const outputs = projection.snapshot().outputs;
    expect(outputs.map((o) => o.activityId)).toEqual(["57:gateway-app:3", "57:gateway-app:4"]);
    expect(outputs[0]?.text).toBe("gateway listening on tailnet");
  });

  test("reset replaces the run and marks prior output as a previous observation", () => {
    const projection = new RunProjection(RUN_ID);
    projection.applyStatus(STATUS_FRAME);
    projection.applyOutput(OUTPUT_FRAME_1);
    projection.applyReset(RESET_FRAME);

    const state = projection.snapshot();
    expect(state.stale).toBe(true);
    expect(state.run?.status).toBe("running"); // authoritative run wins
    expect(state.outputs).toHaveLength(1); // kept as previous observation
  });

  test("status after reset restores continuity", () => {
    const projection = new RunProjection(RUN_ID);
    projection.applyReset(RESET_FRAME);
    projection.applyStatus(STATUS_FRAME);
    expect(projection.snapshot().stale).toBe(false);
  });

  test("a status frame carrying attention null releases the open attention", () => {
    // Gateway release contract: resolving attention is announced on the same
    // stream as a `status` frame whose run projection has `attention: null`.
    const openFrame: RemoteRunStatusEvent = { ...STATUS_FRAME, run: RUN };
    const releasedFrame: RemoteRunStatusEvent = {
      ...STATUS_FRAME,
      run: {
        ...RUN,
        status: "running",
        taskCounts: { ...RUN.taskCounts, attention: 0 },
        attention: null,
      },
    };

    const projection = new RunProjection(RUN_ID);
    projection.applyStatus(openFrame);
    expect(projection.snapshot().run?.attention?.attentionId).toBe("attn_01JMOBILEFIXTURE0001");

    projection.applyStatus(releasedFrame);
    expect(projection.snapshot().run?.attention).toBeNull();
    expect(projection.snapshot().run?.status).toBe("running");
  });

  test("terminal replaces the run and marks the projection terminal", () => {
    const projection = new RunProjection(RUN_ID);
    projection.applyStatus(STATUS_FRAME);
    projection.applyOutput(OUTPUT_FRAME_1);
    projection.applyTerminal(TERMINAL_FRAME);

    const state = projection.snapshot();
    expect(state.terminal).toBe(true);
    expect(state.run?.terminal).toBe(true);
    expect(state.run?.status).toBe("completed");
    expect(state.stale).toBe(false);
  });

  test("rejects events for a different run", () => {
    const projection = new RunProjection("run_other");
    expect(() => projection.applyStatus(STATUS_FRAME)).toThrow(/run_other/);
  });
});
