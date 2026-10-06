/**
 * Chats-list grouping fold (task `main-screen-polish`): the session list
 * reads as three sections — In progress (active work, attention included),
 * Today, Earlier — so the list answers "what needs me / what happened
 * today / what is older" without a heading hierarchy of its own.
 *
 * Pure state — no React, no network, no react-native import (same rule as
 * activeView.ts and sessionsView.ts), so the contract tests pin the
 * grouping semantics without a device. The fold reads ONLY what the
 * Rust-owned projections proved: the run's `terminal` flag and `updatedAt`,
 * the session's `state`, and the app-local naming evidence's start time.
 * The app never re-derives status semantics and never fabricates a time:
 * an entry whose recency cannot be proven buckets into "earlier" (the
 * honest oldest bucket), and unknown stays unknown.
 */

import type { RemoteSessionSummary } from "../gateway-client/conversation";
import type { RemoteRunStatus, RemoteRunSummary } from "../gateway-client/wire";

/** The three chats-list sections. */
export type SessionGroupKind = "active" | "today" | "earlier";

/** Local-midnight timestamp used for calendar-day comparison. */
function localMidnightMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local calendar-day equality (the Today/Earlier boundary). Naive local
 * midnight comparison — the same rule relativeTimeKo uses for 어제. */
export function isSameLocalDay(iso: string, now: Date): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return localMidnightMs(date) === localMidnightMs(now);
}

/** Group of one run: in progress while non-terminal (accepted, planning,
 * running, attention — an unanswered question IS in-progress work);
 * otherwise today when its last update landed on the local calendar day,
 * earlier when it did not (or the timestamp is unreadable). */
export function groupOfRun(
  run: Pick<RemoteRunSummary, "terminal" | "updatedAt">,
  now: Date,
): SessionGroupKind {
  if (!run.terminal) return "active";
  return isSameLocalDay(run.updatedAt, now) ? "today" : "earlier";
}

/** Group of one uncorrelated session. The wire carries no timestamp, so
 * the app-local naming evidence start time stands in; a session the app
 * never observed has no honest recency and buckets into "earlier" —
 * today is claimed only when a frame proved it. */
export function groupOfSession(
  session: Pick<RemoteSessionSummary, "state">,
  startedAt: string | null,
  now: Date,
): SessionGroupKind {
  if (session.state === "live") return "active";
  if (startedAt !== null && isSameLocalDay(startedAt, now)) return "today";
  return "earlier";
}

/** Ordering inside the In progress section: attention leads (the one
 * state that asks for the operator), then most-recently-updated — the
 * same recency tie-break as activeFirst. Stable for equal inputs. */
export function attentionFirst(
  a: Pick<RemoteRunSummary, "status" | "updatedAt">,
  b: Pick<RemoteRunSummary, "status" | "updatedAt">,
): number {
  const aAttention = a.status === "attention" ? 0 : 1;
  const bAttention = b.status === "attention" ? 0 : 1;
  if (aAttention !== bAttention) return aAttention - bAttention;
  if (a.updatedAt === b.updatedAt) return 0;
  return a.updatedAt < b.updatedAt ? 1 : -1;
}

/** Row status mark — the SEMANTIC key for a row's leading glyph. The
 * state layer may not import ui (arch boundary), so the view maps this
 * key onto the closed ui/glyphs.ts vocabulary; the fold only decides
 * WHICH state a row announces. Unknown/cancelled degrade to the quiet
 * mark (frequent states stay quiet, canon §4-2). */
export type StatusMark = "running" | "attention" | "error" | "done" | "dot";

export function statusMark(status: RemoteRunStatus): StatusMark {
  switch (status) {
    case "running":
    case "planning":
      return "running";
    case "attention":
      return "attention";
    case "failed":
      return "error";
    case "completed":
      return "done";
    default:
      return "dot";
  }
}
