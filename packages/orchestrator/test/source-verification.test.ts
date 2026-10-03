import { beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as protocol from "@loop/protocol";
import { FakeProvider, ProviderRegistry } from "@loop/providers";
import { CompletionVerifier } from "../src/completion";
import { Orchestrator } from "../src/coordinator";

beforeAll(() => protocol.rustra.ready());

test("a passing command cannot complete when it changed the scoped source", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-source-check-"));
  const git = spawnSync("git", ["-C", directory, "init", "-q"], { encoding: "utf8" });
  if (git.status !== 0) throw new Error(git.stderr);
  writeFileSync(join(directory, "owned.ts"), "export const value = 1;\n");
  const added = spawnSync("git", ["-C", directory, "add", "owned.ts"], { encoding: "utf8" });
  if (added.status !== 0) throw new Error(added.stderr);
  const input = { databasePath: join(directory, "run.db"), runId: "source-check" };
  const verifier = new CompletionVerifier({
    run: async () => {
      writeFileSync(join(directory, "owned.ts"), "export const value = 2;\n");
      return { exitCode: 0, stdout: "passed", stderr: "", timedOut: false };
    },
  });
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 1,
    completionVerifier: verifier,
  });
  const result = await orchestrator.run({
    ...input,
    workingDirectory: directory,
    tasks: [
      {
        id: "edit",
        title: "edit",
        kind: "implementation",
        dependencies: [],
        readScope: ["owned.ts"],
        writeScope: ["owned.ts"],
        requirements: ["edit"],
        completionChecks: [
          { id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 },
        ],
        preferredCompute: "fast",
        minimumCompute: "fast",
        maximumCompute: "fast",
        maxAttempts: 1,
      },
    ],
  });
  expect(result.status).toBe("attention");
  const task = (await protocol.getSnapshot(input)).tasks[0];
  expect(task?.state).not.toBe("done");
  const context = await protocol.getTaskContext({ ...input, taskId: "edit" });
  expect(context.previousChecks[0]?.exitCode).toBe(0);
  expect(context.previousChecks[0]?.source?.beforeFingerprint).not.toBe(
    context.previousChecks[0]?.source?.afterFingerprint,
  );
  expect(context.previousFailure).toContain("Source changed during completion checks");
});

test("large check output is reachable from the durable receipt after successful storage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loop-output-check-"));
  const input = { databasePath: join(directory, "run.db"), runId: "output-check" };
  const verifier = new CompletionVerifier({
    run: async () => ({
      exitCode: 0,
      stdout: `${"useful log\n".repeat(80)}token=private-value`,
      stderr: "",
      timedOut: false,
    }),
  });
  const orchestrator = new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([new FakeProvider("fake", ["fast"])]),
    maxWorkers: 1,
    completionVerifier: verifier,
  });
  const result = await orchestrator.run({
    ...input,
    workingDirectory: directory,
    tasks: [
      {
        id: "research",
        title: "research",
        kind: "research",
        dependencies: [],
        readScope: [],
        writeScope: [],
        requirements: ["inspect"],
        completionChecks: [
          { id: "check", command: "true", args: [], workingDirectory: null, timeoutMs: 1000 },
        ],
        preferredCompute: "fast",
        minimumCompute: "fast",
        maximumCompute: "fast",
        maxAttempts: 1,
      },
    ],
  });
  expect(result.status).toBe("completed");
  const context = await protocol.getTaskContext({ ...input, taskId: "research" });
  const path = context.previousChecks[0]?.outputArtifact;
  expect(path).toContain("run.db.artifacts");
  expect(readFileSync(path!, "utf8")).not.toContain("private-value");
});
