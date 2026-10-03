# Own Model Turn Loop + Sub-agent Injection Steering — async-tools 채택 결정 개정

- **Date:** 2026-09-26
- **Status:** decided (supersedes parts of `2026-xx-async-tools-adoption.md`)
- **Kind:** decision
- **Supersedes:** `docs/decisions/2026-xx-async-tools-adoption.md`의 **(N1) 자체 모델 turn loop 기각**과 **(N2) 서브에이전트 관련 판단 일부**. 동 문서의 A1~A3(pi 배치 병렬 보존, completion check 병렬, `GuidanceDelivered` 이벤트)와 N3(인터럽트형 스티어링 기각)는 그대로 유효하며 본 문서가 다시 판단하지 않는다.
- **Input:** `docs/research/async-tools-unreal-pattern.md` (file:line 증거), `docs/research/async-human-input.md` (메일박스 설계, §6 전파 논의), `docs/research/references/unreal-agent.html` (원문, 각주 2 포함), `packages/orchestrator/src/**`, `packages/providers/src/**`, `packages/herdr/src/**` 코드 증거
- **운영자 지시:** 기존 결정의 N1(자체 모델 턴 루프 기각)을 경계 준수를 전제로 다시 검토하고, 서브에이전트는 제거가 아니라 주입 방식으로 활용한다.

## 결정 (한 단락)

Loop는 **선택적 자체 모델 turn loop 실행 모드를 채택**하되, 소유를 어댑터 레이어에 고정한다 — 소유 패키지는 신규 어댑터 **`packages/turnloop`**(providers 어댑터와 같은 계층, `AgentProvider`를 구현하는 worker 어댑터)이며, 이 패키지는 (i) `loop-core`/`loop-store`/`loop-bridge`를 import하지 않고 `@loop/protocol` 생성 타입만 사용하고, (ii) 이벤트를 직접 append하거나 프로젝션을 읽지 않고(WorkerStarted/WorkerResult/steer는 orchestrator가 기존 경로로 기록), (iii) 그래프 스케줄링·run 상태·모델 레지스트리 정책을 소유하지 않으며, (iv) 모델 ID·엔드포인트·자격증명을 설정/어댑터 생성자에서만 받고 로그에 남기지 않는다. 프로토타입 범위는 유계다 — **M-TL1이 in-progress/final 툴 결과 항목과 턴당 병렬 툴 레인을, M-TL2가 다음 턴 경계 스티어링 주입과 `GuidanceDelivered` 영속화를 증명**하고, 그 이상(세션 UI, 확장 시스템, 다중 provider zoo)은 pi 하니스의 영역으로 가져오지 않는다. turn loop는 pi 기반 worker를 **대체하지 않고 공존**한다 — 기본 실행 모드는 pi lane 그대로이고, turn loop는 어댑터 생성 설정에서 명시적으로 선택된 worker 프로파일(예: 게이트웨이/앱 경로의 특정 프로파일)에만 적용되며, 이벤트 로그 수준에서 두 모드의 run은 구별되지 않는다(같은 WorkerStarted/WorkerResult 계약). **서브에이전트는 유지**되고, 스티어링은 **주입(injection)** 으로 하위 태스크 worker까지 도달한다 — `GuidanceAdded`가 대상 태스크 T에 append되면 (a) 실행 예정인 T의 이행 종속(descendant sub-task)들은 다음 클레임 시 조상 guidance가 `get_task_context`에 주입되고(어느 guidance가 어느 컨텍스트에 들어가는지는 loop-core의 결정론적 프로젝션 규칙), (b) 이미 실행 중인 T와 descendant의 라이브 worker는 메일박스가 `provider.steer`로 개별 전달하며 worker별 `GuidanceDelivered`로 워터마크를 남긴다. Claude Code의 `subagent_steer`와 달리 전달 책임은 하니스가 아니라 **부모 worker의 그래프적 표현**에 둔다 — 부모 worker는 자신의 메일박스로 steer를 받아 다음 턴/클레임에서 하위 태스크 명세를 갱신할 책임이 있고, 오케스트레이터는 부모를 거치지 않고 그래프 규칙에 따라 주입만 한다(실행 중 worker에 대한 하니스급 전파는 Loop 그래프에서 존재하지 않는 부모-자식 프로세스 채널을 만들지 않기 위함). 나머지 Unreal 패턴 — pi 배치 경계 대기의 제거, 툴 실행 중 인터럽트형 스티어링, "no sub-agents" 철학 — 는 **별도 트랙(pi 업스트림/외부 관찰 트랙)으로 명시적으로 스코프 아웃**한다.

