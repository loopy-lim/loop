import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

test("cancellation stops verification and preserves redacted evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "loop-check-cancel-"));
  const stop = new AbortController();
  const pending = new NodeCompletionRunner().run(
    process.execPath,
    ["--eval", "console.log('api_key=secret');setInterval(() => {}, 1000)"],
    { cwd: root, timeoutMs: 10000, signal: stop.signal },
  );
  setTimeout(() => stop.abort(), 80);
  const result = await pending;
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout).not.toContain("secret");
  expect(result.timedOut).toBe(false);
});

test("completion checks do not inherit the Loop executable's private native bridge path", async () => {
  const root = mkdtempSync(join(tmpdir(), "loop-check-env-"));
  const library =
    process.platform === "darwin"
      ? "libloop_bridge.dylib"
      : process.platform === "win32"
        ? "loop_bridge.dll"
        : "libloop_bridge.so";
  const internal = join(dirname(process.execPath), library);
  const previous = process.env.RUSTRA_BUN_LIBRARY;
  try {
    process.env.RUSTRA_BUN_LIBRARY = internal;
    const result = await new NodeCompletionRunner().run(
      process.execPath,
      ["--eval", "console.log(process.env.RUSTRA_BUN_LIBRARY ?? 'unset')"],
      { cwd: root, timeoutMs: 2_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("unset");
  } finally {
    if (previous === undefined) delete process.env.RUSTRA_BUN_LIBRARY;
    else process.env.RUSTRA_BUN_LIBRARY = previous;
  }
});

test("completion checks preserve a project-selected native bridge path", async () => {
  const root = mkdtempSync(join(tmpdir(), "loop-check-env-"));
  const previous = process.env.RUSTRA_BUN_LIBRARY;
  try {
    process.env.RUSTRA_BUN_LIBRARY = "/project/target/debug/libloop_bridge.dylib";
    const result = await new NodeCompletionRunner().run(
      process.execPath,
      ["--eval", "console.log(process.env.RUSTRA_BUN_LIBRARY ?? 'unset')"],
      { cwd: root, timeoutMs: 2_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("/project/target/debug/libloop_bridge.dylib");
  } finally {
    if (previous === undefined) delete process.env.RUSTRA_BUN_LIBRARY;
    else process.env.RUSTRA_BUN_LIBRARY = previous;
  }
});
