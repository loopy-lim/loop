import type { RemoteSessionSummary } from "../gateway-client/conversation";
import { UNNAMED_SESSION_LABEL } from "../ui/copy";

/** One home list row: identity + proven state + the honest title. */
export type SessionHomeRow = {
  sessionId: string;
  state: RemoteSessionSummary["state"];
  title: string;
};

/** Home order (task `home-cleanup`): one rule for every state — sessionId
 * descending. Session ids are ULIDs, so lexicographic order IS creation
 * order and the descending id is newest-first; the wire carries no session
 * timestamp, so the id is the only honest recency. Live-on-top is a
 * SECTION decision (homeSections), never a row-sort override. */
export function sessionHomeRows(
  sessions: readonly Pick<RemoteSessionSummary, "sessionId" | "state" | "title" | "runId" | "lane">[],
  titleFor?: (sessionId: string) => string | undefined,
): SessionHomeRow[] {
  const seen = new Set<string>();
  const rows = [] as SessionHomeRow[];
  for (const session of sessions) {
    if (seen.has(session.sessionId)) continue;
    seen.add(session.sessionId);
    rows.push({
      sessionId: session.sessionId,
      state: session.state,
      title: titleFor?.(session.sessionId) ?? session.title ?? UNNAMED_SESSION_LABEL,
    });
  }
  return rows.sort((a, b) => (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0));
}

/** The three home sections (task `home-cleanup`): live work pinned on top,
 * ended history next, and gateway-unobserved sessions in their own quiet
 * group — an unobserved row is neither live nor honestly ended, so it
 * never mixes into the ended list. Filters preserve the descending-id
 * order, so each section is already newest-first. */
export type SessionHomeSections = {
  live: SessionHomeRow[];
  ended: SessionHomeRow[];
  unobserved: SessionHomeRow[];
};

export function homeSections(rows: readonly SessionHomeRow[]): SessionHomeSections {
  const sections: SessionHomeSections = { live: [], ended: [], unobserved: [] };
  for (const row of rows) {
    if (row.state === "live") sections.live.push(row);
    else if (row.state === "unobserved") sections.unobserved.push(row);
    else sections.ended.push(row);
  }
  return sections;
}

/** Ended cap (task `home-cleanup`): the ended flood renders a recent
 * window — 299 named-nothing rows made home unusable — and the rest stays
 * reachable behind one in-place expand control. */
export const ENDED_SESSIONS_VISIBLE_COUNT = 10;

export function endedWindow(
  rows: readonly SessionHomeRow[],
  limit: number = ENDED_SESSIONS_VISIBLE_COUNT,
): { visible: SessionHomeRow[]; hiddenCount: number } {
  const visible = rows.slice(0, limit);
  return { visible, hiddenCount: Math.max(0, rows.length - visible.length) };
}
