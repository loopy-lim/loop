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
  const args = [...(input.sourceEntry ? [input.sourceEntry] : []), "__dispatch", input.runId, "--database", input.databasePath];
  if (input.configDirectory) args.push("--config", input.configDirectory);
  const child = spawn(input.executable, args, { cwd: input.cwd, detached: true, stdio: "ignore", env: process.env, shell: false });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  return child;
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
    if (["completed", "cancelled", "failed", "paused"].includes(snapshot.state)
      || (snapshot.state === "attention" && snapshot.activeWorkers.length === 0 && !snapshot.tasks.some(task => task.state === "verifying"))) {
      return { status: snapshot.state, tasks: snapshot.tasks.length };
    }
    const leaseAlive = snapshot.executionExpiresAt != null && Number(snapshot.executionExpiresAt) > Date.now();
    if (input.owner && (input.owner.exitCode !== null || input.owner.signalCode !== null)) {
      const anotherOwner = leaseAlive && snapshot.executionOwner && !snapshot.executionOwner.startsWith(`${input.owner.pid}:`);
      if (!anotherOwner) throw new Error(`Execution owner stopped before the run finished. Inspect loop status ${snapshot.runId} and use loop resume ${snapshot.runId} to recover.`);
      input.owner = undefined;
    }
    if ((snapshot.executionExpiresAt != null && !leaseAlive) || (!leaseAlive && Date.now() - started > (input.ownerGraceMs ?? 15000))) {
      throw new Error(`Execution owner is not responding. Inspect loop status ${snapshot.runId} before resuming.`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
