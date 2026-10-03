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
import {
  compactLines,
  renderSnapshot,
  renderTaskContext,
  type OutputLimits,
  type SnapshotRenderOptions,
} from "@loop/presentation";
import { cleanupBullet, emptyState, moreItems, separator, statusGlyph } from "@loop/presentation";
import { observeRun, spawnOwner, waitForOwnerReady } from "./dispatcher";
import { nightlyDisposition, withNightlyLock } from "./nightly";
import { classifyRunHealth } from "./health";
import { guidanceStatus } from "./guidance-status";
import { runPairCommand } from "./pair";
import type { AgentComparisonReport, BenchmarkReport } from "@loop/orchestrator";
import type { ProviderRegistry } from "@loop/providers";
import type { GoalCriterionInput, SnapshotOutput, TaskSpecInput } from "@loop/protocol";

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
  nightlyLaunch?: (runId: string, cwd: string) => Promise<void>;
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
    if (parsed.command === "pair") {
      return await runPairCommand({ env: process.env, probe: options.probe ?? probeCommand }, io, {
        hostFlag: parsed.host,
        json: parsed.json,
      });
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

      const removedHerdrWorkspaces: string[] = [];
      try {
        const probe = options.probe ?? probeCommand;
        const listResult = await probe("herdr", ["workspace", "list"]);
        if (listResult.exitCode === 0) {
          const parsedList = JSON.parse(listResult.output);
          const workspaces: Array<{ label?: string; workspace_id: string }> =
            parsedList?.result?.workspaces ?? [];
          const leaks = workspaces
            .filter((w) => w.label?.startsWith("loop-loop-"))
            .map((w) => w.workspace_id);
          for (const leak of leaks) {
            if (!parsed.dryRun) {
              await probe("herdr", ["workspace", "close", leak]);
            }
            removedHerdrWorkspaces.push(leak);
          }
        }
      } catch {
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
      else
        io.stdout(
          compactLines(
            runs.map((run) => `${run.runId} ${separator.list} ${run.state}`),
            {
              lineLimit: config.output.listLineLimit,
              lineTextLimit: config.output.lineTextLimit,
              overflow: (n) => moreItems(n, "runs"),
            },
          ).join("\n") + "\n",
        );
      return 0;
    }
    if (parsed.command === "health") {
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const findings: Array<{ runId: string; kind: string }> = [];
      for (const run of await protocol.listRuns({ databasePath: config.databasePath })) {
        if (run.state !== "active") continue;
        const snapshot = await protocol.getSnapshot({
          databasePath: config.databasePath,
          runId: run.runId,
        });
        const kind = classifyRunHealth(snapshot);
        if (kind !== null) findings.push({ runId: run.runId, kind });
      }
      if (parsed.json) io.stdout(`${JSON.stringify({ findings })}\n`);
      else
        io.stdout(
          `${compactLines(
            findings.length
              ? findings.map((item) => `${item.runId} ${separator.list} ${item.kind}`)
              : ["No interrupted runs detected"],
            {
              lineLimit: config.output.statusLineLimit,
              lineTextLimit: config.output.lineTextLimit,
              overflow: (count) => moreItems(count, "runs", "use --json for the full report"),
            },
          ).join("\n")}\n`,
        );
      return 0;
    }
    if (parsed.command === "nightly") {
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const scan = async () => {
        const rows: Array<{ runId: string; disposition: string }> = [];
        let skippedTerminal = 0;
        for (const run of await protocol.listRuns({ databasePath: config.databasePath })) {
          if (["completed", "failed", "cancelled"].includes(run.state)) {
            skippedTerminal++;
            continue;
          }
          if (run.state !== "active") {
            rows.push({ runId: run.runId, disposition: run.state });
            continue;
          }
          const input = { databasePath: config.databasePath, runId: run.runId };
          const snapshot = await protocol.getSnapshot(input);
          const disposition = nightlyDisposition(snapshot);
          if (!["ready", "settlement", "stalled"].includes(disposition) || !parsed.execute) {
            rows.push({ runId: run.runId, disposition });
            continue;
          }
          try {
            // Re-read immediately before the side effect; another owner may
            // have claimed the lease during the scan.
            const latest = await protocol.getSnapshot(input);
            if (!["ready", "settlement", "stalled"].includes(nightlyDisposition(latest))) {
              rows.push({ runId: run.runId, disposition: "changed" });
              continue;
            }
            if (options.nightlyLaunch)
              await options.nightlyLaunch(run.runId, latest.workingDirectory);
            else {
              const owner = await launchOwner(
                parsed,
                config,
                run.runId,
                latest.workingDirectory,
                options,
              );
              await waitForOwnerReady({ owner, snapshot: () => protocol.getSnapshot(input) });
            }
            rows.push({ runId: run.runId, disposition: "launched" });
          } catch (error) {
            rows.push({ runId: run.runId, disposition: `error: ${redact(String(error))}` });
          }
        }
        return { mode: parsed.execute ? "execute" : "dry-run", skippedTerminal, rows };
      };
      const report = parsed.execute
        ? await withNightlyLock(`${resolve(config.databasePath)}.nightly.lock`, scan)
        : await scan();
      if (parsed.json) io.stdout(`${JSON.stringify(report)}\n`);
      else
        io.stdout(
          `${compactLines(
            [
              `Nightly ${report.mode} ${separator.list} ${report.skippedTerminal} terminal skipped`,
              ...report.rows.map((row) => `${row.runId} ${separator.list} ${row.disposition}`),
            ],
            {
              lineLimit: config.output.statusLineLimit,
              lineTextLimit: config.output.lineTextLimit,
              overflow: (count) => moreItems(count, "runs", "use --json for the full report"),
            },
          ).join("\n")}\n`,
        );
      return report.rows.some((row) => row.disposition.startsWith("error:")) ? 1 : 0;
    }
    if (parsed.command === "guidance") {
      const [runId, taskId] = parsed.operands;
      if (!runId || !taskId) throw new UsageError("guidance requires <run-id> <task-id>");
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const events: import("@loop/protocol").EventOutput[] = [];
      let afterSequence = 0;
      while (true) {
        const batch = await protocol.subscribeEvents({
          databasePath: config.databasePath,
          runId,
          afterSequence,
          limit: 500,
        });
        events.push(...batch);
        if (events.length > 100_000)
          throw new Error("guidance history exceeds the bounded read limit");
        if (batch.length < 500) break;
        const last = batch.at(-1);
        if (last === undefined) break; // length >= 1 이 at(-1) 을 보장한다
        afterSequence = Number(last.sequence);
      }
      const statuses = guidanceStatus(events, taskId);
      if (parsed.json) print(statuses, true, io);
      else
        io.stdout(
          `${
            compactLines(
              statuses.map((item) => `${item.sequence} · ${item.state}`),
              {
                lineLimit: config.output.listLineLimit,
                lineTextLimit: config.output.lineTextLimit,
                overflow: (n) => moreItems(n, "guidance items"),
              },
            ).join("\n") || "No guidance recorded for this task"
          }\n`,
        );
      return 0;
    }
    if (parsed.command === "add-task") {
      const runId = parsed.operands[0];
      if (!runId) throw new UsageError("add-task requires <run-id>");
      const task = parseTaskPayload(options.stdin ?? (await Bun.stdin.text()));
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const accepted = await protocol.addTask({ databasePath: config.databasePath, runId, task });
      print(accepted, parsed.json, io);
      return 0;
    }
    if (parsed.command === "add-goal-task") {
      const runId = parsed.operands[0];
      if (!runId) throw new UsageError("add-goal-task requires <run-id>");
      const payload = parseGoalTaskPayload(options.stdin ?? (await Bun.stdin.text()));
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const accepted = await protocol.addGoalTask({
        databasePath: config.databasePath,
        runId,
        ...payload,
      });
      print(accepted, parsed.json, io);
      return 0;
    }
    if (
      [
        "status",
        "graph",
        "workers",
        "attention",
        "cancel",
        "pause",
        "resume",
        "steer",
        "resolve",
        "reconcile",
        "task",
        "watch",
      ].includes(parsed.command)
    ) {
      let runId = parsed.operands[0];
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      if (!runId) {
        if (parsed.command === "status" || parsed.command === "watch") {
          const runs = await protocol.listRuns({ databasePath: config.databasePath });
          const latestRun = runs[0];
          if (!latestRun) {
            io.stdout(`${emptyState.noRuns}\n`);
            return 0;
          }
          runId = latestRun.runId;
        } else {
          throw new UsageError(`${parsed.command} requires <run-id>`);
        }
      }
      const input = { databasePath: config.databasePath, runId };
      if (parsed.command === "cancel") await protocol.cancelRun(input);
      if (parsed.command === "pause") await protocol.pauseRun(input);
      if (parsed.command === "steer") {
        const [_, taskId, ...message] = parsed.operands;
        if (!taskId || !message.length)
          throw new UsageError("steer requires <run-id> <task-id|all> <message>");
        await protocol.steerRun({
          ...input,
          taskId: taskId === "all" ? null : taskId,
          message: message.join(" "),
        });
      }
      if (parsed.command === "resolve") {
        const [_, attentionId, ...resolution] = parsed.operands;
        if (!attentionId || !resolution.length)
          throw new UsageError(
            "resolve requires <run-id> <attention-id> <approved|retry|cancel|answer>",
          );
        await protocol.resolveAttention({
          ...input,
          attentionId,
          resolution: resolution.join(" "),
        });
        const resolved = await protocol.getSnapshot(input);
        const leaseAlive =
          resolved.executionExpiresAt != null && Number(resolved.executionExpiresAt) > Date.now();
        if (resolved.state === "active" && !leaseAlive) {
          const plan = await protocol.getRunPlan(input);
          const owner = await launchOwner(parsed, config, runId, plan.workingDirectory, options);
          await waitForOwnerReady({ owner, snapshot: () => protocol.getSnapshot(input) });
        }
      }
      if (parsed.command === "reconcile") {
        const taskId = parsed.operands[1];
        if (!taskId || parsed.operands[2] !== "stopped")
          throw new UsageError(
            "reconcile requires <run-id> <task-id> stopped; first confirm the old worker and checks have stopped",
          );
        await protocol.reconcileTask({ ...input, taskId, confirmedStopped: true });
        if ((await protocol.getSnapshot(input)).state === "cancelling")
          await protocol.cancelRun(input);
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
        const feedOptions: SnapshotRenderOptions | undefined =
          config.output.workerVisibility === "off"
            ? undefined
            : { workerActivityLines: config.output.workerActivityLines };
        await observeRun({
          snapshot: () => protocol.getSnapshot(input),
          onSnapshot: (snapshot) =>
            io.stdout(
              parsed.json
                ? JSON.stringify(snapshot) + "\n"
                : "\x1b[2J\x1b[H" + formatSnapshot("status", snapshot, config.output, feedOptions),
            ),
        });
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
      if (!configPath || !["run", "agents"].includes(subcommand ?? "")) {
        throw new UsageError("benchmark requires 'run <config-path>' or 'agents <manifest.json>'");
      }
      const manifest =
        subcommand === "agents"
          ? parseAgentComparisonManifest(readFileSync(configPath, "utf8"))
          : undefined;
      const configArgs =
        manifest?.configDirectory && !parsed.configDirectory
          ? {
              ...parsed,
              configDirectory: resolve(dirname(resolve(configPath)), manifest.configDirectory),
            }
          : parsed;
      const config = configuration(configArgs);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const { buildProviderRegistry, parseBenchmarkConfig, runBenchmark, runAgentComparison } =
        await import("@loop/orchestrator");
      if (subcommand === "agents") {
        if (!manifest) throw new UsageError("agent comparison manifest is required");
        const report = await runAgentComparison({
          ...manifest,
          control: protocol,
          providers:
            options.providers ??
            ((workspace) => buildProviderRegistry({ config, projectRoot: workspace })),
          databasePath: config.databasePath,
          sourceDirectory: manifest.sourceDirectory ?? process.cwd(),
          workspaceRoot: mkdtempSync(join(tmpdir(), "loop-agent-comparison-")),
        });
        if (parsed.json) io.stdout(`${JSON.stringify(report)}\n`);
        else io.stdout(formatAgentComparison(report, config.output));
        return 0;
      }
      const benchmark = parseBenchmarkConfig(readFileSync(configPath, "utf8"), configPath);
      const providers =
        options.providers ?? buildProviderRegistry({ config, projectRoot: process.cwd() });
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
      else
        io.stdout(
          [
            "Loop offline acceptance",
            `State: ${receipt.status}`,
            `Tasks: ${receipt.tasks}`,
            `Max concurrency: ${receipt.maxConcurrent}`,
            `Escalations: ${receipt.escalations}`,
          ].join("\n") + "\n",
        );
      return receipt.status === "completed" ? 0 : 1;
    }
    if (parsed.command === "__steer-relay") {
      const [runId, taskId] = parsed.operands;
      if (!runId || !taskId) throw new UsageError("__steer-relay requires <run-id> <task-id>");
      if (!parsed.databasePath) throw new UsageError("__steer-relay requires --database <path>");
      return await runSteerRelay({ runId, taskId, databasePath: parsed.databasePath, io });
    }
    if (parsed.command === "__execute-plan" || parsed.command === "__dispatch") {
      const payload =
        parsed.command === "__execute-plan"
          ? parseExecutionPayload(options.stdin ?? (await Bun.stdin.text()))
          : undefined;
      const runId = payload?.runId ?? parsed.operands[0];
      if (!runId) throw new UsageError("__dispatch requires <run-id>");
      const config = configuration(parsed);
      const protocol = await loadProtocol();
      await protocol.rustra.ready();
      const input = { databasePath: config.databasePath, runId };
      const { buildProviderRegistry, LoopRuntime } = await import("@loop/orchestrator");
      const plan = payload ?? (await protocol.getRunPlan(input));
      const runtime = new LoopRuntime({
        control: protocol,
        databasePath: config.databasePath,
        providers: buildProviderRegistry({
          config,
          projectRoot: plan.workingDirectory,
          activityRecorder: protocol,
          relayCommand: steerRelayCommandBuilder(parsed, config, options),
        }),
        maxWorkers: config.scheduler.maxWorkers,
        maxFrontierWorkers: config.scheduler.maxFrontierWorkers,
        workerVisibility: config.output.workerVisibility,
        computeSelection: config.routing.computeSelection,
      });
      if (payload) {
        await runtime.prepare(payload);
        const owner = await launchOwner(parsed, config, runId, plan.workingDirectory, options);
        if (parsed.detach) {
          const ready = await waitForOwnerReady({ owner, snapshot: () => runtime.snapshot(runId) });
          print(
            { runId, state: ready.state, ownerPid: owner.pid, lastSequence: ready.lastSequence },
            true,
            io,
          );
          return 0;
        }
        const summary = await observeRun({
          snapshot: () => runtime.snapshot(runId),
          owner,
          onSnapshot: (snapshot) => {
            if (parsed.stream)
              io.stdout(JSON.stringify({ type: "snapshot", value: snapshot }) + "\n");
          },
        });
        io.stdout(
          parsed.stream
            ? JSON.stringify({ type: "summary", value: summary }) + "\n"
            : JSON.stringify(summary) + "\n",
        );
      } else {
        const stop = new AbortController();
        const abort = () => stop.abort();
        process.once("SIGTERM", abort);
        process.once("SIGINT", abort);
        try {
          await runtime.execute(runId, stop.signal);
        } finally {
          process.off("SIGTERM", abort);
          process.off("SIGINT", abort);
        }
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
  host?: string;
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
  let host: string | undefined;
  let helpRequested = false;
  let execute = false;
  let dryRun = true;
  let keep: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) break; // index < argv.length 가 범위를 보장한다
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
    } else if (argument === "--host") {
      const value = argv[index + 1];
      if (!value) throw new UsageError(`${argument} requires a value`);
      host = value;
      index += 1;
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
    host,
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
  return runner(
    buildInteractiveLeadInvocation({
      command: config.lead.command,
      provider: config.lead.provider,
      model: config.lead.model,
      intent,
      cwd: process.cwd(),
      executablePath,
      environment: process.env,
      configDirectory: config.configDirectory,
    }),
  );
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
    detail: ready
      ? "available"
      : bounded(redact(result.output.trim()) || `exit ${result.exitCode}`),
    auth: ready ? "ready" : "unavailable",
  });
}

