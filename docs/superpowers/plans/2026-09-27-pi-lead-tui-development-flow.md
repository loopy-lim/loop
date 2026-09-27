# Pi Lead TUI Development Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Herdr 안의 한 Pi Lead 대화에서 실행 접수, 관찰, 자연어 중간 조정, 작업 추가, 완료 확인을 처리한다.

**Architecture:** Rust core/store/bridge owns state and atomic graph validation; CLI exposes JSON commands and confirmed owner handoff; Pi extension binds a run to a session and displays read-only progress. Existing orchestrator mailbox and Herdr worker tab lifecycle remain the delivery path.

**Tech Stack:** Rust, rusqlite, Rustra-generated TypeScript protocol, Bun CLI/tests, Node-targeted Pi extension, Herdr.

**Spec:** `docs/superpowers/specs/2026-09-27-pi-lead-tui-development-flow-design.md`

## Global Constraints

- Respect `loop-core → loop-store → loop-bridge → generated protocol → orchestrator → adapters/UI`.
- Rust owns deterministic state and graph policy; TypeScript adapters stay thin.
- Preserve the current dirty checkout; commit only owned changes and do not push.
- No paid model calls in unit or milestone tests. Run `bun run check` before completion.

---

## Baseline and boundaries

- [x] Record four offline fixture categories and currently observable timing fields in `docs/findings/pi-lead-tui-development-flow-verification.md`: bounded edit, Rust→codegen→TS, independent tasks, and midrun correction. Do not infer unavailable first-edit/token metrics.
- [x] Keep the checkout on `pi-lead-tui`; do not stage unrelated dirty files, push, call a paid model, or modify worker tab ownership.

## Task 1: Atomic task insertion

**Files:** `crates/loop-core/src/event/reducer.rs`, `crates/loop-core/tests/*`, `crates/loop-store/src/sqlite.rs`, `crates/loop-store/tests/*`, `crates/loop-bridge/src/commands.rs`, `crates/loop-bridge/tests/commands.rs`.

- [x] Add a failing core test: `TaskCreated` rejects pausing and cancelling but accepts active, paused, attention.
- [x] Add a failing store test: latest projection and full graph are checked inside one SQLite immediate transaction, including unknown dependencies and cancellation race. The inserted task must have explicit scopes and nonempty completion checks.
- [x] Implement store `append_task` under one write transaction. Reuse the event/projection/index/cache sequence path and notify after commit. Keep generated `TaskSpecInput` as the only TS task type.
- [x] Run focused Rust tests.

## Task 2: CLI owner handoff and task command

**Files:** `packages/cli/src/dispatcher.ts`, `packages/cli/src/main.ts`, `packages/cli/test/detached.test.ts`, relevant CLI tests.

- [x] Add failing tests for lease belonging to child PID, fast terminal, missing/dead owner, timeout, and a JSON add-task request through the actual CLI/protocol boundary.
- [x] Implement bounded handoff polling after detached `launchOwner`, with saved run ID and state in errors. Only print accepted JSON after lease or terminal evidence.
- [x] Add `add-task <run-id> --json` reading a generated `TaskSpecInput` JSON payload from stdin; bridge enforces graph/state contract.
- [x] Run CLI focused tests and Node bundle check.

## Task 3: Pi Lead execution and natural-language tools

**Files:** `packages/pi-loop/src/extension.ts`, `packages/pi-loop/src/lead/prompts.ts`, `packages/pi-loop/test/lead.test.ts`.

- [x] Change tests first so `loop_run` returns after confirmed handoff and can take a subsequent turn while owner runs. Test failure does not bind a run.
- [x] Use `__execute-plan --json --detach`, parse one accepted JSON response, and expose status, steer, add-task, resolve attention, pause, resume, cancel as Pi model tools. Preserve original user correction text in steering; require explicit target/answer where ambiguous.
- [x] Make the Lead prompt branch on current run: operate on current run for status/correction/control, and submit a new DAG only for a new engineering goal. Keep `/loop` for compatibility but remove it as the required next action.
- [x] Run Pi extension tests and type checks.

## Task 4: Session binding and observer

**Files:** `packages/pi-loop/src/extension.ts`, new small binding/observer module if it materially reduces coupling, `packages/pi-loop/test/lead.test.ts` and focused tests.

- [x] Add focused tests for Pi session entry restoration on start/tree, canonical cwd check, exactly-one active-run auto attach, multi-run ambiguity, duplicate sequence suppression, attention/terminal transcript entry, observer restart after pause/resolve, and observer cleanup without owner cancel.
- [x] Persist only run ID and canonical working directory via Pi session entry; reconstruct from current branch. Use read-only snapshots with bounded polling and no model call. Update status/footer and add durable attention/final entries within output limits.
- [x] Run Pi tests, including a fake CLI process proving an early second user turn.

## Task 5: Persona install and verification

**Files:** `scripts/install-local.sh`, `tests/install-local.test.ts`, verification finding.

- [x] Add a behavioral script test in a disposable config path. Verify missing personas/defaults are copied and existing files survive rerun; verify `LOOP_CONFIG_DIR` override.
- [x] Install missing defaults/personas without clobbering user files.
- [x] Run `bun run codegen` only if Rust bridge type shape changed, always `bun run codegen:check`, focused tests, and `bun run check`.
- [x] Build/install CLI and Pi Node bundle, compare installed hashes, and perform no-cost installed TUI acceptance where possible. Keep authenticated provider execution as separate evidence.
- [x] Review requirements against the design, perform an independent final review, record test/build/install limits, and commit only owned changes.
