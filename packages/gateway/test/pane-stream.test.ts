/**
 * Terminal mirror v1 — pane SSE surface (decision 2026-xx-terminal-mirror
 * M-TM1). All cases run against a FakePaneSource: no herdr socket, no paid
 * model calls. Covered: inventory + unobserved marking, revision dedupe,
 * inter-tick coalescing, cursor replay/reset convergence, pane_gone
 * termination, per-frame truncation, credential redaction, and fail-closed
 * behavior when the observation source is unavailable.
 */

import { describe, expect, test } from "bun:test";

import { authHeader, bootTestGateway, makePane, type TestGateway } from "./helpers";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

function paneGateway(overrides?: Parameters<typeof bootTestGateway>[0]): TestGateway & {
  paneSource: NonNullable<TestGateway["paneSource"]>;
  panes: NonNullable<TestGateway["panes"]>;
} {
  const gateway = bootTestGateway({ ...overrides, pane: overrides?.pane ?? {} });
  return gateway as never;
}

async function openPaneStream(
  gateway: TestGateway,
  paneId: string,
  lastEventId?: string,
): Promise<Response> {
  return fetch(`${gateway.baseUrl}/v1/panes/${encodeURIComponent(paneId)}/events`, {
    headers: {
      Accept: "text/event-stream",
      ...authHeader(gateway.token()),
      ...(lastEventId === undefined ? {} : { "Last-Event-ID": lastEventId }),
    },
  });
}

async function readRaw(response: Response, deadlineMs = 1_500): Promise<string> {
  const reader = must(response.body?.getReader());
  const decoder = new TextDecoder();
  let raw = "";
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || raw.includes("pane_reset")) break;
    const chunk = await Promise.race([
      reader.read(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remaining)),
    ]);
    if (chunk === "timeout" || chunk.done) break;
    raw += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return raw;
}

type RawFrame = { id: string | null; event: string; data: unknown };

function parsePaneFrames(raw: string): RawFrame[] {
  const frames: RawFrame[] = [];
  for (const block of raw.split("\n\n")) {
    if (block.trim().length === 0) continue;
    let id: string | null = null;
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("id: ")) id = line.slice(4);
      else if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    frames.push({ id, event, data: data.length > 0 ? JSON.parse(data) : null });
  }
  return frames;
}

