import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { loadProtocol, UsageError, type CliIo, type RunCliOptions } from "./cli-shared";
import { configuration, type ParsedArguments } from "./args";
import { formatAgentComparison, formatBenchmarkReport } from "./formatters";
import { parseAgentComparisonManifest } from "./payloads";

export async function benchmarkCommand(
  parsed: ParsedArguments,
  options: RunCliOptions,
  io: CliIo,
): Promise<number> {
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
