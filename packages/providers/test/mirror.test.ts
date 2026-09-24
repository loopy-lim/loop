import { describe, expect, test } from "bun:test";

import {
  HerdrWorkerRuntime,
  encodeDisplayFrame,
  parsePaneLine,
  type HerdrCaller,
  type HerdrRunner,
  type HerdrResult,
} from "@loop/herdr";

import {
  FakeProvider,
  MirroringProvider,
  PaneMirrorSink,
  compositeSink,
  renderProviderEvent,
  type MirrorSink,
  type MirrorSinkWorkerStartInfo,
  type PaneMirrorHost,
  type ProviderEvent,
} from "../src";
import type { StartWorkerInput } from "../src/types";

/** FakeProvider subclass with an injectable event stream (scripted adapters). */
class StreamedProvider extends FakeProvider {
  readonly listeners = new Set<(event: ProviderEvent) => void>();
  released = 0;

  subscribe(workerId: string, listener: (event: ProviderEvent) => void): () => void {
    void workerId;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: ProviderEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  release(workerId: string): Promise<void> {
    this.require(workerId);
    this.released += 1;
    return Promise.resolve();
  }
}

class RecordingSink implements MirrorSink {
  readonly lines: Array<{ workerId: string; line: string }> = [];
  readonly starts: MirrorSinkWorkerStartInfo[] = [];
  readonly finishes: string[] = [];

  async publish(workerId: string, line: string): Promise<void> {
    this.lines.push({ workerId, line });
  }

  async onWorkerStart(info: MirrorSinkWorkerStartInfo): Promise<void> {
    this.starts.push(info);
  }

  async onWorkerFinish(workerId: string): Promise<void> {
    this.finishes.push(workerId);
  }
}

function startInput(overrides: Partial<StartWorkerInput> = {}): StartWorkerInput {
  return {
    runId: "run-1",
    taskId: "t-1",
    title: "Task one",
    kind: "implementation",
    computeClass: "fast",
    attempt: 0,
    requirements: [],
    workingDirectory: "/tmp/worktree",
    ...overrides,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("renderProviderEvent", () => {
  test("codex JSONL items render as human lines", () => {
    const lines = renderProviderEvent({
      type: "output",
      stream: "stdout",
      text: [
        JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
        JSON.stringify({ type: "item.started", item: { type: "command_execution" } }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }),
        JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "bun test", exit_code: 0 } }),
      ].join("\n"),
    }, { family: "codex" });
    expect(lines).toEqual([
      "[thread] started: thread-1",
      "[item] started: command_execution",
      "[message] done",
      "[command] bun test (exit 0)",
    ]);
  });

  test("codex non-JSON lines pass through", () => {
    const lines = renderProviderEvent({ type: "output", stream: "stdout", text: "plain progress" }, { family: "codex" });
    expect(lines).toEqual(["plain progress"]);
  });

  test("agy deltas render as trimmed lines", () => {
    const lines = renderProviderEvent({ type: "output", stream: "stdout", text: "  step one  \nstep two\n" }, { family: "antigravity" });
    expect(lines).toEqual(["step one", "step two"]);
  });

  test("pi output is suppressed: lifecycle + final only (D2)", () => {
    const output = renderProviderEvent({ type: "output", stream: "stdout", text: "final text" }, { family: "pi" });
    const lifecycle = renderProviderEvent({ type: "lifecycle", status: "running" }, { family: "pi" });
    const final = renderProviderEvent({ type: "final", summary: "all done" }, { family: "pi" });
    expect(output).toEqual([]);
    expect(lifecycle).toEqual(["[lifecycle] running"]);
    expect(final).toEqual(["[result] all done"]);
  });

  test("lines are ANSI-stripped, redacted, and clamped", () => {
    const lines = renderProviderEvent({
      type: "output",
      stream: "stdout",
      text: "\u001b[31mapi_key = super-secret-value\u001b[0m",
    }, { lineTextLimit: 12 });
    expect(lines).toEqual(["[credential…"]);
  });
});

