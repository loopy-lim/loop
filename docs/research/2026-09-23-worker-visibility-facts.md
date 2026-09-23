# Worker output streaming & viewer surfaces — fact sheet (2026-09-23)

Task `facts-worker-streams`. Evidence for the tee/mirror visibility design (Lead decision:
keep machine-parseable result capture untouched; add a render+publish layer in the provider
adapters). Every claim carries file:line evidence. Downstream tasks should rely on this
summary instead of re-reading the code.

## 1. Provider adapters: raw stream shapes, current consumption, line-level access

### 1.1 Shared substrate: `NodeProcessRunner` (pi process, codex exec, agy --print)

- Spawn: `packages/providers/src/process.ts:60-67` — `stdio: ["ignore","pipe","pipe"]`; stdout
  and stderr are both piped, stdin is ignored. Worker output never reaches Loop's own terminal.
- Accumulation: `process.ts:70-80` — both streams are appended into bounded strings
  (`bounded()` keeps the last 256_000 chars, `process.ts:199-201`) AND forwarded chunk-by-chunk
  to subscribers: `subscribe(listener)` at `process.ts:183-186` emits
  `{ stream: "stdout"|"stderr", chunk }` (type at `process.ts:20-23`).
- **Line-level access exists before parsing today, but only chunk-level.** Chunks arrive on
  every `data` event (`process.ts:70-80`); there is no newline splitter in the runner itself.
  The only place chunks are re-split into lines is downstream in `ProcessProvider.subscribe`
  (`packages/providers/src/process-provider.ts:48-61`, `text.split(/\r?\n/)`).
- Redaction: `process-provider.ts:50` redacts each chunk (`redactProviderText`) before the
  listener sees it; final summaries are redacted again in `extractMachineResult`
  (`process-provider.ts:128-152`).
- A tee layer can wrap either (a) `RunningProcess.subscribe` chunks in the runner, or (b)
  `AgentProvider.subscribe` events in `ProcessProvider` — both are existing extension points
  (`packages/providers/src/types.ts:49-52`, `process.ts:20-23`).

`ProcessProvider` base class (all three process adapters extend it):
- `subscribe()` at `process-provider.ts:48-61`: forwards `{type:"output"}` per chunk, then
  parses each complete line JSON for `{type:"session"}` (session/thread/conversation ids) and
  `{type:"final"}` (result summaries). Session keys: `thread_id|session_id|conversation_id`
  (`process-provider.ts:154-176`); summary shapes: agy `{event:"result",result:{response}}`,
  codex `{type:"item.completed",item:{type:"agent_message",text}}`, plus generic
  `final|final_message|result|output_text` keys (`process-provider.ts:181-207`).
- The orchestrator consumes only `output` events today, throttled to 1/sec, last line only,
  ANSI-stripped, 300-char redacted, persisted via `control.recordActivity`:
  `packages/orchestrator/src/task-execution.ts:60-67`. Everything else (full stream) is dropped.

### 1.2 pi (headless process mode) — `PiProvider`

- Launch: `packages/providers/src/pi/adapter.ts:59-66` —
  `pi [--provider X] [--model Y] --no-session -p <prompt>`. `--no-session` = ephemeral, no
  session file (pi `--help`: "Don't save session"); `-p` = "Non-interactive mode: process
  prompt and exit".
- Raw stdout in `-p` (print) mode: **final assistant text only.** pi docs
  `docs/cli-integration.md`: "Print mode runs the supplied prompts, writes the final assistant
  text to stdout, and exits … **Intermediate events are not exposed.**" So today a pi worker's
  stream is silent until the very end; stdout carries just the summary, stderr carries
  errors (`cli-integration.md`: "Print mode writes errors to stderr"; nonzero exit on
  `error`/`aborted` stop reason).
- Consequence: for pi process mode, a live tee needs a mode change (see §2), not just a
  renderer — print mode has nothing incremental to mirror.
- Where consumed: shared runner (§1.1); summary extraction via `extractMachineResult`
  (`process-provider.ts:128-152`), which for pi falls back to "last non-empty stdout line" or
  stderr (`process-provider.ts:146-149`).

