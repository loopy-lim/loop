import type { WorkerResult } from "./types";

/**
 * Worker JSON output enforcement (gap analysis G16 — 구조화 출력, 부분도입).
 *
 * The completion contract stays the stronger gate; this option only makes the
 * worker's *report* machine-readable so adapters can parse it reliably.
 * Adapters with a native structured-output flag may translate the contract
 * into that flag; text CLIs receive the contract as a prompt section and the
 * result extractor prefers a parseable final JSON object.
 */
export interface WorkerOutputContract {
  format: "json";
  /**
   * When true, output without a parseable final JSON result fails the worker
   * (`incomplete_output`, retryable). Default false: parse when present and
   * fall back to plain-text extraction.
   */
  requireValid?: boolean;
  /** Adapter-specific schema hint relayed verbatim into the instruction. */
  schemaHint?: string;
}

export interface WorkerJsonResult {
  summary: string;
  changedFiles?: string[];
  checksRun?: string[];
  risks?: string[];
  sessionId?: string;
}

/**
 * Prompt section that enforces the JSON result shape. Part of the essential
 * contract: an output requirement trimmed from the prompt would silently
 * downgrade enforcement.
 */
export function jsonOutputSection(contract: WorkerOutputContract): string {
  const lines = [
    "Output contract:",
    "- End your final message with exactly one JSON object on its own last line.",
    '- The object must have a string "summary" key, plus optional "changed_files", "checks_run", "risks" (arrays of strings) and "session_id" (string).',
    "- No text, code fence, or commentary after the JSON object.",
  ];
  if (contract.schemaHint?.trim()) lines.push(`- Schema hint: ${contract.schemaHint.trim()}`);
  if (contract.requireValid) {
    lines.push("- The run treats a missing or unparseable JSON object as an incomplete result.");
  }
  return lines.join("\n");
}

/**
 * Extracts the worker JSON result from raw output: scans lines bottom-up for
 * a JSON object carrying a non-empty string "summary". Keys are read in
 * snake_case first (the instructed wire form) with camelCase fallbacks.
 */
export function extractWorkerJsonResult(text: string): WorkerJsonResult | undefined {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const raw = lines[index];
    if (raw === undefined) continue; // index < lines.length 가 범위를 보장한다
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = readJsonResult(value);
    if (parsed) return parsed;
  }
  return undefined;
}

/**
 * Applies the output contract to an already-normalized worker result (G16).
 * A required-but-missing JSON result fails the worker with the retryable
 * `incomplete_output` kind; a parsed result is folded into `summary` with one
 * bounded evidence line so downstream surfaces keep a single summary field.
 */
export function enforceOutputContract(
  result: WorkerResult,
  contract: WorkerOutputContract | undefined,
  stdout: string,
): WorkerResult {
  if (!contract || contract.format !== "json") return result;
  const parsed = extractWorkerJsonResult(stdout);
  if (!parsed) {
    if (contract.requireValid) {
      return {
        success: false,
        summary: "output contract violation: final JSON result object missing",
        sessionId: result.sessionId,
        failure: { kind: "incomplete_output", retryable: true },
      };
    }
    return result;
  }
  const evidence = [
    parsed.changedFiles?.length ? `changed_files: ${parsed.changedFiles.join(", ")}` : undefined,
    parsed.checksRun?.length ? `checks_run: ${parsed.checksRun.join(", ")}` : undefined,
    parsed.risks?.length ? `risks: ${parsed.risks.join(", ")}` : undefined,
  ].filter(Boolean);
  return {
    ...result,
    summary: evidence.length > 0 ? `${parsed.summary}\n${evidence.join(" | ")}` : parsed.summary,
    sessionId: parsed.sessionId ?? result.sessionId,
  };
}

function readJsonResult(value: unknown): WorkerJsonResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const summary = readString(record.summary);
  if (!summary) return undefined;
  return {
    summary,
    changedFiles: readStringArray(record.changed_files ?? record.changedFiles),
    checksRun: readStringArray(record.checks_run ?? record.checksRun),
    risks: readStringArray(record.risks),
    sessionId: readString(record.session_id ?? record.sessionId),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return items.length > 0 ? items : undefined;
}
