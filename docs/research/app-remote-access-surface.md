# Loop 원격 앱 접근 표면 인벤토리

- **Task:** `surface-research`
- **Scope:** 현재 저장소의 orchestrator, generated protocol, Herdr, Pi extension, presentation 표면
- **결론:** Loop에는 원격 전송 계층이 없다. 재사용 가능한 in-process submit/status/snapshot-subscription 계약과 Herdr worker 관찰·미러 primitive는 있으나, HTTP 서버·Tailscale 바인딩·원격 인증·raw prompt→Pi 세션·네트워크 출력 스트림 계약은 아직 없다.

## 1. 현재 공개 control surface

### 제출 / 실행

| 계층 | exported symbol | 현재 계약 | 원격 게이트웨이에서의 의미 |
| --- | --- | --- | --- |
| Orchestrator façade | `LoopRuntime`, `StartRunInput` | `start(input)`은 `runId`, 선택적 `intent`, 이미 분해된 `TaskSpecInput[]`, `workingDirectory`를 받아 prepare+execute하고 최종 `RunSummary`를 반환한다. `prepare(input)`와 `execute(runId)`도 분리되어 있다. | HTTP submit의 가장 가까운 façade이지만 **raw prompt가 아니라 완성된 DAG**를 요구하며 실행 완료까지 이어지는 로컬 in-process API다. |
| Coordinator | `Orchestrator`, `RunRequest`, `RunSummary` | `run()` = `prepare()` 후 `execute()`; `prepare()`는 경로를 canonicalize하고 intent를 redact한 뒤 control의 `prepareRun`을 호출한다. | deterministic bridge 호출과 provider dispatch를 조립하는 application service다. transport가 아니다. |
| Generated protocol | `prepareRun`, `submitPlan`, `createRun`; types `PrepareRunInput`, `SubmitPlanInput`, `TaskSpecInput` | Rust bridge에 run/plan을 생성·준비하는 typed commands를 제공한다. | 게이트웨이는 이 생성 타입을 재사용해야 하며 별도 TS 도메인 타입을 만들면 안 된다. 일반 소비자는 `prepareRun`을 사용하는 runtime façade가 더 완전하다. |

**Evidence**

- `packages/orchestrator/src/runtime.ts`: exports `LoopRuntimeOptions`, `StartRunInput`, `LoopRuntime`; methods `start`, `prepare`, `execute`.
- `packages/orchestrator/src/coordinator.ts`: exports `Orchestrator`, `RunRequest`, `ExistingRunRequest`, `RunSummary`; `prepare`, `run`, `execute`, `resume`.
- `packages/orchestrator/src/control.ts`: exported `OrchestrationControl` is a `Pick<typeof @loop/protocol>` over generated commands, including `prepareRun`, `createRun`, `submitPlan`, `getSnapshot`, and `subscribeEvent`.
- `packages/protocol/src/generated/commands.ts`: exports `prepareRun`, `createRun`, `submitPlan`.
- `packages/protocol/src/generated/types.ts`: exports `TaskSpecInput`, `PrepareRunInput`, `SubmitPlanInput`, `SnapshotOutput`.

### 상태 / 제어

`LoopRuntime` exposes the practical run control API:

- `snapshot(runId): Promise<SnapshotOutput>` — full durable snapshot.
- `pause(runId)`, `resume(runId)`, `cancel(runId)` — run controls.
- `recover(runId, reconciler)` and `cleanupRun(...)` — recovery/cleanup helpers, not a remote status protocol.

`SnapshotOutput` contains run state, task snapshots, active worker identities, attention, intent, working directory, guidance, sequence cursor, and execution lease metadata. Each `TaskSnapshotOutput` includes bounded `activities: string[]`, last failure, and result summary. Thus the current status payload can back a remote status view without inventing a second model.

**Evidence**

- `packages/orchestrator/src/runtime.ts`: exported `LoopRuntime` methods `snapshot`, `pause`, `resume`, `cancel`, `recover`, `cleanupRun`.
- `packages/protocol/src/generated/types.ts`: exported `SnapshotOutput`, `TaskSnapshotOutput`, `RunState`, `TaskState`, `AttentionSnapshotOutput`.
- `packages/protocol/src/generated/commands.ts`: exported `getSnapshot`, `pauseRun`, `resumeRun`, `cancelRun`, `steerRun`, `resolveAttention`, `listRuns`, `getTaskContext`.
- `packages/presentation/src/snapshot.ts`: exports `renderSnapshot`, `renderRuns`, `renderTaskContext`; `renderSnapshot` derives status/graph/workers/attention and an optional activity feed solely from generated protocol types.

