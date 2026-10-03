import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as protocol from "@loop/protocol";
import type { ComputeClass, TaskSpecInput } from "@loop/protocol";
import {
  ProviderRegistry,
  type AgentProvider,
  type ProviderCapabilities,
  type StartWorkerInput,
  type WorkerResult,
} from "@loop/providers";
import { FakeModelClient, TurnLoopProvider } from "@loop/turnloop";
import type { ModelTurnRequest } from "@loop/turnloop";
import { Orchestrator } from "../src/coordinator";
import { CompletionVerifier } from "../src/completion";
import type { OrchestrationControl } from "../src/control";
import { GuidanceMailbox } from "../src/mailbox";

beforeAll(() => protocol.rustra.ready());

const verifier = new CompletionVerifier({
  run: async () => ({ exitCode: 0, stdout: "verification evidence", stderr: "", timedOut: false }),
});

function fixture(id: string, dependencies: string[] = []): TaskSpecInput {
  return {
    id,
    title: id,
    kind: "research",
    dependencies,
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
  const directory = mkdtempSync(join(tmpdir(), `loop-steer-${runId}-`));
  const input = { databasePath: join(directory, "run.db"), runId };
  return { directory, input };
}

async function until(predicate: () => boolean | Promise<boolean>, deadlineMs = 4000) {
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

interface LogEvent {
  sequence: number;
  type: string;
  data: Record<string, unknown>;
}

async function readEvents(
  input: { databasePath: string; runId: string },
  type?: string,
): Promise<LogEvent[]> {
  const events = await protocol.subscribeEvents({ ...input, afterSequence: 0, limit: 1000 });
  return events
    .map((event) => {
      const payload = JSON.parse(event.payloadJson) as {
        kind?: { type?: string; data?: Record<string, unknown> };
      };
      return {
        sequence: Number(event.sequence),
        type: payload.kind?.type ?? "",
        data: payload.kind?.data ?? {},
      };
    })
    .filter((event) => type === undefined || event.type === type);
}

async function guidanceSequenceOf(
  input: { databasePath: string; runId: string },
  message: string,
): Promise<number> {
  const events = await readEvents(input, "guidance_added");
  const match = events.find((event) => event.data.message === message);
  if (!match) throw new Error(`guidance not found: ${message}`);
  return match.sequence;
}

/** Full-control steer-capable provider with per-task failure injection. */
class GatedSteerableProvider implements AgentProvider {
  readonly id = "gated-steerable";
  readonly started: StartWorkerInput[] = [];
  readonly steered: string[] = [];
  readonly #resolvers = new Map<string, (result: WorkerResult) => void>();
  constructor(
    private readonly computeClasses: ComputeClass[],
    private readonly failures: Record<string, number> = {},
  ) {}
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
    const remaining = this.failures[input.taskId] ?? 0;
    if (remaining > 0) {
      this.failures[input.taskId] = remaining - 1;
      // Fail promptly; the orchestrator schedules the retry attempt.
      setTimeout(() => {
        this.#resolvers.get(id)?.({
          success: false,
          summary: "injected failure",
          failure: { kind: "process_error", retryable: true },
        });
        this.#resolvers.delete(id);
      }, 20);
    }
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
  completeAll(summary = "gated work complete") {
    // Snapshot drain: resolve() may synchronously register new resolvers that
    // must survive this pass.
    // oxlint-disable-next-line unicorn/no-useless-spread -- defensive copy, see above
    for (const [workerId, resolve] of [...this.#resolvers]) {
      this.#resolvers.delete(workerId);
      resolve({ success: true, summary });
    }
  }
}

test("a successful live drain appends GuidanceDelivered with the batch's highest sequence", async () => {
  const { directory, input } = workspace("persist");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a")],
  });
  await addGuidance(input, "a", "first steer");
  await addGuidance(input, "a", "second steer");
  const second = await guidanceSequenceOf(input, "second steer");
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
  // The persistence point: the drain is only bookkeeping-complete once the
  // GuidanceDelivered event is in the log.
  await until(async () => (await readEvents(input, "guidance_delivered")).length === 1);
  const [delivered] = await readEvents(input, "guidance_delivered");
  if (delivered === undefined) throw new Error("expected a guidance_delivered event");
  expect(delivered.data.task_id).toBe("a");
  expect(delivered.data.worker_id).toBe("w1");
  expect(delivered.data.through_sequence).toBe(second);
  // The combined message carried both guidance entries.
  expect(steered[0]).toContain("first steer");
  expect(steered[0]).toContain("second steer");
  await mailbox.stop();
});