async function loadProtocol(): Promise<typeof import("@loop/protocol")> {
  prepareBridgeEnvironment();
  return import("@loop/protocol");
}

function prepareBridgeEnvironment(): void {
  if (process.env.RUSTRA_BUN_LIBRARY) return;
  const library =
    process.platform === "darwin"
      ? "libloop_bridge.dylib"
      : process.platform === "win32"
        ? "loop_bridge.dll"
        : "libloop_bridge.so";
  const adjacent = join(dirname(process.execPath), library);
  if (existsSync(adjacent)) process.env.RUSTRA_BUN_LIBRARY = adjacent;
}

export function formatSnapshot(
  command: string,
  snapshot: SnapshotOutput,
  limits: OutputLimits,
  options?: SnapshotRenderOptions,
): string {
  return (
    renderSnapshot(command, snapshot, limits, options).replace("Next: /loop", "Next: loop") + "\n"
  );
}

export function formatCleanupSnapshot(
  snapshot: import("@loop/protocol").CleanupRunOutput & { removedHerdrWorkspaces?: string[] },
  limits: OutputLimits,
  dryRun: boolean,
): string {
  const prefix = dryRun ? "[DRY RUN] " : "";
  const removedHerdrWorkspaces = snapshot.removedHerdrWorkspaces ?? [];
  const herdrRemoved = removedHerdrWorkspaces.length;
  const lines = [
    `${prefix}Cleanup Report`,
    `Removed: ${snapshot.removedArtifacts.length} artifacts` +
      (herdrRemoved ? `, ${herdrRemoved} leaked workspaces` : ""),
    `Skipped: ${snapshot.skippedArtifacts.length}`,
  ];
  if (herdrRemoved > 0) {
    lines.push(...removedHerdrWorkspaces.map((w) => `${cleanupBullet} Workspace ${w} (leaked)`));
  }
  if (snapshot.removedArtifacts.length > 0) {
    lines.push(...snapshot.removedArtifacts.map((a) => `${cleanupBullet} ${a}`));
  }
  if (snapshot.skippedArtifacts.length > 0) {
    lines.push(
      ...snapshot.skippedArtifacts.map((a) => `${statusGlyph.warning} ${a.artifact} (${a.reason})`),
    );
  }

  return `${compactLines(lines, {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "lines"),
  }).join("\n")}\n`;
}

