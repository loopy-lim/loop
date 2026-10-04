import { beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "@loop/protocol";
import type { TaskSpecInput } from "@loop/protocol";
import type {
  AgentProvider,
  ProviderCapabilities,
  StartWorkerInput,
  WorkerResult,
} from "@loop/providers";
import { ProviderRegistry } from "@loop/providers";
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

function spec(id: string, dependencies: string[]): TaskSpecInput {
  return {
    id,
    title: id,
    kind: "implementation",
    dependencies,
    readScope: ["owned.ts"],
    writeScope: [`${id}.ts`],
    requirements: [id === "edit" ? "check passes" : "corrected behavior works"],
    completionChecks: [
      { id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 },
    ],
    preferredCompute: "fast",
    minimumCompute: "fast",
    maximumCompute: "fast",
    maxAttempts: 2,
  };
}

async function until(predicate: () => boolean | Promise<boolean>, deadlineMs = 8000) {
  const deadline = Date.now() + deadlineMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition timed out");
    await Bun.sleep(5);
  }
}

/**
 * Full-control provider whose workers park until the test releases them, and
 * whose start observes a real out-of-scope source change (the way shared-tree
 * noise shows up in receipts). Task checks pass, but criterion verification
 * blocks until the verification flow's stable-source re-run replaces the
 * receipts.
 */
class ParkedNoisyProvider implements AgentProvider {
  readonly id = "parked-noisy";
  readonly started: StartWorkerInput[] = [];
  readonly #resolvers = new Map<string, (result: WorkerResult) => void>();
  constructor(private readonly directory: string) {}
  async capabilities(): Promise<ProviderCapabilities> {
    return {
      available: true,
      computeClasses: ["fast"],
      tools: false,
      vision: false,
      structuredOutput: false,
      resumableSession: false,
    };
  }
  async start(input: StartWorkerInput) {
    const id = `${this.id}-${this.started.length}`;
    this.started.push(input);
    writeFileSync(join(this.directory, "other.txt"), `noise ${this.started.length}\n`);
    return { id };
  }
  async cancel(workerId: string) {
    const resolve = this.#resolvers.get(workerId);
    this.#resolvers.delete(workerId);
    resolve?.({
      success: false,
      summary: "cancelled",
      failure: { kind: "cancelled", retryable: false },
    });
  }
  async status(workerId: string): Promise<"running" | "completed"> {
    return this.#resolvers.has(workerId) ? "running" : "completed";
  }
  result(workerId: string): Promise<WorkerResult> {
    return new Promise((resolve) => {
      this.#resolvers.set(workerId, resolve);
    });
  }
  release(workerId: string): Promise<void> {
    const resolve = this.#resolvers.get(workerId);
    this.#resolvers.delete(workerId);
    resolve?.({ success: true, summary: "parked work complete" });
    return Promise.resolve();
  }
}

test("checks of a steer-promoted criterion are re-run once and the promoted criterion completes the run", async () => {
  const directory = repository("loop-steer-promotion-");
  const input = { databasePath: join(directory, "run.db"), runId: "steer-promotion-completes" };
  const provider = new ParkedNoisyProvider(directory);
  let batches = 0;
  const verifier = new CompletionVerifier({
    run: async () => {
      batches++;
      return { exitCode: 0, stdout: "passed", stderr: "", timedOut: false };
    },
  });
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([provider]),
    maxWorkers: 1,
    completionVerifier: verifier,
  });
  const pending = orchestrator.run({
    ...input,
    workingDirectory: directory,
    tasks: [spec("edit", [])],
    criteria: [
      { id: "acceptance", description: "check passes", taskId: "edit", checkIds: ["check"] },
    ],
  });
  await until(() => provider.started.length === 1);

  // Mid-run user condition: promoted into the goal graph as a new criterion
  // bound to a new dependent task (the bridge's atomic promotion batch).
  const promoted = await protocol.promoteSteer({
    ...input,
    message: "also cover the corrected behavior",
    task: spec("correction", ["edit"]),
    criteria: [
      {
        id: "steer-criterion",
        description: "corrected behavior works",
        taskId: "correction",
        checkIds: ["check"],
      },
    ],
  });
  expect(promoted.accepted).toBe(true);
  expect(promoted.criterionIds).toEqual(["steer-criterion"]);

  provider.release("parked-noisy-0"); // "edit" finishes; its verification runs
  await until(() => provider.started.length === 2); // "correction" claimed after "edit" verified
  provider.release("parked-noisy-1");
  const result = await pending;

  const snapshot = await protocol.getSnapshot(input);
  expect(result.status).toBe("completed");
  expect(snapshot.state).toBe("completed");
  expect(snapshot.openAttentionIds).toHaveLength(0);
  expect(snapshot.goalCriteria).toMatchObject([
    { id: "acceptance", state: "verified" },
    { id: "steer-criterion", state: "verified" },
  ]);
  const correction = snapshot.tasks.find((task) => task.id === "correction");
  expect(correction?.activities.join("\n")).toContain("Self-heal: re-ran declared checks");
  // Worker batch plus exactly one stable-source re-run per task: the
  // promoted criterion's check was re-run by the orchestrator, not skipped.
  expect(batches).toBe(4);
  rmSync(directory, { recursive: true, force: true });
});
