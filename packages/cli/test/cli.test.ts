import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import * as protocol from "@loop/protocol";
import {
  buildSteerRelayCommand,
  formatDoctorChecks,
  formatModelList,
  formatSnapshot,
  runCli,
  type CliIo,
} from "../src/main";

const root = resolve(import.meta.dir, "../../..");

test("help is available without configuration or native initialization", async () => {
  const capture = output();
  const exitCode = await runCli(["--help"], { io: capture.io });

  expect(exitCode).toBe(0);
  expect(capture.stdout()).toContain("Loop — dependency-aware engineering scheduler");
  expect(capture.stdout()).toContain("loop status [run-id]");
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
      "openai-codex",
      "--model",
      "gpt-6-sol",
      "--",
      "Implement feature X",
    ],
    cwd: process.cwd(),
    configDirectory: join(root, "config"),
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
    model: "glm-5.3-flashx",
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
      "glm-5.3-flashx",
    ],
    cwd: "/project",
    configDirectory: undefined,
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
      "openai-codex",
      "--model",
      "gpt-6-sol",
    ],
    cwd: process.cwd(),
    configDirectory: join(root, "config"),
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
      "openai-codex",
      "--model",
      "gpt-6-sol",
      "--json",
      "--no-refresh",
    ],
  ]);
  expect(probed).toContainEqual(["pi", ["--version"]]);
  // Native auth probes are read-only; doctor must never trigger an
  // interactive login or read credential material. The codex-exec lane was
  // removed (2026-09), so only antigravity gets a native probe.
  expect(probed.filter(([command, args]) => args.includes("login"))).toEqual([]);
  expect(probed.flat(2)).not.toContain("--credentials");
  const report = JSON.parse(capture.stdout()) as {
    checks: Array<{ name: string; ok: boolean; auth?: string }>;
  };
  expect(report.checks).toContainEqual(
    expect.objectContaining({ name: "pi", ok: true, auth: "ready" }),
  );
  expect(report.checks).toContainEqual(
    expect.objectContaining({ name: "antigravity", ok: true }),
  );
  expect(report.checks.find((check) => check.name === "codex")).toBeUndefined();
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

test("human CLI renderers share line limits and exact overflow summaries", () => {
  const limits = {
    statusLineLimit: 8,
    attentionLineLimit: 4,
    findingsLineLimit: 5,
    listLineLimit: 4,
    lineTextLimit: 160,
  };
  const snapshot: protocol.SnapshotOutput = {
    intent: "", workingDirectory: "/project", guidance: [], attention: [], lastSequence: 1,
    runId: "render-run",
    state: "active",
    tasks: Array.from({ length: 7 }, (_, index) => ({ id: `task-${index + 1}`, title: "task", kind: "research", state: "ready", preferredCompute: "fast", attempt: 0, dependencies: [], readScope: [], writeScope: [], blockedBy: [], activities: [] })),
    activeWorkers: Array.from({ length: 7 }, (_, index) => ({
      id: `worker-${index + 1}`,
      taskId: `task-${index + 1}`,
    })),
    openAttentionIds: Array.from({ length: 7 }, (_, index) => `attention-${index + 1}`),
  };

  expect(formatSnapshot("graph", snapshot, limits).trim().split("\n")).toEqual([
    "task-1 ← root · ready · r: - · w: -",
    "task-2 ← root · ready · r: - · w: -",
    "task-3 ← root · ready · r: - · w: -",
    "… 4 more tasks",
  ]);
  expect(formatSnapshot("workers", snapshot, limits).trim().split("\n").at(-1))
    .toBe("… 4 more workers");
  expect(formatSnapshot("attention", snapshot, limits).trim().split("\n")).toEqual([
    "Attention: 7 open",
    "attention-1",
    "… 6 more attention items",
    "Next: loop resolve render-run attention-1 <resolution>",
  ]);
  expect(formatModelList(
    Array.from({ length: 7 }, (_, index) => ({
      computeClass: "fast" as const,
      id: `model-${index + 1}`,
    })),
    limits,
  ).trim().split("\n").at(-1)).toBe("… 4 more models");

  const doctor = formatDoctorChecks([
    { name: "pass-1", ok: true, detail: "ready" },
    { name: "fail-1", ok: false, detail: "missing" },
    { name: "pass-2", ok: true, detail: "ready" },
    { name: "fail-2", ok: false, detail: "missing" },
    { name: "pass-3", ok: true, detail: "ready" },
  ], limits);
  expect(doctor.trim().split("\n")).toEqual([
    "Loop doctor",
    "! fail-1: missing",
    "! fail-2: missing",
    "… 3 more checks (2 failed, 3 passed)",
  ]);
});

