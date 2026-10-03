# Herdr agent-session registration — why Loop workers were invisible, and the fix

Date: 2026-09-27 · Task: fix-agent-records · Scope: gateway-only (no loop-core changes)

## Evidence-backed root causes

**RC1 — Loop workers never register `agent_session` (why Herdr shows no Loop agents).**
Herdr 0.8.2's UI lists an agent only when its pane carries an `agent_session` record in
`~/.config/herdr/session.json`. That record is written ONLY when
`pane.report_agent_session` — carrying an accepted `session_start_source` — arrives on the
herdr socket (raw NDJSON RPC; the `herdr pane report-agent-session` CLI verb is a silent
no-op in 0.8.2). Loop's managed worker agents (`herdr agent start`, names prefixed `loop-`
per `HerdrWorkerRuntime.workerName`) never report one: the herdr pi-side integration is not
installed (`herdr integration status` → `pi: not installed`), and the Lead's
`loop`-spawned pi runs with `--no-extensions`, so it could never load such an integration
anyway. Live-proven constraints of the RPC (each verified by A/B against herdr 0.8.2):

- `session_start_source` must be present AND an accepted value: `"startup"` persists;
  `"spawn"` is accepted-then-dropped.
- `source` must be a known integration id: `"herdr:pi"` persists; `"loop:worker"` is
  accepted-then-dropped.
- `seq` participates in per-(pane, source) monotonic upsert; reports are idempotent.

**RC2 — "the Pi agent dies immediately with exit code 1" is Loop's own teardown, not a
pi crash.** `herdr-server.log` shows every worker-pane `pane.exit code 1` firing on the
`cli:tab:close` Loop's orchestrator issues (release→cleanup, or the end-of-run sweep);
the pane child (shell) dies of Hangup, and the `WARN PaneDied for unknown pane` is the
UI-registry race behind that CLI close. A pi worker left alone in its pane stays alive
indefinitely (live repro: `herdr agent start --kind pi -- --model zai/glm-5.3-flashx` ran
30+ minutes; `agent_status` transitions idle→working→done were observed).

**RC3 — herdr 0.8.2 serves one request per socket connection.** A second request on the
same connection hits a broken pipe, and a request written into a closing connection is
replied `ok` but dropped. `HerdrPaneSource`'s persistent-connection reuse therefore
silently lost interleaved requests; the source now drops the socket after every response
(fresh connection per request).

## Fix (packages/gateway only; loop-core untouched)

- `herdr-pane-source.ts`: `listAgents()` (`agent.list`) and `reportAgentSession()`
  (`pane.report_agent_session`) join the existing herdr-protocol surface; one
  request-per-connection enforced after each response.
- `herdr-agent-session.ts` (new): `HerdrAgentSessionRegistrar` — one reconciliation tick
  every 2s (`AGENT_SESSION_POLL_MS`, `LOOP_GATEWAY_AGENT_SESSIONS=off` kill-switch):
  every `loop-`-prefixed managed agent WITHOUT an `agent_session` gets one reported,
  keyed by the herdr agent name (Loop's stable worker identity, the same name every
  `agent prompt`/`agent read` addresses), `source: "herdr:pi"`,
  `session_start_source: "startup"`, monotonic seq. Fail-observer: unreachable herdr or a
  failed report means "nothing sent this tick"; `tick()` never throws. If herdr's own pi
  extension is installed later, its time-ns-seq reports supersede ours (convergence).

## Verification

- Red→green: `packages/gateway/test/herdr-agent-session.test.ts` (10 tests) — written
  first, red on the missing module, green after implementation; pins the protocol mapping,
  the registrar policy (prefix/session/malformed filters, idempotence, failure isolation),
  and that the registrar never speaks the socket protocol itself.
- Live end-to-end: spawned a Loop-style worker (`herdr agent start loop-… --kind pi`),
  ran one registrar tick against the real herdr socket — `agent_session` appeared live in
  `agent list` and persisted in `session.json` within one persist cadence (panes with
  `agent_session`: 1 → 8 during the session).
- `bun run check` green (codegen:check, typecheck, architecture, cargo workspace, 661 bun
  tests); `cargo test -p loop-bridge` 45/45; `bun test packages/gateway` 174/174.
