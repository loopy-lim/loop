/**
 * File-viewer model (split-viewer design §B) — the pure state machine the
 * shared viewer component renders. No react-native import; the gateway
 * surface sits behind the `FileApi` port so tests run against a fake and
 * the RN component hands in the real client adapter.
 *
 * Lazy-load contract (§A/§B): content is fetched only when a file is
 * opened, never on a timer (no polling). Re-opening a known file
 * revalidates by ETag — a 304 keeps the cached text without a body
 * transfer. Directory listings are refetched on every navigation (cheap,
 * and the tree is live during a run).
 */

import { GatewayError } from "../gateway-client/problem";
/** One entry of GET /v1/files (gateway §A wire shape). */
export type RemoteFileEntry = {
  name: string;
  size: number;
  isDir: boolean;
  mtimeMs: number;
};

export type FileListing = { entries: RemoteFileEntry[] };

export type FileContentResult =
  | { kind: "ok"; text: string; etag: string }
  | { kind: "notModified"; etag: string };

/** Port over GET /v1/files and GET /v1/files/content. */
export type FileApi = {
  list(dir: string): Promise<FileListing>;
  content(path: string, etag?: string): Promise<FileContentResult>;
};

/** Viewer screen states. `targets` is the seeded §B entry list. */
export type ViewerPlace =
  | { kind: "targets" }
  | { kind: "dir"; dir: string; entries: RemoteFileEntry[] }
  | { kind: "file"; path: string; text: string; isMarkdown: boolean };

/** Problem codes the viewer translates into inline copy (never a crash,
 * never a toast storm — the row shows what happened). */
export type ViewerErrorCode =
  | "not_found"
  | "file_too_large"
  | "file_not_text"
  | "file_path_rejected"
  | "unauthorized"
  | "unavailable";

export function viewerErrorKind(status: number, code: string): ViewerErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (code === "file_too_large") return "file_too_large";
  if (code === "file_not_text") return "file_not_text";
  if (code === "file_path_rejected") return "file_path_rejected";
  return "unavailable";
}

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md") || path.toLowerCase().endsWith(".markdown");
}

/** Join a directory and entry name into a relative path. Root listing
 * (dir "") yields the bare name; the model never fabricates `./`. */
export function joinPath(dir: string, name: string): string {
  return dir.length === 0 ? name : `${dir}/${name}`;
}

/** Parent directory of a relative path; "" when already at the root. */
export function parentPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

type CachedContent = { text: string; etag: string };

/**
 * The viewer's navigation + cache state. Deterministic: all effects live
 * in the component; this class only reduces explicit commands.
 */
export class FileViewerModel {
  private contentCache = new Map<string, CachedContent>();

  constructor(private readonly api: FileApi) {}

  /** Seed targets rendered at the viewer root (split-layout §B list). */
  place: ViewerPlace = { kind: "targets" };
  /** Last error, cleared by the next successful command. */
  error: ViewerErrorCode | null = null;
  /** True while a list/content fetch is in flight (per-place guard). */
  loading = false;

  snapshot(): { place: ViewerPlace; error: ViewerErrorCode | null; loading: boolean } {
    return { place: this.place, error: this.error, loading: this.loading };
  }

  private fail(error: unknown): void {
    if (error instanceof GatewayError) {
      this.error = viewerErrorKind(error.problem.status, error.problem.code);
      return;
    }
    this.error = "unavailable";
  }

  /** Open a seeded target: directories land on `dir`, files on `file`. */
  async openTarget(path: string): Promise<ViewerPlace> {
    this.loading = true;
    this.error = null;
    try {
      // Files and directories are distinguished by asking the listing of
      // the parent: an entry that is not a directory is read directly.
      const parent = parentPath(path);
      const name = path.slice(parent.length === 0 ? 0 : parent.length + 1);
      const listing = await this.api.list(parent);
      const entry = listing.entries.find((candidate) => candidate.name === name);
      if (entry !== undefined && !entry.isDir) {
        return await this.openFile(path);
      }
      return await this.openDir(path);
    } catch (error) {
      this.fail(error);
      return this.place;
    } finally {
      this.loading = false;
    }
  }

  /** Navigate into a directory (lazy listing; no content is read). */
  async openDir(dir: string): Promise<ViewerPlace> {
    this.loading = true;
    this.error = null;
    try {
      const listing = await this.api.list(dir);
      this.place = { kind: "dir", dir, entries: listing.entries };
    } catch (error) {
      this.fail(error);
    } finally {
      this.loading = false;
    }
    return this.place;
  }

  /** Open a file: cache-first, then ETag revalidation (§A lazy load). */
  async openFile(path: string): Promise<ViewerPlace> {
    this.loading = true;
    this.error = null;
    try {
      const cached = this.contentCache.get(path);
      if (cached === undefined) {
        const result = await this.api.content(path);
        if (result.kind === "notModified") {
          // Unreachable by contract (a 304 requires a sent ETag); fail closed.
          this.error = "unavailable";
          return this.place;
        }
        this.contentCache.set(path, { text: result.text, etag: result.etag });
        this.place = { kind: "file", path, text: result.text, isMarkdown: isMarkdownPath(path) };
      } else {
        const result = await this.api.content(path, cached.etag);
        if (result.kind === "notModified") {
          this.place = { kind: "file", path, text: cached.text, isMarkdown: isMarkdownPath(path) };
        } else {
          this.contentCache.set(path, { text: result.text, etag: result.etag });
          this.place = { kind: "file", path, text: result.text, isMarkdown: isMarkdownPath(path) };
        }
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.loading = false;
    }
    return this.place;
  }

  /** Up one level from a dir/file place; from a file, to its directory. */
  async up(): Promise<ViewerPlace> {
    if (this.place.kind === "targets") return this.place;
    const current = this.place.kind === "dir" ? this.place.dir : this.place.path;
    const dir = parentPath(current);
    if (dir.length === 0) {
      this.place = { kind: "targets" };
      return this.place;
    }
    return await this.openDir(dir);
  }

  /** Back to the seeded targets (viewer root). */
  home(): ViewerPlace {
    this.place = { kind: "targets" };
    this.error = null;
    return this.place;
  }
}
