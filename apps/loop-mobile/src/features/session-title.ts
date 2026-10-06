/**
 * Session naming rule (operator-approved, task `session-title-implementation`):
 * a session list row is named after its FIRST USER UTTERANCE — one line
 * (newlines → spaces, whitespace collapsed), clamped to 48 characters with
 * an ellipsis; without an utterance it is `새 세션` plus the start time;
 * identical titles in one list are disambiguated by appending the start
 * time; the subtitle is the Korean relative time plus a source badge
 * (`TUI` for interactive pi input, `앱` for app-delivered input).
 *
 * Deterministic by construction: pure functions over observed evidence, no
 * model calls, no emoji, no summarization. Evidence the app has not
 * observed is `null` — the rule renders the honest fallback instead of
 * fabricating a title or a time (unknown stays unknown).
 *
 * Pure model + formatting only: no React, no network, so the rule stays
 * unit-testable and the screens render `sessionRowView` verbatim.
 */

import { relativeTimeKo } from "./time-format";
import type { SessionNamingEvidence } from "../state/sessionsView";

export type { SessionNamingEvidence };

/** Title clamp: utterances render at most this many characters. */
export const SESSION_TITLE_MAX_CHARS = 48;

/** Fallback title for a session without an observed utterance. */
export const UNTITLED_SESSION_LABEL = "새 세션";

/** Newlines become spaces; whitespace runs collapse; edges trim. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Clamped one-line form: `…` appended only when characters were cut.
 * Counted in code points, so Korean text and emoji measure uniformly. */
export function clampUtterance(text: string, max: number = SESSION_TITLE_MAX_CHARS): string {
  const chars = Array.from(oneLine(text));
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, max).join("")}…`;
}

/** Two-digit zero-padded decimal (stamp components). */
function pad2(n: number): string {
  return `${n}`.padStart(2, "0");
}

/** Local `YYYY-MM-DD HH:mm` start stamp; unparseable input degrades to "". */
export function startStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/** The ` (stamp)` disambiguator suffix; "" when the stamp is unknown. */
function stampSuffix(startedAt: string | null): string {
  if (startedAt === null) return "";
  const stamp = startStamp(startedAt);
  return stamp === "" ? "" : ` (${stamp})`;
}

/**
 * Title for one session by the naming rule: the first utterance clamped to
 * one 48-char line, else `새 세션` plus the start time when known. Pure;
 * repeated titles are NOT disambiguated here (see `sessionTitles`).
 */
export function sessionTitle(evidence: SessionNamingEvidence | null | undefined): string {
  const utterance = evidence?.utterance ?? null;
  if (utterance !== null && oneLine(utterance).length > 0) {
    return clampUtterance(utterance);
  }
  return `${UNTITLED_SESSION_LABEL}${stampSuffix(evidence?.startedAt ?? null)}`;
}

/** Source badge label: interactive pi input is TUI, app-delivered input
 * (api/steer) is 앱; no observed source renders no badge. */
export function sourceBadgeLabel(source: SessionNamingEvidence["source"]): string {
  if (source === "tui") return "TUI";
  if (source === "app") return "앱";
  return "";
}

/** One session-list row's naming view, exactly what the screen renders. */
export type SessionRowView = {
  title: string;
  subtitle: string;
};

/** Subtitle per the rule: relative time + source badge; when nothing was
 * observed the lane (inventory truth) stands in so the row never lies. */
export function sessionSubtitle(
  evidence: SessionNamingEvidence | null | undefined,
  lane: string,
  now: Date = new Date(),
): string {
  const parts: string[] = [];
  const startedAt = evidence?.startedAt ?? null;
  if (startedAt !== null && relativeTimeKo(startedAt, now) !== "") {
    parts.push(relativeTimeKo(startedAt, now));
  }
  const badge = sourceBadgeLabel(evidence?.source ?? null);
  if (badge !== "") parts.push(badge);
  if (parts.length === 0) return lane;
  return parts.join(" · ");
}

/**
 * Titles for a whole rendered set: `sessionTitle` per row, then one
 * deterministic disambiguation pass — rows whose derived title repeats get
 * their start stamp appended (ALL rows of a repeat group, so the result is
 * independent of row order). A repeat group without a usable stamp stays
 * as-is (honest limit: there is nothing to append). Titles that already
 * embed their stamp (the `새 세션 (stamp)` fallback) are left untouched —
 * appending again could not separate same-minute starts anyway.
 */
export function sessionTitles(
  rows: ReadonlyArray<{ sessionId: string; evidence: SessionNamingEvidence | null }>,
): Map<string, string> {
  const titles = new Map<string, string>();
  for (const row of rows) {
    titles.set(row.sessionId, sessionTitle(row.evidence));
  }
  const groups = new Map<string, string[]>();
  for (const [sessionId, title] of titles) {
    const group = groups.get(title) ?? [];
    group.push(sessionId);
    groups.set(title, group);
  }
  for (const [title, sessionIds] of groups) {
    if (sessionIds.length < 2) continue;
    if (title.includes("(")) continue; // already stamped; see doc comment
    for (const sessionId of sessionIds) {
      const evidence = rows.find((row) => row.sessionId === sessionId)?.evidence ?? null;
      const suffix = stampSuffix(evidence?.startedAt ?? null);
      if (suffix !== "") titles.set(sessionId, `${title}${suffix}`);
    }
  }
  return titles;
}
