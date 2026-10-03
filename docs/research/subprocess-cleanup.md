# Subprocess cleanup: Claude Code mechanisms and Loop leak inventory

Research for the orphan-subprocess defect: when the Loop owner dies unexpectedly
(e.g. run `loop-f3143c02`, "Execution owner is not responding" → orphan workers),
the subprocesses workers launched (bun, cargo, model CLIs) survive and leak.

Two parts:

1. How Claude Code (`~/.local/bin/claude`, v2.1.263, Bun-compiled Mach-O with
   embedded JS chunks) cleans up child processes.
2. Loop's full spawn tree and cleanup behavior with `file:line` evidence, plus
   which Claude Code mechanisms are portable.

Method note: the Claude binary embeds Bun runtime strings (signal tables, `--no-orphans`
help text, libuv constants) that are **not** Claude Code application code; only
strings from the app chunks (`/$bunfs/root/chunk-*.js`, minified) are cited as
Claude Code behavior.

---

## Part 1 — Claude Code subprocess cleanup mechanisms

### 1.1 Detached spawn with own process group as the default for tool children

Claude Code spawns long-lived / timeout-prone children with `detached: true`
(each child becomes its own process group), then kills the **whole group**:

- Hook execution (app chunk, PreToolUse/device hooks):
  `spawn(..., { stdio:["pipe","pipe","pipe"], detached:!0, windowsHide:!0 })`;
  on timeout or abort the kill is `process.kill(-child.pid, "SIGKILL")` with a
  fallback to `child.kill("SIGKILL")` when the group kill throws.
- Sandbox/subprocess runner (agent child processes):
  `detached: P()!=="windows"`, a `We` closure doing
  `process.kill(-child.pid, "SIGKILL")`, a Windows `taskkill /T /F` path, and —
  critically — **`process.on("exit", We)`**: the group kill is registered as a
  synchronous `exit` handler, so even `process.exit()` from an arbitrary code
  path tears the group down.

### 1.2 Synchronous `exit`-handler kills (graceful-degradation layer)

The `process.on("exit", We)` pattern above is the portable core: Node/Bun run
`exit` handlers synchronously on any normal exit (including after a
SIGTERM/SIGINT handler calls `process.exit`), so a tracked `kill(-pgid, SIGKILL)`
there covers crashes-as-exceptions and ordinary termination. It does **not**
cover SIGKILL of the parent — that is what 1.4 and 1.5 are for.

Loop already has one instance of this pattern: `HerdrWorkerRuntime` registers
`process.on("exit", ...)` to `herdr workspace close` its owned workspaces
(`packages/herdr/src/client.ts:134-140`).

### 1.3 Escalation ladders: SIGTERM → wait → SIGKILL, per surface

- Post-session hooks (self-hosted runner): timeout → `SIGTERM to the hook's
  process group (pgid=…)`, "still running after SIGTERM" → `SIGKILL to the
  hook's process group`. They also handle the detached-spawn pitfall
  explicitly: "resolved without 'close' (grandchild likely holding stdio pipes;
  ignored)" — i.e. they detect grandchildren holding the stdio pipes open and
  don't treat the parent's exit as completion.
- MCP server processes: `Sending SIGINT to MCP server process` →
  `SIGINT failed, sending SIGTERM` → `SIGTERM failed, sending SIGKILL`, each
  step error-guarded, ending in "Cleanup timeout reached, stopping process
  monitoring".
- Background jobs: SIGTERM to matched pids, poll liveness ~3 s, SIGTERM again,
  poll 500 ms, then a **group** kill `process.kill(-pid, "SIGKILL")` with a
  plain-pid fallback; kill confirmation distinguishes zombie vs live via
  recorded `procStart` (start-time comparison defeats pid reuse).

### 1.4 Parent-death watchdog inside the child (pty host)

The `--bg-pty-host` helper is the strongest mechanism, designed exactly for
Loop's failure mode (parent dies without any signal):

