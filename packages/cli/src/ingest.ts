import { loadProtocol, print, UsageError, type CliIo, type RunCliOptions } from "./cli-shared";
import { configuration, type ParsedArguments } from "./args";
import {
  parseGoalTaskPayload,
  parsePromoteSteerPayload,
  parseTaskPayload,
} from "./payloads";

/** Stdin-payload ingestion family: add-task / add-goal-task / promote-steer
 * each parse one JSON payload and forward it through the protocol contract. */
export async function addTaskCommand(
  parsed: ParsedArguments,
  options: RunCliOptions,
  io: CliIo,
): Promise<number> {
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

export async function addGoalTaskCommand(
  parsed: ParsedArguments,
  options: RunCliOptions,
  io: CliIo,
): Promise<number> {
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

export async function promoteSteerCommand(
  parsed: ParsedArguments,
  options: RunCliOptions,
  io: CliIo,
): Promise<number> {
  const runId = parsed.operands[0];
  if (!runId) throw new UsageError("promote-steer requires <run-id>");
  const payload = parsePromoteSteerPayload(options.stdin ?? (await Bun.stdin.text()));
  const config = configuration(parsed);
  const protocol = await loadProtocol();
  await protocol.rustra.ready();
  const receipt = await protocol.promoteSteer({
    databasePath: config.databasePath,
    runId,
    ...payload,
  });
  print(receipt, parsed.json, io);
  return receipt.accepted ? 0 : 1;
}
