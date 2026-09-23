import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import * as readline from "node:readline";

import {
  ConfigError,
  loadLoopConfig,
  resolveConfigDirectory,
  type LoopConfig,
} from "@loop/orchestrator/config";
import { compactLines, renderSnapshot, renderTaskContext, type OutputLimits, type SnapshotRenderOptions } from "@loop/presentation";
import { observeRun, spawnOwner } from "./dispatcher";
import type { BenchmarkReport } from "@loop/orchestrator";
import type { ProviderRegistry } from "@loop/providers";
import type { SnapshotOutput, TaskSpecInput } from "@loop/protocol";

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
  leadRunner?: (input: InteractiveLeadInvocation) => Promise<number>;
  executablePath?: string;
  stdin?: string;
  providers?: ProviderRegistry;
}

export interface InteractiveLeadInvocation {
  command: string;
  args: string[];
  cwd: string;
  configDirectory?: string;
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
      if (!process.env.HERDR_ENV) {
        io.stderr(
          "Notice: no active Herdr workspace detected; continuing without Herdr run reporting. Run 'herdr' first, or start 'loop' inside an existing Herdr pane.\n",
        );
      }
      return await startInteractiveLead(
        "",
        parsed,
        options.leadRunner ?? runInteractiveLead,
        options.executablePath ?? process.execPath,
      );
    }
    if (parsed.command === "doctor") {
      const config = configuration(parsed);
      return await doctor(config, parsed.json, parsed.auth, io, options.probe ?? probeCommand);
    }
    if (parsed.command === "models") {
      const config = configuration(parsed);
      if (parsed.json) print(config.models, true, io);
      else io.stdout(formatModelList(config.models, config.output));
      return 0;
    }
    if (parsed.command === "cleanup") {
      const runId = parsed.operands[0] ?? "";
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();

      const input = {
        databasePath: config.databasePath,
        runId,
        keepRecent: parsed.keep ?? 10,
        dryRun: parsed.dryRun,
      };
      const result = await protocol.cleanupRun(input);

      let removedHerdrWorkspaces: string[] = [];
      try {
        const probe = options.probe ?? probeCommand;
        const listResult = await probe("herdr", ["workspace", "list"]);
        if (listResult.exitCode === 0) {
          const parsedList = JSON.parse(listResult.output);
          const workspaces: Array<{ label?: string, workspace_id: string }> = parsedList?.result?.workspaces ?? [];
          const leaks = workspaces.filter(w => w.label?.startsWith("loop-loop-")).map(w => w.workspace_id);
          for (const leak of leaks) {
            if (!parsed.dryRun) {
              await probe("herdr", ["workspace", "close", leak]);
            }
            removedHerdrWorkspaces.push(leak);
          }
        }
      } catch (e) {
        // ignore if herdr isn't available
      }
      const combinedResult = { ...result, removedHerdrWorkspaces };

      if (parsed.json) {
        io.stdout(`${JSON.stringify(combinedResult)}\n`);
      } else {
        io.stdout(formatCleanupSnapshot(combinedResult, config.output, parsed.dryRun));
      }
      return 0;
    }
    if (parsed.command === "runs") {
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const runs = await protocol.listRuns({ databasePath: config.databasePath });
      if (parsed.json) print(runs, true, io);
      else io.stdout(compactLines(runs.map(run => `${run.runId} · ${run.state}`), { lineLimit: config.output.listLineLimit, lineTextLimit: config.output.lineTextLimit, overflow: n => `… ${n} more runs` }).join("\n") + "\n");
      return 0;
    }
    if (["status", "graph", "workers", "attention", "cancel", "pause", "resume", "steer", "resolve", "reconcile", "task", "watch"].includes(parsed.command)) {
      let runId = parsed.operands[0];
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      if (!runId) {
        if (parsed.command === "status" || parsed.command === "watch") {
          const runs = await protocol.listRuns({ databasePath: config.databasePath });
          if (runs.length === 0) {
            io.stdout("No runs\n");
            return 0;
          }
          runId = runs[0].runId;
        } else {
          throw new UsageError(`${parsed.command} requires <run-id>`);
        }
      }
      const input = { databasePath: config.databasePath, runId };
      if (parsed.command === "cancel") await protocol.cancelRun(input);
      if (parsed.command === "pause") await protocol.pauseRun(input);
      if (parsed.command === "steer") {
        const [_, taskId, ...message] = parsed.operands;
        if (!taskId || !message.length) throw new UsageError("steer requires <run-id> <task-id|all> <message>");
        await protocol.steerRun({ ...input, taskId: taskId === "all" ? null : taskId, message: message.join(" ") });
      }
      if (parsed.command === "resolve") {
        const [_, attentionId, ...resolution] = parsed.operands;
        if (!attentionId || !resolution.length) throw new UsageError("resolve requires <run-id> <attention-id> <approved|retry|cancel|answer>");
        await protocol.resolveAttention({ ...input, attentionId, resolution: resolution.join(" ") });
      }
      if (parsed.command === "reconcile") {
        const taskId = parsed.operands[1];
        if (!taskId || parsed.operands[2] !== "stopped") throw new UsageError("reconcile requires <run-id> <task-id> stopped; first confirm the old worker and checks have stopped");
        await protocol.reconcileTask({ ...input, taskId, confirmedStopped: true });
        if ((await protocol.getSnapshot(input)).state === "cancelling") await protocol.cancelRun(input);
      }
      if (parsed.command === "task") {
        const taskId = parsed.operands[1];
        if (!taskId) throw new UsageError("task requires <run-id> <task-id>");
        const context = await protocol.getTaskContext({ ...input, taskId });
        if (parsed.json) print(context, true, io);
        else io.stdout(renderTaskContext(context, config.output) + "\n");
        return 0;
      }
      if (parsed.command === "resume") {
        await protocol.resumeRun(input);
        const plan = await protocol.getRunPlan(input);
        await launchOwner(parsed, config, runId, plan.workingDirectory, options);
      }
      if (parsed.command === "watch") {
        // D3/D5: the live worker-activity feed is a watch-only section, gated
        // by the policy visibility switch ("off" keeps watch byte-identical).
        const feedOptions: SnapshotRenderOptions | undefined = config.output.workerVisibility === "off"
          ? undefined
          : { workerActivityLines: config.output.workerActivityLines };
        await observeRun({ snapshot: () => protocol.getSnapshot(input), onSnapshot: snapshot => io.stdout(parsed.json ? JSON.stringify(snapshot) + "\n" : "\x1b[2J\x1b[H" + formatSnapshot("status", snapshot, config.output, feedOptions)) });
      } else {
        const snapshot = await protocol.getSnapshot(input);
        if (parsed.json) io.stdout(`${JSON.stringify(snapshot)}\n`);
        else io.stdout(formatSnapshot(parsed.command, snapshot, config.output));
      }
      return 0;
    }
    if (parsed.command === "run") {
      const intent = parsed.operands.join(" ").trim();
      if (!intent) throw new UsageError("run requires <intent>");
      return await startInteractiveLead(
        intent,
        parsed,
        options.leadRunner ?? runInteractiveLead,
        options.executablePath ?? process.execPath,
      );
    }
    if (parsed.command === "benchmark") {
      const [subcommand, configPath] = parsed.operands;
      if (subcommand !== "run" || !configPath) {
        throw new UsageError("benchmark requires 'run <config-path>' (see config/persona-benchmark.example.toml)");
      }
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const { buildProviderRegistry, parseBenchmarkConfig, runBenchmark } = await import("@loop/orchestrator");
      const benchmark = parseBenchmarkConfig(readFileSync(configPath, "utf8"), configPath);
      const providers = options.providers ?? buildProviderRegistry({ config, projectRoot: process.cwd() });
      const report = await runBenchmark({
        control: protocol,
        providers,
        databasePath: config.databasePath,
        benchmark,
        workingDirectory: process.cwd(),
        maxWorkers: config.scheduler.maxWorkers,
        maxFrontierWorkers: config.scheduler.maxFrontierWorkers,
      });
      if (parsed.json) io.stdout(`${JSON.stringify(report)}\n`);
      else io.stdout(formatBenchmarkReport(report, config.output));
      return 0;
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
    if (parsed.command === "__steer-relay") {
      const [runId, taskId] = parsed.operands;
      if (!runId || !taskId) throw new UsageError("__steer-relay requires <run-id> <task-id>");
      if (!parsed.databasePath) throw new UsageError("__steer-relay requires --database <path>");
      return await runSteerRelay({ runId, taskId, databasePath: parsed.databasePath, io });
    }
    if (parsed.command === "__execute-plan" || parsed.command === "__dispatch") {
      const payload = parsed.command === "__execute-plan" ? parseExecutionPayload(options.stdin ?? await Bun.stdin.text()) : undefined;
      const runId = payload?.runId ?? parsed.operands[0];
      if (!runId) throw new UsageError("__dispatch requires <run-id>");
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const input = { databasePath: config.databasePath, runId };
      const { buildProviderRegistry, LoopRuntime } = await import("@loop/orchestrator");
      const plan = payload ?? await protocol.getRunPlan(input);
      const runtime = new LoopRuntime({ control: protocol, databasePath: config.databasePath,
        providers: buildProviderRegistry({ config, projectRoot: plan.workingDirectory, activityRecorder: protocol,
          relayCommand: steerRelayCommandBuilder(parsed, config, options) }),
        maxWorkers: config.scheduler.maxWorkers, maxFrontierWorkers: config.scheduler.maxFrontierWorkers,
        workerVisibility: config.output.workerVisibility });
      if (payload) {
        await runtime.prepare(payload);
        const owner = await launchOwner(parsed, config, runId, plan.workingDirectory, options);
        if (parsed.detach) { print({ runId, state: "active", ownerPid: owner.pid }, true, io); return 0; }
        const summary = await observeRun({ snapshot: () => runtime.snapshot(runId), owner,
          onSnapshot: snapshot => { if (parsed.stream) io.stdout(JSON.stringify({ type: "snapshot", value: snapshot }) + "\n"); } });
        io.stdout(parsed.stream ? JSON.stringify({ type: "summary", value: summary }) + "\n" : JSON.stringify(summary) + "\n");
      } else {
        const stop = new AbortController();
        const abort = () => stop.abort();
        process.once("SIGTERM", abort); process.once("SIGINT", abort);
        try { await runtime.execute(runId, stop.signal); }
        finally { process.off("SIGTERM", abort); process.off("SIGINT", abort); }
      }
      return 0;
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
  detach: boolean;
  auth: boolean;
  help: boolean;
  execute: boolean;
  dryRun: boolean;
  keep?: number;
}

function parse(argv: string[]): ParsedArguments {
  const operands: string[] = [];
  let configDirectory: string | undefined;
  let databasePath: string | undefined;
  let json = false;
  let stream = false;
  let detach = false;
  let auth = false;
  let helpRequested = false;
  let execute = false;
  let dryRun = true;
  let keep: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--help" || argument === "-h") {
      helpRequested = true;
    } else if (argument === "--json") {
      json = true;
    } else if (argument === "--stream") {
      stream = true;
    } else if (argument === "--detach") {
      detach = true;
    } else if (argument === "--auth") {
      auth = true;
    } else if (argument === "--execute") {
      execute = true;
      dryRun = false;
    } else if (argument === "--dry-run") {
      dryRun = true;
      execute = false;
    } else if (argument === "--keep") {
      const value = argv[index + 1];
      if (!value) throw new UsageError(`${argument} requires a value`);
      keep = parseInt(value, 10);
      if (isNaN(keep)) throw new UsageError(`${argument} must be a number`);
      index += 1;
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
    detach,
    auth,
    help: helpRequested,
    execute,
    dryRun,
    keep,
  };
}