- At startup it pins `O = process.ppid`.
- A 2 s interval checks: if `process.ppid === O` (parent alive) or clients are
  connected, reset; otherwise count up; after ~30 misses (60 s) it logs
  "orphan watchdog: ppid X→Y, no client for Nms", kills its child
  (`SIGTERM`, `SIGKILL` 5 s later), and exits.

This makes the *grandchild* responsible for noticing its owner is gone —
no signal to the parent is needed.

### 1.5 Group-level signal fan-out on shutdown

- The pty host forwards `SIGTERM`/`SIGINT`/`SIGHUP` (and `SIGQUIT`) to the
  child, and on child-exit raises `process.kill(-process.pid, "SIGHUP")` to
  flush its own group of leftovers.
- Bridges log and shut down on SIGINT/SIGTERM/SIGHUP
  ("[bridge:shutdown] SIGINT received, shutting down").
- The self-hosted runner on SIGTERM/SIGINT does a **drain wait**
  (`--drain-wait-sec`: wait for each session's in-flight turn and background
  tasks) before SIGTERM-ing session processes, plus
  `--session-stop-grace-sec` before force-killing.

### 1.6 Runtime-level orphan prevention (Bun `--no-orphans`)

The embedded Bun runtime offers `--no-orphans`: "Exit when the parent process
dies, and on exit kill every descendant" (`BUN_FEATURE_FLAG_NO_ORPHANS`).
Claude Code runs on Bun, so this is available as a blanket child-side safety
net for any child it spawns with `bun`.

### 1.7 Orphan *detection* and reaping on restart

- On resume after an abnormal exit, sessions surface
  "background shell command(s) orphaned by previous process exit"
  (`orphaned_on_resume`) instead of silently losing them.
- On agent exit: `killShellTasksForAgent: killing orphaned shell task …
  (agent … exiting)`.
- Background workers are tracked with pid + procStart so a *later* cleanup can
  confirm whether a recorded worker is zombie/live before group-killing it.

### 1.8 Deliberate exceptions

Interactive editors are spawned `detached:!0, stdio:"ignore"` + `unref()`
(so the editor intentionally survives CLI exit). Not a leak pattern — an
explicit ownership carve-out.

### Portability summary

| Mechanism | Portable to Loop | Where it lands |
|---|---|---|
| Own process group + `kill(-pgid)` with TERM→KILL escalation | Yes (already used in one place) | all Loop spawns |
| `process.on("exit")` synchronous group kill | Yes (already used in one place) | owner + any process holding children |
| Child-side parent-death watchdog (ppid check) | Yes — covers SIGKILL/crash of owner | worker-side wrapper or herdr pane host |
| Escalation ladder with liveness polling | Yes | herdr cancel path |
| pid + procStart (pid-reuse-safe) confirmation | Nice-to-have | reconcile/verification |
| Bun `--no-orphans` for bun-spawned children | Yes, cheap | owner/worker spawn args |
| Orphan sweep on startup/resume | Yes (partially exists) | resume/reconcile path |

---

## Part 2 — Loop spawn tree and cleanup inventory

### 2.1 Spawn points (file:line evidence)

| # | Spawn | Location | detached? | Group kill? |
|---|---|---|---|---|
| S1 | Owner (detached background process) | `packages/cli/src/dispatcher.ts:20` | **yes** (`detached: true, stdio:"ignore"`) + `unref()` | no — nobody ever kills the owner's group |
| S2 | Interactive lead (`pi` TUI) | `packages/cli/src/main.ts:562-575` (`runInteractiveLead`) | no | no — relies on terminal group for Ctrl+C |
| S3 | Doctor/probe/herdr CLI calls | `packages/cli/src/main.ts:759-767` (`probeCommand`); `packages/herdr/src/client.ts:78-90` (`NodeHerdrRunner`) | no | no — `child.kill()` direct child only, TERM→KILL after 1 s |
| S4 | Verification / completion-check commands | `packages/providers/src/process.ts:81-85` (`detached: platform!=="win32"`), group kill at `process.ts:180-186` (`signal()` → `process.kill(-groupPid)`), `waitForGroupExit` + SIGKILL at `process.ts:187-206` | yes | **yes** — TERM → poll group → KILL (best-in-tree) |
| S5 | Herdr worker panes (model CLIs) | `packages/herdr/src/client.ts:103-155` (`tab create` + agent launch via the `herdr` CLI) | herdr-owned terminal sessions | via `herdr tab close` / `agent send-keys ctrl+c` (`client.ts:417-444`) |
| S6 | Steer relay | `packages/cli/src/main.ts:903-910` (`steerRelayCommandBuilder`) hosted via `herdr pane run` (`client.ts:270-275`) | pane-hosted | pane lifetime = relay lifetime |
| S7 | Per-run Herdr workspace teardown | `packages/herdr/src/client.ts:134-140` (`process.on("exit")` → `spawnSync herdr workspace close`) | — | exit-event only |

