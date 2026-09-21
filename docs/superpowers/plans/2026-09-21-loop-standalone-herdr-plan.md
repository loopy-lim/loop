# Loop Standalone Herdr Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Loop as a standalone, installable CLI whose durable Rust scheduler is exposed only through generated Rustra bindings, whose primary conversational UX is Pi, and whose visible worker processes are managed through Herdr rather than a Codex plugin.

**Architecture:** `loop-core` owns provider-neutral deterministic state, `loop-store` owns durable SQLite events and recovery, and `loop-bridge` exposes coarse domain commands through Rustra. A Bun composition root and CLI load configuration, call the generated Rustra host, coordinate provider adapters, and delegate visible process/workspace lifecycle to Herdr. The Pi extension is a thin lead and rendering adapter over that same composition root; no Codex MCP/plugin surface is produced.

**Tech Stack:** Rust 1.95, SQLite/rusqlite, Rustra 0.11/0.12 generated bindings, TypeScript, Bun, Herdr 0.8 CLI, Pi extension APIs.

**Spec:** `/Users/loopy/.codex/attachments/324fdc8d-2c39-4302-8b3c-dd7cdad8c288/pasted-text.txt`

## Global Constraints

- The public product is a standalone `loop` CLI, never a Codex plugin or MCP server.
- Herdr owns workspaces, tabs, panes, persistent terminals, process visibility, and attachment; Loop calls Herdr and does not reproduce it.
- Pi is the primary interactive Lead UX, while Loop owns orchestration, persistence, routing, verification, and escalation.
- `loop-core` contains no Pi, Herdr, provider, model-ID, command, endpoint, or credential concepts.
- Rust bridge types are the source of truth; generated Rustra TypeScript is the only TypeScript-to-Rust interface.
- Deterministic completion-contract checks, not worker claims or exit zero alone, transition implementation tasks to `Done`.
- Model IDs, provider commands, endpoints, and credential environment-variable names are configuration.
- Secrets never enter argv, logs, SQLite, receipts, fixtures, or generated files.
- Offline tests and fake providers never make paid model calls.
- Default status is at most eight lines, attention at most six, and findings at most five.

---

### Task 1: Remove legacy product surfaces and restore core neutrality

**Files:**
- Modify: `tests/architecture-boundaries.test.ts`
- Modify: `crates/loop-core/src/policy/routing.rs`
- Modify: `crates/loop-core/src/run/worker.rs`
- Modify: `crates/loop-core/tests/scheduler_domain.rs`
- Delete: `packages/protocol/src/client.ts`
- Delete: `crates/loop-bridge/src/bin/loop-bridge.rs`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: current task, scheduler, and generated Rustra types.
- Produces: provider-neutral `ModelCandidate` and `WorkerRecord`; protocol exports generated commands/host only.

- [x] Add architecture tests that reject provider fields in `loop-core`, manual TypeScript bridge clients, JSON bridge binaries, and Codex plugin/MCP manifests.
- [x] Run `bun test tests/architecture-boundaries.test.ts` and confirm the new assertions fail on the legacy files and fields.
- [x] Replace provider-bearing core records with opaque candidate/worker identifiers and deterministic capability data.
- [x] Remove the manual protocol client and JSON bridge binary; export generated Rustra modules from `@loop/protocol`.
- [x] Run focused Rust and Bun architecture tests until green.
- [x] Prepare a commit boundary; do not commit without explicit user confirmation.

### Task 2: Make generated Rustra the sole orchestration seam

**Files:**
- Modify: `crates/loop-bridge/src/commands.rs`
- Modify: `crates/loop-bridge/src/events.rs`
- Modify: `crates/loop-bridge/tests/commands.rs`
- Modify: `packages/protocol/package.json`
- Create: `packages/protocol/test/generated-runtime.test.ts`
- Regenerate: `packages/protocol/src/generated/**`

**Interfaces:**
- Consumes: Rust domain commands such as `create_run`, `submit_plan`, `claim_runnable_tasks`, `record_worker_result`, `record_verification`, and `get_snapshot`.
- Produces: generated positional command functions, typed events, Bun FFI host, contract hash, and frame codecs.

