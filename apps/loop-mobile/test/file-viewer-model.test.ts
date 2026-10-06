/**
 * File-viewer model tests (split-viewer design §B, pure half): navigation,
 * lazy content loading with ETag revalidation, and problem-code error
 * mapping — all against a scripted fake FileApi. No network, no RN.
 */

import { describe, expect, test } from "bun:test";

import {
  FileViewerModel,
  isMarkdownPath,
  joinPath,
  parentPath,
  viewerErrorKind,
  type FileApi,
} from "../src/features/file-viewer-model";
import { GatewayError } from "../src/gateway-client/problem";

/** Scripted fake: counts calls, serves a fixed tree, records ETag sends. */
function fakeApi(
  overrides: Partial<FileApi> = {},
): FileApi & { listCalls: string[]; contentCalls: [string, string | undefined][] } {
  const state = {
    listCalls: [] as string[],
    contentCalls: [] as [string, string | undefined][],
  };
  const base: FileApi = {
    async list(dir) {
      state.listCalls.push(dir);
      if (dir === "") return { entries: [{ name: "docs", size: 0, isDir: true, mtimeMs: 0 }] };
      if (dir === "docs") {
        return {
          entries: [
            { name: "findings.md", size: 21, isDir: false, mtimeMs: 0 },
            { name: "notes", size: 0, isDir: true, mtimeMs: 0 },
          ],
        };
      }
      throw new GatewayError({
        type: "about:blank",
        title: "",
        status: 404,
        code: "not_found",
        detail: "",
        requestId: "",
        retryable: false,
        fields: null,
      });
    },
    async content(path, etag) {
      state.contentCalls.push([path, etag]);
      const text = path === "docs/findings.md" ? "# Findings\n- one\n" : "plain\n";
      return { kind: "ok", text, etag: `"etag-${path}"` };
    },
  };
  return { ...base, ...overrides, ...state };
}

describe("path helpers", () => {
  test("joinPath never fabricates ./ or leading slashes", () => {
    expect(joinPath("", "docs")).toBe("docs");
    expect(joinPath("docs", "findings.md")).toBe("docs/findings.md");
  });

  test("parentPath bottoms out at the root (empty string)", () => {
    expect(parentPath("docs/findings.md")).toBe("docs");
    expect(parentPath("docs")).toBe("");
  });

  test("markdown detection by extension only", () => {
    expect(isMarkdownPath("docs/findings.md")).toBe(true);
    expect(isMarkdownPath("docs/Findings.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("docs/checks/receipt.json")).toBe(false);
  });
});

describe("navigation", () => {
  test("targets → dir → file → up → up → targets", async () => {
    const api = fakeApi();
    const model = new FileViewerModel(api);

    await model.openTarget("docs");
    expect(model.place.kind).toBe("dir");
    // the parent listing (root) distinguishes dir vs file, then the dir itself
    expect(api.listCalls).toEqual(["", "docs"]);

    await model.openDir("docs");
    expect(model.place).toMatchObject({ kind: "dir", dir: "docs" });

    await model.openFile("docs/findings.md");
    expect(model.place).toMatchObject({ kind: "file", path: "docs/findings.md", isMarkdown: true });

    await model.up();
    expect(model.place).toMatchObject({ kind: "dir", dir: "docs" });

    await model.up();
    expect(model.place).toEqual({ kind: "targets" });
    expect(model.error).toBeNull();
  });

  test("openTarget reads a seeded file directly and up lands in its directory", async () => {
    const api = fakeApi();
    const model = new FileViewerModel(api);
    await model.openTarget("docs/findings.md");
    expect(model.place).toMatchObject({ kind: "file", path: "docs/findings.md" });
    await model.up();
    expect(model.place).toMatchObject({ kind: "dir", dir: "docs" });
  });

  test("home resets to targets and clears the error", async () => {
    const model = new FileViewerModel(fakeApi());
    await model.openDir("missing");
    expect(model.error).not.toBeNull();
    model.home();
    expect(model.place).toEqual({ kind: "targets" });
    expect(model.error).toBeNull();
  });
});

describe("lazy load + ETag revalidation (§A/§B)", () => {
  test("content is fetched only on open — never on navigation", async () => {
    const api = fakeApi();
    const model = new FileViewerModel(api);
    await model.openTarget("docs");
    await model.openDir("docs");
    expect(api.contentCalls).toHaveLength(0);
    await model.openFile("docs/findings.md");
    expect(api.contentCalls).toEqual([["docs/findings.md", undefined]]);
  });

  test("re-opening sends the cached ETag and a 304 keeps the cached text", async () => {
    const calls: [string, string | undefined][] = [];
    const api: FileApi = {
      async list() {
        return { entries: [] };
      },
      async content(path, etag) {
        calls.push([path, etag]);
        if (etag !== undefined) return { kind: "notModified", etag }; // server says: unchanged
        return { kind: "ok", text: "v1", etag: '"e1"' };
      },
    };
    const model = new FileViewerModel(api);
    await model.openFile("docs/findings.md");
    expect(model.place).toMatchObject({ text: "v1" });
    await model.openFile("docs/findings.md");
    // The second open revalidated with the stored ETag; the 304 kept the
    // already-rendered text (no replacement body exists to show).
    expect(calls).toEqual([
      ["docs/findings.md", undefined],
      ["docs/findings.md", '"e1"'],
    ]);
    expect(model.place).toMatchObject({ text: "v1" });
  });

  test("a changed ETag replaces the cached content", async () => {
    let generation = 0;
    const api: FileApi = {
      async list() {
        return { entries: [] };
      },
      async content(_path) {
        generation += 1;
        return { kind: "ok", text: `gen ${generation}`, etag: `"gen-${generation}"` };
      },
    };
    const model = new FileViewerModel(api);
    await model.openFile("docs/findings.md");
    await model.openFile("docs/findings.md");
    expect(model.place).toMatchObject({ text: "gen 2" });
  });
});

/** Gateway problem fixture with the given status + code (mapping input). */
const problem = (status: number, code: string) =>
  new GatewayError({
    type: "about:blank",
    title: "",
    status,
    code,
    detail: "",
    requestId: "",
    retryable: false,
    fields: null,
  });

describe("error mapping (problem code + status only)", () => {
  test("gateway problems map to viewer copy codes", async () => {
    const api: FileApi = {
      list: () => Promise.reject(problem(404, "not_found")),
      content: () => Promise.reject(problem(413, "file_too_large")),
    };
    const model = new FileViewerModel(api);
    await model.openDir("nope");
    expect(model.error).toBe("not_found");
    expect(model.place.kind).toBe("targets"); // failed navigation keeps the old place
    await model.openFile("docs/big.bin");
    expect(model.error).toBe("file_too_large");
  });

  test("non-gateway failures degrade to unavailable", async () => {
    const api: FileApi = {
      list: () => Promise.reject(new Error("offline")),
      content: () => Promise.reject(new Error("offline")),
    };
    const model = new FileViewerModel(api);
    await model.openDir("docs");
    expect(model.error).toBe("unavailable");
  });

  test("viewerErrorKind branches on status first, then code", () => {
    expect(viewerErrorKind(401, "unauthorized")).toBe("unauthorized");
    expect(viewerErrorKind(404, "not_found")).toBe("not_found");
    expect(viewerErrorKind(415, "file_not_text")).toBe("file_not_text");
    expect(viewerErrorKind(400, "file_path_rejected")).toBe("file_path_rejected");
    expect(viewerErrorKind(500, "internal")).toBe("unavailable");
  });
});
