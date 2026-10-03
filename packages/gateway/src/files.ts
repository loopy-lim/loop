/**
 * Read-only working-directory file surface (split-viewer design §A): list a
 * directory and read text file content, both confined to the gateway's
 * configured working directory. Fail-closed by construction:
 *
 * - Relative paths only — absolute paths and any `..` segment are rejected
 *   before resolution (`file_path_rejected`, 400).
 * - Resolution is double-checked against the realpath of the root, so a
 *   symlink inside the tree cannot smuggle a read outside it
 *   (`file_path_rejected` / `file_not_found`).
 * - Text-only: content with NUL bytes or invalid UTF-8 is rejected
 *   (`file_not_text`, 415).
 * - 512 KB per-file cap (`file_too_large`, 413), checked from stat before
 *   reading — an oversized file never enters memory.
 * - Content responses carry a strong ETag over the exact bytes; a matching
 *   `If-None-Match` short-circuits to 304 (viewer lazy-load, no polling).
 *
 * Read-only: the module performs no writes and deletes nothing. The gateway
 * server treats the dep as optional (absent → 404), like every other
 * fail-closed surface.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { ProblemError } from "./problem";

/** Per-file response cap (split-viewer design §A): 512 KiB. */
export const MAX_FILE_VIEW_BYTES = 512 * 1024;

/** One entry of a directory listing (split-viewer design §A fields). */
export type DirectoryEntry = {
  name: string;
  size: number;
  isDir: boolean;
  /** Modification time in epoch ms (client-side sorting/display only). */
  mtimeMs: number;
};

export type FileViewerOptions = {
  /** Absolute root the surface is confined to (the Loop working directory). */
  root: string;
  maxFileBytes?: number;
};

/** Text-only read result served by GET /v1/files/content. */
export type FileContent = {
  text: string;
  /** Strong ETag over the exact bytes (quoted entity-tag). */
  etag: string;
};

/** True when the bytes look like text: no NUL bytes and valid UTF-8. */
function looksLikeText(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0) return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return true;
}

function etagFor(bytes: Uint8Array): string {
  return `"${Bun.hash(bytes).toString(16)}"`;
}

/**
 * Resolve a client-relative path inside the root, failing closed on
 * absolute paths, `..` traversal, and (via realpath canonicalization)
 * symlinks that leave the tree. Returns the canonical absolute path.
 */
export function resolveConfinedPath(root: string, raw: string): string {
  if (raw.length === 0) {
    throw new ProblemError(400, "invalid_request", { path: "path is required" });
  }
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
    throw new ProblemError(400, "file_path_rejected", { path: "absolute paths are rejected" });
  }
  const segments = raw.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new ProblemError(400, "file_path_rejected", { path: "path traversal is rejected" });
  }
  const joined = resolve(root, ...segments);
  // Symlink escape check: canonicalize both sides. The root is canonical
  // once at call time; a nonexistent target surfaces as file_not_found.
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    throw new ProblemError(404, "file_not_found");
  }
  let canonical: string;
  try {
    canonical = realpathSync(joined);
  } catch {
    throw new ProblemError(404, "file_not_found");
  }
  if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}/`)) {
    throw new ProblemError(400, "file_path_rejected", {
      path: "path escapes the working directory",
    });
  }
  return canonical;
}

/** Read-only file list + text content over the working directory (§A). */
export class FileViewer {
  readonly #root: string;
  readonly #maxFileBytes: number;

  constructor(options: FileViewerOptions) {
    this.#root = resolve(options.root);
    this.#maxFileBytes = options.maxFileBytes ?? MAX_FILE_VIEW_BYTES;
  }

  /** GET /v1/files?dir=<relative>: entries of the directory (relative "",
   * the root itself, lists the root). Entries that cannot be stat'd are
   * skipped (fail-observer, pane-mirror precedent). Directories first,
   * then names lexicographically. */
  list(relativeDir: string): DirectoryEntry[] {
    const dir = relativeDir.length === 0 ? "." : relativeDir;
    const canonical = dir === "." ? this.#root : resolveConfinedPath(this.#root, dir);
    if (!statSync(canonical).isDirectory()) {
      throw new ProblemError(400, "file_path_rejected", { dir: "not a directory" });
    }
    const entries: DirectoryEntry[] = [];
    for (const name of readdirSync(canonical)) {
      try {
        const stats = statSync(join(canonical, name));
        entries.push({
          name,
          size: stats.size,
          isDir: stats.isDirectory(),
          mtimeMs: stats.mtimeMs,
        });
      } catch {
        // Raced or unreadable entry: omit it, never fabricate metadata.
      }
    }
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return entries;
  }

  /** GET /v1/files/content?path=<relative>: text content + strong ETag. */
  readText(relativePath: string): FileContent {
    const canonical = resolveConfinedPath(this.#root, relativePath);
    const stats = statSync(canonical);
    if (stats.isDirectory()) {
      throw new ProblemError(400, "file_path_rejected", { path: "not a file" });
    }
    if (stats.size > this.#maxFileBytes) {
      throw new ProblemError(413, "file_too_large");
    }
    const buffer = readFileSync(canonical);
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (!looksLikeText(view)) {
      throw new ProblemError(415, "file_not_text");
    }
    return { text: new TextDecoder("utf-8").decode(view), etag: etagFor(view) };
  }
}
