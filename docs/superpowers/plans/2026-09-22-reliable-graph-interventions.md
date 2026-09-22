# Reliable graph and interventions implementation plan

**Goal:** Finish the audit remediation with durable intervention, visible task dependencies/results, safe cleanup, and efficient parallel work; remove Jev.
**Architecture:** Preserve Rust policy and generated interfaces. Add durable execution metadata and result evidence, one execution owner, and thin OS/Pi/CLI adapters. Persist incremental projections with the event log as replay oracle.
**Tech Stack:** Rust, SQLite, Rustra, TypeScript, Bun, Pi, Herdr.
**Spec:** `docs/superpowers/specs/2026-09-22-reliable-graph-interventions-design.md`

## Global constraints

- Scope: Loop only; no credential values or real model calls in tests.
- Baseline: preserve existing dirty work; integration follows an explicit baseline comparison.
- Rust domain types first, generated protocol next; no duplicate TS domain types.
- Default output: status 8, attention 6, findings 5 lines.
- Decision and integration tasks serialized. Completion requires independent evidence.

## Execution order and ownership

- [x] 1. Add failing domain/bridge regressions for intervention invariants; implement pause/cancel requests, attention-safe resume and cancellation acknowledgement. Scope: core, bridge, tests.
- [x] 2. Add durable metadata, task outputs, guidance, evidence and rich snapshot/context contracts; test event replay. Scope: core/store/bridge; depends on 1.
- [x] 3. Make event append transactional with incremental projection caching; add run execution leases and replay/concurrent-store tests. Scope: store/bridge; depends on 2.
- [x] 4. Generate protocol and rebuild native bridge. Scope: generated files; depends on 1–3.
- [x] 5. Add execution/control regressions; implement owner loop, durable resume, cancellation/pause monitoring, contextual workers and bounded concurrent verification. Scope: orchestrator/providers/CLI; depends on 4.
- [x] 6. Fix cleanup dry-run, run refusal, canonical path and Git ownership checks with real temporary repositories. Scope: orchestrator/herdr/CLI; depends on 4.
- [x] 7. Connect graph/status/detail/attention/guidance controls in CLI and Pi; test actual registered command routes and renderers. Scope: presentation/pi-loop/CLI; depends on 5.
- [x] 8. Remove Jev and pin build inputs; add plugin checks and clean-build CI. Scope: providers/config/manifests/scripts/docs/tests; depends on 7.
- [x] 9. Run complete checks, packaged acceptance, performance measurements and review; integrate task delta without overwriting concurrent changes. Scope: integration, docs; depends on all.

Commit plan will be presented after review and verification, following repository commit requirements. No push is authorized.

## Completion evidence

Implemented and integrated into the original workspace on 2026-09-22. See `docs/reliable-runs-verification.md` for final gates, process lifecycle receipts, measurements, and the live-provider evidence boundary. Existing concurrent cleanup CLI edits remain preserved. Commit creation awaits the required user confirmation.
