/**
 * M2 attachment UPLOAD + live-session INPUT contract tests (decision
 * 2026-xx-gui-conversation D5, task `composer-attach-and-highlighting`).
 *
 * The client stores the image BEFORE the input that references it: POST
 * attachments returns the reference-shaped RemoteSessionAssetRef, POST
 * input carries refs only. Errors branch on problem `code`+`status`
 * (RFC 9457) — never on title/detail. Loopback mock gateway, local PNG
 * fixture bytes, zero network beyond 127.0.0.1, zero model calls.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { GatewayClient } from "../src/gateway-client/client";
import { GatewayError } from "../src/gateway-client/problem";
import { createConnectionConfig } from "../src/auth/connection";
import {
  ATTACHMENT_ID,
  ATTACHMENT_PNG_BASE64,
  ATTACHMENT_PNG_BYTES,
  ORPHAN_SESSION_ID,
  SESSION_ID,
} from "./conversation-fixtures";
import { createMockGateway, type MockGateway } from "./mock-gateway";
import { TOKEN } from "./fixtures";
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

/** Fresh 1×1 PNG bytes per upload (independent of the body-fetch fixture). */
function pngBytes(): Uint8Array<ArrayBuffer> {
  const source = Buffer.from(ATTACHMENT_PNG_BASE64, "base64");
  const out = new ArrayBuffer(source.byteLength);
  new Uint8Array(out).set(source);
  return new Uint8Array(out);
}

/** The RN-supported upload body shape (see uploadSessionAttachment). */
function pngBlob(): Blob {
  return new Blob([pngBytes()], { type: "image/png" });
}

describe("GatewayClient.uploadSessionAttachment (D5 upload)", () => {
  test("uploads a runtime-produced blob and returns the reference-shaped ref (201)", async () => {
    const bytes = pngBytes();
    const ref = await client.uploadSessionAttachment(SESSION_ID, {
      mimeType: "image/png",
      // The RN-supported shape: a Blob from response.blob(), never a JS
      // re-wrap of typed arrays (RN's Blob constructor rejects them).
      body: new Blob([bytes], { type: "image/png" }),
    });
    expect(ref.attachmentId).toMatch(/^up_mock_/);
    expect(ref.mimeType).toBe("image/png");
    expect(ref.byteLen).toBe(ATTACHMENT_PNG_BYTES);
    // The upload is recorded as a POST to the session-scoped endpoint.
    const recorded = gateway.requests.find(
      (r) => r.path === `/v1/sessions/${SESSION_ID}/attachments`,
    );
    expect(recorded?.method).toBe("POST");
    expect(recorded?.requestId).toMatch(/^req_/);
  });

  test("non-image media type is a deterministic 400 (invalid_media_type)", async () => {
    let caught: unknown = null;
    try {
      await client.uploadSessionAttachment(SESSION_ID, {
        mimeType: "text/plain",
        body: new Blob(["not an image"], { type: "text/plain" }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayError);
    const problem = (caught as GatewayError).problem;
    expect(problem.status).toBe(400);
    expect(problem.code).toBe("invalid_media_type");
  });

  test("unknown session is a deterministic 404 (session_not_found)", async () => {
    let caught: unknown = null;
    try {
      await client.uploadSessionAttachment("sess_does_not_exist", {
        mimeType: "image/png",
        body: new Blob([pngBytes()], { type: "image/png" }),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayError);
    expect((caught as GatewayError).problem.code).toBe("session_not_found");
  });
});

describe("GatewayClient.submitSessionInput (D5 live input)", () => {
  test("accepts text + uploaded ref (202) and the recorded body carries refs only", async () => {
    const ref = await client.uploadSessionAttachment(SESSION_ID, {
      mimeType: "image/png",
      body: pngBlob(),
    });
    const result = await client.submitSessionInput(SESSION_ID, {
      text: "What is in this photo?",
      attachments: [{ attachmentId: ref.attachmentId }],
    });
    expect(result.inputId).toMatch(/^in_mock_/);
    const recorded = gateway.requests.find(
      (r) =>
        r.path === `/v1/sessions/${SESSION_ID}/input` &&
        r.body?.includes(ref.attachmentId) === true,
    );
    expect(recorded).toBeDefined();
    // Refs only on the wire — the recorded input body never carries bytes.
    expect(recorded?.body).not.toContain("iVBORw0KGgo");
  });

  test("accepts empty text when refs are present (image-only send)", async () => {
    const ref = await client.uploadSessionAttachment(SESSION_ID, {
      mimeType: "image/png",
      body: pngBlob(),
    });
    const result = await client.submitSessionInput(SESSION_ID, {
      text: "",
      attachments: [{ attachmentId: ref.attachmentId }],
    });
    expect(result.inputId).toMatch(/^in_mock_/);
  });

  test("the stored fixture ref resolves without a fresh upload", async () => {
    const result = await client.submitSessionInput(SESSION_ID, {
      text: "see attachment",
      attachments: [{ attachmentId: ATTACHMENT_ID }],
    });
    expect(result.inputId).toMatch(/^in_mock_/);
  });

  test("known but not-live session is a deterministic 409 (session_not_live)", async () => {
    let caught: unknown = null;
    try {
      await client.submitSessionInput(ORPHAN_SESSION_ID, {
        text: "anyone there?",
        attachments: [],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayError);
    const problem = (caught as GatewayError).problem;
    expect(problem.status).toBe(409);
    expect(problem.code).toBe("session_not_live");
    expect(problem.retryable).toBe(false);
  });

  test("unknown session 404; unknown ref 404 (attachment_not_found)", async () => {
    try {
      await client.submitSessionInput("sess_missing", { text: "x", attachments: [] });
      throw new Error("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).problem.code).toBe("session_not_found");
    }
    try {
      await client.submitSessionInput(SESSION_ID, {
        text: "x",
        attachments: [{ attachmentId: "att_never_stored" }],
      });
      throw new Error("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayError);
      expect((error as GatewayError).problem.code).toBe("attachment_not_found");
    }
  });

  test("empty text with no refs is a deterministic 400 (invalid_request)", async () => {
    let caught: unknown = null;
    try {
      await client.submitSessionInput(SESSION_ID, { text: "   ", attachments: [] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayError);
    expect((caught as GatewayError).problem.code).toBe("invalid_request");
  });
});
