/**
 * Remote spawn flow primitives (task `spawn-app-ui`, decision
 * 2026-xx-session-spawn §D-D) — DOM/react-free on purpose: the test runtime
 * does not load react-native, so every unit-testable piece of the spawn
 * flow lives here and the component (session-spawn.tsx) is thin state
 * wiring over these.
 *
 * The spawn response carries a launcher handle, NOT a sessionId (the real
 * id is fixed when the spawned pi's tap registers with the collector), so
 * the auto-open is an honest temporal correlation: snapshot the inventory
 * before the spawn, poll it afterwards, and open the first NEWLY observed
 * session inside a bounded window (`awaitSpawnedSession`). If nothing
 * appears, the copy says exactly that — the window is open, the session
 * list is where to look — never a fabricated id.
 *
 * Gate honesty: the contract has no capability-discovery surface, so the
 * "spawn gated off" disabled state is LEARNED — the gateway answers
 * `spawn_disabled` (or `not_found` for a gateway older than the spawn
 * surface) and the action stays disabled for the connection lifetime
 * (App-owned state; §D-B1 gate defaults live server-side only).
 */

import { GatewayError } from "../gateway-client/problem";

/** Session ids currently in the gateway inventory (snapshot for the
 * before/after correlation). */
export function sessionIdsOf(list: {
  sessions: ReadonlyArray<{ sessionId: string }>;
}): Set<string> {
  return new Set(list.sessions.map((session) => session.sessionId));
}

export type SpawnDiscovery = { kind: "found"; sessionId: string } | { kind: "timeout" };

export type SpawnDiscoveryDeps = {
  listSessions(): Promise<{ sessions: ReadonlyArray<{ sessionId: string }> }>;
  /** Inventory ids taken BEFORE the spawn request — only ids outside this
   * set count as the spawned session. */
  beforeIds: ReadonlySet<string>;
  /** Total window for the tap registration to show up (default 15s). */
  timeoutMs?: number;
  /** Gap between inventory polls (default 1s). */
  pollIntervalMs?: number;
  /** Test seam; default setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Poll the session inventory until a NEW session id appears (the spawned
 * pi's tap registering with the collector) or the window closes. Transient
 * inventory failures keep polling — the inventory is best-effort elsewhere
 * too (RunsList), and the spawn itself has already succeeded by the time we
 * are here. The FIRST new id wins (multiple rapid spawns may be ambiguous —
 * decision §4 risk, documented, not invented around).
 */
export async function awaitSpawnedSession(deps: SpawnDiscoveryDeps): Promise<SpawnDiscovery> {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const pollIntervalMs = deps.pollIntervalMs ?? 1_000;
  const startedAt = Date.now();
  for (;;) {
    try {
      const ids = sessionIdsOf(await deps.listSessions());
      for (const id of ids) {
        if (!deps.beforeIds.has(id)) {
          return { kind: "found", sessionId: id };
        }
      }
    } catch {
      // Inventory hiccup: keep polling until the window closes.
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return { kind: "timeout" };
    }
    await sleep(pollIntervalMs);
  }
}

/**
 * One-line reason from a failed spawn, problem+json aware (the requirement:
 * the problem's code/detail — never a bare "failed"). Problem `fields`
 * carry check-rule text only (never path values, per the gateway contract),
 * so appending them is safe display.
 */
export function describeSpawnProblem(error: unknown): string {
  if (error instanceof GatewayError) {
    const fields = error.problem.fields;
    const fieldText =
      fields !== null && Object.keys(fields).length > 0
        ? ` (${Object.entries(fields)
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ")})`
        : "";
    return `${error.problem.code}${error.problem.detail.length > 0 ? ` — ${error.problem.detail}` : ""}${fieldText}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Problem codes that mean "this gateway will not spawn" (the learned gate):
 * the operator-configured gate (`spawn_disabled`, 403) and a gateway that
 * predates the spawn surface (`not_found`, 404 — fail-closed seam absence). */
export function isSpawnGateProblem(error: unknown): boolean {
  return (
    error instanceof GatewayError &&
    (error.problem.code === "spawn_disabled" || error.problem.code === "not_found")
  );
}