function configuration(parsed: ParsedArguments): LoopConfig {
  return loadLoopConfig({
    configDirectory: parsed.configDirectory,
    databasePath: parsed.databasePath,
  });
}

async function startInteractiveLead(
  intent: string,
  parsed: ParsedArguments,
  runner: (input: InteractiveLeadInvocation) => Promise<number>,
  executablePath: string,
): Promise<number> {
  const config = configuration(parsed);
  return runner(buildInteractiveLeadInvocation({
    command: config.lead.command,
    provider: config.lead.provider,
    model: config.lead.model,
    intent,
    cwd: process.cwd(),
    executablePath,
    environment: process.env,
    configDirectory: config.configDirectory,
  }));
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

  if (json) {
    io.stdout(`${JSON.stringify({ checks })}\n`);
  } else {
    let output = formatDoctorChecks(checks, config.output);
    if (!checkAuth) output += "Tip: Run 'loop doctor --auth' to verify provider credentials.\n";
    io.stdout(output);
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

export function formatSnapshot(command: string, snapshot: SnapshotOutput, limits: OutputLimits, options?: SnapshotRenderOptions): string {
  return renderSnapshot(command, snapshot, limits, options).replace("Next: /loop", "Next: loop") + "\n";
}

export function formatCleanupSnapshot(
  snapshot: import("@loop/protocol").CleanupRunOutput & { removedHerdrWorkspaces?: string[] },
  limits: OutputLimits,
  dryRun: boolean,
): string {
  const prefix = dryRun ? "[DRY RUN] " : "";
  const herdrRemoved = snapshot.removedHerdrWorkspaces?.length ?? 0;
  const lines = [
    `${prefix}Cleanup Report`,
    `Removed: ${snapshot.removedArtifacts.length} artifacts` + (herdrRemoved ? `, ${herdrRemoved} leaked workspaces` : ""),
    `Skipped: ${snapshot.skippedArtifacts.length}`,
  ];
  if (herdrRemoved > 0) {
    lines.push(...snapshot.removedHerdrWorkspaces!.map(w => `- Workspace ${w} (leaked)`));
  }
  if (snapshot.removedArtifacts.length > 0) {
    lines.push(...snapshot.removedArtifacts.map(a => `- ${a}`));
  }
  if (snapshot.skippedArtifacts.length > 0) {
    lines.push(...snapshot.skippedArtifacts.map(a => `! ${a.artifact} (${a.reason})`));
  }

  return `${compactLines(lines, {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more lines`,
  }).join("\n")}\n`;
}

export function formatBenchmarkReport(report: BenchmarkReport, limits: OutputLimits): string {
  const { benchmark } = report;
  const lines = [
    `Benchmark: ${benchmark.name}`,
    `Intent: ${benchmark.intent}`,
    `Profiles: ${benchmark.profiles.join(", ")} · ${benchmark.iterations} iteration(s) each`,
  ];
  for (const run of report.runs) {
    const created = run.summary.tasks_created ?? 0;
    const completed = run.summary.tasks_completed ?? 0;
    const attempts = (run.summary.verification_passes ?? 0) + (run.summary.verification_failures ?? 0);
    lines.push(
      `${run.status === "completed" ? "✓" : "!"} ${run.profile} iter ${run.iteration} · ${run.runId}` +
        ` · ${run.status} · tasks ${completed}/${created} · attempts ${attempts}` +
        ` · retries ${run.summary.verification_failures ?? 0} · attention ${run.summary.attention_created ?? 0}`,
    );
  }
  lines.push("Ranking (total score, highest first)");
  report.comparison.rankings.forEach((ranking, index) => {
    const total = ranking.score.reliability + ranking.score.autonomy + ranking.score.first_pass;
    lines.push(
      `${index + 1}. ${ranking.label} · total ${total}` +
        ` (reliability ${ranking.score.reliability} · autonomy ${ranking.score.autonomy} · first-pass ${ranking.score.first_pass})`,
    );
  });
  return `${compactLines(lines, {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more report lines (use --json for the full report)`,
  }).join("\n")}\n`;
}

export function formatModelList(
  models: Array<{ computeClass: string; id: string }>,
  limits: OutputLimits,
): string {
  if (models.length === 0) return "No models configured\n";
  return `${compactLines(models.map((model) => `${model.computeClass} · ${model.id}`), {
    lineLimit: limits.listLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more models`,
  }).join("\n")}\n`;
}

export function formatDoctorChecks(
  checks: Array<{ name: string; ok: boolean; detail: string; auth?: string }>,
  limits: OutputLimits,
): string {
  const ordered = [...checks].sort((left, right) => Number(left.ok) - Number(right.ok));
  const failed = checks.filter((check) => !check.ok).length;
  const passed = checks.length - failed;
  const lines = [
    "Loop doctor",
    ...ordered.map((check) => {
      const auth = check.auth ? `; auth ${check.auth}` : "";
      return `${check.ok ? "✓" : "!"} ${check.name}: ${check.detail}${auth}`;
    }),
  ];
  return `${compactLines(lines, {
    lineLimit: limits.listLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => `… ${omitted} more checks (${failed} failed, ${passed} passed)`,
  }).join("\n")}\n`;
}

export function buildInteractiveLeadInvocation(input: {
  command: string;
  provider: string;
  model: string;
  intent: string;
  cwd: string;
  executablePath: string;
  environment: Record<string, string | undefined>;
  configDirectory?: string;
}): InteractiveLeadInvocation {
  const adjacentExtension = join(dirname(input.executablePath), "loop-pi-extension.js");
  const developmentExtension = resolve(import.meta.dir, "../../../dist/loop-pi-extension.js");
  const extension = input.environment.LOOP_PI_EXTENSION
    || (basename(input.executablePath) === "loop" ? adjacentExtension : developmentExtension);
  const args = [
    "--no-extensions",
    "--extension",
    extension,
    "--provider",
    input.provider,
    "--model",
    input.model,
  ];
  if (input.intent.trim()) args.push("--", input.intent.trim());
  return { command: input.command, args, cwd: input.cwd, configDirectory: input.configDirectory };
}

function runInteractiveLead(input: InteractiveLeadInvocation): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.configDirectory
        ? { ...process.env, LOOP_CONFIG_DIR: input.configDirectory }
        : process.env,
      shell: false,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
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

function parseExecutionPayload(value: string): {
  intent?: string;
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
    intent: typeof payload.intent === "string" ? payload.intent : undefined,
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
  loop                                Start the interactive Loop agent in this terminal
  loop doctor [--auth] [--json]
  loop runs [--json]                Find persisted runs after reopening
  loop status [run-id] [--json]
  loop graph <run-id>
  loop workers <run-id>
  loop attention <run-id>
  loop models [--json]
  loop cancel <run-id>
  loop pause <run-id>               Finish active tasks, stop scheduling
  loop resume <run-id>              Continue the saved graph in the background
  loop watch [run-id] [--json]
  loop reconcile <run-id> <task-id> stopped  Confirm an orphaned task stopped before retrying
  loop task <run-id> <task-id>       Show context, results and verification evidence
  loop steer <run-id> <task-id|all> <message>
  loop resolve <run-id> <attention-id> <approved|retry|cancel|answer>
  loop cleanup [run-id] [--execute] [--keep <N>]
  loop benchmark run <config-path>  Run a persona benchmark config and compare run traces (see config/persona-benchmark.example.toml)
  loop run <intent>                 Start the interactive Loop agent with an initial request
  loop verify-install [--json]      Run the offline fake-provider acceptance

Options:
  --config <directory>              Configuration directory
  --database <path>                 SQLite database path
  --json                            Machine-readable output
  --auth                            Check native auth stores without exposing credentials
  --execute                         Actually delete artifacts (cleanup command)
  --dry-run                         Preview deletion without executing (default for cleanup)
  --keep <N>                        Keep the most recent <N> artifacts (default: 10)
`;
}

