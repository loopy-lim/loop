import { expect, test } from "bun:test";

import type { UsageRecord } from "../src/usage";
import { UsageLedger, addDecimalStrings } from "../src/usage";

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    runId: "run-1",
    taskId: "t1",
    workerId: "w1",
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: null,
      basis: "observed",
      cost: "0.01",
      currency: "USD",
    },
    occurredAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("addDecimalStrings is exact decimal arithmetic, never float money", () => {
  expect(addDecimalStrings("0.1", "0.2")).toBe("0.3");
  expect(addDecimalStrings("1.005", "2.25")).toBe("3.255");
  expect(addDecimalStrings("0.0000001", "0.0000002")).toBe("0.0000003");
  expect(addDecimalStrings("10", "0.5")).toBe("10.5");
  expect(addDecimalStrings("-1.5", "0.5")).toBe("-1.0");
  expect(() => addDecimalStrings("0.1", "abc")).toThrow();
});

test("the ledger records only reported observations and rejects dishonest figures", () => {
  const ledger = new UsageLedger();
  ledger.record(record());
  expect(ledger.records("run-1")).toHaveLength(1);
  // A run without records reports nothing (never zero-filled).
  expect(ledger.records("run-2")).toHaveLength(0);
  expect(ledger.summary("run-2").recordCount).toBe(0);
  expect(ledger.summary("run-2").bases).toEqual([]);

  expect(() => ledger.record(record({ runId: "" }))).toThrow(/runId/);
  expect(() =>
    ledger.record(record({ usage: { ...record().usage, basis: "guessed" as never } })),
  ).toThrow(/basis/);
  expect(() => ledger.record(record({ usage: { ...record().usage, inputTokens: 1.5 } }))).toThrow(
    /inputTokens/,
  );
  expect(() => ledger.record(record({ usage: { ...record().usage, cost: "1e-3" } }))).toThrow(
    /cost/,
  );
  expect(() =>
    ledger.record(record({ usage: { ...record().usage, cost: "0.5", currency: null } })),
  ).toThrow(/currency/);
});

test("totals stay basis-separated; observed figures are never merged with estimates", () => {
  const ledger = new UsageLedger();
  ledger.record(record());
  ledger.record(
    record({
      usage: {
        inputTokens: 200,
        outputTokens: null,
        cacheReadTokens: null,
        basis: "observed",
        cost: "0.02",
        currency: "USD",
      },
    }),
  );
  ledger.record(
    record({
      usage: {
        inputTokens: 999,
        outputTokens: 999,
        cacheReadTokens: null,
        basis: "estimated",
        cost: null,
        currency: null,
      },
    }),
  );

  const summary = ledger.summary("run-1");
  expect(summary.recordCount).toBe(3);
  const observed = summary.bases.find((basis) => basis.basis === "observed")!;
  const estimated = summary.bases.find((basis) => basis.basis === "estimated")!;
  expect(observed.totals.inputTokens).toBe(300);
  expect(observed.totals.outputTokens).toBe(50);
  expect(observed.totals.cost).toEqual({ USD: "0.03" });
  // Estimated totals stay isolated from the observed bucket.
  expect(estimated.totals.inputTokens).toBe(999);
  expect(Object.keys(estimated.totals)).not.toContain("cost");
});

test("per-task views omit unreported tasks and keep the same basis discipline", () => {
  const ledger = new UsageLedger();
  ledger.record(record());
  ledger.record(
    record({
      taskId: "t2",
      usage: {
        inputTokens: 5,
        outputTokens: null,
        cacheReadTokens: null,
        basis: "estimated",
        cost: null,
        currency: null,
      },
    }),
  );
  ledger.record(record({ taskId: null, workerId: null }));

  const byTask = ledger.summaryByTask("run-1");
  expect(byTask.map((entry) => entry.taskId).sort()).toEqual(["t1", "t2"]);
  const t2 = byTask.find((entry) => entry.taskId === "t2")!;
  expect(t2.summary.bases[0]!.basis).toBe("estimated");
  expect(t2.summary.bases[0]!.totals.inputTokens).toBe(5);
});