test("watch feed renders bounded per-worker activity history while status stays byte-identical", () => {
  const limits = {
    statusLineLimit: 8,
    attentionLineLimit: 4,
    findingsLineLimit: 5,
    listLineLimit: 4,
    lineTextLimit: 160,
  };
  const snapshot: protocol.SnapshotOutput = {
    intent: "", workingDirectory: "/project", guidance: [], attention: [], lastSequence: 4,
    runId: "feed-run",
    state: "active",
    tasks: [
      {
        id: "t-live", title: "Live task", kind: "research", state: "running",
        preferredCompute: "fast", attempt: 0, dependencies: [], readScope: [], writeScope: [],
        blockedBy: [],
        activities: [
          "[lifecycle] starting t-live",
          "[message] step one",
          "[message] step two",
          "[message] step three",
        ],
      },
      {
        id: "t-done", title: "Done task", kind: "research", state: "done",
        preferredCompute: "fast", attempt: 0, dependencies: [], readScope: [], writeScope: [],
        blockedBy: [],
        activities: ["[lifecycle] starting t-done", "[result] finished"],
        resultSummary: "finished",
      },
    ],
    activeWorkers: [{ id: "w-1", taskId: "t-live" }],
    openAttentionIds: [],
  };

  // Without the feed option (worker_visibility "off") the render matches the
  // historical behavior: a single latest-activity detail line, no feed section.
  const plain = formatSnapshot("status", snapshot, limits);
  expect(plain).toContain("activity: [message] step three");
  expect(plain).not.toContain("t-live activity:");
  expect(plain).not.toContain("\u2502");

  // With the feed option (watch + visibility on) the running worker shows its
  // most recent history lines; the tail respects the per-worker budget.
  const feed = formatSnapshot("status", snapshot, limits, { workerActivityLines: 2 });
  const feedLines = feed.trim().split("\n");
  expect(feedLines).toContain("t-live activity:");
  expect(feedLines).toContain("  \u2502 [message] step two");
  expect(feedLines).toContain("  \u2502 [message] step three");
  expect(feedLines).not.toContain("  \u2502 [lifecycle] starting t-live");
  expect(feedLines).not.toContain("  \u2502 [message] step one");
  // Done tasks never grow a feed block; their result stays in the task line.
  expect(feedLines).not.toContain("t-done activity:");
  expect(feed).toContain("activity: [result] finished");
});

