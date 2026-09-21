# Architecture

Reader: contributors deciding where a change belongs.

```text
┌────────────┐       ┌────────────┐
│  loop CLI  │──────▶│   Herdr    │ owns workspace, panes, processes
└─────┬──────┘       └─────┬──────┘
      │                    ▼
      │              ┌────────────┐
      │              │  Pi Lead   │ intent, DAG tool, compact status
      │              └─────┬──────┘
      │ private CLI request│
      ▼                    ▼
┌──────────────────────────────┐
│ TS orchestrator + adapters   │──────▶ Herdr worker agents / API workers
└─────┬────────────────────────┘
      │ generated Rustra only
      ▼
┌──────────────────┐
│  Rustra bridge   │  domain commands, event cursor
└─────┬────────────┘
      ▼
┌──────────────────┐
│   SQLite store   │  append events, indexes, recovery
└─────┬────────────┘
      ▼
┌──────────────────┐
│ loop-core        │  graph, policy, state machine
└──────────────────┘
```

| Layer | Owns | Must not own |
| --- | --- | --- |
| Core | task/DAG invariants, readiness, conflicts, capacity, compute classes, transitions | providers, commands, UI, SQLite |
| Store | schema, ordered events, materialized indexes, worker reconciliation | provider calls, scheduling policy |
| Bridge | high-level Rustra operations and validation at the process boundary | database CRUD API, model-specific behavior |
| Protocol | generated Rustra types/commands and Bun native host | parallel domain definitions or manual bridge clients |
| Orchestrator | dispatch/cancel/result loop using `AgentProvider` | duplicated scheduler rules |
| Adapters | provider CLI/API normalization, Herdr calls, redaction | cross-provider scheduling or terminal ownership |
| Pi | decomposition, `loop_run`, compact human interaction | direct SQLite/native-library access |

## Lifecycle

```text
Pending → Ready → Running → Verifying → Done
                     │            │
                     ├────────────┴→ Ready + higher compute
                     ├→ Attention
                     ├→ Failed
                     └→ Cancelled
```

`Done` requires completion-contract evidence. `RunCompleted` is rejected while any task is not done.

## Scheduling

1. Validate all dependencies and reject cycles.
2. Select pending/ready tasks whose dependencies are done.
3. Pause when the run has open attention.
4. Enforce total and frontier capacity.
5. Serialize decision/integration nodes.
6. Reject concurrent overlapping write scopes.
7. Return task IDs in deterministic order.

## Durable recovery

```text
SQLite events → replay projection → observe live workers
                                  ├─ live      → Running
                                  ├─ exited    → CompletedNeedsResult
                                  └─ missing   → Lost + Attention
```

The event log is authoritative. Tables for runs, tasks, workers, decisions, and attention are query indexes, not a second state machine. Loop stores only opaque Herdr worker identifiers; Herdr remains the source of terminal/process liveness.
