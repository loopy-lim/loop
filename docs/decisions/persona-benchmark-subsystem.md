# Persona Benchmark Subsystem

## Types

- **`loop-core` locations**:
  - `crates/loop-core/src/benchmark/profile.rs`: Define `WorkflowProfile` enum (`PlanFirst`, `SpikeFirst`, `TddFirst`).
  - `crates/loop-core/src/benchmark/trace.rs`: Define `TraceSummary` struct (metrics like elapsed time, attempt counts, attention incidence, worker failure rates) and comparison primitives.
- **DAG Template Format**:
  - Defined as scenarios that map a `WorkflowProfile` to a specific list of `TaskSpecInput` definitions. For instance:
    - `PlanFirst`: `[Design Task] -> [Implementation Tasks]`
    - `SpikeFirst`: `[Exploratory Spike Task] -> [Cleanup/Refactor Task]`
    - `TddFirst`: `[Write Tests Task] -> [Implementation Task] (iterative)`
- **Bridge commands** (`crates/loop-bridge/src/commands.rs`):
  - Add `GetTraceInput` / `GetTraceOutput` to extract aggregated trace metrics.
  - Add `CompareTracesInput` (list of `run_id`s) / `CompareTracesOutput` (comparative metrics).
  - *Process: Edit Rust bridge types first, run `bun run codegen`, and commit generated files.*

## Data Flow

1. **Invocation**: The user invokes `loop benchmark --config bench.yaml` via the CLI.
2. **Orchestrator Adapter**: The thin TS orchestrator reads the configuration and for each iteration and profile, submits the corresponding DAG template via `submit_plan`.
3. **Execution**: The orchestrator runs the workload using standard dispatch logic.
4. **Analysis**: Once runs are complete, the CLI calls the new `compare_traces` bridge command.
5. **Storage Queries**: `loop-store` executes queries to aggregate event history. The bridge translates this into `TraceSummary` structs for the orchestrator to render as a report.

### loop-store Queries
Queries to power trace comparison and self-trace reports will live in `crates/loop-store/src/`:
- **Task Durations**: Filter `EventKind::TaskReady` to `EventKind::TaskOutputRecorded` or `EventKind::VerificationPassed`.
- **Attempt/Failure Counts**: Count `EventKind::WorkerFinished` where `success = false`, or `VerificationFailed` events per task.
- **Attention Density**: Count `EventKind::AttentionCreated` vs. `AttentionResolved` for autonomous progression metrics.

## Repeatability

- **Entry Point**: A new CLI command `loop benchmark run <config>`.
- **Config Example**:
  ```yaml
  name: "persona-benchmark-auth"
  intent: "Implement JWT validation middleware"
  profiles:
    - plan-first
    - tdd-first
    - spike-first
  iterations: 3
  ```
- **Repeat Run**: The orchestrator simply iterates over the profiles and iterations, generating a new `run_id` each time, passing them to the comparison bridge command at the end.

## Test strategy

- **Fake-Provider Only**: All tests for benchmark runs must use `FakeProvider` (in `packages/providers/src/fake.ts`) or stub adapters to avoid paid model calls.
- **Core Unit Tests**: `loop-core` tests will synthesize in-memory event sequences and assert `TraceSummary` calculations without needing database IO.
- **Bridge/Store Tests**: `loop-store` tests will verify the trace SQL queries aggregate metrics correctly. `loop-bridge` tests will ensure command serialization and boundary validation are correct.

## Open Questions

- **Where should trace aggregation run (SQLite vs Rust memory vs TS)?**
  - **Recommended default:** Run the queries inside `loop-store` using SQLite aggregations and map them into Rust `TraceSummary` primitives in `loop-core`. The TS layer should only render the final report, not perform data joins.
- **How to manage the DAG templates for profiles?**
  - **Recommended default:** Define them as JSON/YAML fixtures in the orchestrator that map intent strings to `TaskSpecInput` arrays, keeping `loop-core` ignorant of text prompt specifics.
