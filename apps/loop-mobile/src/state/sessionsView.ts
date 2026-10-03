/**
 * Chats-list session view helpers (GUI conversation v1, decision D6): the
 * runs list is the entry point; run rows carry their correlated session
 * badge, and observed sessions WITHOUT a run correlation get their own
 * section with an honest `run_id = null` mark. Pure state — no React — so
 * the contract tests stay RN-free.
 */

import type { ConversationStreamEvent, RemoteSessionSummary } from "../gateway-client/conversation";

/** Split the session inventory by run correlation (D1 adapter metadata). */
export function splitSessions(sessions: RemoteSessionSummary[]): {
  byRunId: Map<string, RemoteSessionSummary>;
  uncorrelated: RemoteSessionSummary[];
} {
  const byRunId = new Map<string, RemoteSessionSummary>();
  const uncorrelated: RemoteSessionSummary[] = [];
  for (const session of sessions) {
    if (session.runId != null) {
      byRunId.set(session.runId, session);
    } else {
      uncorrelated.push(session);
    }
  }
  return { byRunId, uncorrelated };
}

/** Observed naming evidence for one session (app-local fold, D4 §8:
 * fold state is app-local and never on the wire). Every field is null
 * until the session stream proves otherwise. Pure data — the naming-rule
 * formatters in features/session-title.ts render it. */
export type SessionNamingEvidence = {
  /** First user utterance, raw (unclamped; clamping happens at render). */
  utterance: string | null;
  /** Start time (first observed frame's RFC 3339 occurredAt), or null. */
  startedAt: string | null;
  /** Source of the first observed user message, or null when none. */
  source: "tui" | "app" | null;
};

const EMPTY_EVIDENCE: SessionNamingEvidence = { utterance: null, startedAt: null, source: null };

/** Wire source → naming-rule badge: interactive pi input is the TUI;
 * app-delivered input (api/steer) is the app. Unknown stays null. */
function badgeSource(source: string): SessionNamingEvidence["source"] {
  if (source === "interactive") return "tui";
  if (source === "api" || source === "steer") return "app";
  return null;
}

/**
 * App-local naming evidence fold (D4 §8: fold state is app-local, never on
 * the wire): per session, the FIRST observed frame's `occurredAt` is the
 * start time and the FIRST observed `user_message` provides the title
 * utterance and the source badge. Setting fields only while absent makes
 * replay duplicates idempotent without tracking seen ids — re-delivered
 * frames can never replace earlier evidence. Pure: the index never calls
 * the network and never derives anything but what a frame proved.
 */
export class SessionNamingIndex {
  readonly #evidence = new Map<string, SessionNamingEvidence>();

  /** Fold one decoded conversation event (unknown families never arrive). */
  observe(sessionId: string, event: ConversationStreamEvent): void {
    const current = this.#evidence.get(sessionId) ?? EMPTY_EVIDENCE;
    let next = current;
    if (current.startedAt === null && "occurredAt" in event.frame) {
      next = { ...next, startedAt: event.frame.occurredAt };
    }
    if (event.kind === "user_message" && current.utterance === null) {
      next = {
        ...next,
        utterance: event.frame.text,
        source: badgeSource(event.frame.source),
      };
    }
    if (next !== current) this.#evidence.set(sessionId, next);
  }

  /** Evidence observed so far; null when the session was never observed. */
  evidence(sessionId: string): SessionNamingEvidence | null {
    return this.#evidence.get(sessionId) ?? null;
  }
}
