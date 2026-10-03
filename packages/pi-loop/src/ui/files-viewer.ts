import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import {
  HStack,
  Markdown,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";

/**
 * Section C of the 2026-10-02 split-viewer design: the Pi TUI `/files` overlay.
 *
 * Layout decisions kept deliberately boring:
 * - The component reads the local file system directly (extension and repo share
 *   a machine), lazily loading one file per selection. No polling, no gateway.
 * - `ctx.ui.custom()` overlays composite `component.render(width)` output and
 *   slice it at `maxHeight`; the scroll layout engine only runs in fullscreen.
 *   The viewer therefore windows the Markdown output itself (deterministic
 *   keyboard paging in both regular and fullscreen modes) while still composing
 *   the pane from the shared pi-tui `HStack` / `ScrollView` / `Markdown` parts.
 */

/** Hard cap for viewer file reads (mirrors the gateway file API budget). */
export const FILE_VIEWER_MAX_BYTES = 512 * 1024;

/** Terminal widths at or above this render list + viewer side by side. */
export const FILE_VIEWER_SPLIT_MIN_WIDTH = 96;

/** Fixed width of the file list pane in split mode. */
export const FILE_VIEWER_LIST_WIDTH = 34;

/** Hard cap on listed entries so a huge repo cannot stall the overlay. */
export const FILE_VIEWER_MAX_ENTRIES = 2000;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  ".bun",
  "coverage",
  ".pnpm-store",
]);

export interface ViewerFile {
  /** Path relative to the working directory, using `/` separators. */
  path: string;
  size: number;
}

/** Walk the working directory and list readable files (lazy, no polling). */
export async function listViewerFiles(rootDir: string): Promise<ViewerFile[]> {
  const files: ViewerFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (files.length >= FILE_VIEWER_MAX_ENTRIES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable subtree: skip quietly
    }
    for (const entry of entries) {
      if (files.length >= FILE_VIEWER_MAX_ENTRIES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = (await stat(full)).size;
      } catch {
        continue;
      }
      files.push({ path: relative(rootDir, full).split("\\").join("/"), size });
    }
  };
  await walk(rootDir);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

/**
 * Read one file for the viewer. Rejects absolute paths and `..` traversal,
 * confining reads to the working directory, and enforces the byte cap.
 */
export async function readViewerFile(
  rootDir: string,
  relativePath: string,
  maxBytes: number = FILE_VIEWER_MAX_BYTES,
): Promise<string> {
  if (relativePath.length === 0) throw new ViewerFileError("Empty path");
  if (resolve(relativePath) === relativePath)
    throw new ViewerFileError("Absolute paths are not allowed");
  const root = resolve(rootDir);
  const full = resolve(root, relativePath);
  if (full !== root && !full.startsWith(root + "\\") && !full.startsWith(root + "/")) {
    throw new ViewerFileError("Path escapes the working directory");
  }
  const info = await stat(full).catch(() => {
    throw new ViewerFileError("File not found");
  });
  if (!info.isFile()) throw new ViewerFileError("Not a regular file");
  if (info.size > maxBytes) {
    throw new ViewerFileError(`File exceeds the ${(maxBytes / 1024) | 0} KB viewer cap`);
  }
  const content = await readFile(full, "utf8");
  if (content.includes("\0")) throw new ViewerFileError("Binary file — not shown");
  return content;
}

export class ViewerFileError extends Error {}

/**
 * Structural subset of the Pi theme that the viewer needs. Pi's `Theme`
 * satisfies it, and tests can supply a plain recorder.
 */
export interface ViewerTheme {
  fg(token: ViewerFgToken, text: string): string;
  bg(token: ViewerBgToken, text: string): string;
  bold(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  strikethrough(text: string): string;
}

export type ViewerFgToken =
  | "accent"
  | "dim"
  | "muted"
  | "error"
  | "mdHeading"
  | "mdLink"
  | "mdLinkUrl"
  | "mdCode"
  | "mdCodeBlock"
  | "mdCodeBlockBorder"
  | "mdQuote"
  | "mdQuoteBorder"
  | "mdHr"
  | "mdListBullet";

export type ViewerBgToken = "selectedBg";

/** Reuse the active Pi theme for Markdown rendering (no second theme system). */
export function markdownThemeFrom(theme: ViewerTheme): MarkdownTheme {
  return {
    heading: (text) => theme.fg("mdHeading", text),
    link: (text) => theme.fg("mdLink", text),
    linkUrl: (text) => theme.fg("mdLinkUrl", text),
    code: (text) => theme.fg("mdCode", text),
    codeBlock: (text) => theme.fg("mdCodeBlock", text),
    codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),
    quote: (text) => theme.fg("mdQuote", text),
    quoteBorder: (text) => theme.fg("mdQuoteBorder", text),
    hr: (text) => theme.fg("mdHr", text),
    listBullet: (text) => theme.fg("mdListBullet", text),
    bold: (text) => theme.bold(text),
    italic: (text) => theme.italic(text),
    underline: (text) => theme.underline(text),
    strikethrough: (text) => theme.strikethrough(text),
  };
}

