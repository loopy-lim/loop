# Loop

Loop is a standalone dependency-aware CLI for software-engineering agents. It turns a user intent into a typed task DAG, runs independent work concurrently, prevents overlapping writes, verifies completion contracts, escalates failures, and pauses only for material human attention.

Herdr owns terminals and panes. Pi owns the interactive Lead experience. Loop owns orchestration; it does not replace either tool or any model provider.

```text
loop run "intent" → Herdr → Pi Lead + Loop extension
                              │ private loop CLI request
                              ▼
                    TypeScript orchestrator
                       │             │
             generated Rustra     Herdr workers
                       ▼
             Rust bridge → SQLite → provider-neutral core
```

## Repository map

| Path | Responsibility |
| --- | --- |
| `crates/loop-core` | DAG, task state, scheduling, ownership, routing primitives, attention, events |
| `crates/loop-store` | SQLite event persistence and restart reconciliation |
| `crates/loop-bridge` | High-level Rustra commands and generated contract source |
| `packages/protocol` | Generated Rustra TypeScript contract and Bun host |
| `packages/orchestrator` | Thin worker lifecycle coordinator |
| `packages/providers` | Codex, Antigravity, Z.AI, Jev, and fake adapters |
| `packages/herdr` | Visible workspace/pane integration |
| `packages/pi-loop` | Pi Lead tool/command extension and compact output |
| `packages/cli` | Standalone `loop` entry point and composition root |
| `config` | Model, policy, and credential-reference examples |

## Start in under five minutes

Prerequisites: current stable Rust, Bun, Herdr 0.8+, Pi, and the sibling `../rustra-bridge` checkout. No Codex plugin or MCP server is used.

```bash
bun install
bun run check
bun run build:cli
./dist/loop verify-install
```

Install after those checks pass:

```bash
./scripts/install-local.sh
loop doctor --auth
loop
```

Bare `loop` creates a Herdr workspace and opens an idle Pi Lead without sending a model request. `loop run "Implement feature X"` opens the same Lead with an initial intent. The installed Pi extension turns that intent into a validated DAG and invokes the standalone Loop executable. `/loop status`, `/loop graph`, `/loop workers`, `/loop attention`, `/loop models`, `/loop cancel`, and `/loop resume` remain available inside Pi.

`loop doctor --auth` verifies the configured Pi Lead provider, Codex native login, and AGY native keyring through their own read-only CLI status commands. It never asks those CLIs to reveal a credential and never sends a model prompt. AGY workers remain Herdr-managed `agy` CLI processes; Loop does not store or forward an AGY key.

`loop verify-install` runs the seven-task fake-provider scenario without paid model calls. It proves three parallel research tasks, a serialized decision, two non-overlapping implementation tasks, verification, automatic fast-to-strong escalation, and cancellation.

Configuration never contains secret values. Put credentials in environment variables, the OS keychain, or provider-native authentication; `config/providers.example.toml` stores only the environment variable name.

## Invariants

- A task becomes `Done` only after every completion check passes.
- Decision and integration tasks are serialized; implementation overlaps only with disjoint write scopes.
- Business logic selects compute classes, never literal model names.
- An open attention item pauses new claims until it is resolved.
- Persisted `Running` is never trusted without live worker reconciliation.

See `docs/architecture.md`, `docs/model-routing.md`, and `docs/provider-support.md` for the three implementation seams.
