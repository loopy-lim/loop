# Status trust diagnosis

## Persistence and projection path

- Worker lifecycle events are applied to SQLite projections in `crates/loop-store/src/sqlite.rs`: `WorkerStarted` sets the task to `running`, inserts a worker row as `running`, and marks its attempt running (lines 540–565). `WorkerFinished` / `WorkerFailed` change task and worker states (567–583).
- Task activity events are explicitly ignored by the SQLite materialized-table handler (`sqlite.rs:517`), but the event-backed projection rebuilds task activity history; the bridge copies that history into `TaskSnapshotOutput.activities` (`crates/loop-bridge/src/commands.rs:1573–1578`). Orchestrator records activity on route/fallback events (`packages/orchestrator/src/coordinator.ts:415–419`, 441–448); this is descriptive activity, not a durable timestamp field.
- Snapshot output includes task state/activity and active worker IDs, and open attention IDs/items (`commands.rs:320–335`). Attention output contains ID, kind, summary and task ID only (`commands.rs:347` onward; mapping at 1538–1547). There is no progress timestamp or attention-created timestamp in the snapshot.
- Presentation `workingLine` treats every task whose projected state is `running` as working and takes its latest activity string (`packages/presentation/src/working.ts:37–49`). It has no freshness test. Attention rendering prints open count/items and resolution command, with no age (`packages/presentation/src/snapshot.ts:121–150`).

## Exact false-running path

A worker is durably marked running at its `WorkerStarted` event. If its process dies/hangs without producing `WorkerFinished`, `WorkerFailed`, or a reconciliation event, no transition clears the task/worker running state. `snapshot()` projects the task state as-is (`commands.rs:1552–1558`) and active workers from `projection.active_workers` (`1598–1605`). The presentation then labels that task “Working” solely because `state === "running"` (`working.ts:37–44`). Thus an orphaned worker continues to look healthy; execution leases/owner health do not constitute worker progress and the status line does not consult them.

## Signals absent / attention duration

No last-progress/activity timestamp is persisted or surfaced. Activity is a sequence of text records, without event time in `TaskSnapshotOutput`, and the SQLite activity handler performs no timestamp update (`sqlite.rs:517`). Worker `updated_at` is touched on completion/failure only (`sqlite.rs:570`, `580`), not on progress; start inserts no updated time (`543`). Run `updated_at` changes with run-state updates (`sqlite.rs:754–762`), not each activity. Attention insertion stores state/data only (`sqlite.rs:594–600`); resolution updates `updated_at` (`602–607`), while open attention has no created/age field exposed. Consequently neither dead-worker staleness nor attention wait duration can be computed reliably by current status consumers.

## Design implication

Add a persisted per-task (or worker) last-progress instant updated when progress/activity is recorded, expose it in Rust bridge snapshot types/codegen, and have status compare its age to policy before claiming active progress. Track attention creation time and expose age (or calculate from persisted creation time). Keep policy in Rust per project boundaries; presentation should format supplied status, not infer liveness from text/activity count.
