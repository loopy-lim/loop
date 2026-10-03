# 앱 프롬프트의 실제 Loop 실행 연결 — planner 교체, 실제 run 노출, worker 출력 매핑

- **상태:** 결정됨
- **태스크:** `real-planner-decision`
- **결정 종류:** `decision`
- **작성일:** 2026-xx
- **선행 결정과의 관계:** [`2026-xx-remote-app-architecture.md`](2026-xx-remote-app-architecture.md)의 wire contract와 소유권 경계를 **위배하지 않고** 그 위에서, 동일 문서 §5 composition root가 참조하던 `stubPromptPlanner`(결정론적 단일 태스크 가짜 plan, `packages/gateway/src/main.ts:82,123`)의 동작을 **대체(supersede)** 한다. [`2026-09-23-worker-visibility.md`](2026-09-23-worker-visibility.md)의 activity 이력·미러 아키텍처를 그대로 재사용한다.
- **읽기 범위:** `AGENTS.md`, `crates/loop-core/src/**`, `docs/decisions/2026-xx-remote-app-architecture.md`, `docs/design/ui-ux-guidance.md`, `packages/cli/src/**`, `packages/gateway/src/**`, `packages/herdr/src/**`, `packages/orchestrator/src/**`
- **쓰기 범위:** 이 결정 문서만

## 1. 배경

게이트웨이는 wire contract를 검증 가능하게 하려고 `stubPromptPlanner`로 앱 프롬프트를 provider·모델 없는 결정론적 단일 태스크 plan(`createRun` + `submitPlan` 한 건, 실행 owner 없음)으로 바꿔 왔다. 그 결과 (1) 시뮬레이터 쇼케이스가 실용성 없는 스텁을 보여줬고, (2) 앱 제출 프롬프트가 실제 worker 실행으로 이어지지 않으며, (3) `GET /v1/runs`가 transient submission registry의 in-memory 목록만 반환해 실제 터미널 Loop의 run(`loop.sqlite`에 있는 run들)이 앱에 보이지 않는다.

사실 확인:

- `PromptPlannerPort.begin(input, handle)`(`packages/gateway/src/service.ts`)은 이미 "plan 제출까지"를 계약으로 갖는 올바른 seam이다. 스텁은 seam이 아니라 **seam 뒤의 구현**이 문제다.
- `LoopRuntime.prepare(input)` / `execute(runId, signal)`(`packages/orchestrator/src/runtime.ts`)이 이미 존재하고, `Orchestrator.prepare`는 run을 durable하게 만들고 plan을 커밋하며, `execute`는 provider registry로 worker를 실제 실행한다. CLI의 `verifyInstall` 경로가 이 조립의 선례다.
- `protocol.listRuns({ databasePath })`와 `protocol.getSnapshot`이 이미 `loop status`/`loop runs`가 소비하는 실제 run 조회 경로다.
- worker 출력은 오케스트레이터가 적목(`redactProviderText`)·1 Hz 스로틀 후 `control.recordActivity`로 저장하고(`task-execution.ts`, worker-visibility D3), 스냅샷이 bounded `tasks[].activities`로 노출한다. gateway의 `projectNewActivities`가 이미 이 윈도우를 `RemoteRunOutputEvent`로 증분 투영한다.
- loop-store는 `journal_mode = WAL` + `busy_timeout(5s)`(`crates/loop-store/src/schema.rs`, `sqlite.rs`)을 이미 쓴다.

## 2. 결정

**한 문단 요약(승인된 설계).** 앱 프롬프트의 실제 실행 진입점은 **헤드리스 `loop run` 서브프로세스가 아니라 gateway host 프로세스 안의 orchestrator hand-off**다: gateway는 기존 `PromptPlannerPort` seam을 유지한 채 스텁을 실제 planner로 교체하는데, 이 planner는 (a) 승인된 프로바이더 설정 하에서만 실제 모델로 prompt→plan 해석을 수행하고(원격 앱 ADR D3의 Pi adapter lane), 승인이 없으면 (b) 기본 **deterministic-local planner**가 prompt를 Loop의 표준 그래프 템플릿(research → decision → implementation → verification)으로 결정론적으로 분해한다. plan이 나오면 `protocol.createRun` + `protocol.submitPlan`으로 durable run을 만들고, 같은 host의 `LoopRuntime.prepare`/`execute(runId, signal)`에 fire-and-forget으로 실행을 넘긴다. provider registry는 composition root가 `providers.toml`/`policy.toml` 구성으로만 조립하며 **기본값은 deterministic-local(FakeProvider 계열)이고, 실제 유료 provider는 운영자가 구성에서 명시적으로 활성화한 프로바이더로만 한정**된다(요청으로 provider/model/endpoint를 받는 것은 여전히 금지). `GET /v1/runs`는 transient registry와 **`protocol.listRuns(databasePath)`의 실제 run들을 runId로 병합**해 반환한다(durable이 우선, 중복 제거, 정렬·커서 규칙은 ADR §4.4 유지). worker 출력은 herdr 미러 경로를 wire에 노출하지 않고(ADR D3: herdr는 로컬 관찰 전용), **저장소 activity 이력이 유일한 wire 원천**이다 — 오케스트레이터가 적목·스로틀 후 기록한 bounded `tasks[].activities`를 기존 `projectNewActivities`가 `RemoteRunOutputEvent`로 증분 매핑한다. `loop.sqlite` 동시 접근은 **짧은 수명의 연결을 호출마다 여닫는 bridge 호출 모델 + WAL + busy_timeout(5s)** 으로 안전하다. gateway와 CLI(같은 호스트의 읽기)·orchestrator writer가 병행해도 readers는 writer를 막지 않고, gateway는 트랜잭션을 소유하지 않으므로 추가 잠금 계층을 만들지 않는다.

