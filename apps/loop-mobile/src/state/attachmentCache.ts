/**
 * Attachment cache — app-side resolution of M2 attachment references
 * (decision 2026-xx-gui-conversation D5) into renderable state.
 *
 * The conversation stream carries reference-shaped `RemoteSessionAssetRef`
 * metadata only; this module fetches bodies out-of-band (via the injected
 * gateway-client fetcher — the only network seam), converts them to data
 * URIs for React Native `Image`, and reports honest placeholders when a
 * body is unavailable (evicted / never stored → 404 `attachment_not_found`).
 *
 * Pure state: no React, no direct network — the fetcher is injected, so
 * tests run fully deterministic against fixtures (the local-image path
 * needs no gateway and no model call). Rules:
 * - one fetch per (sessionId, attachmentId) — in-flight and settled results
 *   are deduped (replay duplicates never re-fetch);
 * - failures settle as `unavailable` and are not retried (no retry storm);
 * - non-image refs are never fetched — they render as file cards from the
 *   ref metadata alone (mime + size), mirroring the D5 decision that files
 *   are metadata/card concerns.
 */

import type { AttachmentBody } from "../gateway-client/client";
import type { RustraEventPayloads } from "../gateway-client/conversation";

/** One attachment reference from a `user_message` frame (Rust-owned shape). */
export type SessionAttachmentRef = RustraEventPayloads["loop.user_message"]["attachments"][number];

/** Render state of one attachment reference. */
export type AttachmentView =
  | { status: "idle" } // not yet loading (non-image refs stay here)
  | { status: "loading" }
  | { status: "ready"; dataUri: string }
  | { status: "unavailable"; reason: string | null };

export type AttachmentFetcher = (
  sessionId: string,
  attachmentId: string,
) => Promise<AttachmentBody>;

/** RFC 2045 top-level image check — inline render criterion (D5). */
export function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

/** Human display of a byte length (ref metadata; advisory, D5). */
export function formatByteLen(byteLen: number): string {
  if (byteLen >= 1024 * 1024) return `${(byteLen / (1024 * 1024)).toFixed(1)} MB`;
  if (byteLen >= 1024) return `${Math.max(1, Math.round(byteLen / 1024))} KB`;
  return `${byteLen} B`;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Bounds-checked byte read (callers guarantee the index is in range). */
function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) throw new RangeError(`byte index ${index} out of range`);
  return value;
}

/** Bounds-checked alphabet lookup (callers guarantee a 6-bit index). */
function alphabetAt(index: number): string {
  const value = BASE64_ALPHABET[index];
  if (value === undefined) throw new RangeError(`alphabet index ${index} out of range`);
  return value;
}

/** Deterministic standard base64 (no runtime-specific atob/btoa/Buffer —
 * Hermes and Bun both take the same pure path; testable without a runtime). */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const b0 = byteAt(bytes, offset);
    const b1 = offset + 1 < bytes.length ? byteAt(bytes, offset + 1) : null;
    const b2 = offset + 2 < bytes.length ? byteAt(bytes, offset + 2) : null;
    out += alphabetAt(b0 >> 2);
    if (b1 === null) {
      out += `${alphabetAt((b0 & 0x03) << 4)}==`;
    } else if (b2 === null) {
      out += `${alphabetAt(((b0 & 0x03) << 4) | (b1 >> 4))}${alphabetAt((b1 & 0x0f) << 2)}=`;
    } else {
      out += `${alphabetAt(((b0 & 0x03) << 4) | (b1 >> 4))}${alphabetAt(((b1 & 0x0f) << 2) | (b2 >> 6))}${alphabetAt(b2 & 0x3f)}`;
    }
  }
  return out;
}

/** `data:` URI for an inline render; React Native `Image` accepts it. */
export function toDataUri(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${toBase64(bytes)}`;
}

type CacheEntry =
  | { state: "loading" }
  | { state: "ready"; dataUri: string }
  | { state: "unavailable"; reason: string | null };

export class AttachmentCache {
  readonly #fetcher: AttachmentFetcher;
  readonly #entries = new Map<string, CacheEntry>();
  readonly #listeners = new Set<() => void>();

  constructor(fetcher: AttachmentFetcher) {
    this.#fetcher = fetcher;
  }

  /** Subscribe to any cache change (screen re-render trigger). */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Current render state for one reference (sync snapshot). */
  view(ref: SessionAttachmentRef): AttachmentView {
    const entry = this.#entries.get(ref.attachmentId);
    if (entry === undefined) return { status: "idle" };
    if (entry.state === "ready") return { status: "ready", dataUri: entry.dataUri };
    if (entry.state === "loading") return { status: "loading" };
    return { status: "unavailable", reason: entry.reason };
  }

  /**
   * Start loading an image ref exactly once (deduped by attachment id).
   * Non-image refs never fetch (file-card rendering needs metadata only).
   */
  ensure(sessionId: string, ref: SessionAttachmentRef): void {
    if (!isImageMime(ref.mimeType)) return;
    if (this.#entries.has(ref.attachmentId)) return;
    this.#entries.set(ref.attachmentId, { state: "loading" });
    this.#notify();
    this.#fetcher(sessionId, ref.attachmentId)
      .then((body) => {
        this.#entries.set(ref.attachmentId, {
          state: "ready",
          dataUri: toDataUri(body.mimeType, body.bytes),
        });
        this.#notify();
      })
      .catch((error: unknown) => {
        this.#entries.set(ref.attachmentId, {
          state: "unavailable",
          reason: error instanceof Error ? error.message : String(error),
        });
        this.#notify();
      });
  }

  /** Loaded entry count (test introspection; cache is app-local). */
  get size(): number {
    return this.#entries.size;
  }

  #notify(): void {
    // Snapshot: a listener may unsubscribe (mutate the set) during notify.
    // oxlint-disable-next-line unicorn/no-useless-spread -- defensive copy, see above
    for (const listener of [...this.#listeners]) listener();
  }
}