test("human models output is a bounded list while JSON remains complete", async () => {
  const human = output();
  const json = output();

  expect(await runCli(["models", "--config", join(root, "config")], { io: human.io })).toBe(0);
  expect(await runCli(["models", "--config", join(root, "config"), "--json"], { io: json.io }))
    .toBe(0);
  // Human output must never leak JSON payloads; pi pattern syntax lets model
  // ids legitimately contain brackets or colons, so assert on JSON-ish
  // sequences rather than a bare bracket.
  expect(human.stdout()).not.toContain("[{");
  expect(human.stdout()).not.toContain("}]");
  expect(human.stdout()).toContain("fast · zai/glm-5.3-flashx");
  expect(JSON.parse(json.stdout())).toHaveLength(13);
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

test("runs, pause, guidance and attention resolution operate on durable state", async () => {
  await protocol.rustra.ready();
  const databasePath = join(mkdtempSync(join(tmpdir(), "loop-cli-controls-")), "loop.sqlite");
  const input = { databasePath, runId: "controls" };
  await protocol.createRun(input);
  const flags = ["--config", join(root, "config"), "--database", databasePath, "--json"];
  const list = output();
  expect(await runCli(["runs", ...flags], { io: list.io })).toBe(0);
  expect(JSON.parse(list.stdout())).toContainEqual({ runId: "controls", state: "active" });
  expect(await runCli(["pause", "controls", ...flags], { io: output().io })).toBe(0);
  expect((await protocol.getSnapshot(input)).state).toBe("paused");
  expect(await runCli(["steer", "controls", "all", "Preserve compatibility", ...flags], { io: output().io })).toBe(0);
  expect((await protocol.getSnapshot(input)).guidance).toEqual(["Preserve compatibility"]);
  await protocol.requestAttention({ ...input, attentionId: "approval", kind: "approval", summary: "Approve change" });
  expect(await runCli(["resolve", "controls", "approval", "approved", ...flags], { io: output().io })).toBe(0);
  expect((await protocol.getSnapshot(input)).openAttentionIds).toEqual([]);
  expect((await protocol.getSnapshot(input)).state).toBe("paused");
});

test("guidance status exposes delivery stage without revealing correction text", async () => {
  await protocol.rustra.ready();
  const databasePath = join(mkdtempSync(join(tmpdir(), "loop-cli-guidance-")), "loop.sqlite");
  const runId = "guidance-status-run";
  await protocol.createRun({ databasePath, runId });
  await protocol.addTask({ databasePath, runId, task: {
    id: "impl", title: "Implement", kind: "implementation", dependencies: [],
    readScope: [], writeScope: ["src/**"], requirements: ["Return evidence"],
    completionChecks: [{ id: "test", command: "bun", args: ["test"], timeoutMs: 1000 }],
    preferredCompute: "fast", minimumCompute: "tiny", maximumCompute: "strong", maxAttempts: 1,
  } });
  await protocol.steerRun({ databasePath, runId, taskId: "impl", message: "private correction text" });
  const capture = output();
  const code = await runCli(["guidance", runId, "impl", "--config", join(root, "config"), "--database", databasePath, "--json"], { io: capture.io });
  expect(code).toBe(0);
  expect(JSON.parse(capture.stdout())).toEqual([{ sequence: expect.any(Number), taskId: "impl", state: "recorded" }]);
  expect(capture.stdout()).not.toContain("private correction text");
});

test("add-task accepts generated task JSON and reports graph rejection", async () => {
  await protocol.rustra.ready();
  const databasePath = join(mkdtempSync(join(tmpdir(), "loop-cli-add-task-")), "loop.sqlite");
  const input = { databasePath, runId: "add-task-run" };
  await protocol.createRun(input);
  const flags = ["--config", join(root, "config"), "--database", databasePath, "--json"];
  const task: protocol.TaskSpecInput = {
    id: "fix", title: "Fix", kind: "implementation", dependencies: [], readScope: ["src/**"], writeScope: ["src/fix.ts"], requirements: ["Return test evidence"],
    completionChecks: [{ id: "test", command: "true", args: [], timeoutMs: 1000 }], preferredCompute: "fast", minimumCompute: "tiny", maximumCompute: "strong", maxAttempts: 1,
  };
  const accepted = output();
  expect(await runCli(["add-task", input.runId, ...flags], { io: accepted.io, stdin: JSON.stringify(task) })).toBe(0);
  expect(JSON.parse(accepted.stdout())).toMatchObject({ accepted: true });
  expect((await protocol.getSnapshot(input)).tasks.map(value => value.id)).toEqual(["fix"]);
  const rejected = output();
  expect(await runCli(["add-task", input.runId, ...flags], { io: rejected.io, stdin: JSON.stringify({ ...task, id: "next", dependencies: ["missing"] }) })).toBe(1);
  expect((await protocol.getSnapshot(input)).tasks.map(value => value.id)).toEqual(["fix"]);
});

test("steer relay process command mirrors the owner spawn layout", () => {
  expect(buildSteerRelayCommand({
    executablePath: "/usr/bin/bun",
    sourceEntry: "/repo/packages/cli/src/main.ts",
    databasePath: "/tmp/loop.sqlite",
    runId: "run-9",
    taskId: "t-1",
  })).toEqual({
    command: "/usr/bin/bun",
    args: ["/repo/packages/cli/src/main.ts", "__steer-relay", "run-9", "t-1", "--database", "/tmp/loop.sqlite"],
  });
  expect(buildSteerRelayCommand({
    executablePath: "/usr/local/bin/loop",
    databasePath: "/tmp/loop.sqlite",
    runId: "run-9",
    taskId: "t-1",
  })).toEqual({
    command: "/usr/local/bin/loop",
    args: ["__steer-relay", "run-9", "t-1", "--database", "/tmp/loop.sqlite"],
  });
});

test("__steer-relay requires run, task and database arguments before touching state", async () => {
  const missing = output();
  expect(await runCli(["__steer-relay"], { io: missing.io })).toBe(2);
  expect(missing.stderr()).toContain("__steer-relay requires <run-id> <task-id>");

  const noDatabase = output();
  expect(await runCli(["__steer-relay", "run-9", "t-1"], { io: noDatabase.io })).toBe(2);
  expect(noDatabase.stderr()).toContain("__steer-relay requires --database <path>");
});
