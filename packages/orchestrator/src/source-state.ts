import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** A content snapshot of Git-visible files. Ignored build output is excluded. */
export interface SourceState {
  root: string;
  fingerprint: string;
  files: ReadonlyMap<string, string>;
}

export async function captureSourceState(
  directory: string,
  excludedAbsolutePaths: readonly string[] = [],
  scopes?: readonly string[],
): Promise<SourceState | undefined> {
  let root: string;
  try {
    root = await realpath(directory);
    // Only exact repository roots are audited. This avoids launching Git for
    // temporary non-repository fixtures and prevents ambiguous subdir scopes.
    await lstat(join(root, ".git"));
  } catch {
    return undefined;
  }
  let top: string;
  try {
    const result = await execFileAsync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    });
    top = await realpath(result.stdout.trim());
  } catch {
    return undefined;
  }
  // A run rooted in a subdirectory has ambiguous scope paths. Do not label
  // the parent repository's paths as if they were relative to this run.
  if (top !== root) return undefined;
  const { stdout } = await execFileAsync(
    "git",
    ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const excluded = await Promise.all(
    excludedAbsolutePaths.map(async (path) => {
      const absolute = resolve(root, path);
      try {
        return await realpath(absolute);
      } catch {
        return join(await realpath(dirname(absolute)), basename(absolute));
      }
    }),
  );
  const paths = [...new Set(Buffer.from(stdout).toString("utf8").split("\0").filter(Boolean))]
    .filter(
      (path) =>
        !excluded.some((base) => {
          const absolute = resolve(root, path);
          return (
            absolute === base ||
            absolute === `${base}-wal` ||
            absolute === `${base}-shm` ||
            absolute.startsWith(`${base}.artifacts${sep}`)
          );
        }),
    )
    .filter((path) => !scopes || scopes.length === 0 || scopeContainsPath(scopes, path))
    .sort();
  const files = new Map<string, string>();
  const total = createHash("sha256");
  for (const path of paths) {
    let bytes: Buffer;
    let mode: string;
    try {
      const stat = await lstat(`${root}/${path}`);
      mode = stat.isSymbolicLink() ? "link" : stat.isFile() ? "file" : "other";
      bytes = stat.isSymbolicLink()
        ? Buffer.from(await readlink(`${root}/${path}`))
        : stat.isFile()
          ? await readFile(`${root}/${path}`)
          : Buffer.alloc(0);
    } catch (error) {
      // A tracked deletion is part of the source state. Other I/O failures
      // should stop verification rather than silently produce a stable hash.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      mode = "deleted";
      bytes = Buffer.alloc(0);
    }
    const digest = createHash("sha256").update(mode).update("\0").update(bytes).digest("hex");
    files.set(path, digest);
    total.update(path).update("\0").update(digest).update("\0");
  }
  return { root, fingerprint: total.digest("hex"), files };
}

export function changedSourcePaths(before: SourceState, after: SourceState): string[] {
  if (before.root !== after.root)
    throw new Error("source snapshots belong to different repositories");
  return [...new Set([...before.files.keys(), ...after.files.keys()])]
    .filter((path) => before.files.get(path) !== after.files.get(path))
    .sort();
}

export function scopeContainsPath(scopes: readonly string[], path: string): boolean {
  return scopes.some((scope) => {
    if (scope === "." || scope === "./") return true;
    const normalized = scope.replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").includes(".."))
      return false;
    let pattern = "^";
    for (let index = 0; index < normalized.length; index++) {
      const char = normalized[index];
      if (char === undefined) break; // index < length 가 범위를 보장한다
      if (char === "*" && normalized[index + 1] === "*") {
        pattern += ".*";
        index++;
      } else if (char === "*") pattern += "[^/]*";
      else if (char === "?") pattern += "[^/]";
      else pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`${pattern}$`).test(path);
  });
}

export function scopedFingerprint(state: SourceState, scopes: readonly string[]): string {
  if (scopes.length === 0) return state.fingerprint;
  const hash = createHash("sha256");
  for (const [path, digest] of state.files) {
    if (scopeContainsPath(scopes, path)) hash.update(path).update("\0").update(digest).update("\0");
  }
  return hash.digest("hex");
}