export function formatBenchmarkReport(report: BenchmarkReport, limits: OutputLimits): string {
  const { benchmark } = report;
  const lines = [
    `Benchmark: ${benchmark.name}`,
    `Intent: ${benchmark.intent}`,
    `Profiles: ${benchmark.profiles.join(", ")} ${separator.list} ${benchmark.iterations} iteration(s) each`,
  ];
  for (const run of report.runs) {
    const created = run.summary.tasks_created ?? 0;
    const completed = run.summary.tasks_completed ?? 0;
    const attempts =
      (run.summary.verification_passes ?? 0) + (run.summary.verification_failures ?? 0);
    lines.push(
      `${run.status === "completed" ? statusGlyph.success : statusGlyph.warning} ${run.profile} iter ${run.iteration} ${separator.list} ${run.runId}` +
        ` ${separator.list} ${run.status} ${separator.list} tasks ${completed}/${created} ${separator.list} attempts ${attempts}` +
        ` ${separator.list} retries ${run.summary.verification_failures ?? 0} ${separator.list} attention ${run.summary.attention_created ?? 0}`,
    );
  }
  lines.push("Ranking (total score, highest first)");
  report.comparison.rankings.forEach((ranking, index) => {
    const total = ranking.score.reliability + ranking.score.autonomy + ranking.score.first_pass;
    lines.push(
      `${index + 1}. ${ranking.label} ${separator.list} total ${total}` +
        ` (reliability ${ranking.score.reliability} ${separator.list} autonomy ${ranking.score.autonomy} ${separator.list} first-pass ${ranking.score.first_pass})`,
    );
  });
  return `${compactLines(lines, {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "report lines", "use --json for the full report"),
  }).join("\n")}\n`;
}

