/**
 * Herdr state stream — the ONE SSE observation loop in the app (rebuild
 * brief §5: SSE 관찰 루프 1본). Connects to GET /v1/herdr/events, feeds every
 * `herdr_state` frame to the consumer, and owns reconnect policy:
 *
 * - State frames are idempotent full snapshots addressed by the monitor
 *   version, so there is NO cursor: every (re)connect starts from the intro.
 * - A clean disconnect reconnects after a short pause; retryable failures
 *   back off exponentially (Retry-After wins verbatim); non-retryable
 *   GatewayErrors (401/404/…) throw — the server said do not retry.
 * - Transport is picked at runtime: streaming fetch body where available,
 *   XMLHttpRequest incremental events on React Native (Hermes has neither
 *   streaming bodies nor TextDecoder — sse.ts carries the decoder).
 */

import type { ConnectionConfig } from "../auth/connection";
import { openXhrSse } from "../gateway-client/xhr-sse";
import {
  BACKOFF_MAX_MS,
  BACKOFF_BASE_MS,
  STREAM_429_MAX_RETRIES,
  freshJitterMs,
  streamRetryDelayMs,
} from "../gateway-client/retry";
import { GatewayError, parseProblem } from "../gateway-client/problem";
import { SseParser, Utf8ChunkDecoder } from "../gateway-client/sse";
import { isHerdrState, type HerdrState } from "./wire";
import type { FetchLike } from "./client";

export type HerdrStreamStatus = "connecting" | "live" | "waiting";

export type ObserveHerdrOptions = {
  config: ConnectionConfig;
  onState: (state: HerdStateLike) => void;
  onStatus?: (status: HerdrStreamStatus) => void;
  /** Fatal errors (non-retryable problems) end the loop. */
  onError?: (error: GatewayError) => void;
  /** Retryable failures with the computed next delay. */
  onRetryableError?: (error: unknown, nextDelayMs: number) => void;
  signal: AbortSignal;
  fetchImpl?: FetchLike;
  /** Clean-disconnect pause (tests shrink it). */
  reconnectPauseMs?: number;
};

/** Structural guard so a drifted frame can never poison the store; the
 * concrete type is HerdrState (kept loose here to avoid a cycle). */
export type HerdStateLike = HerdrState;

const RECONNECT_PAUSE_MS = 500;

const FETCH_HAS_STREAMING_BODY: boolean = (() => {
  try {
    return typeof ReadableStream === "function" && new Response("x").body instanceof ReadableStream;
  } catch {
    return false;
  }
})();

async function* herdrTextChunks(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, void> {
  if (FETCH_HAS_STREAMING_BODY) {
    const response = await fetchImpl(url, { headers, signal });
    if (!response.ok || response.body === null) {
      await throwProblemResponse(response);
      return;
    }
    const decoder = new Utf8ChunkDecoder();
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        yield decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  const connection = openXhrSse({ url, headers, signal });
  const status = await connection.status;
  if (status === 0) {
    throw new Error("network error before response headers");
  }
  if (status !== 200) {
    let body = "";
    for await (const chunk of connection.chunks) {
      body += chunk;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
    throw new GatewayError(parseProblem(status, parsed));
  }
  yield* connection.chunks;
}

async function throwProblemResponse(response: Response): Promise<never> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  throw new GatewayError(parseProblem(response.status, body));
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Observe the herdr state stream until aborted or a fatal problem arrives. */
export async function observeHerdrState(options: ObserveHerdrOptions): Promise<void> {
  const { config, signal } = options;
  let backoffMs = BACKOFF_BASE_MS;
  let rateLimited = 0;

  for (;;) {
    if (signal.aborted) return;
    options.onStatus?.("connecting");
    try {
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      if (config.bearer.length > 0) headers.Authorization = `Bearer ${config.bearer}`;
      const chunks = herdrTextChunks(
        options.fetchImpl ?? fetch,
        `${config.baseUrl}/v1/herdr/events`,
        headers,
        signal,
      );
      const parser = new SseParser();
      let sawFrame = false;
      for await (const chunk of chunks) {
        for (const frame of parser.push(chunk)) {
          if (frame.event !== "herdr_state") continue;
          let data: unknown = null;
          try {
            data = JSON.parse(frame.data);
          } catch {
            continue; // junk frame: skip, the next state frame converges
          }
          if (!isHerdrState(data)) continue;
          if (!sawFrame) {
            sawFrame = true;
            backoffMs = BACKOFF_BASE_MS; // a delivered frame proves the stream recovered
            options.onStatus?.("live");
          }
          options.onState(data);
        }
      }
      // Clean disconnect: the intro of the next connection carries fresh state.
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof GatewayError && !error.retryable) {
        options.onError?.(error);
        return;
      }
      if (error instanceof GatewayError && error.problem.status === 429) {
        rateLimited += 1;
        if (rateLimited > STREAM_429_MAX_RETRIES) {
          options.onError?.(error);
          return;
        }
      }
      const delay = error instanceof GatewayError
        ? streamRetryDelayMs(error.retryAfterMs, backoffMs, freshJitterMs())
        : Math.min(backoffMs, BACKOFF_MAX_MS);
      options.onStatus?.("waiting");
      options.onRetryableError?.(error, delay);
      await sleep(delay, signal);
      backoffMs = Math.min(Math.max(backoffMs * 2, BACKOFF_BASE_MS * 2), BACKOFF_MAX_MS);
      continue;
    }
    if (signal.aborted) return;
    options.onStatus?.("waiting");
    await sleep(options.reconnectPauseMs ?? RECONNECT_PAUSE_MS, signal);
  }
}
