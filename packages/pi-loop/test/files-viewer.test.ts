import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import {
  FILE_VIEWER_MAX_BYTES,
  FILE_VIEWER_SPLIT_MIN_WIDTH,
  FilesViewerComponent,
  listViewerFiles,
  readViewerFile,
  ViewerFileError,
  type ViewerFile,
  type ViewerTheme,
} from "../src";

const theme: ViewerTheme = {
  fg: (_token, text) => text,
  bg: (_token, text) => text,
  bold: (text) => text,
  italic: (text) => text,
  underline: (text) => text,
  strikethrough: (text) => text,
};

const ROWS = 8;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("listViewerFiles walks the working directory, skips ignored dirs, and sorts", async () => {
  const root = await mkdtemp(join(tmpdir(), "loop-files-viewer-"));
  try {
    await mkdir(join(root, "docs/findings"), { recursive: true });
    await mkdir(join(root, "docs/diagnosis"), { recursive: true });
    await mkdir(join(root, "node_modules/pkg"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, "README.md"), "# readme");
    await writeFile(join(root, "docs/findings/run-1.md"), "finding");
    await writeFile(join(root, "docs/diagnosis/diag-1.md"), "diagnosis");
    await writeFile(join(root, "node_modules/pkg/index.js"), "js");
    await writeFile(join(root, ".git/config"), "git");

    const files = await listViewerFiles(root);
    const paths = files.map((file) => file.path);
    expect(paths).toEqual(["README.md", "docs/diagnosis/diag-1.md", "docs/findings/run-1.md"]);
    expect(files[0]!.size).toBe(8);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readViewerFile confines reads to the working directory and enforces the byte cap", async () => {
  const root = await mkdtemp(join(tmpdir(), "loop-files-viewer-"));
  try {
    await writeFile(join(root, "a.md"), "hello");
    await writeFile(join(root, "big.md"), "x".repeat(FILE_VIEWER_MAX_BYTES + 1));
    await writeFile(join(root, "escape.txt"), "outside");

    expect(await readViewerFile(root, "a.md")).toBe("hello");

    expect(readViewerFile(root, "../escape.txt")).rejects.toThrow(ViewerFileError);
    expect(readViewerFile(root, "/etc/hosts")).rejects.toThrow(ViewerFileError);
    expect(readViewerFile(root, "")).rejects.toThrow(ViewerFileError);
    expect(readViewerFile(root, "missing.md")).rejects.toThrow(ViewerFileError);
    await expect(readViewerFile(root, "big.md")).rejects.toThrow("viewer cap");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("split layout appears only at or above the width threshold and previews the selection", async () => {
  const files: ViewerFile[] = [
    { path: "docs/findings/a.md", size: 10 },
    { path: "README.md", size: 5 },
  ];
  const bodies = new Map([
    ["docs/findings/a.md", "Hello world"],
    ["README.md", "readme"],
  ]);
  const readCalls: string[] = [];
  let closed = false;
  const component = new FilesViewerComponent({
    rootDir: "/repo",
    theme,
    files,
    read: async (path) => {
      readCalls.push(path);
      return bodies.get(path)!;
    },
    viewportRows: () => ROWS,
    done: () => {
      closed = true;
    },
  });

  // Below the threshold: list only, no viewer content, no lazy load.
  const narrow = component.render(FILE_VIEWER_SPLIT_MIN_WIDTH - 1).join("\n");
  expect(narrow).toContain("docs/findings/a.md");
  expect(narrow).not.toContain("Hello world");
  expect(readCalls).toEqual([]);

  // At the threshold: split panes, lazy load of the selected file, content shown.
  component.render(FILE_VIEWER_SPLIT_MIN_WIDTH); // triggers the lazy load
  await flush();
  const split = component.render(FILE_VIEWER_SPLIT_MIN_WIDTH).join("\n");
  expect(split).toContain("docs/findings/a.md");
  expect(split).toContain("Hello world");
  expect(readCalls).toEqual(["docs/findings/a.md"]);
  expect(closed).toBe(false);
});

test("narrow layout toggles list to view on Enter and back on Escape before closing", async () => {
  const files: ViewerFile[] = [{ path: "README.md", size: 5 }];
  const bodies = new Map([["README.md", "readme body"]]);
  const readCalls: string[] = [];
  let closed = false;
  const component = new FilesViewerComponent({
    rootDir: "/repo",
    theme,
    files,
    read: async (path) => {
      readCalls.push(path);
      return bodies.get(path)!;
    },
    viewportRows: () => ROWS,
    done: () => {
      closed = true;
    },
  });
  const width = FILE_VIEWER_SPLIT_MIN_WIDTH - 1;

  expect(component.render(width).join("\n")).toContain("README.md");

  // Enter opens the file (lazy load) and shows the viewer pane.
  component.handleInput("\r");
  await flush();
  const open = component.render(width).join("\n");
  expect(open).toContain("readme body");
  expect(readCalls).toEqual(["README.md"]);

  // First Escape returns to the list; second closes the overlay.
  component.handleInput("\x1b");
  const backToList = component.render(width).join("\n");
  expect(backToList).toContain("README.md");
  expect(backToList).not.toContain("readme body");

  component.handleInput("\x1b");
  expect(closed).toBe(true);
});

test("up/down move the selection and Enter loads the newly selected file lazily", async () => {
  const files: ViewerFile[] = [
    { path: "a.md", size: 1 },
    { path: "b.md", size: 1 },
    { path: "c.md", size: 1 },
  ];
  const bodies = new Map([
    ["a.md", "alpha"],
    ["b.md", "bravo"],
    ["c.md", "charlie"],
  ]);
  const readCalls: string[] = [];
  const component = new FilesViewerComponent({
    rootDir: "/repo",
    theme,
    files,
    read: async (path) => {
      readCalls.push(path);
      return bodies.get(path)!;
    },
    viewportRows: () => ROWS,
    done: () => {},
  });

  component.render(FILE_VIEWER_SPLIT_MIN_WIDTH);
  await flush();
  expect(readCalls).toEqual(["a.md"]);
  expect(component.render(FILE_VIEWER_SPLIT_MIN_WIDTH).join("\n")).toContain("alpha");

  component.handleInput("\x1b[B"); // down
  component.handleInput("\x1b[B"); // down
  await flush();
  const lines = component.render(FILE_VIEWER_SPLIT_MIN_WIDTH);
  const selectedLine = lines.slice(1).find((line) => line.includes("c.md"));
  expect(selectedLine).toContain("› c.md");
  // Split mode lazily loads each selection exactly once.
  expect(readCalls).toEqual(["a.md", "b.md", "c.md"]);
  expect(component.render(FILE_VIEWER_SPLIT_MIN_WIDTH).join("\n")).toContain("charlie");

  component.handleInput("\x1b[A"); // up
  await flush();
  expect(component.render(FILE_VIEWER_SPLIT_MIN_WIDTH).join("\n")).toContain("bravo");
  expect(readCalls).toEqual(["a.md", "b.md", "c.md"]);
});

test("pageDown/pageUp page through long content in the viewer pane", async () => {
  const longBody = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n\n");
  const files: ViewerFile[] = [{ path: "long.md", size: longBody.length }];
  const component = new FilesViewerComponent({
    rootDir: "/repo",
    theme,
    files,
    read: async () => longBody,
    viewportRows: () => ROWS,
    done: () => {},
  });

  component.render(FILE_VIEWER_SPLIT_MIN_WIDTH);
  await flush();
  const initial = component.render(FILE_VIEWER_SPLIT_MIN_WIDTH).join("\n");
  expect(initial).toContain("l0");

  component.handleInput("\x1b[6~"); // pageDown
  const paged = component.render(FILE_VIEWER_SPLIT_MIN_WIDTH).join("\n");
  expect(paged).not.toContain("l0\n");
  expect(paged).toContain("l4");

  component.handleInput("\x1b[5~"); // pageUp
  expect(component.render(FILE_VIEWER_SPLIT_MIN_WIDTH).join("\n")).toContain("l0");
});

test("load errors surface in the viewer pane instead of throwing", async () => {
  const files: ViewerFile[] = [{ path: "big.md", size: FILE_VIEWER_MAX_BYTES + 1 }];
  const component = new FilesViewerComponent({
    rootDir: "/repo",
    theme,
    files,
    read: async () => {
      throw new ViewerFileError("File exceeds the 512 KB viewer cap");
    },
    viewportRows: () => ROWS,
    done: () => {},
  });

  component.handleInput("\r"); // open in narrow layout
  await flush();
  expect(component.render(FILE_VIEWER_SPLIT_MIN_WIDTH - 1).join("\n")).toContain(
    "File exceeds the 512 KB viewer cap",
  );
});
