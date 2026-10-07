import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "../packages/protocol/src/index";
import type { TaskSpecInput } from "../packages/protocol/src/index";
import { FakeProvider, ProviderRegistry } from "../packages/providers/src/index";

import {
  MAX_AUTO_RELAX_STEPS,
  RoutingRelaxLedger,
  describeRoutingConstraints,
  isRelaxationExhausted,
  isRoutingFailure,
  routingExhaustionSummary,
} from "../packages/orchestrator/src/auto-relax";
import { Orchestrator } from "../packages/orchestrator/src/coordinator";
import { CompletionVerifier } from "../packages/orchestrator/src/completion";

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
    maxAttempts: 3,
  };
}

function withRouting(task: TaskSpecInput, routing: TaskSpecInput["routing"]): TaskSpecInput {
  return { ...task, routing };
}

test("bridge error codes identify routing failures without mirroring core policy", () => {
  const routingError = Object.assign(new Error("no eligible candidate"), {
    code: "no_sufficient_candidate",
  });
  const spentLadder = Object.assign(new Error("ladder spent"), {
    code: "relaxation_exhausted",
  });
  expect(isRoutingFailure(routingError)).toBe(true);
  expect(isRoutingFailure(new Error("transport down"))).toBe(false);
  expect(isRoutingFailure(undefined)).toBe(false);
  expect(isRelaxationExhausted(spentLadder)).toBe(true);
  expect(isRelaxationExhausted({ code: "attention_not_found" })).toBe(false);
});

test("auto-relax ledger bounds attempts and the exhaustion summary carries history and options", () => {
  const ledger = new RoutingRelaxLedger();
  for (let step = 0; step < MAX_AUTO_RELAX_STEPS; step++)
    ledger.record("a", { step: `s${step}`, receipt: `r${step}` });
  expect(ledger.count("a")).toBe(MAX_AUTO_RELAX_STEPS);
  expect(ledger.budgetLeft("a")).toBe(false);

  const budgetSummary = routingExhaustionSummary({
    taskId: "a",
    grants: ledger.grants("a"),
    routing: {
      risk: "low",
      required: { coding: 0, reasoning: 0, tools: 0, vision: 0, long_context: 0 },
    },
    limitHit: true,
  });
  expect(budgetSummary).toContain(`budget (${MAX_AUTO_RELAX_STEPS}) spent`);
  expect(budgetSummary).toContain("s0, s1");
  expect(budgetSummary).toContain("retry, defer, or cancel");

  // A fresh dispatcher (restart) may hold no grants; the summary names that
  // instead of inventing history, and still reports the surviving floor.
  const fresh = routingExhaustionSummary({
    taskId: "b",
    grants: [],
    routing: null,
    limitHit: false,
  });
  expect(fresh).toContain("ladder exhausted");
  expect(fresh).toContain("no step was granted in this dispatch");
  expect(describeRoutingConstraints(null)).toContain("no declared routing constraints");
});

test("dispatcher walks the relaxation ladder itself and completes without parking", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-auto-relax-run-"));
  const input = { databasePath: join(directory, "run.db"), runId: "auto-relax" };
  // FakeProvider advertises vision: false, so the vision-1 contract below
  // has no eligible candidate until one relaxation step is granted.
  const provider = new FakeProvider("fake", ["fast"]);
  const activities: string[] = [];
  const control = {
    ...protocol,
    // Tapping activity keeps the generated command's identity (commandId).
    recordActivity: Object.assign(
      async (event: Parameters<typeof protocol.recordActivity>[0]) => {
        activities.push(event.activity);
        return protocol.recordActivity(event);
      },
      { commandId: protocol.recordActivity.commandId },
    ),
  };
  const orchestrator = new Orchestrator({
    control,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 2,
    completionVerifier: verifier,
  });

  const result = await orchestrator.run({
    ...input,
    tasks: [
      withRouting(fixture("a"), {
        risk: "low",
        required: { coding: 0, reasoning: 0, tools: 0, vision: 1, long_context: 0 },
      }),
    ],
    workingDirectory: mkdtempSync(join(tmpdir(), "loop-auto-relax-work-")),
  });

  // The dispatcher resolved the shortfall itself: run completed, nothing parked.
  expect(result.status).toBe("completed");
  const snapshot = await protocol.getSnapshot(input);
  expect(snapshot.tasks.find((task) => task.id === "a")?.state).toBe("done");
  expect(snapshot.openAttentionIds).toEqual([]);
  // Audit trail: the granted step is durably visible as run activity, in
  // core's own step vocabulary ("vision 1→0"), not a TS-invented ladder.
  expect(
    activities.some(
      (line) =>
        line.startsWith(`Auto-relax 1/${MAX_AUTO_RELAX_STEPS} for task a`) &&
        line.includes("vision 1→0"),
    ),
  ).toBe(true);
}, 30_000);

test("only a spent ladder raises attention, with the relaxation history and remaining options", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-auto-relax-spent-"));
  const input = { databasePath: join(directory, "run.db"), runId: "auto-relax-spent" };
  // A registered but unavailable provider means no candidate is ever
  // eligible, so even the relaxed floor has nothing to route to: the ladder
  // must be walked to exhaustion before attention.
  class UnavailableProvider extends FakeProvider {
    override async capabilities() {
      return { ...(await super.capabilities()), available: false };
    }
  }
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new UnavailableProvider("dark", ["fast"])]),
    maxWorkers: 2,
    completionVerifier: verifier,
  });

  const result = await orchestrator.run({
    ...input,
    tasks: [
      withRouting(fixture("a"), {
        risk: "medium",
        required: { coding: 0, reasoning: 0, tools: 1, vision: 0, long_context: 0 },
      }),
    ],
    workingDirectory: mkdtempSync(join(tmpdir(), "loop-auto-relax-spent-work-")),
  });

  expect(result.status).toBe("attention");
  const snapshot = await protocol.getSnapshot(input);
  const attention = snapshot.attention.find((item) =>
    item.id.startsWith(`provider-${input.runId}-a-`),
  );
  expect(attention).toBeDefined();
  // The standing attention carries the consumed relaxation history…
  expect(attention?.summary).toContain("ladder exhausted");
  expect(attention?.summary).toContain("tools 1→0");
  expect(attention?.summary).toContain("risk medium→low");
  expect(attention?.summary).toContain("risk low");
  // …and the options that remain.
  expect(attention?.summary).toContain("retry, defer, or cancel");
  expect(snapshot.tasks.find((task) => task.id === "a")?.state).not.toBe("done");
}, 30_000);
