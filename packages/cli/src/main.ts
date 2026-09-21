import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

import {
  ConfigError,
  loadLoopConfig,
  type LoopConfig,
} from "@loop/orchestrator/config";
import type { TaskSpecInput } from "@loop/protocol";

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface ProbeResult {
  exitCode: number;
  output: string;
}

export interface RunCliOptions {
  io?: CliIo;
  probe?: (command: string, args: string[]) => Promise<ProbeResult>;
  leadLauncher?: (input: LeadLaunchInput) => Promise<LeadLaunchResult>;
  stdin?: string;
}

export interface LeadLaunchInput {
  intent: string;
  runId: string;
  projectRoot: string;
  command: string;
  provider: string;
  model: string;
}

export interface LeadLaunchResult {
  workerId: string;
  workspaceId: string;
  paneId: string;
}

const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const io = options.io ?? defaultIo;
  const parsed = parse(argv);
  if (parsed.help) {
    io.stdout(help());
    return 0;
  }

  try {
    if (!parsed.command) {
      return await startPiLead("", parsed, io, options.leadLauncher ?? launchPiLead);
    }
    if (parsed.command === "doctor") {
      const config = configuration(parsed);
      return await doctor(config, parsed.json, parsed.auth, io, options.probe ?? probeCommand);
    }
    if (parsed.command === "models") {
      const config = configuration(parsed);
      print(config.models, parsed.json, io);
      return 0;
    }
    if (["status", "graph", "workers", "attention", "cancel", "resume"].includes(parsed.command)) {
      const runId = parsed.operands[0];
      if (!runId) throw new UsageError(`${parsed.command} requires <run-id>`);
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const input = { databasePath: config.databasePath, runId };
      const snapshot = parsed.command === "cancel"
        ? await protocol.cancelRun(input).then(() => protocol.getSnapshot(input))
        : parsed.command === "resume"
          ? await protocol.resumeRun(input).then(() => protocol.getSnapshot(input))
          : await protocol.getSnapshot(input);
      if (parsed.json) io.stdout(`${JSON.stringify(snapshot)}\n`);
      else io.stdout(formatSnapshot(parsed.command, snapshot));
      return 0;
    }
    if (parsed.command === "run") {
      const intent = parsed.operands.join(" ").trim();
      if (!intent) throw new UsageError("run requires <intent>");
      return await startPiLead(intent, parsed, io, options.leadLauncher ?? launchPiLead);
    }
    if (parsed.command === "verify-install") {
      const receipt = await verifyInstall(process.cwd());
      if (parsed.json) io.stdout(`${JSON.stringify(receipt)}\n`);
      else io.stdout([
        "Loop offline acceptance",
        `State: ${receipt.status}`,
        `Tasks: ${receipt.tasks}`,
        `Max concurrency: ${receipt.maxConcurrent}`,
        `Escalations: ${receipt.escalations}`,
      ].join("\n") + "\n");
      return receipt.status === "completed" ? 0 : 1;
    }
    if (parsed.command === "__execute-plan") {
      const payload = parseExecutionPayload(options.stdin ?? await Bun.stdin.text());
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const { buildProviderRegistry, LoopRuntime } = await import("@loop/orchestrator");
      const runtime = new LoopRuntime({
        control: protocol,
        databasePath: config.databasePath,
        providers: buildProviderRegistry({ config, projectRoot: payload.workingDirectory }),
        maxWorkers: config.scheduler.maxWorkers,
        maxFrontierWorkers: config.scheduler.maxFrontierWorkers,
      });
      const unsubscribe = parsed.stream
        ? await runtime.subscribe(payload.runId, (snapshot) => {
            io.stdout(`${JSON.stringify({ type: "snapshot", value: snapshot })}\n`);
          })
        : undefined;
      const summary = await runtime.start({
        runId: payload.runId,
        tasks: payload.tasks,
        workingDirectory: payload.workingDirectory,
      });
      unsubscribe?.();
      io.stdout(parsed.stream
        ? `${JSON.stringify({ type: "summary", value: summary })}\n`
        : parsed.json
          ? `${JSON.stringify(summary)}\n`
          : `${summary.status}\n`);
      return summary.status === "completed" ? 0 : 1;
    }
    throw new UsageError(`unknown command: ${parsed.command}`);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`${error.message}\n`);
      return 2;
    }
    if (error instanceof ConfigError) {
      io.stderr(`${error.code}: ${error.message}\n`);
      return 78;
    }
    io.stderr(`${redact(error instanceof Error ? error.message : String(error))}\n`);
    return 1;
  }
}

