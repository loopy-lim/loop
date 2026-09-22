# Reliable graph execution and human intervention

Status: implementation authorized by the user's approval of the five-point audit on 2026-09-22, including graph visibility, intervention, parallel performance, and Jev removal.

## Scope and invariants

Read/write scope: Loop only: `crates`, `packages`, `plugins`, `tests`, `scripts`, `config`, manifests, generated protocol, and directly related docs. Preserve the pre-existing worktree changes; implement in an isolated copy and integrate only this task's delta. No real provider calls, credential changes, installation, push, or publication.

Dependencies: Rust domain and store changes precede bridge/code generation; orchestrator and UI consume generated contracts; integration and verification are serialized.

The existing core/store/bridge/protocol/orchestrator/adapter boundaries remain. Rust owns readiness, completion, intervention, cleanup policy and state transitions. Adapters observe the OS and execute effects. No hand-written TypeScript domain copies.

## Execution and intervention

A durable run stores its original intent, working directory, task graph, successful task outputs, verification receipts, and subsequent user guidance. Pause stops new claims and drains in-flight work. Cancel first requests cancellation, then the execution owner stops and awaits workers, and only then records cancelled. Resume loads the existing graph without creating a new run. Open attention blocks claims even after resume; resolving one attention does not resolve others. Completed/cancelled runs cannot be accidentally resurrected.

One dispatcher owns each run using a durable lease. Recovery observes saved worker identities; unknown live work never silently duplicates. CLI controls and Pi commands share the same durable command path. User guidance applies to subsequent dispatches and is visible in status; already running work is not silently restarted. Lost workers require explicit reconciliation/retry.

## Graph, context, and results

Snapshots expose dependency edges, scopes, stage, attempts, failure reasons, successful results, open attention details, and the next available action. Compact views keep 8 status / 6 attention / 5 findings lines; explicit detail and JSON views expose the full graph and receipts.

Each worker receives the intent, own task contract/scopes, completed direct-dependency outputs and prior failure, plus user guidance. Only relevant dependency outputs are included. Verification outputs are bounded and redacted before persistence. Workers' success does not bypass independent completion checks.

Independent tasks execute up to configured capacity, respecting read/write conflicts and serialized decision/integration nodes. Worker startup and completion checks must not serially stall all unrelated work. Snapshot projections are persisted incrementally in the same transaction as events; replay remains the recovery oracle.

## Cleanup

Dry-run performs no external effect. Active, paused, cancelling and attention runs cannot lose resources. A refusal blocks that run's teardown/purge. Only registered Git worktrees proven clean and merged may be removed; unknown facts refuse removal. Canonical paths cannot escape the project or equal its root. Run records are purged only after successful external cleanup. Caller-owned surfaces remain protected.

## Reproducibility

Remove Jev from live code, exports, config, tests and active documentation. Pin Rustra inputs so a clean clone uses reproducible dependencies. Include plugin tests, fake-provider process-control acceptance and packaged acceptance in automated verification. Real-provider checks remain separate and opt-in.

## Completion contract

`bun run check` passes, including regression tests for dry-run/no-effect, cancelled workers, approval gating, repeated resume without duplicate execution, dependency result propagation, pause/steer/resume, graph/action visibility and bounded parallel scheduling. Build CLI and verify packaged fake-provider acceptance. Measure representative sequential/parallel runs and projection reads; report observed results without claiming real-model speed or quality from fakes. Review final changes and preserve unrelated concurrent edits on integration.

## Clarification: separation includes observer disconnection

The user confirmed both independent parallel task performance and execution surviving UI closure matter. A detached execution owner owns the lease and worker lifecycle. CLI/Pi are observers and durable command senders; disconnecting an observer does not cancel the run. Reopening discovers persisted runs and attaches a fresh observer. Explicit cancel waits for workers and verification to stop. An owner crash is distinct: uncertain external workers require explicit stopped reconciliation before retry, never duplicate dispatch by assumption.