describe("MirroringProvider", () => {
  test("raw events pass through untouched while the sink gets rendered lines", async () => {
    const inner = new StreamedProvider("codex:test", ["fast"]);
    const sink = new RecordingSink();
    const provider = new MirroringProvider(inner, sink);
    const handle = await provider.start(startInput());

    const seen: ProviderEvent[] = [];
    provider.subscribe(handle.id, (event) => seen.push(event));
    const event: ProviderEvent = { type: "output", stream: "stdout", text: JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }) };
    inner.emit(event);

    expect(seen).toEqual([event]);
    // start() already queued its lifecycle line via fire-and-forget publish;
    // the rendered output line lands after it.
    expect(sink.lines.at(-1)).toEqual({ workerId: handle.id, line: "[message] done" });
  });

  test("worker start registers the sink and publishes a lifecycle line", async () => {
    const sink = new RecordingSink();
    const provider = new MirroringProvider(new StreamedProvider("codex:test", ["fast"]), sink);
    const handle = await provider.start(startInput());
    await sleep(0);

    expect(sink.starts).toEqual([{ providerId: "codex:test", workerId: handle.id, runId: "run-1", taskId: "t-1", worktree: "/tmp/worktree" }]);
    expect(sink.lines[0]).toEqual({ workerId: handle.id, line: "[lifecycle] starting t-1" });
  });

  test("machine result is returned unchanged and mirrored once, then the worker finishes", async () => {
    const inner = new StreamedProvider("codex:test", ["fast"], { delayMs: 1 });
    const sink = new RecordingSink();
    const provider = new MirroringProvider(inner, sink);
    const handle = await provider.start(startInput());

    const result = await provider.result(handle.id);
    await sleep(0);
    expect(result).toEqual({ success: true, summary: "t-1 complete" });
    expect(sink.finishes).toEqual([handle.id]);
    const lines = sink.lines.map((entry) => entry.line);
    expect(lines).toContain("[lifecycle] completed");
    expect(lines).toContain("[result] t-1 complete");
  });

  test("cancel and release notify the sink exactly once each", async () => {
    const inner = new StreamedProvider("codex:test", ["fast"]);
    const sink = new RecordingSink();
    const provider = new MirroringProvider(inner, sink);
    const handle = await provider.start(startInput());

    await provider.cancel(handle.id);
    expect(sink.finishes).toEqual([handle.id]);

    await provider.release(handle.id);
    expect(sink.finishes).toEqual([handle.id, handle.id]);
  });

  test("providers without subscribe stay silent but still mirror lifecycle", async () => {
    const sink = new RecordingSink();
    const provider = new MirroringProvider(new FakeProvider("fake", ["fast"]), sink);
    const unsubscribe = provider.subscribe("unknown", () => {
      throw new Error("must not be called");
    });
    unsubscribe();
    await provider.start(startInput());
    await sleep(0);
    expect(sink.lines.map((entry) => entry.line)).toEqual(["[lifecycle] starting t-1"]);
  });

  test("family is derived from the provider id", async () => {
    const inner = new StreamedProvider("pi:gpt-6-luna", ["fast"]);
    const sink = new RecordingSink();
    const provider = new MirroringProvider(inner, sink);
    const handle = await provider.start(startInput());
    provider.subscribe(handle.id, () => {});
    inner.emit({ type: "output", stream: "stdout", text: "only final text" });
    await sleep(0);
    expect(sink.lines.map((entry) => entry.line)).toEqual(["[lifecycle] starting t-1"]);
  });
});

