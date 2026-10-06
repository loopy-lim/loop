import * as readline from "node:readline";
import { basename, resolve } from "node:path";

import { renderTaskContext, emptyState, type SnapshotRenderOptions } from "@loop/presentation";
import { resolveConfigDirectory } from "@loop/orchestrator/config";
import type { LoopConfig } from "@loop/orchestrator/config";

import { observeRun, spawnOwner, waitForOwnerReady } from "./dispatcher";
import { loadProtocol, print, UsageError, type CliIo, type RunCliOptions } from "./cli-shared";
import { configuration, type ParsedArguments } from "./args";
import { formatSnapshot } from "./formatters";

/** Run-attached control family: status/graph/workers/attention/cancel/pause/
 * resume/steer/resolve/reconcile/task/watch share one run-id resolution and
 * snapshot pipeline, so they live behind a single command body. */
export async function runControlCommand(
  parsed: ParsedArguments,
  options: RunCliOptions,
  io: CliIo,
): Promise<number> {
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
      throw new UsageError("resolve requires <run-id> <attention-id> <approved|retry|cancel|answer>");
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
    // Fire-and-forget here created lease-less zombie runs whenever the owner
    // failed to start (stall diagnosis C3). Confirm readiness like resolve
    // and nightly do, so a failed launch surfaces as an explicit error.
    const owner = await launchOwner(parsed, config, runId, plan.workingDirectory, options);
    await waitForOwnerReady({ owner, snapshot: () => protocol.getSnapshot(input) });
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
    else io.stdout(formatSnapshot(parsed.command ?? "status", snapshot, config.output));
  }
  return 0;
}

/**
 * Worker pane steer relay process (docs/decisions/2026-09-23-watch-to-steer.md).
 * Hosted inside a worker's Herdr pane via `herdr pane run`; each typed line is
 * delivered through the same steer backend as `loop steer` (steerRun) and
 * confirmed with one redacted, clamped echo line. The pane close on worker
 * finish ends stdin, so the relay exits with the worker's pane.
 */
export async function runSteerRelay(input: {
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
export function steerRelayCommandBuilder(
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

export function launchOwner(
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
