# Integration notes — desktop removal verification (task: integrate)

Date: run after `remove-desktop` (Tauri desktop app removal; apps/loop-mobile is now the only app surface).

## Scope

- Read: apps/loop-mobile, crates, packages, tests, bunfig.toml, package.json
- Write: this file only

## Check suite result

`bun run check` (= codegen:check && typecheck && test:architecture && test):

| Stage | Command | Outcome |
|---|---|---|
| 1 | `bun run codegen:check` | PASS (exit 0, generated protocol in sync) |
| 2 | `bun run typecheck` (`tsc -p tsconfig.json`) | PASS (exit 0) |
| 3 | `bun run test:architecture` | PASS (8 tests, 0 fail) |
| 4 | `bun run test` (`cargo test --workspace` + `cargo build -p loop-bridge` + `bun test packages tests scripts/rustra-codegen.test.ts`) | PASS (782 bun tests across 92 files, 0 fail, 4628 expect() calls; cargo workspace tests green — required as the first stage of `test`) |

No dangling references to `apps/loop-desktop` remain in workspace globs, tsconfig
includes, or architecture-boundary tests. The architecture boundary suite now
asserts `apps/loop-mobile` as the single app entry.

## Residual comments mentioning "desktop" (non-blocking, documentation-only)

The removal worker's own scan found remaining prose mentions of the desktop app
in comments/docstrings. Verified they are historical/contextual, not live
references:

- `apps/loop-mobile/test/design-spec.test.ts:5-6` — comment explaining that the
  desktop parity checks were removed with the retired desktop app. Intentional.
- `packages/cli/src/qr.ts:5,11` — comment noting the desktop app carried a copy
  of the QR encoder. Now historical; the CLI's own encoder stands alone.
- `packages/cli/test/pairing.test.ts:5` — comment referencing the former desktop
  pairing surface. Test logic itself is desktop-independent.

None of these affect compilation, tests, or architecture boundaries. Recorded as
cosmetic findings; no files outside the declared write scope were modified.

## Changed files by this task

- `.loop/integration-notes.md` (this file)

## Unresolved risks

- None blocking. Cosmetic comment cleanups in `packages/cli/src/qr.ts`,
  `packages/cli/test/pairing.test.ts` remain for a future touch-up commit if
  desired (out of this task's write scope).
