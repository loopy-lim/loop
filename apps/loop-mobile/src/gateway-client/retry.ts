/**
 * Retry policy for the gateway client — pure functions and constants only
 * (no timers, no fetch), so the thresholds and delay curves are unit-testable
 * without real waits.
 *
 * Policy (task `mobile-resilience`):
 * - 429 `capacity_exhausted` is the ONLY HTTP status the client retries on
 *   its own. The gateway returns 429 BEFORE accepting a submission
 *   (service.ts capacity check precedes acceptance), so a retry can never
 *   double-submit — the non-idempotency rule for submit/steer applies to
 *   network failures and other statuses, not to an explicit refusal.
 * - A `Retry-After` header is respected verbatim when present; without one
 *   the client falls back to exponential backoff + jitter.
 * - Retry counts are bounded: past the threshold the client gives up and
 *   surfaces the GatewayError (user-displayable via composer onFailure /
 *   streamError), never retrying forever.
 */

/** POST submit/steer: total attempts before giving up (first try + 429 retries). */
export const POST_429_MAX_ATTEMPTS = 3;

/** Live SSE streams: consecutive 429 connections absorbed before giving up. */
export const STREAM_429_MAX_RETRIES = 5;

/** Exponential backoff curve (stream reconnects and 429-without-hint). */
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
export const JITTER_MAX_MS = 250;

/** Full jitter in [0, JITTER_MAX_MS). Production source of randomness. */
export function freshJitterMs(): number {
  return Math.floor(Math.random() * JITTER_MAX_MS);
}

/**
 * Delay before the next submit/steer attempt (attempt is 1-based: the
 * attempt that just failed with 429). A server `Retry-After` hint wins
 * verbatim; otherwise exponential backoff from BACKOFF_BASE_MS + jitter.
 */
export function post429DelayMs(
  attempt: number,
  retryAfterMs: number | null,
  jitter: number,
): number {
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS) + jitter;
}

/**
 * Delay before the next live-stream reconnect. A server `Retry-After` hint
 * (from a 429 on the SSE endpoint) wins verbatim; otherwise the loop's
 * exponential backoff capped at BACKOFF_MAX_MS, plus jitter.
 */
export function streamRetryDelayMs(
  retryAfterMs: number | null,
  backoffMs: number,
  jitter: number,
): number {
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }
  return Math.min(backoffMs, BACKOFF_MAX_MS) + jitter;
}