### 1.3 codex exec — `CodexProvider`

- Launch: `packages/providers/src/codex/adapter.ts:57-67` —
  `codex exec --json -C <cwd> [--approve-for-me | --sandbox <mode>] [--model M] <prompt>`;
  resume: `codex exec resume <sessionId> --json [--model M] <prompt>`
  (`codex/adapter.ts:70-79`). `codex exec --help` confirms: `--json` "Print events to stdout
  as JSONL".
- Raw stream: codex app-server/exec JSONL event envelope. Shapes exercised in Loop tests:
  `{"type":"thread.started","thread_id":"thread-1"}` and
  `{"type":"item.completed","item":{"type":"agent_message","text":"done"}}`
  (`packages/providers/test/adapters-v2.test.ts:43-48`). `thread_id` becomes `sessionId`
  (`process-provider.ts:157-158`); `item.completed/agent_message` becomes the final summary
  (`process-provider.ts:185-189`).
- Intermediate visibility: `--json` already emits incremental items (started/completed) on
  stdout; `ProcessProvider.subscribe` currently parses but discards everything that is not a
  session id or a final summary (`process-provider.ts:52-60`). A tee layer can consume the same
  `ProviderEvent` stream without touching launch flags.
- Where consumed: shared runner (§1.1).

### 1.4 antigravity persistent — `AgyPersistentProvider` + `AgyStreamDriver`