interface ParsedArguments {
  command?: string;
  operands: string[];
  configDirectory?: string;
  databasePath?: string;
  json: boolean;
  stream: boolean;
  auth: boolean;
  help: boolean;
}

function parse(argv: string[]): ParsedArguments {
  const operands: string[] = [];
  let configDirectory: string | undefined;
  let databasePath: string | undefined;
  let json = false;
  let stream = false;
  let auth = false;
  let helpRequested = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--help" || argument === "-h") {
      helpRequested = true;
    } else if (argument === "--json") {
      json = true;
    } else if (argument === "--stream") {
      stream = true;
    } else if (argument === "--auth") {
      auth = true;
    } else if (argument === "--config" || argument === "--database") {
      const value = argv[index + 1];
      if (!value) throw new UsageError(`${argument} requires a value`);
      if (argument === "--config") configDirectory = value;
      else databasePath = value;
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new UsageError(`unknown option: ${argument}`);
    } else {
      operands.push(argument);
    }
  }
  return {
    command: operands.shift(),
    operands,
    configDirectory,
    databasePath,
    json,
    stream,
    auth,
    help: helpRequested,
  };
}

function configuration(parsed: ParsedArguments): LoopConfig {
  return loadLoopConfig({
    configDirectory: parsed.configDirectory,
    databasePath: parsed.databasePath,
  });
}

async function startPiLead(
  intent: string,
  parsed: ParsedArguments,
  io: CliIo,
  launcher: (input: LeadLaunchInput) => Promise<LeadLaunchResult>,
): Promise<number> {
  const config = configuration(parsed);
  const runId = `loop-${randomUUID()}`;
  const launched = await launcher({
    intent,
    runId,
    projectRoot: process.cwd(),
    command: config.lead.command,
    provider: config.lead.provider,
    model: config.lead.model,
  });
  const result = { runId, state: "lead_started", ...launched };
  if (parsed.json) io.stdout(`${JSON.stringify(result)}\n`);
  else {
    io.stdout([
      `Run ${runId}`,
      "State: Pi Lead started",
      `Worker: ${launched.workerId}`,
      `Pane: ${launched.paneId}`,
    ].join("\n") + "\n");
  }
  return 0;
}

async function doctor(
  config: LoopConfig,
  json: boolean,
  checkAuth: boolean,
  io: CliIo,
  probe: (command: string, args: string[]) => Promise<ProbeResult>,
): Promise<number> {
  const checks: Array<{ name: string; ok: boolean; detail: string; auth?: string }> = [];
  try {
    const protocol = await loadProtocol();
    await protocol.rustra.ready();
    checks.push({ name: "rustra", ok: true, detail: "contract ready" });
  } catch (error) {
    checks.push({ name: "rustra", ok: false, detail: redact(String(error)) });
  }

  const commands = new Map<string, string>([
    ["herdr", "herdr"],
    ["pi", config.lead.command],
  ]);
  for (const [id, provider] of Object.entries(config.providers)) {
    if (provider.enabled && provider.command) commands.set(id, provider.command);
  }
  for (const [name, command] of commands) {
    const result = await probe(command, ["--version"]);
    checks.push({
      name,
      ok: result.exitCode === 0,
      detail: bounded(result.output.trim() || `exit ${result.exitCode}`),
    });
  }

  if (checkAuth) {
    await checkNativeAuthentication(config, checks, probe);
  }

  if (json) io.stdout(`${JSON.stringify({ checks })}\n`);
  else {
    io.stdout("Loop doctor\n");
    for (const check of checks.slice(0, 7)) {
      const auth = check.auth ? `; auth ${check.auth}` : "";
      io.stdout(`${check.ok ? "✓" : "!"} ${check.name}: ${check.detail}${auth}\n`);
    }
  }
  return checks.every((check) => check.ok) ? 0 : 1;
}

async function checkNativeAuthentication(
  config: LoopConfig,
  checks: Array<{ name: string; ok: boolean; detail: string; auth?: string }>,
  probe: (command: string, args: string[]) => Promise<ProbeResult>,
): Promise<void> {
  setAuthentication(
    checks,
    "pi",
    await probe(config.lead.command, [
      "auth",
      "check",
      "--provider",
      config.lead.provider,
      "--model",
      config.lead.model,
      "--json",
      "--no-refresh",
    ]),
  );

  const nativeChecks: Array<[string, string[]]> = [
    ["codex", ["login", "status"]],
    ["antigravity", ["models"]],
  ];
  for (const [name, args] of nativeChecks) {
    const provider = config.providers[name];
    if (!provider?.enabled || provider.auth !== "native" || !provider.command) continue;
    setAuthentication(checks, name, await probe(provider.command, args));
  }

  for (const [name, provider] of Object.entries(config.providers)) {
    if (!provider.enabled || provider.auth !== "api_key" || !provider.apiKeyEnv) continue;
    const check = checks.find((candidate) => candidate.name === name);
    const ready = Boolean(process.env[provider.apiKeyEnv]);
    if (check) {
      check.auth = ready ? "ready" : `missing ${provider.apiKeyEnv}`;
      check.ok &&= ready;
    } else {
      checks.push({
        name,
        ok: ready,
        detail: "configured",
        auth: ready ? "ready" : `missing ${provider.apiKeyEnv}`,
      });
    }
  }
}

