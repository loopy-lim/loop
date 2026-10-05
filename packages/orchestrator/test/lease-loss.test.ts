import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as protocol from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";
import { Orchestrator } from "../src/coordinator";
import type { OrchestrationControl } from "../src/control";

beforeAll(() => protocol.rustra.ready());

const task = {
  id: "a", title: "a", kind: "research" as const, dependencies: [],
  readScope: ["docs/**"], writeScope: [], requirements: ["inspect"],
  completionChecks: [{ id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 }],
  preferredCompute: "fast" as const, minimumCompute: "fast" as const,
  maximumCompute: "fast" as const, maxAttempts: 2,
};

function setup(overrides: Record<string, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), "loop-lease-loss-"));
  const input = { databasePath: join(directory, "run.db"), runId: "lease-loss" };
  const control = { ...protocol, ...overrides } as OrchestrationControl;
  const orchestrator = new Orchestrator({
    control,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 1,
  });
  return { input, orchestrator };
}

test("lost lease records a durable hand-off rather than returning an unowned active run", async () => {
  const { input, orchestrator } = setup({
    renewExecution: async () => ({ accepted: false }),
    recycleInterruptedExecution: async () => {
      await Bun.sleep(1200);
      throw new Error("dispatch interrupted");
    },
  });
  await orchestrator.prepare({ ...input, tasks: [task] });
  await orchestrator.execute(input);
  const snapshot = await protocol.getSnapshot(input);
  expect(snapshot.state).toBe("attention");
  expect(snapshot.openAttentionIds.length).toBeGreaterThan(0);
}, 10_000);

test("transient snapshot failure inside dispatcher catch retries to persist attention", async () => {
  let reads = 0;
  const { input, orchestrator } = setup({
    recycleInterruptedExecution: async () => { throw new Error("dispatch interrupted"); },
    getSnapshot: async (request: Parameters<OrchestrationControl["getSnapshot"]>[0]) => {
      if (reads++ === 0) throw new Error("snapshot unavailable");
      return protocol.getSnapshot(request);
    },
  });
  await orchestrator.prepare({ ...input, tasks: [task] });
  await orchestrator.execute(input);
  expect((await protocol.getSnapshot(input)).state).toBe("attention");
});

test("transient attention write failure inside dispatcher catch retries to persist attention", async () => {
  let writes = 0;
  const { input, orchestrator } = setup({
    recycleInterruptedExecution: async () => { throw new Error("dispatch interrupted"); },
    requestAttention: async (request: Parameters<OrchestrationControl["requestAttention"]>[0]) => {
      if (writes++ === 0) throw new Error("attention unavailable");
      return protocol.requestAttention(request);
    },
  });
  await orchestrator.prepare({ ...input, tasks: [task] });
  await orchestrator.execute(input);
  expect((await protocol.getSnapshot(input)).state).toBe("attention");
});
