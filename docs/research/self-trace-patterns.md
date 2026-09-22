# Self-Trace Patterns: Loop's Local Run Data vs the Persona Briefing

- **Date:** 2026-09-22
- **Purpose:** First analysis of Loop's own local run data against `docs/research/personas/persona-development-briefing.md`, answering: which persona-shaped workflow patterns does our machine already exhibit, which does it lack, and how do we re-measure this repeatably?
- **Method:** Two data classes. (1) Loop-store-format traces are read by `scripts/trace-report.ts`, which mirrors the exact SQL and per-task derivation of `crates/loop-store/src/trace.rs` and loop-core's per-mille `TraceScore`; because no completed loop-store run exists locally yet, the deterministic `--fixture` database demonstrates that path (parity against Rust `SqliteStore::trace_report` verified manually on 2026-09-22 — identical summary, score, and per-task rows). (2) Agent-session telemetry is analyzed with read-only `sqlite3` JSON queries over the local registry (queries below).
- **Relation to prior briefings:** Applies the cross-field patterns and "trace signatures" table of `personas/persona-development-briefing.md`; the operational loop that produced those briefings is documented in `../persona-benchmark-playbook.md`.

## What local run data exists

| Source | What it is | Status |
|---|---|---|
| `~/.local/share/loop/registry.db` (~473 MB) | Herdr/loop agent registry: `agent_events`, `agents`, `runtime_sessions`, `tasks`, `orchestrator_checkpoints` | 64,415 agent events (64,323 semantic, 92 raw), 1,553 `tool_call` + 1,552 `tool_result`, 51 agents / 51 sessions, window 2026-09-05 10:01 → 2026-09-07 UTC. Analyzed read-only. |
| `mytest.db` (repo root) | loop-store SQLite database | 0 runs, 0 events — schema only. |
| `orchestrator_checkpoints` (registry.db) | Persisted orchestrator state | 0 rows — no completed Loop-format run has been persisted on this machine. |

Consequence: the only real behavioral data is agent-session telemetry; Loop-native trace numbers are demonstrated by the fixture until benchmark runs accumulate.

## Observed patterns against the briefing

### 1. Verification is interleaved and cheap-first, not end-gated (matches: big-tech/platform signature)

45% of all bash calls are verification-shaped (301 of 667 — commands matching `test`/`check`/`lint`/`tsc` or `cargo`/`bun` prefixes). Among the 20 agents that mutated files, all 20 ran verification, 16 of 20 ran verification **before their first edit**, and 240 of their 299 verification calls happened **before the agent's last edit** — i.e. verification is woven through implementation, not clustered at the end. The briefing's "verification position is the sharpest differentiator" holds: this is the big-tech presubmit shape (interleaved, cheap-first), and clearly **not** the indie signature of one late integration-shaped gate.

### 2. Evidence precedes mutation — the plan-first gate is real (matches: serialized decision/evidence node upstream)

Research-shaped tool calls (read 414, grep 137, find 36, ls 54 = 641) outnumber mutation-shaped ones (edit 207, write 38 = 245) by **2.6 : 1**. The agent population itself is shaped like the briefing's DAG: 21 of 51 agents ran dedicated `research` roles against 22 `main` workers (plus 5 implementation, 2 scout, 1 test). In briefing terms, work advanced through an evidence gate before implementation nodes ran — the plan-first profile is not a strawman; it is what this machine already does.

### 3. Rework is repair-shaped; failure handling is retry loops, not restarts (matches: failure edges route back, but none are recorded yet)

Editing dominates fresh writing **5.4 : 1** (207 edits vs 38 writes), and among agents that edited before verifying, the median batch before the first check was small (mean 2.5 edits) — small implement→verify cycles, matching the briefing's "many small implement↔review cycles". All 23 recorded error events are provider rate limits (429), plus 37 error-flagged tool results; recovery is retry/rework, never restart-from-scratch. **Gap:** the briefing says "failure edges are part of the profile", and the store side cannot yet show them — with zero persisted Loop-format runs, no `worker_failed`/`verification_failed` edges exist in any local trace. The fixture demonstrates the shape (1 worker failure → attention → retry → verification failure → pass on a 3-task plan-first DAG; score 1000/1000/666 per-mille); real benchmark runs must supply the real edges.

## Gaps and caveats