describe("PaneMirrorSink", () => {
  interface PaneCall { args: string[] }

  function fakeHost() {
    const created: Array<{ tabId: string; paneId: string; label: string; worktree: string }> = [];
    const callers: Array<HerdrCaller | undefined> = [];
    const closed: string[] = [];
    const sent: Array<{ paneId: string; text: string }> = [];
    const hosted: Array<{ paneId: string; command: string; args: string[] }> = [];
    const relays: Array<{ paneId: string; exited: boolean }> = [];
    let failRunInPane = false;
    const host = {
      created,
      callers,
      closed,
      sent,
      hosted,
      relays,
      setFailRunInPane(value: boolean) {
        failRunInPane = value;
      },
      async createPane(runId: string, taskId: string, projectRoot: string, worktree: string, label: string, caller?: HerdrCaller) {
        callers.push(caller);
        const pane = { tabId: `tab-${created.length + 1}`, paneId: `pane-${created.length + 1}`, label, worktree };
        void runId; void taskId; void projectRoot;
        created.push(pane);
        return pane;
      },
      async closePane(tabId: string) {
        closed.push(tabId);
        // Hosting model: closing the pane ends the relay process hosted in it.
        const paneId = created.find((pane) => pane.tabId === tabId)?.paneId;
        for (const relay of relays) {
          if (relay.paneId === paneId) relay.exited = true;
        }
      },
      async sendText(paneId: string, text: string) {
        sent.push({ paneId, text });
      },
      async runInPane(paneId: string, command: string, args: string[]) {
        if (failRunInPane) throw new Error("pane run failed");
        hosted.push({ paneId, command, args });
        relays.push({ paneId, exited: false });
      },
    };
    return host;
  }

  const herdrEnv = { HERDR_WORKSPACE_ID: "ws-1", HERDR_PANE_ID: "ws-1:p-main" };

  test("mirror panes are anchored to the caller workspace derived from HERDR_PANE_ID", async () => {
    const host = fakeHost();
    const sink = new PaneMirrorSink({
      host,
      projectRoot: "/project",
      environment: { HERDR_PANE_ID: "ws-lead:p-9" },
      intervalMs: 5,
    });
    await sink.onWorkerStart({ providerId: "codex:x", workerId: "w1", runId: "run", taskId: "t-1" });

    expect(host.callers).toEqual([{ workspaceId: "ws-lead", paneId: "ws-lead:p-9" }]);
    expect(host.created).toHaveLength(1);
  });

  test("without HERDR_PANE_ID the sink propagates no caller (loop-<runId> fallback in the host)", async () => {
    const host = fakeHost();
    // HERDR_WORKSPACE_ID only gates sink activity; it is never a placement anchor.
    const sink = new PaneMirrorSink({
      host,
      projectRoot: "/project",
      environment: { HERDR_WORKSPACE_ID: "ws-1" },
      intervalMs: 5,
    });
    await sink.onWorkerStart({ providerId: "codex:x", workerId: "w1", runId: "run", taskId: "t-1" });

    expect(host.callers).toEqual([undefined]);
    expect(host.created).toHaveLength(1);
  });

  test("headless environments never create panes (fail-open)", async () => {
    const host = fakeHost();
    const sink = new PaneMirrorSink({ host, projectRoot: "/project", environment: {} });
    await sink.onWorkerStart({ providerId: "codex:x", workerId: "w1", runId: "run", taskId: "t-1" });
    await sink.publish("w1", "[lifecycle] starting t-1");
    await sink.onWorkerFinish("w1");
    expect(host.created).toEqual([]);
    expect(host.sent).toEqual([]);
    expect(host.closed).toEqual([]);
  });

  test("pane is created on start, receives flushed lines, and closes on finish", async () => {
    const host = fakeHost();
    const sink = new PaneMirrorSink({ host, projectRoot: "/project", environment: herdrEnv, intervalMs: 5 });
    await sink.onWorkerStart({ providerId: "codex:x", workerId: "w1", runId: "run", taskId: "t-1", worktree: "/project/wt" });
    expect(host.created).toEqual([{ tabId: "tab-1", paneId: "pane-1", label: "t-1", worktree: "/project/wt" }]);

    await sink.publish("w1", "[message] hello");
    await sink.publish("w1", "[message] world");
    await sleep(20);
    expect(host.sent.length).toBeGreaterThanOrEqual(1);

    await sink.onWorkerFinish("w1");
    expect(host.closed).toEqual(["tab-1"]);
    const flushed = host.sent.map((entry) => entry.text).join("");
    expect(flushed).toContain("[message] hello");
    expect(flushed).toContain("[message] world");
  });

  test("workers beyond the pane limit fall back to watch-only (first-come-first-served)", async () => {
    const host = fakeHost();
    const sink = new PaneMirrorSink({ host, projectRoot: "/project", environment: herdrEnv, paneLimit: 1 });
    await sink.onWorkerStart({ providerId: "codex:x", workerId: "w1", runId: "run", taskId: "t-1" });
    await sink.onWorkerStart({ providerId: "codex:x", workerId: "w2", runId: "run", taskId: "t-2" });
    expect(host.created).toHaveLength(1);

    await sink.publish("w2", "[message] unseen");
    await sink.onWorkerFinish("w2");
    expect(host.closed).toEqual([]);
    expect(host.sent).toEqual([]);
  });

  test("excluded (interactive) providers never receive panes", async () => {
    const host = fakeHost();
    const sink = new PaneMirrorSink({ host, projectRoot: "/project", environment: herdrEnv, excluded: new Set(["pi:tui"]) });
    await sink.onWorkerStart({ providerId: "pi:tui", workerId: "w1", runId: "run", taskId: "t-1" });
    await sink.onWorkerStart({ providerId: "codex:exec", workerId: "w2", runId: "run", taskId: "t-2" });
    expect(host.created).toHaveLength(1);
    expect(host.created[0]?.label).toBe("t-2");
  });

  test("a worker finishing while its pane is still being created closes the pane", async () => {
    let releaseCreate: () => void = () => {};
    const inner = fakeHost();
    const slowHost: PaneMirrorHost = {
      createPane: async (runId, taskId, projectRoot, worktree, label) => {
        await new Promise<void>((resolve) => { releaseCreate = resolve; });
        return inner.createPane(runId, taskId, projectRoot, worktree, label);
      },
      closePane: inner.closePane.bind(inner),
      sendText: inner.sendText.bind(inner),
    };
    void releaseCreate;
    const sink = new PaneMirrorSink({ host: slowHost, projectRoot: "/project", environment: herdrEnv });
    const starting = sink.onWorkerStart({ providerId: "codex:x", workerId: "w1", runId: "run", taskId: "t-1" });
    const finishing = sink.onWorkerFinish("w1");
    releaseCreate();
    await Promise.all([starting, finishing]);
    expect(inner.created).toHaveLength(1);
    expect(inner.closed).toEqual(["tab-1"]);
  });

  test("relay is hosted in the pane and mirror lines are framed for it", async () => {
    const host = fakeHost();
    const built: Array<{ runId: string; taskId: string; paneId: string; tabId: string }> = [];
    const sink = new PaneMirrorSink({
      host,
      projectRoot: "/project",
      environment: herdrEnv,
      intervalMs: 5,
      relay: (assignment) => {
        built.push(assignment);
        return { command: "loop", args: ["__steer-relay", assignment.runId, assignment.taskId] };
      },
    });

    await sink.onWorkerStart({ providerId: "codex:x", workerId: "w1", runId: "run-9", taskId: "t-1" });
    expect(host.hosted).toEqual([
      { paneId: "pane-1", command: "loop", args: ["__steer-relay", "run-9", "t-1"] },
    ]);
    expect(built).toEqual([{ runId: "run-9", taskId: "t-1", paneId: "pane-1", tabId: "tab-1" }]);

    await sink.publish("w1", "[message] hello");
    await sink.onWorkerFinish("w1");
    expect(host.closed).toEqual(["tab-1"]);

    const flushed = host.sent.map((entry) => entry.text).join("");
    expect(flushed).toContain(encodeDisplayFrame("[message] hello"));
    // Every framed line decodes back to the rendered mirror line.
    const decoded = flushed.trim().split("\n").map((line) => parsePaneLine(line));
    expect(decoded).toContainEqual({ kind: "display", text: "[message] hello" });
  });

  test("relay spawn failure degrades silently to plain v1 mirroring", async () => {
    const host = fakeHost();
    host.setFailRunInPane(true);
    const sink = new PaneMirrorSink({
      host,
      projectRoot: "/project",
      environment: herdrEnv,
      intervalMs: 5,
      relay: () => ({ command: "loop", args: ["__steer-relay"] }),
    });

    await sink.onWorkerStart({ providerId: "codex:x", workerId: "w1", runId: "run", taskId: "t-1" });
    await sink.publish("w1", "[message] plain");
    await sink.onWorkerFinish("w1");

    expect(host.hosted).toEqual([]);
    const flushed = host.sent.map((entry) => entry.text).join("");
    expect(flushed).toContain("[message] plain");
    expect(flushed).not.toContain("loopDisplay");
  });

  test("the relay dies with the pane: worker finish closes the pane and ends the relay", async () => {
    const host = fakeHost();
    const sink = new PaneMirrorSink({
      host,
      projectRoot: "/project",
      environment: herdrEnv,
      relay: () => ({ command: "loop", args: ["__steer-relay", "run", "t-1"] }),
    });

    await sink.onWorkerStart({ providerId: "codex:x", workerId: "w1", runId: "run", taskId: "t-1" });
    expect(host.relays).toEqual([{ paneId: "pane-1", exited: false }]);

    await sink.onWorkerFinish("w1");
    expect(host.relays).toEqual([{ paneId: "pane-1", exited: true }]);
  });

  test("without a relay builder the pane stays plain and nothing is hosted (v1 identical)", async () => {
    const host = fakeHost();
    const sink = new PaneMirrorSink({ host, projectRoot: "/project", environment: herdrEnv, intervalMs: 5 });
    await sink.onWorkerStart({ providerId: "codex:x", workerId: "w1", runId: "run", taskId: "t-1" });
    await sink.publish("w1", "[message] plain");
    await sink.onWorkerFinish("w1");

    expect(host.hosted).toEqual([]);
    const flushed = host.sent.map((entry) => entry.text).join("");
    expect(flushed).toContain("[message] plain");
    expect(flushed).not.toContain("loopDisplay");
  });

  test("headless environments never create panes or host relays (fail-open)", async () => {
    const host = fakeHost();
    const sink = new PaneMirrorSink({
      host,
      projectRoot: "/project",
      environment: {},
      relay: () => ({ command: "loop", args: ["__steer-relay"] }),
    });
    await sink.onWorkerStart({ providerId: "codex:x", workerId: "w1", runId: "run", taskId: "t-1" });
    await sink.publish("w1", "[lifecycle] starting t-1");
    await sink.onWorkerFinish("w1");
    expect(host.created).toEqual([]);
    expect(host.hosted).toEqual([]);
    expect(host.sent).toEqual([]);
    expect(host.closed).toEqual([]);
  });

  test("compositeSink fans out to every sink", async () => {
    const a = new RecordingSink();
    const b = new RecordingSink();
    const sink = compositeSink(a, b);
    await sink.onWorkerStart?.({ providerId: "codex:x", workerId: "w1", runId: "r", taskId: "t" });
    await sink.publish("w1", "line");
    await sink.onWorkerFinish?.("w1");
    expect(a.lines).toEqual([{ workerId: "w1", line: "line" }]);
    expect(b.lines).toEqual([{ workerId: "w1", line: "line" }]);
    expect(a.finishes).toEqual(["w1"]);
    expect(b.finishes).toEqual(["w1"]);
  });
});

