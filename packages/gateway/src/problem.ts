/**
 * RFC 9457 problem envelope for the gateway error contract (ADR §4.6).
 * Clients branch on `code` + `status` only; `type`/`title`/`detail` are
 * display text and never carry credentials, prompts, endpoints, or paths.
 */

import type { GatewayProblem } from "./wire";

/** Adapter-local problem codes. The ADR §4.6 table plus framing codes that
 * the table does not enumerate (unknown route, wrong method, browser Origin). */
export type ProblemCode =
  | "invalid_request"
  | "invalid_cursor"
  | "unauthorized"
  | "origin_rejected"
  | "not_found"
  | "method_not_allowed"
  | "run_not_found"
  | "pane_not_found"
  | "conversation_unavailable"
  | "session_not_found"
  | "attachment_not_found"
  | "attachment_too_large"
  | "invalid_media_type"
  | "file_path_rejected"
  | "file_not_found"
  | "file_too_large"
  | "file_not_text"
  | "session_not_live"
  | "stream_not_acceptable"
  | "prompt_too_large"
  | "capacity_exhausted"
  | "internal"
  | "planner_unavailable"
  | "runtime_unavailable"
  | "steer_unavailable"
  | "spawn_disabled"
  | "spawn_fallback_denied"
  | "spawn_cwd_invalid"
  | "spawn_cwd_outside_roots"
  | "spawn_cwd_missing"
  | "spawn_tmux_unavailable"
  | "spawn_tmux_session_missing"
  | "spawn_launch_failed"
  | "herdr_unavailable"
  | "agent_blocked"
  | "agent_not_found"
  | "agent_start_rejected";

const RETRYABLE: ReadonlySet<ProblemCode> = new Set([
  "capacity_exhausted",
  "planner_unavailable",
  "runtime_unavailable",
  "herdr_unavailable",
]);

const TITLES: Record<ProblemCode, string> = {
  invalid_request: "Invalid request",
  invalid_cursor: "Invalid cursor",
  unauthorized: "Unauthorized",
  origin_rejected: "Origin rejected",
  not_found: "Not found",
  method_not_allowed: "Method not allowed",
  run_not_found: "Run not found",
  pane_not_found: "Pane not found",
  conversation_unavailable: "No structured conversation for this pane",
  session_not_found: "Session not found",
  attachment_not_found: "Attachment not found",
  attachment_too_large: "Attachment too large",
  invalid_media_type: "Invalid media type",
  file_path_rejected: "File path rejected",
  file_not_found: "File not found",
  file_too_large: "File too large",
  file_not_text: "File is not text",
  session_not_live: "Session not live",
  stream_not_acceptable: "Stream not acceptable",
  prompt_too_large: "Prompt too large",
  capacity_exhausted: "Capacity exhausted",
  internal: "Internal error",
  planner_unavailable: "Planner unavailable",
  runtime_unavailable: "Runtime unavailable",
  steer_unavailable: "Steer unavailable",
  spawn_disabled: "Session spawn disabled",
  spawn_fallback_denied: "Spawn not allowed on fallback listener",
  spawn_cwd_invalid: "Spawn cwd invalid",
  spawn_cwd_outside_roots: "Spawn cwd outside allowed roots",
  spawn_cwd_missing: "Spawn cwd missing",
  spawn_tmux_unavailable: "tmux unavailable",
  spawn_tmux_session_missing: "tmux session missing",
  spawn_launch_failed: "Spawn launch failed",
  herdr_unavailable: "Herdr unavailable",
  agent_blocked: "Agent is waiting on an approval dialog",
  agent_not_found: "Agent not found",
  agent_start_rejected: "Agent start rejected",
};

function kebab(code: string): string {
  return code.replaceAll("_", "-");
}

export class ProblemError extends Error {
  override readonly name = "ProblemError";
  readonly status: number;
  readonly code: ProblemCode;
  readonly fields: Record<string, string> | null;

  constructor(status: number, code: ProblemCode, fields: Record<string, string> | null = null) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function problem(
  status: number,
  code: ProblemCode,
  requestId: string,
  fields: Record<string, string> | null = null,
): GatewayProblem {
  return {
    type: `https://loop.local/problems/${kebab(code)}`,
    title: TITLES[code],
    status,
    code,
    detail: `${TITLES[code]}.`,
    requestId,
    retryable: RETRYABLE.has(code),
    fields,
  };
}

/** JSON response with problem content type; every response carries X-Request-Id. */
export function problemResponse(
  status: number,
  code: ProblemCode,
  requestId: string,
  fields: Record<string, string> | null = null,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(problem(status, code, requestId, fields)), {
    status,
    headers: {
      "Content-Type": "application/problem+json",
      "X-Request-Id": requestId,
      ...extraHeaders,
    },
  });
}