- [x] Write a Bun integration test that imports `generated/bun.ts`, creates a temporary database, creates a run, submits a plan, and reads the snapshot.
- [x] Run the test against an intentionally stale/missing generated surface and observe the expected failure.
- [x] Convert bridge string enums that cross the seam to Rust enums/newtypes so generated TypeScript produces literal unions.
- [x] Run `bun run codegen`, then make the generated host test pass without a hand-written DTO or command-name map.
- [x] Add contract-drift and generated-file checks to `bun run check`.
- [x] Prepare a commit boundary; do not commit without explicit user confirmation.

### Task 3: Load typed runtime configuration and deterministic policy

**Files:**
- Create: `packages/orchestrator/src/config.ts`
- Create: `packages/orchestrator/src/model-registry.ts`
- Create: `packages/orchestrator/test/config.test.ts`
- Modify: `config/models.toml`
- Modify: `config/policy.toml`
- Modify: `config/providers.example.toml`
- Modify: `packages/orchestrator/src/index.ts`

**Interfaces:**
- Consumes: TOML files and environment-variable names.
- Produces: `LoopConfig`, provider construction data, model profiles, parallelism limits, confidence thresholds, and database path.

- [x] Write failing tests for default-path resolution, explicit config override, unknown compute class, duplicate model ID, invalid concurrency, absent credential-variable name, and secret-value rejection.
- [x] Implement one strict loader using Bun TOML parsing and explicit validation errors.
- [x] Map provider/model configuration into TypeScript adapters while passing only provider-neutral candidate data into Rust.
- [x] Prove no production model ID or endpoint literal exists outside config/adapter construction.
- [x] Prepare a commit boundary; do not commit without explicit user confirmation.

### Task 4: Enforce completion contracts and recoverable orchestration

**Files:**
- Replace: `packages/orchestrator/src/coordinator.ts`
- Create: `packages/orchestrator/src/completion.ts`
- Create: `packages/orchestrator/src/recovery.ts`
- Create: `packages/orchestrator/src/runtime.ts`
- Replace: `packages/orchestrator/test/milestone.test.ts`

**Interfaces:**
- Consumes: generated Rustra commands, `AgentProvider`, `LoopConfig`, and completion-contract checks.
- Produces: `LoopRuntime.start`, `resume`, `cancel`, `snapshot`, and `subscribe`.

- [x] Write failing fake-provider tests for dependency order, bounded concurrency, write-scope serialization, worker exit-zero with failed verification, retry/escalation, cancellation, and restart reconciliation.
- [x] Implement completion checks as explicit argv arrays executed without a shell, with cwd and timeout bounds.
- [x] Record worker output separately from verification results and transition to `Done` only after every required check passes.
- [x] Reattach/reconcile persisted workers on startup; create attention for lost or ambiguous workers.
- [x] Keep provider streams normalized and persist only semantic lifecycle events.
- [x] Prepare a commit boundary; do not commit without explicit user confirmation.

### Task 5: Add the standalone Loop CLI and composition root

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/src/main.ts`
- Create: `packages/cli/src/commands/run.ts`
- Create: `packages/cli/src/commands/status.ts`
- Create: `packages/cli/src/commands/doctor.ts`
- Create: `packages/cli/src/commands/cancel.ts`
- Create: `packages/cli/src/commands/resume.ts`
- Create: `packages/cli/src/format.ts`
- Create: `packages/cli/test/cli.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: `LoopRuntime`, config loader, generated Rustra host, and provider/Herdr adapters.
- Produces: executable `loop` with `run`, `status`, `graph`, `workers`, `attention`, `models`, `cancel`, `resume`, and `doctor` commands.

- [x] Write failing black-box CLI tests for help, invalid invocation, config errors, compact status, JSON mode, and stable exit codes.
- [x] Implement a thin parser and composition root without introducing a CLI framework unless tests demonstrate a need.
- [x] Make `loop run <intent>` create or resume durable state and print at most eight default lines.
- [x] Add `bun run build:cli` using `bun build --compile` and verify the built executable outside the repository cwd.
- [x] Prepare a commit boundary; do not commit without explicit user confirmation.

### Task 6: Use Herdr as the visible worker/process substrate

**Files:**
- Replace: `packages/herdr/src/client.ts`
- Modify: `packages/herdr/src/worker.ts`
- Modify: `packages/herdr/src/worktree.ts`
- Replace: `packages/herdr/test/lifecycle.test.ts`
- Create: `packages/herdr/test/fixtures/fake-herdr.ts`

