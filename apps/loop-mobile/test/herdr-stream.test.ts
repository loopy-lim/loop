/**
 * Herdr state stream contract (rebuild brief M2): intro delivery, live
 * convergence, clean-disconnect reconnect, backoff on retryable failures,
 * fatal on non-retryable problems, junk frames skipped. Stubbed streaming
 * fetch — no network.
 */

import { describe, expect, test } from "bun:test";

import { createConnectionConfig } from "../src/auth/connection";
import { observeHerdrState } from "../src/herdr/stream";
import type { FetchLike } from "../src/herdr/client";

const CONFIG = createConnectionConfig("gw.tailnet.ts.net", "18477", "");

function stateFrame(version: number, status: string): string {
  return `id: herdr-${version}\nevent: herdr_state\ndata: ${JSON.stringify({
    available: true,
    version,
    serverVersion: "0.9.5",
    protocol: 22,
    focused: { workspaceId: null, tabId: null, paneId: null },
    workspaces: [],
    tabs: [],
    panes: [
      {
        id: "w1:p1",
        workspaceId: "w1",
        tabId: "w1:t1",
        title: null,
        status,
        agent: "claude",
        cwd: "/tmp",
        revision: "1",
        focused: false,
      },
    ],
  })}\n\n`;
}

function sseFetch(pages: string[][]): FetchLike {
  let page = 0;
  return async (_input, init) => {
    const frames = pages[page];
    page += 1;
    if (frames === undefined) {
      // Past the scripted pages: hang until the test's abort, so the loop
      // stops reconnecting and each page is delivered exactly once.
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      });
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of frames) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
}

function problemFetch(status: number, retryable: boolean): FetchLike {
  return async () =>
    new Response(JSON.stringify({ code: status === 401 ? "unauthorized" : "problem", status, retryable }), {
      status,
    });
}

async function run(
  fetchImpl: FetchLike,
  onState: (state: { version: number }) => void,
  ticks = 2,
): Promise<void> {
  const controller = new AbortController();
  const finished = observeHerdrState({
    config: CONFIG,
    signal: controller.signal,
    fetchImpl,
    reconnectPauseMs: 5,
    onState: onState as never,
  });
  // Let the loop turn the requested number of times, then stop it.
  for (let i = 0; i < ticks; i++) {
    await Bun.sleep(60);
  }
  controller.abort();
  await finished;
}

describe("observeHerdrState", () => {
  test("delivers intro and push frames", async () => {
    const seen: number[] = [];
    await run(sseFetch([[stateFrame(1, "working"), stateFrame(2, "done")]]), (state) => seen.push(state.version), 1);
    expect(seen).toEqual([1, 2]);
  });

  test("skips junk and foreign frames", async () => {
    const seen: number[] = [];
    await run(
      sseFetch([["event: herdr_state\ndata: not-json\n\n", "event: keepalive\ndata: {}\n\n", stateFrame(7, "idle")]]),
      (state) => seen.push(state.version),
      1,
    );
    expect(seen).toEqual([7]);
  });

  test("reconnects after a clean disconnect and lives on", async () => {
    const seen: number[] = [];
    // Page 1 closes after version 1; page 2 (the reconnect) opens on version 2.
    await run(sseFetch([[stateFrame(1, "working")], [stateFrame(2, "idle")]]), (state) => seen.push(state.version), 2);
    expect(seen).toEqual([1, 2]);
  });

  test("a non-retryable problem ends the stream via onError", async () => {
    const errors: number[] = [];
    const controller = new AbortController();
    const finished = observeHerdrState({
      config: CONFIG,
      signal: controller.signal,
      fetchImpl: problemFetch(401, false),
      onState: () => {},
      onError: (error) => errors.push(error.problem.status),
    });
    await finished;
    controller.abort();
    expect(errors).toEqual([401]);
  });
});