- **Herdr telemetry is not Loop traces.** `agent_events` carry `tool_call`/`tool_result` streams, not `EventKind`; verification classification is a command-string heuristic, and mapping to briefing trace signatures is approximate.
- **Redacted payloads.** Tool paths are scrubbed to `<path>` in the registry, so file-level rework attribution (which files get re-edited) is impossible; only session-level ordering is measurable.
- **No terminal states.** All 50 `tasks` rows read status `running`; registry rates are pooled across 33 tool-emitting agents, not per-task medians.
- **Single machine, one week.** The window (2026-09-05 → 2026-09-07) and provider mix (47 zai / 3 codex / 1 antigravity agents) make this a self-portrait, not a census — the briefing's caveat about documented-workflow bias applies equally here.

## Sources

Local data (accessed read-only via `sqlite3` on 2026-09-22; no credentials read or logged):

- `~/.local/share/loop/registry.db` — 473,280,512 bytes; tables `agents` (51), `runtime_sessions` (51), `tasks` (50), `agent_events` (64,415), `orchestrator_checkpoints` (0); `agent_events` window 2026-09-05 10:01:03 → 2026-09-07 05:44:13 UTC. Tool-call payload paths arrive redacted (`<path>`).
- Repo analysis inputs: `docs/research/personas/persona-development-briefing.md`, `docs/research/persona-benchmark-playbook.md`, `crates/loop-store/src/trace.rs`, `crates/loop-core/src/benchmark/trace.rs`, `scripts/trace-report.ts`, `config/persona-benchmark.example.toml`.
- Fixture evidence: `/tmp/loop-trace-fixture/fixture.sqlite` generated by `bun scripts/trace-report.ts --fixture` (30 events, deterministic; cross-checked against `SqliteStore::trace_report`).

## Re-run

1. **Loop-format baseline (no model calls, deterministic):**
   ```bash
   bun scripts/trace-report.ts --fixture
   ```
   Regenerates the fixture database and prints the workflow-pattern report (task ordering, verification frequency, rework and attention rates, per-mille score). Exit code 0.
2. **Loop-format over real runs** (after a benchmark or any run populated a store):
   ```bash
   loop benchmark run config/persona-benchmark.example.toml --database /tmp/loop-bench.sqlite   # fake providers, no paid calls
   bun scripts/trace-report.ts --database /tmp/loop-bench.sqlite            # all runs
   bun scripts/trace-report.ts --database /tmp/loop-bench.sqlite --run <id> # one run
   ```
   The script prints the same metrics the Rust store computes (`trace_report` + `TraceScore`).
3. **Agent-telemetry refresh** (read-only; the queries behind sections 1–3):
   ```bash
   DB=~/.local/share/loop/registry.db
   # tool distribution
   sqlite3 "$DB" "SELECT json_extract(payload,'$.name') t, count(*) FROM agent_events
     WHERE event_type='tool_call' GROUP BY t ORDER BY 2 DESC;"
   # verification-shaped bash
   sqlite3 "$DB" "SELECT count(*) FROM agent_events WHERE event_type='tool_call'
     AND json_extract(payload,'$.name')='bash'
     AND (lower(json_extract(payload,'$.args.command')) LIKE '%test%'
       OR lower(json_extract(payload,'$.args.command')) LIKE '%check%'
       OR lower(json_extract(payload,'$.args.command')) LIKE '%lint%'
       OR lower(json_extract(payload,'$.args.command')) LIKE '%tsc%'
       OR json_extract(payload,'$.args.command') LIKE 'cargo %'
       OR json_extract(payload,'$.args.command') LIKE 'bun %');"
   # interleaving: verification before vs after an agent's last edit
   sqlite3 "$DB" "WITH t AS (SELECT agent_id, seq, json_extract(payload,'$.name') tool,
       lower(coalesce(json_extract(payload,'$.args.command'),'')) cmd FROM agent_events WHERE event_type='tool_call'),
     g AS (SELECT agent_id, max(seq) last_edit FROM t WHERE tool IN ('edit','write') GROUP BY agent_id)
     SELECT sum(CASE WHEN json_extract(e.payload,'$.name')='bash' AND e.seq<g.last_edit THEN 1 ELSE 0 END),
            sum(CASE WHEN json_extract(e.payload,'$.name')='bash' AND e.seq>g.last_edit THEN 1 ELSE 0 END)
     FROM agent_events e JOIN g ON g.agent_id=e.agent_id WHERE e.event_type='tool_call';"
   ```
4. **Refresh this document:** re-run steps 1–3, update the numbers and the date in the metadata block, and keep `## Sources` naming the exact database paths, sizes, and windows used. Once loop-store-format runs exist, prefer their numbers (step 2) over the telemetry heuristics and note the switch here.