test("the watermark survives a mailbox restart: a fresh attempt is never re-steered", async () => {
  const { directory, input } = workspace("replay");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a")],
  });
  await addGuidance(input, "a", "delivered once");
  const steered: string[] = [];
  const first = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
  });
  first.register({
    taskId: "a",
    workerId: "w1",
    deliveredThroughSequence: 0,
    steer: async (message) => {
      steered.push(message);
    },
  });
  first.start();
  await until(() => steered.length === 1);
  await until(async () => (await readEvents(input, "guidance_delivered")).length === 1);
  await first.stop();

  // A new mailbox (fresh process) replays the log and must not re-steer.
  const second = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
  });
  second.register({
    taskId: "a",
    workerId: "w2",
    deliveredThroughSequence: 0,
    steer: async (message) => {
      steered.push(message);
    },
  });
  second.start();
  await Bun.sleep(120);
  expect(steered).toEqual(["delivered once"]);
  await second.stop();
});

test("guidance on a task reaches the live workers of its descendant sub-tasks", async () => {
  const { directory, input } = workspace("descendants");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("parent"), fixture("child", ["parent"])],
  });
  const steeredParent: string[] = [];
  const steeredChild: string[] = [];
  const steeredStranger: string[] = [];
  const mailbox = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
  });
  mailbox.register({
    taskId: "parent",
    workerId: "w-parent",
    deliveredThroughSequence: 0,
    steer: async (message) => {
      steeredParent.push(message);
    },
  });
  mailbox.register({
    taskId: "child",
    workerId: "w-child",
    deliveredThroughSequence: 0,
    steer: async (message) => {
      steeredChild.push(message);
    },
  });
  mailbox.register({
    taskId: "stranger",
    workerId: "w-stranger",
    deliveredThroughSequence: 0,
    steer: async (message) => {
      steeredStranger.push(message);
    },
  });
  await protocol.addTask({ ...input, task: fixture("grandchild", ["child"]) });
  await addGuidance(input, "parent", "graph-wide correction");
  mailbox.start();
  await until(() => steeredParent.length === 1 && steeredChild.length === 1);
  expect(steeredParent[0]).toContain("graph-wide correction");
  expect(steeredChild[0]).toContain("graph-wide correction"); // transitively dependent sub-task
  await Bun.sleep(80);
  expect(steeredStranger).toEqual([]); // an unrelated task is never routed parent guidance
  // Each live delivery watermarks its own receiving task.
  await until(async () => (await readEvents(input, "guidance_delivered")).length === 2);
  const delivered = await readEvents(input, "guidance_delivered");
  expect(delivered.map((event) => event.data.task_id).sort()).toEqual(["child", "parent"]);
  await mailbox.stop();
});

test("claimContext injects ancestor-targeted guidance into a descendant's claim context exactly once", async () => {
  const { directory, input } = workspace("claim-inject");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("parent"), fixture("child", ["parent"]), fixture("unrelated")],
  });
  const mailbox = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
  });
  mailbox.start();
  await addGuidance(input, "parent", "ancestor guidance");
  const sequence = await guidanceSequenceOf(input, "ancestor guidance");

  // First claim of the child: the bridge context ([]) plus the ancestor rule.
  const first = await mailbox.claimContext("child", []);
  expect(first.guidance).toEqual(["ancestor guidance"]);
  expect(first.throughSequence).toBe(sequence);
  mailbox.register({
    taskId: "child",
    workerId: "w-child",
    deliveredThroughSequence: first.throughSequence,
  });
  await until(async () =>
    (await readEvents(input, "guidance_delivered")).some((event) => event.data.task_id === "child"),
  );

  // Retry claim of the child: the watermark absorbs the duplicate.
  const retry = await mailbox.claimContext("child", []);
  expect(retry.guidance).toEqual([]);
  expect(retry.throughSequence).toBe(sequence);

  // A claim of the unrelated task never sees the parent's guidance.
  const unrelated = await mailbox.claimContext("unrelated", []);
  expect(unrelated.guidance).toEqual([]);
  expect(unrelated.throughSequence).toBe(0);
  await mailbox.stop();
});

