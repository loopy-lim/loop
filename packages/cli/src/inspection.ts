import { compactLines, moreItems } from "@loop/presentation";
import type { EventOutput } from "@loop/protocol";

import { loadProtocol, print, UsageError, type CliIo } from "./cli-shared";
import { configuration, type ParsedArguments } from "./args";
import { guidanceStatus } from "./guidance-status";
import { formatGoalLedger, goalLedger } from "./goal-ledger";

/** Bounded event-history read used by inspection commands: pages through the
 * event log until drained, refusing to buffer beyond a fixed limit. */
async function readEventHistory(
  protocol: Awaited<ReturnType<typeof loadProtocol>>,
  databasePath: string,
  runId: string,
  label: string,
): Promise<EventOutput[]> {
  const events: EventOutput[] = [];
  let afterSequence = 0;
  while (true) {
    const batch = await protocol.subscribeEvents({
      databasePath,
      runId,
      afterSequence,
      limit: 500,
    });
    events.push(...batch);
    if (events.length > 100_000)
      throw new Error(`${label} history exceeds the bounded read limit`);
    if (batch.length < 500) break;
    const last = batch.at(-1);
    if (last === undefined) break; // length >= 1 이 at(-1) 을 보장한다
    afterSequence = Number(last.sequence);
  }
  return events;
}

export async function guidanceCommand(parsed: ParsedArguments, io: CliIo): Promise<number> {
  const [runId, taskId] = parsed.operands;
  if (!runId || !taskId) throw new UsageError("guidance requires <run-id> <task-id>");
  const config = configuration(parsed);
  const protocol = await loadProtocol();
  await protocol.rustra.ready();
  const events = await readEventHistory(protocol, config.databasePath, runId, "guidance");
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

export async function goalLedgerCommand(parsed: ParsedArguments, io: CliIo): Promise<number> {
  const runId = parsed.operands[0];
  if (!runId) throw new UsageError("goal-ledger requires <run-id>");
  const config = configuration(parsed);
  const protocol = await loadProtocol();
  await protocol.rustra.ready();
  const input = { databasePath: config.databasePath, runId };
  const snapshot = await protocol.getSnapshot(input);
  const events = await readEventHistory(protocol, config.databasePath, runId, "goal-ledger");
  const view = goalLedger(
    {
      runId: snapshot.runId,
      runState: snapshot.state,
      tasks: snapshot.tasks.map((task) => ({ id: task.id, state: task.state })),
      criteria: snapshot.goalCriteria,
    },
    events,
  );
  if (parsed.json) io.stdout(`${JSON.stringify(view)}\n`);
  else io.stdout(formatGoalLedger(view, config.output));
  return view.total > 0 && view.verified === view.total ? 0 : 1;
}
