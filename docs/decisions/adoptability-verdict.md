# Adoptability Verdict

## Verdict
**yes-with-friction**
A new user can install and use Loop today, but they will likely encounter friction related to environment setup and implicit CLI behaviors.

## Top 5 Adoption Issues (Ranked by Impact)
1. **Missing environment enforcement:** Bun version (pinned bun@1.4.1) is not enforced during install or runtime, leading to potential silent failures.
2. **Implicit Workspace Behavior:** Running `loop` (bare) opens an interactive Loop Lead but does not create or attach a Herdr workspace, which can disorient users expecting a full project context.
3. **Rust Toolchain Enforcement:** Rust 1.88+ requirement is documented but not actively validated during initial setup.
4. **Diagnostic Obscurity:** `loop doctor` requires the explicit `--auth` flag to check provider authentication; new users might miss this and struggle with auth issues.
5. **Documentation Gaps:** The jump from a successful quickstart to day-to-day workspace usage lacks a cohesive tutorial.

## Recommendations

### Quick Wins (Docs/UX)
- **`package.json`:** Add `"engines": { "bun": ">=1.4.1" }` to formally signal the Bun requirement.
- **`README.md`:** Clarify the difference between `loop` (bare) and `loop run <intent>`, specifically noting workspace behavior.
- **`src/main.ts`:** Suggest using `--auth` when `loop doctor` returns generic errors or add a hint in its standard output.

### Structural Work
- **`scripts/install-local.sh`:** Implement active validation for Rust 1.88+ and Bun 1.4.1+ during the install script.
- **`src/main.ts` / `loop-core`:** Revisit the default behavior of the bare `loop` command to explicitly prompt for or establish a Herdr workspace context.

## Mandated Report Outline
The subsequent report task MUST use the following exact outline with these headings:
- Verdict
- Install Findings
- Usage Findings
- Recommendations
