/**
 * XHR-based SSE transport (task `simulator-showcase-2`).
 *
 * React Native's fetch polyfill (whatwg-fetch) does not expose
 * `response.body` — a streamed SSE response is only observable through
 * XMLHttpRequest's incremental data events (RN fires `onreadystatechange`
 * with readyState 3 per incremental chunk). This module wraps one XHR as an
 * async generator of decoded text chunks so `GatewayClient.observeRun` can
 * speak the same parser over either transport:
 *
 * - Bun / browsers / Node: fetch Response with a ReadableStream body
 *   (client.ts `sseTextChunks`, the contract-tested reference path).
 * - React Native: this XHR path.
 *
 * Purely a transport: no frame parsing, no auth, no retry — those stay in
 * client.ts.
 */

export type SseConnection = {
  /** HTTP status; resolves once response headers arrive (0 on network failure). */
  status: Promise<number>;
  /** Decoded response text chunks; ends when the server closes or the request aborts. */
  chunks: AsyncGenerator<string, void, void>;
};

export type XhrLike = {
  open(method: string, url: string, async: boolean): void;
  setRequestHeader(name: string, value: string): void;
  send(): void;
  abort(): void;
  status: number;
  readyState: number;
  responseText: string;
  addEventListener(type: string, listener: (...args: unknown[]) => void): void;
};

export type XhrFactory = () => XhrLike;

/**
 * Default factory: the runtime's XMLHttpRequest (the React Native global).
 * RN's XHR callbacks are untyped functions, so the DOM-typed instance is
 * structurally wider than XhrLike; the cast is scoped to this boundary.
 */
export const defaultXhrFactory: XhrFactory = () => new XMLHttpRequest() as unknown as XhrLike;

export function openXhrSse(options: {
  url: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
  xhrFactory?: XhrFactory;
}): SseConnection {
  const xhr = (options.xhrFactory ?? defaultXhrFactory)();
  const DONE = 4;
  const LOADING = 3;
  const HEADERS_RECEIVED = 2;

  let resolveStatus!: (status: number) => void;
  const status = new Promise<number>((resolve) => {
    resolveStatus = resolve;
  });

  const queue: string[] = [];
  let notify: (() => void) | null = null;
  let closed = false;
  let failure: { message: string } | null = null;
  let seen = 0;

  let statusResolved = false;
  const resolveStatusOnce = (value: number): void => {
    if (!statusResolved) {
      statusResolved = true;
      resolveStatus(value);
    }
  };

  const enqueue = (chunk: string): void => {
    if (chunk.length > 0) {
      queue.push(chunk);
      notify?.();
    }
  };
  const close = (): void => {
    if (!closed) {
      closed = true;
      notify?.();
    }
  };
  const fail = (message: string): void => {
    failure = failure ?? { message };
    resolveStatusOnce(0);
    close();
  };

  if (options.signal !== undefined) {
    if (options.signal.aborted) {
      close();
    } else {
      options.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
  }

  xhr.open("GET", options.url, true);
  for (const [name, value] of Object.entries(options.headers)) {
    xhr.setRequestHeader(name, value);
  }
  xhr.addEventListener("readystatechange", () => {
    if (xhr.readyState >= HEADERS_RECEIVED && xhr.status !== 0) {
      resolveStatusOnce(xhr.status);
    }
    if (xhr.readyState === LOADING || xhr.readyState === DONE) {
      // RN delivers incremental chunks; responseText is the accumulated body.
      const text = xhr.responseText;
      if (typeof text === "string" && text.length > seen) {
        enqueue(text.slice(seen));
        seen = text.length;
      }
      if (xhr.readyState === DONE) {
        close();
      }
    }
  });
  xhr.addEventListener("error", () => fail("XHR network error"));
  xhr.addEventListener("abort", () => close());
  xhr.addEventListener("timeout", () => fail("XHR timeout"));
  xhr.send();

  async function* chunks(): AsyncGenerator<string, void, void> {
    try {
      for (;;) {
        while (queue.length > 0) {
          yield queue.shift() as string;
        }
        if (closed) {
          if (failure !== null) {
            throw new Error(failure.message);
          }
          return;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        notify = null;
      }
    } finally {
      close();
      try {
        xhr.abort(); // stop the stream when the consumer stops (terminal/abort)
      } catch {
        // already finished
      }
    }
  }

  return { status, chunks: chunks() };
}
