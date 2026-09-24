# Design.md 기반 워크플로 채택 — 임계값 기반 경량 스펙 우선 프로세스

- **Date:** 2026-09-24
- **Status:** decided
- **Kind:** decision
- **Read scope:** `docs/design/research/design-md-practices.md`, `docs/design/design-foundations.md`, `docs/decisions/**`, `AGENTS.md`
- **Write scope:** 이 결정 문서 (`docs/decisions/design-md-workflow.md`)
- **근거:** `docs/design/research/design-md-practices.md`(Kiro 스펙 워크플로·GitHub Spec Kit·Rust RFCs·Google 디자인 문서 5계열 조사, 2026-09-24 1차 자료 대조), `docs/design/design-foundations.md`(권고 D1–D3, 2주 계획 S1–S8, 후속 결정 D-1–D-6)

## 배경

Loop는 결정 기록(`docs/decisions/**` ADR)과 불변식 문서(`AGENTS.md`)는 갖추고 있으나, **요구사항 → 설계 → 태스크 → 완료 확인을 하나의 문서로 묶는 에픽 단위 설계 아티팩트가 없다.** 그 결과가 이번 실행에서 실제로 나타났다: design-foundations 에픽은 두 번의 실행(loop-c2936c89 → 현재)에 걸쳐 진행됐고, 리서치·권고·후속 결정이 문서 4개(`design-foundations.md` + 리서치 3건)와 그 안의 표(D1–D3, S1–S8, D-1–D-6)에 분산돼 있다. 후속 통합 태스크가 이를 기계적으로 따오려면 분산 지식의 결합 규칙이 필요하다.

업계 관행 조사(`design-md-practices.md`)의 핵심 발견:

1. 4개 계열 모두 "구현 승인"과 "구현 실행"을 분리된 이벤트로 만드는 3단 관문(요구사항 → 설계 → 태스크)을 공유한다.
2. 역추적의 실제 구현은 링크가 아니라 **단위 명명 규칙(ID 문법)**이다 — Spec Kit `[T012] [US1]`, Kiro EARS 수용 기준, RFC 번호 체인.
3. 설계 문서의 품질은 **대안 절**이 결정한다(Google "Alternatives considered", RFC "Drawbacks"/"Rationale and alternatives").
4. 소규모 경량화는 **임계값 기반 탈출 사다리**로 표준화돼 있다 — 전면 도입이 아니라 임계값 이상일 때만 전체 프로세스.
5. 문서만으로 일관성은 유지되지 않으며, 기계 검증(completion check류)과 결합할 때만 유지된다.

Loop는 멀티 태스크 DAG와 결정 노드 직렬화를 이미 코어에서 수행하므로(Kiro의 wave 실행·Spec Kit의 게이트와 동형), 이 관행은 새 시스템 도입이 아니라 **문서 계층의 최소 보강**이다.

## 결정

**채택: 임계값 기반 경량 design.md 워크플로.** 에픽(멀티 태스크 작업)당 설계 문서 1개, 9절 고정 골격, 게이트 1개(decision 태스크의 accepted), 태스크 실행 상태의 단일 원천은 orchestrator에 그대로 둔다.

### 1. 위치와 명명

- 설계 문서는 코드와 같은 저장소의 `docs/design/` 아래, **에픽당 파일 1개**: `docs/design/<에픽-slug>.md`.
- 본 결정의 첫 적용 문서(디자인 파운데이션 에픽)는 상위 실행의 지시 경로인 **`docs/design/design.md`**를 사용한다.
- 새 헌법(constitution) 파일은 만들지 않는다. Spec Kit의 헌법 역할은 기존 `AGENTS.md`(경계·불변식)와 `docs/decisions/**`(ADR)가 수행하며, design.md의 경계 검토는 "AGENTS.md 위반 여부 + 관련 ADR 나열"로 국소화한다(단일 출처 원칙).

### 2. Loop design.md의 필수 섹션 목록 (9절, 고정 순서)

**전 절 필수다.** 내용이 없는 절은 한 줄 `해당 없음 — 이유`로 채운다(기계적 작성을 위한 고정 골격; Google의 "해당하는 것만"과 달리 에이전트 작성의 판단 변수를 제거한다). §4·§6·§7은 이 워크플로의 최소 불변식으로 절대 생략 불가다.

