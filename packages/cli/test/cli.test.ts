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

test("loop run starts the interactive Loop agent in the current terminal", async () => {
  const capture = output();
  const invocations: unknown[] = [];
  const exitCode = await runCli(
    ["run", "Implement", "feature", "X", "--config", join(root, "config")],
    {
      io: capture.io,
      leadRunner: async (input: unknown) => {
        invocations.push(input);
        return 0;
      },
      executablePath: "/opt/loop/loop",
    },
  );

  expect(exitCode).toBe(0);
  expect(invocations).toEqual([{
    command: "pi",
    args: [
      "--no-extensions",
      "--extension",
      "/opt/loop/loop-pi-extension.js",
      "--provider",
      "zai",
      "--model",
      "glm-5.3-flash",
      "--",
      "Implement feature X",
    ],
    cwd: process.cwd(),
  }]);
  expect(capture.stdout()).toBe("");
});

test("interactive Loop agent loads only its adjacent extension", async () => {
  const cli = await import("../src/main") as typeof import("../src/main") & {
    buildInteractiveLeadInvocation?: (input: {
      command: string;
      provider: string;
      model: string;
      intent: string;
      cwd: string;
      executablePath: string;
      environment: Record<string, string | undefined>;
    }) => { command: string; args: string[]; cwd: string };
  };

  expect(cli.buildInteractiveLeadInvocation?.({
    command: "pi",
    provider: "zai",
    model: "glm-5.3-flash",
    intent: "",
    cwd: "/project",
    executablePath: "/usr/local/bin/loop",
    environment: { LOOP_PI_EXTENSION: "/tmp/override.js" },
  })).toEqual({
    command: "pi",
    args: [
      "--no-extensions",
      "--extension",
      "/tmp/override.js",
      "--provider",
      "zai",
      "--model",
      "glm-5.3-flash",
    ],
    cwd: "/project",
  });
});

test("bare loop starts the interactive Loop agent without launching or attaching Herdr", async () => {
  const capture = output();
  const invocations: unknown[] = [];
  const exitCode = await runCli(
    ["--config", join(root, "config")],
    {
      io: capture.io,
      leadRunner: async (input: unknown) => {
        invocations.push(input);
        return 0;
      },
      executablePath: "/opt/loop/loop",
    },
  );

  expect(exitCode).toBe(0);
  expect(invocations).toEqual([{
    command: "pi",
    args: [
      "--no-extensions",
      "--extension",
      "/opt/loop/loop-pi-extension.js",
      "--provider",
      "zai",
      "--model",
      "glm-5.3-flash",
    ],
    cwd: process.cwd(),
  }]);
  expect(capture.stdout()).toBe("");
  expect(capture.stderr()).toBe("");
});

test("doctor auth checks native stores without requesting or printing credentials", async () => {
  const capture = output();
  const probed: Array<[string, string[]]> = [];
  const exitCode = await runCli(
    ["doctor", "--auth", "--config", join(root, "config"), "--json"],
    {
      io: capture.io,
      probe: async (command, args) => {
        probed.push([command, args]);
        return { exitCode: 0, output: `${command} ready` };
      },
    },
  );

  expect(exitCode).toBe(0);
  expect(probed).toContainEqual([
    "pi",
    [
      "auth",
      "check",
      "--provider",
      "zai",
      "--model",
      "glm-5.3-flash",
      "--json",
      "--no-refresh",
    ],
  ]);
  expect(probed).toContainEqual(["pi", ["--version"]]);
  expect(probed.flat(2)).not.toContain("login");
  expect(probed.flat(2)).not.toContain("--credentials");
  const report = JSON.parse(capture.stdout()) as {
    checks: Array<{ name: string; ok: boolean; auth?: string }>;
  };
  expect(report.checks).toContainEqual(
    expect.objectContaining({ name: "pi", ok: true, auth: "ready" }),
  );
  expect(report.checks.some((check) => check.name === "codex")).toBe(false);
  expect(report.checks.some((check) => check.name === "antigravity")).toBe(false);
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