### 스트림 / 변화 알림

There are three related but different primitives:

1. `LoopRuntime.subscribe(runId, listener)` polls `snapshot()` every 100 ms and emits only when `lastSequence` changes. It returns an unsubscribe function. This is an **in-process snapshot subscription**, not SSE/WebSocket.
2. Generated `subscribeEvents(SubscribeEventsInput)` is a cursor query (`afterSequence`, `limit`) returning `EventOutput[]`; each event is `sequence + payloadJson`.
3. Generated native event `loop.run_changed` carries only `{ runId, lastSequence }`. `subscribeEvent` is exported by the Bun Rustra host, while `onRustraEvent` accepts an injected platform `SubscribeFn`; its generated comment explicitly anticipates RN/Tauri wrappers. The notification tells a client to refetch—it does not itself carry a snapshot or output text.

**Evidence**

- `packages/orchestrator/src/runtime.ts`: `LoopRuntime.subscribe`.
- `packages/protocol/src/generated/commands.ts`: exported `subscribeEvents`.
- `packages/protocol/src/generated/types.ts`: exported `SubscribeEventsInput`, `EventOutput`.
- `packages/protocol/src/generated/events.ts`: exported `RustraEventName`, `RustraEventPayloads`, `SubscribeFn`, `onRustraEvent`; event `loop.run_changed`.
- `packages/protocol/src/generated/bun.ts`: exports native `rustra`, `events`, `subscribeEvent`; it imports `bun:ffi`, so this concrete host is not directly a React Native/browser transport.

## 2. Herdr가 관찰·미러할 수 있는 것

### Worker pane text and worker status

`HerdrWorkerRuntime` is the Herdr adapter surface:

- `read(handle, lines)` returns recent unwrapped agent text through `herdr agent read`, falling back to `pane read`; command workers use `pane read` directly.
- `status(handle)` maps `agent get` state to `HerdrWorkerState`, falling back to `pane get`; missing pane/tab is treated as completed.
- `sendText(paneId, text)` writes display text into a pane.
- `createPane`/`closePane` create and own passive mirror tabs.
- `steer(handle, message)` sends an interactive worker message through `agent prompt`; this is agent control, not output streaming.

`BoundedPaneSender` makes pane mirroring bounded: it coalesces lines, rate-limits flushes, caps its queue, and emits a suppression marker. `StoreActivitySink` records mirror-rendered lines into the durable run store via `recordActivity`, where they become `TaskSnapshotOutput.activities`; output is throttled while lifecycle/result lines are immediate.

**Evidence**

- `packages/herdr/src/client.ts`: exports `HerdrWorkerRuntime`, `HerdrWorkerRuntimeOptions`, `HerdrRunner`, `HerdrResult`, `CloseWorkspaceResult`; methods `read`, `status`, `sendText`, `createPane`, `closePane`, `steer`.
- `packages/herdr/src/worker.ts`: exports `HerdrWorkerHandle`, `HerdrWorkerInput`, `HerdrWorkerState`, `HerdrExecution`, `HerdrCaller`.
- `packages/herdr/src/bounded-sender.ts`: exports `PaneTextSender`, `BoundedPaneSender`.
- `packages/orchestrator/src/composition.ts`: exports `ActivityRecorder`, `StoreActivitySink`, `buildProviderRegistry`, `wrapForVisibility`; `StoreActivitySink.publish` forwards rendered worker lines to generated `recordActivity`.
- `packages/protocol/src/generated/types.ts`: `TaskSnapshotOutput.activities` is the durable, transport-neutral activity view.

### Relay and lifecycle limits

`SteerRelaySession` is **not a network relay**. It runs in a Herdr pane, distinguishes JSON-framed display lines from typed steer lines, echoes display text, and sends steer input to an injected orchestrator delivery function. `runSteerRelaySession` consumes an async line source until pane stdin ends.

Pi's `HerdrLifecycleReporter` reports only the Lead's coarse `idle | working` lifecycle with `herdr pane report-agent`, then releases it at session shutdown. This is not the Loop run state (`active`, `attention`, `completed`, etc.). Consequently Herdr can show pane/agent text and agent lifecycle, while authoritative run status remains the Loop snapshot/store.

**Evidence**