test("claimContext filters bridge guidance the delivery watermark already covered", async () => {
  const { directory, input } = workspace("claim-filter");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a")],
  });
  await addGuidance(input, "a", "delivered live earlier");
  const sequence = await guidanceSequenceOf(input, "delivered live earlier");
  const mailbox = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
  });
  mailbox.start();
  // Wait for the tap to observe the guidance, then simulate prior delivery.
  await until(async () => {
    const view = await mailbox.claimContext("a", ["delivered live earlier"]);
    return view.throughSequence === sequence;
  });
  const claimed = await mailbox.claimContext("a", ["delivered live earlier"]);
  expect(claimed.guidance).toEqual(["delivered live earlier"]); // undelivered → claim context carries it
  mailbox.register({
    taskId: "a",
    workerId: "w1",
    deliveredThroughSequence: claimed.throughSequence,
  });
  // A retry claim after live/claim delivery: the watermark absorbs it.
  const retry = await mailbox.claimContext("a", ["delivered live earlier"]);
  expect(retry.guidance).toEqual([]);
  await mailbox.stop();
});

test("a crash between steer and the delivery append leaves the guidance pending for the next claim", async () => {
  const { directory, input } = workspace("crash-gap");
  await protocol.prepareRun({
    ...input,
    intent: "",
    workingDirectory: directory,
    tasks: [fixture("a")],
  });
  const steered: string[] = [];
  // The failing append simulates the process dying right after the steer
  // hand-off and before GuidanceDelivered persistence.
  const crashing = {
    ...protocol,
    recordGuidanceDelivered: async () => {
      throw new Error("crashed before the delivery append");
    },
  } as unknown as OrchestrationControl;
  const mailbox = new GuidanceMailbox(crashing, input.databasePath, input.runId, {
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
  await addGuidance(input, "a", "rescue the half-written file");
  await until(() => steered.length === 1);
  // Kill the mailbox before its append lands, then drop the target: the
  // worker is gone and the guidance was never recorded as delivered.
  await mailbox.stop();
  mailbox.release("a");
  await Bun.sleep(60);
  expect(await readEvents(input, "guidance_delivered")).toEqual([]);

  // A fresh process (new mailbox) claims the task again: the projection
  // still holds the guidance, so the claim context injects it exactly once.
  const next = new GuidanceMailbox(protocol, input.databasePath, input.runId, {
    coalescingWindowMs: 40,
    pollIntervalMs: 5,
  });
  next.start();
  const claim = await next.claimContext("a", ["rescue the half-written file"]);
  expect(claim.guidance.filter((message) => message === "rescue the half-written file")).toEqual([
    "rescue the half-written file",
  ]);
  expect(claim.throughSequence).toBe(
    await guidanceSequenceOf(input, "rescue the half-written file"),
  );
  await next.stop();
});

test("a delivered-then-recorded guidance does not repeat in a retry attempt's start context", async () => {
  const { directory, input } = workspace("retry-absorb");
  const provider = new GatedSteerableProvider(["fast"], { a: 1 });
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 1,
    completionVerifier: verifier,
    guidanceMailbox: { coalescingWindowMs: 20, pollIntervalMs: 5 },
  });
  const pending = orchestrator.run({
    ...input,
    tasks: [fixture("a")],
    workingDirectory: directory,
  });
  await until(() => provider.started.length === 1);
  await Bun.sleep(40); // let recordWorkerStarted + register settle
  await addGuidance(input, "a", "mid-run correction");
  await until(() => provider.steered.length === 1);
  await until(async () => (await readEvents(input, "guidance_delivered")).length >= 1);
  provider.completeAll(); // attempt 1 fails (injected); attempt 2 starts
  await until(() => provider.started.length === 2);
  provider.completeAll();
  expect((await pending).status).toBe("completed");
  // Attempt 1 saw the guidance live; the watermark keeps attempt 2 clean.
  expect(provider.started[0]?.context?.guidance ?? []).toEqual([]);
  expect(provider.started[1]?.context?.guidance ?? []).toEqual([]);
});