describe("HerdrWorkerRuntime pane surface", () => {
  function scriptedRunner(responses: Map<string, string>) {
    const calls: string[][] = [];
    const runner: HerdrRunner = {
      async run(_command: string, args: string[]): Promise<HerdrResult> {
        calls.push(args);
        const key = args.join(" ");
        const stdout = responses.get(key);
        if (stdout === undefined) throw new Error(`unexpected herdr call: ${key}`);
        return { exitCode: 0, stdout, stderr: "" };
      },
    };
    return { calls, runner };
  }

  test("createPane, sendText, and closePane drive the passive mirror tab lifecycle", async () => {
    const responses = new Map<string, string>([
      ["workspace create --cwd /project --label loop-run-9 --no-focus", JSON.stringify({ result: { workspace: { workspace_id: "ws-9" }, root_pane: { pane_id: "ws-9:p-root" } } })],
      ["tab create --workspace ws-9 --cwd /project/wt --label mirror·t-1 --no-focus", JSON.stringify({ result: { tab: { tab_id: "ws-9:t-1" }, root_pane: { pane_id: "ws-9:p-1" } } })],
      ["pane rename ws-9:p-1 mirror·t-1", "{}"],
      ["pane send-text ws-9:p-1 hello\n", "{}"],
      ["tab close ws-9:t-1", "{}"],
    ]);
    const { calls, runner } = scriptedRunner(responses);
    const runtime = new HerdrWorkerRuntime({ runner });

    const pane = await runtime.createPane("run-9", "t-1", "/project", "/project/wt", "t-1");
    expect(pane).toMatchObject({ workspaceId: "ws-9", tabId: "ws-9:t-1", paneId: "ws-9:p-1", taskId: "t-1" });

    await runtime.sendText(pane.paneId, "hello\n");
    await runtime.closePane(pane.tabId);

    const verbs = calls.map((args) => `${args[0]} ${args[1] ?? ""}`);
    expect(verbs).toContain("workspace create");
    expect(verbs).toContain("tab create");
    expect(verbs).toContain("pane rename");
    expect(verbs).toContain("pane send-text");
    expect(verbs).toContain("tab close");
    expect(verbs).not.toContain("pane close");
  });
});