## 배경과 재판단 근거

기존 ADR(`2026-xx-async-tools-adoption.md`)은 N1을 "orchestrator가 자체 모델 turn loop를 가져야 한다"는 전제로 기각했다. 이 전제가 틀렸다. turn loop의 소유는 orchestrator가 아니라 **어댑터**다. `loop-core → loop-store → loop-bridge → protocol → orchestrator → adapters` 위계에서 어댑터는 이미 `AgentProvider` 뒤에서 worker 프로세스를 소유하고(`packages/providers/src/types.ts`), orchestrator는 provider 종류를 모르는 dispatch/cancel/result 루프다(`packages/orchestrator/src/coordinator.ts`). turn loop worker는 "pi 프로세스를 띄우는 worker"가 "자체 루프를 도는 worker"로 바뀔 뿐이고, loop-core가 보는 것은 동일한 이벤트 시퀀스다. 즉 **하니스 이중화도, orchestrator의 provider 개념 흡수도 일어나지 않는다** — 기각 사유였던 경계 침해가 실제로는 발생하지 않는 구조였다. 운영자는 이 점을 반영해 N1 기각을 개정했다.

N2는 개정이 아니라 명확화다. Unreal의 "no sub-agents"는 여전히 채택하지 않는다(그래프 우선 정체성). 다만 기각 문서가 "서브에이전트를 쓰지 않는다"로 읽힐 여지가 있었으므로, 본 문서는 서브에이전트(하위 태스크 worker)를 **유지하며 steer가 그들에게 주입으로 도달하도록 설계**를 확정한다.

## 채택 항목

### TL1 — 선택적 own turn loop 실행 모드 (소유: `packages/turnloop`)

- **위치:** `packages/turnloop` — 어댑터 계층. `AgentProvider`를 구현해 orchestrator에 기존 worker와 동일한 계약(`startWorker`/`result`/`steer?`)으로 붙는다. `packages/providers`에 넣지 않는 이유: providers는 기존 CLI 하니스(pi/codex/agy) 정규화가 책임이고, turn loop는 자체 실행 루프라 의존성(모델 클라이언트, 툴 러너)이 다르다. 별도 패키지로 경계를 명시한다.
- **하지 말 것 (위반 시 아키텍처 테스트가 실패해야 함):**
  - `loop-core`/`loop-store`/`loop-bridge` import 금지 — `@loop/protocol` 생성 타입만.
  - 이벤트 append / 프로젝션 질의 금지 — 기록은 orchestrator가 `WorkerStarted`/`WorkerResult`/`GuidanceDelivered`로 수행.
  - 그래프 스케줄링·run 상태·attention 개념 금지.
  - 모델 ID·엔드포인트는 어댑터 생성자/설정에만, 자격증명 로깅·영속화 금지.
  - Rust 도메인 타입의 TS 복제 금지 (생성 타입만 사용).
- **왜 pi 하니스의 전면 복제가 아닌가:** 프로토타입이 요구하는 것은 (1) in-progress/final 항목이 있는 컨텍스트 조립, (2) 툴 완료 트리거 다음 턴, (3) 턴당 병렬 레인, (4) 턴 경계 steer 주입 — 네 가지뿐이다. pi의 세션 트리·확장·UI·RPC·provider zoo는 요구 밖이며, Loop는 이미 이벤트 로그·그래프 스케줄·메일박스를 소유하므로 pi가 제공하는 나머지 기능이 turn loop에 필요 없다. 재사용하는 것은 `AgentProvider` 계약과 프롬프트 조립 어댑터뿐이다. turn loop가 네 가지를 pi 업스트림보다 먼저/확실하게 증명하지 못하면 폐기하고 pi lane으로 회귀한다 — 회귀 비용이 0인 것이 이 결정의 구조적 안전장치다.
- **pi 기반 worker의 운명:** 변경 없음. 기본 프로파일은 pi lane이고, turn loop는 설정에서 선택된 프로파일에만 적용된다. 두 모드가 같은 run에서 혼재돼도 이벤트 로그 계약은 동일하다.

