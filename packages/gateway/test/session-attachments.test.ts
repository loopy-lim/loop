/**
 * M2 attachment pipeline (decision 2026-xx-gui-conversation D5): tap body
 * lines store bounded bytes outside the frame buffer, `user_message` frames
 * carry reference-shaped `RemoteSessionAssetRef` metadata only, and the
 * gateway serves bodies at GET /v1/sessions/{sessionId}/attachments/{id}
 * with honest 404s for evicted/never-stored bodies. Deterministic: fake tap
 * lines over the pure collector core + a booted test gateway; no pi process,
 * no model calls.
 */

import { describe, expect, test } from "bun:test";

import type { UserMessagePayload } from "../src/session-collector";
import { MAX_PROMPT_BYTES } from "../src/wire";
import {
  authHeader,
  bootTestGateway,
  tap,
  tapConnect,
  tapDisconnect,
  type TestGateway,
} from "./helpers";
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected value to be defined");
  return value;
}

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** The actual PNG bytes the composer would upload (raw body, not base64). */
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

function harness(assets?: {
  maxBodyBytes?: number;
  maxPerSession?: number;
  maxTotalBytesPerSession?: number;
}) {
  const gateway = bootTestGateway({ session: { assets } });
  if (gateway.sessions === null) throw new Error("session surface missing");
  return gateway;
}

function register(gateway: TestGateway, sessionId = "s-1"): string {
  return tapConnect(gateway, { sessionId, lane: "pi" });
}

function userMessageFrame(gateway: TestGateway, sessionId = "s-1"): UserMessagePayload | null {
  const frames = gateway.sessions?.bufferedFrames(sessionId);
  const frame = frames.find((candidate) => candidate.event === "user_message");
  return frame === undefined ? null : (frame.data as UserMessagePayload);
}

/** Base64 fixture body of the given byte length. */
function payload(length: number): string {
  return Buffer.alloc(length).toString("base64");
}

