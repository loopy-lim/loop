/**
 * Session-focus default filter (task `session-focus`): the chats list shows
 * only the currently ACTIVE work by default — non-terminal runs and live
 * sessions — and exposes the full inventory only behind an explicit
 * "show all" toggle. Pure state — no React — so the contract tests stay
 * RN-free (same rule as sessionsView.ts).
 *
 * "Active" reads straight off the Rust-owned projections: a run is active
 * while its `terminal` flag is false (accepted/planning/running/attention),
 * and a session is active while its tap stream is `live`. The app never
 * re-derives status semantics; it only reads what the wire proved.
 */

import type { RemoteSessionSummary } from "../gateway-client/conversation";
import type { RemoteRunSummary } from "../gateway-client/wire";

/** A run is active (currently executing or awaiting attention) while
 * non-terminal; completed/failed/cancelled runs hide behind the toggle. */
export function isActiveRun(run: Pick<RemoteRunSummary, "terminal">): boolean {
  return !run.terminal;
}

/** A session is active while its tap stream is live; `ended` and
 * `unobserved` inventory entries hide behind the toggle. */
export function isActiveSession(session: Pick<RemoteSessionSummary, "state">): boolean {
  return session.state === "live";
}

/** Display-only ordering: the most recently updated run leads, so the one
 * loop that is running right now is the first (emphasized) row. Stable for
 * equal timestamps; never mutates the input. */
export function activeFirst(runs: RemoteRunSummary[]): RemoteRunSummary[] {
  return runs.toSorted((a, b) => {
    if (a.updatedAt === b.updatedAt) return 0;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
}