- `packages/herdr/src/relay.ts`: exports `PaneRelaySpec`, `ParsedPaneLine`, `SteerRelayDelivery`, `SteerRelayOptions`, `SteerRelaySession`, `encodeDisplayFrame`, `parsePaneLine`, `runSteerRelaySession`.
- `packages/pi-loop/src/herdr-lifecycle.ts`: exports `PiLifecycleEvent`, `HerdrLifecycleState`, `HerdrLifecycleSink`, `HerdrLifecycleReporter`, `registerHerdrLifecycle`.
- `docs/architecture.md`: event log is authoritative; Herdr is the source only for terminal/process liveness, and Loop persists opaque Herdr worker identifiers.

## 3. Pi extension이 전달하는 것

`registerLoopExtension` exposes two Pi-facing surfaces:

1. Tool `loop_run`: Pi supplies `intent`, serialized `tasksJson`, and optional `runId`. The extension validates/normalizes the already decomposed task DAG, calls `LoopLeadBackend.run`, forwards snapshots to Pi through `onUpdate`, and returns a compact final run summary.
2. Command `/loop`: forwards status/graph/workers/attention and controls (pause/resume/cancel/steer/resolve), plus runs/tasks/models lookup, to `LoopLeadBackend`.

The default backend forwards execution to the private local CLI:

- `runLoopPlan` spawns `loop __execute-plan --json --stream` with `shell: false`, sends `{ intent, runId, workingDirectory, tasks }` over stdin, parses JSON Lines `snapshot` and `summary` records, and forwards snapshots through `onProgress`.
- Other backend methods spawn ordinary Loop CLI JSON commands (`status`, `cancel`, `pause`, `resume`, `steer`, `resolve`, `task`, `runs`, `models`).
- `before_agent_start` appends Lead instructions that ask Pi to decompose an engineering prompt and call `loop_run` once.

Therefore Pi currently forwards **a Pi-produced DAG into Loop**, plus local CLI status/control. It does not expose a callable remote prompt endpoint, preserve a remote Pi conversation/session, or stream raw Pi tokens to an app.

**Evidence**

- `packages/pi-loop/src/extension.ts`: exports `PiExtensionApi`, `LoopLeadBackend`, `LeadSettings`, `registerLoopExtension`, `runLoopPlan`, and default `registerLoopExtension`.
- `packages/pi-loop/src/extension.ts`: `registerTool({ name: "loop_run" ... })`, `registerCommand("loop", ...)`, `pi.on("before_agent_start", ...)`, `DefaultLoopLeadBackend`, `runLoopPlan`.
- `packages/pi-loop/src/herdr-lifecycle.ts`: `registerHerdrLifecycle` forwards Pi session/agent lifecycle to Herdr.

## 4. Remote HTTP client gaps

| Gap | Current seam to reuse | Missing contract / adapter |
| --- | --- | --- |
| HTTP transport | `LoopRuntime.start/snapshot/subscribe`; generated protocol types | No HTTP server, routes, request/response schema, SSE/WebSocket adapter, listener lifecycle, CORS policy, or error mapping. `docs/design/jwt-validation-middleware.md` explicitly states that no HTTP surface exists. |
| Tailscale exposure | None | No bind-address selection, Tailscale-interface validation, port config, discovery, TLS/Tailscale Serve policy, or refusal to bind unintended interfaces. |
| Raw prompt submission to Pi | Pi `before_agent_start` instructions + `loop_run`; `runLoopPlan` after decomposition | No programmatic Pi session adapter accepting a remote prompt. Existing runtime submission requires `TaskSpecInput[]`; the private CLI receives intent plus tasks, not prompt-only input. |
| Remote status | `SnapshotOutput`; `LoopRuntime.snapshot` | Need stable HTTP status endpoint and typed serialization rules for `bigint` fields (`lastSequence`, lease expiry, check durations). |
| Real-time run/output | `LoopRuntime.subscribe`; `loop.run_changed`; task `activities`; Herdr `read/status` | Need network framing, reconnect/cursor semantics, backpressure, terminal completion, and a decision between snapshot SSE versus event-cursor streaming. Current runtime polling is process-local. |
| Full pane transcript | `HerdrWorkerRuntime.read(handle)` | Snapshot exposes worker id/task id but not the full `HerdrWorkerHandle`; no orchestrator method resolves a run/task to a readable pane. Durable activities are bounded rendered lines, not a lossless transcript. Direct Herdr handles must not become core/domain fields. |
| Authentication | Proposed transport-agnostic JWT design only | No implemented request authentication or authorization. The design requires secrets from environment/process memory and forbids config/log/persistence, but remains `Status: proposed`. |
| Multi-client ownership | Durable execution lease and snapshots | Need idempotent submit semantics, duplicate run handling, disconnect behavior, and process ownership policy. A disconnected observer must not accidentally cancel the detached execution owner. |
| App-native protocol host | Generated `SubscribeFn` abstraction anticipates RN/Tauri | Concrete generated host is Bun FFI; mobile/desktop clients need an HTTP client generated/typed from the gateway contract, not direct SQLite/native bridge access. |

