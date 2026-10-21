/**
 * Wire payload surface of the gateway's herdr surface (rebuild brief
 * docs/design/rebuild-brief-herdr-first.md §4) — the read-side mirror of
 * `packages/gateway/src/herdr-pane-source.ts` mapped views and
 * `herdr-state.ts` `HerdrStateView`. The gateway owns the contract; this
 * module states the app-visible subset and nothing else.
 *
 * Contract rules carried over from the gateway wire (ADR §4.1):
 * - u64 values (`revision`) travel as decimal STRINGS.
 * - IDs are opaque strings (`w1`, `w1:t1`, `w1:p1`); never parsed.
 * - Agent lifecycle is herdr's own five-state vocabulary — the UI speaks it
 *   verbatim (rebuild brief §3 용어 규율).
 */

export type HerdrAgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type HerdrWorkspace = {
  id: string;
  label: string;
  number: number;
  tabCount: number;
  paneCount: number;
  activeTabId: string;
  focused: boolean;
  status: HerdrAgentStatus;
};

export type HerdrTab = {
  id: string;
  workspaceId: string;
  label: string;
  number: number;
  focused: boolean;
  paneCount: number;
};

export type HerdrPane = {
  id: string;
  workspaceId: string;
  tabId: string;
  /** Stripped terminal title; null when herdr has none. */
  title: string | null;
  status: HerdrAgentStatus;
  /** Detected/managed agent kind occupying the pane ("claude", "agy", …). */
  agent: string | null;
  cwd: string | null;
  /** Decimal string (u64 rule); change hook for reads. */
  revision: string;
  focused: boolean;
};

export type HerdrState = {
  available: boolean;
  /** Monotonic change counter; a frame with a seen version is a no-op. */
  version: number;
  serverVersion: string;
  protocol: number;
  focused: { workspaceId: string | null; tabId: string | null; paneId: string | null };
  workspaces: HerdrWorkspace[];
  tabs: HerdrTab[];
  panes: HerdrPane[];
};

/** GET /v1/herdr/panes/{paneId}/read response body. */
export type HerdrPaneReading = {
  paneId: string;
  revision: string;
  text: string;
  truncated: boolean;
};

/** GET /v1/herdr/integrations response body entry. */
export type HerdrIntegration = {
  target: string;
  label: string;
  command: string;
  available: boolean;
  state: "not_installed" | "current" | "outdated";
};

/** POST /v1/herdr/agents/start response body. */
export type HerdrAgentStarted = {
  paneId: string;
  name: string | null;
  kind: string;
  ready: boolean;
  createdPane: boolean;
  workspaceId: string | null;
  tabId: string | null;
};

/** POST /v1/herdr/workspaces response body. */
export type HerdrWorkspaceCreated = {
  workspaceId: string;
  tabId: string;
  rootPaneId: string;
};

/** SSE frame payload guard (GET /v1/herdr/events → `herdr_state`). */
export function isHerdrState(value: unknown): value is HerdrState {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.available === "boolean" &&
    typeof record.version === "number" &&
    Array.isArray(record.panes)
  );
}