class UsageError extends Error {}

function bounded(value: string): string {
  return value.slice(-4_000);
}

function redact(value: string): string {
  return bounded(
    value.replace(/(?:authorization|proxy-authorization)\s*["']?\s*[:=]\s*["']?[^\r\n,"'}]+/gi, "[authorization]=[redacted]").replace(
      /(?:api[_-]?key|token|authorization|password)\s*[:=]\s*\S+/gi,
      "[credential]=[redacted]",
    ),
  );
}

if (import.meta.main) {
  process.exitCode = await runCli(Bun.argv.slice(2));
}

/**
 * Worker pane steer relay process (docs/decisions/2026-09-23-watch-to-steer.md).
 * Hosted inside a worker's Herdr pane via `herdr pane run`; each typed line is
 * delivered through the same steer backend as `loop steer` (steerRun) and
 * confirmed with one redacted, clamped echo line. The pane close on worker
 * finish ends stdin, so the relay exits with the worker's pane.
 */
async function runSteerRelay(input: { runId: string; taskId: string; databasePath: string; io: CliIo }): Promise<number> {
  const protocol = await loadProtocol();
  await protocol.rustra.ready();
  const { redactProviderText } = await import("@loop/providers");
  const { runSteerRelaySession } = await import("@loop/herdr");
  const echo = (line: string) => input.io.stdout(`${line}\n`);
  echo("steer relay ready — type a line to steer this worker; the relay exits when the worker finishes");
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    await runSteerRelaySession(lines, {
      runId: input.runId,
      taskId: input.taskId,
      deliver: (delivery) => protocol.steerRun({
        databasePath: input.databasePath,
        runId: delivery.runId,
        taskId: delivery.taskId,
        message: delivery.message,
      }),
      echo,
      redact: (line, limit) => redactProviderText(line, limit),
    });
  } finally {
    lines.close();
  }
  return 0;
}

