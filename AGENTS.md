# Working on Loop

Keep Loop boring, typed, and graph-first.

## Boundaries

```text
loop-core → loop-store → loop-bridge → generated protocol → orchestrator → adapters/UI
```

- Never import provider, Pi, Herdr, model, or endpoint concepts into `loop-core`.
- Put deterministic policy in Rust. Keep TypeScript adapters thin.
- Change Rust bridge types first, run `bun run codegen`, and commit the generated files with the Rust change.
- Do not hand-write a TypeScript copy of a Rust domain type.
- Put model IDs and provider endpoints only in configuration or adapter construction.
- Do not persist or log credentials.

## Task behavior

- Declare dependencies and read/write scopes explicitly.
- Serialize decision and integration nodes.
- Require a non-empty completion contract; worker success is not verification.
- Use attention only for material questions, decisions, approvals, conflicts, or exhausted failures.
- Keep default status at eight lines, attention at six, and findings at five.

## Loop orchestration checks (always on)

- At every turn in this conversation, check `loop_status` first and report run state, attention items, and any unverified criteria before other work.
- On receiving any worker or run result, re-verify before accepting: inspect the task's durable detail (`loop_task`) and correction/delivery/check stages (`loop_guidance`), plus the final source and focused check evidence for the changed criterion.
- Never accept a delivery from the worker's success response alone; report guidance recorded, worker delivered, and checks passed as separate facts.
- When the run appears stalled, identify which input is missing (attention answer, unmet gate, lost binding) instead of guessing.
- On check failure or exhausted attempts, resolve autonomously without asking the user: re-diagnose from the check artifact, then retry or append a corrective task (with completion checks covering both the fix and the previously broken gate) via loop_resolve add_task. Do this whenever the fix is mechanical, within the original goal's scope, or caused by baseline debt.
- Escalate to the user via attention only for material decisions: scope or acceptance changes, conflicts with other in-flight work, product trade-offs, or credentials/provider access.

## Verification

Run `bun run check`. For focused work, use:

```bash
cargo test -p loop-core
cargo test -p loop-store
cargo test -p loop-bridge
bun test packages
bun run codegen:check
bun run test:architecture
```

Real-provider or authenticated CLI checks are separate evidence. Unit and milestone tests must never require a paid model call.
