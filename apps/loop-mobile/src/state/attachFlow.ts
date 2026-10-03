/**
 * Composer attachment pipeline (decision 2026-xx-gui-conversation D5; task
 * `composer-attach-and-highlighting`). The send path mirrors
 * state/composer.ts's callback contract: the screen owns React state and
 * navigation, this module owns the deterministic steps —
 *
 *   pick (screen) → append/remove (pure, cap-enforced) → upload each
 *   not-yet-uploaded image → POST input {text, refs} for the LIVE session
 *
 * Attachments can only ride the live-session input endpoint (the only wire
 * path that carries refs), so a pending list routes the submit there even
 * when text-only submits would steer or start a new run. Partial progress
 * survives failure: `onUploaded` fires per image, so a failed send re-uses
 * stored refs on Resend instead of re-uploading bytes. Never retried
 * automatically (upload and input are both non-idempotent).
 */

import type { GatewayClient } from "../gateway-client/client";
import type { RemoteSessionAssetRef } from "../gateway-client/conversation";

/** Per-input attachment bound — mirrors the gateway collector's cap. */
export const MAX_ATTACHMENTS_PER_INPUT = 8;

/** One composer attachment: local preview metadata + optional upload ref. */
export type PendingAttachment = {
  /** App-local identity (thumbnail key, remove target). Never on the wire. */
  localId: string;
  /** Local file URI for the preview (React Native Image source). */
  uri: string;
  mimeType: string;
  byteLen: number;
  /** Set once uploaded: Resend re-uses the stored ref, never re-reads bytes. */
  ref: RemoteSessionAssetRef | null;
};

/** Append one picked photo; null when the composer already holds the cap
 * (the caller surfaces the honest limit notice instead of silently dropping). */
export function appendPendingAttachment(
  list: readonly PendingAttachment[],
  photo: { uri: string; mimeType: string; byteLen: number },
  localId: string,
): PendingAttachment[] | null {
  if (list.length >= MAX_ATTACHMENTS_PER_INPUT) return null;
  return [
    ...list,
    { localId, uri: photo.uri, mimeType: photo.mimeType, byteLen: photo.byteLen, ref: null },
  ];
}

/** Remove one attachment by local id (order-preserving, pure). */
export function removePendingAttachment(
  list: readonly PendingAttachment[],
  localId: string,
): PendingAttachment[] {
  return list.filter((pending) => pending.localId !== localId);
}

/**
 * The attachment send attempt — first press and Resend share this exact
 * path. Success reaches onSuccess (the caller clears draft + pending);
 * failure reaches onFailure with a client-owned message and the caller's
 * state survives untouched (uploaded refs were already reported through
 * onUploaded, so retry skips them).
 */
export async function sendComposerWithAttachments(
  client: GatewayClient,
  params: {
    sessionId: string;
    text: string;
    pending: readonly PendingAttachment[];
    readBlob: (uri: string) => Promise<Blob>;
    onUploaded: (localId: string, ref: RemoteSessionAssetRef) => void;
    onSuccess: () => void;
    onFailure: (message: string) => void;
  },
): Promise<void> {
  try {
    const refs: { attachmentId: string }[] = [];
    for (const pending of params.pending) {
      if (pending.ref !== null) {
        refs.push({ attachmentId: pending.ref.attachmentId });
        continue;
      }
      // Runtime-built Blob only (see client.uploadSessionAttachment): the
      // upload body must come from response.blob(), never a JS re-wrap.
      const body = await params.readBlob(pending.uri);
      const ref = await client.uploadSessionAttachment(params.sessionId, {
        mimeType: pending.mimeType,
        body,
      });
      params.onUploaded(pending.localId, ref);
      refs.push({ attachmentId: ref.attachmentId });
    }
    await client.submitSessionInput(params.sessionId, { text: params.text, attachments: refs });
    params.onSuccess();
  } catch (e: unknown) {
    params.onFailure(e instanceof Error ? e.message : "attachment submit failed");
  }
}
