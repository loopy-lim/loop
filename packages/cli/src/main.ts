import { ensureGatewayRunning, formatGatewayStatusJson, formatGatewayStatusText, gatewayStop, readGatewayStatus } from "./gateway";
import { runPairCommand } from "./pair";
import {
  handleCliError,
  defaultIo,
  help,
  print,
  probeCommand,
  UsageError,
  type CliIo,
  type InteractiveLeadInvocation,
  type ProbeResult,
  type RunCliOptions,
} from "./cli-shared";
import { configuration, parse, type ParsedArguments } from "./args";
import { doctor } from "./doctor";
import { startInteractiveLead, runInteractiveLead } from "./interactive-lead";
import { verifyInstall } from "./verify-install";
import { cleanupCommand, healthCommand, nightlyCommand, runsCommand } from "./run-lifecycle";
import { addGoalTaskCommand, addTaskCommand, promoteSteerCommand } from "./ingest";
import { goalLedgerCommand, guidanceCommand } from "./inspection";
import { benchmarkCommand } from "./benchmark-command";
import { executePlanCommand } from "./execute-plan";
import { runControlCommand, runSteerRelay } from "./run-control";

// Re-exported so tests and embedders can keep importing from the CLI entry.
export type { CliIo, InteractiveLeadInvocation, ProbeResult, RunCliOptions };
export { UsageError };
export {
  formatSnapshot,
  formatCleanupSnapshot,
  formatBenchmarkReport,
  formatAgentComparison,
  formatModelList,
  formatDoctorChecks,
} from "./formatters";
export { buildInteractiveLeadInvocation } from "./interactive-lead";
export { buildSteerRelayCommand } from "./run-control";
import { formatModelList } from "./formatters";

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
      return await runPairCommand(
        {
          env: process.env,
          probe: options.probe ?? probeCommand,
          // Auto-start (decision: loop pair auto-spawn): reuse a live gateway,
          // otherwise spawn the composition root as a detached daemon with a
          // Tailscale bind IP, a free port, and the default database path.
          ensureGateway: async () => {
            await ensureGatewayRunning({
              env: process.env,
              probe: options.probe ?? probeCommand,
              databasePath: parsed.databasePath,
              executablePath: options.executablePath ?? process.execPath,
            });
          },
        },
        io,
        {
          hostFlag: parsed.host,
          json: parsed.json,
        },
      );
    }
    if (parsed.command === "gateway") {
      return await gatewayCommand(parsed, options, io);
    }
    if (parsed.command === "models") {
      const config = configuration(parsed);
      if (parsed.json) print(config.models, true, io);
      else io.stdout(formatModelList(config.models, config.output));
      return 0;
    }
    if (parsed.command === "cleanup") return await cleanupCommand(parsed, options, io);
    if (parsed.command === "runs") return await runsCommand(parsed, io);
    if (parsed.command === "health") return await healthCommand(parsed, io);
    if (parsed.command === "nightly") return await nightlyCommand(parsed, options, io);
    if (parsed.command === "guidance") return await guidanceCommand(parsed, io);
    if (parsed.command === "goal-ledger") return await goalLedgerCommand(parsed, io);
    if (parsed.command === "add-task") return await addTaskCommand(parsed, options, io);
    if (parsed.command === "add-goal-task") return await addGoalTaskCommand(parsed, options, io);
    if (parsed.command === "promote-steer") return await promoteSteerCommand(parsed, options, io);
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
      return await runControlCommand(parsed, options, io);
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
    if (parsed.command === "benchmark") return await benchmarkCommand(parsed, options, io);
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
      return await executePlanCommand(parsed, options, io);
    }
    throw new UsageError(`unknown command: ${parsed.command}`);
  } catch (error) {
    return handleCliError(error, io);
  }
}

async function gatewayCommand(parsed: ParsedArguments, options: RunCliOptions, io: CliIo): Promise<number> {
  const subcommand = parsed.operands[0] ?? "status";
  if (subcommand !== "status" && subcommand !== "stop") {
    throw new UsageError("gateway requires 'status' or 'stop'");
  }
  const gatewayDeps = {
    env: process.env,
    probe: options.probe ?? probeCommand,
    databasePath: parsed.databasePath,
    executablePath: options.executablePath ?? process.execPath,
  };
  if (subcommand === "status") {
    const status = await readGatewayStatus(gatewayDeps);
    io.stdout(parsed.json ? formatGatewayStatusJson(status) : formatGatewayStatusText(status));
    return 0;
  }
  const stop = await gatewayStop(gatewayDeps);
  io.stdout(`${stop.message}\n`);
  return stop.exitCode;
}

if (import.meta.main) {
  process.exitCode = await runCli(Bun.argv.slice(2));
}
