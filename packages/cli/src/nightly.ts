import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { SnapshotOutput } from "@loop/protocol";

export type NightlyDisposition =
  | "ready"
  | "settlement"
  | "stalled"
  | "paused"
  | "attention"
  | "owned"
  | "in-flight"
  | "no-ready-task"
  | "terminal-or-draining";

/** Only resume work that the existing durable graph says is ready. */
export function nightlyDisposition(snapshot: SnapshotOutput, now = Date.now()): NightlyDisposition {
  if (snapshot.state === "paused") return "paused";
  if (snapshot.state === "attention" || snapshot.openAttentionIds.length > 0) return "attention";
  if (snapshot.state !== "active") return "terminal-or-draining";
  if (snapshot.executionExpiresAt != null && Number(snapshot.executionExpiresAt) > now)
    return "owned";
  if (
    snapshot.activeWorkers.length > 0 ||
    snapshot.tasks.some((task) => ["running", "verifying", "attention"].includes(task.state))
  )
    return "in-flight";
  const done = new Set(
    snapshot.tasks.filter((task) => task.state === "done").map((task) => task.id),
  );
  if (
    snapshot.tasks.some(
      (task) =>
        task.state === "ready" ||
        (task.state === "pending" &&
          task.dependencies.every((id) => done.has(id)) &&
          task.blockedBy.length === 0),
    )
  )
    return "ready";
  if (snapshot.tasks.length > 0 && snapshot.tasks.every((task) => task.state === "done"))
    return "settlement";
  return snapshot.tasks.length > 0 ? "stalled" : "no-ready-task";
}

/** Atomic process lock; a dead or two-hour-old owner can be replaced. */
export async function withNightlyLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const acquire = (): number => {
    try {
      return openSync(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let stale = false;
      try {
        const age = Date.now() - statSync(path).mtimeMs;
        const owner = Number(readFileSync(path, "utf8").trim());
        if (Number.isInteger(owner) && owner > 0) {
          try {
            process.kill(owner, 0);
          } catch (signalError) {
            stale = (signalError as NodeJS.ErrnoException).code === "ESRCH";
          }
        } else stale = age > 2 * 60 * 60 * 1000;
      } catch {
        /* Keep an ambiguous lock. */
      }
      if (!stale) throw new Error("nightly continuation is already running", { cause: error });
      unlinkSync(path);
      return openSync(path, "wx", 0o600);
    }
  };
  const fd = acquire();
  try {
    writeFileSync(fd, String(process.pid));
    return await action();
  } finally {
    closeSync(fd);
    unlinkSync(path);
  }
}
