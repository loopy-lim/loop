# 리서치 fan-out 3/3: Loop 자체 분석 및 격차 도출

- 날짜: 2026-09-30
- 범위: Loop 저장소 자체 (README.md, docs/architecture.md, docs/model-routing.md, docs/reliable-runs.md, docs/provider-support.md, docs/decisions/2026-09-30-research-fanout-and-gpt-primary-routing.md, config/models.toml, config/policy.toml, crates/loop-core·loop-store·loop-bridge, packages/*)
- 방법: 1차 소스인 저장소 문서와 설정 파일을 직접 읽고 정리했다. 실측 벤치마크가 아니며, "격차"는 1/3(상용 하네스)·2/3(오픈소스 하네스) 섹션의 하네스 표준 기능과의 구조 비교에서 도출한 예상이다.
- 위치: fan-out 3편 중 3번째. 1/3은 `sections/closed-source.md`, 2/3은 오픈소스 하네스 섹션이다.

## Loop 아키텍처 요약

### 1. 그래프 기반 오케스트레이션 (typed task DAG)

- 자연어 intent는 Pi Lead 확장이 **검증된 typed task DAG**로 변환한다. 노드는 kind(implementation/decision/integration/verification 등), 의존성, 읽기·쓰기 범위(write scope), 완료 조건, 리스크 수준을 타입으로 선언한다.
- 스케줄링은 Rust 코어(`crates/loop-core`)가 결정적으로 수행한다: (1) 의존성 검증 및 사이클 거절, (2) 의존성이 충족된 pending/ready 선택, (3) 열린 attention이 있으면 배정 일시정지, (4) 전체/frontier 용량 한도(`policy.toml`: `max_parallel=6`, `max_frontier_workers=1`), (5) decision/integration 노드 직렬화(`decision_parallelism=1`, `integration_parallelism=1`), (6) 겹치는 쓰기 범위 동시 배정 거절(미선언 범위는 배타 취급), (7) 결정적 순서로 task ID 반환.
- 작업 상태 기계는 `Pending → Ready → Running → Verifying → Done`이며, 실패 시 상위 compute class로의 에스컬레이션, `Attention`, `Failed`(후손 `Blocked` 전파), `Cancelled`로 분기한다.
- 영속화는 SQLite 이벤트 로그(`crates/loop-store`)가 권위를 갖는다. 재시작 시 이벤트 재생 후 라이브 워커 관찰로 `Running`을 재판정한다(live → Running, exited → CompletedNeedsResult, missing → Lost + Attention). 소유권 임대가 이전 실행 프로세스의 늦은 결과를 거절한다.

### 2. Rust 코어 + TypeScript 어댑터 경계

- 계층 방향은 `loop-core → loop-store → loop-bridge → 생성 프로토콜 → orchestrator → 어댑터/UI`로 고정되어 있다(AGENTS.md 경계 규칙). 코어는 provider·모델·UI·SQLite 개념을 전혀 모른다.
- Rust 도메인 타입을 먼저 바꾸고 `bun run codegen`으로 TypeScript 계약(`packages/protocol`)을 생성한다. 손으로 쓴 TS 도메인 타입 복사본을 금지해 계약이 단일 소스(Rust)에서 흘러나온다.
- 공급자 이질성은 `AgentProvider` 계약 하나로 흡수한다: Codex, Antigravity, Z.AI, Pi, fake 어댑터가 이를 구현하며, 모델 ID와 엔드포인트는 `config/`와 어댑터 구성에만 존재한다. 자격 증명은 저장·로그 금지다.
- orchestrator(`packages/orchestrator`)는 워커 수명 주기 dispatch/cancel/result 루프만 하는 얇은 계층이고, 스케줄 규칙을 복제하지 않는다.

### 3. 완료 계약(completion check) 기반 검증

- `Done`은 실행 가능한 완료 계약 전부 통과가 필요조건이다. 워커의 성공 보고는 증거가 아니며, `RunCompleted`는 완료되지 않은 task가 하나라도 있으면 거절된다.
- 검증 실패의 정책은 실패 유형별로 갈린다: deterministic assertion 실패는 재시도·승격 없이 첫 실패가 terminal `Failed`; 모델 검증 실패는 시도 횟수를 증가시키고 compute class를 한 단계 승격(사다리: deterministic → typed_decision → tiny → fast → balanced → strong → frontier)하며, task 최대치를 넘으면 사람 attention으로 에스컬레이션한다.
- `loop verify-install`은 유료 호출 없이 7-task fake 시나리오로 이 전부(3개 병렬 리서치, 직렬화된 decision, 비겹침 구현 2개, 검증, fast→strong 자동 승격, 취소)를 증명한다.

### 4. compute class 라우팅

- 비즈니스 로직은 문자열 모델명이 아니라 compute class(deterministic / typed_decision / tiny / fast / balanced / strong / frontier)만 안다. 리스크가 하한을 올린다(high → strong, critical → frontier)——모두 코어의 결정적 정책이다.
- 실제 모델 배치는 `config/models.toml` 프로필만으로 교체된다. 2026-09-30 사용자 결정(쿼터 여유)에 따라 openai-codex `gpt-6.1-sol` 레인이 fast/balanced/strong의 primary로 올라가고 zai 볼륨 레인(`zai/glm-5.3-flashx`)은 폴백으로 내려간다. tiny은 zai primary를 유지, frontier는 bare `gpt-6.1-sol` 그대로다. `policy.toml`의 `routing.default_compute_class`도 balanced에서 fast로 변경된다.
- 이 교체가 코드 변경이 아니라는 점이 핵심 자산이다: 코어는 불투명한 후보 목록만 보므로 프로필 재정렬로 라우팅이 바뀐다. 대신 라우팅이 정적 배치 기반이라 요청 단위 auto 라우팅(Cursor Router, Warp auto 계열)의 실시간성은 없다.

### 5. attention / steer 메커니즘

- attention은 게이트다: 열린 attention 항목이 있으면 새 claim이 멈춘다. 질문·승인·실패는 `loop resolve`(approved/rejected/retry/cancel/답변)로만 해소되며 승인 항목은 명시적 `approved`를 요구한다. "worker 성공 ≠ 검증" 원칙과 함께 사람 개입을 물질적 판단으로만 좁힌다.
- steer(`loop steer <run-id> <task-id|all> <message>`)는 지침을 영구 저장해 이후 시작·재시도 작업에 반영하며, 진행 중인 모델 호출을 소급 수정하지 않는다. pause는 새 배정만 멈추고 실행 중 작업·검증은 마치게 한다.
- 관찰 표면은 `loop status/graph/watch/task`와 Pi `/loop *` 커맨드이며 출력 예산(상태 8줄, attention 6줄, findings 5줄)이 Lead 화면의 compactness를 강제한다.

## Loop의 강점 (타 하네스 대비)

1. **사전 검증되는 그래프가 오케스트레이션의 1급 단위다.** 의존성 사이클 거절, decision/integration 직렬화, 쓰기 범위 겹침 금지가 실행 전 코어 불변식이다. 타 하네스의 서브에이전트는 "모델이 필요하다고 판단하면 스폰"하는 런타임 자발 구조가 기본이며(Claude Code, Codex, Cursor, Warp), 부모 재량을 구조가 보증하지 않는다.
2. **완료가 실행 증거로 강제된다.** 완료 계약 전부 통과 없이는 `Done`이 불가능하고, 검증 실패가 결정적 클래스 사다리로 이어진다. 조사한 하네스 중 "완료 선언을 검사 출력으로 강제"하는 곳은 없었다. OpenHands Critic이 방향은 유사하나 예측 기반이지 실행 증거 기반이 아니다.
3. **모델이 아니라 클래스가 계약이다.** compute class 추상화 덕에 2026-09-30의 gpt-primary 승격과 같은 라우팅 전환이 `config/models.toml` 프로필 교체만으로 적용되고, 왜 바뀌었는지(쿼터 여유, 사용자 결정)가 결정 문서로 추적된다.
4. **이벤트 로그 권위 + 라이브 재조정으로 재시작을 정의한다.** 세션 체크포인트(타 하네스 표준)와 달리, 실행 중 오케스트레이션 상태를 이벤트 재생 + 워커 생존 관찰로 재구축하고 소유권 임대로 중복 배정을 막는다.
5. **경계가 문서·아키텍처 테스트로 이중 잠금이다.** 코어의 provider 무지, TS 얇은 어댑터, 생성 계약 단일 소스가 규칙이 아니라 검증 가능한 구조(`bun run test:architecture`)로 박혀 있다.
6. **사람 개입이 게이트로 모델링된다.** attention이 claim을 막고 steer가 영구 저장 지침으로 이어지는 구조는, 승인 UI(Cline/Roo)나 훅(Claude Code)과 달리 "언제 멈춰야 하는가"를 상태 기계에 넣은 것이다.

## 예상 격차 (타 하네스 대비)

1. **리서치 시 단일 워커로 처리되기 쉽고, 자동 fan-out이 기본값이 아니다.** fan-out은 2026-09-30에 Lead 페르소나 스탠딩 규칙(`config/personas/lead-default.md`)이 된 것으로, 코어·스케줄러가 강제하는 기본 동작이 아니다. intent→DAG 분해가 Lead(LLM)의 재량에 남아 있어, 리서치·탐색성 intent가 주제·소스별로 쪼개지지 않고 단일 워커 하나에 몰리면 병렬성과 소스 다양성이 무료로 손해본다. 대비: Claude Code `/deep-research`(소스 fan-out + claim 투표 교차검증), Codex multi-agent(기본 활성), Cursor explore 서브에이전트(병렬 검색 10개 권장)는 fan-out이 제품 기본값이다. Loop에서 리서치 fan-out을 구조적 기본으로 올리려면 (a) Lead 페르소나 규칙 준수에 의존하거나, (b) 리서치 kind task에 대한 분해 가이드/검증(예: 단일 리서치 task가 N개 이상 소스를 주장하면 경고) 같은 완화가 필요하다.
2. **컨텍스트 관리가 없다.** compaction/condensation 부재 — 긴 worker 출력·재시도 문맥이 그대로 쌓일 수 있다. 대비: OpenHands Condenser, Roo Intelligent Context Condensing, Gemini CLI 이력 압축, Claude Code compaction(`PreCompact`/`PostCompact` 훅).
3. **확장 생태계 표준이 없다.** MCP·스킬·플러그인 표준이 Loop 자체에는 없다(도구 확장은 Pi/어댑터 레벨). 조사 하네스에서 MCP 미지원은 Aider뿐 — 사실상 표준 미편입은 생태계 격차다. 코어가 아닌 어댑터 레벨 선별 채택이 경계를 지키는 방법이다.
4. **라이프사이클 훅이 외부에 노출되지 않는다.** 검증은 completion check로 강하지만 실행 중 개입 지점이 steer/attention뿐이다. 대비: Claude Code 훅 체계(PreToolUse/PostToolUse, 결정 JSON), Codex·Cursor의 subagentStart/Stop 훅 — worker 도구 호출 경계에 외부 검사기를 붙이는 지점이 없다.
5. **typed task 계약의 고정 비용이 작은 작업에도 든다.** DAG 검증이 강한 대가로, 단일 노드 fast path가 없어 즉흥적 위임·경량 fan-out이 계약 작성 비용을 요구한다. 대비: Cursor/Claude Code 서브에이전트의 "자체 컨텍스트 + 요약만 반환" 패턴은 DAG를 약화시키지 않고 컨텍스트 격리 이득만 이월 가능하다.
6. **관찰성이 텍스트 라인 중심이다.** `loop status/watch`와 compact 예산은 있으나 트랜스크립트 재생·부모/자식 그래프 시각화 대시보드는 없다. 대비: Warp Runs(parent/child 트리 트랜스크립트), Amp 스레드 공유.
7. **리서치 결과의 교차검증 계약이 표준화되어 있지 않다.** 완료 계약은 존재하지만, 리서치 task의 완료 조건을 "소스 교차확인·claim 검증" 같은 콘텐츠 품질로 채우는 표준 패턴이 없어 계약이 형식적 grep/파일 존재 검사로 퇴화하기 쉽다. 대비: Claude `/deep-research` claim 투표, Amp 오브의 "증명 남기기".

## 옮길 만한 방향 (격차 해소 후보, 우선순위 순)

1. **리서치 fan-out 기본화의 구조화** — Lead 페르소나 규칙을 넘어, 리서치 kind task의 분해 가이드라인과 단일 워커 몰아주기에 대한 완화(분해 권고 또는 소스 다양성 completion check)로 격차 1을 닫는다. DAG 계약은 유지된다.
2. **컨텍스트 condensation 설계 조사** — OpenHands Condenser·Claude Code compaction의 "무엇을 버리고 무엇을 보호하는지" 명시 계약을 worker 재시도 문맥과 Lead 상태 예산에 적용.
3. **최소 라이프사이클 훅** — completion check는 유지한 채 worker 도구 호출 경계에 외부 검사기 이벤트 지점 추가. 코어가 아닌 어댑터 경계에 둔다.
4. **서브에이전트 "요약만 반환" 규칙** — findings 5줄 예산과 결합하면 Cursor/Claude Code의 컨텍스트 격리 이득을 그대로 이월한다.

## 그대로 옮기지 않을 것

- **모델 재량 서브에이전트 스폰**: 쓰기 겹침 방지·직렬화 보장을 우회한다. fan-out이 필요하면 Lead가 그래프를 넓히는 방향이 계약을 유지한다.
- **요청 단위 auto 모델 라우팅**: 클래스 선택 이유가 흐려진다. 정적 프로필 + 결정적 사다리의 추적성이 자산이다.
- **클라우드 orb/런타임 이전(Amp orb, Warp Handoff)**: 멀티머신 요구가 실측되기 전에는 복잡성 대비 근거가 없다.

## 핵심 시사점

1. Loop의 "사전 검증 DAG + 완료 계약 + compute class 라우팅 + attention 게이트" 조합은 조사한 하네스 중 유일하며, 특히 완료를 실행 증거로 강제하는 하네스는 없다.
2. 가장 큰 구조적 격차는 fan-out이 아니라 그 이전 단계다: fan-out이 페르소나 규칙(재량)이라 리서치가 단일 워커로 몰릴 수 있고, 자동 fan-out이 기본값이 아니다.
3. 그 다음 격차는 컨텍스트 관리와 확장 생태계(MCP/훅 표준)로, 둘 다 코어 경계를 침범하지 않고 어댑터·Lead 레벨에서 부분 해소 가능하다.
4. 2026-09-30 라우팅 전환(gpt-6.1-sol을 fast/balanced/strong primary로, default_compute_class=fast)은 이 격차 논의와 무관하게 클래스 추상화 덕에 설정 변경만으로 적용된다 — 이 추적성은 Loop 고유 자산이다.