function setAuthentication(
  checks: Array<{ name: string; ok: boolean; detail: string; auth?: string }>,
  name: string,
  result: ProbeResult,
): void {
  const check = checks.find((candidate) => candidate.name === name);
  const ready = result.exitCode === 0;
  if (check) {
    check.auth = ready ? "ready" : "unavailable";
    check.ok &&= ready;
    return;
  }
  checks.push({
    name,
    ok: ready,
    detail: ready ? "available" : bounded(redact(result.output.trim()) || `exit ${result.exitCode}`),
    auth: ready ? "ready" : "unavailable",
  });
}

async function loadProtocol(): Promise<typeof import("@loop/protocol")> {
  prepareBridgeEnvironment();
  return import("@loop/protocol");
}

function prepareBridgeEnvironment(): void {
  if (process.env.RUSTRA_BUN_LIBRARY) return;
  const library = process.platform === "darwin"
    ? "libloop_bridge.dylib"
    : process.platform === "win32"
      ? "loop_bridge.dll"
      : "libloop_bridge.so";
  const adjacent = join(dirname(process.execPath), library);
  if (existsSync(adjacent)) process.env.RUSTRA_BUN_LIBRARY = adjacent;
}

function formatSnapshot(command: string, snapshot: {
  runId: string;
  state: string;
  tasks: Array<{ id: string; state: string }>;
  activeWorkers: Array<{ id: string; taskId: string }>;
  openAttentionIds: string[];
}): string {
  if (command === "graph") {
    return snapshot.tasks.slice(0, 8).map((task) => `${task.id} · ${task.state}`).join("\n") + "\n";
  }
  if (command === "workers") {
    return (snapshot.activeWorkers.slice(0, 8).map((worker) => `${worker.id} · ${worker.taskId}`).join("\n")
      || "No active workers") + "\n";
  }
  if (command === "attention") {
    return (snapshot.openAttentionIds.slice(0, 5).join("\n") || "OK") + "\n";
  }
  const done = snapshot.tasks.filter((task) => task.state === "done").length;
  return [
    `Run ${snapshot.runId}`,
    `State: ${snapshot.state}`,
    `Tasks: ${done}/${snapshot.tasks.length}`,
    `Workers: ${snapshot.activeWorkers.length}`,
    `Attention: ${snapshot.openAttentionIds.length}`,
  ].join("\n") + "\n";
}

async function launchPiLead(input: LeadLaunchInput): Promise<LeadLaunchResult> {
  if (input.command !== "pi") {
    throw new Error("Herdr's Pi agent kind requires the canonical pi command");
  }
  const { HerdrWorkerRuntime } = await import("@loop/herdr");
  const extension = process.env.LOOP_PI_EXTENSION || adjacentPiExtension();
  const args = ["--provider", input.provider, "--model", input.model];
  if (extension) args.push("--extension", extension);
  const prompt = input.intent.trim()
    ? [
        input.intent,
        "",
        `Use ${input.runId} as the runId when calling loop_run.`,
      ].join("\n")
    : "";
  const handle = await new HerdrWorkerRuntime({ command: "herdr" }).start({
    projectRoot: input.projectRoot,
    runId: input.runId,
    taskId: "lead",
    workerName: `${input.runId}-lead`,
    worktree: input.projectRoot,
    execution: { type: "agent", kind: "pi", args },
    prompt,
  });
  return {
    workerId: handle.workerId,
    workspaceId: handle.workspaceId,
    paneId: handle.paneId,
  };
}