export function formatAgentComparison(report: AgentComparisonReport, limits: OutputLimits): string {
  const ranked = [...report.rows].sort(
    (a, b) =>
      b.verifiedCriteria - a.verifiedCriteria ||
      a.scopeViolations.length - b.scopeViolations.length ||
      (a.summary.verification_failures ?? 0) - (b.summary.verification_failures ?? 0) ||
      a.elapsedMs - b.elapsedMs ||
      a.providerId.localeCompare(b.providerId),
  );
  const lines = [
    `Agent comparison: ${report.name}`,
    `Source commit: ${report.sourceCommit.slice(0, 12)}`,
    `Trials: ${report.rows.length} ${separator.list} actual cost unmeasured`,
    ...ranked.map(
      (row, index) =>
        `${index + 1}. ${row.providerId} iter ${row.iteration} ${separator.list} ${row.status} ${separator.list} criteria ${row.verifiedCriteria}/${row.totalCriteria} ${separator.list} scope ${row.scopeViolations.length} ${separator.list} retries ${row.summary.verification_failures ?? 0} ${separator.list} ${row.elapsedMs}ms`,
    ),
  ];
  return `${compactLines(lines, {
    lineLimit: limits.statusLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "trials", "use --json for the full report"),
  }).join("\n")}\n`;
}