| # | 섹션 | 필수 내용 | 절대 규칙 |
| --- | --- | --- | --- |
| 1 | 메타·상태 | 일자, 상태(`draft`/`accepted`/`superseded`), 선행 근거 문서 링크, 승인 태스크 id | 상태 표기 없는 문서 금지 |
| 2 | 배경과 범위 | 시스템이 놓인 환경, 무엇을 다루는지 — 사실만 | 요구사항 문장 혼입 금지 |
| 3 | 목표와 비목표 | 달성 목표 + "목표일 법하지만 명시적으로 제외한 것" | 비목표를 목표로 재진술 금지 |
| 4 | 요구사항 | EARS 문장(`WHEN <조건> THE SYSTEM SHALL <동작>`) + `R<n>` ID + 요구사항별 검증 방식(실행 명령 또는 관찰 방법) | 구현 방법(기술 스택·파일) 기술 금지; `[NEEDS CLARIFICATION]` 잔존 시 accepted 불가 |
| 5 | 설계 | 아키텍처·데이터 흐름·인터페이스 중 해당 항목 + **영향받는 계층(crates/packages) 명시 + AGENTS.md 경계 준수 확인 + 관련 ADR 나열** | 전체 코드 복붙 금지(인터페이스 스케치만); Rust bridge 타입 변경 시 `bun run codegen` 명시 |
| 6 | 검토된 대안 | 채택안마다 기각 대안 ≥1 + 기각 이유(트레이드오프) | "검토했음" 서술만으로 대체 금지 |
| 7 | 요구사항–태스크 역추적 표 | 행 단위 대응: `R<n>` ↔ 설계 요소 ↔ 태스크(id·kind·read/write 범위·의존) ↔ 완료 확인 명령 | 표 없는 태스크 나열 금지 — 역추적은 표가 본체 |
| 8 | 미해결 질문·위험 | 질문별 답변 책임(어느 결정/attention에서 갚는지) | accepted 시점에 미해결 질문 잔존 금지 — attention으로 승격하거나 accepted 보류 |
| 9 | 검증 계획 | completion check 명령 목록(`bun run check`, `bun test packages`, `bun run test:architecture` 등) + 부분 롤백 경계 | "워커 성공"을 완료 근거로 인정 금지 |

### 3. 요구사항 ID 체계

- 요구사항 ID는 **`R1`, `R2`, …** — design.md 파일 안에서 유일하면 충분하다(전역 ID 공간은 만들지 않는다; 파일이 에픽의 스코프다).
- 각 `R<n>`은 EARS 문장 1개 + 검증 방식 1개를 갖는다. 한 요구사항이 여러 문장을 필요로 하면 분해한다.
- 태스크 ID는 기존 orchestrator 규약(kebab-case 서술형, 예: `decide-design-md-adoption`)을 그대로 쓴다 — 새 ID 문법을 이중 도입하지 않는다.

### 4. 태스크 도출 규칙

- §7 표의 **각 행 = Loop 태스크 1개.** 필수 열: 요구사항 ID(`R*`), 태스크 id, kind(`research`/`decision`/`implementation`), read scope, write scope, 의존 태스크, 완료 확인 명령.
- **양방향 완전성:** 모든 `R<n>`은 태스크 ≥1개와 대응하고, 모든 태스크는 `R<n>` ≥1개와 대응한다. 대응 없는 태스크는 설계 변경이거나 범위 밖이다.
- **병렬 가능 판정 = 쓰기 범위 비중첩** (기존 DAG 규약). 결정·통합 노드는 직렬화한다(AGENTS.md).
- Spec Kit의 `[P]` 마커·파일 경로 명시 규칙에 대응하는 것이 read/write scope 선언이다 — design.md §7에 이를 적어두면 orchestrator의 DAG 변환이 기계적이다.

### 5. 코드 역추적 방식

- 구현 태스크의 지시문에 **design.md 경로 + 담당 `R<n>` ID를 주입**한다(Kiro `#spec` 맥락 주입의 동형 — 구현 시점에 설계가 코드 생성기의 입력으로 강제 주입된다).
- **코드에 design.md 참조 주석을 넣지 않는다**(문서 부패 방지). 구현 후에도 남아야 할 정책 결정만 ADR로 승격한다. design.md는 계획과 근거의 기록, ADR은 영속 결정의 기록으로 역할이 분리된다.
- 검증은 §9의 명령으로 수행한다(AGENTS.md completion contract). 테스트가 곧 살아있는 역추적이다.

### 6. 적용 기준 (design.md를 쓰는 때)

다음 중 하나에 해당하면 design.md, 아니면 기존 수단(ADR 또는 리서치 문서)으로 충분하다:

1. **2개 이상의 구현 태스크**가 예상되는 변경,
2. **실행(런)을 넘어 이어지는** 작업,
3. **아키텍처 경계 또는 정책 문서**(`config/policy.toml` 포함)에 영향을 주는 변경.

면제 사례: 단일 태스크 수정, 리팩터링(형태만 바꾸고 의미 불변), 문서 정리 — Rust RFC의 substantial 기준과 Google의 "해법이 명백하면 문서가 아니라 코드" 원칙.

### 7. 상태 전이와 갱신 규칙