- Launch (persistent, Loop's configured mode, `config/providers.example.toml:52`):
  `agy --input-format stream-json --output-format stream-json --print-timeout 2147484s
  --dangerously-skip-permissions --disable-slash-commands --add-dir <cwd> [--model M]
  [--conversation <id>]` (`packages/providers/src/antigravity/driver.ts:57-75`).
- Protocol (documented from agy 1.2.x, `driver.ts:11-19`): stdin turn =
  `{"event":"user","message":{"role":"user","content":...}}`; stdout = JSONL with
  `{"type":"init","conversationId":...}`, `{"type":"step_update","step_update":{"text_delta":...}}`,
  terminal `{"type":"result","result":{"status":"SUCCESS|OK","response":...,"conversation_id":...}}`
  (`driver.ts:241-285`). Turn completes only on `status SUCCESS|OK` (fail closed,
  `driver.ts:270-272`).
- One-shot variant (`AntigravityProvider`, mode ≠ persistent/interactive):
  `agy --output-format stream-json [--sandbox] [--model M] --print <prompt>`
  (`packages/providers/src/antigravity/adapter.ts:56-69`); resume prepends `--conversation`
  (`adapter.ts:71-76`). Its stdout lines are parsed by the shared `ProcessProvider` line parser
  (`event === "result"` branch, `process-provider.ts:182-186`).
- **Line-level access exists inside the driver**: `#onStdout` buffers and splits on `\n`
  (`driver.ts:205-219`), then `#onLine` (`driver.ts:221-285`) JSON-parses each line. Deltas are
  re-emitted as `{type:"output",stream:"stdout"}` per `step_update.text_delta`
  (`driver.ts:252-256`) and stderr chunks are re-emitted redacted (`driver.ts:90-95`); the
  driver has its own `subscribe()` (`driver.ts:148-150`). Note the persistent provider never
  wires driver `subscribe()` into the orchestrator (checked: `persistent.ts` has no
  `subscribe` method), so agy persistent workers are currently invisible except via activity
  heartbeats — actually not even those: `task-execution.ts:60-67` only fires if the provider
  implements `subscribe`, which `AgyPersistentProvider` does not.
- Where consumed: driver owns the child process directly (`driver.ts:76-83`,
  `spawn(...stdio:["pipe","pipe","pipe"])`), separate from `NodeProcessRunner`.

### 1.5 Fake/test providers

- `FakeProvider`/`ScriptedProvider`/`FailingProvider`/`SlowProvider`
  (`packages/providers/src/fake.ts`): pure in-memory timers, **no process, no stream, no
  `subscribe`** (`fake.ts:45-90`, `fake.ts:117-152`). They implement only the required
  `AgentProvider` methods; any tee/viewer layer must treat them as "no output events" (their
  results appear only as final summaries, e.g. `${taskId} complete`, `fake.ts:76-81`).
- `HerdrAgentProvider` (interactive mode, §3): emits lifecycle + final events only
  (`herdr-agent.ts:141-146`, `204-224`); no incremental output events exist for it today.

### 1.6 Where events flow today (end to end)

`provider.subscribe` (optional) → `task-execution.ts:60-67` (1 Hz, last line, redacted) →
`control.recordActivity` → Rust store: `crates/loop-bridge/src/execution.rs:297-304`
(`record_activity`), reduced into `activities: BTreeMap<TaskId,String>`
(`crates/loop-core/src/event/reducer.rs:62`, insert at `reducer.rs:108`) → snapshot field
`activity` per task (`crates/loop-bridge/src/commands.rs:1131`, type `commands.rs:189`) →
rendered as `activity: …` detail line in status/graph (`packages/presentation/src/snapshot.ts:141-147`).
The machine result path (`provider.result`, stdout capture, exit codes) is separate and must
stay untouched per the Lead decision.

## 2. pi `-p` incremental behavior (requirement 2)

- `pi --print` (what `PiProvider` runs): writes **only the final assistant text** to stdout,
  then exits. "Intermediate events are not exposed" (pi docs `cli-integration.md`, "Print to
  stdout" section; also `cli.md:44`: "`-p`, `--print` | Run the supplied prompts, write the
  final assistant text to stdout, then exit"). **No tool-call lines are printed in `-p` text
  mode** — tool executions happen silently inside the run.
- Non-TTY fallback: with piped stdout and no explicit mode, pi selects print mode anyway
  (`cli-integration.md`: "When no mode is selected explicitly, non-TTY stdin or stdout also
  selects print mode") — so the current silent behavior is intrinsic, not a flag mistake.
- **Alternative that does stream**: `pi --mode json` emits a JSONL session header plus
  incremental events — `message_update` with `text_delta`, `toolcall_start/delta/end`,
  `tool_execution_start/update/end` (tool name + args + partial results) — ending with
  `agent_end`/`agent_settled` (pi docs `json.md:30-114`, `cli-integration.md` "Stream JSON
  events"). Framing: strict JSONL on LF, stdout reserved for JSONL, diagnostics on stderr
  (`json.md:13-19`). Failed assistant responses appear in events without nonzero exit
  (`cli-integration.md`).
- Implication for the tee layer: pi process workers can gain live visibility by switching the
  launch to `--mode json` (keeping `-p` semantics for one-shot exit) and rendering events; the
  final `message_end` assistant text remains machine-parseable for the untouched result path —
  but the result-extraction regexes in `process-provider.ts:181-207` already match the
  `final|output_text` style keys, while pi JSON-mode `message_end` would need a mapping check
  (see Risks).

## 3. Herdr surface (requirement 3)

All programmatic interaction is via the `herdr` CLI over its socket API, wrapped by
`HerdrWorkerRuntime` (`packages/herdr/src/client.ts:65-...`), runner `NodeHerdrRunner`
(`client.ts:29-62`, 15 s timeout, JSON envelope parse in `#run` `client.ts:455-464`).

- Workspace (per run): `herdr workspace create --cwd <projectRoot> --label loop-<runId>
  --no-focus` → parse `result.workspace.workspace_id` + `result.root_pane.pane_id`
  (`client.ts:479-502`). Cached per runId in `#workspaces` (`client.ts:79-83`).
- Tab (per worker): `herdr tab create --workspace <ws> --cwd <worktree> --label <workerId>
  --no-focus` → `result.root_pane.pane_id` + `result.tab.tab_id`; then
  `herdr pane rename <paneId> <workerId>` (`client.ts:90-105`). Worker name:
  `loop-<taskId>` sanitized, sha256-suffixed if > 32 chars (`client.ts:512-519`).
- Writing into a pane programmatically (verbs Loop uses or herdr provides):
  - `herdr pane run <paneId> <command> [args...]` — run a command in the pane
    (`client.ts:563-565`, `#launch` command branch);
  - `herdr agent start <name> --kind <pi|codex|agy> --pane <paneId> [-- --args]`
    (`client.ts:543-551`) + `herdr agent prompt <name> <prompt>` (`client.ts:552-555`);
  - `herdr pane send-keys <paneId> ctrl+c` / `herdr agent send-keys <name> ctrl+c`
    (cancel path, `client.ts:307-315`);
  - for a tee mirror, `herdr pane send-text <paneId> <text>` exists on the CLI
    (`herdr pane --help`: "send-text — Send literal text to a pane") but Loop has not used it
    yet; `pane report-agent`/`report-metadata` are the display-reporting verbs Loop already
    uses from the Lead side (`packages/pi-loop/src/herdr-lifecycle.ts:49-66`).
- Reading: `herdr pane read <paneId> --lines N` / `herdr agent read <name> --source
  recent-unwrapped --lines N` — plain text output, not the JSON envelope (`client.ts:141-161`).
- Status/lifetime: `herdr agent get <name>` / `pane get <paneId>` → `agent_status|state` mapped
  to idle/running/blocked/completed/failed (`client.ts:117-139`, `mapState` `client.ts:537-556`).
  Worker lifetime = tab lifetime: created in `start()`, closed in `cleanup()`
  (`tab close <tabId>`, `client.ts:169-179`) and in `cancel()` after grace polling
  (`client.ts:296-334`); `release()` awaits result then cleans up
  (`packages/providers/src/herdr-agent.ts:180-185`). Process-exit hook force-closes workspaces
  (`client.ts:85-93`).
- Headless fallback (herdr absent / env vars absent):
  - Caller context comes from `HERDR_PANE_ID` (+ `HERDR_ENV` gate) — if absent, workers get no
    caller pane and `#ensureWorkspace` creates a fresh workspace; composition selects
    `HerdrAgentProvider` only when `providers.toml` says `mode = "interactive"`
    (`packages/orchestrator/src/composition.ts:33-36,63-71,87-100`); process modes are chosen
    otherwise regardless of herdr availability.
  - `loop` (bare/`run`) prints a notice and continues without Herdr reporting when
    `HERDR_ENV` is unset (`packages/cli/src/main.ts:59-65`).
  - `HerdrLifecycleReporter` (Lead side) disables itself when `HERDR_ENV`/`HERDR_PANE_ID` are
    absent — `active === false`, report/release become no-ops
    (`pi-loop/src/herdr-lifecycle.ts:44-56,110-119`).
  - Teardown tolerates already-gone panes/tabs/workspaces (`isAlreadyGone`,
    `client.ts:590-599`) and falls back to tab-close cascades (`client.ts:296-370`).
- Herdr context variables documented in `docs/environment-generalization.md:70`
  (`HERDR_*` = "workspace/pane context for run reporting").

## 4. `loop watch` today and attach points (requirement 4)

- Command path: `packages/cli/src/main.ts:181-183` — `loop watch [run-id] [--json]` resolves
  the latest run if no id (`main.ts:137-146`), then loops `observeRun({snapshot: () =>
  protocol.getSnapshot(input), onSnapshot: ...})`. Rendering: ANSI clear-screen +
  `formatSnapshot("status", ...)` per change, or raw JSON with `--json` (`main.ts:182`).
- Poll loop: `observeRun` (`packages/cli/src/dispatcher.ts:26-58`) polls every 100 ms but only
  re-renders when `snapshot.lastSequence` changed; exits on terminal states. Same polling
  primitive exists in-process: `LoopRuntime.subscribe` (`packages/orchestrator/src/runtime.ts:117-135`).
- What is rendered: `renderStatus` (`packages/presentation/src/snapshot.ts:113-138`) — run id,
  state, counts, ≤ (statusLineLimit−3) task lines; per-task details include
  `activity: <last activity line>` (`snapshot.ts:141-147`). `loop workers` renders only
  `worker.id · taskId` (`snapshot.ts:85-97`). There is **no per-worker live output feed** —
  the only worker content is the 1 Hz single-activity-line stored in Rust (§1.6).
- Natural attach points for a live worker-activity view:
  1. CLI-side: inside the `watch` branch (`main.ts:181-183`) — subscribe to an additional
     event source and render a worker-activity pane/section; snapshot polling gives worker
     start/stop (from `activeWorkers`), while the raw feed must come from the providers (the
     store does not keep streams).
  2. Adapter-side tee (Lead's chosen direction): publish from the adapters
     (`ProcessProvider.subscribe` / `AgyStreamDriver.subscribe` both already emit
     `ProviderEvent`s that are currently partly dropped, §1) into (a) the existing
     `recordActivity` path for snapshot surfacing and (b) a viewer surface (watch feed /
     herdr pane). `AgyPersistentProvider` currently lacks `subscribe` entirely (§1.4).
  3. Note the owner/observer split: watch runs in a separate process from the detached owner
     (`spawnOwner`, `dispatcher.ts:8-21`, owner has `stdio:"ignore"`), so a tee inside the
     owner's adapters cannot print to the watch terminal directly — it must go through the
     store/DB or herdr, not stdout.

## 5. Config conventions for output gating (requirement 5)

- `config/policy.toml [output]` (lines 13-18): `status_line_limit = 8`,
  `attention_line_limit = 6`, `findings_line_limit = 5`, `list_line_limit = 8`,
  `line_text_limit = 160`. Parsed in `packages/orchestrator/src/config.ts:152-164` into
  `OutputLimits` (`config.ts:47-53`), threaded into every renderer via `compactLines`
  (`packages/presentation/src/compact.ts`, used at `snapshot.ts` throughout). Any new viewer
  surface should add its own limit keys here and ride `compactLines`.
- `config/providers.example.toml` per-provider `mode` fields select the adapter shape:
  `mode = "interactive"` (herdr pane, `composition.ts:33-36,63-71,87-100`), `mode = "exec"`
  (codex process), `mode = "persistent"` (agy stream driver), `mode = "api"` (zai HTTP).
  Enabled flags gate the provider entirely (`composition.ts:30`). A visibility gate belongs in
  this file's conventions (per-provider or a `[providers.*]` boolean), defaulting off, consistent
  with `enabled = false` defaults for `zai`/`zai_cli` (`providers.example.toml:57-66`).
- Capture bounds that a tee must respect or extend: stdout/stderr keep last 256 KB per process
  (`process.ts:199-201`); activity lines redacted and clamped to 300 chars
  (`task-execution.ts:62-63`); herdr errors redacted and clamped to 2000 chars
  (`client.ts:561-571`); prompt fields clamped (1200/16 000, `prompt.ts:4-5`).
- Precedent for config-driven, fail-open reporting: `HerdrLifecycleReporter` no-ops without
  env context (`herdr-lifecycle.ts:44-56`).

## Risks / open questions for downstream tasks

1. **pi `-p` has no stream** — visibility for pi process mode requires switching launch to
   `--mode json` (or rpc). Result extraction then changes shape: pi JSON mode's final message
   is `message_end` with an assistant message, not a bare final text line; the generic
   `findFinalSummary` key list (`final|final_message|result|output_text`) does not obviously
   match `message_end.message.content` — needs a mapping decision and tests. Exit-code
   semantics also differ (json mode does not fail on `error`/`aborted` stop reasons).
2. **Owner/observer process split**: watch cannot receive adapter stdout directly (owner is
   detached with stdio ignored, §4.3); the tee must publish through the Rust store or herdr.
3. **Agy persistent provider emits no `subscribe`** today — a tee there is net-new wiring, not
   a refactor of existing plumbing.
4. `herdr pane send-text` is verified on the installed CLI but unused in Loop; pane-write
   flooding (per-delta vs per-line throttling) is unmeasured and should be gated/rate-limited.
5. Fake/test providers cannot emit output events; viewer tests must use process adapters with
   scripted runners (existing pattern: `test/adapters-v2.test.ts` fake runners) so tests stay
   offline.