Rust bridge: `crates/loop-bridge/src/` contains **no process management**
(no `kill`/`signal`/`process_group` symbols); execution state only
(`execution.rs`, `commands.rs`). Per the AGENTS.md boundary
(`loop-core → loop-store → loop-bridge → … → adapters/UI`), deterministic
teardown policy in Rust would be possible later, but all current OS effects
live in the TS layers; that is where the fix belongs.

### 2.2 Graceful exit (SIGINT/SIGTERM to the owner)

- Owner: `packages/cli/src/main.ts:225-231` — `__dispatch` registers
  `SIGTERM`/`SIGINT` → `AbortController.abort()` → `runtime.execute(runId, signal)`.
- Scheduler: `packages/orchestrator/src/coordinator.ts:169-180` — on
  `cancelling`, every active `TaskExecution.abort()` is called and awaited.
- Per task: `packages/orchestrator/src/task-execution.ts:75-81` — abort makes
  `untilAborted` return → `provider.cancel(handle.id)` → herdr `ctrl+c` +
  grace poll + `tab close` (`client.ts:417-444`); verification commands get
  the group-kill ladder via S4 (`packages/orchestrator/src/completion.ts:74-91`).
- Known residue on the graceful path:
  - S3 children (probe/herdr CLI) have no group kill, but they are short-lived
    and terminated directly — low risk.
  - If a *worker pane's* model CLI ignores `ctrl+c`, the tab close is the
    backstop only if `herdr` itself kills the pane process tree; Loop has no
    pgid of the model CLI and cannot escalate itself.

### 2.3 Owner dies unexpectedly (the observed leak)

Sequence for `loop-f3143c02`:

1. Observer (foreground `loop` / `watch`) detects `executionExpiresAt` stall
   and throws "Execution owner is not responding"
   (`packages/cli/src/dispatcher.ts:44-46`). **It never kills anything** —
   correct by design ("the owner has its own process group and no UI pipes:
   disconnecting an observer cannot kill work", `dispatcher.ts:12`), but it
   also means observer death and owner death are both leak-enabling.
2. The owner holds no registered kill of its children on abnormal death:
   - S7's `process.on("exit")` never fires on SIGKILL/panic/network-cut of the
     owner process; herdr workspaces and worker panes stay up.
   - The owner *has no registry* of spawned process-group ids to kill even if
     it could run an exit handler: verification children are spawned and
     forgotten inside `NodeProcessRunner.start` (`process.ts:81`); herdr tabs
     are tracked only in-memory per `HerdrWorkerRuntime` instance
     (`client.ts:120-126`), and the owner is a *different process* from the
     CLI that might later run `loop cleanup`.
3. Workers' model CLIs live in herdr panes (S5) owned by the
   `loop-<runId>` workspace: they keep running indefinitely = the observed
   orphan. Verification subprocesses spawned detached (S4) from the owner also
   survive with their own groups.
4. Recovery is human-gated and kill-free: on restart the owner raises
   `recovery-*` attention items instructing "Confirm worker … has stopped, then
   run: loop reconcile … stopped; loop resume"
   (`coordinator.ts:157-170`); `loop reconcile` only flips durable state
   (`main.ts:152-156`) after the human confirms. `runtime.recover`
   (`runtime.ts:104-118`) observes but never kills.
5. Existing kill-free sweeps: `loop cleanup` closes leaked
   `loop-loop-*` workspaces (`main.ts:82-99`,
   `HerdrWorkerRuntime.purgeLeakedWorkspaces` `client.ts:447-469`) — but it is
   a manual, retention-gated maintenance command, not a death path.

### 2.4 Leak-point summary

| Exit mode | Leak |
|---|---|
| Owner SIGTERM/SIGINT | Mostly covered (2.2); residual: model CLIs that survive `ctrl+c` have no group-kill backstop from Loop |
| Owner SIGKILL / crash / network death | **All** owner-side children leak: herdr worker panes (model CLIs), detached verification subprocesses; no exit handler fires, no child-side watchdog exists, no pgid registry survives the owner |
| Observer (CLI/watch) dies | No effect on workers (by design) — but there is no fallback *owner-side* watchdog either, so a wedged owner with a live lease is invisible until the 5 s lease lapses and a human resumes |
| Worker pane CLI ignores ctrl+c during cancel | Grace path degrades to `tab close`; if herdr's pane close is SIGKILL-less against grandchildren, subprocesses persist |
| `loop resume` after owner death | Spawns a **new** detached owner (`main.ts:171-172`) without sweeping the old owner's leaked children; the resume-time recovery pass raises attention only (`coordinator.ts:157-170`) |

### 2.5 Recommended application of Claude Code mechanisms (design sketch, not yet implemented)

Ranked by coverage-per-risk, all inside existing boundaries (TS orchestration
layer; no provider/endpoint concepts in loop-core; no bridge type change
required for steps 1–3):

1. **Registry + synchronous `exit`-handler group kill in the owner**
   (§1.1+§1.2): the owner keeps a process-global registry of child pgids
   (verification runners already know `-child.pid`; herdr runtime knows its
   workspaces/tabs) and registers `process.on("exit")` + `SIGTERM`/`SIGINT` to
   `kill(-pgid, SIGTERM)` then escalate. Mirrors Claude's `process.on("exit", We)`.
   Extends the existing `client.ts:134-140` pattern from workspaces to all children.
2. **Child-side parent-death watchdog** (§1.4): the only mechanism that covers
   SIGKILL. Options: (a) spawn verification children via `bun --no-orphans`
   when the child is a bun script; (b) run a tiny watchdog wrapper (or a
   herdr-pane-side monitor) that pins `process.ppid` / the owner lease and
   group-kills on owner death. Linux-only alternative: `prctl(PR_SET_PDEATHSIG)`.
3. **Orphan sweep on resume/reconcile** (§1.7): before a resumed owner takes
   the lease, run the existing `purgeLeakedWorkspaces`/`herdr workspace close`
   for the run's own `loop-<runId>` surface (owned workspaces only —
   caller-anchored workspaces stay untouchable per `client.ts:136-137`), and
   only then raise recovery attention. Keeps the human confirmation for
   non-owned surfaces while automating teardown of work Loop itself owns.
4. **Escalation ladder parity** (§1.3): give S3/S5 the S4 treatment
   (TERM → poll → KILL on the group) where Loop owns the process; keep
   ctrl+c semantics for interactive agent panes.

### 2.6 Test strategy for the fix (deterministic, no paid calls)

- Reproduce the leak with a FakeProvider worker whose completion check spawns
  a `sleep` grandchild in its own group; SIGKILL the owner; assert the
  grandchild pid survives (red) — then assert the watchdog/exit-handler kills
  it (green).
- Graceful path: SIGTERM the owner mid-check; assert `kill(-pgid)` escalation
  observed and no `sleep` remains.
- Resume sweep: kill owner, run resume; assert the owned `loop-<runId>`
  workspace close was invoked before attention was raised.
- Keep all assertions on real OS pids/groups (`process.kill(-pgid, 0)`
  liveness), no sleeps longer than the existing grace constants.
