import { spawn, type ChildProcess } from "node:child_process";
import type { SnapshotOutput } from "@loop/protocol";

/** The owner has its own process group and no UI pipes: disconnecting an observer cannot kill work. */
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
  const child = spawn(input.executable, args, {
    cwd: input.cwd,
    detached: true,
    stdio: "ignore",
    env: process.env,
    shell: false,
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return child;
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
    const leaseAlive =
      latest.executionExpiresAt != null && Number(latest.executionExpiresAt) > Date.now();
    if (leaseAlive && latest.executionOwner?.startsWith(`${input.owner.pid}:`)) return latest;
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

export async function observeRun(input: {
  snapshot(): Promise<SnapshotOutput>;
  onSnapshot(snapshot: SnapshotOutput): void;
  owner?: ChildProcess;
  ownerGraceMs?: number;
}): Promise<{ status: string; tasks: number }> {
  let sequence = -1;
  const started = Date.now();
  while (true) {
    const snapshot = await input.snapshot();
    if (Number(snapshot.lastSequence) !== sequence) {
      sequence = Number(snapshot.lastSequence);
      input.onSnapshot(snapshot);
    }
    if (
      ["completed", "cancelled", "failed", "paused"].includes(snapshot.state) ||
      (snapshot.state === "attention" &&
        snapshot.activeWorkers.length === 0 &&
        !snapshot.tasks.some((task) => task.state === "verifying"))
    ) {
      return { status: snapshot.state, tasks: snapshot.tasks.length };
    }
    const leaseAlive =
      snapshot.executionExpiresAt != null && Number(snapshot.executionExpiresAt) > Date.now();
    if (input.owner && (input.owner.exitCode !== null || input.owner.signalCode !== null)) {
      const anotherOwner =
        leaseAlive &&
        snapshot.executionOwner &&
        !snapshot.executionOwner.startsWith(`${input.owner.pid}:`);
      if (!anotherOwner)
        throw new Error(
          `Execution owner stopped before the run finished. Inspect loop status ${snapshot.runId} and use loop resume ${snapshot.runId} to recover.`,
        );
      input.owner = undefined;
    }
    if (
      (snapshot.executionExpiresAt != null && !leaseAlive) ||
      (!leaseAlive && Date.now() - started > (input.ownerGraceMs ?? 15000))
    ) {
      throw new Error(
        `Execution owner is not responding. Inspect loop status ${snapshot.runId} before resuming.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
