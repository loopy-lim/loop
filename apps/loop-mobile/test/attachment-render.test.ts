/**
 * M2 attachment pipeline (decision 2026-xx-gui-conversation D5) — app-side
 * contract tests: the gateway client fetches attachment bodies out-of-band,
 * the AttachmentCache resolves refs into honest render state (inline image
 * data URI / file card / unavailable), and nothing here needs a model call —
 * the local-image path is a real 1×1 PNG fixture served by the loopback mock
 * gateway.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GatewayClient } from "../src/gateway-client/client";
import { GatewayError } from "../src/gateway-client/problem";
import { createConnectionConfig } from "../src/auth/connection";
import {
  AttachmentCache,
  formatByteLen,
  isImageMime,
  toDataUri,
  type SessionAttachmentRef,
} from "../src/state/attachmentCache";
import { createMockGateway, type MockGateway } from "./mock-gateway";
import { TOKEN } from "./fixtures";
import {
  ATTACHMENT_ID,
  ATTACHMENT_MISSING_ID,
  ATTACHMENT_PNG_BASE64,
  ATTACHMENT_PNG_BYTES,
  SESSION_ID,
} from "./conversation-fixtures";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

let gateway: MockGateway;
let client: GatewayClient;

beforeAll(() => {
  gateway = createMockGateway();
  client = new GatewayClient(
    createConnectionConfig("127.0.0.1", must(gateway.url.split(":")[2]), TOKEN),
  );
});

afterAll(() => {
  gateway.stop();
});

function imageRef(attachmentId: string = ATTACHMENT_ID): SessionAttachmentRef {
  return { attachmentId, mimeType: "image/png", byteLen: ATTACHMENT_PNG_BYTES };
}

/** Await a cache notification (the screen's re-render trigger). */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("GatewayClient.fetchSessionAttachment (D5 body endpoint)", () => {
  test("serves the exact fixture bytes with the stored media type", async () => {
    const body = await client.fetchSessionAttachment(SESSION_ID, ATTACHMENT_ID);
    expect(body.mimeType).toBe("image/png");
    expect(body.bytes.byteLength).toBe(ATTACHMENT_PNG_BYTES);
    expect(Buffer.from(body.bytes).toString("base64")).toBe(ATTACHMENT_PNG_BASE64);
  });

  test("an evicted/never-stored body is an honest attachment_not_found problem", async () => {
    try {
      await client.fetchSessionAttachment(SESSION_ID, ATTACHMENT_MISSING_ID);
      throw new Error("expected GatewayError");
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayError);
      const problem = (error as GatewayError).problem;
      expect(problem.status).toBe(404);
      expect(problem.code).toBe("attachment_not_found");
      expect(error).toBeInstanceOf(GatewayError);
    }
  });
});

describe("attachment render helpers", () => {
  test("toDataUri round-trips the fixture PNG byte-for-byte (local-image path)", () => {
    const bytes = new Uint8Array(Buffer.from(ATTACHMENT_PNG_BASE64, "base64"));
    expect(toDataUri("image/png", bytes)).toBe(`data:image/png;base64,${ATTACHMENT_PNG_BASE64}`);
  });

  test("isImageMime and formatByteLen classify render + metadata", () => {
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("image/jpeg")).toBe(true);
    expect(isImageMime("application/pdf")).toBe(false);
    expect(isImageMime("IMAGE/WEBP")).toBe(true);
    expect(formatByteLen(70)).toBe("70 B");
    expect(formatByteLen(2048)).toBe("2 KB");
    expect(formatByteLen(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("AttachmentCache — honest render states (D5)", () => {
  test("image ref: loading → ready data URI, fetched exactly once (dedupe)", async () => {
    let fetches = 0;
    const cache = new AttachmentCache(async () => {
      fetches += 1;
      return {
        mimeType: "image/png",
        bytes: new Uint8Array(Buffer.from(ATTACHMENT_PNG_BASE64, "base64")),
      };
    });
    let notifications = 0;
    cache.subscribe(() => {
      notifications += 1;
    });

    const ref = imageRef();
    cache.ensure(SESSION_ID, ref);
    expect(cache.view(ref)).toEqual({ status: "loading" });
    await nextTick();

    expect(fetches).toBe(1);
    const view = cache.view(ref);
    expect(view.status).toBe("ready");
    expect(view.status === "ready" && view.dataUri).toBe(
      `data:image/png;base64,${ATTACHMENT_PNG_BASE64}`,
    );
    expect(notifications).toBeGreaterThanOrEqual(2); // loading + ready

    // Replay duplicates / re-renders never re-fetch (one body per ref).
    cache.ensure(SESSION_ID, ref);
    cache.ensure(SESSION_ID, ref);
    expect(fetches).toBe(1);
    expect(cache.size).toBe(1);
  });

  test("404 body: loading → unavailable with the problem reason, never retried", async () => {
    let fetches = 0;
    const cache = new AttachmentCache(async (sessionId, attachmentId) => {
      fetches += 1;
      // The mock gateway's honest 404 for a ref without a stored body.
      return client.fetchSessionAttachment(sessionId, attachmentId);
    });
    const ref = imageRef(ATTACHMENT_MISSING_ID);
    cache.ensure(SESSION_ID, ref);
    await nextTick();
    await nextTick();

    expect(fetches).toBe(1);
    const view = cache.view(ref);
    expect(view.status).toBe("unavailable");
    expect(view.status === "unavailable" && view.reason).toContain("attachment_not_found");

    cache.ensure(SESSION_ID, ref); // failures settle; no retry storm
    expect(fetches).toBe(1);
  });

  test("non-image refs never fetch — file cards render from metadata alone", async () => {
    let fetches = 0;
    const cache = new AttachmentCache(async () => {
      fetches += 1;
      throw new Error("must not fetch non-image refs");
    });
    const ref: SessionAttachmentRef = {
      attachmentId: "att_pdf",
      mimeType: "application/pdf",
      byteLen: 910_000,
    };
    cache.ensure(SESSION_ID, ref);
    await nextTick();

    expect(fetches).toBe(0);
    expect(cache.view(ref)).toEqual({ status: "idle" });
  });
});
