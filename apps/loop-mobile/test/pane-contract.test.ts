/**
 * Terminal-mirror client contract tests (decision 2026-xx-terminal-mirror
 * M-TM2): pane inventory fetch, pane SSE subscribe → pane_text flow →
 * paneGone close, Last-Event-ID replay on pane streams, 404 pane_not_found
 * mapping, and the projection flow over the live client (list → subscribe →
 * dedupe → render state). All against the local mock gateway: no real
 * network, no paid model calls.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GatewayClient } from "../src/gateway-client/client";
import { GatewayError } from "../src/gateway-client/problem";
import { PaneProjection } from "../src/state/paneProjection";
import { createConnectionConfig } from "../src/auth/connection";
import { createMockGateway, type MockGateway } from "./mock-gateway";
import {
  PANE_FRAMES,
  PANE_GONE,
  PANE_ID,
  PANE_LIST,
  PANE_TEXT_1,
  PANE_TEXT_2,
  TOKEN,
} from "./fixtures";
import type { PaneStreamEvent } from "../src/gateway-client/wire";

let gateway: MockGateway;
let client: GatewayClient;

beforeAll(() => {
  gateway = createMockGateway();
  client = new GatewayClient(
    createConnectionConfig("127.0.0.1", gateway.url.split(":")[2]!, TOKEN),
  );
});

afterAll(() => {
  gateway.stop();
});

describe("GET /v1/panes", () => {
  test("returns the pane inventory in the wire shape", async () => {
    const page = await client.listPanes();
    expect(page).toEqual(PANE_LIST);
    expect(page.panes[0]).toMatchObject({ paneId: PANE_ID, state: "active" });
    // The lifecycle-only lane is marked by state, honestly (decision D1/D6).
    expect(page.panes[1]).toMatchObject({ paneId: "w1:pNoSrc", state: "unknown" });
  });
});

describe("GET /v1/panes/{paneId}/events", () => {
  test("subscribe flows pane_text frames in order, then paneGone closes", async () => {
    const events: PaneStreamEvent[] = [];
    await client.observePane(PANE_ID, (event) => events.push(event));

    const texts = events.filter((event) => event.kind === "pane_text");
    expect(texts).toHaveLength(2);
    expect(texts[0]).toEqual({ kind: "pane_text", frame: PANE_TEXT_1 });
    expect(texts[1]).toEqual({ kind: "pane_text", frame: PANE_TEXT_2 });
    // The gone reset terminates observation (client must not reconnect).
    expect(events.at(-1)).toEqual({ kind: "pane_reset", frame: PANE_GONE });
    expect(gateway.paneEventLastEventIds.at(-1)).toBeNull(); // fresh connection
  });

  test("replays after the Last-Event-ID cursor on reconnect", async () => {
    const events: PaneStreamEvent[] = [];
    await client.observePane(PANE_ID, (event) => events.push(event), {
      lastEventId: String(PANE_TEXT_1.revision),
    });
    const texts = events.filter((event) => event.kind === "pane_text");
    expect(texts).toHaveLength(1); // only frames AFTER the cursor
    expect(texts[0]).toEqual({ kind: "pane_text", frame: PANE_TEXT_2 });
    expect(gateway.paneEventLastEventIds.at(-1)).toBe(String(PANE_TEXT_1.revision));
  });

  test("404 pane_not_found is a non-retryable GatewayError", async () => {
    let thrown: unknown = null;
    try {
      await client.observePane("w9:missing", () => undefined);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GatewayError);
    const problem = (thrown as GatewayError).problem;
    expect(problem.status).toBe(404);
    expect(problem.code).toBe("pane_not_found");
    expect(problem.retryable).toBe(false);
  });
});

describe("list → subscribe → project flow (decision D6)", () => {
  test("a PaneProjection fed by the live client dedupes and converges", async () => {
    const projection = new PaneProjection(PANE_ID);
    const summary = PANE_FRAMES.list.panes[0]!;
    projection.applySummary(summary);

    const seen: string[] = [];
    await client.observePane(PANE_ID, (event) => {
      if (event.kind === "pane_text") {
        const applied = projection.applyText(event.frame);
        if (applied) seen.push(event.frame.revision);
      } else {
        projection.applyReset(event.frame);
      }
    });

    expect(seen).toEqual(["7", "8"]); // no duplicate revisions applied
    const view = projection.snapshot();
    expect(view.gone).toBe(true);
    expect(view.label).toBe("pi worker — loop");
    expect(view.state).toBe("active");
    expect(view.revision).toBe("8");
  });
});
