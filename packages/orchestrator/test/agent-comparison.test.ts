import { beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as protocol from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";
import { runAgentComparison } from "../src/agent-comparison";

beforeAll(() => protocol.rustra.ready());

function git(root: string, ...args: string[]) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
}

test("agent comparison runs each provider against an isolated copy of one clean commit", async () => {
  const source = mkdtempSync(join(tmpdir(), "loop-agent-source-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "loop-agent-trials-"));
  git(source, "init", "-q");
  writeFileSync(join(source, "result.txt"), "unchanged\n");
  git(source, "add", "result.txt");
  git(source, "-c", "user.name=Loop Test", "-c", "user.email=loop@example.invalid", "commit", "-qm", "fixture");
  const task = {
    id: "inspect", title: "Inspect", kind: "verification" as const, dependencies: [], readScope: ["result.txt"], writeScope: [],
    requirements: ["result remains unchanged"],
    completionChecks: [{ id: "content", command: "cat", args: ["result.txt"], workingDirectory: null, timeoutMs: 1000 }],
    preferredCompute: "fast" as const, minimumCompute: "fast" as const, maximumCompute: "fast" as const, maxAttempts: 1,
    routing: { risk: "low" as const, required: { coding: 0, reasoning: 0, tools: 0, vision: 0, long_context: 0 } },
  };
  const report = await runAgentComparison({
    control: protocol, providers: new ProviderRegistry([new FakeProvider("agent-a", ["fast"]), new FakeProvider("agent-b", ["fast"])]),
    databasePath: join(workspaceRoot, "runs.db"), sourceDirectory: source, workspaceRoot,
    name: "same-task", intent: "Inspect the file", tasks: [task],
    criteria: [{ id: "unchanged", taskId: "inspect", description: "result remains unchanged", checkIds: ["content"] }],
    candidateIds: ["agent-a", "agent-b"], iterations: 1,
  });
  expect(report.rows.map(row => row.providerId)).toEqual(["agent-a", "agent-b"]);
  expect(report.rows.map(row => row.verifiedCriteria)).toEqual([1, 1]);
  expect(report.rows.every(row => row.status === "completed" && row.scopeViolations.length === 0)).toBe(true);
  expect(report.rows[0]!.workspace).not.toBe(report.rows[1]!.workspace);
  expect(report.rows[0]!.sourceCommit).toBe(report.rows[1]!.sourceCommit);
  expect(report.rows.every(row => row.elapsedMs >= 0)).toBe(true);
});
