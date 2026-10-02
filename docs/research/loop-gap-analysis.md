# Loop 갭 분석 종합 및 채택 권고

- 작성일: 2026-09-30 (synthesis task, attempt 0)
- 입력: [harness-advantages-cli.md](harness-advantages-cli.md) (6개 하네스, 25개 장점 항목), [harness-advantages-platform.md](harness-advantages-platform.md) (6개 관점, 24개 항목), [loop-feature-inventory.md](loop-feature-inventory.md) (55개 항목: ✅40 / 🟡8 / ⛔7), [README](../../README.md), [ADR cleanup-and-retention](../adr/cleanup-and-retention.md)
- 방법: 세 조사의 장점 항목을 중복 병합해 **21개 갭**으로 정규화하고, 각 항목에 권고·우선순위·변경 범위를 부여했다. 판정은 기능의 유무이며 품질 우열이 아니다. 문서·코드 정독 기반이며 실측·유료 모델 호출은 없다. 외부 제품 기능은 공개 문서 기준으로 변동 가능하다(개별 출처는 입력 문서 참조).
- 우선순위 정의: **P0** = 다음 실행 사이클에 즉시 착수(사용자 신뢰·장기 run 품질에 직격), **P1** = 다음 마일스톤, **P2** = 수요·여유 확인 후. 변경 범위 레이블: `rust-core` / `bridge` / `orchestrator` / `adapter` (문서·config 수반은 별도 표기). 우선순위 판단 기준은 (1) 사용자 체감 영향, (2) 경계 호환성(AGENTS.md 위반 여부), (3) 구현 비용의 순이다.

## 1. 종합 갭 표

### A. 컨텍스트 관리

| # | 장점 (출처 하네스) | Loop 현재 상태 | 사용자 체감 영향 | 채택 권고 | 우선순위 | 변경 범위 |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | 긴 실행의 자동 컨텍스트 압축 (Claude compaction, Gemini 자동 압축, Codex `/compact`) | 자동 압축 없음. 작업 컨텍스트 주입(`packages/orchestrator/src/task-execution.ts`)과 출력 라인 예산만 존재 (inventory #27·#28) | 장기 run에서 초기 지침·근거가 문맥 한도에 밀리고 재시도 이력이 누적되어 worker 품질이 저하된다. 6개 CLI 하네스 중 다수가 기본 동작으로 제공하는 가장 보편적 차이 | **도입** — orchestrator 경계의 요약 정책. 완료 계약·결정 기록·실패 증거는 보존 대상으로 불변 | **P0** | orchestrator (주), bridge (요약 이벤트 타입 추가 시 codegen). `rust-core` 변경 없음 — 요약은 provider 호출을 수반하므로 core에 둘 수 없다 |
| G2 | repo map 표준 컨텍스트 (Aider) | `loop_code_map`은 Lead 도구로만 존재, worker 표준 컨텍스트 아님 (inventory §2.6) | 대형 저장소에서 worker가 위치 탐색에 토큰·시간을 낭비한다 | **부분도입** — code map 요약본을 worker 컨텍스트 주입물에 선택적 포함 | **P1** | orchestrator |
| G3 | 대화 세션 fork·rewind (Codex `/fork`, Gemini 세션 체크포인트) | run 재개(reconcile)는 있으나 대화 세션 분기 없음 | 탐색적 분기마다 run을 재구성해야 한다 | **보류** — §2 참조 | 보류 | — |

### B. 보안·권한

