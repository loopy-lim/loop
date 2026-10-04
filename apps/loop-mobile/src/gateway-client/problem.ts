/**
 * Problem (RFC 9457) parsing for the Loop gateway error contract.
 *
 * Clients branch on `code` + `status`, never on `title`/`detail`/`type`
 * (ADR §4.6).
 */

import type { GatewayProblem } from "./wire";

export class GatewayError extends Error {
  override readonly name = "GatewayError";
  readonly problem: GatewayProblem;
  /** Parsed `Retry-After` hint in ms, or null when the response carried none. */
  readonly retryAfterMs: number | null;

  constructor(problem: GatewayProblem, retryAfterMs: number | null = null) {
    super(`${problem.status} ${problem.code}: ${problem.detail}`);
    this.problem = problem;
    this.retryAfterMs = retryAfterMs;
  }

  get retryable(): boolean {
    return this.problem.retryable;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parse an error response body into a GatewayProblem; tolerates junk bodies. */
export function parseProblem(status: number, body: unknown): GatewayProblem {
  const fields =
    isRecord(body) && isRecord(body.fields) ? (body.fields as Record<string, string>) : null;
  const record = isRecord(body) ? body : {};
  const resolvedStatus = typeof record.status === "number" ? record.status : status;
  // Classification is decided by `code` + `status` only (ADR §4.6). The rule:
  // 429 is ALWAYS retryable (the gateway refused BEFORE accepting — a retry
  // cannot double-submit), any other 4xx is ALWAYS terminal (401/403/404
  // will not change on retry), and for other statuses the server's
  // `retryable` flag decides. Junk bodies classify by status alone.
  const other4xx = resolvedStatus >= 400 && resolvedStatus < 500 && resolvedStatus !== 429;
  const retryable = other4xx ? false : record.retryable === true || resolvedStatus === 429;
  return {
    type: typeof record.type === "string" ? record.type : "about:blank",
    title: typeof record.title === "string" ? record.title : "",
    status: resolvedStatus,
    code: typeof record.code === "string" ? record.code : "internal",
    detail: typeof record.detail === "string" ? record.detail : "",
    requestId: typeof record.requestId === "string" ? record.requestId : "",
    retryable,
    fields,
  };
}

/**
 * Parse a `Retry-After` header (task `mobile-resilience`). Accepts the two
 * RFC 9110 forms: delta-seconds and HTTP-date. Returns milliseconds to wait,
 * or null when the header is absent/unparseable (the caller then falls back
 * to its own exponential backoff + jitter).
 */
export function parseRetryAfter(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(0, date - Date.now());
}

/** Build a GatewayError from a non-2xx Response, capturing Retry-After. */
export async function responseError(response: Response): Promise<GatewayError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return new GatewayError(parseProblem(response.status, body), parseRetryAfter(response.headers.get("Retry-After")));
}

/** Throw a GatewayError for a non-2xx response with a problem body. */
export async function throwProblem(response: Response): Promise<never> {
  throw await responseError(response);
}
