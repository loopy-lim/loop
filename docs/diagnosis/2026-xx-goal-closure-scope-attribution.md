# Goal closure blocked by out-of-scope attribution of declared-check writes

Date: 2026-xx-xx · Task: fix-verification · Scope: loop-core (policy + reducer); bridge/store recording untouched

## Symptom

Run `remove-tauri-and-evaluate` ended with every task `done` and every declared
completion check passing (exit 0, stable scoped fingerprint), yet the run could
never reach `completed`: `goal_criteria_status` kept the goal criteria `pending`,
so `RunCompleted` projected `ProjectionError::IncompleteGoal` and the run parked
blocked. The local store queried for this diagnosis (`mytest.db`) holds no
events from that run, so the trace below is code-level evidence.

## Root Cause

**The blocking predicate conflates "the worker wrote outside its declared
write scope" with "any path outside the declared write scope changed while the
worker ran."** A declared check's own side effects are indistinguishable from
worker edits in the current attribution, so `cargo test`/`bun test` writing
`target/…`, refreshing caches, or emitting generated files that are not
git-ignored keeps criteria pending forever.

Trace of where `source.observed_outside_write_scope` is populated and consumed:

1. **Observed paths are captured by the orchestrator.**
   `packages/orchestrator/src/task-execution.ts:186-188` snapshots git-visible
   files at worker start and again at check start
   (`captureSourceState` → `git ls-files --cached --others --exclude-standard`,
   `packages/orchestrator/src/source-state.ts:16`; git-ignored output is
   excluded, generated-but-not-ignored output is not). `changedSourcePaths`
   diffs the two snapshots. This window covers the worker's whole session, and
   workers routinely run the task's own declared checks to self-verify, so
   build output produced inside that window is attributed to the worker.

2. **The bridge computes the outside-write-scope list.**
   `record_check_receipts` (`crates/loop-bridge/src/execution.rs:500-503`)
   stores, per check receipt,
   `task.ownership.observed_outside_write_scope(&source.observed_changed_paths)`
   — loop-core `WorkOwnership::observed_outside_write_scope`
   (`crates/loop-core/src/task/ownership.rs:30`) keeps every observed path not
   matched by the task's declared write scope globs (`scope_matches_path`).
   The result is persisted in `CheckReceiptsRecorded` events. The receipt type
   itself documents the limit: "Shared-tree observations cannot establish
   which actor wrote them" (`crates/loop-core/src/event/event.rs:186-190`).

3. **The reducer treats any non-empty list as blocking.**
   `RunProjection::goal_criteria_status`
   (`crates/loop-core/src/event/reducer.rs:92-115`) marks a criterion verified
   only when each declared check's receipt has exit 0, no timeout, a stable
   scoped fingerprint, **and** `observed_outside_write_scope.is_empty()`.
   `RunCompleted` rejects with `ProjectionError::IncompleteGoal`
   (`reducer.rs:420-427`), and the store's auto-complete gate applies the same
   predicate (`crates/loop-store/src/sqlite.rs:126-129`), so the run cannot
   close even with all tasks done.

## Fix (deterministic core policy, applied at projection time)

- New policy `crates/loop-core/src/policy/verification.rs`:
  `is_check_side_effect_path(path)` classifies generated tool output by full
  path segment (`target`, `node_modules`, `dist`, `build`, `out`, `coverage`,
  `.next`, `.turbo`, `__pycache__`, `.venv`, …, plus `*.tsbuildinfo`/`.pyc`
  caches). Absolute paths and `..`-escaping paths are never exempted.
- `goal_criteria_status` now blocks only on outside-scope paths that are **not**
  check side effects. Receipts examined there already belong to the criterion
  task's own declared checks, so the exemption is exactly "a declared check's
  own writes do not block its own verification"; genuine out-of-scope source
  edits still block.
- The exemption is applied at the decision point, not at recording time:
  projections replay persisted receipts, so historical runs with
  `target/…`-only outside lists are repaired by the same policy, and the
  recorded observation stays factual (bridge and store unchanged).

Trade-off: the generated-name set is a deterministic approximation of
"git-ignored paths" — core cannot consult `.gitignore`. A repository using one
of these names for real source (e.g. a `build/` source tree) could exempt a
genuine out-of-scope edit under that name. Accepted because the exemption only
applies to paths already outside the task's declared write scope and the names
are overwhelmingly tool output in practice.

## Verification

- `crates/loop-core/tests/goal_criteria.rs`:
  `declared_check_side_effect_writes_do_not_block_goal_closure` (artifact-only
  outside list → criterion Verified, `RunCompleted` projects to completed) and
  `genuine_source_edits_outside_write_scope_still_block_goal_closure`
  (source-path outside list → criterion Pending, `RunCompleted` errors
  `IncompleteGoal`).
- `cargo test -p loop-core`, `cargo test -p loop-store`, `bun run codegen:check`.
