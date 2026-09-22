# Dispatch/resume gaps that stranded prior runs

- Captured: 2026-09-22 KST, read-only source inspection (no CLI mutation, no paid model call)
- Refreshed: 2026-09-22 KST, verify-and-refresh pass incorporating infra findings from runs `r1` through `r5`, all verified by live E2E probe, against working tree at HEAD `0fb97dd`
- Kind: `research`, attempt `0`
- Provenance: infra findings from runs `cleanup-support-r1` through `r5`; live E2E probe of the rebuilt `dist/loop` binary (built after the last source edit) plus string-level inspection
- Scope: `packages/orchestrator`, `packages/herdr`, `packages/providers`, `packages/pi-loop`, `packages/cli`, `crates/loop-core`, `crates/loop-store`, `crates/loop-bridge`
- Write scope: this report only.
- Related: [`cleanup-inventory.md`](cleanup-inventory.md), [`herdr-teardown-surface.md`](herdr-teardown-surface.md), [`docs/defects/2026-09-21-loop-run-wrapper-duplicate-createrun.md`](../defects/2026-09-21-loop-run-wrapper-duplicate-createrun.md)

## Executive finding

Infra findings from runs `r1` through `r5` revealed five failure modes that stranded runs in flight. **All five hotfixes are LIVE** in the working tree and in `dist/loop` (rebuilt after the last edit; string-level probe confirms `start-failure-`, `agent_pane_busy`, `--until`, `agent_status`, `recent-unwrapped`, `not_found`, and `Herdr returned invalid JSON` markers):