describe("attachment body ingress (D5)", () => {
  test("body lines store bytes outside the frame buffer; refs resolve with the decoded length", () => {
    const gateway = harness();
    const conn = register(gateway);

    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "att-1",
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });
    tap(gateway, conn, {
      type: "user_message",
      messageId: "m-1",
      text: "look at this",
      source: "interactive",
      imageCount: 1,
      attachments: [{ attachmentId: "att-1", mimeType: "image/png", byteLen: 999 }],
    });

    // Ref metadata: the STORED decoded length wins over the tap's declaration.
    const frame = userMessageFrame(gateway);
    expect(frame).not.toBeNull();
    expect(frame?.attachments).toEqual([
      {
        attachmentId: "att-1",
        mimeType: "image/png",
        byteLen: Buffer.from(PNG_BASE64, "base64").byteLength,
      },
    ]);
    // Honesty: the frame buffer never carries the body (replay budget, D5).
    expect(JSON.stringify(userMessageFrame(gateway))).not.toContain("PNG");

    const stored = gateway.sessions?.getAttachment("s-1", "att-1");
    expect(stored).not.toBeNull();
    expect(stored?.mimeType).toBe("image/png");
    expect(Buffer.from(stored?.bytes).toString("base64")).toBe(PNG_BASE64);
  });

  test("bodies survive session end; frames replay references, not bodies", () => {
    const gateway = harness();
    const conn = register(gateway);
    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "att-1",
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });
    tap(gateway, conn, {
      type: "user_message",
      messageId: "m-1",
      text: "hi",
      attachments: [{ attachmentId: "att-1", mimeType: "image/png" }],
    });
    tap(gateway, conn, { type: "session_shutdown" });

    expect(gateway.sessions?.getAttachment("s-1", "att-1")).not.toBeNull();
    expect(userMessageFrame(gateway)?.attachments).toHaveLength(1);
  });

  test("malformed bodies and refs are dropped (fail-observer)", () => {
    const gateway = harness();
    const conn = register(gateway);

    // Junk media type, junk id, junk base64 — none may crash or store.
    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "att-1",
      mimeType: "not a mime",
      dataBase64: PNG_BASE64,
    });
    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "",
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });
    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "att-1",
      mimeType: "image/png",
      dataBase64: "!!!not-base64!!!",
    });
    tap(gateway, conn, {
      type: "user_message",
      messageId: "m-1",
      text: "hi",
      attachments: [
        { attachmentId: "att-1", mimeType: "junk" }, // invalid mime: ref dropped
        { attachmentId: "x".repeat(129), mimeType: "image/png" }, // over-bound id: dropped
        { attachmentId: "att-9", mimeType: "image/png", byteLen: -5 }, // junk byteLen: falls back to 0
        "junk", // non-object: dropped
      ],
    });

    expect(gateway.sessions?.getAttachment("s-1", "att-1")).toBeNull();
    const refs = userMessageFrame(gateway)?.attachments;
    expect(refs).toEqual([{ attachmentId: "att-9", mimeType: "image/png", byteLen: 0 }]);
  });

  test("per-message ref cap keeps the first valid refs; extras are dropped honestly", () => {
    const gateway = harness();
    const conn = register(gateway);
    const nine = Array.from({ length: 9 }, (_, index) => ({
      attachmentId: `att-${index + 1}`,
      mimeType: "image/png",
    }));
    tap(gateway, conn, {
      type: "user_message",
      messageId: "m-1",
      text: "hi",
      imageCount: 9,
      attachments: nine,
    });

    const refs = userMessageFrame(gateway)?.attachments;
    expect(refs).toHaveLength(8); // MAX_ATTACHMENTS_PER_MESSAGE
    expect(refs.map((ref) => ref.attachmentId)).toEqual(
      Array.from({ length: 8 }, (_, index) => `att-${index + 1}`),
    );
    expect(userMessageFrame(gateway)?.imageCount).toBe(9); // observed count stays honest
  });

  test("store bounds: oversized bodies and over-budget sessions drop or evict oldest-first", () => {
    const gateway = harness({ maxBodyBytes: 100, maxPerSession: 2, maxTotalBytesPerSession: 150 });
    const conn = register(gateway);

    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "too-big",
      mimeType: "application/octet-stream",
      dataBase64: payload(101),
    });
    expect(gateway.sessions?.getAttachment("s-1", "too-big")).toBeNull(); // > maxBodyBytes

    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "a",
      mimeType: "application/octet-stream",
      dataBase64: payload(60),
    });
    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "b",
      mimeType: "application/octet-stream",
      dataBase64: payload(60),
    });
    expect(gateway.sessions?.getAttachment("s-1", "a")).not.toBeNull();
    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "c",
      mimeType: "application/octet-stream",
      dataBase64: payload(20),
    });
    // Count cap (2): "a" is evicted oldest-first; total would be 140 ≤ 150.
    expect(gateway.sessions?.getAttachment("s-1", "a")).toBeNull();
    expect(gateway.sessions?.getAttachment("s-1", "b")).not.toBeNull();
    expect(gateway.sessions?.getAttachment("s-1", "c")).not.toBeNull();
  });

  test("attachment lines on unregistered or gone sessions are dropped", () => {
    const gateway = harness();
    gateway.sessions?.openConnection("unregistered");
    tap(gateway, "unregistered", {
      type: "attachment",
      attachmentId: "att-1",
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });
    expect(gateway.sessions?.getAttachment("s-1", "att-1")).toBeNull();

    const conn = register(gateway, "s-gone");
    tap(gateway, conn, { type: "session_shutdown" });
    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "att-1",
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });
    expect(gateway.sessions?.getAttachment("s-gone", "att-1")).toBeNull();
  });
});

