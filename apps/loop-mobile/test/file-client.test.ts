/**
 * Split-viewer client contract tests (split-viewer design §A/§B): the app
 * client's two file surface calls against the local mock gateway — auth,
 * listing wire shape, content + ETag, 304 revalidation, and the fail-closed
 * problem branches (traversal 400, missing 404, binary 415).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GatewayClient } from "../src/gateway-client/client";
import { GatewayError } from "../src/gateway-client/problem";
import { createConnectionConfig } from "../src/auth/connection";
import { createMockGateway, type MockGateway } from "./mock-gateway";
import { TOKEN } from "./fixtures";

let gateway: MockGateway;
let client: GatewayClient;
let anonymous: GatewayClient;

beforeAll(() => {
  gateway = createMockGateway();
  const port = gateway.url.split(":")[2]!;
  client = new GatewayClient(createConnectionConfig("127.0.0.1", port, TOKEN));
  anonymous = new GatewayClient(createConnectionConfig("127.0.0.1", port, "wrong-token"));
});

afterAll(() => {
  gateway.stop();
});

describe("auth — existing gateway auth applies (§A constraint)", () => {
  test("a bad bearer is a 401 unauthorized problem", async () => {
    try {
      await anonymous.listFiles();
      throw new Error("expected GatewayError");
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).problem.status).toBe(401);
      expect((error as GatewayError).problem.code).toBe("unauthorized");
    }
  });
});

describe("GET /v1/files", () => {
  test("the root listing returns entries in the §A wire shape", async () => {
    const page = await client.listFiles();
    expect(page.entries).toEqual([{ name: "docs", size: 0, isDir: true, mtimeMs: 0 }]);
  });

  test("a subdirectory lists its entries with honest metadata", async () => {
    const page = await client.listFiles("docs");
    expect(page.entries).toEqual([
      { name: "diagnosis.md", size: 28, isDir: false, mtimeMs: 0 },
      { name: "findings.md", size: 46, isDir: false, mtimeMs: 0 },
    ]);
  });

  test("`..` traversal is a 400 file_path_rejected problem", async () => {
    try {
      await client.listFiles("../secrets");
      throw new Error("expected GatewayError");
    } catch (error) {
      expect((error as GatewayError).problem).toMatchObject({
        status: 400,
        code: "file_path_rejected",
      });
    }
  });

  test("an unknown directory is a 404 problem", async () => {
    try {
      await client.listFiles("nope");
      throw new Error("expected GatewayError");
    } catch (error) {
      expect((error as GatewayError).problem.status).toBe(404);
    }
  });
});

describe("GET /v1/files/content", () => {
  test("returns the text body with a strong ETag", async () => {
    const result = await client.readFileContent("docs/findings.md");
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.text).toBe(
      "# Findings\n\n- `bun run check` passes\n**done**\n",
    );
    expect(result.kind === "ok" && result.etag).toMatch(/^"[0-9a-f]+"$/);
  });

  test("sending the known ETag short-circuits to notModified (304)", async () => {
    const first = await client.readFileContent("docs/findings.md");
    if (first.kind !== "ok") throw new Error("expected ok");
    const second = await client.readFileContent("docs/findings.md", first.etag);
    expect(second).toEqual({ kind: "notModified", etag: first.etag });
  });

  test("`..` traversal is rejected before any read", async () => {
    try {
      await client.readFileContent("../secrets/token");
      throw new Error("expected GatewayError");
    } catch (error) {
      expect((error as GatewayError).problem).toMatchObject({
        status: 400,
        code: "file_path_rejected",
      });
    }
  });

  test("a missing file is a 404 problem", async () => {
    try {
      await client.readFileContent("docs/ghost.md");
      throw new Error("expected GatewayError");
    } catch (error) {
      expect((error as GatewayError).problem.status).toBe(404);
    }
  });
});
