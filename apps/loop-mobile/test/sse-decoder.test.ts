import { describe, expect, test } from "bun:test";

import { sseFrames, SseParser, Utf8ChunkDecoder } from "../src/gateway-client/sse";

describe("Utf8ChunkDecoder", () => {
  test("decodes ASCII across arbitrary chunk splits", () => {
    const text = 'event: status\ndata: {"ok":true}\n\n';
    const bytes = new TextEncoder().encode(text);
    const decoder = new Utf8ChunkDecoder();
    let out = "";
    for (const b of bytes) {
      out += decoder.decode(Uint8Array.from([b]), { stream: true });
    }
    expect(out + decoder.decode(new Uint8Array())).toBe(text);
  });

  test("carries a multi-byte sequence split across chunks (3-byte Korean)", () => {
    const text = "상태 완료";
    const bytes = new TextEncoder().encode(text);
    // Split in the middle of the first 3-byte sequence.
    const decoder = new Utf8ChunkDecoder();
    const first = decoder.decode(bytes.slice(0, 2), { stream: true });
    expect(first).toBe("");
    const rest = decoder.decode(bytes.slice(2), { stream: true });
    expect(first + rest).toBe(text);
  });

  test("decodes a 4-byte emoji split across three chunks", () => {
    const bytes = new TextEncoder().encode("✅ done");
    const decoder = new Utf8ChunkDecoder();
    let out = "";
    for (let i = 0; i < 3; i++) {
      out += decoder.decode(bytes.slice(i, i + 1), { stream: true });
    }
    out += decoder.decode(bytes.slice(3), { stream: true });
    expect(out).toBe("✅ done");
  });

  test("emits U+FFFD for a truncated tail in non-streaming mode", () => {
    const bytes = new TextEncoder().encode("상");
    const decoder = new Utf8ChunkDecoder();
    const out = decoder.decode(bytes.slice(0, 2)); // 1 byte missing, no stream flag
    expect(out).toBe("\uFFFD");
  });

  test("emits U+FFFD for malformed continuation bytes instead of throwing", () => {
    const bytes = Uint8Array.from([0xe0, 0x41, 0x41]); // invalid continuations
    const decoder = new Utf8ChunkDecoder();
    expect(() => decoder.decode(bytes, { stream: true })).not.toThrow();
    // Lenient (documented): the whole malformed sequence is replaced once.
    expect(decoder.decode(bytes, { stream: true })).toBe("\uFFFD");
  });
});

describe("sseFrames over a chunked stream", () => {
  test("parses frames whose data line contains split multi-byte UTF-8", async () => {
    const encoder = new TextEncoder();
    const line = 'data: {"text":"연구 결과 ✓"}\n\n';
    const bytes = encoder.encode(line);
    // Byte-at-a-time: every frame boundary AND character boundary is crossed.
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(Uint8Array.from([bytes[i++]]));
      },
    });
    const frames = [];
    for await (const frame of sseFrames(stream)) {
      frames.push(frame);
    }
    expect(frames).toHaveLength(1);
    expect(frames[0]!.event).toBe("message");
    expect(JSON.parse(frames[0]!.data).text).toBe("연구 결과 ✓");
  });

  test("parser keeps ignoring keepalive comments (existing contract)", () => {
    const parser = new SseParser();
    const frames = parser.push(": keepalive\n\nid: 1\nevent: status\ndata: {}\n\n");
    expect(frames).toHaveLength(1);
    expect(frames[0]!.id).toBe("1");
  });
});
