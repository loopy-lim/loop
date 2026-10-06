import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import type { SnapshotOutput } from "@loop/protocol";

/** Owner stdout/stderr land next to the database so a crashed owner leaves
 * evidence instead of vanishing with `stdio: "ignore"` (stall diagnosis C6). */
export function ownerLogPath(databasePath: string): string {
  return `${databasePath}.owner.log`;
}

/** The owner has its own process group and no UI pipes: disconnecting an
 * observer cannot kill work. Its output is appended to the owner log with a
 * spawn header, so crash evidence survives across resumes. */
export async function spawnOwner(input: {
  executable: string;
  sourceEntry?: string;
  runId: string;
  databasePath: string;
  configDirectory?: string;
  cwd: string;
}): Promise<ChildProcess> {
  const args = [
    ...(input.sourceEntry ? [input.sourceEntry] : []),
    "__dispatch",
    input.runId,
    "--database",
    input.databasePath,
  ];
  if (input.configDirectory) args.push("--config", input.configDirectory);
  const logFd = openSync(ownerLogPath(input.databasePath), "a");
  const closeLog = () => {
    try {
      closeSync(logFd);
    } catch {}
  };
  try {
    writeSync(
      logFd,
      `\n[${new Date().toISOString()}] owner ${input.runId} spawn: ${input.executable} ${args.join(" ")}\n`,
    );
    const child = spawn(input.executable, args, {
      cwd: input.cwd,
      detached: true,
      // The descriptors are duplicated into the child, so the parent copy can
      // be closed as soon as the process exists.
      stdio: ["ignore", logFd, logFd],
      env: process.env,
      shell: false,
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => {
        closeLog();
        resolve();
      });
      child.once("error", (error) => {
        closeLog();
        reject(error);
      });
    });
    child.unref();
    return child;
  } finally {
    closeLog();
  }
}

/** A detached handoff is accepted only after the child owns a live lease or
 * the run has already reached a durable terminal state. */
export async function waitForOwnerReady(input: {
  owner: ChildProcess;
  snapshot(): Promise<SnapshotOutput>;
  ownerGraceMs?: number;
}): Promise<SnapshotOutput> {
  // A previous owner's lease can remain valid for five seconds. Give a new
  // owner enough time to wait for that lease and then claim its own.
  const deadline = Date.now() + (input.ownerGraceMs ?? 15_000);
  let latest: SnapshotOutput | undefined;
  while (true) {
    latest = await input.snapshot();
    if (["completed", "failed", "cancelled"].includes(latest.state)) return latest;
    const currentLeaseAlive =
      latest.executionExpiresAt != null && Number(latest.executionExpiresAt) > Date.now();
    if (currentLeaseAlive && latest.executionOwner?.startsWith(`${input.owner.pid}:`)) return latest;
    if (input.owner.exitCode !== null || input.owner.signalCode !== null) {
      throw new Error(
        `Execution owner stopped before lease confirmation for run ${latest.runId} (${latest.state}).`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Execution owner lease was not confirmed for run ${latest.runId} (${latest.state}). Inspect loop status ${latest.runId}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Run states that end observation: the graph has stopped scheduling on its own. */
const OBSERVATION_END_STATES = ["completed", "cancelled", "failed", "paused"];

function observationEnded(snapshot: SnapshotOutput): boolean {
  return (
    OBSERVATION_END_STATES.includes(snapshot.state) ||
    (snapshot.state === "attention" &&
      snapshot.activeWorkers.length === 0 &&
      !snapshot.tasks.some((task) => task.state === "verifying"))
  );
}

function leaseAlive(snapshot: SnapshotOutput): boolean {
  return snapshot.executionExpiresAt != null && Number(snapshot.executionExpiresAt) > Date.now();
}

export async function observeRun(input: {
  snapshot(): Promise<SnapshotOutput>;
  onSnapshot(snapshot: SnapshotOutput): void;
  owner?: ChildProcess;
  ownerGraceMs?: number;
}): Promise<{ status: string; tasks: number }> {
  let sequence = -1;
  const started = Date.now();
  while (true) {
    let snapshot = await input.snapshot();
    if (Number(snapshot.lastSequence) !== sequence) {
      sequence = Number(snapshot.lastSequence);
      input.onSnapshot(snapshot);
    }
    if (observationEnded(snapshot)) {
      return { status: snapshot.state, tasks: snapshot.tasks.length };
    }
    if (input.owner && (input.owner.exitCode !== null || input.owner.signalCode !== null)) {
      // The owner can record its terminal state and exit between two polls,
      // so the snapshot above may predate that write. Re-read once before
      // declaring the run abandoned: a finished run must never be mistaken
      // for a dead owner (stall diagnosis C1).
      snapshot = await input.snapshot();
      if (Number(snapshot.lastSequence) !== sequence) {
        sequence = Number(snapshot.lastSequence);
        input.onSnapshot(snapshot);
      }
      const exitedCleanly = input.owner.exitCode === 0 && input.owner.signalCode === null;
      const anotherOwner =
        leaseAlive(snapshot) &&
        snapshot.executionOwner &&
        !snapshot.executionOwner.startsWith(`${input.owner.pid}:`);
      if (observationEnded(snapshot) || (exitedCleanly && !leaseAlive(snapshot))) {
        return { status: snapshot.state, tasks: snapshot.tasks.length };
      }
      if (!anotherOwner)
        throw new Error(
          `Execution owner stopped before the run finished. Inspect loop status ${snapshot.runId} and use loop resume ${snapshot.runId} to recover.`,
        );
      // A live replacement owner is executing the run; keep observing it.
      input.owner = undefined;
    }
    const alive = leaseAlive(snapshot);
    if (
      (snapshot.executionExpiresAt != null && !alive) ||
      (!alive && Date.now() - started > (input.ownerGraceMs ?? 15000))
    ) {
      throw new Error(
        `Execution owner is not responding. Inspect loop status ${snapshot.runId} before resuming.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
