# Parallel Dispatch Diagnosis — why only one agent runs at a time

Scope: dispatch loop, provider selection, config defaults. Evidence gathered from
`packages/orchestrator/src/coordinator.ts`, `crates/loop-bridge/src/commands.rs`,
`crates/loop-core/src/scheduler/*`, `packages/cli/src/main.ts`,
`packages/pi-loop/src/lead/*`, and the live config at `~/.config/loop/policy.toml`
(`max_parallel = 3`, `max_frontier_workers = 1`).

## Data Flow

1. CLI `__dispatch` / `__execute-plan` (`packages/cli/src/main.ts` ~:394) builds
   `LoopRuntime` with `maxWorkers = config.scheduler.maxWorkers` and
   `maxFrontierWorkers = config.scheduler.maxFrontierWorkers`; the live policy
   resolves these to 3 and 1, so config wiring does allow >1 worker.
2. `Orchestrator#execute` (`packages/orchestrator/src/coordinator.ts`) takes one
   per-run execution lease, then loops: `claimRunnableTasks({ runningTaskIds,
   maxWorkers, maxFrontierWorkers })` → starts one `TaskExecution` per claimed
   task → races `delay(50)` against worker completion. No mailbox, polling, or
   provider step in this loop caps concurrency.
3. Bridge `claim_runnable_tasks` (`crates/loop-bridge/src/commands.rs` :563)
   unions store-side Running|Verifying tasks with the coordinator's reported
   running ids and calls `Scheduler::claim_runnable(graph, running)` with
   `Capacity(max_workers, max_frontier_workers)`.
4. `Scheduler::claim_runnable` (`crates/loop-core/src/scheduler/scheduler.rs`)
   walks tasks that are Pending|Ready with all dependencies done and rejects
   claims on three gates: serial kind, scope conflict, frontier cap.
5. Provider selection (`packages/providers/src/registry.ts` `selectForTask`)
   is stateless per task; adapters (pi interactive → `HerdrAgentProvider`,
   antigravity persistent → `AgyPersistentProvider`, headless `PiProvider`)
   spawn one process/tab per workerId with no concurrency cap. The graph itself
   is fixed at submission: the Lead validates and submits the whole DAG at once
   (`packages/pi-loop/src/lead/decompose.ts`).

## Root Cause(s)

1. Serial-kind world stop: `claim_runnable` returns zero claims whenever ANY
   running task is Decision or Integration (`scheduler.rs` :22-24), and serial
   tasks are only claimed when nothing else is running or claimed (:39-43).
   Decision-heavy plans therefore execute one task at a time by construction.
2. Hard-coded empty-prefix exclusivity: `normalized_prefix`
   (`crates/loop-core/src/scheduler/conflicts.rs`) treats any scope element
   whose non-glob prefix is empty (`**`, `*.ts`) as overlapping EVERYTHING, and
   `tasks_conflict` serializes read∩write overlap. A research task with
   `readScope: ["**"]` serializes against every sibling writer; broad LLM
   readScopes are the common case.
3. Empty write scope = conflict with everything: `tasks_conflict`
   (`scheduler.rs` :55-58) makes any Decision|Implementation|Integration task
   with an empty `writeScope` conflict with every other task. Decision tasks
   routinely get no writeScope from the Lead, forcing full serialization.
4. Linear graph shape: only simultaneously-ready tasks can fan out
   (`graph.dependencies_done`). The decomposition prompt encourages frontiers
   (`packages/pi-loop/src/lead/prompts.ts` :52-54) but `decompose.ts` validates
   only acyclicity and the integration gate — nothing checks that supposedly
   parallel siblings are actually conflict-free, so serial plans pass silently.
5. Frontier lane cap: `max_frontier_workers = 1` in `~/.config/loop/policy.toml`
   allows one Frontier-class worker. Not binding today (no frontier-class model
   in `models.toml`) but a latent single-lane gate.

Note: `decision_parallelism`, `integration_parallelism`, and
`unknown_write_scope_is_exclusive` in `policy.toml` are dead keys — never
parsed (`config.ts` reads only `max_parallel` / `max_frontier_workers`) and
never consumed in Rust. The exclusivity they imply is hard-coded in
`normalized_prefix` instead, so operators tune knobs that do nothing.

Explicitly ruled out: execution lease (per-run, not per-worker),
`GuidanceMailbox` (read-only tap, drains at boundaries), 50 ms polling race,
provider selection (no shared slot, no quota-group exclusivity on first
selection), orchestrator↔CLI wiring (3 > 1).

## Recommended Changes

1. `crates/loop-core/src/scheduler/scheduler.rs` `claim_runnable`: drop the
   world-stop at :22-24 so non-serial, non-conflicting siblings can run
   alongside a Decision/Integration task; keep :39-43 (a serial task is never
   *claimed* while others run) so serial kinds still run alone among themselves.
2. `crates/loop-core/src/scheduler/scheduler.rs` `tasks_conflict`: stop making
   empty `writeScope` a universal conflict — reject empty scopes at submission
   instead (next item), or serialize only against actual overlap.
3. `packages/pi-loop/src/lead/decompose.ts` `validateDecomposition`: reject
   scope-requiring tasks with empty `writeScope` and top-level-glob-only scopes
   (`**`, `*`) at plan submission, where the Lead can immediately re-plan.
4. `crates/loop-core/src/scheduler/{scheduler.rs,mod.rs}`: return a skipped
   reason per task (serial-held, scope-overlap-with X, frontier-full) so the
   coordinator can record "task b waiting: write scope overlaps a" in activity
   instead of leaving concurrency limits invisible.
5. `config/policy.toml` + `packages/orchestrator/src/config.ts`: either
   implement `decision_parallelism` / `integration_parallelism` /
   `unknown_write_scope_is_exclusive` (parse → `ClaimRunnableTasksInput` →
   `Capacity`, then `bun run codegen`) or delete the keys from the example and
   live policy files so the config no longer implies nonexistent tuning.

## Test Plan

- `cargo test -p loop-core` (scheduler): serial task running + non-conflicting
  non-serial sibling → sibling still claimed; empty-prefix scope overlap;
  empty-write-scope behavior after change; frontier cap unchanged.
- `cargo test -p loop-bridge` (`tests/commands.rs`): claim with mixed
  decision+implementation frontier returns both after change 1.
- `bun test packages` (orchestrator `runtime.test.ts`): parallel-frontier plan
  reaches `FakeProvider.maxConcurrent >= 2`; decision-gated plan still orders
  decision before dependents.
- `bun run codegen:check` only if protocol inputs change (change 5 path).
- Full gate: `bun run check`.