describe("GET /v1/sessions/{sessionId}/attachments/{attachmentId} (D5)", () => {
  test("serves the exact stored bytes with the stored media type", async () => {
    const gateway = harness();
    const conn = register(gateway);
    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "att-1",
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });
    tap(gateway, conn, {
      type: "user_message",
      messageId: "m-1",
      text: "hi",
      attachments: [{ attachmentId: "att-1", mimeType: "image/png" }],
    });

    const response = await fetch(`${gateway.baseUrl}/v1/sessions/s-1/attachments/att-1`, {
      headers: authHeader(gateway.token()),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes).toString("base64")).toBe(PNG_BASE64);
    expect(bytes.byteLength).toBe(Number(response.headers.get("content-length")));
  });

  test("unknown session vs missing body: two distinct honest 404 codes", async () => {
    const gateway = harness();
    const conn = register(gateway);
    tap(gateway, conn, {
      type: "user_message",
      messageId: "m-1",
      text: "hi",
      attachments: [{ attachmentId: "never-arrived", mimeType: "image/png" }], // ref without body
    });

    const unknownSession = await fetch(`${gateway.baseUrl}/v1/sessions/s-other/attachments/att-1`, {
      headers: authHeader(gateway.token()),
    });
    expect(unknownSession.status).toBe(404);
    expect(((await unknownSession.json()) as { code: string }).code).toBe("session_not_found");

    const missingBody = await fetch(
      `${gateway.baseUrl}/v1/sessions/s-1/attachments/never-arrived`,
      {
        headers: authHeader(gateway.token()),
      },
    );
    expect(missingBody.status).toBe(404);
    expect(((await missingBody.json()) as { code: string }).code).toBe("attachment_not_found");

    const evicted = await fetch(`${gateway.baseUrl}/v1/sessions/s-1/attachments/evicted`, {
      headers: authHeader(gateway.token()),
    });
    expect(((await evicted.json()) as { code: string }).code).toBe("attachment_not_found");
  });

  test("bearer still gates the body endpoint (no credential-free bypass in fallback mode)", async () => {
    const gateway = harness();
    const conn = register(gateway);
    tap(gateway, conn, {
      type: "attachment",
      attachmentId: "att-1",
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });

    const response = await fetch(`${gateway.baseUrl}/v1/sessions/s-1/attachments/att-1`);
    expect(response.status).toBe(401);
  });
});

// ——— POST /v1/sessions/{sessionId}/attachments (app-side upload, D5) ———

async function upload(
  gateway: TestGateway,
  sessionId: string,
  body: BodyInit,
  contentType = "image/png",
): Promise<Response> {
  return fetch(`${gateway.baseUrl}/v1/sessions/${sessionId}/attachments`, {
    method: "POST",
    headers: { ...authHeader(gateway.token()), "Content-Type": contentType },
    body,
  });
}