/** Relay process invocation, mirroring the owner spawn layout (bun entry vs compiled binary). */
export function buildSteerRelayCommand(input: {
  executablePath: string;
  sourceEntry?: string;
  databasePath: string;
  runId: string;
  taskId: string;
}): { command: string; args: string[] } {
  const args = [
    ...(input.sourceEntry ? [input.sourceEntry] : []),
    "__steer-relay", input.runId, input.taskId, "--database", input.databasePath,
  ];
  return { command: input.executablePath, args };
}

/** Watch-to-steer: per-worker relay commands hosted inside the worker's Herdr pane. */
function steerRelayCommandBuilder(parsed: ParsedArguments, config: LoopConfig, options: RunCliOptions) {
  const executablePath = options.executablePath ?? process.execPath;
  const sourceEntry = basename(executablePath).startsWith("bun") ? resolve(import.meta.dir, "main.ts") : undefined;
  // The pane's cwd is the worktree, so the relay must receive an absolute database path.
  const databasePath = resolve(config.databasePath);
  return (worker: { runId: string; taskId: string }) =>
    buildSteerRelayCommand({ executablePath, sourceEntry, databasePath, runId: worker.runId, taskId: worker.taskId });
}

function launchOwner(parsed: ParsedArguments, config: LoopConfig, runId: string, cwd: string, options: RunCliOptions) {
  const executable = options.executablePath ?? process.execPath;
  const sourceEntry = basename(executable).startsWith("bun") ? resolve(import.meta.dir, "main.ts") : undefined;
  return spawnOwner({ executable, sourceEntry, runId, databasePath: resolve(config.databasePath), configDirectory: resolve(resolveConfigDirectory({ explicit: parsed.configDirectory })), cwd });
}
