/**
 * Incremental SSE frame parser (ADR §4.5).
 *
 * A frame is `id`, `event`, a single JSON `data` line, then a blank line.
 * Comment lines (e.g. `: keepalive`) carry no cursor and are dropped here.
 * The parser is chunk-boundary safe: bytes are buffered until a blank line
 * arrives.
 */

export type SseFrame = {
  /** Opaque gateway cursor; never parsed or compared by the app. */
  id: string | null;
  event: string;
  data: string;
};

export class SseParser {
  private buffer = "";

  /** Feed one decoded chunk; returns every complete frame it terminates. */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];

    let boundary = this.findBoundary(0);
    while (boundary !== null) {
      const raw = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.end);
      const frame = this.parseFrame(raw);
      if (frame !== null) {
        frames.push(frame);
      }
      boundary = this.findBoundary(0);
    }
    return frames;
  }

  /** Flush a trailing partial frame at stream end (defensive; contract closes on \n\n). */
  flush(): SseFrame | null {
    if (this.buffer.trim().length === 0) {
      this.buffer = "";
      return null;
    }
    const frame = this.parseFrame(this.buffer);
    this.buffer = "";
    return frame;
  }

  private findBoundary(from: number): { index: number; end: number } | null {
    for (let i = from; i < this.buffer.length - 1; i++) {
      if (this.buffer[i] === "\n" && this.buffer[i + 1] === "\n") {
        return { index: i, end: i + 2 };
      }
      if (
        this.buffer[i] === "\r" &&
        this.buffer[i + 1] === "\n" &&
        this.buffer[i + 2] === "\r" &&
        this.buffer[i + 3] === "\n"
      ) {
        return { index: i, end: i + 4 };
      }
    }
    return null;
  }

  private parseFrame(raw: string): SseFrame | null {
    let id: string | null = null;
    let event = "message";
    const data: string[] = [];
    let sawField = false;

    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith(":")) {
        continue; // keepalive / comment
      }
      if (line.trim().length === 0) {
        continue;
      }
      sawField = true;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
      if (field === "id") {
        id = value;
      } else if (field === "event") {
        event = value;
      } else if (field === "data") {
        data.push(value);
      }
    }

    if (!sawField) {
      return null;
    }
    return { id, event, data: data.join("\n") };
  }
}

/** Decode a byte stream into SSE frames. */
export async function* sseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const parser = new SseParser();
  const decoder = new Utf8ChunkDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        yield frame;
      }
    }
    const tail = parser.flush();
    if (tail !== null) {
      yield tail;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Byte length of the UTF-8 sequence started by the leading byte
 * (continuation bytes mis-used as leads decode as 1 byte → U+FFFD). */
function utf8SequenceLength(b: number): number {
  if (b < 0xc0) return 1;
  if (b < 0xe0) return 2;
  if (b < 0xf0) return 3;
  return 4;
}

/** Decode one UTF-8 sequence; null when the continuation bytes are invalid. */
function decodeUtf8Sequence(
  bytes: Uint8Array | number[],
  start: number,
  length: number,
): number | null {
  for (let k = 1; k < length; k++) {
    const b = bytes[start + k];
    if (b === undefined || b < 0x80 || b > 0xbf) return null;
  }
  // Invariant: the caller checked `start + length <= bytes.length` before calling.
  const at = (k: number): number => bytes[start + k]!;
  switch (length) {
    case 2:
      return ((at(0) & 0x1f) << 6) | (at(1) & 0x3f);
    case 3:
      return ((at(0) & 0x0f) << 12) | ((at(1) & 0x3f) << 6) | (at(2) & 0x3f);
    case 4:
      return (
        ((at(0) & 0x07) << 18) | ((at(1) & 0x3f) << 12) | ((at(2) & 0x3f) << 6) | (at(3) & 0x3f)
      );
    default:
      return null;
  }
}

/**
 * Minimal streaming UTF-8 decoder.
 *
 * Hermes (the RN JS engine) has no Web `TextDecoder`, and the SSE wire is
 * UTF-8, so the byte stream is decoded here. Chunk boundaries may split a
 * multi-byte sequence: incomplete trailing bytes are carried to the next
 * `decode` call; a non-streaming call emits U+FFFD for anything truncated or
 * malformed instead of throwing (the gateway only sends valid UTF-8, so the
 * lenient path exists to keep a bad frame from killing the stream).
 */
export class Utf8ChunkDecoder {
  private carry: number[] = [];

  decode(chunk: Uint8Array, options: { stream?: boolean } = {}): string {
    const bytes = this.carry.length > 0 ? Uint8Array.from([...this.carry, ...chunk]) : chunk;
    this.carry = [];
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i]!; // loop condition guarantees i < bytes.length
      const length = utf8SequenceLength(b);
      if (i + length > bytes.length) {
        if (options.stream === true) {
          this.carry = Array.from(bytes.slice(i));
          return out; // incomplete sequence: wait for the next chunk
        }
        out += "\uFFFD"; // truncated tail at stream end
        break;
      }
      if (length === 1) {
        out += String.fromCharCode(b);
      } else {
        const codePoint = decodeUtf8Sequence(bytes, i, length);
        const valid =
          codePoint !== null &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff);
        out += valid ? String.fromCodePoint(codePoint) : "\uFFFD";
      }
      i += length;
    }
    return out;
  }
}