async function verifyInstall(workingDirectory: string): Promise<{
  status: string;
  tasks: number;
  maxConcurrent: number;
  escalations: number;
}> {
  const protocol = await loadProtocol();
  const { Orchestrator } = await import("@loop/orchestrator");
  const { FakeProvider, ProviderRegistry } = await import("@loop/providers");
  await protocol.rustra.ready();
  const fast = new FakeProvider("offline-fast", ["tiny", "fast"], {
    delayMs: 5,
    failures: { "impl-b": 1 },
  });
  const strong = new FakeProvider("offline-strong", ["balanced", "strong", "frontier"], {
    delayMs: 2,
  });
  const tasks: TaskSpecInput[] = [
    offlineTask("research-a", "research"),
    offlineTask("research-b", "research"),
    offlineTask("research-c", "research"),
    offlineTask("decision", "decision", ["research-a", "research-b", "research-c"], [".loop/decision"]),
    offlineTask("impl-a", "implementation", ["decision"], ["src/a/**"]),
    offlineTask("impl-b", "implementation", ["decision"], ["src/b/**"]),
    offlineTask("verification", "verification", ["impl-a", "impl-b"]),
  ];
  const summary = await new Orchestrator({
    control: protocol,
    providers: new ProviderRegistry([fast, strong]),
    maxWorkers: 3,
    maxFrontierWorkers: 1,
  }).run({
    databasePath: join(mkdtempSync(join(tmpdir(), "loop-acceptance-")), "loop.sqlite"),
    runId: `acceptance-${randomUUID()}`,
    tasks,
    workingDirectory,
  });
  return {
    status: summary.status,
    tasks: summary.tasks,
    maxConcurrent: fast.maxConcurrent,
    escalations: summary.escalations.length,
  };
}

function offlineTask(
  id: string,
  kind: TaskSpecInput["kind"],
  dependencies: string[] = [],
  writeScope: string[] = [],
): TaskSpecInput {
  return {
    id,
    title: id,
    kind,
    dependencies,
    readScope: [],
    writeScope,
    requirements: [],
    completionChecks: [{
      id: "offline-check",
      command: "true",
      args: [],
      workingDirectory: null,
      timeoutMs: 5_000,
    }],
    preferredCompute: "fast",
    minimumCompute: "tiny",
    maximumCompute: "strong",
    maxAttempts: 3,
  };
}

function adjacentPiExtension(): string | undefined {
  const path = join(dirname(process.execPath), "loop-pi-extension.js");
  return existsSync(path) ? path : undefined;
}

function parseExecutionPayload(value: string): {
  runId: string;
  workingDirectory: string;
  tasks: TaskSpecInput[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new UsageError("__execute-plan requires a JSON payload on stdin");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError("invalid execution payload");
  }
  const payload = parsed as Record<string, unknown>;
  if (typeof payload.runId !== "string" || !payload.runId.trim()) {
    throw new UsageError("execution payload requires runId");
  }
  if (typeof payload.workingDirectory !== "string" || !payload.workingDirectory.startsWith("/")) {
    throw new UsageError("execution payload requires an absolute workingDirectory");
  }
  if (!Array.isArray(payload.tasks) || payload.tasks.length === 0) {
    throw new UsageError("execution payload requires tasks");
  }
  return {
    runId: payload.runId,
    workingDirectory: payload.workingDirectory,
    tasks: payload.tasks as TaskSpecInput[],
  };
}

function print(value: unknown, json: boolean, io: CliIo): void {
  if (json) io.stdout(`${JSON.stringify(value)}\n`);
  else io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function probeCommand(command: string, args: string[]): Promise<ProbeResult> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output = bounded(output + String(chunk))));
    child.stderr.on("data", (chunk) => (output = bounded(output + String(chunk))));
    child.on("error", (error) => resolveResult({ exitCode: 1, output: error.message }));
    child.on("close", (code) => resolveResult({ exitCode: code ?? 1, output }));
  });
}

function help(): string {
  return `Loop — dependency-aware engineering scheduler

Usage:
  loop                                Start an idle Pi Lead inside Herdr
  loop doctor [--auth] [--json]
  loop status <run-id> [--json]
  loop graph <run-id>
  loop workers <run-id>
  loop attention <run-id>
  loop models [--json]
  loop cancel <run-id>
  loop resume <run-id>
  loop run <intent>                 Start the Pi Lead inside Herdr
  loop verify-install [--json]      Run the offline fake-provider acceptance

Options:
  --config <directory>              Configuration directory
  --database <path>                 SQLite database path
  --json                            Machine-readable output
  --auth                            Check native auth stores without exposing credentials
`;
}

class UsageError extends Error {}

function bounded(value: string): string {
  return value.slice(-4_000);
}

function redact(value: string): string {
  return bounded(
    value.replace(
      /(?:api[_-]?key|token|authorization|password)\s*[:=]\s*\S+/gi,
      "[credential]=[redacted]",
    ),
  );
}

if (import.meta.main) {
  process.exitCode = await runCli(Bun.argv.slice(2));
}
