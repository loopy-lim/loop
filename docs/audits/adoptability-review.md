# Adoptability Review

## Verdict
**yes-with-friction**
A new user can install and use Loop today, but they will likely encounter friction related to environment setup and implicit CLI behaviors.

## Install Findings
1. **Missing environment enforcement (Bun)**
   Bun version (pinned bun@1.4.1) is not enforced during install or runtime, leading to potential silent failures.
   - Evidence: [package.json](../../package.json) line 4 defines `"packageManager": "bun@1.4.1"`, but lacks an `"engines"` block to enforce it. [scripts/install-local.sh](../../scripts/install-local.sh) lines 11-12 invokes `bun run check` and `bun run build:cli` without validating the Bun version.
2. **Rust Toolchain Enforcement**
   Rust 1.88+ requirement is documented but not actively validated during initial setup.
   - Evidence: [README.md](../../README.md) line 35 documents "Prerequisites: Rust 1.88+". [scripts/install-local.sh](../../scripts/install-local.sh) lines 1-12 fails to actively check `cargo --version` before initiating the build process.

## Usage Findings
1. **Implicit Workspace Behavior**
   Running `loop` (bare) opens an interactive Loop Lead but does not create or attach a Herdr workspace, which can disorient users expecting a full project context.
   - Evidence: [packages/cli/src/main.ts](../../packages/cli/src/main.ts) lines 57-64 handles the bare `loop` command by triggering `startInteractiveLead` without any workspace initialization. [README.md](../../README.md) line 53 states: "Bare `loop` opens the interactive Pi-backed Loop Lead in that same terminal; it never creates or attaches a Herdr workspace for itself."
2. **Diagnostic Obscurity**
   `loop doctor` requires the explicit `--auth` flag to check provider authentication; new users might miss this and struggle with auth issues.
   - Evidence: [packages/cli/src/main.ts](../../packages/cli/src/main.ts) lines 255-256 explicitly requires `--auth` to be parsed, and [packages/cli/src/main.ts](../../packages/cli/src/main.ts) line 702 (CLI help text) documents it as necessary to "Check native auth stores without exposing credentials". 
3. **Documentation Gaps**
   The jump from a successful quickstart to day-to-day workspace usage lacks a cohesive tutorial.
   - Evidence: [README.md](../../README.md) lines 44-51 provides raw commands for setup, but transitions abruptly to internal concepts. A listing of the [docs](../../docs/) directory shows deep technical documents (`architecture.md`, `model-routing.md`, `reliable-runs.md`) but no user-facing day-to-day workflow guide.

## Recommendations

### Quick Wins (Docs/UX)
- **`package.json`**: Add `"engines": { "bun": ">=1.4.1" }` to formally signal the Bun requirement.
- **`README.md`**: Clarify the difference between `loop` (bare) and `loop run <intent>`, specifically noting workspace behavior in a dedicated "Usage" section.
- **`packages/cli/src/main.ts`**: Suggest using `--auth` when `loop doctor` returns generic errors, or add a hint in its standard output.

### Structural Work
- **`scripts/install-local.sh`**: Implement active validation for Rust 1.88+ and Bun 1.4.1+ at the very top of the script before executing any build steps.
- **`packages/cli/src/main.ts` / `loop-core`**: Revisit the default behavior of the bare `loop` command to explicitly prompt for or establish a Herdr workspace context.
