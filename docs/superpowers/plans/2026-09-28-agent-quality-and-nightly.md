# Agent quality and nightly continuation

## Scope

Improve the existing Loop Lead and scheduler so delegated engineering work has explicit acceptance coverage, concise scoped briefs, a downstream integration gate, and comparable agent evidence. Add a local nightly continuation that resumes only eligible, unfinished Loop runs. Preserve user-paused runs and unresolved attention. No Git dirty tree is interpreted as a new goal.

## Delivery order

1. **Explicit coverage at submission.** In `packages/pi-loop/src/extension.ts` and `lead/{decompose,prompts}.ts`, accept a plan object with generated `TaskSpecInput[]` and `GoalCriterionInput[]`. Validate that every task requirement has a criterion, every criterion names only its task's existing checks, and no implicit all-check mapping is silently created. Quick-run and correction tools supply the same explicit coverage. Test rejection before backend submission and a valid split mapping in `packages/pi-loop/test/lead.test.ts`.
2. **Scoped worker brief.** Keep the existing typed task context; order the worker prompt so scope, requirements, acceptance checks, and prior failure survive size limits. Prove by provider prompt tests that long dependency/check output cannot hide the essential contract. Do not retrieve the entire repository.
3. **Downstream integration.** Require a terminal integration task for multi-writer plans, depending on all writing tasks and carrying an executable check of the combined result. Validate this at Lead submission; retain one-task quick runs. Add a core/bridge guard if it can be enforced without breaking legacy runs. Test missing/valid integration plans and end-to-end verification.
4. **Comparable agent benchmark.** Extend the existing benchmark with a same-task, same-clean-source agent comparison: fixed checks, isolated workspaces, one provider per trial, repeated runs, and report goal pass, retries, attention, elapsed time, and source-scope violations. Unit tests use fake providers only. Paid live runs remain a separate, explicit evidence tier.
5. **Nightly continuation.** Add a one-shot CLI command plus macOS LaunchAgent wrapper. It scans the configured SQLite store and resumes only active runs with no live lease, worker, verification, or open attention; it skips paused and terminal runs. Stalled and all-done graphs receive a pass to settle or raise attention. Prevent overlapping nightly invocations and log run IDs/outcomes without credentials. Launcher failures are reported without reconciling an ambiguous owner automatically. Default schedule is 02:00 local time unless the user specifies another hour. Test the selector and command with fake protocol/owner; verify launchd plist generation and dry-run before installation.

## Verification

- Focused tests are red before implementation and green after each slice.
- `bun run codegen` after Rust bridge changes, if any.
- `bun run check` and `bun run test:packaged` at the end.
- Nightly dry-run against the configured database and `launchctl print` after installation, without dispatching a paid worker during validation.
