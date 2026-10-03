/**
 * HerdrAgentSessionRegistrar — makes Loop's spawned worker agents visible in
 * Herdr's UI by reconciling the one record Herdr's UI keys on.
 *
 * Root cause this fixes (2026-09-27, evidence in docs/findings): Herdr 0.8.2
 * lists an agent only when its pane carries an `agent_session` record, and
 * herdr writes that record ONLY when `pane.report_agent_session` — carrying
 * `session_start_source` — arrives on the herdr socket from the agent side.
 * Loop's managed worker agents (`herdr agent start`, names prefixed `loop-`
 * per the HerdrWorkerRuntime workerName rule) never report one: the herdr
 * pi-side integration is not installed on this host, and the herdr CLI verb
 * for the report is a silent no-op. The panes sat invisible; Loop's later
 * `tab.close` teardown then read as "the agent died immediately".
 *
 * Contract (mirrors the PaneMirror's fail-observer axis):
 * - One reconciliation tick lists herdr's managed agents via the port; every
 *   Loop-managed agent WITHOUT an `agent_session` gets one reported, keyed
 *   by the herdr agent name — Loop's stable worker identity, the same name
 *   every `agent prompt` / `agent read` addresses. Reports are idempotent
 *   upserts with a monotonic `seq`, so re-reporting is safe and self-heals
 *   herdr restarts.
 * - Agents outside the Loop prefix belong to the operator or other tools and
 *   are never claimed. Agents that already carry a session are never touched.
 * - Unreachable herdr or a failed report degrades to "nothing sent this
 *   tick"; `tick()` never throws (the interval must not kill the gateway).
 *
 * Not here: socket protocol, agent-name policy inputs, config parsing. The
 * protocol lives in herdr-pane-source.ts (the package's single herdr-adapter
 * file, pinned by the pane-boundary test); the registrar consumes the port.
 */

/** Loop-managed herdr agent name prefix (HerdrWorkerRuntime.workerName rule:
 * `loop-<slug(taskId)>`; the Lead's lifecycle reporter uses "loop:lead"). */
export const LOOP_AGENT_NAME_PREFIX = "loop-";

/** Reporting source: herdr's canonical pi-integration identity. Herdr
 * validates this field against its known integration ids ("herdr:<kind>")
 * and silently drops reports from unknown sources (verified live against
 * herdr 0.8.2). The session IS a pi session; if herdr's own pi extension is
 * installed later, its time-ns-seq reports supersede ours by herdr's
 * monotonic-seq upsert rule — the two writers converge.
 *
 * The Loop reporter family ("loop:lead" precedent) is rejected by herdr
 * here, so the Lead's lifecycle reporter keeps its own surface and this
 * registrar speaks the integration vocabulary herdr's UI keys on. */
export const AGENT_SESSION_SOURCE = "herdr:pi";

/** session_start_source marker: herdr persists the pane's agent_session only
 * when the report carries this field with an accepted value — "startup" is
 * what herdr's own pi integration reports for a freshly started session;
 * unknown values (e.g. "spawn") are accepted-then-dropped (verified live). */
export const AGENT_SESSION_START_SOURCE = "startup";

/** One reconciliation report (port payload; protocol mapping is the port's). */
export type AgentSessionReport = {
  paneId: string;
  source: string;
  agent: string;
  agentSessionId: string;
  sessionStartSource: string;
  seq: number;
};

/** Narrow inventory seam (implemented by HerdrPaneSource; faked in tests). */
export interface HerdrAgentInventoryPort {
  listAgents(): Promise<Array<{
    name: string;
    paneId: string;
    agent: string | null;
    agentSession: { source: string; agent: string; kind: string; value: string } | null;
  }> | null>;
  reportAgentSession(report: AgentSessionReport): Promise<boolean>;
}

export interface HerdrAgentSessionRegistrarOptions {
  port: HerdrAgentInventoryPort;
}

export class HerdrAgentSessionRegistrar {
  readonly #port: HerdrAgentInventoryPort;
  /** Monotonic report sequence (herdr pi-integration convention: seeded from
   * wall-clock ms so reports from a fresh process sort after older ones). */
  #seq = Date.now() * 1000;
  #timer: ReturnType<typeof setInterval> | null = null;
  #busy = false;

  constructor(options: HerdrAgentSessionRegistrarOptions) {
    this.#port = options.port;
  }

  /** Begin periodic reconciliation. Test suites drive `tick()` directly. */
  start(intervalMs: number): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.#timer.unref?.(); // never hold the gateway open for reconciliation
    void this.tick();
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * One reconciliation cycle: report a session identity for every Loop-
   * managed agent whose pane lacks one. Failures never throw.
   */
  async tick(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      const agents = await this.#port.listAgents();
      if (agents === null) return; // herdr unreachable / shape drift: skip
      for (const agent of agents) {
        if (agent.name.length === 0 || agent.paneId.length === 0) continue; // malformed: skip honestly
        if (!agent.name.startsWith(LOOP_AGENT_NAME_PREFIX)) continue; // not Loop's
        if (agent.agentSession != null) continue; // already registered
        const kind = agent.agent ?? "pi"; // herdr-managed agents always carry a kind; "pi" is Loop's only v1 kind
        await this.#port.reportAgentSession({
          paneId: agent.paneId,
          source: AGENT_SESSION_SOURCE,
          agent: kind,
          agentSessionId: agent.name,
          sessionStartSource: AGENT_SESSION_START_SOURCE,
          seq: ++this.#seq,
        });
      }
    } catch {
      // Observation must never break the caller (interval) or the runs.
    } finally {
      this.#busy = false;
    }
  }
}