describe("POST /v1/sessions/{sessionId}/attachments (app upload, D5)", () => {
  test("upload stores the body locally and answers the reference shape; GET serves it", async () => {
    const gateway = harness();
    register(gateway);

    const response = await upload(gateway, "s-1", PNG_BYTES);
    expect(response.status).toBe(201);
    const ref = (await response.json()) as {
      attachmentId: string;
      mimeType: string;
      byteLen: number;
    };
    expect(ref.mimeType).toBe("image/png");
    expect(ref.byteLen).toBe(PNG_BYTES.byteLength);
    expect(ref.attachmentId).toMatch(/^att_/);

    // The stored body serves byte-exact through the GET surface.
    const served = await fetch(
      `${gateway.baseUrl}/v1/sessions/s-1/attachments/${ref.attachmentId}`,
      {
        headers: authHeader(gateway.token()),
      },
    );
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG_BYTES);
  });

  test("deterministic error mapping: 404 unknown session, 400 bad type, 413 oversized", async () => {
    const gateway = harness({ maxBodyBytes: 64 });
    register(gateway);

    const unknown = await upload(gateway, "s-other", PNG_BYTES);
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { code: string }).code).toBe("session_not_found");

    for (const junkType of ["text/plain", "application/pdf", "not-a-type", ""]) {
      const response = await upload(gateway, "s-1", PNG_BYTES, junkType);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { code: string }).code).toBe("invalid_media_type");
    }

    const oversized = await upload(gateway, "s-1", PNG_BYTES);
    expect(oversized.status).toBe(413);
    expect(((await oversized.json()) as { code: string }).code).toBe("attachment_too_large");

    // An empty body is not a valid image — 400, not "too large".
    const empty = await upload(gateway, "s-1", new Uint8Array(0));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { code: string }).code).toBe("invalid_media_type");
  });

  test("content-type parameters are tolerated (media type is what matters)", async () => {
    const gateway = harness();
    register(gateway);
    const response = await upload(gateway, "s-1", PNG_BYTES, "image/png; charset=binary");
    expect(response.status).toBe(201);
    expect(((await response.json()) as { mimeType: string }).mimeType).toBe("image/png");
  });

  test("per-session budget: oldest-first eviction admits a fitting upload; a body over the total budget answers 413", async () => {
    const gateway = harness({ maxBodyBytes: 100, maxTotalBytesPerSession: 120 });
    register(gateway);
    const bytes60 = Buffer.alloc(60);

    const first = await upload(gateway, "s-1", bytes60, "image/jpeg");
    expect(first.status).toBe(201);
    const second = await upload(gateway, "s-1", bytes60, "image/webp");
    expect(second.status).toBe(201); // 120 exactly: both fit
    const third = await upload(gateway, "s-1", PNG_BYTES);
    expect(third.status).toBe(201); // fits by evicting oldest-first (documented policy)
    expect(
      gateway.sessions?.getAttachment(
        "s-1",
        ((await first.json()) as { attachmentId: string }).attachmentId,
      ),
    ).toBeNull();

    // A body bigger than the per-session TOTAL budget can never fit even
    // after evicting everything else: the honest answer is 413, not a
    // stored-then-404 ref.
    const small = harness({ maxBodyBytes: 100, maxTotalBytesPerSession: 64 });
    register(small);
    const overBudget = await upload(small, "s-1", PNG_BYTES);
    expect(overBudget.status).toBe(413);
    expect(((await overBudget.json()) as { code: string }).code).toBe("attachment_too_large");
  });

  test("upload is bearer-gated (no credential-free bypass)", async () => {
    const gateway = harness();
    register(gateway);
    const response = await fetch(`${gateway.baseUrl}/v1/sessions/s-1/attachments`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: PNG_BASE64,
    });
    expect(response.status).toBe(401);
  });
});

// ——— POST /v1/sessions/{sessionId}/input (downstream image delivery, D5) ———

function captureWriter(lines: string[]): (line: string) => void {
  return (line) => lines.push(line);
}

function parseLine<T = Record<string, unknown>>(lines: string[], index: number): T {
  return JSON.parse(must(lines[index])) as T;
}

