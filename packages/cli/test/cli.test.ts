import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import * as protocol from "@loop/protocol";
import { runCli, type CliIo } from "../src/main";

const root = resolve(import.meta.dir, "../../..");

test("help is available without configuration or native initialization", async () => {
  const capture = output();
  const exitCode = await runCli(["--help"], { io: capture.io });

  expect(exitCode).toBe(0);
  expect(capture.stdout()).toContain("Loop — dependency-aware engineering scheduler");
  expect(capture.stdout()).toContain("loop status <run-id>");
  expect(capture.stderr()).toBe("");
});

test("invalid commands use a stable usage exit code", async () => {
  const capture = output();
  const exitCode = await runCli(["unknown-command"], { io: capture.io });

  expect(exitCode).toBe(2);
  expect(capture.stderr()).toContain("unknown command");
});

test("status reads persisted Rust state and emits machine-readable JSON", async () => {
  await protocol.rustra.ready();
  const databasePath = join(mkdtempSync(join(tmpdir(), "loop-cli-status-")), "loop.sqlite");
  await protocol.createRun({ databasePath, runId: "cli-status" });
  const capture = output();

  const exitCode = await runCli(
    [
      "status",
      "cli-status",
      "--config",
      join(root, "config"),
      "--database",
      databasePath,
      "--json",
    ],
    { io: capture.io },
  );

  expect(exitCode).toBe(0);
  expect(JSON.parse(capture.stdout())).toMatchObject({ runId: "cli-status", state: "active" });
});

test("doctor checks installed commands without invoking a model", async () => {
  const capture = output();
  const probed: Array<[string, string[]]> = [];
  const exitCode = await runCli(
    ["doctor", "--config", join(root, "config"), "--json"],
    {
      io: capture.io,
      probe: async (command, args) => {
        probed.push([command, args]);
        return { exitCode: command === "pi" ? 1 : 0, output: `${command} test-version` };
      },
    },
  );

  expect(exitCode).toBe(1);
  const report = JSON.parse(capture.stdout()) as { checks: Array<{ name: string; ok: boolean }> };
  expect(report.checks).toContainEqual(expect.objectContaining({ name: "rustra", ok: true }));
  expect(report.checks).toContainEqual(expect.objectContaining({ name: "pi", ok: false }));
  expect(probed.every(([, args]) => args.length === 1 && args[0] === "--version")).toBe(true);
});

test("run launches the Pi Lead through the injected Herdr boundary", async () => {
  const capture = output();
  const launches: unknown[] = [];
  const exitCode = await runCli(
    ["run", "Implement", "feature", "X", "--config", join(root, "config"), "--json"],
    {
      io: capture.io,
      leadLauncher: async (input) => {
        launches.push(input);
        return { workerId: "lead-1", workspaceId: "workspace-1", paneId: "pane-1" };
      },
    },
  );

  expect(exitCode).toBe(0);
  expect(launches).toHaveLength(1);
  expect(launches[0]).toMatchObject({ intent: "Implement feature X" });
  expect(JSON.parse(capture.stdout())).toMatchObject({
    state: "lead_started",
    workerId: "lead-1",
  });
});

test("offline installation verification proves the fake-provider milestone", async () => {
  const capture = output();
  const exitCode = await runCli(["verify-install", "--json"], { io: capture.io });

  expect(exitCode).toBe(0);
  expect(JSON.parse(capture.stdout())).toEqual({
    status: "completed",
    tasks: 7,
    maxConcurrent: 3,
    escalations: 1,
  });
});

function output(): {
  io: CliIo;
  stdout(): string;
  stderr(): string;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    },
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
  };
}
