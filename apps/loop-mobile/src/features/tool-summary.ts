/**
 * Folded tool-card one-line argument summary (decision
 * 2026-xx-codex-detail-checklist C3). Single helper owned by the
 * presentation layer: the first string value of a path-like key wins,
 * then the first string value of any key, then the raw JSON head.
 * Render-time derivation only — `argsJson` is never copied into state.
 */

/** Ordered preference of path-like argument keys (closed vocabulary). */
const PREFERRED_KEYS = [
  "path",
  "file",
  "filePath",
  "command",
  "uri",
  "url",
  "query",
  "pattern",
] as const;

/** Hard cap for the raw-JSON fallback head (one line, overflow ellipsised
 * by the Text `numberOfLines={1}` render, this only bounds allocation). */
const RAW_HEAD = 120;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** One-line summary of a tool call's `argsJson`. Never throws on malformed
 * JSON — honesty degrades to the raw head, never to a crash. */
export function toolArgsSummary(argsJson: string): string {
  if (argsJson.length === 0) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return collapseWhitespace(argsJson.slice(0, RAW_HEAD));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    if (typeof parsed === "string") return collapseWhitespace(parsed.slice(0, RAW_HEAD));
    return collapseWhitespace(argsJson.slice(0, RAW_HEAD));
  }
  const record = parsed as Record<string, unknown>;
  for (const key of PREFERRED_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0)
      return collapseWhitespace(value.slice(0, RAW_HEAD));
  }
  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.length > 0)
      return collapseWhitespace(value.slice(0, RAW_HEAD));
  }
  // No summarizable string value (empty object, numbers only): an empty
  // summary — the header stays honest instead of echoing raw JSON.
  return "";
}

/** The honest result-area decision for a tool card (C5). Three closed
 * cases: a running card has NO result area (nothing has arrived yet), a
 * closed card with an empty result says so in one line, and a closed card
 * with a result carries the text plus the bounded-cut notice when marked. */
export type ToolResultView =
  | { kind: "hidden" }
  | { kind: "empty" }
  | { kind: "text"; text: string; truncated: boolean };

export function toolResultView(item: {
  state: "running" | "done" | "error";
  resultText: string | null;
  resultTruncated: boolean;
}): ToolResultView {
  if (item.resultText === null) return { kind: "hidden" };
  if (item.resultText.length === 0) return { kind: "empty" };
  return { kind: "text", text: item.resultText, truncated: item.resultTruncated };
}