export interface FilesViewerOptions {
  rootDir: string;
  theme: ViewerTheme;
  files: ViewerFile[];
  /** Loader for one file's text (defaults to the local readViewerFile). */
  read?: (relativePath: string) => Promise<string>;
  done: (result: undefined) => void;
  /** Viewport height in body rows; defaults to a fraction of stdout rows. */
  viewportRows?: () => number;
  /** Called after async loads complete so the TUI re-renders. */
  requestRender?: () => void;
}

export function defaultViewerRows(): number {
  const rows = process.stdout.rows ?? 24;
  return Math.min(40, Math.max(8, rows - 8));
}

function padToWidth(line: string, width: number): string {
  const pad = Math.max(0, width - visibleWidth(line));
  return line + " ".repeat(pad);
}

/** Left pane: the file list with a selection highlight. */
class FileListPane implements Component {
  invalidate(): void {}

  constructor(
    private readonly viewer: () => { files: ViewerFile[]; selected: number; rows: number },
    private readonly theme: ViewerTheme,
  ) {}

  render(width: number): string[] {
    const { files, selected, rows } = this.viewer();
    if (files.length === 0) return [this.theme.fg("dim", padToWidth(" (no files)", width))];
    const visible = files.slice(0, rows);
    const lines = visible.map((file, index) => {
      const marker = index === selected ? "› " : "  ";
      const line = truncateToWidth(` ${marker}${file.path}`, width);
      return index === selected
        ? this.theme.bg("selectedBg", padToWidth(line, width))
        : this.theme.fg(index === selected ? "accent" : "muted", padToWidth(line, width));
    });
    if (files.length > visible.length) {
      lines.push(
        this.theme.fg("dim", padToWidth(` … ${files.length - visible.length} more`, width)),
      );
    }
    return lines;
  }
}

/** Thin vertical divider between split panes. */
class PaneDivider implements Component {
  invalidate(): void {}
  constructor(private readonly theme: ViewerTheme) {}
  render(_width: number): string[] {
    return [this.theme.fg("dim", "│")];
  }
}

/**
 * Right pane: Markdown content windowed to `rows` lines at `scroll`.
 * Wraps the shared pi-tui Markdown component; the windowing exists because
 * overlay compositing slices output instead of running the scroll layout.
 */
class MarkdownWindow implements Component {
  constructor(
    private readonly markdown: Markdown,
    private readonly viewer: () => { scroll: number; rows: number },
  ) {}

  invalidate(): void {
    this.markdown.invalidate();
  }

  render(width: number): string[] {
    const { scroll, rows } = this.viewer();
    const lines = this.markdown.render(width);
    const maxScroll = Math.max(0, lines.length - rows);
    const start = Math.min(Math.max(0, scroll), maxScroll);
    const window = lines.slice(start, start + rows);
    while (window.length < rows) window.push("");
    return window;
  }
}

/** Placeholder pane content (loading, error, hints). */
class StatusPane implements Component {
  invalidate(): void {}
  constructor(private readonly line: () => string) {}
  render(width: number): string[] {
    return [padToWidth(truncateToWidth(this.line(), width), width)];
  }
}

export class FilesViewerComponent {
  private selected = 0;
  /** Narrow-layout view toggle: false = list, true = open file. */
  private open = false;
  private scroll = 0;
  private readonly bodies = new Map<string, string>();
  private readonly pending = new Set<string>();
  private readonly errors = new Map<string, string>();
  private readonly markdowns = new Map<string, { markdown: Markdown; width: number }>();
  private listPane: FileListPane;
  private divider: PaneDivider;
  private split: boolean | undefined;

  constructor(private readonly options: FilesViewerOptions) {
    this.listPane = new FileListPane(() => this.paneState(), options.theme);
    this.divider = new PaneDivider(options.theme);
  }

  private get read(): (relativePath: string) => Promise<string> {
    return this.options.read ?? ((path) => readViewerFile(this.options.rootDir, path));
  }

  private get rows(): number {
    return (this.options.viewportRows ?? defaultViewerRows)();
  }

  private paneState(): { files: ViewerFile[]; selected: number; rows: number } {
    return { files: this.options.files, selected: this.selected, rows: this.rows };
  }

  private get current(): ViewerFile | undefined {
    return this.options.files[this.selected];
  }

  private isSplit(width: number): boolean {
    return width >= FILE_VIEWER_SPLIT_MIN_WIDTH;
  }

  /** Lazy, per-selection load. Resolved content triggers a single re-render. */
  private ensureLoaded(path: string): void {
    if (this.bodies.has(path) || this.pending.has(path) || this.errors.has(path)) return;
    this.pending.add(path);
    void this.read(path).then(
      (content) => {
        this.pending.delete(path);
        this.bodies.set(path, content);
        this.options.requestRender?.();
      },
      (error) => {
        this.pending.delete(path);
        this.errors.set(path, error instanceof Error ? error.message : String(error));
        this.options.requestRender?.();
      },
    );
  }