- 전이: `draft → accepted → superseded`(대체 문서 발생 시). `accepted`의 조건: (a) 승인 decision 태스크 완료, (b) `[NEEDS CLARIFICATION]` 0개, (c) §8 미해결 질문 없음(또는 attention 승격 완료).
- **태스크 실행 상태를 design.md에 기록(체크박스 동기화)하지 않는다** — orchestrator가 단일 원천이다. Kiro의 Sync Files에 해당하는 역할을 Loop에서 orchestrator가 이미 수행하므로 이중 기록은 만들지 않는다.
- 구현 머지 전 설계 변경은 design.md를 개정한다(개정 이유 한 줄). 구현 머지 후 발견은 새 문서 또는 ADR + 원문 링크(Google/RFC 개정 규칙). **문서-코드 완전동기화 시도 자체를 금지한다** — 문서 워크플로가 유지보수 부담으로 전락하는 주 경로다.

## 대안 검토

### (a) 미채택 — 현행 유지 (ADR + 리서치 문서만)

기각. ADR은 "결정"의 단위 기록이고 요구사항–태스크–검증의 결합을 담지 못한다. 실증적으로 이번 에픽이 두 실행에 걸치며 D1–D3(권고)·S1–S8(계획)·D-1–D-6(후속 결정)이 문서 4개에 분산됐고, 통합 태스크가 따를 기계적 규격이 없었다. 멀티 태스크 DAG 작업이 반복될수록 결합 비용이 증가한다.

### (b) 전면 채택 — Kiro/Spec Kit 정식 형태 (파일 3종·게이트 2개·헌법·기능별 디렉터리)

기각. 1인 + 에이전트 규모에서 관료 비용이 이득을 초과한다. 구체적 중복: (i) 헌법은 `AGENTS.md`가 이미 수행 — 신설은 단일 출처 원칙 위반(`design-system-practices.md` §3.1); (ii) tasks.md를 별도 파일로 두면 orchestrator 태스크 상태와 이중 원천이 됨 — 태스크 상태는 orchestrator에 두는 것이 Loop 구조상 정답; (iii) 게이트 2개는 Loop의 결정 노드 직렬화와 이중화 — decision 태스크 1개로 수렴 가능.

### (c) 채택 — 임계값 기반 경량 형식 (위 결정 절)

채택. 4계열 공통 불변식(3단 관문·ID 문법·대안 절·기계 강제)은 전부 흡수하되, 파일 3종→1종, 게이트 2→1, 헌법 신설→기존 재사용으로 경량화한다. 탈출 사다리(Rust RFC substantial 기준, Google 미니 문서)를 적용 기준으로 명문화해 소규모 변경의 부담을 제거했다.

## AGENTS.md 경계 정합성

- **코드 변경 0, Rust/bridge/codegen 대상 0** — 순수 프로세스·문서 결정이다.
- design.md §5의 경계 검토가 계층 위반을 설계 단계에서 차단하므로 기존 경계와 상충하지 않는다. 오히려 `AGENTS.md` "Serialize decision and integration nodes"와 "non-empty completion contract"를 문서 계층에서 강제하는 장치다.
- 모델 ID·엔드포인트·자격 증명 개념과 무관하다.

## 결과

- **채택 여부:** 채택 (임계값 기반 경량 design.md 워크플로).
- **선택한 형식:** 에픽당 `docs/design/<slug>.md` 1개(첫 적용은 `docs/design/design.md`), 9절 고정 골격, 게이트 1개(decision 태스크의 accepted), 태스크 상태 단일 원천은 orchestrator.
- **필수 섹션 목록:** 위 §결정-2의 표가 기계적 규격이다 — 1 메타·상태, 2 배경과 범위, 3 목표와 비목표, 4 요구사항(EARS+`R<n>`+검증 방식), 5 설계(경계 영향 포함), 6 검토된 대안, 7 요구사항–태스크 역추적 표, 8 미해결 질문·위험, 9 검증 계획.
- **후속 통합 태스크의 첫 적용 방법:** `docs/design/design.md`를 위 9절 형식으로 작성한다. 요구사항은 D1–D3를 EARS로 세분화한 `R<n>` 집합(조사 문서 §7.2의 예시 문장 출발), §7 역추적 표의 태스크 열은 S1–S8에 kind·read/write 범위를 붙인 것, §8은 design-foundations §6의 D-1–D-6을 흡수한다. 작성 후 리뷰·검증까지 수행하고 코드 구현은 별도 승인 단계로 남긴다.
- **부담·위험:** (i) 문서 골격이 형식주의로 굳을 위험 — 적용 기준(§결정-6)의 면제 규칙으로 완화하며, 몇 회 적용 후 골격의 과잉/부족을 재검토한다; (ii) design.md와 ADR의 역할 혼동 — "계획+근거는 design.md, 영속 결정은 ADR" 원칙과 승격 규칙(§결정-5)으로 구분한다; (iii) `docs/design/design.md`라는 비-slug 파일명이 첫 사례로 남는 것 — 이후 에픽부터 slug 명명을 적용한다.
