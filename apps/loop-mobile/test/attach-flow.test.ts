/**
 * Composer attachment pipeline tests (decision D5; task
 * `composer-attach-and-highlighting`). Pure functions + structural fakes —
 * no network, no native module, no model calls. Contracts: the per-input
 * cap appends honestly, removal is order-preserving, the send pipeline
 * uploads ONLY not-yet-uploaded images, partial progress survives failure
 * (uploaded refs are reported before submit, so Resend re-uses them), and
 * every failure reaches onFailure without clearing caller state.
 */

import { describe, expect, test } from "bun:test";

import type { GatewayClient } from "../src/gateway-client/client";
import type { RemoteSessionAssetRef } from "../src/gateway-client/conversation";
import {
  MAX_ATTACHMENTS_PER_INPUT,
  appendPendingAttachment,
  removePendingAttachment,
  sendComposerWithAttachments,
  type PendingAttachment,
} from "../src/state/attachFlow";

const PHOTO_A = { uri: "file:///tmp/a.png", mimeType: "image/png", byteLen: 70 };
const PHOTO_B = { uri: "file:///tmp/b.jpeg", mimeType: "image/jpeg", byteLen: 140 };

function refFor(n: number): RemoteSessionAssetRef {
  return { attachmentId: `up_${n}`, mimeType: "image/png", byteLen: 10 };
}

function pendingWithRef(localId: string, ref: RemoteSessionAssetRef): PendingAttachment {
  return { localId, uri: `file:///tmp/${localId}.png`, mimeType: "image/png", byteLen: 10, ref };
}

/** Structural fake covering exactly the two client seams the flow uses. */
function fakeClient(options: {
  upload?: (
    sessionId: string,
    file: { mimeType: string; body: Blob },
  ) => Promise<RemoteSessionAssetRef>;
  submitInput?: (
    sessionId: string,
    input: { text: string; attachments: { attachmentId: string }[] },
  ) => Promise<{ inputId: string }>;
}): GatewayClient {
  return {
    uploadSessionAttachment: options.upload ?? (async () => refFor(-1)),
    submitSessionInput: options.submitInput ?? (async () => ({ inputId: "in_x" })),
  } as unknown as GatewayClient;
}

describe("appendPendingAttachment", () => {
  test("appends with a null ref (not yet uploaded)", () => {
    const list = appendPendingAttachment([], PHOTO_A, "l1");
    expect(list).toEqual([
      { localId: "l1", uri: PHOTO_A.uri, mimeType: "image/png", byteLen: 70, ref: null },
    ]);
  });

  test("rejects the append at the gateway-mirrored cap (honest limit, no silent drop)", () => {
    const full: PendingAttachment[] = [];
    for (let i = 0; i < MAX_ATTACHMENTS_PER_INPUT; i += 1) {
      const next = appendPendingAttachment(full, PHOTO_A, `l${i}`);
      expect(next).not.toBeNull();
      full.push(next![i]!);
    }
    expect(full).toHaveLength(MAX_ATTACHMENTS_PER_INPUT);
    expect(appendPendingAttachment(full, PHOTO_B, "overflow")).toBeNull();
  });

  test("cap equals the gateway's per-input bound (8)", () => {
    expect(MAX_ATTACHMENTS_PER_INPUT).toBe(8);
  });
});

describe("removePendingAttachment", () => {
  test("removes by local id, preserving order of the rest", () => {
    const list = [
      pendingWithRef("a", refFor(1)),
      { localId: "b", uri: PHOTO_B.uri, mimeType: "image/jpeg", byteLen: 140, ref: null },
      pendingWithRef("c", refFor(2)),
    ];
    expect(removePendingAttachment(list, "b").map((p) => p.localId)).toEqual(["a", "c"]);
    expect(removePendingAttachment(list, "missing")).toHaveLength(3);
  });
});