**Interfaces:**
- Consumes: Herdr 0.8 JSON CLI commands and opaque workspace/tab/pane/agent IDs.
- Produces: `HerdrWorkerRuntime.start`, `attach`, `status`, `read`, `cancel`, and `cleanup`.

- [x] Write failing tests for JSON ID parsing, current-pane targeting, no-focus splits, agent lifecycle mapping, process loss, cancellation, and stderr JSON failures.
- [x] Use `herdr agent` for recognized coding agents and `herdr pane` only for ordinary commands or unsupported interactive workers.
- [x] Persist only opaque Herdr identifiers required for reattachment.
- [x] Reject operation outside a known project/workspace scope and never rely on UI focus.
- [x] Add a read-only doctor check against the installed Herdr CLI without creating panes.
- [x] Prepare a commit boundary; do not commit without explicit user confirmation.

### Task 7: Rebuild provider adapters behind one contract

**Files:**
- Replace: `packages/providers/src/types.ts`
- Replace: `packages/providers/src/process-provider.ts`
- Replace: `packages/providers/src/codex/adapter.ts`
- Replace: `packages/providers/src/antigravity/adapter.ts`
- Replace: `packages/providers/src/zai/cli.ts`
- Replace: `packages/providers/src/zai/api.ts`
- Modify: `packages/providers/src/jev/client.ts`
- Replace: `packages/providers/test/adapters-v2.test.ts`

**Interfaces:**
- Consumes: provider construction config, process runner, fetch adapter, and optional Herdr worker runtime.
- Produces: `AgentProvider.capabilities/start/resume/cancel/status/result/subscribe` with normalized events and terminal results.

- [x] Write failing contract tests shared by fake, Codex, AGY, Z.AI CLI/API, and Herdr-interactive adapters.
- [x] Parse each provider's real machine-readable event envelope, including nested final-message events.
- [x] Make command construction version/capability-aware and test the installed Codex and AGY argument forms without paid calls.
- [x] Keep keys in environment/provider-native auth only; redact stderr and structured errors.
- [x] Make unavailable/auth/quota/cancel/timeout/incomplete-output distinct failure classes for deterministic escalation.
- [x] Prepare a commit boundary; do not commit without explicit user confirmation.

### Task 8: Make Pi the primary Lead UX

**Files:**
- Replace: `packages/pi-loop/src/extension.ts`
- Replace: `packages/pi-loop/src/lead/coordinator.ts`
- Create: `packages/pi-loop/src/commands/run.ts`
- Create: `packages/pi-loop/src/commands/cancel.ts`
- Modify: `packages/pi-loop/src/ui/*.ts`
- Replace: `packages/pi-loop/test/ui.test.ts`
- Create: `packages/pi-loop/test/lead.test.ts`

**Interfaces:**
- Consumes: `LoopRuntime` and compact snapshots/events.
- Produces: natural-language Lead dispatch plus `/loop status|graph|workers|attention|models|cancel|resume` commands.

- [x] Write failing tests for natural-language run submission, DAG validation errors, compact progress, material attention only, cancellation, and final summary budgets.
- [x] Keep decomposition/reduction prompts small and require structured task/edge output.
- [x] Route all deterministic decisions to Rust and reserve Lead calls for intent, decomposition, material decisions, and compact reduction.
- [x] Subscribe to Rustra events instead of polling where the generated host supports it.
- [x] Prepare a commit boundary; do not commit without explicit user confirmation.

### Task 9: Package, verify, and install the standalone product

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/model-routing.md`
- Modify: `docs/provider-support.md`
- Modify: `.gitignore`
- Create: `scripts/install-local.sh`
- Modify: `package.json`

**Interfaces:**
- Consumes: compiled Loop CLI and generated Rust bridge artifact.
- Produces: local installation under `~/.local/bin/loop`, Pi integration instructions, and reproducible acceptance receipts.

- [x] Add offline acceptance that runs the fake-provider milestone through the compiled CLI from a temporary project.
- [x] Run `bun run check`, Rust tests, generated drift checks, architecture tests, CLI black-box tests, and secret scans.
- [x] Verify `loop doctor` discovers Rustra, Herdr, Pi, Codex, AGY, and optional Z.AI without making model calls.
- [x] Install the compiled CLI only after all offline gates pass; verify a fresh shell resolves the same executable.
- [ ] Run real-provider smoke checks only with explicit egress/quota approval and report them separately from offline acceptance.
- [ ] Present the scoped commit plan and ask before creating commits.
