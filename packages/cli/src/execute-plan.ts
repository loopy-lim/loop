import {
  loadProtocol,
  print,
  UsageError,
  type CliIo,
  type RunCliOptions,
} from "./cli-shared";
import { configuration, type ParsedArguments } from "./args";
import { parseExecutionPayload } from "./payloads";
import { launchOwner, steerRelayCommandBuilder } from "./run-control";
import { observeRun, waitForOwnerReady } from "./dispatcher";

/** Detached execution family: `__execute-plan` accepts a full plan payload on
 * stdin (used by the owner handoff), while `__dispatch` resumes a persisted
 * plan as the detached execution owner. */
export async function executePlanCommand(
  parsed: ParsedArguments,
  options: RunCliOptions,
  io: CliIo,
): Promise<number> {
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
