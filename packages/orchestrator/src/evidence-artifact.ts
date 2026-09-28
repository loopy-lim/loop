import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { redact } from "./redact";

const INLINE_LIMIT = 500;

function segment(value: string): string {
  const label = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 40) || "item";
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `${label}-${digest}`;
}

/** Store only the already-bounded output that Loop can safely redact. */
export async function storeCheckOutput(
  databasePath: string, runId: string, taskId: string, checkId: string, stdout: string, stderr: string,
): Promise<{ path: string; preview: string } | undefined> {
  if (stdout.length + stderr.length <= INLINE_LIMIT) return undefined;
  const content = `stdout:\n${redact(stdout)}\n\nstderr:\n${redact(stderr)}\n`;
  const directory = resolve(`${databasePath}.artifacts`, segment(runId), segment(taskId));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const digest = createHash("sha256").update(content).digest("hex").slice(0, 20);
  const path = resolve(directory, `${segment(checkId)}-${digest}.txt`);
  let created = false;
  try {
    const file = await open(path, "wx", 0o600);
    created = true;
    try { await file.writeFile(content); await file.sync(); }
    finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      if (created) await unlink(path).catch(() => {});
      throw error;
    }
    const existing = await lstat(path);
    if (!existing.isFile() || (existing.mode & 0o077) !== 0) throw new Error("check artifact path is not a private regular file");
    if (await readFile(path, "utf8") !== content) throw new Error("check artifact path exists with different content");
  }
  return { path, preview: `Redacted output artifact saved: ${path}` };
}
