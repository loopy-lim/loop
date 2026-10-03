# Turnloop worker profiles — capability gating + lane selection (M-TL3)

- **Date:** 2026-09-26
- **Kind:** research note (implementation evidence for M-TL3 of `docs/decisions/2026-xx-own-turn-loop-and-subagent-steering.md`)
- **Scope read:** `packages/turnloop/**`, `packages/orchestrator/src/**`, `packages/cli/**`
- **Changed:** `packages/turnloop/src/{types,lanes,engine,provider}.ts`, `packages/turnloop/test/capability.test.ts`, `packages/orchestrator/src/{config,composition}.ts`, `packages/orchestrator/test/profile.test.ts` (이 문서)
- **유료 모델 호출: 0** — 전체 검증은 `FakeModelClient`(스크립트된 턴)와 `FakeProvider`로 수행했다.

## 1. 선택 메커니즘 (selection mechanism)

**설정 키는 하나다: `models.toml`의 `[[models]]` 항목에 붙는 `lane`.**

```toml
# $LOOP_CONFIG_DIR/models.toml
[[models]]
id = "openai-codex/gpt-6-sol"
provider = "pi"            # 라우팅/쿼터 그룹 identity는 provider가 소유 (lane과 무관)
compute_class = "balanced"
lane = "turnloop"          # ← absent = "pi" (기본). 명시적 opt-in만 전환된다.
capabilities = { coding = 4, reasoning = 5, tools = 3, vision = 1, long_context = 5 }
latency = 2
cost_weight = 2
```

- `lane` 파싱: `packages/orchestrator/src/config.ts` `parseModels` → `ModelProfile.lane?: WorkerLane` (`WorkerLane = "pi" | "turnloop"`). 값이 없으면 키 자체가 없는 것과 동일하게 `"pi"`.
- 합성(wiring): `packages/orchestrator/src/composition.ts` `buildProviderRegistry` — `model.lane === "turnloop"`인 프로파일만 `TurnLoopProvider`로 합성하고, 나머지는 기존 분기(pi/codex/agy/zai)를 그대로 건너뛴다. worker id는 lane과 무관하게 `${provider}:${model.id}`를 유지하므로 **라우팅·쿼터 그룹 메타데이터가 lane 전환에 영향받지 않는다** (프로파일 `pi:m1` 선택 테스트가 `select("fast", {"pi:m1"})` 제외가 여전히 동작함을 확인).
- turnloop 프로파일의 모델 경계(ModelClient·ToolRunner·laneCap·maxTurns)는 `ProviderCompositionOptions.turnloopWorker: (model) => TurnLoopWorkerBinding | undefined` 훅으로만 공급된다. 모델 id·엔드포인트·자격증명은 임베딩 애플리케이션(게이트웨이/앱 경로)의 어댑터 생성 closure 안에만 존재한다.
- CLI(`packages/cli/src/main.ts`)는 `turnloopWorker` 훅을 넘기지 않는다 — M-TL3는 실제 ModelClient 구현을 배송하지 않는다(실공급자 실측은 ADR M-TL4). 따라서 CLI 설정에서 `lane = "turnloop"`을 선언하면 아래 2절의 결정론적 거부가 즉시 발생한다. 이것이 의도된 기본값이다: **pi lane이 기본이고, turnloop는 앱이 capability를 공급했을 때만 켜진다.**

### 2. Capability 게이팅 (deterministic refusal)

세 층으로 나뉜다. 전부 같은 입력 → 같은 결과다.

| 층 | 조건 | 결과 |
|---|---|---|
| 설정 파싱 | `lane`이 `"pi"`/`"turnloop"` 이외의 값 | `ConfigError` code `config.unknown_worker_lane` (load 시 fail-fast) |
| 합성 | `lane = "turnloop"`인데 `turnloopWorker` 훅이 없거나 `undefined` 반환 | `Error` 메시지 접두사 `config.turnloop_lane_unavailable` + 프로파일 id 포함 (런타임 중간이 아니라 합성 시점 거부) |
| 어댑터 | 바인딩의 `inProgressToolResults: false` (공급자가 두 항목 패턴을 거부하는 경우) | final-only 기록으로 폴백 (§3) — 거부가 아니라 표현 폴백 |

에비던스: `packages/orchestrator/test/profile.test.ts` —
- `worker profiles default to the pi lane with zero behavior change` (lane 없음/`"pi"` 명시 모두 `PiProvider`, `TurnLoopProvider` 아님)
- `a turnloop-lane profile without a model client is refused deterministically` (동일 입력 → 동일 메시지 반복 확인)
- `an unknown lane value is a stable configuration error` (`config.unknown_worker_lane`)

### 3. `inProgressToolResults` 폴백의 정확한 의미 (final-only)

ADR M-TL3 기준 1번: `inProgressToolResults: false` 프로파일은 final-only 기록으로 폴백한다. 구현된 의미는 다음과 같다 (`packages/turnloop/src/lanes.ts` `ToolLaneScheduler`, 엔진 옵션 `TurnLoopOptions.inProgressToolResults`, 어댑터 옵션 `TurnLoopProviderOptions.inProgressToolResults`, 기본값 true):