async function submitInput(
  gateway: TestGateway,
  sessionId: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${gateway.baseUrl}/v1/sessions/${sessionId}/input`, {
    method: "POST",
    headers: { ...authHeader(gateway.token()), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/sessions/{sessionId}/input (downstream delivery, D5)", () => {
  test("upload → input → collector delivers the image-bearing line; the tap's observed frame lands on the stream", async () => {
    const gateway = harness();
    const downstream: string[] = [];
    // One live tap WITH a downstream capture channel (the delivery target).
    const conn = tapConnect(gateway, { sessionId: "s-1", lane: "pi" }, captureWriter(downstream));

    // 1. Upload the image BEFORE the input that references it.
    const up = await upload(gateway, "s-1", PNG_BYTES);
    expect(up.status).toBe(201);
    const ref = (await up.json()) as { attachmentId: string };

    // 2. Submit the prompt with the attachment ref.
    const response = await submitInput(gateway, "s-1", {
      text: "what is in this screenshot?",
      attachments: [{ attachmentId: ref.attachmentId }],
    });
    expect(response.status).toBe(202);
    const { inputId } = (await response.json()) as { inputId: string };
    expect(inputId).toMatch(/^in_/);

    // 3. The collector delivered EXACTLY one image-bearing line downstream.
    expect(downstream).toHaveLength(1);
    const delivered = parseLine<{
      type: string;
      inputId: string;
      text: string;
      attachments: { attachmentId: string; mimeType: string; dataBase64: string }[];
    }>(downstream, 0);
    expect(delivered.type).toBe("deliver_input");
    expect(delivered.inputId).toBe(inputId);
    expect(delivered.text).toBe("what is in this screenshot?");
    expect(delivered.attachments).toEqual([
      { attachmentId: ref.attachmentId, mimeType: "image/png", dataBase64: PNG_BASE64 },
    ]);

    // 4. The tap turns the line into pi.sendUserMessage; pi fires its input
    // event; the tap observes the user_message + attachment lines upstream.
    // (This is the demo-tap contract; here simulated deterministically.)
    tap(gateway, conn, {
      type: "attachment",
      attachmentId: ref.attachmentId,
      mimeType: "image/png",
      dataBase64: PNG_BASE64,
    });
    tap(gateway, conn, {
      type: "user_message",
      messageId: "m-1",
      text: "what is in this screenshot?",
      source: "interactive",
      imageCount: 1,
      attachments: [{ attachmentId: ref.attachmentId, mimeType: "image/png" }],
    });

    // 5. The frame on the stream carries the REFERENCE, not the body (D5).
    const frame = userMessageFrame(gateway);
    expect(frame).not.toBeNull();
    expect(frame?.imageCount).toBe(1);
    expect(frame?.attachments).toEqual([
      {
        attachmentId: ref.attachmentId,
        mimeType: "image/png",
        byteLen: Buffer.from(PNG_BASE64, "base64").byteLength,
      },
    ]);
    expect(JSON.stringify(userMessageFrame(gateway))).not.toContain("PNG");
  });

  test("deterministic error mapping: 404 unknown session, 409 no live tap, 404 unresolved ref", async () => {
    const gateway = harness();
    // One live tap WITH a downstream channel (upload + later ref checks).
    const first = tapConnect(gateway, { sessionId: "s-1" }, () => {});
    const up = await upload(gateway, "s-1", PNG_BYTES);
    expect(up.status).toBe(201);
    tapDisconnect(gateway, first); // history known, no live tap

    const unknown = await submitInput(gateway, "s-other", { text: "hi" });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { code: string }).code).toBe("session_not_found");

    const notLive = await submitInput(gateway, "s-1", { text: "hi" });
    expect(notLive.status).toBe(409);
    expect(((await notLive.json()) as { code: string }).code).toBe("session_not_live");

    // Reconnect live WITH a downstream channel; an unresolved ref is then an
    // honest 404 (the body was never stored).
    tapConnect(gateway, { sessionId: "s-1" }, () => {});
    const missingRef = await submitInput(gateway, "s-1", {
      text: "hi",
      attachments: [{ attachmentId: "att-never-stored" }],
    });
    expect(missingRef.status).toBe(404);
    expect(((await missingRef.json()) as { code: string }).code).toBe("attachment_not_found");
  });

  test("validation: empty input 400, oversized text 413, over-cap refs 400, non-string text 400", async () => {
    const gateway = harness();
    const conn = tapConnect(gateway, { sessionId: "s-1" }, () => {});

    const empty = await submitInput(gateway, "s-1", { text: "   ", attachments: [] });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { code: string }).code).toBe("invalid_request");

    const oversized = await submitInput(gateway, "s-1", { text: "x".repeat(MAX_PROMPT_BYTES + 1) });
    expect(oversized.status).toBe(413);
    expect(((await oversized.json()) as { code: string }).code).toBe("prompt_too_large");

    const nine = Array.from({ length: 9 }, (_, i) => ({ attachmentId: `att-${i + 1}` }));
    const overCap = await submitInput(gateway, "s-1", { text: "hi", attachments: nine });
    expect(overCap.status).toBe(400);
    expect(((await overCap.json()) as { code: string }).code).toBe("invalid_request");

    const nonString = await submitInput(gateway, "s-1", { text: 42 });
    expect(nonString.status).toBe(400);
    expect(conn).toBeDefined();
  });

  test("observation-only taps (no downstream channel) answer 409 session_not_live", async () => {
    const gateway = harness();
    register(gateway); // no capture writer → no downstream channel
    const response = await submitInput(gateway, "s-1", { text: "hi" });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe("session_not_live");
  });
});
