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
