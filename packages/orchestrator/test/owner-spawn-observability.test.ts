import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as protocol from "@loop/protocol";
import type { TaskSpecInput } from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";
import { Orchestrator } from "../src/coordinator";
import type { OrchestrationControl } from "../src/control";
import { CompletionVerifier } from "../src/completion";

beforeAll(() => protocol.rustra.ready());
const verifier = new CompletionVerifier({
  run: async () => ({ exitCode: 0, stdout: "verification evidence", stderr: "", timedOut: false }),
});

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

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

function setup(overrides: Record<string, unknown> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "loop-owner-spawn-"));
  const input = { databasePath: join(directory, "run.db"), runId: "owner-spawn" };
  const control = { ...protocol, ...overrides } as OrchestrationControl;
  const orchestrator = new Orchestrator({
    control,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 2,
    completionVerifier: verifier,
  });
  return { input, orchestrator };
}

/**
 * Proposal 1 (ADR 2026-xx-proposal-approval-cycle): a detached owner spawn
 * (`spawnOwner`, detached + stdio "ignore") is structurally silent, so its
 * outcome must land in saved state — a durable failure attention when owner
 * startup dies, a durable takeover record when it succeeds — or a resume
 * caller is left with a ghost `active` run.
 */

test("owner startup failure raises an immediate durable failure attention and still rejects", async () => {
  const { input, orchestrator } = setup({
    claimExecution: async () => {
      throw new Error("lease store unavailable");
    },
  });
  await orchestrator.prepare({ ...input, tasks: [fixture("a")] });

  // The original startup error still reaches the caller (never masked).
  await expect(orchestrator.execute(input)).rejects.toThrow("lease store unavailable");

  // The run is parked in attention — not a ghost `active` — with a run-level
  // failure attention naming the reason, resolvable via `loop resolve ... retry`.
  const snapshot = await protocol.getSnapshot(input);
  expect(snapshot.state).toBe("attention");
  const spawn = snapshot.attention.find((item) => item.id.startsWith("owner-spawn-"));
  expect(spawn).toBeDefined();
  expect(spawn?.kind).toBe("failure");
  expect(spawn?.summary).toContain("failed to start dispatch of run owner-spawn");
  expect(spawn?.summary).toContain("lease store unavailable");
  // Run-level: no task is blamed for the owner's own death.
  expect(spawn?.taskId ?? null).toBeNull();
  expect(snapshot.openAttentionIds).toContain(must(spawn).id);
}, 30_000);

test("a failed spawn on a missing run cannot record and must not mask the error", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-owner-spawn-missing-"));
  const input = { databasePath: join(directory, "run.db"), runId: "missing" };
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 1,
    completionVerifier: verifier,
  });

  // getRunPlan fails (run_not_found) and the best-effort attention also
  // fails (same missing projection) — the startup error must still surface.
  await expect(orchestrator.execute(input)).rejects.toThrow();
}, 30_000);

test("a successful owner spawn leaves a durable takeover record", async () => {
  const { input, orchestrator } = setup();
  await orchestrator.prepare({ ...input, tasks: [fixture("a")] });

  const summary = await orchestrator.execute(input);
  expect(summary.status).toBe("completed");

  const snapshot = await protocol.getSnapshot(input);
  expect(snapshot.state).toBe("completed");
  expect(snapshot.openAttentionIds).toEqual([]);
  const takeover = snapshot.tasks[0]?.activities.find((line) =>
    line.startsWith("Execution owner "),
  );
  expect(takeover).toBeDefined();
  expect(takeover).toContain(`took over dispatch of run ${input.runId}`);
  // The record ties a real process identity to the run (pid:uuid owner).
  expect(takeover).toMatch(/^Execution owner \d+:[0-9a-f-]+ took over dispatch/);
}, 60_000);

test("a bystander owner that never claims the lease reports neither takeover nor failure", async () => {
  const { input, orchestrator } = setup({
    claimExecution: async () => ({ accepted: false }),
  });
  await orchestrator.prepare({ ...input, tasks: [fixture("a")] });

  // Another (possibly healthy) owner holds the lease: the bystander returns
  // a running summary without parking the run or claiming a takeover.
  const summary = await orchestrator.execute(input);
  expect(summary.status).toBe("running");

  const snapshot = await protocol.getSnapshot(input);
  expect(snapshot.state).toBe("active");
  expect(snapshot.openAttentionIds).toEqual([]);
  expect(
    snapshot.tasks[0]?.activities.some((line) => line.startsWith("Execution owner ")),
  ).toBe(false);
}, 30_000);
