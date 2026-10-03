/**
 * Bounded in-memory attachment body store for the session conversation
 * surface (decision 2026-xx-gui-conversation D5, M2).
 *
 * Conversation frames carry reference-shaped `RemoteSessionAssetRef`
 * metadata only; the BODIES live here, outside the SSE ring buffer, so
 * replay re-issues references and never re-floods the frame budget
 * (terminal-mirror D7 precedent). This is the only place attachment bounds
 * are quantified (D5 left the numbers to M2):
 *
 * - `MAX_ATTACHMENT_BODY_BYTES` — per-asset decoded size cap (8 MiB).
 * - `MAX_ATTACHMENTS_PER_SESSION` — per-session asset count cap (16).
 * - `MAX_ATTACHMENT_BYTES_PER_SESSION` — per-session total cap (24 MiB).
 *
 * Over-budget assets are dropped or evicted oldest-first (insertion order);
 * an evicted body surfaces to clients as an honest 404
 * (`attachment_not_found`), never as synthesized bytes. Process memory only:
 * a gateway restart loses bodies exactly like it loses frame history.
 *
 * Bodies are not redacted (they are opaque bytes, not text fields) — they
 * are bounded by size instead, and the store keeps no metadata beyond the
 * tap-declared bounded media type.
 */

/** Per-asset decoded body cap (D5 quantification). */
export const MAX_ATTACHMENT_BODY_BYTES = 8 * 1024 * 1024;

/** Per-session stored asset count cap (D5 quantification). */
export const MAX_ATTACHMENTS_PER_SESSION = 16;

/** Per-session stored asset total-byte cap (D5 quantification). */
export const MAX_ATTACHMENT_BYTES_PER_SESSION = 24 * 1024 * 1024;

/** Upper bound for the u32 `byteLen` render metadata: per-asset cap fits
 * comfortably, so the conversation family stays free of u64 fields. */
export const MAX_ATTACHMENT_REF_BYTES = 0xffff_ffff;

/**
 * Upload allow-list (decision D5, app-side upload): image media types the
 * model surface can consume (pi `ImageContent.mimeType`). Everything else is
 * rejected `invalid_media_type` — the store serves this value as a response
 * header and pi forwards it to the provider, so junk types never enter.
 */
export const UPLOADABLE_IMAGE_MIME_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

/** True when the (already lower-cased, parameter-stripped) media type is in
 * the upload allow-list. */
export function isUploadableImageType(value: string): boolean {
  return (UPLOADABLE_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export type StoredAttachment = {
  /** Bounded RFC 2045 media type served as the response Content-Type. */
  mimeType: string;
  /** Decoded body bytes served verbatim. */
  bytes: Uint8Array;
};

export type SessionAssetStoreOptions = {
  maxBodyBytes?: number;
  maxPerSession?: number;
  maxTotalBytesPerSession?: number;
};

export class SessionAssetStore {
  readonly #maxBodyBytes: number;
  readonly #maxPerSession: number;
  readonly #maxTotalBytesPerSession: number;
  readonly #bySession = new Map<string, Map<string, StoredAttachment>>();

  constructor(options: SessionAssetStoreOptions = {}) {
    this.#maxBodyBytes = options.maxBodyBytes ?? MAX_ATTACHMENT_BODY_BYTES;
    this.#maxPerSession = options.maxPerSession ?? MAX_ATTACHMENTS_PER_SESSION;
    this.#maxTotalBytesPerSession =
      options.maxTotalBytesPerSession ?? MAX_ATTACHMENT_BYTES_PER_SESSION;
  }

  get maxBodyBytes(): number {
    return this.#maxBodyBytes;
  }

  /**
   * Store one attachment body. Oversized bodies and bodies that cannot fit
   * the per-session budget after oldest-first eviction are dropped (returns
   * false — the honest outcome is the client's 404, never a wrong body).
   */
  put(sessionId: string, attachmentId: string, stored: StoredAttachment): boolean {
    if (stored.bytes.byteLength > this.#maxBodyBytes) return false;
    if (stored.bytes.byteLength > this.#maxTotalBytesPerSession) return false;
    let assets = this.#bySession.get(sessionId);
    if (assets === undefined) {
      assets = new Map();
      this.#bySession.set(sessionId, assets);
    }
    // Re-put moves the asset to newest (dedupe by id; latest bytes win).
    const previous = assets.get(attachmentId);
    if (previous !== undefined) assets.delete(attachmentId);
    assets.set(attachmentId, stored);
    // Oldest-first eviction until both caps hold.
    while (
      assets.size > this.#maxPerSession ||
      this.#totalBytes(assets) > this.#maxTotalBytesPerSession
    ) {
      const oldest = assets.keys().next().value;
      if (oldest === undefined) break;
      assets.delete(oldest);
    }
    if (assets.get(attachmentId) !== stored) return false; // the new body itself was evicted
    return true;
  }

  get(sessionId: string, attachmentId: string): StoredAttachment | null {
    return this.#bySession.get(sessionId)?.get(attachmentId) ?? null;
  }

  storedBytes(sessionId: string, attachmentId: string): number | null {
    const stored = this.get(sessionId, attachmentId);
    return stored === null ? null : stored.bytes.byteLength;
  }

  forget(sessionId: string): void {
    this.#bySession.delete(sessionId);
  }

  #totalBytes(assets: Map<string, StoredAttachment>): number {
    let total = 0;
    for (const stored of assets.values()) total += stored.bytes.byteLength;
    return total;
  }
}

/**
 * Bounded RFC 2045 media-type shape check (`type/subset`, token charset) —
 * the value becomes a response header, so junk never reaches the wire.
 * Parameters (`; charset=…`) are rejected: the store serves the bare type.
 */
export function isValidMimeType(value: string): boolean {
  const match = /^[!#$%&'*+.^_`|~0-9a-zA-Z-]{1,127}\/[!#$%&'*+.^_`|~0-9a-zA-Z-]{1,127}$/.exec(
    value,
  );
  return match !== null;
}
