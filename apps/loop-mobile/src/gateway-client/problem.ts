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

  constructor(problem: GatewayProblem) {
    super(`${problem.status} ${problem.code}: ${problem.detail}`);
    this.problem = problem;
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
  return {
    type: typeof record.type === "string" ? record.type : "about:blank",
    title: typeof record.title === "string" ? record.title : "",
    status: typeof record.status === "number" ? record.status : status,
    code: typeof record.code === "string" ? record.code : "internal",
    detail: typeof record.detail === "string" ? record.detail : "",
    requestId: typeof record.requestId === "string" ? record.requestId : "",
    retryable: record.retryable === true,
    fields,
  };
}

/** Throw a GatewayError for a non-2xx response with a problem body. */
export async function throwProblem(response: Response): Promise<never> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  throw new GatewayError(parseProblem(response.status, body));
}
