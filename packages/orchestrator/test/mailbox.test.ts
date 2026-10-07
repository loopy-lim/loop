import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as protocol from "@loop/protocol";
import type { ComputeClass, TaskSpecInput } from "@loop/protocol";
import {
  FakeProvider,
  ProviderRegistry,
  type AgentProvider,
  type ProviderCapabilities,
  type StartWorkerInput,
  type WorkerResult,
} from "@loop/providers";
import { Orchestrator } from "../src/coordinator";
import { CompletionVerifier } from "../src/completion";
import { GuidanceMailbox, guidanceBatchSize, resolveMailboxOptions } from "../src/mailbox";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

beforeAll(() => protocol.rustra.ready());

const verifier = new CompletionVerifier({
  run: async () => ({ exitCode: 0, stdout: "verification evidence", stderr: "", timedOut: false }),
});

function fixture(id: string): TaskSpecInput {
  return {
    id,
    title: id,
    kind: "research",
    dependencies: [],
    readScope: ["docs/**"],
    writeScope: [],
    requirements: ["inspect evidence"],
    completionChecks: [
      { id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 },
    ],
    preferredCompute: "fast",
    minimumCompute: "fast",
    maximumCompute: "fast",
    maxAttempts: 2,
  };
}

function workspace(runId: string) {
  const directory = mkdtempSync(join(tmpdir(), `loop-mailbox-${runId}-`));
  const input = { databasePath: join(directory, "run.db"), runId };
  return { directory, input };
}

async function until(predicate: () => boolean | Promise<boolean>, deadlineMs = 3000) {
  const deadline = Date.now() + deadlineMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition timed out");
    await Bun.sleep(5);
  }
}

/** Appends a real GuidanceAdded event through the existing steer backend. */
async function addGuidance(
  input: { databasePath: string; runId: string },
  taskId: string | null,
  message: string,
) {
  await protocol.steerRun({ ...input, taskId, message });
}

async function guidanceSequences(input: {
  databasePath: string;
  runId: string;
}): Promise<Map<string, number>> {
  const events = await protocol.subscribeEvents({ ...input, afterSequence: 0, limit: 1000 });
  const sequences = new Map<string, number>();
  for (const event of events) {
    const payload = JSON.parse(event.payloadJson) as {
      kind?: { type?: string; data?: { message?: string } };
    };
    if (payload.kind?.type === "guidance_added" && payload.kind.data?.message)
      sequences.set(payload.kind.data.message, Number(event.sequence));
  }
  return sequences;
}

test("guidance batch sizing bounds one combined delivery by the byte budget", () => {
  expect(guidanceBatchSize([], 16000)).toBe(0);
  expect(guidanceBatchSize(["single"], 16000)).toBe(1);
  // A single oversized message still goes out alone: steerRun caps at 16k.
  expect(guidanceBatchSize(["x".repeat(20000)], 16000)).toBe(1);
  // 3 × 5000 + 2 separators fits; the fourth message waits for the next window.
  expect(
    guidanceBatchSize(
      ["x".repeat(5000), "y".repeat(5000), "z".repeat(5000), "w".repeat(5000)],
      16000,
    ),
  ).toBe(3);
});

test("resolveMailboxOptions keeps documented defaults and rejects nonsense", () => {
  expect(resolveMailboxOptions()).toEqual({
    enabled: true,
    coalescingWindowMs: 2000,
    pollIntervalMs: 100,
    maxMessageBytes: 16000,
    steerDeliveryBudgetMs: 15_000,
  });
  expect(resolveMailboxOptions({ enabled: false, coalescingWindowMs: -5 }).coalescingWindowMs).toBe(
    2000,
  );
});

test("a burst appended before the tap starts drains as one combined steer", async () => {
  const { directory, input } = workspace("burst");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a")],
  });
  await addGuidance(input, "a", "m1");
  await addGuidance(input, "a", "m2");
  await addGuidance(input, "a", "m3");
  const steered: string[] = [];
  const mailbox = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
  });
  mailbox.register({
    taskId: "a",
    workerId: "w1",
    deliveredThroughSequence: 0,
    steer: async (message) => {
      steered.push(message);
    },
  });
  mailbox.start();
  await until(() => steered.length === 1);
  await Bun.sleep(120);
  expect(steered).toEqual(["m1\nm2\nm3"]);
  // The mailbox is read-only: the run state it observes never moved.
  expect((await protocol.getSnapshot(input)).state).toBe("active");
  await mailbox.stop();
});

test("guidance already covered by the start-context watermark is not re-steered", async () => {
  const { directory, input } = workspace("watermark");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a")],
  });
  await addGuidance(input, "a", "already in context");
  const sequences = await guidanceSequences(input);
  const watermark = must(sequences.get("already in context"));
  const steered: string[] = [];
  const mailbox = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
  });
  mailbox.register({
    taskId: "a",
    workerId: "w1",
    deliveredThroughSequence: watermark,
    steer: async (message) => {
      steered.push(message);
    },
  });
  await addGuidance(input, "a", "appended after start");
  mailbox.start();
  await until(() => steered.length === 1);
  await Bun.sleep(100);
  expect(steered).toEqual(["appended after start"]);
  await mailbox.stop();
});