### TL2 — 서브에이전트 steer 주입 (제거가 아니라 전파 설계)

- **수신:** 기존 표면 그대로 — `loop steer` / watch relay → `steerRun` → `GuidanceAdded` append. 즉시·비차단.
- **주입 경로 (결정론은 Rust):** loop-core 프로젝션 규칙 — 태스크 T에 추가된 guidance는 (a) T의 클레임 컨텍스트에, (b) T를 선행 의존으로 갖는 이행 종속 태스크(= T worker가 `loop_run`으로 만든 sub-task)의 클레임 컨텍스트에 주입된다. 주입은 다음 클레임 시점에 `get_task_context`가 수행하므로 재시도·신규 클레임 모두를 커버하고, 중복은 `GuidanceDelivered` 워터마크로 흡수한다.
- **라이브 전달:** 실행 중인 T와 descendant의 worker 중 steer 가능 provider(pi 라이브 대화, TL1 turn loop의 턴 경계)는 메일박스가 개별 전달하고 worker별 `GuidanceDelivered { task_id, worker_id, through_sequence }`를 남긴다. 이 이벤트는 기존 ADR A3/M2와 동일한 Rust-first + codegen 절차를 따른다.
- **부모 worker의 책임:** 하니스가 sub-agent 프로세스에 몰래 메시지를 넣는 Claude Code 방식과 달리, Loop에서 실행 중 descendant worker에 대한 "전달"은 그래프 규칙(주입)이고, 부모 worker의 책임은 **steer를 받은 뒤 자기 하위 태스크 명세를 갱신하거나 완료 계약에 반영하는 것**이다. 부모가 종료한 뒤 도착한 steer는 descendant의 클레임 컨텍스트 주입으로만 흐른다 — 이는 어쩔 수 없는 게 아니라 의도된 설계다(부모 없는 그래프 노드는 그래프가 책임진다).

### TL3 — 나머지 Unreal 패턴: 별도 트랙으로 스코프 아웃

- pi 배치 전체 대기 → 개별 완료 트리거 전환, in-progress/final의 Responses API 표준화 동향 관찰(원문 각주 2), "no sub-agents" 비용 철학: 전부 `docs/research/async-tools-unreal-pattern.md` §5의 기존 외부 트랙(M3, pi 업스트림/관찰)에 잔류시킨다. Loop 코드베이스에서 이를 위한 작업을 하지 않는다.

## 명시적으로 다루는 리스크

### KV 캐시 접미사 무효화 (원문 각주 2의 "engineering challenge")

in-progress 항목 삽입 → final 치환 사이에 컨텍스트 접미사가 변한다. 치환 지점 뒤에 이미 붙은 다른 툴 결과가 있으면 무효화 범위가 그 뒤 전체로 번진다. 대응은 구조적 제약으로 고정한다:

1. in-progress 항목은 **형태 고정 템플릿**(고정 키 + 상태 필드 + 유계 미리보기)으로, 크기가 턴 내에서 변하지 않는다.
2. final 기록은 in-progress 슬롯의 **제자리 치환**이며, 최종 컨텍스트의 확정 순서는 항상 toolCall 발행 순서다(pi의 `orderedFinalizedCalls`와 동일한 결정론).
3. 레인 폭(동시 툴 수)은 설정화된 cap으로 유계화 — 최악 무효화 비용이 cap × 슬롯 크기로 상한이 있다.
4. steer는 항상 턴 경계 **뒤에 append**된다 — 접두사 무효화 없음.

무료 검증 한계: 실제 캐시 히트율은 유료 호출이 필요하므로 측정하지 않는다. 단위 테스트는 위 1~4의 **구조적 성질**(형태 고정, 제자리 치환, 순서 보존, append-only steer)만 증명하고, 실측은 M-TL4(선택, 유료)로 분리한다.

### 공급자 다양성 (일부 공급자가 in-progress/final 거부 — 원문 각주 2)

