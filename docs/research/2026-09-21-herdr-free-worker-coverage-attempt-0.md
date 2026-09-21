# Herdr-free worker coverage — attempt 0

- kind: `research`; attempt: `0`; date: `2026-09-21` (Asia/Seoul)
- workspace: `/Users/loopy/dev/ll3/loop`; current `HEAD` `39b93a5`; pre-existing dirty/untracked changes preserved
- dependencies: `AgentProvider`/`ProcessProvider`, provider adapters, orchestrator, completion verifier, Rustra event/store recovery, Pi extension
- read scope: `packages/providers`, `packages/orchestrator`, `packages/herdr`, `packages/pi-loop`, `packages/cli`, Rust core/store/bridge, config, tests, and related docs
- write scope: this report only; `HerdrAgentProvider` removal itself was not performed
- 표기: `[직접]`은 소스/테스트가 직접 보이는 사실, `[추론]`은 그 사실에서 도출한 제거 영향 또는 설계 권고다.
- 외부 provider/auth CLI와 유료 모델 호출은 실행하지 않았다.

## COVERAGE

### 공통 경계

- `[직접]` 워커 계약은 `capabilities/start/resume?/cancel/status/result/subscribe?`이며, provider를 `computeClass`로 선택한다. Herdr나 Pi는 계약에 필수가 아니다. [`packages/providers/src/types.ts:52-67`](../../packages/providers/src/types.ts#L52-L67), [`packages/providers/src/registry.ts:12-24`](../../packages/providers/src/registry.ts#L12-L24)
- `[직접]` `ProcessProvider`는 child process를 pipe로 실행하고, 메모리 내 session에서 status/result/cancel/stream을 제공한다. JSON/텍스트 final, session ID, incomplete output, failure kind와 credential redaction도 공통 처리한다. [`packages/providers/src/process.ts:41-95`](../../packages/providers/src/process.ts#L41-L95), [`packages/providers/src/process-provider.ts:21-67`](../../packages/providers/src/process-provider.ts#L21-L67), [`packages/providers/src/process-provider.ts:69-127`](../../packages/providers/src/process-provider.ts#L69-L127), [`packages/providers/src/process-provider.ts:130-235`](../../packages/providers/src/process-provider.ts#L130-L235)

### 제거 후 남는 실행 경로

| 경로 | 실행/관찰 근거 | Herdr 없는 상태의 판정 |
| --- | --- | --- |
| `zai` | `[직접]` `ZaiApiProvider`는 HTTP `fetch`와 `AbortController`로 시작/취소/결과를 관리하고 `resumableSession=false`다. [`packages/providers/src/zai/api.ts:35-59`](../../packages/providers/src/zai/api.ts#L35-L59), [`packages/providers/src/zai/api.ts:62-153`](../../packages/providers/src/zai/api.ts#L62-L153) | 실행 가능. 단 process provider가 아니라 API adapter이며 pane/interactive prompt/restart reattach는 없다. |
| `zai_cli` | `[직접]` `ProcessProvider`를 상속해 `zai --output-format json --cwd ... [--model] --prompt ...`를 실행한다. [`packages/providers/src/zai/cli.ts:14-50`](../../packages/providers/src/zai/cli.ts#L14-L50) | 실행·종료·취소·출력 정규화는 유지된다. 별도 provider-specific contract test는 현재 `adapters-v2`에 보이지 않으며, inherited process contract에 의존한다. |
| `codex` | `[직접]` `codex exec --json`을 실행하고 `thread_id`를 정규화하며, 명시적 `exec resume <sessionId> --json` 경로가 있다. [`packages/providers/src/codex/adapter.ts:43-77`](../../packages/providers/src/codex/adapter.ts#L43-L77), [`packages/providers/src/codex/adapter.ts:81-87`](../../packages/providers/src/codex/adapter.ts#L81-L87) | direct process 실행은 유지된다. pane은 사라지고, resume은 호출자가 session ID를 보존해 명시적으로 요청할 때만 가능하다. |
| `antigravity` | `[직접]` `agy --output-format stream-json [--sandbox] [--model] --print ...`와 `--conversation <id>` resume, 모델 probe를 제공한다. [`packages/providers/src/antigravity/adapter.ts:36-72`](../../packages/providers/src/antigravity/adapter.ts#L36-L72) | direct process 실행·stream-json final·conversation resume은 유지된다. Herdr pane과 `agent get/read` 관찰은 없다. |
| `fake` | `[직접]` timer 기반 성공/실패, status/result/cancel, concurrency 계측을 외부 호출 없이 제공한다. [`packages/providers/src/fake.ts:25-100`](../../packages/providers/src/fake.ts#L25-L100) | 제거 후에도 실행·재시도·취소·동시성·completion verification을 검증하는 완전한 offline harness로 남는다. |

`config/providers.example.toml`의 현재 기본 예시는 Codex/AGY를 `mode = "interactive"`로 두고, `zai_cli`도 별도 CLI 경로로 둔다. 따라서 `[추론]` `HerdrAgentProvider`를 삭제하려면 현재 composition의 interactive Codex/AGY 분기를 direct process 또는 새 Pi adapter로 바꾸는 migration이 필요하다. 현재 분기는 여전히 Herdr를 import하고 interactive Codex/AGY를 `visibleAgent()`로 보낸다. [`config/providers.example.toml:9-32`](../../config/providers.example.toml#L9-L32), [`packages/orchestrator/src/composition.ts:1-76`](../../packages/orchestrator/src/composition.ts#L1-L76), [`packages/orchestrator/src/composition.ts:79-99`](../../packages/orchestrator/src/composition.ts#L79-L99)

## RISK

- `[직접]` 가시 pane: Herdr runtime은 workspace를 만들고, 오른쪽 no-focus pane을 split하고, 그 pane에서 agent/command를 시작한다. [`packages/herdr/src/client.ts:64-107`](../../packages/herdr/src/client.ts#L64-L107), [`packages/herdr/src/client.ts:205-224`](../../packages/herdr/src/client.ts#L205-L224) process runner는 `stdio: ["ignore", "pipe", "pipe"]`인 숨은 child process일 뿐이다. [`packages/providers/src/process.ts:41-63`](../../packages/providers/src/process.ts#L41-L63) 제거하면 Codex/AGY/zai_cli worker가 자동으로 사용자에게 보이는 pane은 없다.
- `[직접]` prompt/status/output 관찰: Herdr는 `agent prompt --wait --timeout`, `agent get`/`pane get`, `agent read`/`pane read`를 제공하고, Herdr adapter가 이를 polling해 final summary를 만든다. [`packages/herdr/src/client.ts:115-158`](../../packages/herdr/src/client.ts#L115-L158), [`packages/herdr/src/client.ts:166-203`](../../packages/herdr/src/client.ts#L166-L203), [`packages/providers/src/herdr-agent.ts:68-165`](../../packages/providers/src/herdr-agent.ts#L68-L165) process 경로는 시작 시 argv prompt를 한 번 넘기고 pipe/event와 process exit를 읽는다. `[추론]` Herdr 제거 후에는 interactive prompt 재주입과 provider-native pane 상태 조회를 보장하지 않는다.
- `[직접]` 재시작/재부착: Herdr handle은 workspace/pane/agent opaque ID를 들고 `attach`, `status`, `read`, `cancel`을 지원한다. [`packages/herdr/src/worker.ts:10-30`](../../packages/herdr/src/worker.ts#L10-L30), [`packages/herdr/src/client.ts:110-164`](../../packages/herdr/src/client.ts#L110-L164) 반면 `ProcessProvider` session은 인스턴스의 `Map`에만 있고 기본 `resume()`은 새 `start()`다. [`packages/providers/src/process-provider.ts:21-40`](../../packages/providers/src/process-provider.ts#L21-L40) Codex/AGY의 명시적 resume은 있어도 Loop recovery가 자동으로 호출하지 않는다. `[추론]` 프로세스 종료·Loop 재시작 후에는 Pi/새 adapter가 session/observe 계약을 구현하지 않으면 lost/attention으로 떨어진다.
- `[직접]` 현재 Loop recovery 자체는 provider 재시작을 수행하지 않고 `WorkerReconciler.observe(worker.id)` 결과가 running이 아니면 attention을 만든다. [`packages/orchestrator/src/runtime.ts:72-87`](../../packages/orchestrator/src/runtime.ts#L72-L87) 그러므로 fake recovery 테스트는 durable policy를 증명하지만 실제 외부 worker reattach까지 증명하지 않는다. `[추론]`
- `[직접]` 현재 Pi extension은 worker `AgentProvider`가 아니다. Pi는 DAG를 Loop에 제출하고 status/cancel/resume을 표시하며, Loop가 scheduling/dispatch/verification/retry/durable state를 소유한다고 명시한다. [`packages/pi-loop/src/extension.ts:85-149`](../../packages/pi-loop/src/extension.ts#L85-L149) provider layer가 Pi를 import하지 않는 architecture 경계도 테스트된다. [`tests/architecture-boundaries.test.ts:47-59`](../../tests/architecture-boundaries.test.ts#L47-L59) `[추론]` 따라서 Herdr adapter 삭제만으로 Pi가 worker 실행을 대신한다고 볼 수 없다.

## PI-ADAPTER

다음은 현재 계약을 보존하면서 Pi를 worker 실행 경로로 넣을 때의 책임이다. 모두 `[추론]`이며, 근거가 되는 기존 seam은 함께 적었다.

1. `AgentProvider` 구현: Pi를 `packages/providers`의 얇은 adapter로 만들고, provider/model과 compute class를 config/composition에서 주입한다. `loop-core`나 generated protocol에 Pi/provider 개념을 넣지 않는다. [`packages/providers/src/types.ts:22-67`](../../packages/providers/src/types.ts#L22-L67), [`packages/orchestrator/src/config.ts:7-56`](../../packages/orchestrator/src/config.ts#L7-L56)
2. 결정적인 실행: task의 cwd, title/kind/attempt/requirements, sandbox/tool scope를 argv 또는 명시된 Pi 실행 계약으로 전달하고 shell/credential argv를 금지한다. 기존 process runner와 Codex/Z.AI CLI가 이 seam을 제공한다. [`packages/providers/src/process.ts:41-50`](../../packages/providers/src/process.ts#L41-L50), [`packages/providers/src/codex/adapter.ts:59-87`](../../packages/providers/src/codex/adapter.ts#L59-L87)
3. 결과 계약: Pi의 final/session/lifecycle envelope를 `WorkerResult`/`ProviderEvent`로 정규화하고, final 누락은 `incomplete_output`, 인증·quota·timeout·cancel은 기존 failure kind로 보낸다. redaction과 `subscribe`도 유지한다. [`packages/providers/src/process-provider.ts:103-127`](../../packages/providers/src/process-provider.ts#L103-L127), [`packages/providers/src/process-provider.ts:155-235`](../../packages/providers/src/process-provider.ts#L155-L235)
4. 재시작 경계: Pi session ID를 opaque `sessionId`로만 보존하고, 검증된 Pi resume/observe가 있을 때만 `resume`/reconciler를 구현한다. 재부착이 불가능하면 조용히 새 작업으로 바꾸지 말고 `lost → attention` 또는 명시적 새 attempt로 보낸다. 이는 Loop recovery의 현재 계약과 일치한다. [`packages/orchestrator/src/runtime.ts:9-13`](../../packages/orchestrator/src/runtime.ts#L9-L13), [`packages/orchestrator/src/runtime.ts:72-87`](../../packages/orchestrator/src/runtime.ts#L72-L87)
5. UI 책임 분리: Pi adapter는 pane/workspace/SQLite를 소유하지 않고 worker stream/status를 Loop에 제공한다. 사용자에게 보이는 Lead pane과 compact `/loop` status는 현재 Pi extension/호스트가 담당한다. [`packages/pi-loop/src/extension.ts:124-149`](../../packages/pi-loop/src/extension.ts#L124-L149), [`docs/architecture.md:33-41`](../../docs/architecture.md#L33-L41) `[추론]` Herdr의 visible pane을 Pi adapter가 암묵적으로 복제하는 것은 범위 밖이다.
6. offline contract 선행: fake runner로 정확한 argv/cwd, final/session fixture, cancellation, redaction, incomplete output, resume/observe 실패를 검증하고, 실제 Pi/provider auth는 별도 evidence로 남긴다. 기존 문서도 fake/adapter/cancellation/redaction/capability 테스트를 offline 경계로 둔다. [`packages/providers/test/adapters-v2.test.ts:22-62`](../../packages/providers/test/adapters-v2.test.ts#L22-L62), [`docs/provider-support.md:16-28`](../../docs/provider-support.md#L16-L28)

## VERIFICATION

- `[직접]` Orchestrator는 provider가 성공 결과를 반환한 뒤에만 completion checks를 실행하고, 각 check를 `recordVerification`으로 기록한다. worker success 자체는 task 완료가 아니다. [`packages/orchestrator/src/coordinator.ts:139-187`](../../packages/orchestrator/src/coordinator.ts#L139-L187), [`packages/orchestrator/src/completion.ts:27-47`](../../packages/orchestrator/src/completion.ts#L27-L47)
- `[직접]` fake provider 기반 milestone은 DAG dependency/order, bounded concurrency, deliberate failure escalation, cancellation, unavailable provider attention, overlapping write-scope serialization을 검증한다. [`packages/orchestrator/test/milestone.test.ts:51-144`](../../packages/orchestrator/test/milestone.test.ts#L51-L144), [`packages/orchestrator/test/milestone.test.ts:179-201`](../../packages/orchestrator/test/milestone.test.ts#L179-L201)
- `[직접]` 같은 fake provider가 성공해도 completion command가 실패하면 run/task가 attention이 되는 것을 직접 검증한다. 이것이 Herdr 없이도 “worker 실행 → 독립 검증”이 온전히 테스트되는 핵심 증거다. [`packages/orchestrator/test/milestone.test.ts:146-177`](../../packages/orchestrator/test/milestone.test.ts#L146-L177)
- `[직접]` Rust store/core도 worker lost는 attention, confirmed running은 Running으로 복구하고, 모든 completion evidence가 있어야 Done으로 전이한다. [`crates/loop-store/tests/recovery.rs:41-103`](../../crates/loop-store/tests/recovery.rs#L41-L103), [`crates/loop-core/tests/scheduler_domain.rs:89-103`](../../crates/loop-core/tests/scheduler_domain.rs#L89-L103)
- `[실행 결과]` Herdr-independent focused suite인 `bun test packages/providers/test/adapters-v2.test.ts packages/orchestrator/test/milestone.test.ts packages/orchestrator/test/runtime.test.ts packages/orchestrator/test/completion.test.ts packages/pi-loop/test`는 **33 pass, 0 fail**이었다. fake-only CLI acceptance test도 **1 pass**였고, `bun run test:architecture`는 **6 pass**였다. 이 실행에는 외부 provider 호출이 없었다.
- `[실행 결과]` `bun run check`는 codegen check, typecheck, architecture test, Rust workspace tests/build까지 통과했지만 최종 Bun suite는 **62 pass, 6 fail**이었다. 실패는 현재 `config/models.toml`의 중복 `glm-5.3-flash`를 loader가 `config.duplicate_model`로 거부해 발생한 CLI/config 테스트이며, Herdr coverage와 무관하다. 이 config는 조사 중 수정하지 않았다. [`packages/orchestrator/src/config.ts:186-211`](../../packages/orchestrator/src/config.ts#L186-L211), [`packages/orchestrator/test/config.test.ts:8-29`](../../packages/orchestrator/test/config.test.ts#L8-L29)
- 실제 Pi/CLI 인증·quota smoke와 실제 provider prompt는 이번 조사에서 수행하지 않았다.

### 결론

`HerdrAgentProvider` 제거 후에도 fake로 worker dispatch, retry/escalation, cancel, scope serialization, completion-contract verification, recovery attention을 검증할 수 있고, direct `zai`/`zai_cli`/Codex/AGY process/API 실행 경로도 남는다. 손실은 주로 Herdr가 제공하던 visible pane, interactive prompt/status/read, opaque process reattachment다. Pi adapter는 이 손실을 모두 UI로 흉내 내는 계층이 아니라, 명시적인 `AgentProvider` 실행·정규화·session/reconcile 경계를 맡고, 검증과 durable policy는 계속 Loop가 소유해야 한다.