test("a rejected steer keeps the message pending and retries after the window", async () => {
  const { directory, input } = workspace("retry");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a")],
  });
  await addGuidance(input, "a", "persistent guidance");
  let failing = true;
  const steered: string[] = [];
  const mailbox = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
  });
  mailbox.register({
    taskId: "a",
    workerId: "w1",
    deliveredThroughSequence: 0,
    steer: async (message) => {
      if (failing) throw new Error("agent_blocked");
      steered.push(message);
    },
  });
  mailbox.start();
  await Bun.sleep(140); // several windows of failing steers must not deliver or drop
  expect(steered).toEqual([]);
  failing = false;
  await until(() => steered.length === 1);
  await Bun.sleep(100);
  expect(steered).toEqual(["persistent guidance"]); // exactly-once after success
  await mailbox.stop();
});

test("a turn-boundary inbox target drains every tick without waiting out the coalescing window", async () => {
  const { directory, input } = workspace("inbox");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a")],
  });
  const steered: string[] = [];
  // A 10 s window would starve a fast turn-loop worker's second steer if the
  // mailbox applied it: the provider inbox is the coalescer, so the hand-off
  // lands on every tap tick instead (research §6 drain trigger (a)).
  const mailbox = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 10_000,
    pollIntervalMs: 5,
  });
  mailbox.register({
    taskId: "a",
    workerId: "w1",
    deliveredThroughSequence: 0,
    steerCoalescing: "inbox",
    steer: async (message) => {
      steered.push(message);
    },
  });
  mailbox.start();
  await addGuidance(input, "a", "first steer");
  await until(() => steered.length === 1);
  await addGuidance(input, "a", "second steer");
  await until(() => steered.length === 2, 2000); // well inside the 10 s window
  expect(steered[1]).toBe("second steer");
  await mailbox.stop();
});

test("a rejecting boundary-inbox hand-off backs off by the window and then delivers exactly once", async () => {
  const { directory, input } = workspace("inbox-retry");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a")],
  });
  let failing = true;
  let attempts = 0;
  const steered: string[] = [];
  const mailbox = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 60,
    pollIntervalMs: 5,
  });
  mailbox.register({
    taskId: "a",
    workerId: "w1",
    deliveredThroughSequence: 0,
    steerCoalescing: "inbox",
    steer: async (message) => {
      attempts += 1;
      if (failing) throw new Error("worker not accepting steer");
      steered.push(message);
    },
  });
  mailbox.start();
  await addGuidance(input, "a", "patient steer");
  await Bun.sleep(120); // rejections must back off by the window, not spin per tick
  expect(attempts).toBeGreaterThanOrEqual(1);
  expect(attempts).toBeLessThan(10);
  failing = false;
  await until(() => steered.length === 1, 2000);
  await Bun.sleep(80);
  expect(steered).toEqual(["patient steer"]); // exactly-once after success
  await mailbox.stop();
});

test("task-scoped guidance routes to its task and null guidance broadcasts", async () => {
  const { directory, input } = workspace("routing");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a"), fixture("b")],
  });
  const steeredA: string[] = [];
  const steeredB: string[] = [];
  const mailbox = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
  });
  mailbox.register({
    taskId: "a",
    workerId: "w-a",
    deliveredThroughSequence: 0,
    steer: async (message) => {
      steeredA.push(message);
    },
  });
  mailbox.register({
    taskId: "b",
    workerId: "w-b",
    deliveredThroughSequence: 0,
    steer: async (message) => {
      steeredB.push(message);
    },
  });
  await addGuidance(input, "a", "for a only");
  await addGuidance(input, null, "broadcast to everyone");
  mailbox.start();
  await until(() => steeredA.length === 1 && steeredB.length === 1);
  expect(steeredA[0]).toContain("for a only");
  expect(steeredA[0]).toContain("broadcast to everyone");
  expect(steeredB[0]).toBe("broadcast to everyone");
  await mailbox.stop();
});

test("a worker without a live steer channel receives nothing from the mailbox", async () => {
  const { directory, input } = workspace("no-steer");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a")],
  });
  const mailbox = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
  });
  mailbox.register({ taskId: "a", workerId: "w1", deliveredThroughSequence: 0 });
  await addGuidance(input, "a", "waits for the next claim");
  mailbox.start();
  await Bun.sleep(140);
  expect(mailbox.delivered).toBe(0);
  mailbox.release("a"); // next attempt picks it up through getTaskContext instead
  await addGuidance(input, "a", "after release");
  await Bun.sleep(60);
  expect(mailbox.delivered).toBe(0);
  await mailbox.stop();
});

