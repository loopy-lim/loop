# Subprocess cleanup verification

- Task: `subprocess-cleanup-verification` (kind=verification)
- Date: 2026-07-18 (worker run)
- Scope read: `AGENTS.md`, `crates/**`, `docs/research/subprocess-cleanup.md`, `packages/**`, `tests/**`
- Scope write: this document only

## Verdict: FAIL (feature absent) — infrastructure green

`bun run check` passes end to end, but the subprocess cleanup change itself is
**not present in the tree**. The verification pipeline is green on pre-existing
behavior only; the acceptance criteria for graceful-exit cleanup, orphan
recovery, and the deterministic regression test are unmet.

## Evidence 1 — the implementation did not land

- `git log -- packages/cli packages/orchestrator` (HEAD `b2df8f7`): no commit
  touching owner-spawn cleanup, signal handling, or process-group teardown.
  Recent commits are config/routing (`gpt-5.6 퇴역`, `zai 폴백`) and a provider
  network-stall fix.
- Working tree modifications: `crates/loop-store/src/sqlite.rs`,
  `crates/loop-store/tests/recovery.rs`, docs, and
  `tests/architecture-boundaries.test.ts` (the "apps" blackband revision from
  run `loop-3e78104e`). **No** modifications under `packages/cli` or
  `packages/orchestrator`.
- `packages/orchestrator/src/cleanup.ts` is the pre-existing artifact/worktree
  retention command (`cleanupRun` → bridge `cleanupRun` planning); it contains
  no `SIGINT`/`SIGTERM`/`kill(-pgid)` logic.
- `packages/cli/src/dispatcher.ts:15` still spawns the owner with
  `detached: true, stdio: "ignore"` and no group registry or exit-handler kill.
- `packages/cli/src/main.ts:274-276` registers/unregisters `SIGTERM`/`SIGINT`
  only as `AbortController.abort()` around foreground dispatch — no child-tree
  teardown.

## Evidence 2 — per-command check results (`bun run check`, exit 0)

Pipeline: `codegen:check && typecheck && test:architecture && test`.

| Command | Result |
|---|---|
| `bun scripts/rustra-codegen.ts --check` | pass (generated files matched) |
| `bun run typecheck` | pass |
| `bun test tests/architecture-boundaries.test.ts` | pass — 6 pass / 0 fail |
| `cargo test --workspace && cargo build -p loop-bridge` | pass — all suites `0 failed` (e.g. 9, 20, 13, 15 passed; 1 ignored pre-existing) |
| `bun test packages tests plugins scripts` | pass — 342 pass / 0 fail, 1454 expect() calls, 41 files |

Full log captured at run time; summary line:
`342 pass, 0 fail, Ran 342 tests across 41 files. [13.23s]`.

## Evidence 3 — regression-test coverage gap (acceptance criteria 1, 2, 4)

Searched `tests/`, `packages/*/test/`, `packages/*/src/` for process-group /
orphan / signal teardown tests. What exists:

- `packages/cli/test/detached.test.ts` — detached owner completes after its
  observer exits; dead-owner reporting; no process-tree kill assertions.
- `packages/providers/test/lifecycle.test.ts` — `NodeProcessRunner` deadline
  and group-kill ladder for **verification commands** only (pre-existing S4
  coverage).
- `packages/herdr/src/client.ts:134-140` — `process.on("exit")` →
  `herdr workspace close` (workspace-level only, no group kill of descendants).

What does **not** exist anywhere:

- No test spawning a fake worker process tree (parent + own-group descendants),
  killing the parent, and asserting descendant termination.
- No graceful-exit (SIGINT/SIGTERM → full child-tree cleanup) test for the
  owner.
- No orphan-death (owner SIGKILL → reconcile/resume sweeps subprocess tree)
  test.

So acceptance criteria (1), (2), and (4) from the intent are **not satisfied**;
(4)'s fake-worker-tree regression test is entirely absent.

## Evidence 4 — `loop resume` background owner (acceptance criterion 3)

No behavioral regression, trivially: nothing in the resume/owner-spawn path
changed (`dispatcher.ts:15` unchanged, resume still launches a detached owner
that outlives the terminal). The intended design is preserved — but only
because the feature was not built, not because it was verified against a new
implementation.

## Required follow-up

1. Implement the cleanup per `docs/research/subprocess-cleanup.md` §2.5:
   owner-side pgid registry + synchronous `process.on("exit")` group kill,
   child-side parent-death watchdog for SIGKILL coverage, and a
   resume/reconcile orphan sweep for Loop-owned `loop-<runId>` surfaces.
2. Add the deterministic regression test: fake worker tree spawn → parent
   graceful kill and parent kill -9 → assert all descendants exit — covering
   both the graceful-exit and orphan-death paths.
3. Re-run this verification (`bun run check` + coverage confirmation) before
   declaring the milestone done.

## Unresolved risks

- Without the child-side watchdog, any owner SIGKILL/panic/network death still
  leaks herdr worker panes (model CLIs) and detached verification subtrees —
  the original defect (`loop-f3143c02`) remains reproducible.
- The green check result must not be read as feature completion: all 348 tests
  exercise pre-cleanup behavior.
