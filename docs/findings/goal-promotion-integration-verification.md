# Goal promotion integration verification

## Checks (local, combined worktree)

- `bun run check`: exit 0; package test summary 822 pass, 0 fail. Includes Rust, TypeScript, and architecture checks through the repository script.
- `bun run codegen:check`: exit 0; generated bridge protocol matches Rust schema.
- `bun run test:architecture`: exit 0; 8 pass, 0 fail.

## End-to-end trace and remaining gap

1. Pi lead `loop_add_task` (`packages/pi-loop/src/extension.ts`) requests `backend.promoteSteer` with the user message, dependent task, and criteria. Its default backend calls `loop promote-steer <run-id> --json` with JSON on stdin.
2. Rust bridge `promote_steer` (`crates/loop-bridge/src/execution.rs`) produces core promotion events (`crates/loop-core/src/event/steer.rs`), which append goal criteria and a dependent task. Core's existing `IncompleteGoal` projection policy rejects premature completion. The orchestrator (`packages/orchestrator/src/coordinator.ts`) reads criteria at task claim rather than caching them at run start; `packages/orchestrator/test/steer-promotion.test.ts` covers the promoted criterion's check and completion.
3. `loop goal-ledger <run-id>` (`packages/cli/src/main.ts`, `packages/cli/src/goal-ledger.ts`) reads the local ledger; instructions are in `docs/local-verification.md`. Pi lead prompts require goal review before terminal reporting and a verified/unverified/follow-up report.

**Unmet criterion — default Pi lead promotion path:** `packages/cli/src/main.ts` has `goal-ledger`, `add-goal-task`, and `steer`, but no `promote-steer` command. Thus the default backend's subprocess cannot dispatch to the Rust bridge; the complete mid-run adjustment → promotion → completion gate → local ledger sequence is **not yet demonstrated end-to-end through the default CLI** despite passing checks. `add-goal-task` is not a substitute for promotion with user-message provenance. Add a CLI command that validates and forwards the bridge promotion input and returns its receipt; then run an actual local CLI-backed flow and inspect `goal-ledger` before and after verification. This change is outside this worker's `docs/findings/**` write scope.

No paid-provider or authenticated live-run check was performed. The tests establish deterministic component behavior, not a production Pi run or the final narrative quality of a live lead report.