/** Full-control provider: workers run until the test completes them. */
class SteerableProvider implements AgentProvider {
  readonly id = "steerable";
  readonly started: StartWorkerInput[] = [];
  readonly steered: string[] = [];
  readonly #resolvers = new Map<string, (result: WorkerResult) => void>();
  constructor(private readonly computeClasses: ComputeClass[]) {}
  async capabilities(): Promise<ProviderCapabilities> {
    return {
      available: true,
      computeClasses: this.computeClasses,
      tools: true,
      vision: false,
      structuredOutput: false,
      resumableSession: false,
    };
  }
  async start(input: StartWorkerInput) {
    const id = `${this.id}-${this.started.length}`;
    this.started.push(input);
    return { id };
  }
  async cancel(workerId: string) {
    this.#resolvers.get(workerId)?.({
      success: false,
      summary: "cancelled",
      failure: { kind: "cancelled", retryable: false },
    });
    this.#resolvers.delete(workerId);
  }
  async status(workerId: string) {
    return this.#resolvers.has(workerId) ? ("running" as const) : ("completed" as const);
  }
  result(workerId: string): Promise<WorkerResult> {
    return new Promise((resolve) => this.#resolvers.set(workerId, resolve));
  }
  async steer(_workerId: string, message: string) {
    this.steered.push(message);
  }
  completeAll() {
    // Snapshot drain: resolve() may synchronously register new resolvers that
    // must survive this pass.
    // oxlint-disable-next-line unicorn/no-useless-spread -- defensive copy, see above
    for (const [workerId, resolve] of [...this.#resolvers]) {
      this.#resolvers.delete(workerId);
      resolve({ success: true, summary: "steered work complete" });
    }
  }
}

test("guidance appended mid-run reaches a running steer-capable worker", async () => {
  const { directory, input } = workspace("live");
  const provider = new SteerableProvider(["fast"]);
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 1,
    completionVerifier: verifier,
    guidanceMailbox: { coalescingWindowMs: 40, pollIntervalMs: 5 },
  });
  const pending = orchestrator.run({
    ...input,
    tasks: [fixture("a")],
    workingDirectory: directory,
  });
  await until(() => provider.started.length === 1);
  await Bun.sleep(50); // let recordWorkerStarted + mailbox register settle
  await addGuidance(input, "a", "course correction");
  await until(() => provider.steered.length === 1);
  expect(provider.steered).toEqual(["course correction"]);
  provider.completeAll();
  expect((await pending).status).toBe("completed");
});

test("guidance appended mid-run reaches the next attempt of a non-steer provider", async () => {
  const { directory, input } = workspace("oneshot");
  class RecordingProvider extends FakeProvider {
    readonly starts: StartWorkerInput[] = [];
    override async start(startInput: StartWorkerInput) {
      this.starts.push(startInput);
      return super.start(startInput);
    }
  }
  const provider = new RecordingProvider("oneshot", ["fast"], { delayMs: 120, failures: { a: 1 } });
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 1,
    completionVerifier: verifier,
    guidanceMailbox: { coalescingWindowMs: 40, pollIntervalMs: 5 },
  });
  const pending = orchestrator.run({
    ...input,
    tasks: [fixture("a")],
    workingDirectory: directory,
  });
  await until(() => provider.starts.length === 1);
  await Bun.sleep(30);
  await addGuidance(input, "a", "mid-run course correction");
  await until(() => provider.starts.length === 2);
  expect((await pending).status).toBe("completed");
  expect(provider.starts[0]?.context?.guidance ?? []).toEqual([]);
  expect(provider.starts[1]?.context?.guidance).toContain("mid-run course correction");
});

test("disabling the mailbox leaves the run untouched by live delivery", async () => {
  const { directory, input } = workspace("disabled");
  const provider = new SteerableProvider(["fast"]);
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 1,
    completionVerifier: verifier,
    guidanceMailbox: { enabled: false },
  });
  const pending = orchestrator.run({
    ...input,
    tasks: [fixture("a")],
    workingDirectory: directory,
  });
  await until(() => provider.started.length === 1);
  await addGuidance(input, "a", "never delivered live");
  await Bun.sleep(300);
  expect(provider.steered).toEqual([]);
  provider.completeAll();
  expect((await pending).status).toBe("completed");
});

test("a steer channel that never settles cannot park the tap or the shutdown", async () => {
  const { directory, input } = workspace("hung-steer");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a")],
  });
  await addGuidance(input, "a", "guidance for a hung channel");
  const steered: string[] = [];
  const mailbox = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
    // Test budget: expiry keeps the batch pending and backs off one window.
    steerDeliveryBudgetMs: 50,
  });
  mailbox.register({
    taskId: "a",
    workerId: "w1",
    deliveredThroughSequence: 0,
    steer: () => {
      steered.push("call");
      return new Promise<void>(() => {});
    },
  });
  mailbox.start();
  // The first delivery hangs; the budget must expire and the tap must keep
  // ticking: the retry after one backoff window proves the loop survived.
  await until(() => steered.length >= 2, 3_000);
  // Nothing was dropped or persisted as delivered by the hung channel.
  expect(mailbox.delivered).toBe(0);
  // mailbox.stop() (the owner's shutdown path) still settles.
  await Promise.race([
    mailbox.stop(),
    Bun.sleep(2_000).then(() => {
      throw new Error("mailbox.stop() did not settle after a hung steer");
    }),
  ]);
});
