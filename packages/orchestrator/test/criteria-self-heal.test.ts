import { beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";
import { CompletionVerifier } from "../src/completion";
import { Orchestrator } from "../src/coordinator";

beforeAll(() => protocol.rustra.ready());

function repository(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), name));
  const git = spawnSync("git", ["-C", directory, "init", "-q"], { encoding: "utf8" });
  if (git.status !== 0) throw new Error(git.stderr);
  writeFileSync(join(directory, "owned.ts"), "export const value = 1;\n");
  const added = spawnSync("git", ["-C", directory, "add", "owned.ts"], { encoding: "utf8" });
  if (added.status !== 0) throw new Error(added.stderr);
  return directory;
}

function spec(): Parameters<InstanceType<typeof Orchestrator>["run"]>[0]["tasks"] {
  return [
    {
      id: "edit",
      title: "edit",
      kind: "implementation",
      dependencies: [],
      readScope: ["owned.ts"],
      writeScope: ["owned.ts"],
      requirements: ["check passes"],
      completionChecks: [
        { id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 },
      ],
      preferredCompute: "fast",
      minimumCompute: "fast",
      maximumCompute: "fast",
      maxAttempts: 3,
    },
  ];
}

/**
 * A provider whose worker start observes a source change outside the task's
 * write scope (the way shared-tree noise shows up in receipts). The check
 * batch itself stays stable, so task verification passes while criterion
 * verification blocks on the out-of-scope observation.
 */
class NoisyProvider extends FakeProvider {
  constructor(
    readonly directory: string,
    ...args: ConstructorParameters<typeof FakeProvider>
  ) {
    super(...args);
  }
  override async start(input: Parameters<FakeProvider["start"]>[0]) {
    writeFileSync(join(this.directory, "other.txt"), "noise\n");
    return super.start(input);
  }
}

/**
 * Batches that keep producing a real out-of-scope content change while they
 * run, so a single self-heal pass cannot rescue the criterion.
 */
function outsideScopeVerifier(directory: string, writeNoise: boolean) {
  let batch = 0;
  const verifier = new CompletionVerifier({
    run: async () => {
      batch++;
      if (writeNoise) writeFileSync(join(directory, "other.txt"), `more noise ${batch}\n`);
      return { exitCode: 0, stdout: "passed", stderr: "", timedOut: false };
    },
  });
  return { verifier, batchesRun: () => batch };
}

test("pending criteria checks are re-run once on stable source and the run completes without attention", async () => {
  const directory = repository("loop-self-heal-");
  const input = { databasePath: join(directory, "run.db"), runId: "self-heal-completes" };
  const { verifier, batchesRun } = outsideScopeVerifier(directory, false);
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new NoisyProvider(directory, "fake", ["fast"])]),
    maxWorkers: 1,
    completionVerifier: verifier,
  });
  const result = await orchestrator.run({
    ...input,
    workingDirectory: directory,
    tasks: spec(),
    criteria: [
      { id: "acceptance", description: "check passes", taskId: "edit", checkIds: ["check"] },
    ],
  });
  const snapshot = await protocol.getSnapshot(input);
  expect(result.status).toBe("completed");
  expect(snapshot.state).toBe("completed");
  expect(snapshot.openAttentionIds).toHaveLength(0);
  expect(snapshot.goalCriteria).toMatchObject([{ id: "acceptance", state: "verified" }]);
  expect(snapshot.tasks[0]?.activities.join("\n")).toContain("Self-heal: re-ran declared checks");
  expect(batchesRun()).toBe(2);
  rmSync(directory, { recursive: true, force: true });
});

test("criteria that stay unverified after the self-heal pass still raise the blocked-goal attention", async () => {
  const directory = repository("loop-self-heal-blocked-");
  const input = { databasePath: join(directory, "run.db"), runId: "self-heal-blocked" };
  const { verifier, batchesRun } = outsideScopeVerifier(directory, true);
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new NoisyProvider(directory, "fake", ["fast"])]),
    maxWorkers: 1,
    completionVerifier: verifier,
  });
  const result = await orchestrator.run({
    ...input,
    workingDirectory: directory,
    tasks: spec(),
    criteria: [
      { id: "acceptance", description: "check passes", taskId: "edit", checkIds: ["check"] },
    ],
  });
  const snapshot = await protocol.getSnapshot(input);
  expect(result.status).toBe("attention");
  expect(snapshot.state).toBe("attention");
  expect(snapshot.goalCriteria).toMatchObject([{ id: "acceptance", state: "pending" }]);
  expect(snapshot.openAttentionIds.some((id) => id.startsWith(`blocked-${input.runId}`))).toBe(
    true,
  );
  expect(snapshot.attention[0]?.summary).toContain("goal criteria remain unverified");
  expect(snapshot.tasks[0]?.activities.join("\n")).toContain("Self-heal: re-ran declared checks");
  // The self-heal re-ran the checks exactly once (worker batch + one pass).
  expect(batchesRun()).toBe(2);
  rmSync(directory, { recursive: true, force: true });
});
