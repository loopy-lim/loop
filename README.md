# Loop

Loop is a standalone dependency-aware CLI for software-engineering agents. It turns a user intent into a typed task DAG, runs independent work concurrently, prevents overlapping writes, verifies completion contracts, escalates failures, and pauses only for material human attention.

Herdr owns terminals and panes. Pi owns the interactive Lead experience. Loop owns orchestration; it does not replace either tool or any model provider.

```text
Herdr → loop → Pi Lead + Loop extension
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
| `packages/providers` | Codex, Antigravity, Z.AI, Pi, and fake adapters |
| `packages/presentation` | Compact line formatting for Lead output |
| `packages/pi-loop` | Pi Lead tool/command extension and compact output |
| `packages/herdr` | Visible workspace/pane integration |
| `packages/cli` | Standalone `loop` entry point and composition root |
| `config` | Model, policy, and credential-reference examples |

## Start in under five minutes

Prerequisites: Rust 1.88+, Bun, Herdr 0.8+, and Pi. Rustra is pinned to published crates and npm packages, so a clean clone does not need a sibling checkout. No Codex plugin or MCP server is used.

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
herdr
loop
```

## Usage

Loop reports run lifecycle to Herdr. Start Herdr first (`herdr`), then run `loop` inside an existing Herdr pane or use the `Open Loop Agent` plugin action for full reporting. Loop never creates or attaches a Herdr workspace for itself; outside Herdr it prints a notice and continues to the Lead without Herdr run reporting:

`Notice: no active Herdr workspace detected; continuing without Herdr run reporting. Run 'herdr' first, or start 'loop' inside an existing Herdr pane.`

- **`loop`** (bare): Opens the interactive Pi-backed Loop Lead in the current terminal to begin a session.
- **`loop run "<intent>"`**: Opens the same Lead and immediately initializes it with the provided intent, allowing you to start a workflow in a single step.

The bundled Loop extension turns that intent into a validated DAG, invokes the private scheduler command, and reports the `loop` lifecycle to Herdr. Inside the Lead, commands like `/loop status`, `/loop graph`, `/loop workers`, `/loop attention`, `/loop models`, `/loop cancel`, and `/loop resume` remain available.

For run control — observing runs, pausing and resuming, steering tasks, and continuing after the terminal closes — see [docs/reliable-runs.md](reliable-runs.md). You can also run `loop status [run-id]` and `loop watch [run-id]` to view the current run state.

`loop doctor --auth` verifies the configured Pi Lead provider, Codex native login, and AGY native keyring through their own read-only CLI status commands. It never asks those CLIs to reveal a credential and never sends a model prompt. AGY workers remain Herdr-managed `agy` CLI processes; Loop does not store or forward an AGY key.

`loop verify-install` runs the seven-task fake-provider scenario without paid model calls. It proves three parallel research tasks, a serialized decision, two non-overlapping implementation tasks, verification, automatic fast-to-strong escalation, and cancellation.

Configuration never contains secret values. Put credentials in environment variables, the OS keychain, or provider-native authentication; `config/providers.example.toml` stores only the environment variable name.

## Invariants

- A task becomes `Done` only after every completion check passes.
- Decision and integration tasks are serialized; implementation overlaps only with disjoint write scopes.
- Business logic selects compute classes, never literal model names.
- An open attention item pauses new claims until it is resolved.
- Persisted `Running` is never trusted without live worker reconciliation.

## Cleanup and retention

Loop does not automatically purge run data or workspaces to prevent unintended data loss.
- You must explicitly run `loop cleanup` to remove terminal (completed/failed/cancelled) runs and their merged workspaces.
- By default, `loop cleanup` runs in `--dry-run` mode, printing a plan of what would be removed.
- To execute the deletion, use `loop cleanup --execute`.
- By default, it retains the most recent 10 runs (configurable via `--keep N`).
- Alternatively, you can target a specific run with `loop cleanup <run-id> --execute`.
- Active runs or runs requiring attention will never be deleted. Unmerged or dirty workspaces are also skipped and require manual attention.
- Running `loop cleanup` will also identify and purge any leaked Herdr workspaces prefixed with `loop-loop-*` left over from failed teardowns.

See `docs/architecture.md`, `docs/model-routing.md`, and `docs/provider-support.md` for the three implementation seams. For running one setup across machines — pi `models.json` custom model registration, named Lead personas, and portable config roots verified by `loop doctor` — see [docs/environment-generalization.md](docs/environment-generalization.md).

실행 관찰, 일시정지·재개, 지침 전달, 화면 종료 후 지속 실행은 [실행 제어 안내](reliable-runs.md)를 참고하세요.