| # | 장점 (출처 하네스) | Loop 현재 상태 | 사용자 체감 영향 | 채택 권고 | 우선순위 | 변경 범위 |
| --- | --- | --- | --- | --- | --- | --- |
| G4 | OS 샌드박스와 승인 정책 (Codex sandbox, OpenHands 격리) | write scope는 스케줄러 충돌 방지 계약이지 OS 격리가 아님을 문서가 명시 (inventory #47 🟡, reliable-runs) | 사용자가 write scope를 보안 경계로 오인하면 worker 명령에 대한 과신으로 이어진다 | **부분도입** — (a) 격리 한계 문서화 + 어댑터별 sandbox 능력 선언·보고, (b) 선택적 worker sandbox profile. 코어 내장 샌드박스는 보류(플랫폼 이식성·운영 비용) | **P0** ((a)) / P2 ((b)) | adapter, docs·config; bridge (능력 필드 codegen) |
| G5 | 도구별 allow/ask/deny 권한 (OpenCode) | attention 승인 게이트만 존재 (inventory #10) | 위험 도구의 실행 시점 통제가 provider 환경에 의존한다 | **부분도입** — adapter 도구 중재 계층으로 한정. core attention 게이트와 역할 중복 주의 | **P2** | adapter |

### C. 지속성·복구

| # | 장점 (출처 하네스) | Loop 현재 상태 | 사용자 체감 영향 | 채택 권고 | 우선순위 | 변경 범위 |
| --- | --- | --- | --- | --- | --- | --- |
| G6 | 파일 checkpoint/rewind (Gemini `/restore`, Cline action 단위, Aider 자동 revert) | 이벤트 재생 복구만 존재, 파일 되감기 없음 (inventory #51 ⛔, ADR) | 잘못된 worker 변경의 복구가 수동 git 작업으로 돌아간다 | **부분도입** — workspace 계층의 수동 git snapshot(cleanup 전 안전망). 자동 tool-level rewind는 보류(§2) | **P2** | adapter (workspace), config (보존 정책) |
| G7 | provider 세션 재개·핸드오프 (Codex resume, Warp handoff) | DAG 재조정 resume만 존재 | 터미널 종료 후 DAG 상태만 이어지고 모델 대화 맥락은 끊긴다 | **보류** — §2 참조 | 보류 | — |

### D. 생태계

| # | 장점 (출처 하네스) | Loop 현재 상태 | 사용자 체감 영향 | 채택 권고 | 우선순위 | 변경 범위 |
| --- | --- | --- | --- | --- | --- | --- |
| G8 | MCP·extensions 생태계 (Claude, Codex, Gemini, OpenCode, Crush) | 자체 표준 없음 (inventory #34 ⛔). 단, Loop의 worker는 완전한 CLI 하네스라 Codex 등이 자체 MCP를 이미 지원 | 기존 MCP 도구 설정이 worker마다 흩어져 Loop 수준에서 가시성이 없다 | **부분도입** — Loop 자체 MCP 구현은 금지(경계). worker CLI의 기존 MCP 설정 전달·문서화를 P1으로, Loop 레벨 client는 수요 확인 후 adapter 과제(P2) | **P1** | adapter, docs·config |
| G9 | skills·팀 설정 배포 (Claude skills/plugins, Cursor rules) | 페르소나·config는 있으나 repo 단위 공유 관례 없음 (inventory #36) | 팀 단위 재사용 시 설정을 수동 복사한다 | **부분도입** — repo-owned task/페르소나 템플릿. marketplace·plugin 플랫폼은 보류 | **P2** | docs·config |
| G10 | 외부 제어 HTTP API/SDK (OpenCode server) | 없음 — private CLI 경로만 (inventory #49 ⛔) | 외부 자동화 연동에 접착 코드가 필요하다 | **보류** — §2 참조 | 보류 | — |
| G11 | 75+ provider·로컬 모델 (OpenCode) | 6종 adapter, 설계는 provider 중립 (inventory #31) | 신규 모델마다 adapter 작업이 발생할 수 있다 | **부분도입** — 수요 기반 adapter 추가(구조 변경 불요). 갭이라기보다 지속 과제 | **P2** | adapter |
| G12 | IDE 통합·대화형 페어 UX (Claude IDE, Aider 대화 흐름) | 비목표 — 터미널은 Herdr, Lead는 Pi 소유 (README) | 해당 UX를 기대하는 사용자는 다른 하네스를 택한다 | **보류** — §2 참조 | 보류 | — |

### E. 검증

| # | 장점 (출처 하네스) | Loop 현재 상태 | 사용자 체감 영향 | 채택 권고 | 우선순위 | 변경 범위 |
| --- | --- | --- | --- | --- | --- | --- |
| G13 | 실행 중 lifecycle hooks (Claude hooks) | 없음 (inventory #52 ⛔). completion check는 종료 검증이지 매 호출 개입이 아님 | 정책 검사·자동 포맷·감사 연동을 별도 adapter로 만들어야 한다 | **부분도입** — adapter typed event seam. core의 완료 판정은 Rust에 불변 유지 | **P2** | adapter; bridge (이벤트 타입 추가 시 codegen) |
| G14 | 독립 second opinion/critic (Amp Oracle, OpenHands critic) | 완료 계약은 강제하지만 자동 독립 검토자 없음 (inventory §2.2) | worker 자기 보고의 맹점을 매번 별도 task로 직접 구성해야 한다 | **부분도입** — reviewer task 패턴 + 페르소나(기존 DAG task kind로 충분, core 변경 없음) | **P1** | orchestrator; docs·config (personas) |
| G15 | lint/test 자동 수정 루프 (Aider) | deterministic assertion 첫 실패 terminal 처리 (inventory #9) | 비결정 검증 실패에서 사람이 매번 재시도를 결정한다 | **부분도입** — 비결정 검증에 한정한 명시적 retry 정책만 검토. deterministic terminal 정책은 유지 | **P2** | `rust-core` (policy/failure), orchestrator |
| G16 | 구조화 출력 스키마 (Codex `--output-schema`) | 완료 계약이 더 강한 게이트 (inventory #7) | worker 출력 파싱 신뢰도가 adapter마다 다르다 | **부분도입** — worker JSON 출력 강제 옵션(계약의 보완) | **P2** | adapter |

### F. 운영 가시성

| # | 장점 (출처 하네스) | Loop 현재 상태 | 사용자 체감 영향 | 채택 권고 | 우선순위 | 변경 범위 |
| --- | --- | --- | --- | --- | --- | --- |
| G17 | 사용량·비용 명령/대시보드 (Claude `/cost`, Cline OTel, Warp) | 이벤트·벤치마크는 있으나 토큰·비용 기록 없음 (inventory §2.8) | run별 비용을 사후 재구성할 수 없어 예산 관리가 맹목이다 | **도입** — provider가 제공할 때만 optional usage 메타데이터로 기록(추정치·실측 구별). OTel export는 코드 유출 위험으로 보류 성향 | **P1** | bridge (타입+codegen), adapter (수집), orchestrator (기록) |
| G18 | 실행 대시보드·트랜스크립트 시각화 (Warp) | status/watch/graph CLI, worker_visibility 3모드(기본 off) 🟡 (inventory #18·#22) | 다중 worker 상태 파악이 텍스트 출력에 의존한다 | **부분도입** — worker_visibility 기본값·요약 고도화 먼저. 대시보드는 수요 확인 후 | **P2** | orchestrator, adapter (presentation) |

### G. 오케스트레이션 (비목표 대조 확인)

| # | 장점 (출처 하네스) | Loop 현재 상태 | 사용자 체감 영향 | 채택 권고 | 우선순위 | 변경 범위 |
| --- | --- | --- | --- | --- | --- | --- |
| G19 | 모델 재량 서브에이전트·즉석 위임 (Claude subagents, Gemini 자동 위임, Codex multi-agent, Amp specialists) | 비목표 — 쓰기 겹침·직렬화 보장 우회 (inventory #45). 경량 경로 `loop_quick_run` 존재 (inventory #24) | 즉석 위임 편의는 포기한다 | **보류** — §2 참조 | 보류 | — |
| G20 | 요청 단위 auto 모델 라우팅 (Codex 에이전트별 모델) | 비목표 — 클래스 선택 추적성 (inventory #46) | 라우팅 자동화 편의는 포기한다 | **보류** — §2 참조 | 보류 | — |
| G21 | 클라우드/원격 실행 (Cursor, Devin, Amp Orbs, Warp) | 비목표 — 수요 미실측 (inventory §3) | 원격 격리·비동기 위임 편의는 포기한다 | **보류** — §2 참조 | 보류 | — |

## 2. 경계 충돌 보류 항목

Loop 설계 원칙(AGENTS.md 계층 경계, provider 중립성, README 소유 분리)과 충돌하거나 비목표로 이미 결정된 항목이다. 보류는 "결함"이 아니라 "구조적 대체재를 택한 결과"다.

| 항목 | 충돌하는 원칙 | 보류 사유 | 재검토 조건 |
| --- | --- | --- | --- |
| G3 대화 세션 fork/rewind | 터미널/Lead 소유 분리(README), provider 중립성 | 대화 상태는 Pi Lead와 provider CLI 소유다. Loop가 트랜스크립트를 소유하면 provider 종속이 계층으로 확산한다 | 동일 intent의 다중 분기 비교 수요가 run 로그로 실측될 때 — 그때도 run 복제(이벤트 로그 분기)로 해결 가능 |
| G7 provider 세션 핸드오프 | provider 중립성 | 세션 소유권 통합 시 provider 종속 확대 (platform 조사: 높은 난이도/비권고) | persisted task inputs·steer·task outputs로 부족한 사례가 발견될 때 |
| G10 외부 HTTP API/SDK | 비목표 (inventory #49) | private CLI 경로로 충분하며 공격 표면과 경계 유지 비용이 있다 | 외부 오케스트레이터 연동 수요 확인 시 — 이때도 bridge 명령 확장으로 처리 |
| G12 IDE/터미널 UX | Herdr(터미널)·Pi(Lead) 소유 분리(README) | Loop core에 UI 개념 유입은 경계 위반이다 | Pi/Herdr 측 표면 개선으로 처리 (Loop 코드 변경 불요) |
| G19 모델 재량 서브에이전트 스폰 | 스케줄 규율은 Rust(AGENTS.md) | 쓰기 겹침 방지·decision/integration 직렬화를 우회한다. 즉석 조사는 `loop_quick_run`·리서치 fan-out으로 대체된다 | 없음 — 구조적 대체재가 존재하므로 재검토 불요 |
| G20 요청 단위 auto 라우팅 | 결정적 사다리·추적성 (model-routing) | 클래스 선택 이유의 추적성을 상실한다 | nightly 에이전트 비교 데이터가 정적 사다리의 체감 한계를 보일 때 |
| G21 클라우드/원격 실행 | 비목표 (inventory §3), 자격증명 비저장 원칙 | 원격 VM·secret provisioning은 별도 경계 설계를 요구하며 수요가 미실측이다 | worker lifecycle 계약(취소·heartbeat·재연결) 견고화 후 실수요 발생 시 별도 adapter로 |
| G6 변형: 자동 tool-level rewind | ADR cleanup-and-retention | dirty/unmerged workspace는 수동 보호가 원칙이다. 도구 단위 자동 되감기는 삭제·복구 책임을 모호하게 만든다 | snapshot이 수동·명시적 트리거로 한정되는 조건에서 workspace 계층 실험 |

## 3. 도입 상위 3개 다음 단계

선정 기준: 우선순위 → 사용자 체감 영향 → 구현 비용 순. 세 건 모두 fake provider·문서 작업으로 착수 가능해 유료 모델 호출이 0이다.

### 3.1 G1 — 컨텍스트 수명 관리 (P0, 도입)

- **대안 검토:** (a) core에 압축 정책 흡수 — provider 호출을 수반하므로 경계 위반, 기각. (b) config 임계값 + orchestrator 경계 요약 (채택). 요약 실행은 기존 compute class 라우팅을 재사용하고 모델 ID는 config에만 둔다.
- **run 1 (계측, 구현 run):** benchmark 시나리오에 작업 컨텍스트 크기 기록 추가 (`packages/orchestrator/src/benchmark.ts`, fake provider). 이벤트 타입 추가가 필요하면 bridge 타입 변경 → `bun run codegen` → 생성 파일 동반 커밋. 목표: 임계값 근거 수집.
- **run 2 (`decision` run):** 요약 정책 결정 — 보존 집합(완료 계약, `DecisionRecorded`, 실패 증거, guidance) vs 요약 집합(`TaskActivityRecorded`, 재시도 이력), 임계값은 `config/policy.toml` `[context]`로.
- **run 3 (구현 run):** `task-execution.ts` 경계에 요약 적용 + fake provider 요약 손실 테스트(계약·결정 보존 assertion). 검증은 `cargo test -p loop-core`(변경 시)와 `bun test packages`로 마친다.

### 3.2 G4 — 샌드박스 사실성 (P0, 부분도입)

- **대안 검토:** (a) core에 샌드박스 내장 — 플랫폼 이식성·운영 비용으로 platform 조사가 기각 권고, 채택하지 않음. (b) 문서화 + 어댑터 능력 선언 (채택, 최소 비용).
- **run 1 (문서 run):** `docs/reliable-runs.md`와 README에 "write scope는 스케줄러 충돌 방지 계약이지 OS 격리가 아니다" 섹션과 어댑터별 실제 격리 상태 표 추가.
- **run 2 (구현 run):** `AgentProvider` 계약에 sandbox capability 선언 필드 추가 — bridge 타입 변경 → `bun run codegen` → 생성 파일 커밋. `loop doctor`가 어댑터별 격리 수준을 보고하게 한다 (능력 없음도 명시적으로 보고).

### 3.3 G14 — 독립 검토 패턴 (P1, 부분도입, 최소 비용 quick win)

- **대안 검토:** (a) core에 critic 개념 추가 — task kind 확장이 필요하고 자동 독립 검토를 완료의 대체로 오인할 위험, 기각. (b) 기존 verification-kind task + reviewer 페르소나 패턴 (채택, core 변경 0).
- **run 1 (`decision` run):** reviewer task 패턴 결정 — 검토 결과는 의견이지 테스트 증거가 아님을 계약 문구에 명시, 리스크 기반 삽입 규칙(high/critical에만 reviewer task) 정의.
- **run 2 (구현 run):** `config/personas/`에 reviewer 페르소나와 프롬프트 템플릿(출처·판정 기준 필수 조항 포함), `loop_quick_run` 분해 지침에 삽입 규칙 반영. 계약이 단순 파일-존재 검사로 퇴화하지 않도록 검사 예시를 함께 갱신.

## 4. 문서 정합성 발견 사항

1. `harness-comparison.md` §4.5의 "단일 노드 fast path 없음" 서술은 `loop_quick_run` 존재(inventory #24)로 갱신 대상이다 — inventory 비고와 동일 결론.
2. inventory #27이 자동 컨텍스트 압축을 ⛔(갖지 않음)로 분류했으나, CLI·platform 양쪽 조사 모두 경계 내 도입을 권고하고 harness-comparison §4.2는 "non-goal"이 아닌 "격차"로 기술했다. 본 문서는 이를 **도입(P0)**으로 재판정한다.
3. CLI 조사의 "MCP 접속 P1"과 platform 조사의 "marketplace 회피"는 모순이 아니다. 본 문서는 "worker CLI 기존 MCP 설정 전달·문서화(P1) + Loop 자체 구현 금지"로 접합했다(G8).

## 5. 요약 evidence

- **총 갭 항목: 21개** (CLI 25항목 + platform 24항목을 중복 병합해 정규화)
- **권고 분포:** 도입 2 (G1, G17) / 부분도입 12 / 보류 7 (G3, G7, G10, G12, G19, G20, G21)
- **P0 수: 2개** — G1 컨텍스트 수명 관리(도입), G4 샌드박스 사실성(부분도입)
- **P1: 4개** (G2, G8, G14, G17) / **P2: 8개**
- 경계 충돌 보류: §2에 7항목 + G6 자동-rewind 변형 1건, 사유·재검토 조건 명시
- 도입 상위 3개 다음 단계: §3 — 첫 run이 전부 문서·fake provider 기반이므로 유료 모델 호출 0
- 한계: 판정은 공개 문서·로컬 코드 기반 기능 유무이며, 품질·성능 실측이 아니다. 우선순위는 사용자 사례가 축적되면 재조정 대상이다.
