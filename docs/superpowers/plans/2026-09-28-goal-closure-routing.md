# Goal Closure and Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Loop's goal completion, worker choice, and failed-check repair explicit and verifiable.

**Architecture:** Rust core owns criterion and routing policy. Bridge types expose the policy and durable store state to the TypeScript orchestrator and Pi Lead. Providers optionally continue a worker conversation for one focused repair.

**Tech Stack:** Rust, rustra bridge, TypeScript, Bun, SQLite event store.

**Spec:** `docs/decisions/2026-09-28-goal-closure-and-routing.md`

## Global Constraints

- Preserve the existing dirty worktree and do not commit or publish unrelated changes.
- Keep provider names, endpoints, model IDs, and credentials out of `loop-core`.
- Change Rust bridge types before `bun run codegen`; keep generated protocol in sync.
- Keep unit and milestone tests free of paid model calls.

---

### Task 1: Durable goal criteria and closure

**Files:** Modify `crates/loop-core/src/event/event.rs`, `crates/loop-core/src/event/reducer.rs`, `crates/loop-bridge/src/execution.rs`, `crates/loop-bridge/src/commands.rs`; test Rust core and bridge.

**Interfaces:** Produce a declared criterion event, checked goal status, and generated snapshot output. A criterion references a task ID and check IDs.

- [x] Add failing core tests for missing coverage, passed checks, and completion gating.
- [x] Implement criterion projection and closure policy in Rust.
- [x] Add bridge preparation and snapshot fields; test invalid references and persisted readback.
- [x] Run focused Rust tests and `bun run codegen`.

### Task 2: Real task routing

**Files:** Modify `packages/providers/src/registry.ts`, `packages/orchestrator/src/coordinator.ts`, bridge task metadata and Pi task input; test provider selection and fallback.

**Interfaces:** Consume task risk, capabilities, and compute range; return the selected provider with a visible reason.

- [x] Add tests for high-risk floors, capability requirements, and no sufficient provider.
- [x] Thread generated task route constraints through coordinator and registry.
- [x] Persist the route reason in worker activity; run focused tests.

### Task 3: Bounded same-session check repair

**Files:** Modify `packages/providers/src/types.ts`, `packages/providers/src/herdr-agent.ts`, `packages/orchestrator/src/task-execution.ts`; test fake and Herdr providers.

**Interfaces:** An optional provider repair operation continues an existing conversation after an unsuccessful completion check. It returns another worker result while Loop keeps the same durable reservation.

- [x] Add fake-provider and Herdr-runner tests for one repair on the same handle; retain the provider-without-repair fallback test.
- [x] Implement repair on a supported provider and rerun checks before worker cleanup.
- [x] Verify cancellation, failure receipts, and bounded fallback.

### Task 4: Lead goal ledger and end-to-end proof

**Files:** Modify `packages/pi-loop/src/extension.ts`, `packages/pi-loop/src/lead/prompts.ts`, `packages/cli/src/main.ts`, generated protocol, focused tests and findings.

**Interfaces:** Lead submits explicit criteria, displays criterion status, and reports incomplete goals honestly.

- [x] Add Pi, CLI, and bridge tests for tracked submission, mid-run correction, and final summary.
- [x] Implement the submission and display flow, including a legacy untracked indicator.
- [x] Run `bun run check`, packaged offline acceptance, and an authenticated single-task smoke; record limits in `docs/findings/2026-09-28-goal-closure-routing-results.md`.