### D1. 진입점 — plan seam 유지, 실행은 in-host orchestrator hand-off

- **채택:** planner port 계약을 유지한다(`begin` → `markPlanning`/`planningFailed`, 완료 시 durable). planner의 책임 끝은 plan 제출까지이고, **실행은 composition root가 소유한 `LoopRuntime`에 위임**한다: `createRun`+`submitPlan` 직후 `LoopRuntime.prepare(...)`로 plan을 검증·커밋하고 `execute(runId, abortSignal)`를 fire-and-forget 호출한다. abort signal은 gateway 종료 시 조립되고, client disconnect는 여전히 cancel이 아니다(ADR §5).
- **기각 1 — gateway가 `loop run`/interactive Lead를 서브프로세스로 spawn:** config 해석·provider 조립·stderr 운반이 프로세스 경계 밖으로 새고, SSE 재연결·커서 복원이 파일/프로세스 감시에 의존하게 된다. gateway adapter가 "thin"이 깨진다.
- **기각 2 — gateway가 plan을 만들지 않고 orchestrator에 raw prompt를 전달:** orchestrator/generated protocol seam은 `TaskSpecInput[]`만 안다(AGENTS 경계). raw prompt 해석은 adapter 레인의 책임이며, ADR D3가 이 방향을 이미 고정했다.

### D2. 비용 게이팅 — 구성에서만, 기본 deterministic-local

- **채택:** provider·모델 ID는 composition root의 구성(`providers.toml`, `policy.toml`, 환경변수 이름만)에만 존재한다. 기본 구성은 deterministic-local provider(FakeProvider 계열, 무료)만 registry에 넣는다. 실제 provider 레인은 운영자가 구성에서 명시적으로 활성화한 프로바이더로만 조립되며, planner lane도 동일 게이트를 통과한다. 재시연·테스트는 항상 deterministic-local로 수행한다. 유료 호출은 운영자가 명시한 최소 실측 외 금지(이번 인텐트의 제약)를 구현 수준에서 재확인한다.
- **기각 — 요청 필드로 provider/model 선택 허용:** ADR §4.3이 이미 금지("working directory, provider, model, endpoint는 요청할 수 없다"). 유지한다.

### D3. `GET /v1/runs` — 실제 loop.sqlite run 병합 노출

- **채택:** `GatewayService.listRuns`가 transient registry(accepted/planning/failed)와 **durable run 소스(`protocol.listRuns(databasePath)` + 개별 `getSnapshot` 투영)** 를 runId 기준으로 병합한다. durable 레코드가 동일 runId의 transient 레코드를 대체한다. 정렬(createdAt 내림, runId 내림 tie-break), opaque cursor, `limit` 1..100 규칙은 ADR §4.4를 그대로 따른다. snapshot fetch 실패의 개별 run은 `503 runtime_unavailable`로 전체를 실패시키지 않고 목록에서 생략하지 않는다 — 마지막 캐시가 없으면 해당 run은 status `unknown` 대신 목록에서 제외하고, 단건 조회에서만 503을 낸다(목록 가용성 우선).
- **기각 — gateway가 loop.sqlite를 직접 읽기:** gateway는 생성 protocol(Rust bridge)을 통해서만 store를 안다(ADR D3). TypeScript에서 SQL을 열면 타입 경계와 동시성 정책이 복제된다.

### D4. worker 출력 → `RemoteRunOutputEvent`

- **채택:** wire 원천은 **저장소 activity 이력** 하나다. worker-visibility D3의 기록 경로(적목 → 1 Hz 스로틀 → `recordActivity` → reducer의 bounded 이력)가 이미 유계를 보장하므로, gateway는 snapshot 폴링 펌프에서 기존 `projectNewActivities`로 윈도우 증분을 `output` 이벤트로 낸다. 변경 없이 기존 매핑을 그대로 사용한다. herdr 미러·패널은 로컬 관찰 표면으로 남고 wire로 나가지 않는다(ADR D3, "Herdr adapter (로컬 관찰; wire에 노출하지 않음)"). intent의 "worker-visibility 미러/이벤트에서 매핑"은 미러 파이프라인이 만든 **저장소 sink 결과**를 의미한다로 해석·확정한다. lossless pane transcript는 v1 범위 밖이다.
- **기각 — `herdr pane` 텍스트를 gateway가 tail:** herdr를 wire 전송 계층으로 승격하는 것이고 원격 앱 ADR이 명시적으로 배제했다.