두 항목 패턴은 미표준이며 일부 비(非)OpenAI 추론 공급자가 거부한다. 대응: 수용 여부는 **어댑터 설정의 프로바이더별 capability 플래그**(`inProgressToolResults: boolean`)로만 표현한다. 플래그가 거짓이면 turn loop는 final-only 기록으로 폴백하고(나머지 이점인 개별 완료 트리거·병렬 레인·턴 경계 steer는 유지), 참이면 두 항목 패턴을 쓴다. 플래그는 어댑터 생성 설정에만 존재하며 loop-core, 이벤트, 프로토콜 어디에도 새겨지지 않는다. 거부가 런타임에 발견되면(공급자 에러) 해당 worker는 기존 `ProviderFailureKind` 계약으로 실패 보고 → orchestrator의 재시도 경로가 처리한다(새 메커니즘 없음).

### 유료 모델 호출 금지

M-TL0~TL3 전부 가짜 모델 클라이언트(스크립트된 턴)로 검증한다. 실제 공급자 행동 확인(캐시 히트율, in-progress 수용)은 M-TL4로 분리하고, 이는 운영자가 별도 실행하는 실측 증거로 본 결정의 수용 기준에 포함되지 않는다.

## 마일스톤과 기계 검증 가능한 수용 기준

### M-TL0 — `packages/turnloop` 스켈레톤 + 가짜 모델 클라이언트

- 스코프: `packages/turnloop/**` 신규. 의존: 없음.
- 수용 기준:
  - `FakeModelClient`(스크립트된 어시스턴트/툴콜 시퀀스)로 turn loop가 `AgentProvider.startWorker → result` 계약을 수행함을 `bun test packages/turnloop`로 증명.
  - `bun run test:architecture`에 `packages/turnloop`가 `loop-core`/`loop-store`/`loop-bridge`를 import하지 않는다는 경계 검사가 포함되고 통과.
  - `bun run codegen:check` 통과(신규 이벤트 없음을 확인).

### M-TL1 — in-progress/final 항목 + 턴당 병렬 툴 레인

- 스코프: `packages/turnloop/**`. 의존: M-TL0.
- 수용 기준 (전부 가짜 클라이언트, 유료 호출 0):
  - 툴콜 발행 즉시 고정 형태 in-progress 항목이 컨텍스트에 append되고, 완료 시 해당 슬롯이 제자리 치환됨 — 컨텍스트 스냅샷 비교 테스트.
  - 최종 컨텍스트의 툴 결과 순서가 toolCall 발행 순서와 일치함(완료 시간과 무관) — 뒤집힌 완료 순서 테스트.
  - cap 미만의 N개 레인이 실제로 동시 실행됨(가짜 툴의 완료 개입 순서로 관찰), cap 초과는 큐잉 — cap 설정 가능.
  - `sequential` 선언 툴은 자기 레인만 직렬화하고 타 레인을 막지 않음.
  - steer 없는 상태에서 컨텍스트가 턴 경계에서 append-only임(접두사 안정) — 스냅샷 테스트.

### M-TL2 — 턴 경계 steer 주입 + `GuidanceDelivered` 영속화

- 스코프: `packages/turnloop/**`, `packages/orchestrator/src/mailbox.ts`, `crates/loop-bridge/**`, `crates/loop-core/src/event/**`, `bun run codegen`. 의존: M-TL1, 기존 ADR M2(`GuidanceDelivered` — 선행 또는 동반 구현).
- 수용 기준:
  - **Rust 먼저:** `GuidanceDelivered`(및 descendant 주입에 필요한 프로젝션 필드가 있다면 그것)가 `crates/loop-bridge` Rust 타입으로 선변경되고 `bun run codegen:check` 통과. 생성 파일을 Rust 변경과 함께 커밋.
  - `cargo test -p loop-core -p loop-bridge` — (a) 워터마크 프로젝션이 시퀀스 오름차순으로만 진행, (b) 태스크 T의 guidance가 T의 이행 종속 태스크 클레임 컨텍스트에 주입되고 무관한 태스크에는 나오지 않음(결정론).
  - `bun test packages/turnloop` — 런 도중 append된 steer가 현재 턴을 중단하지 않고 다음 턴 컨텍스트에 정확 1회 나타남(at-most-once, 워터마크 기준).
  - `bun test packages/orchestrator` — 메일박스가 라이브 turn-loop worker와 pi worker에 동일 계약으로 전달하고, 전달 실패 시 guidance가 프로젝션에 남아 다음 클레임에 주입됨.
  - `bun run test:architecture` 통과.

