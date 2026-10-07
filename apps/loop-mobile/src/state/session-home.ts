import type { RemoteSessionSummary } from "../gateway-client/conversation";
import { UNNAMED_SESSION_LABEL } from "../ui/copy";

/** Session identity, not run correlation, owns home membership. */
export function sessionHomeRows(
  sessions: readonly Pick<RemoteSessionSummary, "sessionId" | "state" | "title" | "runId" | "lane">[],
  titleFor?: (sessionId: string) => string | undefined,
): { sessionId: string; state: RemoteSessionSummary["state"]; title: string }[] {
  const seen = new Set<string>();
  const rows = [] as { sessionId: string; state: RemoteSessionSummary["state"]; title: string }[];
  for (const session of sessions) {
    if (seen.has(session.sessionId)) continue;
    seen.add(session.sessionId);
    rows.push({
      sessionId: session.sessionId,
      state: session.state,
      title: titleFor?.(session.sessionId) ?? session.title ?? UNNAMED_SESSION_LABEL,
    });
  }
  return rows.sort((a, b) => Number(b.state === "live") - Number(a.state === "live"));
}
