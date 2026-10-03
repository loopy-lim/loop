/**
 * Opaque cursor codec (ADR §2 D3, §4.4, §4.5) — adapter-local.
 *
 * Both cursors are base64url JSON. The SSE cursor is scoped to one gateway
 * process generation and one run; the list cursor is a sort key
 * (createdAt, runId). Callers treat cursors as opaque; decoding failures
 * mean "unusable", never an escape hatch into gateway state.
 */

export type StreamCursor = {
  generation: number;
  runId: string;
  seq: number;
};

export type ListCursor = {
  createdAtMs: number;
  runId: string;
};

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decode<T>(cursor: string): T | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function encodeStreamCursor(cursor: StreamCursor): string {
  return encode({ v: 1, g: cursor.generation, r: cursor.runId, n: cursor.seq });
}

/** Null when malformed, from another generation, or for another run. */
export function decodeStreamCursor(
  cursor: string,
  generation: number,
  runId: string,
): StreamCursor | null {
  const parsed = decode<{ v?: unknown; g?: unknown; r?: unknown; n?: unknown }>(cursor);
  if (parsed === null || parsed.v !== 1) return null;
  if (
    typeof parsed.g !== "number" ||
    typeof parsed.r !== "string" ||
    typeof parsed.n !== "number"
  ) {
    return null;
  }
  if (!Number.isInteger(parsed.g) || !Number.isInteger(parsed.n) || parsed.n < 0) return null;
  if (parsed.g !== generation || parsed.r !== runId) return null;
  return { generation: parsed.g, runId: parsed.r, seq: parsed.n };
}

export function encodeListCursor(cursor: ListCursor): string {
  return encode({ v: 1, k: cursor.createdAtMs, r: cursor.runId });
}

/** Null when malformed (mapped to 400 invalid_cursor by the caller). */
export function decodeListCursor(cursor: string): ListCursor | null {
  const parsed = decode<{ v?: unknown; k?: unknown; r?: unknown }>(cursor);
  if (parsed === null || parsed.v !== 1) return null;
  if (typeof parsed.k !== "number" || typeof parsed.r !== "string") return null;
  if (!Number.isFinite(parsed.k) || parsed.r.length === 0) return null;
  return { createdAtMs: parsed.k, runId: parsed.r };
}
