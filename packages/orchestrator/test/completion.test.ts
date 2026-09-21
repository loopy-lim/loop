import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CompletionVerifier, NodeCompletionRunner } from "../src/completion";

test("executes completion commands as argv without a shell", async () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "loop-completion-"));
  const verifier = new CompletionVerifier(new NodeCompletionRunner());
  const [result] = await verifier.verify(
    [
      {
        id: "literal-argv",
        command: process.execPath,
        args: [
          "--eval",
          "if (Bun.argv.at(-1) !== 'literal $(not-a-shell)') process.exit(9)",
          "literal $(not-a-shell)",
        ],
        workingDirectory: null,
        timeoutMs: 2_000,
      },
    ],
    rootDirectory,
  );

  expect(result?.passed).toBe(true);
  expect(result?.exitCode).toBe(0);
});

test("reports non-zero exits and timeouts as failed evidence", async () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "loop-completion-"));
  const verifier = new CompletionVerifier(new NodeCompletionRunner());
  const results = await verifier.verify(
    [
      {
        id: "failure",
        command: process.execPath,
        args: ["--eval", "console.error('expected failure'); process.exit(7)"],
        workingDirectory: null,
        timeoutMs: 2_000,
      },
      {
        id: "timeout",
        command: process.execPath,
        args: ["--eval", "setInterval(() => {}, 1000)"],
        workingDirectory: null,
        timeoutMs: 25,
      },
    ],
    rootDirectory,
  );

  expect(results[0]).toMatchObject({ id: "failure", passed: false, exitCode: 7 });
  expect(results[1]).toMatchObject({ id: "timeout", passed: false, timedOut: true });
});

test("rejects completion working directories outside the project", async () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "loop-completion-"));
  const verifier = new CompletionVerifier(new NodeCompletionRunner());

  await expect(
    verifier.verify(
      [
        {
          id: "escape",
          command: "true",
          args: [],
          workingDirectory: "../outside",
          timeoutMs: 1_000,
        },
      ],
      rootDirectory,
    ),
  ).rejects.toThrow(/outside the project root/);
});