### Recommended seam placement (inventory consequence, not a stack decision)

The smallest boundary-preserving path is a new **adapter-layer HTTP gateway** over `LoopRuntime` and generated protocol DTOs:

```text
remote app → HTTP/SSE adapter → LoopRuntime/orchestrator → generated protocol → bridge/store/core
                                      └→ Pi adapter (only for prompt decomposition)
                                      └→ Herdr adapter (only for pane/process observation)
```

The gateway should translate transport concerns only. It should not put HTTP/Tailscale/Pi/Herdr names into protocol domain snapshots unless a Rust domain change is genuinely required. For v1 output, `SnapshotOutput.tasks[].activities` is the clean transport-neutral source; exposing raw pane text would require a separate adapter projection rather than changing `loop-core`.

## 5. Boundary constraints

The repository's required dependency direction is:

```text
loop-core → loop-store → loop-bridge → generated protocol → orchestrator → adapters/UI
```

- **`loop-core`:** may own graph, policy, state transitions, generic worker activity, completion and scheduling invariants. It **must not reference** provider, Pi, Herdr, pane, endpoint, HTTP, Tailscale, model, command, UI, or SQLite concepts.
- **Store:** owns event persistence/indexes/recovery; no provider calls or scheduling policy.
- **Bridge/protocol:** owns typed process-boundary commands and generated DTOs. Rust bridge types change first, then `bun run codegen`; do not hand-write a TS copy. It should remain transport/provider neutral.
- **Orchestrator:** may depend on generic provider interfaces and injected Herdr runtime at composition/application boundaries; deterministic scheduling must stay in Rust. A gateway may call the orchestrator but should not move HTTP policy into core.
- **Provider/Herdr adapters:** may reference provider- and Herdr-specific process, pane, endpoint, and redaction details. Herdr is terminal/process liveness authority, not run-state authority.
- **Pi layer:** may reference Pi extension APIs and translate Pi intent/decomposition to Loop's generated task contract. It must not access SQLite/native libraries directly.
- **Presentation/apps:** consume generated protocol types or gateway DTOs and render them; they must not own scheduling/provider policy.
- **Credentials:** model/provider endpoints belong only in configuration or adapter construction. Tokens, signing keys, and provider credentials must not be persisted or logged.

**Evidence**

- `AGENTS.md`: dependency direction, core exclusions, Rust-first bridge/codegen rule, thin TS adapters, configuration-only model IDs/endpoints, no credential persistence/logging.
- `docs/architecture.md`: layer ownership table and durable-recovery authority split.
- `docs/decisions/2026-09-23-worker-visibility.md` D6: provider/Herdr/pane/terminal concepts forbidden in core; store and pane sinks injected at composition.
- `docs/decisions/2026-09-23-watch-to-steer.md`: pane relay stays in TS adapter space and routes through orchestrator steer; no raw provider stdin injection.
- `docs/design/jwt-validation-middleware.md`: proposed HTTP authentication remains outside `loop-core`; secrets must stay out of config, logs, and persistence.

## 6. Concise answer

- **Orchestrator today:** submit/execute through `LoopRuntime.start` (`prepare` + `execute`), status through `snapshot`, and an in-process change stream through `subscribe` (100 ms snapshot polling keyed by `lastSequence`). Generated lower-level surfaces include `prepareRun`/`submitPlan`, `getSnapshot`, `subscribeEvents`, and `loop.run_changed`.
- **Herdr today:** `HerdrWorkerRuntime.read/status` observes pane/agent text and worker lifecycle; `sendText` + `BoundedPaneSender` mirror bounded text into passive panes; `SteerRelaySession` separates display frames from user steer input. Herdr does **not** own authoritative Loop run status; Pi lifecycle mirroring reports only Lead `idle/working`.
- **Pi extension today:** injects Lead decomposition instructions, receives a DAG through `loop_run`, forwards intent+tasks to local `loop __execute-plan --json --stream`, relays snapshot updates, and forwards local `/loop` status/control commands.
- **Remote HTTP gap:** no server, Tailscale binding, implemented auth, prompt-only Pi API, network stream/reconnect protocol, or app transport exists. The reusable payload is generated `SnapshotOutput`; the reusable application seam is `LoopRuntime`; Pi and Herdr remain outer adapters.