test("end-to-end: mid-run guidance reaches a turn-loop worker at the very next fake-model turn and is recorded", async () => {
  const { directory, input } = workspace("turnloop-e2e");
  let parked: string | undefined;
  let releaseTurn1Tool!: () => void;
  const turn1Tool = new Promise<void>((resolve) => {
    releaseTurn1Tool = resolve;
  });
  let releaseTurn2Tool!: () => void;
  const turn2Tool = new Promise<void>((resolve) => {
    releaseTurn2Tool = resolve;
  });
  const requests: ModelTurnRequest["messages"][] = [];
  const modelClient = new FakeModelClient([
    {
      kind: "tool_calls",
      calls: [{ id: "gate-1", name: "park_until_steered", argumentsJson: "{}" }],
    },
    (request) => {
      requests.push(request.messages);
      return {
        kind: "tool_calls",
        calls: [{ id: "gate-2", name: "park_until_steered", argumentsJson: "{}" }],
      };
    },
    (request) => {
      requests.push(request.messages);
      return { kind: "message", text: "steered completion" };
    },
  ]);
  const provider = new TurnLoopProvider({
    modelClient,
    toolRunner: {
      async run(call) {
        parked = call.id;
        await (call.id === "gate-1" ? turn1Tool : turn2Tool);
        parked = undefined;
        return { output: "unblocked", isError: false };
      },
    },
    tools: [{ name: "park_until_steered", description: "parks until the test releases it" }],
    computeClasses: ["fast"],
  });
  // A 10 s coalescing window on purpose: a turn-boundary worker's inbox is
  // the coalescer (the provider declares it), so neither steer may wait out
  // the window — the operator acceptance core is reflection at the very next
  // turn boundary, with no tool-completion wait and no re-claim.
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 1,
    completionVerifier: verifier,
    guidanceMailbox: { coalescingWindowMs: 10_000, pollIntervalMs: 5 },
  });
  const pending = orchestrator.run({
    ...input,
    tasks: [fixture("a")],
    workingDirectory: directory,
  });
  const steerTexts = (messages: ModelTurnRequest["messages"], needle: string) =>
    messages.filter((entry) => entry.role === "user" && entry.text.includes(needle));

  await until(() => parked === "gate-1"); // turn 1 served; its tool parks the loop mid-run
  await addGuidance(input, "a", "steer: follow the recorded evidence");
  const firstSequence = await guidanceSequenceOf(input, "steer: follow the recorded evidence");
  // The mailbox hands off to the running worker and records the delivery
  // while the tool is still in flight — no tool-completion wait, no re-claim.
  await until(async () => {
    const delivered = await readEvents(input, "guidance_delivered");
    return delivered.some(
      (event) =>
        event.data.task_id === "a" && Number(event.data.through_sequence) === firstSequence,
    );
  });
  releaseTurn1Tool(); // the tool completes; the next turn boundary must carry the steer

  await until(() => requests.length === 1 && parked === "gate-2"); // turn 2 served and parked again
  // Turn 2 carried the first steer exactly once and not the second one.
  expect(steerTexts(requests[0] ?? [], "steer: follow the recorded evidence")).toHaveLength(1);
  expect(steerTexts(requests[0] ?? [], "steer: double-check the evidence")).toHaveLength(0);

  // A second steer inside the same 10 s window: the boundary inbox takes it
  // on the next tick — waiting out the window would need 10 s here.
  await addGuidance(input, "a", "steer: double-check the evidence");
  const secondSequence = await guidanceSequenceOf(input, "steer: double-check the evidence");
  await until(async () => {
    const delivered = await readEvents(input, "guidance_delivered");
    return delivered.some((event) => Number(event.data.through_sequence) === secondSequence);
  }, 2000);
  releaseTurn2Tool();

  const summary = await pending;
  expect(summary.status).toBe("completed");
  expect(requests).toHaveLength(2);
  expect(steerTexts(requests[1] ?? [], "steer: follow the recorded evidence")).toHaveLength(1); // still exactly once
  expect(steerTexts(requests[1] ?? [], "steer: double-check the evidence")).toHaveLength(1); // first boundary after its arrival
  // Every delivery is on the durable log, watermarks ascending.
  const delivered = await readEvents(input, "guidance_delivered");
  expect(delivered).toHaveLength(2);
  expect(delivered.map((event) => Number(event.data.through_sequence))).toEqual([
    firstSequence,
    secondSequence,
  ]);
  expect(delivered.every((event) => String(event.data.worker_id).includes(":a:"))).toBe(true);
});