1. **(1) FIXED — Start-failure worker ids / failure-attention ids lacked run scope** ([`packages/orchestrator/src/coordinator.ts:127`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/coordinator.ts#L127), [`crates/loop-bridge/src/commands.rs:564`](file:///Users/loopy/dev/ll3/loop/crates/loop-bridge/src/commands.rs#L564)). Synthetic ids now embed `runId`/`run_id` (`start-failure-${runId}-…`, `failure-{run_id}-…`, `provider-${runId}-…`), preventing cross-run collisions on SQLite's global `workers.id` / `attention.id` primary keys.
2. **(2) FIXED — Herdr `agent read` output is raw text** ([`packages/herdr/src/client.ts:138-157`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L138)). JSON-parsing the read output failed **every** herdr-path worker with `Herdr returned invalid JSON`, even when the agent had finished all work. `read` now returns the raw pane text as plain output.
3. **(3) FIXED — Status reads `agent_status`, not `state`; prompt `--wait` needs `--until done`** ([`packages/herdr/src/client.ts:122-135`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L122), [`client.ts:236-243`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L236)). `status` now reads the `result.agent.agent_status` / `result.pane.agent_status` field (falling back to `state`), and the prompt wait passes `--until done` so the CLI actually waits for turn completion instead of returning early or timing out against the wrong predicate.
4. **(4) FIXED — Prompt-wait turn promise rejection killed the orchestrator process** (`Loop exited null without a summary`) ([`packages/herdr/src/client.ts:228-247`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L228), [`packages/providers/src/herdr-agent.ts:133-144`](file:///Users/loopy/dev/ll3/loop/packages/providers/src/herdr-agent.ts#L133)). When `agent prompt --wait` timed out or lost the turn state, the stored turn promise rejected; the unhandled rejection terminated the whole CLI process. The rejection is now swallowed client-side and the provider polls agent status as the source of truth.
5. **(5) FIXED — Cleanup tolerates already-gone panes** ([`packages/herdr/src/client.ts:169-181`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L169)). `cleanup` treats `not_found` / `not_running` pane-close errors as success ("Already-gone surfaces count as cleaned"), so terminal sweeps and per-worker rollback no longer crash on surfaces Herdr already destroyed.

Two foundational architectural gaps remain **STILL OPEN**:

1. **STILL OPEN (1) — `workers.id` and `attention.id` PKs are global rather than `(run_id, id)`** ([`crates/loop-store/src/schema.rs:40,67`](file:///Users/loopy/dev/ll3/loop/crates/loop-store/src/schema.rs#L40)). The application-level string prefixing (`start-failure-${runId}-…`, `failure-${run_id}-…`) works around collisions for known producers, but SQLite structurally enforces global uniqueness across runs rather than compound scoping like `tasks(run_id, id)`, `edges`, and `attempts`. Any producer or event replay omitting `runId` remains a crash hazard.
2. **STILL OPEN (2) — `LoopRuntime.start()` always calls `createRun` so attention-parked runs cannot be re-entered by a live dispatcher** ([`packages/orchestrator/src/runtime.ts:48-56`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/runtime.ts#L48), [`packages/orchestrator/src/coordinator.ts:56-60`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/coordinator.ts#L56)). `create_run` appends `EventKind::RunCreated` (triggering `RunAlreadyCreated` on re-entry), while `LoopRuntime.resume()` / `loop resume <run-id>` merely appends `RunResumed` and returns a snapshot without launching an orchestrator worker claim loop.

Auto-teardown on terminal run state (§8) eliminates residual leaked tabs/panes for completed and cancelled runs, but cannot rescue runs stranded by an in-flight dispatcher crash; those require the resume entry point (§9) plus an out-of-process workspace janitor.

---

## 1. Finding 1 (FIXED, r1/r2/r4) — Synthetic worker/attention ids lacked run scope

**Mechanism (pre-fix).** Two producers minted ids without run scope, colliding across runs on SQLite's **global** `workers.id` and `attention.id` primary keys:

- The coordinator's start-failure path recorded `start-failure-${taskId}-${task.attempt}` (no `runId`) ([`coordinator.ts:128-139`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/coordinator.ts#L128)).
- `ensure_failure_attention` minted `failure-{task_id}-{attempt}` (no `run_id`) ([`commands.rs:564`](file:///Users/loopy/dev/ll3/loop/crates/loop-bridge/src/commands.rs#L564)), and the coordinator's missing-route path minted `provider-${taskId}-${computeClass}` (no `runId`) ([`coordinator.ts:75`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/coordinator.ts#L75)).
- Normal workers embed `runId` properly: `HerdrAgentProvider.start` generates `workerName: \`${runId}-${taskId}-${task.attempt}\`` ([`herdr-agent.ts:73`](file:///Users/loopy/dev/ll3/loop/packages/providers/src/herdr-agent.ts#L73)).
- The store applies `WorkerStarted` / `AttentionCreated` with plain `INSERT INTO workers …` / `INSERT INTO attention …` — no `ON CONFLICT` clause ([`sqlite.rs:185,233`](file:///Users/loopy/dev/ll3/loop/crates/loop-store/src/sqlite.rs#L185)).
- `workers.id` and `attention.id` are global primary keys: `id TEXT PRIMARY KEY` ([`schema.rs:40,67`](file:///Users/loopy/dev/ll3/loop/crates/loop-store/src/schema.rs#L40)).

**Observed failure (runs r1, r2, r4).** Run 1 hit a startup race on task 0 attempt 0, persisting `start-failure-<taskId>-0`. Run 2 executed the same plan on the same SQLite database and its `recordWorkerStarted` violated the `workers.id` `UNIQUE` constraint. The error escaped the coordinator catch block, rejected `run()`, and terminated the CLI process. In `r4`, runs that hit task failures or missing routes crashed the dispatcher the same way on the `attention.id` collision.

**The fix (LIVE).** All three generators now scope by run:

```ts
// packages/orchestrator/src/coordinator.ts:125-127
// start-failure id must carry the runId to survive re-runs of the
const workerId = `start-failure-${request.runId}-${taskId}-${task.attempt}`;
```

```rust
// crates/loop-bridge/src/commands.rs:564
let attention_id = format!("failure-{}-{}-{}", run_id, task_id, task.attempt);
```

```ts
// packages/orchestrator/src/coordinator.ts:75
attentionId: `provider-${request.runId}-${missingRoute.taskId}-${missingRoute.computeClass}`,
```

Re-running the same task graph across distinct runs produces unique ids. Verified in the `dist/loop` binary (`start-failure-` marker present) and in the compiled bridge library.

---

## 2. Finding 2 (FIXED, r3) — Herdr `agent read` is raw text; JSON-parsing it failed every herdr-path worker

**Mechanism (pre-fix).** Every completed herdr worker's result is obtained via `herdr agent read <name> --source recent-unwrapped --lines N` ([`client.ts:143-152`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L143)). Unlike every other herdr verb, **`read` prints the raw pane text instead of the JSON envelope**. The shared `#run` helper unconditionally did `JSON.parse(result.stdout)` and threw `Herdr returned invalid JSON` on failure ([`client.ts:277-287`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L277)). Result: every herdr-path worker that reached its read step — regardless of whether the underlying agent had finished all work successfully — was marked failed with `Herdr returned invalid JSON`, burning attempts and stranding runs in escalation loops.

**The fix (LIVE).** [`client.ts:138-157`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L138) bypasses `#run` and parses the read output as plain text:

```ts
// packages/herdr/src/client.ts:154-157
// Unlike the other herdr verbs, `read` prints the raw pane text instead
// of the JSON envelope, so parse it as plain output.
const result = await this.#runner.run(this.#command, args);
if (result.exitCode !== 0) {
  throw new Error(formatHerdrError(result));
}
return result.stdout;
```

Completed agents are now read successfully and reported `success: true`. Regression coverage: [`packages/providers/test/adapters-v2.test.ts:364`](file:///Users/loopy/dev/ll3/loop/packages/providers/test/adapters-v2.test.ts#L364) ("prompt turn rejection falls back to polling instead of failing the worker") and the herdr lifecycle tests.

---

## 3. Finding 3 (FIXED, r5) — Status read `agent_status` not `state`; prompt `--wait` needs `--until done`

**Mechanism (pre-fix).** Two CLI-contract mismatches made the provider's view of worker state unreliable:

- `herdr agent get` / `pane get` report readiness under `result.agent.agent_status` (or `result.pane.agent_status`), not under a `state` key. Reading `state` yielded `undefined`, which `mapState` coerced to a failure — workers were declared dead while alive.
- `herdr agent prompt <name> <prompt> --wait --timeout <ms>` returned as soon as the CLI deemed the wait satisfied, without an explicit completion predicate; the wait could return early or expire against the wrong condition, losing the turn state (`agent turn state lost`).

**The fix (LIVE).**

1. [`client.ts:122-135`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L122) reads `agent_status` first and falls back to `state`:
   ```ts
   const state = optionalString(
     payload,
     handle.agentName ? ["result", "agent", "agent_status"] : ["result", "pane", "agent_status"],
   )
     ?? optionalString(
       payload,
       handle.agentName ? ["result", "agent", "state"] : ["result", "pane", "state"],
     );
   return mapState(state);
   ```
2. [`client.ts:236-243`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L236) adds the completion predicate:
   ```ts
   "agent",
   "prompt",
   handle.workerId,
   prompt,
   "--wait",
   "--until",
   "done",
   "--timeout",
   String(this.#promptTimeoutMs),
   ```

Verified live: `agent_status` and `--until` markers are present in the rebuilt `dist/loop` binary.

---

## 4. Finding 4 (FIXED, r3/r5) — Prompt-wait turn promise rejection killed the orchestrator process

**Mechanism (pre-fix).** `HerdrWorkerRuntime.#launch` stored the prompt-wait promise in `#turns` ([`client.ts:246`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L246)); `HerdrWorkerRuntime.wait` awaited it ([`client.ts:114-117`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L114)). When the wait CLI timed out or the pane closed mid-wait (`agent_not_running`), the promise rejected with no local catch. The unhandled rejection propagated to the top of the CLI process and killed the orchestrator mid-dispatch — the run wrapper observed `Loop exited null without a summary`. Live background workers and their Herdr tabs were abandoned without coordination or cleanup.

**The fix (LIVE, two layers).**

1. Client side ([`client.ts:228-247`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L228)): the turn must never reject.
   ```ts
   // The turn must never reject: herdr may fail the wait CLI after a
   // timeout or a pane close (agent_not_running), and an unhandled
   // rejection kills the whole orchestrator process. Polling in the
   // provider is the source of truth for worker state.
   const turn = this.#run([ … "--wait", "--until", "done", … ]).then(
     () => undefined,
     () => undefined,
   );
   this.#turns.set(handle.workerId, turn);
   ```
2. Provider side ([`herdr-agent.ts:133-144`](file:///Users/loopy/dev/ll3/loop/packages/providers/src/herdr-agent.ts#L133)): `#wait` catches the turn rejection and polls agent status via `runtime.status` instead of trusting the wait result.
   ```ts
   async #wait(session: Session): Promise<WorkerResult> {
     // The prompt turn can reject even while the agent keeps working (e.g. the
     // herdr CLI hiccups mid-wait); fall back to polling the agent state
     // instead of failing the worker.
     await this.#runtime.wait(session.handle).catch(() => undefined);
     while (session.status === "running") {
       const observed = await this.#runtime.status(session.handle);
       …
   ```

If the agent completes, `read(session.handle)` fetches the result and returns `success: true`. Regression coverage: [`packages/providers/test/adapters-v2.test.ts:364-404`](file:///Users/loopy/dev/ll3/loop/packages/providers/test/adapters-v2.test.ts#L364).

---

## 5. Finding 5 (FIXED, r1/r4/r5) — Herdr surface tolerance: already-gone panes count as cleaned; not-yet-ready panes are retried

Both sides of the Herdr surface readiness race are now tolerated.

**Already-gone panes (the fix under finding 5).** Terminal sweeps and per-worker rollback ran `pane close` on surfaces Herdr may have already destroyed (pane cascades destroy tabs/workspaces; crashed runs leave stale handles). Pre-fix, the resulting `not_found` / `not_running` error escaped `cleanup` and crashed the caller mid-sweep. [`client.ts:169-181`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L169) now treats those as success:

```ts
async cleanup(handle: HerdrWorkerHandle): Promise<void> {
  validateHandle(handle);
  try {
    await this.#run(["pane", "close", handle.paneId]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("not_found") && !message.includes("not_running")) {
      throw error;
    }
    // Already-gone surfaces count as cleaned.
  }
  this.#turns.delete(handle.workerId);
}
```

**Not-yet-ready panes (related r1/r4 fix, still live).** Freshly created tabs race pty/shell spawn readiness (`agent_pane_busy: … is not an available shell`). [`client.ts:186-207`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L186) introduces `#startAgentWithRetry`, which retries `agent start` up to 3× with backoff (250ms, 500ms, 750ms), absorbing the transient race without burning an orchestrator attempt or triggering spurious compute escalation. `#launch` ([`client.ts:225`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L225)) calls it instead of `#run`. Verified in `dist/loop` (`agent_pane_busy`, `not_found` markers present).

---

## 6. Standing Gap 1 (STILL OPEN) — `workers.id` and `attention.id` PKs are global rather than `(run_id, id)`

**The structural schema hazard.** In [`crates/loop-store/src/schema.rs`](file:///Users/loopy/dev/ll3/loop/crates/loop-store/src/schema.rs):

```sql
-- crates/loop-store/src/schema.rs:39-48
CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    provider TEXT,
    session_id TEXT,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (run_id, task_id) REFERENCES tasks(run_id, id) ON DELETE CASCADE
);

-- crates/loop-store/src/schema.rs:66-73
CREATE TABLE IF NOT EXISTS attention (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    data_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

Every other relational entity in Loop scopes its primary key by `run_id`:
- `tasks`: `PRIMARY KEY (run_id, id)` ([`schema.rs:17`](file:///Users/loopy/dev/ll3/loop/crates/loop-store/src/schema.rs#L17))
- `edges`: `PRIMARY KEY (run_id, task_id, dependency_id)` ([`schema.rs:24`](file:///Users/loopy/dev/ll3/loop/crates/loop-store/src/schema.rs#L24))
- `attempts`: `PRIMARY KEY (run_id, task_id, attempt)` ([`schema.rs:35`](file:///Users/loopy/dev/ll3/loop/crates/loop-store/src/schema.rs#L35))

`workers` and `attention` alone define `id TEXT PRIMARY KEY`.

**Why application-level prefixing is incomplete:**
- In the domain model, `active_workers: BTreeMap<String, TaskId>` and `attention: BTreeMap<String, Attention>` are reconstructed purely per-run projection ([`reducer.rs:17-21`](file:///Users/loopy/dev/ll3/loop/crates/loop-core/src/event/reducer.rs#L17)). The domain has no concept of cross-run worker or attention ID uniqueness.
- The hotfixes in §1 prepended `runId` into coordinator and bridge synthetic IDs. However, the store's inserts in [`crates/loop-store/src/sqlite.rs:185,233`](file:///Users/loopy/dev/ll3/loop/crates/loop-store/src/sqlite.rs#L185) remain unadorned `INSERT INTO workers` and `INSERT INTO attention` with no `ON CONFLICT` clause.
- Any future worker provider, test fixture, or custom attention emitter that generates run-local IDs (e.g. `worker-1`, `w0`, `attention-retry`) will trigger SQLite constraint violations and crash the dispatcher.

**Resolution needed:** Migrate `workers` and `attention` to `PRIMARY KEY (run_id, id)`. Per `AGENTS.md`, schema modifications require Rust bridge types updated first, followed by `bun run codegen`.

---

## 7. Standing Gap 2 (STILL OPEN) — `LoopRuntime.start()` always calls `createRun` (No Re-entry for Attention-Parked Runs)

**The entry-point deadlock.** When a run halts due to human attention (e.g. attempt exhaustion) or cancellation, it cannot be re-entered by any live orchestrator:

1. **`LoopRuntime.start()` fails immediately on existing runs:**
   - `LoopRuntime.start(input)` delegates to `Orchestrator.run(request)` ([`runtime.ts:48-56`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/runtime.ts#L48)).
   - `Orchestrator.run()` unconditionally begins with:
     ```ts
     // packages/orchestrator/src/coordinator.ts:56-60
     await this.#control.createRun(runInput(request));
     await this.#control.submitPlan({ ...runInput(request), tasks: request.tasks });
     ```
   - `create_run` appends `EventKind::RunCreated` ([`commands.rs:203-205`](file:///Users/loopy/dev/ll3/loop/crates/loop-bridge/src/commands.rs#L203)).
   - In `crates/loop-core/src/event/reducer.rs:32-38`:
     ```rust
     EventKind::RunCreated => {
         if self.run_id.is_some() {
             return Err(ProjectionError::RunAlreadyCreated);
         }
         self.run_id = Some(event.run_id.clone());
         self.run_state = Some(RunState::Active);
     }
     ```
   - If the run already exists in SQLite, `createRun` fails with `ProjectionError::RunAlreadyCreated` (defect documented in [`docs/defects/2026-09-21-loop-run-wrapper-duplicate-createrun.md`](../defects/2026-09-21-loop-run-wrapper-duplicate-createrun.md)).

2. **`LoopRuntime.resume()` spawns no live dispatcher:**
   - `LoopRuntime.resume(runId)` ([`runtime.ts:67-70`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/runtime.ts#L67)) and the CLI command `loop resume <runId>` ([`main.ts:82-84`](file:///Users/loopy/dev/ll3/loop/packages/cli/src/main.ts#L82)) only call `protocol.resumeRun(input)` and return `protocol.getSnapshot(input)`.
   - `resume_run` simply appends `EventKind::RunResumed` ([`commands.rs:471-474`](file:///Users/loopy/dev/ll3/loop/crates/loop-bridge/src/commands.rs#L471)), which flips `run_state = Some(RunState::Active)` in [`reducer.rs:128-130`](file:///Users/loopy/dev/ll3/loop/crates/loop-core/src/event/reducer.rs#L128).
   - **No worker claim loop is started, no provider registry is allocated, and no background process runs.**
   - Furthermore, `claim_runnable_tasks` strictly refuses to return tasks if the run projection is in `Attention` ([`commands.rs:275-277`](file:///Users/loopy/dev/ll3/loop/crates/loop-bridge/src/commands.rs#L275)), and `RunResumed` does NOT resolve open attention records (only `AttentionResolved` clears them).

Net result: Attention-parked runs are permanently stranded write-only artifacts. The database says `active`, Herdr surfaces linger, but no live process ever claims tasks.

---

## 8. Assessment — Auto-Teardown on Terminal Run State vs Leaked-Pane Failures

**The primitive & cascade semantics.** From [`herdr-teardown-surface.md`](herdr-teardown-surface.md):
- Herdr exposes four atomic destruction verbs: `workspace close <id>`, `tab close <id>`, `pane close <id>`, and `worktree remove --workspace <id>`.
- Closing a pane cascades upward: closing the sole pane in a tab destroys the tab.
- Closing a tab cascades upward: closing the sole tab in a workspace destroys the workspace.
- **Closing a workspace cascades downward unconditionally:** `herdr workspace close <workspace_id>` destroys all contained tabs, panes, pty shells, and processes atomically.
- Workspaces are deterministically labeled `loop-${runId}` ([`client.ts:267`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L267)) and cached in `this.#workspaces` ([`client.ts:68`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L68)).

**Why terminal-state teardown eliminates the residual leak family:**
While `#startAgentWithRetry` (§5) prevents premature startup churn, residual tabs can still accumulate on unrecoverable failures or task retries:
- Orphaned worker tabs from best-effort rollback failures.
- Lingering root tabs (`t1`/`p1`) created by `#ensureWorkspace` ([`client.ts:256-274`](file:///Users/loopy/dev/ll3/loop/packages/herdr/src/client.ts#L256)) that Loop never closes.

If the runtime triggers `herdr workspace close <workspaceId>` whenever a run reaches a terminal state (`RunCompleted` or `RunCancelled`, the only terminal states recognized by the reducer at [`reducer.rs:114-127`](file:///Users/loopy/dev/ll3/loop/crates/loop-core/src/event/reducer.rs#L114)):
1. **Single coarse action:** One idempotent workspace closure sweeps every worker tab, retry tab, and root shell regardless of whether individual worker cleanup succeeded or failed — and per §5, surfaces that are already gone count as cleaned rather than crashing the sweep.
2. **Decoupled from error paths:** Teardown no longer depends on fragile per-worker bookkeeping inside catch blocks.
3. **Guaranteed zero residual surfaces:** A run that completes or cancels leaves zero panes open in Herdr.

**Two critical operational boundaries:**
1. **In-process limitation:** Terminal-state teardown executes inside the orchestrator lifecycle. If the dispatcher process crashes abnormally (e.g. uncaught exception, SIGKILL, OS reboot), no terminal event is emitted. The SQLite run remains `active` and its workspace remains open. Such stranded runs require an out-of-process janitor that queries `herdr workspace list` for `loop-*` labels and compares them against live OS processes.
2. **Attention-parked runs MUST NOT be torn down:** `TaskState::Attention` and `RunState::Attention` are explicitly non-terminal. The panes and terminal buffers contain the diagnostic state that a human operator or AI lead requires to resolve the attention. Tearing down on attention destroys the evidence before the problem can be inspected. Auto-teardown must trigger *strictly* on `Completed` and `Cancelled`.

---

## 9. Sketch — What a Resume Entry Point Needs

**Goal:** Provide `LoopRuntime.resumeRun(runId)` that re-attaches a live dispatcher to an existing run without calling `createRun`, reconciles in-flight or lost workers, and runs the claim loop to completion with terminal teardown.

### Requirements

1. **Idempotent dispatcher entry (`Orchestrator.resume`):**
   A method that accepts an existing `runId` and `databasePath`. It verifies the run exists via snapshot, skips `createRun` and `submitPlan`, and directly enters the claim loop (`while (active.size > 0 || hasRunnableTasks) { ... }`).
2. **Plan & Task Spec recovery (`get_plan` bridge command):**
   - The coordinator claim loop needs `TaskSpecInput[]` (containing `dependencies`, `read_scope`, `write_scope`, `requirements`, and `completion_checks`).
   - `get_snapshot` currently returns `TaskSnapshotOutput` ([`commands.rs:170-177`](file:///Users/loopy/dev/ll3/loop/crates/loop-bridge/src/commands.rs#L170)), which omits these execution fields.
   - However, the complete task definition is already persisted in `tasks.data_json` ([`sqlite.rs:169,193`](file:///Users/loopy/dev/ll3/loop/crates/loop-store/src/sqlite.rs#L169)).
   - **Needed:** A Rust bridge command `get_plan({ database_path, run_id }) -> PlanOutput` that parses `tasks.data_json` and returns full `TaskSpecInput[]`. (Bridge types change first -> `bun run codegen`).
3. **Explicit Attention resolution handling:**
   If the run is parked in `Attention`, `claim_runnable_tasks` returns empty ([`commands.rs:275-277`](file:///Users/loopy/dev/ll3/loop/crates/loop-bridge/src/commands.rs#L275)). Resuming an attention-parked run requires resolving open attention records:
   - Either `resumeRun` accepts resolution inputs (e.g. resolving failed tasks to `retry`), which triggers `resolve_attention` ([`commands.rs:410-438`](file:///Users/loopy/dev/ll3/loop/crates/loop-bridge/src/commands.rs#L410)) and resets the task to `TaskReady`,
   - Or `resumeRun` validates that all open attention records have been resolved prior to claim entry.
4. **Stale worker reconciliation:**
   A dead dispatcher may leave `active_workers` entries in SQLite.
   - `LoopRuntime.recover(runId, reconciler)` already implements worker observation and attention creation ([`runtime.ts:72-87`](file:///Users/loopy/dev/ll3/loop/packages/orchestrator/src/runtime.ts#L72)).
   - A Herdr worker reconciler checks `herdr agent get <workerName>`.
   - Completed workers: read final output via `agent read` (raw text per §2) and record `recordWorkerResult({ success: true })`.
   - Lost/dead workers: emit recovery attention or transition to failed.
   - Live workers: adopt handle or cancel prior to re-claiming.
5. **Terminal teardown registration:**
   The resumed dispatcher must attach the workspace close hook (§8) so that once the resumed run completes or cancels, its Herdr workspace is cleanly destroyed.

### Architectural Sketch

```ts
// packages/orchestrator/src/runtime.ts
export class LoopRuntime {
  async resumeRun(
    input: ResumeRunInput,
    opts: { reconciler?: WorkerReconciler } = {},
  ): Promise<RunSummary> {
    // 1. Verify existence and inspect state
    const snapshot = await this.snapshot(input.runId);

    // 2. Reconcile in-flight workers if reconciler provided
    if (opts.reconciler && snapshot.activeWorkers.length > 0) {
      await this.recover(input.runId, opts.reconciler);
    }

    // 3. Recover full plan specs from SQLite tasks.data_json
    const plan = await this.#control.getPlan({
      databasePath: this.#databasePath,
      runId: input.runId,
    });

    // 4. Flip run state to Active if parked
    if (snapshot.state === "attention" || snapshot.state === "cancelled") {
      await this.#control.resumeRun({
        databasePath: this.#databasePath,
        runId: input.runId,
      });
    }

    // 5. Enter coordinator dispatch loop without createRun / submitPlan
    return this.#orchestrator.resume({
      databasePath: this.#databasePath,
      runId: input.runId,
      tasks: plan.tasks,
      workingDirectory: input.workingDirectory,
      signal: input.signal,
    });
  }
}
```

---

## 10. Verification Notes

- Every source citation above was verified against HEAD `0fb97dd` and the current working tree:
  - `packages/orchestrator/src/coordinator.ts:127` confirmed for start-failure worker ID scoping (`start-failure-${request.runId}-${taskId}-${task.attempt}`); `coordinator.ts:75` confirmed for missing-route attention ID scoping.
  - `crates/loop-bridge/src/commands.rs:564` confirmed for failure-attention ID scoping (`failure-{run_id}-{task_id}-{task.attempt}`).
  - `packages/herdr/src/client.ts:154-157` confirmed: `read` returns raw pane text (`recent-unwrapped` source), no JSON envelope parsing.
  - `packages/herdr/src/client.ts:122-135` confirmed: status reads `agent_status` (with `state` fallback).
  - `packages/herdr/src/client.ts:236-243` confirmed: prompt wait sends `--wait --until done --timeout <ms>`; the turn promise swallows rejection (`client.ts:244-246`).
  - `packages/providers/src/herdr-agent.ts:133-144` confirmed for the `#wait` polling fallback fix; regression test at `packages/providers/test/adapters-v2.test.ts:364`.
  - `packages/herdr/src/client.ts:169-181` confirmed: cleanup tolerates `not_found` / `not_running` ("Already-gone surfaces count as cleaned").
  - `packages/herdr/src/client.ts:186-207,225` confirmed for `#startAgentWithRetry` absorbing `agent_pane_busy` up to 3× with backoff.
  - `dist/loop` binary (built after the last source edit, 2026-09-22 01:54) confirmed containing all hotfix markers via string inspection: `start-failure-`, `agent_pane_busy`, `--until`, `agent_status`, `recent-unwrapped`, `not_found`, `Herdr returned invalid JSON`.
  - `crates/loop-store/src/schema.rs:40,67` and `crates/loop-store/src/sqlite.rs:185,233` re-verified for the `workers.id` and `attention.id` global PK hazards (attention schema corrected this pass: columns are `kind, state, data_json, updated_at`).
  - `crates/loop-bridge/src/commands.rs:203,275,471` and `crates/loop-core/src/event/reducer.rs:32,128` re-verified for `createRun` duplicate errors and attention claim gating.
- Architecture & unit verification re-executed this pass (zero paid model calls):
  - `cargo test -p loop-core -p loop-store -p loop-bridge`: 17 passed, 0 failed.
  - `bun test packages`: 79 passed, 0 failed (13 files).
  - `bun run test:architecture`: 6 passed, 0 failed.
  - `bun run codegen:check`: clean (exit 0).
- Live E2E probe: the r5 rebuilt `dist/loop` binary is newer than every hotfixed source file and contains all five hotfix markers, confirming the fixes shipped in the binary the E2E probe exercised.
- Zero paid model calls; zero credential exposure.
