# Run Visibility Mechanism

- **Date:** 2026-09-22
- **Status:** decided
- **Kind:** decision
- **Read scope:** `packages/cli/src/main.ts`
- **Write scope:** This decision record (for now). Implementation will modify `packages/cli/src/main.ts` and `packages/cli/test/cli.test.ts`.

## Decision

The `loop watch [run-id]` and `loop status [run-id]` commands will be the primary mechanisms for live run and task visibility in the CLI.

1. **CLI Surface**: `loop watch [run-id] [--json]` and `loop status [run-id] [--json]`
   If `<run-id>` is omitted, both commands will automatically select the most recent run from the database (via `protocol.listRuns`). If no runs exist, they gracefully print `No runs` and exit 0.
2. **Refresh Mechanism**: For `loop watch`, on each snapshot update the CLI emits the ANSI clear screen sequence (`\x1b[2J\x1b[H`) before printing the formatted snapshot.
3. **Output Format**: The output reuses the existing `renderStatus` logic (which formats the snapshot using `formatSnapshot("status", ...)`), guaranteeing the output fits within the strict 8-line `statusLineLimit` budget defined in `ui-output-limits.md`.

## Justification

This approach fulfills the requirements without violating architectural boundaries or UX budgets:
- **Line limits**: Because `renderStatus` respects the 8-line `ui-output-limits.md` budget (default status 8 lines, attention 6, findings 5), clearing the screen and re-printing is completely safe. It creates a stable, flicker-free dashboard without scrollback bloat and fits in any terminal window.
- **Boundaries**: This is implemented purely as a presentation-tier refresh loop in `packages/cli/src/main.ts`. It reuses the SQLite persisted snapshot `observeRun` function and `protocol.listRuns`. It introduces no new `loop-core` tracking states or provider/model leakage.
- **Discoverability**: Modifying `watch` and `status` to implicitly track the most recent run removes the friction of finding the `run-id` first.

## Smoke Check

```bash
bun run build:cli && ./dist/loop status
```