  private markdownFor(path: string, width: number): Markdown {
    const cached = this.markdowns.get(path);
    if (cached && cached.width === width) return cached.markdown;
    const markdown = new Markdown(
      this.bodies.get(path) ?? "",
      1,
      0,
      markdownThemeFrom(this.options.theme),
    );
    this.markdowns.set(path, { markdown, width });
    return markdown;
  }

  private viewerLine(): string {
    const file = this.current;
    if (!file) return this.options.theme.fg("dim", "No file selected");
    if (this.errors.has(file.path)) {
      return this.options.theme.fg("error", `! ${this.errors.get(file.path)}`);
    }
    if (this.pending.has(file.path)) return this.options.theme.fg("dim", "Loading…");
    if (!this.bodies.has(file.path)) {
      return this.options.theme.fg(
        "dim",
        this.isSplitOpen() ? "Press Enter to load" : "Press Enter to open",
      );
    }
    return "";
  }

  private isSplitOpen(): boolean {
    return this.split === true;
  }

  private viewerPane(width: number): Component {
    const file = this.current;
    const line = this.viewerLine();
    if (line) return new StatusPane(() => line);
    if (!file) return new StatusPane(() => this.options.theme.fg("dim", "No file selected"));
    return new MarkdownWindow(this.markdownFor(file.path, width), () => ({
      scroll: this.scroll,
      rows: this.rows,
    }));
  }

  invalidate(): void {
    for (const { markdown } of this.markdowns.values()) markdown.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const bodyWidth = safeWidth - 2;
    const split = this.isSplit(safeWidth);
    this.split = split;
    // Split mode always previews the selection; narrow mode loads on Enter only.
    if (split && this.current) this.ensureLoaded(this.current.path);
    const body: Component = split
      ? new HStack(
          [
            { component: this.listPane, basis: FILE_VIEWER_LIST_WIDTH },
            { component: this.divider, basis: 1 },
            {
              component: this.viewerPane(Math.max(10, bodyWidth - FILE_VIEWER_LIST_WIDTH - 1)),
              grow: 1,
            },
          ],
          { align: "stretch" },
        )
      : this.open
        ? this.viewerPane(bodyWidth)
        : this.listPane;

    const lines = [
      this.headerLine(safeWidth),
      ...body.render(bodyWidth).map((l) => ` ${l}`),
      this.footerLine(safeWidth),
    ];
    return lines.map((line) => padToWidth(truncateToWidth(line, safeWidth), safeWidth));
  }

  private headerLine(width: number): string {
    const file = this.current;
    const title = file && (this.isSplitOpen() || this.open) ? file.path : this.options.rootDir;
    const count = `${this.options.files.length} files`;
    const text = ` Loop files · ${title} · ${count}`;
    return this.options.theme.fg(
      "accent",
      this.options.theme.bold(truncateToWidth(text, width - 1)),
    );
  }

  private footerLine(width: number): string {
    const parts =
      this.split === true
        ? ["↑/↓ select", "Enter load", "PgUp/PgDn scroll", "Esc close"]
        : this.open
          ? ["Esc back", "PgUp/PgDn scroll"]
          : ["↑/↓ select", "Enter open", "Esc close"];
    return this.options.theme.fg("dim", truncateToWidth(` ${parts.join(" · ")}`, width - 1));
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      if (!this.isSplitOpen() && this.open) {
        this.open = false;
        this.scroll = 0;
        this.invalidate();
      } else {
        this.options.done(undefined);
      }
      return;
    }
    if (matchesKey(data, "up")) return this.moveSelection(-1);
    if (matchesKey(data, "down")) return this.moveSelection(1);
    if (matchesKey(data, "return")) return this.openSelected();
    if (matchesKey(data, "pageUp")) return this.scrollBy(-this.rows);
    if (matchesKey(data, "pageDown")) return this.scrollBy(this.rows);
  }

  private moveSelection(delta: number): void {
    const count = this.options.files.length;
    if (count === 0) return;
    const next = Math.min(count - 1, Math.max(0, this.selected + delta));
    if (next === this.selected) return;
    this.selected = next;
    this.scroll = 0;
    const current = this.current;
    if (this.isSplitOpen() && current !== undefined) this.ensureLoaded(current.path);
    this.invalidate();
  }

  private openSelected(): void {
    const file = this.current;
    if (!file) return;
    if (!this.isSplitOpen()) this.open = true;
    this.scroll = 0;
    this.ensureLoaded(file.path);
    this.invalidate();
  }

  private scrollBy(delta: number): void {
    this.scroll = Math.max(0, this.scroll + delta);
    this.invalidate();
  }
}
