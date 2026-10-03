# Workstreams (a)(b)(c) — Final Integration Verification

- Task: `final-integration-verification` (kind=verification, attempt 1)
- Date: 2026-07-20
- Scope of this run: re-verification after `boundary-wording-fix` removed the
  forbidden "provider" wording from `crates/loop-core/src/policy/failure.rs`
  (the sole defect reported in the previous attempt). Full repo check and
  workspace cargo tests run once across all three workstream changes
  (mailbox, transport-error classification, app install).
- Write scope respected: this report only; no source changes in this attempt.
- Verdict: **PASS — all acceptance criteria and completion checks green.**

## 1. Acceptance criteria

### (a) Mid-run guidance reaches a running worker without pending/attention — **PASS**

Evidence (`bun test packages tests` — 398 pass, 0 fail, 1651 expects):

- `packages/orchestrator/test/mailbox.test.ts`
  - `guidance appended mid-run reaches a running steer-capable worker`
  - `guidance appended mid-run reaches the next attempt of a non-steer provider`
  - `guidance already covered by the start-context watermark is not re-steered`
  - `a rejected steer keeps the message pending and retries after the window`
  - `guidance batch sizing bounds one combined delivery by the byte budget`
  - `task-scoped guidance routes to its task and null guidance broadcasts`

Tap → mailbox → drain: receive via existing `GuidanceAdded`, no run-state
mutation, no attention insertion; cohesion-window batched steer for
steer-capable live workers, existing next-claim path otherwise.

### (b) Connection errors classify `Interrupted` and retry instead of terminal — **PASS**

Rust evidence (`cargo test -p loop-core transport_classification`, all green):

- `connection_error_reason_classifies_as_interrupted` (bare "Error: Connection
  error." → `Some(FailureClass::Interrupted)`)
- `transport_markers_are_case_insensitive` (markers incl. `fetch failed`,
  `ECONNRESET`, `socket hang up`, `504 Gateway Timeout`)
- `non_transport_reasons_stay_unclassified` (bare `timeout`, empty string →
  `None`, fail-closed)

Retry path evidence:

- `crates/loop-bridge/src/commands.rs:592` (worker-result failure path) and
  `:647` (verification fallback) apply `FailureClass::classify_transport`,
  replacing the previous hardcoded `Environment` classification.
- `crates/loop-core/src/event/reducer.rs:215`: `Interrupted` is
  non-deterministic → the task transitions to `Attention` (retryable) instead
  of the `Failed` terminal transition taken by `Assertion`/`InvalidContract`
  or exhausted attempts. Orchestrator tests confirm the non-terminal retry
  semantics (`persistent worker timeouts retry and promote exhausted timeout
  failures to attention`, `exhausted transient retries terminalize the task
  and run without attention`).
- `cargo test -p loop-bridge`: retry tests green
  (`exhausted_worker_failure_creates_retryable_human_attention`,
  `retry_cannot_bypass_reconciliation_for_verifying_work`,
  `retry_resolution_is_idempotent_for_ready_tasks`).

**Boundary fix verified**: `crates/loop-core/src/policy/failure.rs` doc
comments now say "remote inference link" / "connection/transport fault"; no
match for `/\bprovider\b/i` (the plural `providers` in `run/worker.rs:13` does
not match the word-boundary regex) nor `Codex|Herdr|PiRuntime|Antigravity|Z\.AI`
anywhere in `crates/loop-core/src`.

### (c) Gateway reachable on Tailscale IP + desktop artifact + simulator build — **PASS**

- Gateway service live during this verification: `launchctl list` →
  `dev.loop.gateway` running (pid 71164, exit status 0).
  `curl http://100.80.133.120:18477/v1/runs` → **401** — reachable through the
  Tailscale IP, fail-closed unauthenticated (expected without a bearer token).
  Gateway unit tests confirm bind/auth posture (`Tailscale bind validation
  (fail closed)` × 4, `bearer authentication` × 5 — all pass).
- Desktop artifact:
  `apps/loop-desktop/src-tauri/target/release/bundle/macos/Loop Desktop.app`
  exists (release bundle).
- Mobile simulator artifact:
  `apps/loop-mobile/ios/build/Build/Products/Release-iphonesimulator/LoopMobile.app`
  exists; install + launch on the booted simulator was verified live in the
  previous attempt (`simctl launch` → pid 56741). Physical-device signing
  steps are documented in `docs/research/app-device-install.md` (manual,
  requires paid account credentials — out of deterministic scope).
- Prior end-to-end smoke evidence (gateway ↔ mobile `GatewayClient` over the
  Tailscale IP, 202 submit + SSE status stream): `docs/research/app-remote-access-verification.md`.

## 2. Completion checks

| Check | Result | Evidence |
|---|---|---|
| `bun run check` | **PASS** | exit 0. `codegen:check` clean; `tsc` clean; `test:architecture` 6 pass / 0 fail; `bun run test` 398 pass / 0 fail across 47 files (1651 expects) |
| `cargo test --workspace` | **PASS** | 24 test binaries, **129 passed / 0 failed / 1 ignored** |
| `docs/findings/abc-verification.md` | **PASS** | this file, non-empty |

## 3. AGENTS.md boundary compliance

- `tests/architecture-boundaries.test.ts`: **6 pass / 0 fail**, including
  `loop-core exports only provider-neutral orchestration modules`
  (no `\bprovider\b/i`, no `Codex|Herdr|PiRuntime|Antigravity|Z\.AI` in
  loop-core sources) and the dependency-inversion tests for providers/Pi/
  SQLite/generated protocol.
- `bun run codegen:check`: clean — generated TS bindings match the Rust
  bridge types; generated files committed alongside the Rust change.
- No provider/Pi/Herdr/endpoint imports in `crates/loop-core/src`
  (`rg` sweep: comment-only mention removed this attempt; `providers` plural
  reference in `run/worker.rs` is a type-location comment and does not match
  the boundary regex).
- No paid model call was used: all evidence is deterministic unit/integration
  tests plus an unauthenticated `curl` against the already-running gateway.

## 4. Changed files across the three workstreams (this run's input, not this attempt's output)

- `crates/loop-core/src/policy/failure.rs` — transport-fault classification
  (`classify_transport`, `TRANSPORT_MARKERS`, `FailureClass::Interrupted`)
  + unit tests; wording now provider-neutral.
- `crates/loop-bridge/src/commands.rs` (+ tests) — apply the classification
  at the worker-failure and verification-fallback sites.
- `packages/orchestrator/src/*` (+ `mailbox.test.ts`) — guidance mailbox.
- `crates/loop-store/src/sqlite.rs`, `tests/recovery.rs` — durable state for
  the above.
- `apps/loop-desktop`, `apps/loop-mobile` — app surfaces (install verified;
  see §1c).

## 5. Unresolved risks

1. `FailureClass::Interrupted` maps to `TaskState::Attention` in the reducer;
   the retry is policy-driven rather than an automatic immediate re-queue.
   This matches the timeout/attention retry semantics but means "retry"
   requires the run to promote the attention back to ready. If immediate
   auto-retry is desired, that is a policy change, not a defect.
2. Physical iPhone (non-simulator) install remains manual (signing needs paid
   credentials); simulator and desktop artifacts are the deterministic scope.
3. Gateway liveness was checked via `curl` 401 during this run; an
   authenticated end-to-end submit was verified in the prior smoke run
   (`docs/research/app-remote-access-verification.md`) but not repeated here.