### M-TL3 — capability 게이팅 + 프로파일 선택 와이어링

- 스코프: `packages/turnloop/**`, `packages/providers/src/registry.ts` 또는 어댑터 생성 설정, 설정 문서. 의존: M-TL2.
- 수용 기준:
  - `inProgressToolResults: false`인 프로바이더 프로파일은 final-only 기록으로 폴백함을 테스트로 증명(두 항목 패턴 부재 + 개별 완료 트리거/병렬 레인/턴 경계 steer 유지).
  - 기본 프로파일은 pi lane임을 설정 기본값 테스트로 증명 — 기존 pi worker 동작 변경 0.
  - 모델 ID/엔드포인트가 설정·생성자에만 존재함을 `rg` 기반 확인으로 기록.
  - `bun run check` 전체 통과.

### M-TL4 — (선택, 유료) 실측 게이트

- 실제 공급자 대상 in-progress 수용 여부와 캐시 히트율 측정. 유료 호출을 수반하므로 단위/마일스톤 검증 대상이 아니며, 본 결정의 채택 여부와 독립이다. 결과는 별도 research 노트로 기록.

## 경계 준수 요약

- **Rust-first 이벤트 + codegen:** 신규 이벤트·프로젝션 필드는 전부 `crates/loop-bridge`/`crates/loop-core`에서 먼저 정의하고 `bun run codegen`으로 생성 파일을 함께 커밋한다. TS 복제 타입을 만들지 않는다.
- **결정론 정책은 Rust:** 어느 guidance가 어느 태스크 컨텍스트에 주입되는지(descendant 규칙), 워터마크 진행 규칙은 loop-core 리듀서/프로젝션이 소유한다. 레인 cap, 응집 창, 프로바이더 capability 플래그 같은 튜닝값은 어댑터 설정에 둔다.
- **어댑터는 얇게:** turn loop는 `AgentProvider` 계약만 구현하고 orchestrator·coordinator 변경은 M-TL2의 메일박스 전달 확장이 전부다. orchestrator는 worker가 pi인지 turn loop인지 모른다.
- **loop-core에 provider 금지:** turn loop, in-progress/final, capability 플래그, 모델 개념 중 loop-core에 새로 유입되는 것은 없다. 새 이벤트는 전달 기록(`GuidanceDelivered`)뿐이다.

## 리스크

- **turn loop가 pi의 성숙도(툴 견고성, 컨텍스트 관리)를 따라잡지 못할 가능성** → 기본은 pi lane 유지, turn loop는 명시적으로 선택된 프로파일에만. 실험 실패 시 패키지 폐기로 회귀 비용 0.
- **descendant 주입 규칙이 guidance를 과도하게 번식시킬 가능성**(`async-human-input.md` §1.4의 무한 `Vec<Guidance>` 성장 문제와 결합) → 주입 규칙은 워터마크와 만료 정책(별도 결정 항목)과 함께 Rust 테스트로 유계 확인.
- **in-progress/final 비표준 의존** → capability 플래그 + final-only 폴백으로 기능 손실을 "두 항목 표시"로 한정.
- **메일박스 전달 확장이 orchestrator를 비대하게 만들 가능성** → 전달 정책(누구에게 무엇을)은 이미 메일박스 어댑터 메모리 안에 있고, 새로 늘어나는 것은 descendant 대상 추가뿐임을 M-TL2 테스트로 고정.

## 미해결 항목

- descendant 주입의 깊이 제한(직계만 vs 이행 전체)과 guidance 만료 정책 — M-TL2 착수 시 Rust 테스트와 함께 확정.
- turn loop 적용 대상 프로파일의 구체 정의(게이트웨이/앱 경로 중 어디 먼저) — M-TL3 착수 시 운영자 확인.
- 레인 cap 기본값 — M-TL1 착수 시 확정.
