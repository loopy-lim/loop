import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import * as protocol from "@loop/protocol";
import {
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
      "zai",
      "--model",
      "glm-5.3-flashx",
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
      "zai",
      "--model",
      "glm-5.3-flashx",
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
      "zai",
      "--model",
      "glm-5.3-flashx",
      "--json",
      "--no-refresh",
    ],
  ]);
  expect(probed).toContainEqual(["pi", ["--version"]]);
  // `codex login status` is a read-only status probe; doctor must never
  // trigger an interactive login or read credential material.
  expect(probed.filter(([command, args]) => args.includes("login"))).toEqual([
    ["codex", ["login", "status"]],
  ]);
  expect(probed.flat(2)).not.toContain("--credentials");
  const report = JSON.parse(capture.stdout()) as {
    checks: Array<{ name: string; ok: boolean; auth?: string }>;
  };
  expect(report.checks).toContainEqual(
    expect.objectContaining({ name: "pi", ok: true, auth: "ready" }),
  );
  expect(report.checks).toContainEqual(
    expect.objectContaining({ name: "codex", ok: true, auth: "ready" }),
  );
  expect(report.checks).toContainEqual(
    expect.objectContaining({ name: "antigravity", ok: true }),
  );
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
  expect(JSON.parse(json.stdout())).toHaveLength(16);
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