describe("sendComposerWithAttachments", () => {
  test("uploads only un-uploaded images and submits text + refs in order", async () => {
    const uploadedUris: string[] = [];
    const submittedInputs: { text: string; attachments: { attachmentId: string }[] }[] = [];
    const client = fakeClient({
      upload: async (_sessionId, file) => {
        uploadedUris.push(file.mimeType);
        return refFor(uploadedUris.length);
      },
      submitInput: async (_sessionId, input) => {
        submittedInputs.push(input);
        return { inputId: "in_1" };
      },
    });
    const onUploaded: Array<[string, RemoteSessionAssetRef]> = [];
    let success = false;
    await sendComposerWithAttachments(client, {
      sessionId: "sess_1",
      text: "look at these",
      pending: [
        { localId: "a", uri: PHOTO_A.uri, mimeType: "image/png", byteLen: 70, ref: null },
        { localId: "b", uri: PHOTO_B.uri, mimeType: "image/jpeg", byteLen: 140, ref: null },
      ],
      readBlob: async () => new Blob([new Uint8Array([1, 2, 3])]),
      onUploaded: (localId, ref) => onUploaded.push([localId, ref]),
      onSuccess: () => {
        success = true;
      },
      onFailure: () => {
        throw new Error("onFailure must not fire on success");
      },
    });
    expect(uploadedUris).toEqual(["image/png", "image/jpeg"]);
    expect(onUploaded.map(([localId]) => localId)).toEqual(["a", "b"]);
    expect(success).toBe(true);
    expect(submittedInputs).toEqual([
      { text: "look at these", attachments: [{ attachmentId: "up_1" }, { attachmentId: "up_2" }] },
    ]);
  });

  test("already-uploaded refs are reused — bytes never re-read", async () => {
    let uploadCalls = 0;
    const client = fakeClient({
      upload: async () => {
        uploadCalls += 1;
        return refFor(uploadCalls);
      },
    });
    await sendComposerWithAttachments(client, {
      sessionId: "sess_1",
      text: "",
      pending: [
        pendingWithRef("a", refFor(1)), // already uploaded (previous attempt)
        { localId: "b", uri: PHOTO_B.uri, mimeType: "image/jpeg", byteLen: 140, ref: null },
      ],
      readBlob: async () => new Blob([new Uint8Array([9])]), // runs for b only
      onUploaded: () => undefined,
      onSuccess: () => undefined,
      onFailure: () => {
        throw new Error("onFailure must not fire");
      },
    });
    expect(uploadCalls).toBe(1);
  });

  test("upload failure → onFailure with the message; state survives for Resend", async () => {
    let uploadCalls = 0;
    const uploadedRefs: string[] = [];
    const client = fakeClient({
      upload: async () => {
        uploadCalls += 1;
        if (uploadCalls === 2) throw new Error("413 attachment_too_large");
        return refFor(uploadCalls);
      },
    });
    const failures: string[] = [];
    const uploadedLocalIds: string[] = [];
    await sendComposerWithAttachments(client, {
      sessionId: "sess_1",
      text: "hi",
      pending: [
        { localId: "a", uri: PHOTO_A.uri, mimeType: "image/png", byteLen: 70, ref: null },
        { localId: "b", uri: PHOTO_B.uri, mimeType: "image/jpeg", byteLen: 140, ref: null },
      ],
      readBlob: async () => new Blob([new Uint8Array([1])]),
      onUploaded: (localId, ref) => {
        uploadedLocalIds.push(localId);
        uploadedRefs.push(ref.attachmentId);
      },
      onSuccess: () => {
        throw new Error("onSuccess must not fire on failure");
      },
      onFailure: (message) => failures.push(message),
    });
    expect(failures).toEqual(["413 attachment_too_large"]);
    // Partial progress is reported: ref `a` survives for the Resend path.
    expect(uploadedLocalIds).toEqual(["a"]);
    expect(uploadedRefs).toEqual(["up_1"]);
  });

  test("submit failure after successful uploads → onFailure; refs already recorded", async () => {
    const client = fakeClient({
      upload: async () => refFor(9),
      submitInput: async () => {
        throw new Error("409 session_not_live");
      },
    });
    const uploadedLocalIds: string[] = [];
    const failures: string[] = [];
    await sendComposerWithAttachments(client, {
      sessionId: "sess_1",
      text: "hi",
      pending: [{ localId: "a", uri: PHOTO_A.uri, mimeType: "image/png", byteLen: 70, ref: null }],
      readBlob: async () => new Blob([new Uint8Array([1])]),
      onUploaded: (localId) => uploadedLocalIds.push(localId),
      onSuccess: () => {
        throw new Error("onSuccess must not fire");
      },
      onFailure: (message) => failures.push(message),
    });
    expect(uploadedLocalIds).toEqual(["a"]);
    expect(failures).toEqual(["409 session_not_live"]);
  });
});