describe("GET /v1/panes", () => {
  test("returns the observation inventory in the generated wire shape", async () => {
    const gateway = paneGateway();
    try {
      gateway.paneSource.panes = [
        makePane({
          paneId: "w1:p1",
          label: "worker-1",
          taskId: "task-1",
          workspaceId: "w1",
          state: "active",
        }),
        makePane({ paneId: "w1:p2", workspaceId: "w1", state: "unknown" }),
      ];
      gateway.paneSource.setReading("w1:p1", 3, "hello");
      await gateway.panes?.tick();

      const response = await fetch(`${gateway.baseUrl}/v1/panes`, {
        headers: { ...authHeader(gateway.token()) },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { panes: { paneId: string; state: string }[] };
      expect(body.panes).toHaveLength(2);
      expect(body.panes[0]).toMatchObject({
        paneId: "w1:p1",
        label: "worker-1",
        taskId: "task-1",
        workspaceId: "w1",
        state: "active",
      });
    } finally {
      gateway.stop();
    }
  });

  test("marks over-cap panes unobserved in the inventory only (decision D5)", async () => {
    const gateway = paneGateway({ pane: { maxObservedPanes: 1 } });
    try {
      gateway.paneSource.panes = [
        makePane({ paneId: "w1:p1", workspaceId: "w1", state: "active" }),
        makePane({ paneId: "w1:p2", workspaceId: "w1", state: "idle" }),
      ];
      await gateway.panes?.tick();

      const response = await fetch(`${gateway.baseUrl}/v1/panes`, {
        headers: { ...authHeader(gateway.token()) },
      });
      const body = (await response.json()) as { panes: { paneId: string; state: string }[] };
      expect(body.panes.find((pane) => pane.paneId === "w1:p1")?.state).toBe("active");
      expect(body.panes.find((pane) => pane.paneId === "w1:p2")?.state).toBe("unobserved");
    } finally {
      gateway.stop();
    }
  });

  test("fail-closed: unavailable source degrades to an empty inventory", async () => {
    const gateway = paneGateway();
    try {
      gateway.paneSource.unavailable = true;
      await gateway.panes?.tick();
      const response = await fetch(`${gateway.baseUrl}/v1/panes`, {
        headers: { ...authHeader(gateway.token()) },
      });
      expect(await response.json()).toEqual({ panes: [] });
    } finally {
      gateway.stop();
    }
  });
});

describe("GET /v1/panes/{paneId}/events", () => {
  test("406 without SSE accept; 404 pane_not_found for unknown panes", async () => {
    const gateway = paneGateway();
    try {
      const noSse = await fetch(`${gateway.baseUrl}/v1/panes/w1:p1/events`, {
        headers: { ...authHeader(gateway.token()) },
      });
      expect(noSse.status).toBe(406);

      const unknown = await openPaneStream(gateway, "w1:missing");
      expect(unknown.status).toBe(404);
      const problem = (await unknown.json()) as { code: string };
      expect(problem.code).toBe("pane_not_found");
    } finally {
      gateway.stop();
    }
  });

  test("404 when the gateway has no pane surface configured", async () => {
    const gateway = bootTestGateway();
    try {
      const response = await fetch(`${gateway.baseUrl}/v1/panes`, {
        headers: { ...authHeader(gateway.token()) },
      });
      expect(response.status).toBe(404);
    } finally {
      gateway.stop();
    }
  });

  test("fresh connection replays the buffered history, then flows live", async () => {
    const gateway = paneGateway();
    try {
      gateway.paneSource.panes = [
        makePane({ paneId: "w1:p1", workspaceId: "w1", state: "active" }),
      ];
      gateway.paneSource.setReading("w1:p1", 1, "first");
      await gateway.panes?.tick();
      gateway.paneSource.setReading("w1:p1", 2, "second");
      await gateway.panes?.tick();

      const response = await openPaneStream(gateway, "w1:p1");
      const frames = parsePaneFrames(await readRaw(response));
      const texts = frames.filter((frame) => frame.event === "pane_text");
      expect(texts).toHaveLength(2);
      expect(texts[0]?.data).toMatchObject({
        paneId: "w1:p1",
        revision: "1",
        text: "first",
        truncated: false,
      });
      expect(texts[1]?.data).toMatchObject({ paneId: "w1:p1", revision: "2", text: "second" });
      // Wire contract: revision is a decimal string (ADR §4.1 u64 rule).
      expect(typeof (texts[0]?.data as { revision: unknown } | undefined)?.revision).toBe("string");
    } finally {
      gateway.stop();
    }
  });

  test("revision dedupe: same revision never re-frames; a bump frames exactly once", async () => {
    const gateway = paneGateway();
    try {
      gateway.paneSource.panes = [
        makePane({ paneId: "w1:p1", workspaceId: "w1", state: "active" }),
      ];
      gateway.paneSource.setReading("w1:p1", 5, "same text");
      await gateway.panes?.tick();
      await gateway.panes?.tick(); // same revision: no frame
      gateway.paneSource.setReading("w1:p1", 6, "same text but changed");
      await gateway.panes?.tick();

      const observation = gateway.panes?.observePane("w1:p1", null);
      const texts = observation.intro.filter((frame) => frame.event === "pane_text");
      expect(texts).toHaveLength(2);
      expect((texts[0]?.data as { revision: string } | undefined)?.revision).toBe("5");
      expect((texts[1]?.data as { revision: string } | undefined)?.revision).toBe("6");
    } finally {
      gateway.stop();
    }
  });

  test("coalescing: two source changes between ticks produce exactly one frame with the latest snapshot", async () => {
    const gateway = paneGateway();
    try {
      gateway.paneSource.panes = [
        makePane({ paneId: "w1:p1", workspaceId: "w1", state: "active" }),
      ];
      gateway.paneSource.setReading("w1:p1", 1, "v1");
      await gateway.panes?.tick();

      // Both changes land before the next tick: only the latest survives.
      gateway.paneSource.setReading("w1:p1", 2, "v2 (lost)");
      gateway.paneSource.setReading("w1:p1", 3, "v3 (kept)");
      await gateway.panes?.tick();

      const observation = gateway.panes?.observePane("w1:p1", null);
      const texts = observation.intro.filter((frame) => frame.event === "pane_text");
      expect(texts).toHaveLength(2);
      expect((texts[1]?.data as { revision: string; text: string } | undefined)?.revision).toBe("3");
      expect((texts[1]?.data as { revision: string; text: string } | undefined)?.text).toBe("v3 (kept)");
      expect(JSON.stringify(observation.intro)).not.toContain("v2 (lost)");
    } finally {
      gateway.stop();
    }
  });

  test("cursor replay: Last-Event-ID resumes exactly after the cursor; bad cursors reset first", async () => {
    const gateway = paneGateway();
    try {
      gateway.paneSource.panes = [
        makePane({ paneId: "w1:p1", workspaceId: "w1", state: "active" }),
      ];
      gateway.paneSource.setReading("w1:p1", 1, "one");
      await gateway.panes?.tick();
      gateway.paneSource.setReading("w1:p1", 2, "two");
      await gateway.panes?.tick();
      gateway.paneSource.setReading("w1:p1", 3, "three");
      await gateway.panes?.tick();

      const head = gateway.panes?.observePane("w1:p1", null);
      const firstFrameId = head.intro[0]?.id;

      const resume = await openPaneStream(gateway, "w1:p1", firstFrameId);
      const replayed = parsePaneFrames(await readRaw(resume)).filter(
        (frame) => frame.event === "pane_text",
      );
      expect(replayed.map((frame) => (frame.data as { revision: string }).revision)).toEqual([
        "2",
        "3",
      ]);

      const stale = await openPaneStream(gateway, "w1:p1", "garbage-cursor");
      const staleFrames = parsePaneFrames(await readRaw(stale));
      expect(staleFrames[0]?.event).toBe("pane_reset");
      expect(staleFrames[0]?.data).toMatchObject({
        paneId: "w1:p1",
        reason: "cursorUnavailable",
        revision: "3",
        text: "three",
      });
    } finally {
      gateway.stop();
    }
  });

  test("pane_gone: live subscribers get one pane_reset(paneGone) and the stream closes; reconnects converge", async () => {
    const gateway = paneGateway();
    try {
      gateway.paneSource.panes = [
        makePane({ paneId: "w1:p1", workspaceId: "w1", state: "active" }),
      ];
      gateway.paneSource.setReading("w1:p1", 1, "before death");
      await gateway.panes?.tick();

      const response = await openPaneStream(gateway, "w1:p1");
      // Read intro frame, observe the pane's death, read until the reset.
      let raw = "";
      {
        const reader = must(response.body?.getReader());
        const decoder = new TextDecoder();
        raw += decoder.decode((await reader.read()).value ?? new Uint8Array(), { stream: true });
        expect(raw).toContain("pane_text");

        gateway.paneSource.panes = []; // pane disappeared
        await gateway.panes?.tick();

        raw += await new Promise<string>((resolve) => {
          const deadline = Date.now() + 1_500;
          const step = async () => {
            const chunk = await Promise.race([
              reader.read(),
              new Promise<"timeout">((r) => setTimeout(() => r("timeout" as const), 400)),
            ]);
            if (chunk === "timeout" || chunk.done) return resolve("");
            const text = decoder.decode(chunk.value, { stream: true });
            if (text.includes("pane_reset") || Date.now() > deadline) return resolve(text);
            step();
          };
          void step();
        });
        await reader.cancel().catch(() => undefined);
      }
      const frames = parsePaneFrames(raw);
      const resets = frames.filter((frame) => frame.event === "pane_reset");
      expect(resets).toHaveLength(1);
      expect(resets[0]?.data).toMatchObject({
        paneId: "w1:p1",
        reason: "paneGone",
        text: "before death",
      });

      // Reconnect after death: bounded history, then the same reset, then close.
      const reconnect = await openPaneStream(gateway, "w1:p1");
      expect(reconnect.headers.get("content-type")).toContain("text/event-stream");
      const after = parsePaneFrames(await readRaw(reconnect));
      expect(after.some((frame) => frame.event === "pane_text")).toBe(true);
      const goneFrames = after.filter((frame) => frame.event === "pane_reset");
      expect(goneFrames).toHaveLength(1);
      expect(goneFrames[0]?.data).toMatchObject({ reason: "paneGone" });
    } finally {
      gateway.stop();
    }
  });

  test("over-cap snapshots are truncated with truncated: true (decision D5)", async () => {
    const gateway = paneGateway({ pane: { maxFrameBytes: 64 } });
    try {
      gateway.paneSource.panes = [
        makePane({ paneId: "w1:p1", workspaceId: "w1", state: "active" }),
      ];
      gateway.paneSource.setReading("w1:p1", 1, "x".repeat(1_000));
      await gateway.panes?.tick();

      const observation = gateway.panes?.observePane("w1:p1", null);
      const frame = must(observation.intro[0]);
      const data = frame.data as { text: string; truncated: boolean };
      expect(data.truncated).toBe(true);
      expect(Buffer.byteLength(data.text, "utf8")).toBeLessThanOrEqual(64);
    } finally {
      gateway.stop();
    }
  });

  test("credential-bearing pane text leaves as [credential]=[redacted]", async () => {
    const gateway = paneGateway();
    try {
      gateway.paneSource.panes = [
        makePane({ paneId: "w1:p1", workspaceId: "w1", state: "active" }),
      ];
      gateway.paneSource.setReading("w1:p1", 1, "deploy with --api-key sk-live-abc123 done");
      await gateway.panes?.tick();

      const observation = gateway.panes?.observePane("w1:p1", null);
      const data = observation.intro[0]?.data as { text: string };
      expect(data.text).toContain("[credential]=[redacted]");
      expect(data.text).not.toContain("sk-live-abc123");
    } finally {
      gateway.stop();
    }
  });
});
