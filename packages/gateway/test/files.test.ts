/**
 * Read-only file surface (split-viewer design §A): GET /v1/files list and
 * GET /v1/files/content, confined to the working directory. Deterministic:
 * a booted test gateway over a temp fixture tree; no pi process, no model
 * calls. Covers the required guard rails — traversal rejection, absolute
 * path rejection, size cap, auth rejection — plus normal list/content and
 * ETag revalidation.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { MAX_FILE_VIEW_BYTES } from "../src/files";
import { authHeader, bootTestGateway, type TestGateway } from "./helpers";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

let root: string;

function harness(): TestGateway {
  return bootTestGateway({ files: { root } });
}

function get(
  gateway: TestGateway,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${gateway.baseUrl}${path}`, { headers });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "loop-gateway-files-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "notes.txt"), "hello loop\n");
  writeFileSync(join(root, "docs", "findings.md"), "# findings\n");
  writeFileSync(join(root, "secret.txt"), "outside\n");
  writeFileSync(join(root, "binary.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  writeFileSync(join(root, "big.txt"), "x".repeat(MAX_FILE_VIEW_BYTES + 1));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("GET /v1/files (list)", () => {
  test("lists the root: name, size, isDir, mtime; directories first", async () => {
    const gateway = harness();
    try {
      const res = await get(gateway, "/v1/files", authHeader(gateway.token()));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        entries: { name: string; size: number; isDir: boolean; mtimeMs: number }[];
      };
      expect(body.entries.map((entry) => entry.name)).toEqual([
        "docs",
        "big.txt",
        "binary.bin",
        "notes.txt",
        "secret.txt",
      ]);
      const docs = must(body.entries.find((entry) => entry.name === "docs"));
      expect(docs.isDir).toBe(true);
      expect(docs.mtimeMs).toBeGreaterThan(0);
      const notes = must(body.entries.find((entry) => entry.name === "notes.txt"));
      expect(notes.isDir).toBe(false);
      expect(notes.size).toBe("hello loop\n".length);
    } finally {
      gateway.stop();
    }
  });

  test("lists a subdirectory via ?dir=", async () => {
    const gateway = harness();
    try {
      const res = await get(
        gateway,
        `/v1/files?dir=${encodeURIComponent("docs")}`,
        authHeader(gateway.token()),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: { name: string }[] };
      expect(body.entries.map((entry) => entry.name)).toEqual(["findings.md"]);
    } finally {
      gateway.stop();
    }
  });

  test("rejects .. traversal with 400 file_path_rejected", async () => {
    const gateway = harness();
    try {
      for (const dir of ["..", "docs/../..", "docs/../../elsewhere"]) {
        const res = await get(
          gateway,
          `/v1/files?dir=${encodeURIComponent(dir)}`,
          authHeader(gateway.token()),
        );
        expect(res.status).toBe(400);
        expect(((await res.json()) as { code: string }).code).toBe("file_path_rejected");
      }
    } finally {
      gateway.stop();
    }
  });

  test("rejects absolute paths with 400 file_path_rejected", async () => {
    const gateway = harness();
    try {
      for (const dir of ["/etc", "/etc/passwd", "C:\\Windows"]) {
        const res = await get(
          gateway,
          `/v1/files?dir=${encodeURIComponent(dir)}`,
          authHeader(gateway.token()),
        );
        expect(res.status).toBe(400);
        expect(((await res.json()) as { code: string }).code).toBe("file_path_rejected");
      }
    } finally {
      gateway.stop();
    }
  });
});

describe("GET /v1/files/content", () => {
  test("serves text content with a strong ETag", async () => {
    const gateway = harness();
    try {
      const res = await get(
        gateway,
        `/v1/files/content?path=${encodeURIComponent("docs/findings.md")}`,
        authHeader(gateway.token()),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
      const etag = res.headers.get("ETag");
      expect(etag).toMatch(/^"[0-9a-f]+"$/);
      expect(await res.text()).toBe("# findings\n");
    } finally {
      gateway.stop();
    }
  });

  test("If-None-Match on the current ETag short-circuits to 304", async () => {
    const gateway = harness();
    try {
      const first = await get(
        gateway,
        `/v1/files/content?path=${encodeURIComponent("notes.txt")}`,
        authHeader(gateway.token()),
      );
      const etag = must(first.headers.get("ETag"));
      const second = await get(
        gateway,
        `/v1/files/content?path=${encodeURIComponent("notes.txt")}`,
        { ...authHeader(gateway.token()), "If-None-Match": etag },
      );
      expect(second.status).toBe(304);
      expect(second.headers.get("ETag")).toBe(etag);
    } finally {
      gateway.stop();
    }
  });

  test("rejects .. traversal and absolute paths with 400", async () => {
    const gateway = harness();
    try {
      for (const path of ["../secret.txt", "docs/../../secret.txt", "/etc/passwd"]) {
        const res = await get(
          gateway,
          `/v1/files/content?path=${encodeURIComponent(path)}`,
          authHeader(gateway.token()),
        );
        expect(res.status).toBe(400);
        expect(((await res.json()) as { code: string }).code).toBe("file_path_rejected");
      }
      // The sibling secret never leaked through any of the attempts.
    } finally {
      gateway.stop();
    }
  });

  test("enforces the 512KB cap with 413 before reading", async () => {
    const gateway = harness();
    try {
      const res = await get(
        gateway,
        `/v1/files/content?path=${encodeURIComponent("big.txt")}`,
        authHeader(gateway.token()),
      );
      expect(res.status).toBe(413);
      expect(((await res.json()) as { code: string }).code).toBe("file_too_large");
    } finally {
      gateway.stop();
    }
  });

  test("rejects binary content with 415 file_not_text", async () => {
    const gateway = harness();
    try {
      const res = await get(
        gateway,
        `/v1/files/content?path=${encodeURIComponent("binary.bin")}`,
        authHeader(gateway.token()),
      );
      expect(res.status).toBe(415);
      expect(((await res.json()) as { code: string }).code).toBe("file_not_text");
    } finally {
      gateway.stop();
    }
  });

  test("unknown path is an honest 404", async () => {
    const gateway = harness();
    try {
      const res = await get(
        gateway,
        `/v1/files/content?path=${encodeURIComponent("nope.txt")}`,
        authHeader(gateway.token()),
      );
      expect(res.status).toBe(404);
      expect(((await res.json()) as { code: string }).code).toBe("file_not_found");
    } finally {
      gateway.stop();
    }
  });
});

describe("file route framing", () => {
  test("requires bearer auth like every other gateway route", async () => {
    const gateway = harness();
    try {
      const res = await get(gateway, "/v1/files");
      expect(res.status).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe("unauthorized");
    } finally {
      gateway.stop();
    }
  });

  test("absent dep → 404 (fail-closed, like every optional surface)", async () => {
    const gateway = bootTestGateway({});
    try {
      const res = await get(gateway, "/v1/files", authHeader(gateway.token()));
      expect(res.status).toBe(404);
      expect(((await res.json()) as { code: string }).code).toBe("not_found");
    } finally {
      gateway.stop();
    }
  });

  test("non-GET is 405", async () => {
    const gateway = harness();
    try {
      const res = await fetch(`${gateway.baseUrl}/v1/files`, {
        method: "POST",
        headers: authHeader(gateway.token()),
        body: "{}",
      });
      expect(res.status).toBe(405);
    } finally {
      gateway.stop();
    }
  });
});