- **두 항목 패턴 부재:** in-progress 행은 트랜스크립트에 한 번도 나타나지 않는다.
- **발행 순서 결정론 유지:** 완료가 임의 순서로 와도 final 행은 항상 toolCall 발행 순서로 append된다(배치 전체가 final이 되는 시점에 일괄 flush).
- **병렬 레인 유지:** 실행 동시성은 두 항목 모드와 동일하다(레인 캡, sequential 레인 포함). 완료 처리도 개별적으로 즉시 이루어진다(`tool_result` 이벤트가 완료마다 발행).
- **턴 경계 steer 유지:** steer는 배치 경계 뒤 다음 턴에 정확히 적용된다.
- **모델 턴 주기만 배치 정렬로 바뀐다:** in-progress 행이 없으면 "아직 실행 중인 tool_call"을 트랜스크립트로 표현할 방법이 없다. 완료 하나만으로 다음 모델 턴을 트리거하면 미완료 tool_call이 걸린(dangling) 트랜스크립트가 되고, 이 폴백 플래그가 존재하는 이유인 엄격한 공급자가 정확히 그것을 거부한다. 따라서 final-only 모드에서 다음 모델 턴은 배치 전체가 final이 된 뒤에 시작된다.

**ADR 편차 명시:** ADR은 폴백이 "개별 완료 트리거 유지"를 포함한다고 썼다. lane 진행·완료 처리·이벤트는 개별 유지되지만, **개별 완료별 모델 턴**은 두 항목 패턴에서만 가능한 구조다(위의 dangling 논증). 연산자가 이 트레이드오프를 다시 판단할지 검토할 것 — 대안은 없다: final-only에서 개별 모델 턴을 허용하면 이 플래그의 대상 공급자가 런타임에 거부한다(ADR 공급자 다양성 리스크의 재현).

에비던스: `packages/turnloop/test/capability.test.ts` —
- `default keeps the two-item pattern: in-progress row issued and substituted in place`
- `inProgressToolResults: false records final-only — no in-progress rows ever enter the transcript` (역순 완료 → 발행 순서 final)
- `final-only mode still runs parallel lanes but the model turn waits for the whole batch`
- `final-only mode keeps per-completion processing and turn-boundary steering`
- `final-only mode keeps issuance-order finals for error results too`
- `TurnLoopProvider forwards the capability flag; the default stays two-item`

### 4. 이벤트 계약 동일성 (mixed-mode)

두 모드의 run은 이벤트 로그에서 구별되지 않는다. 기록은 전부 orchestrator가 `AgentProvider` 계약 뒤에서 수행하므로(ADR TL1 "기록은 orchestrator가 수행"), 동일성은 구조적이고 테스트가 이를 고정한다:

`packages/orchestrator/test/profile.test.ts` — `mixed-mode runs share one event-log contract (WorkerStarted/WorkerResult/GuidanceDelivered)`:
- 한 런에 pi lane(`FakeProvider`, tiny) + turnloop lane(`TurnLoopProvider`+`FakeModelClient`, fast)을 섞어 실제 Rust 백엔드로 실행.
- 두 태스크 모두 `worker_started`/`worker_finished` 이벤트가 동일 payload 키 집합으로 기록됨.
- 런 전에 추가한 run-wide guidance가 두 워커 모두에게 동일한 claim-context 주입 경로로 전달되고 `guidance_delivered` 워터마크가 동일 형태로 기록됨.

### 5. 기본 동작 에비던스 (pi lane default)

- 설정: `lane` 키 부재 → `ModelProfile.lane` undefined → 합성 분기 미진입. 기존 pi/codex/agy/zai 합성 코드는 한 줄도 바뀌지 않았다(분기 앞에 lane 조건만 추가).
- 테스트: 위 1절 첫 테스트가 lane 없음/명시 `"pi"` 모두 `PiProvider`임을 단언. 기존 전 스위트(`bun test packages/orchestrator packages/cli packages/turnloop` 205 tests)가 무변경 통과.

### 6. 모델 id/엔드포인트 위치 확인 (`rg` 기반, ADR M-TL3 기준 3)

```
$ rg -n 'gpt-|glm-|gemini-|https?:\/\/|apiKey|api_key' packages/turnloop/src
  (hit 없음 — 어댑터 소스에 모델 id·엔드포인트·자격증명이 존재하지 않음)

$ rg -n 'endpoint|modelId|apiKeyEnv' packages/orchestrator/src/composition.ts
  176: baseUrl: required(providerConfig.endpoint, ...)   ← providers.toml에서만
  173: environment[providerConfig.apiKeyEnv]              ← 환경변수 이름만 설정에서
  303: modelId: model.id                                  ← models.toml에서만
```

turnloop 바인딩(`TurnLoopWorkerBinding`)도 동일 규칙: 값은 임베딩 앱의 생성 closure에서만 들어오고 로그·영속화되지 않는다. `packages/turnloop/test/boundaries.test.ts`가 소스 레벨 금지를 계속 강제한다.

### 7. 남은 것 / 리스크

- **실제 ModelClient 미배송 (의도됨):** turnloop lane의 실공급자 클라이언트와 실측(캐시 히트율, in-progress 수용)은 ADR M-TL4. 그때 `[providers.turnloop]` 블록(endpoint/api_key_env)과 기본 바인딩을 추가하는 자리가 된다.
- **MirroringProvider가 `steerDelivery`를 전달하지 않음 (M-TL2 잔여, 이번 스코프 밖):** `packages/providers/src/mirror.ts`의 래퍼는 `steer`는 위임하지만 `steerDelivery` 프로퍼티는 노출하지 않아, `worker_visibility: panes` 환경에서 turn-boundary 워커의 메일박스 정책이 `"inbox"` 대신 `"window"`로 읽힌다(전달은 되지만 스팸 윈도우 지연이 붙는다). `packages/providers`가 이 태스크의 쓰기 스코프 밖이라 수정하지 않았다 — 별도 수정 권고.
- **`lane` 값 확장:** 새 레인(예: 다른 자체 엔진)은 `WorkerLane` 유니언과 `workerLanes` 집합, `buildProviderRegistry` 분기 세 곳만 늘리면 된다. 루프코어·프로토콜에는 아무것도 추가되지 않는다(이번 변경으로 codegen 차이 없음 확인).
