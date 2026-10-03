import { describe, expect, test } from "bun:test";

import {
  extractWorkerJsonResult,
  jsonOutputSection,
  enforceOutputContract,
} from "../src/json-output";
import { buildWorkerPrompt } from "../src/prompt";
import { normalizeProcessResult } from "../src/process-provider";
import type { StartWorkerInput } from "../src/types";

const input: StartWorkerInput = {
  runId: "run-1",
  taskId: "task-1",
  title: "task",
  kind: "implementation",
  computeClass: "fast",
  attempt: 0,
  requirements: ["report as json"],
  workingDirectory: "/project/task",
  output: { format: "json", requireValid: true },
  context: {
    intent: "CONTEXT_INTENT_ONLY",
    workingDirectory: "/project/task",
    attempt: 0,
    task: {
      id: "task-1",
      title: "Context task title",
      kind: "implementation",
      dependencies: [],
      readScope: ["packages/providers/**"],
      writeScope: ["packages/providers/src/**"],
      requirements: ["Use generated context"],
      completionChecks: [],
      preferredCompute: "fast",
      minimumCompute: "deterministic",
      maximumCompute: "frontier",
      maxAttempts: 2,
    },
    guidance: [],
    dependencyResults: [],
    previousChecks: [],
  },
};

describe("worker JSON output contract (G16)", () => {
  test("prompt carries the output contract as an essential section", () => {
    const prompt = buildWorkerPrompt(input);
    expect(prompt).toContain("Output contract:");
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain("unparseable JSON object as an incomplete result");
  });

  test("schema hint and non-enforcing contract render without the enforcement line", () => {
    const section = jsonOutputSection({ format: "json", schemaHint: "extra: string" });
    expect(section).toContain("Schema hint: extra: string");
    expect(section).not.toContain("incomplete result");
  });

  test("extraction finds the last summary-bearing JSON object", () => {
    const output = [
      "working on it...",
      '{"noise": true}',
      '{"summary": "all good", "changed_files": ["a.ts"], "checks_run": ["bun test"], "risks": ["none"], "session_id": "s-9"}',
    ].join("\n");
    const parsed = extractWorkerJsonResult(output);
    expect(parsed?.summary).toBe("all good");
    expect(parsed?.changedFiles).toEqual(["a.ts"]);
    expect(parsed?.sessionId).toBe("s-9");
  });

  test("extraction ignores JSON objects without a summary", () => {
    expect(extractWorkerJsonResult('{"noise": true}\nplain text')).toBeUndefined();
  });

  test("a parsed JSON result replaces the text summary and carries evidence", () => {
    const base = normalizeProcessResult({ exitCode: 0, stdout: "text done", stderr: "" });
    const enforced = enforceOutputContract(
      base,
      { format: "json" },
      'step one\n{"summary": "json done", "changed_files": ["x.ts"], "risks": ["watch y"]}',
    );
    expect(enforced.success).toBe(true);
    expect(enforced.summary).toContain("json done");
    expect(enforced.summary).toContain("changed_files: x.ts");
    expect(enforced.summary).toContain("risks: watch y");
  });

  test("requireValid fails an unparseable result as retryable incomplete output", () => {
    const base = normalizeProcessResult({ exitCode: 0, stdout: "text only, no json", stderr: "" });
    const enforced = enforceOutputContract(
      base,
      { format: "json", requireValid: true },
      "text only, no json",
    );
    expect(enforced.success).toBe(false);
    expect(enforced.failure).toEqual({ kind: "incomplete_output", retryable: true });
  });

  test("without a contract the normalized result keeps the exact legacy behavior", () => {
    const result = normalizeProcessResult({
      exitCode: 0,
      stdout: 'prefix\n{"type":"item.completed","item":{"type":"agent_message","text":"done"}}',
      stderr: "",
    });
    expect(result).toEqual({ success: true, summary: "done", sessionId: undefined });
  });

  test("normalizeProcessResult applies the contract end-to-end", () => {
    const result = normalizeProcessResult(
      { exitCode: 0, stdout: 'log line\n{"summary": "json summary"}', stderr: "" },
      { format: "json" },
    );
    expect(result.success).toBe(true);
    expect(result.summary).toBe("json summary");
  });
});