### D5. sqlite 동시 접근

- **확정:** loop-store는 WAL + `busy_timeout(5s)`를 이미 쓰고, bridge 호출은 호출별 단기 연결 모델이다. gateway(읽기 폴링·목록), CLI(같은 데이터베이스 경로의 읽기), orchestrator(쓰기)가 병행해도 WAL readers가 writer를 막지 않고 busy_timeout이 잠금 경합을 흡수한다. 추가 조건: gateway는 단일 트랜잭션을 소유하지 않고, 폴링 주기(150 ms)는 기존 값 유지, 데이터베이스 경로는 `LOOP_GATEWAY_DATABASE_PATH`로 orchestrator composition과 동일 값을 공유한다. 이 조건을 깨는 변경(장기 연결 보유, gateway 측 쓰기)은 후속 ADR 없이 금지한다.

### D6. 스텁 처리 — 제거, 테스트 픽스처로 격리

- **채택:** `stubPromptPlanner`와 단일 태스크 `taskFor`를 `packages/gateway/src/main.ts`에서 **삭제**한다. 와이어 회귀 테스트에 필요한 만큼만 테스트 픽스처(예: `packages/gateway/test/fixtures/`)로 이동하고 프로덕션 진입점에서는 참조하지 않는다. deterministic-local planner(D1-b)는 스텁이 아니라 단일 태스크가 아닌 표준 그래프 템플릿과 실제 실행 hand-off를 갖는 **기본 planner 구현**이므로 제거 대상이 아니다.
- **UI 참고:** 앱 화면의 중앙 정렬 등 렌더링 결함 수정은 구현 태스크에서 `docs/design/ui-ux-guidance.md` §2(위계는 위치·분리 먼저, 최상위 행 = 최우선 정보, 좌측 정렬 리듬)를 근거로 처리한다. 본 결정의 범위 밖이다.

## 3. 수용 기준 (기계 검증 가능)

1. **submitted-prompt-produces-real-run:** deterministic-local 구성에서 `POST /v1/runs`로 프롬프트를 제출하면, 같은 `databasePath`에 대해 `protocol.listRuns({ databasePath })`에 해당 `runId`가 존재하고 `protocol.getSnapshot`의 `tasks`가 단일 `gateway-app` 태스크가 아닌 다중 태스크 그래프(research·implementation·verification 계열)이며, 완료 시 `loop status`와 동일한 상태(source: snapshot.state)에 도달한다. 테스트: `bun test packages/gateway` ( FakeProvider, 유료 호출 0).
2. **app-run-list-matches-loop-runs:** gateway `GET /v1/runs`의 durable runId 집합이 `protocol.listRuns({ databasePath })`의 runId 집합과 일치한다(transient accepted/planning 레코드 제외 비교). 테스트: gateway 통합 테스트에서 두 목록 비교.
3. **worker-output-carries-real-content:** FakeProvider가 출력한 알려진 줄이 해당 plan `taskId`를 가진 SSE `output` 이벤트로 도착한다(`activityId` 형식 `<seq>:<taskId>:<idx>`, text 비어 있지 않음). 테스트: `observeRun` intro+live 프레임 검사.
4. **stub-removed:** `grep -R "stubPromptPlanner" packages/gateway/src` 결과가 0건이고, `packages/gateway/src`에서 `echo` 완료 검사 스텁 plan이 생성되지 않는다. 테스트: `bun run test:architecture` 또는 grep 기반 체크를 게이트에 추가.
5. **boundaries:** `packages/gateway/src`에 provider·모델 ID 리터럴이 없고(구성 파일에서만), `crates/loop-core/src`에 provider/Pi/Herdr/HTTP 개념이 없다(기존 architecture 테스트로 강제). activity 기록의 `[credential]=[redacted]` 적목 경로와 테스트는 변경 없음을 회귀로 확인한다.

## 4. 남은 위험

- deterministic-local planner의 그래프 템플릿이 프롬프트 의도와 어긋나면 "실제 같은" 오런이 된다 — 템플릿은 임시이며, 승인된 프로바이더 하의 Pi adapter plan lane이 후속 결정으로 이어진다.
- 목록 병합 시 `listRuns` + 개별 `getSnapshot`은 run 수에 비례하는 bridge 호출이므로, 페이지 `limit` 상한(100)에서 폴링 비용이 커질 수 있다 — v1은 limit 기본 20으로 완화하고, 필요 시 bridge에 일괄 요약 조회를 추가하는 후속 작업으로 분리한다.
- gateway host가 orchestrator를 소유하므로 host 프로세스 종료가 실행 owner 취소로 이어진다 — CLI 대비 새로운 수명 의미이며, 운영 문서에 명시한다.