export function formatModelList(
  models: Array<{ computeClass: string; id: string }>,
  limits: OutputLimits,
): string {
  if (models.length === 0) return `${emptyState.noModels}\n`;
  return `${compactLines(
    models.map((model) => `${model.computeClass} ${separator.list} ${model.id}`),
    {
      lineLimit: limits.listLineLimit,
      lineTextLimit: limits.lineTextLimit,
      overflow: (omitted) => moreItems(omitted, "models"),
    },
  ).join("\n")}\n`;
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
      return `${check.ok ? statusGlyph.success : statusGlyph.warning} ${check.name}: ${check.detail}${auth}`;
    }),
  ];
  return `${compactLines(lines, {
    lineLimit: limits.listLineLimit,
    lineTextLimit: limits.lineTextLimit,
    overflow: (omitted) => moreItems(omitted, "checks", `${failed} failed, ${passed} passed`),
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
  const extension =
    input.environment.LOOP_PI_EXTENSION ||
    (basename(input.executablePath) === "loop" ? adjacentExtension : developmentExtension);
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
    offlineTask(
      "decision",
      "decision",
      ["research-a", "research-b", "research-c"],
      [".loop/decision"],
    ),
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
    completionChecks: [
      {
        id: "offline-check",
        command: "true",
        args: [],
        workingDirectory: null,
        timeoutMs: 5_000,
      },
    ],
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
  criteria?: GoalCriterionInput[];
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
  if (
    payload.criteria !== undefined &&
    (!Array.isArray(payload.criteria) || payload.criteria.length === 0)
  ) {
    throw new UsageError("execution payload criteria must be a non-empty array");
  }
  return {
    intent: typeof payload.intent === "string" ? payload.intent : undefined,
    runId: payload.runId,
    workingDirectory: payload.workingDirectory,
    tasks: payload.tasks as TaskSpecInput[],
    ...(payload.criteria ? { criteria: payload.criteria as GoalCriterionInput[] } : {}),
  };
}

function parseAgentComparisonManifest(value: string): {
  name: string;
  intent: string;
  sourceDirectory?: string;
  configDirectory?: string;
  tasks: TaskSpecInput[];
  criteria: GoalCriterionInput[];
  candidateIds: string[];
  iterations: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new UsageError("agent comparison manifest must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new UsageError("agent comparison manifest must be an object");
  const item = parsed as Record<string, unknown>;
  if (
    typeof item.name !== "string" ||
    !item.name.trim() ||
    typeof item.intent !== "string" ||
    !item.intent.trim() ||
    !Array.isArray(item.tasks) ||
    !Array.isArray(item.criteria) ||
    !Array.isArray(item.candidateIds) ||
    item.candidateIds.some((id) => typeof id !== "string" || !id.trim()) ||
    (item.sourceDirectory !== undefined &&
      (typeof item.sourceDirectory !== "string" || !item.sourceDirectory.startsWith("/"))) ||
    (item.configDirectory !== undefined &&
      (typeof item.configDirectory !== "string" || !item.configDirectory.trim()))
  ) {
    throw new UsageError(
      "agent comparison needs name, intent, tasks, criteria, candidateIds, and an optional absolute sourceDirectory",
    );
  }
  return {
    name: item.name,
    intent: item.intent,
    tasks: item.tasks as TaskSpecInput[],
    criteria: item.criteria as GoalCriterionInput[],
    candidateIds: item.candidateIds as string[],
    iterations: item.iterations === undefined ? 1 : Number(item.iterations),
    ...(item.sourceDirectory ? { sourceDirectory: item.sourceDirectory as string } : {}),
    ...(item.configDirectory ? { configDirectory: item.configDirectory as string } : {}),
  };
}

function parseTaskPayload(value: string): TaskSpecInput {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as TaskSpecInput;
  } catch {
    /* stable usage error below */
  }
  throw new UsageError("add-task requires a TaskSpecInput JSON object on stdin");
}

function parseGoalTaskPayload(value: string): {
  task: TaskSpecInput;
  criteria: GoalCriterionInput[];
} {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const payload = parsed as Record<string, unknown>;
      if (
        payload.task &&
        typeof payload.task === "object" &&
        Array.isArray(payload.criteria) &&
        payload.criteria.length > 0
      ) {
        return {
          task: payload.task as TaskSpecInput,
          criteria: payload.criteria as GoalCriterionInput[],
        };
      }
    }
  } catch {
    /* stable usage error below */
  }
  throw new UsageError("add-goal-task requires task and non-empty criteria JSON");
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
  loop nightly [--dry-run|--execute] [--json]  Resume eligible unfinished runs once
  loop status [run-id] [--json]
  loop graph <run-id>
  loop workers <run-id>
  loop attention <run-id>
  loop models [--json]
  loop pair [--host <tailscale-host>] [--json]
                                    Print the loop:// pairing URL and QR for the running gateway
  loop cancel <run-id>
  loop pause <run-id>               Finish active tasks, stop scheduling
  loop resume <run-id>              Continue the saved graph in the background
  loop watch [run-id] [--json]
  loop health [--json]             Check unfinished runs for missing execution owners
  loop reconcile <run-id> <task-id> stopped  Confirm an orphaned task stopped before retrying
  loop task <run-id> <task-id>       Show context, results and verification evidence
  loop guidance <run-id> <task-id>   Show recorded, delivered, and post-delivery checked guidance
  loop add-task <run-id> --json      Read TaskSpecInput JSON from stdin and add it atomically
  loop add-goal-task <run-id> --json Read task and criteria JSON from stdin and add them atomically
  loop steer <run-id> <task-id|all> <message>
  loop resolve <run-id> <attention-id> <approved|retry|cancel|answer>
  loop cleanup [run-id] [--execute] [--keep <N>]
  loop benchmark run <config-path>    Compare workflow profiles (see config/persona-benchmark.example.toml)
  loop benchmark agents <manifest.json>  Compare configured agents on one clean Git commit
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
    value
      .replace(
        /(?:authorization|proxy-authorization)\s*["']?\s*[:=]\s*["']?[^\r\n,"'}]+/gi,
        "[authorization]=[redacted]",
      )
      .replace(
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
async function runSteerRelay(input: {
  runId: string;
  taskId: string;
  databasePath: string;
  io: CliIo;
}): Promise<number> {
  const protocol = await loadProtocol();
  await protocol.rustra.ready();
  const { redactProviderText } = await import("@loop/providers");
  const { runSteerRelaySession } = await import("@loop/herdr");
  const echo = (line: string) => input.io.stdout(`${line}\n`);
  echo(
    "steer relay ready — type a line to steer this worker; the relay exits when the worker finishes",
  );
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    await runSteerRelaySession(lines, {
      runId: input.runId,
      taskId: input.taskId,
      deliver: (delivery) =>
        protocol.steerRun({
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
    "__steer-relay",
    input.runId,
    input.taskId,
    "--database",
    input.databasePath,
  ];
  return { command: input.executablePath, args };
}

/** Watch-to-steer: per-worker relay commands hosted inside the worker's Herdr pane. */
function steerRelayCommandBuilder(
  parsed: ParsedArguments,
  config: LoopConfig,
  options: RunCliOptions,
) {
  const executablePath = options.executablePath ?? process.execPath;
  const sourceEntry = basename(executablePath).startsWith("bun")
    ? resolve(import.meta.dir, "main.ts")
    : undefined;
  // The pane's cwd is the worktree, so the relay must receive an absolute database path.
  const databasePath = resolve(config.databasePath);
  return (worker: { runId: string; taskId: string }) =>
    buildSteerRelayCommand({
      executablePath,
      sourceEntry,
      databasePath,
      runId: worker.runId,
      taskId: worker.taskId,
    });
}

function launchOwner(
  parsed: ParsedArguments,
  config: LoopConfig,
  runId: string,
  cwd: string,
  options: RunCliOptions,
) {
  const executable = options.executablePath ?? process.execPath;
  const sourceEntry = basename(executable).startsWith("bun")
    ? resolve(import.meta.dir, "main.ts")
    : undefined;
  return spawnOwner({
    executable,
    sourceEntry,
    runId,
    databasePath: resolve(config.databasePath),
    configDirectory: resolve(resolveConfigDirectory({ explicit: parsed.configDirectory })),
    cwd,
  });
}
