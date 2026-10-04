import { resolve } from "node:path";

import { compactLines, moreItems, separator } from "@loop/presentation";

import {
  loadProtocol,
  print,
  probeCommand,
  redact,
  type CliIo,
  type RunCliOptions,
} from "./cli-shared";
import { configuration, type ParsedArguments } from "./args";
import { formatCleanupSnapshot } from "./formatters";
import { classifyRunHealth } from "./health";
import { nightlyDisposition, withNightlyLock } from "./nightly";
import { launchOwner } from "./run-control";
import { waitForOwnerReady } from "./dispatcher";

export async function cleanupCommand(
  parsed: ParsedArguments,
  options: RunCliOptions,
  io: CliIo,
): Promise<number> {
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

export async function runsCommand(parsed: ParsedArguments, io: CliIo): Promise<number> {
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

export async function healthCommand(parsed: ParsedArguments, io: CliIo): Promise<number> {
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

export async function nightlyCommand(
  parsed: ParsedArguments,
  options: RunCliOptions,
  io: CliIo,
): Promise<number> {
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
