# Loop Herdr-Hosted Agent Implementation Plan

> **Note:** This file was reconstructed on 2026-09-21 after an accidental deletion during a reverted refactor. Task checkboxes were cleared because the authoritative completion evidence lives in the git history and session logs, not in checkbox state.

**Goal:** Make `loop` a Pi-backed interactive coding-agent CLI that runs inside an already-open Herdr pane and appears in Herdr as the `loop` agent, while Herdr remains the sole owner of workspaces, panes, persistence, and attachment.

**Architecture:** Bare `loop` launches Pi in the current terminal with extension discovery disabled and the adjacent bundled Loop extension explicitly loaded. The Loop extension reports `idle`, `working`, and release lifecycle events to the current Herdr pane through the documented `HERDR_*` environment contract. A local Herdr plugin adds an "Open Loop Agent" pane entrypoint without teaching Loop to launch or attach Herdr itself; worker orchestration continues to use the existing Herdr adapter.

**Tech Stack:** TypeScript, Bun compiled CLI, Pi extension API, Herdr 0.8 custom agent reporting and plugin panes, Rust/Rustra orchestration core.

**Spec:** `/Users/loopy/.codex/attachments/324fdc8d-2c39-4302-8b3c-dd7cdad8c288/pasted-text.txt`

## Global Constraints

- Herdr starts first and owns workspaces, panes, terminal persistence, focus, and human attachment.
- `loop` must never create a Herdr workspace or attach a Herdr agent for its own Lead session.
- Pi remains the Lead engine; Loop is not a second terminal multiplexer or a replacement chat runtime.
- The Loop extension is loaded exactly once with `pi --no-extensions --extension <adjacent bundle>`.
- The Loop agent must still work outside Herdr; lifecycle reporting becomes a no-op when `HERDR_ENV`, `HERDR_PANE_ID`, or `HERDR_BIN_PATH` is absent.
- Worker execution may continue to use Herdr through `@loop/herdr`.
- Credentials remain in provider-native stores or environment variables and are never logged or persisted by Loop.
- Existing offline checks must not make paid model calls.

---

### Task 1: Invert the Loop CLI entrypoint

**Files:**
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `[lead]` configuration with Pi command, provider, and model; adjacent `loop-pi-extension.js`.
- Produces: `buildInteractiveLeadInvocation(config, environment, executablePath)` and bare `loop`/`loop run <intent>` interactive execution in the current terminal.

Steps: replace launcher tests with current-pane invocation tests; implement the current-pane Pi launcher (no shell, inherited stdio, adjacent-bundle resolution with repo `dist` fallback); update help and README ownership language; run the complete CLI test file.

### Task 2: Report Loop lifecycle from the Pi Lead extension

**Files:**
- Create: `packages/pi-loop/src/herdr-lifecycle.ts`
- Create: `packages/pi-loop/test/herdr-lifecycle.test.ts`
- Modify: `packages/pi-loop/src/extension.ts`
- Modify: `packages/pi-loop/src/index.ts`

**Interfaces:**
- Consumes: `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_BIN_PATH`, and Pi `session_start`, `agent_start`, `agent_end`, and `session_shutdown` events.
- Produces: `HerdrLifecycleReporter` using argv-only `pane report-agent` and `pane release-agent` calls with source `loop:lead` and agent label `loop`.

Steps: contract tests (no calls outside Herdr, monotonic sequence, idle/working/release, argv-only); implement the reporter with non-fatal failures and redacted diagnostics; register on Pi lifecycle events.

### Task 3: Add the Herdr-hosted Loop Agent plugin

**Files:**
- Create: `plugins/loop-agent/herdr-plugin.toml`
- Create: `plugins/loop-agent/package.json`
- Create: `plugins/loop-agent/src/open.ts`
- Create: `plugins/loop-agent/test/open.test.ts`
- Modify: `tests/architecture-boundaries.test.ts`

**Interfaces:**
- Consumes: Herdr plugin action contract with `contexts = ["workspace"]`.
- Produces: `Open Loop Agent` action running argv-only `herdr pane run --pane <current> loop`; plugin pane `placement = "tab"`.

Steps: plugin invocation tests; implement manifest and action; add architecture assertions for host ownership (Lead never creates workspaces or attaches agents).

### Task 4: Package, migrate, install, and verify

**Files:**
- Modify: `scripts/install-local.sh`
- Modify: `tests/install-local.test.ts`
- Modify: `packages/pi-loop/src/extension.ts`

Steps: installation assertions; self-contained Pi extension bundle; run all offline verification; build and install; verify installed boundaries without a model call; perform the visible Herdr acceptance (human-only); present the scoped commit plan before committing.
