import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as protocol from "@loop/protocol";
import type { TaskSpecInput } from "@loop/protocol";
import { FakeProvider, ProviderRegistry, type StartWorkerInput, type WorkerResult } from "@loop/providers";
import { Orchestrator } from "../src/coordinator";
import { CompletionVerifier } from "../src/completion";

beforeAll(() => protocol.rustra.ready());
const verifier = new CompletionVerifier({ run: async () => ({ exitCode: 0, stdout: "verification evidence", stderr: "", timedOut: false }) });
function fixture(id: string): TaskSpecInput {
  return { id, title: id, kind: "research", dependencies: [], readScope: ["docs/**"], writeScope: [], requirements: ["inspect evidence"], completionChecks: [{ id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 }], preferredCompute: "fast", minimumCompute: "fast", maximumCompute: "fast", maxAttempts: 2 };
}

class ScriptedProvider extends FakeProvider {
  #result: WorkerResult;
  constructor(id: string, result: WorkerResult) {
    super(id, ["fast"]);
    this.#result = result;
  }
  override async result(): Promise<WorkerResult> {
    return this.#result;
  }
}

test("a retryable connection failure on the primary lane walks the fallback chain", async () => {
  const lifecycle: string[] = [];
  class Primary extends FakeProvider {
    override async result(): Promise<WorkerResult> {
      return { success: false, summary: "Error: Connection error.", failure: { kind: "process_error" as const, retryable: true } };
    }
    async release() { lifecycle.push("released"); }
  }
  class Fallback extends FakeProvider {
    override async start(startInput: StartWorkerInput) {
      lifecycle.push("fallback");
      return super.start(startInput);
    }
  }
  const primary = new Primary("zai", ["fast"]);
  const fallback = new Fallback("openai-codex", ["fast"]);
  const directory = mkdtempSync(join(tmpdir(), "loop-fallback-transition-"));
  const input = { databasePath: join(directory, "run.db"), runId: "fallback-transition" };
  const orchestrator = new Orchestrator({ control: protocol, providers: new ProviderRegistry([primary, fallback], { zai: { costWeight: 1, latency: 1 }, "openai-codex": { costWeight: 3, latency: 2 } }), maxWorkers: 1, completionVerifier: verifier });
  const result = await orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory });
  expect(result.status).toBe("completed");
  expect(result.providersByTask.a).toEqual(["zai", "openai-codex"]);
  expect(lifecycle).toEqual(["released", "fallback"]);
  expect((await protocol.getSnapshot(input)).openAttentionIds).toEqual([]);
});

test("an exhausted fallback chain stops the run clearly instead of hanging", async () => {
  const primary = new ScriptedProvider("zai", { success: false, summary: "Error: Connection error.", failure: { kind: "process_error" as const, retryable: true } });
  const fallback = new ScriptedProvider("openai-codex", { success: false, summary: "Error: Connection error.", failure: { kind: "process_error" as const, retryable: true } });
  const directory = mkdtempSync(join(tmpdir(), "loop-fallback-exhausted-"));
  const input = { databasePath: join(directory, "run.db"), runId: "fallback-exhausted" };
  const orchestrator = new Orchestrator({ control: protocol, providers: new ProviderRegistry([primary, fallback], { zai: { costWeight: 1, latency: 1 }, "openai-codex": { costWeight: 3, latency: 2 } }), maxWorkers: 1, completionVerifier: verifier });
  const result = await orchestrator.run({ ...input, tasks: [fixture("a")], workingDirectory: directory });
  expect(result.status).toBe("attention");
  expect(result.providersByTask.a).toEqual(["zai", "openai-codex"]);
  const snapshot = await protocol.getSnapshot(input);
  expect(snapshot.activeWorkers).toEqual([]);
  expect(snapshot.attention.some(item => item.summary.includes("fallback exhausted"))).toBe(true);
});
