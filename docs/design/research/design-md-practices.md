# design.md 기반 개발 워크플로 업계 관행 조사 — 스펙 우선 개발의 문서 구조·역추적·경량화

- **일자:** 2026-09-24 KST
- **종류:** `research` (research-design-md, attempt 0)
- **읽기 범위:** `README.md`, `docs/decisions/**`, `docs/design/**` (현재 상태 파악용)
- **쓰기 범위:** 이 문서만
- **증거 경계:** 공식 문서·공식 저장소 원문을 2026-09-24에 직접 내려받아 인용을 대조했다(§부록 A 전 목록). Kiro는 공식 문서 마크다운 원본(`kiro.dev/docs/**.md`), Spec Kit은 `github/spec-kit` `main` 저장소 원문(raw), Rust RFCs는 `rust-lang/rfcs` `master` 원문(raw), Google 디자인 문서 관행은 Malte Ubl(cramforce)의 1인칭 공개 상세 기록(industrialempathy.com)을 사용했다. **Amazon 항목만 예외적 제한**이 있다: Amazon 자체 웹 자산(aboutamazon.com, amazon.jobs, amazon.design)은 2026-09-24 기준 JS 렌더링·403/404로 원문 수집에 실패했으므로, §5.3은 표준 서지 출처(『Working Backwards』) 기반의 요약이며 원문 인용을 포함하지 않는다. design.md/ui-ux-pro 류 프롬프트 스킬 문서는 자매 문서들과 동일하게 근거에서 배제했다.
- **자매 문서:** Loop 현황은 `loop-ui-audit.md`(P1–P4), UI 사례는 `oss-agent-ui-survey.md`, 디자인 시스템 관행은 `design-system-practices.md`(R1–R5), 권고는 `docs/design/design-foundations.md`(D1–D3). 본 문서는 "프로세스" 축 — 결정을 코드 이전의 design.md로 고정하는 업계 관행 — 을 담당한다.

---

## 0. 요약

**문서:** `docs/design/research/design-md-practices.md`
**조사 대상:** AWS Kiro 스펙 워크플로, GitHub Spec Kit, Rust RFCs, Google/Amazon 디자인 문서 관행 — 5계열

**핵심 발견 5가지:**

1. **"문서 먼저" 워크플로는 4개 계열 모두 3단 관문(요구사항 → 설계 → 태스크)을 공유한다.** Kiro는 `requirements.md → design.md → tasks.md`의 파일 3종(Kiro, §2.1), Spec Kit은 `specify → plan → tasks → implement → converge`의 명령 5단(§3.1), Rust RFC는 RFC 병합(설계 확정) 후 구현 이슈·PR이 따라온다(§4.2), Google 디자인 문서는 리뷰 통과 후 구현을 시작한다(§5.1). 공통 전제는 **"구현 승인"과 "구현 실행"을 분리된 이벤트로 만드는 것**이다.
2. **역추적(traceability)의 실제 구현은 링크가 아니라 "단위 명명 규칙"이다.** Spec Kit은 태스크에 스토리 ID를 붙인다(`[T012] [P] [US1] ...`, §3.2), Kiro는 EARS 요구사항 문장이 그대로 수용 기준이 되고 `#spec` 맥락 제공자로 세 문서를 구현 대화에 강제 주입한다(§2.2), Rust RFC는 RFC 번호 → 구현 추적 이슈 → PR의 번호 체인을 유지한다(§4.2). 사람이 지키는 링크가 아니라 **아티팩트 ID 문법**이 역추적의 본체다.
3. **설계 문서의 품질은 대안 절이 결정한다** — Google의 디자인 문서 가이드는 "Alternatives considered"를 가장 중요한 절 중 하나로 명시하고(§5.1), Rust RFC 템플릿은 `Drawbacks` + `Rationale and alternatives`를 필수 절로 요구한다(§4.1). 트레이드오프 기록이 없는 문서는 Google 기준 "구현 매뉴얼"이라 착오라는 지적이 있다(§5.2).
4. **소규모 팀 경량화는 "탈출 사다리(escape ladder)" 형태로 표준화돼 있다.** Kiro는 Plan mode(문서 미생성) → Quick Spec(게이트 없음) → 정식 스펙(게이트 있음)의 3단(§2.3), Google은 1–3쪽 "미니 디자인 문서"와 "문서를 쓰지 않아도 되는 때" 기준을 제시한다(§5.1, §5.2). 전면 도입이 아니라 **임계값 이상일 때만 전체 프로세스**를 돌리는 구조다.
5. **문서만으로는 일관성이 유지되지 않으며, 기계 검증과 결합할 때만 유지된다.** Spec Kit은 템플릿이 LLM을 구속하는 7가지 장치(`[NEEDS CLARIFICATION]` 마커, 헌법 게이트, 체크리스트, 검사 우선 파일 생성 순서 등)를 명시하고(§3.3), 버그픽스 프로세스는 "검증 없는 수정은 성공이 아니다"를 원칙으로 명문화한다(§3.1). 이는 Loop의 completion contract와 동형이며, 자매 문서 `design-system-practices.md` §3.2("린트가 우회를 거부")의 프로세스 버전이다.

### Loop에 추천하는 design.md 섹션 구조 (근거 출처 포함)

`docs/design/design.md`(후속 결정 태스크의 산출물)는 아래 9절 구성을 권고한다. 각 절의 근거는 [출처] 표기이며, §7에서 D1–D3와의 결합 방식을, §8에서 절별 상세를 제시한다.

| # | 절 | 내용 | 근거 |
| --- | --- | --- | --- |
| 1 | 메타·상태 | 일자, 상태(`draft/review/accepted`), 선행 근거 문서 링크, 이 문서가 대체하는 결정 | Kiro 스펙 메타+승인 게이트 [kiro.dev/docs/specs], RFC 헤더·수명주기 [rust-lang/rfcs] |
| 2 | 배경과 범위 | 시스템이 놓인 환경, 무엇을 만들고 무엇을 만들지 않는지(사실만) | Google "Context and scope" [industrialempathy] |
| 3 | 목표와 비목표 | 달성 목표와 명시적으로 목표에서 제외한 것 | Google "Goals and non-goals" [industrialempathy] |
| 4 | 요구사항 | EARS형 문장(`WHEN … THE SYSTEM SHALL …`)+각 요구사항의 검증 방식 | Kiro EARS [kiro.dev/docs/specs/feature-specs] |
| 5 | 설계 | 아키텍처·데이터 흐름·인터페이스·데이터 모델·오류 처리·테스트 전략 + **Loop 저장소 경계(AGENTS.md 계층) 영향 분석** | Kiro design.md 항목 [feature-specs], Spec Kit plan "Constitution Check" [spec-kit] |
| 6 | 검토된 대안 | 기각한 대안과 기각 이유(트레이드오프) | Google "Alternatives considered", RFC "Drawbacks"/"Rationale and alternatives" |
| 7 | 요구사항–태스크 역추적 표 | `요구사항 ↔ 설계 요소 ↔ 태스크(id/kind/read·write 범위) ↔ 완료 확인`의 행 단위 대응 | Spec Kit tasks `[US1]` 문법 [spec-kit], Kiro "Sync Files" [best-practices] |
| 8 | 미해결 질문·위험 | 확정 전에 남는 질문 → Loop attention 항목으로 승격 | RFC "Unresolved questions" [rust-lang/rfcs] |
| 9 | 검증 계획 | 완료 확인 명령(`bun run check`, `bun test packages` 등)과 기각된 경우의 롤백 경계 | Loop completion contract [AGENTS.md], Spec Kit "converge"/체크포인트 [spec-kit] |

**하지 말 것(현 단계):** 새 constitution(헌법) 파일 신설 — Loop는 이미 `AGENTS.md`(불변식)와 `docs/decisions/**`(ADR)를 갖고 있으므로 §5의 "헌법" 역할은 재사용으로 충분하다(단일 출처 원칙, `design-system-practices.md` §3.1과 정합).

---

## 1. 조사 방법

- **1차 자료 원칙:** 모든 주장은 (a) 공식 문서 원문, (b) 공식 저장소 소스(raw), (c) 실무자의 1인칭 공개 기록으로만 뒷받침한다. 각 인용의 URL은 부록 A에 있다.
- **수집 방법:** 2026-09-24에 `curl`로 Kiro 공식 문서 마크다운 원본(`.md` 엔드포인트), Spec Kit·Rust RFCs 저장소 원문, Google 디자인 문서 기록 원문을 내려받아 인용을 대조했다. Amazon 웹 자산은 JS 렌더링/차단으로 원문 수집 실패(§증거 경계) — 해당 부분은 서지 출처로 한정해 표기했다.
- **Loop 맥락:** `docs/design/design-foundations.md`(D1–D3)의 후속 결정 태스크가 "design.md 형식을 결정하고 Loop 자체 design.md를 작성"하는 것을 전제로, §6–§9에서 형식 제안과 정합성 확인을 제공한다. 코드 변경은 없다.

## 2. AWS Kiro 스펙 워크플로

### 2.1 구조: 파일 3종 + 3단 워크플로 + 승인 게이트

Kiro(AWS)의 스펙은 기능·버그픽스마다 디렉터리 1개에 파일 3종을 생성한다(출처: `kiro.dev/docs/specs.md`, `feature-specs.md`):

```text
.kiro/specs/<feature-name>/
├── requirements.md   # 사용자 스토리 + 수용 기준 (EARS 표기)
├── design.md         # 기술 아키텍처 + 시퀀스 다이어그램 + 구현 고려사항
└── tasks.md          # 이산적·추적 가능한 구현 태스크 목록
```

- **워크플로 변형 2종:** (a) *Requirements-First* — 요구사항 → 설계 → 태스크(제품 주도); (b) *Design-First* — 설계 → 요구사항 → 태스크(기술 제약·비기능 요구가 먼저일 때). 두 변형 모두 각 단계 사이에 "Edit/Request changes ↔ 승인" 게이트가 있다.
- **design.md의 표준 절:** 공식 문서가 나열하는 design.md 내용 구성은 *Architecture, Data Flow, Interfaces, Data Models, Error Handling, Unit Testing Strategy*(기타)다. 요구사항 파일과 분리된 이유는 명시적: "design.md documents technical architecture … It captures the big picture of how the system will work".
- **EARS 요구사항 형식:** `requirements.md`는 EARS(Easy Approach to Requirements Syntax) 표기로 수용 기준을 쓴다:

```text
WHEN [조건/사건]
THE SYSTEM SHALL [기대 동작]
```

  문서는 이 형식의 이득 4가지를 명시한다: 명확성(Clarity), 검증 가능성(Testable, "each requirement can be directly translated into test cases"), **추적 가능성(Traceability, "Individual requirements can be tracked through implementation")**, 완전성(Completeness).
- **설계 전 요구사항 분석:** 요구사항 → 설계 이동 전 "Analyze Requirements"로 논리 불일치·모호성·상충 제약·공백을 점검하는 선택 단계를 제공한다. 소규모 스펙은 생략 가능하다고 명시한다.

### 2.2 태스크 도출과 역추적

- **태스크 병렬 실행(Loop와 동형):** "Run all Tasks"는 tasks.md의 **의존성 그래프**를 만들어 독립 태스크를 wave별로 묶어 동시 실행한다 — "Wave 1 (의존성 없음, 동시) → Wave 2 → … → Wave N. Waves execute sequentially; tasks within a wave execute concurrently." (출처: `specs.md`). Loop의 DAG 스케줄링(독립 병렬·결정 직렬화)과 개념이 동일하다.
- **역추적 수단 3가지:**
  1. **`#spec` 맥락 제공자** — 채팅에서 `#spec:user-authentication implement task 2.3`처럼 스펙을 참조하면 세 문서 전부가 구현 대화의 맥락에 주입된다. "Kiro automatically includes all spec files (requirements.md, design.md, and tasks.md) in the conversation context"(`best-practices.md`). 구현 시점에 설계 문서가 코드 생성기의 입력으로 **강제 주입**되는 것이 역추적의 실제 메커니즘이다.
  2. **EARS 수용 기준 → 태스크** — `requirements.md`의 각 SHALL 문장이 태스크의 완료 판정 기준이 된다.
  3. **동기화 명령** — 요구사항 변경 후 design.md의 **Refine**(설계+태스크 목록 갱신)과 tasks.md의 **Sync Files**(이미 구현된 태스크 자동 마킹)로 3문서의 정합을 재확보한다.
- **종료 산출물:** 태스크 완료 후 에이전트가 PR을 열고 설명에 수행 내용을 기록한다.

### 2.3 소규모 팀을 위한 현실적 경량화

- **탈출 사다리 3단(공식 문서에 명시된 선택 기준):**
  1. **Plan mode** — "doesn't generate formal requirements/design/tasks documents — it's faster and more conversational"(출처: `specs/plan.md`). 이해가 필요한 복잡 변경이지만 문서가 필요 없는 단계.
  2. **Quick Spec** — 게이트 없이 3문서를 일괄 생성. 대신 명확화 질문을 **앞단에 일괄** 수행한다: "Instead of approving each phase … you answer clarifying questions up front and land directly on an actionable task list"(출처: `specs/quick-spec.md`). 게이트를 없애는 대신 질문을 전면 로드하는 것이 설계 포인트다.
  3. **정식 스펙** — "Requirements or design need iteration", "compliance-sensitive domain where review gates add real value"일 때(`best-practices.md`).
- **문서 저장 관행:** 스펙은 버전 관리되는 저장소 안 코드와 함께 둔다 — "Store specs directly in your project repository alongside the code they describe"(`best-practices.md`). 기능별로 `.kiro/specs/` 아래 디렉터리를 분리해 "독립적 작업·집중된 문서·부분 개선"을 가능하게 한다.
- **버그픽스 스펙(회귀 방지형 구조):** `bugfix.md`는 현재 동작/기대 동작/**불변 동작**(regression prevention)을 모두 EARS로 적는다:

```text
WHEN [조건] THEN the system [결함 동작]          # 현재
WHEN [조건] THEN the system SHALL [올바른 동작]   # 기대
WHEN [조건] THEN the system SHALL CONTINUE TO [기존 동작]  # 불변
```

## 3. GitHub Spec Kit

### 3.1 구조: 헌법 1회 + 기능별 specify→plan→tasks→implement→converge

Spec Kit(GitHub 공식)의 SDD(Spec-Driven Development) 프로세스(출처: `README.md`, `spec-driven.md`):

- **헌법(constitution)은 프로젝트당 1회** — "Constitution once per project; specify → plan → tasks → implement → converge per feature." 헌법 템플릿은 핵심 원칙(예: Library-First, CLI Interface, Test-First NON-NEGOTIABLE, 단순성), 추가 제약, 거버넌스, 버전/비준일을 담는다(`templates/constitution-template.md`).
- **철학:** "Specifications don't serve code—code serves specifications." 스펙이 1차 아티팩트이고 코드는 스펙의 표현이다. 유지보수는 곧 스펙 진화다.
- **계획(plan) 문서의 표준 절**(`templates/plan-template.md`): Summary / Technical Context(언어·의존성·저장소·테스트·플랫폼·성능 목표·제약) / **Constitution Check**(게이트: 위반이 있으면 Complexity Tracking 절에 정당화 기록) / Project Structure(문서+소스 트리) / Complexity Tracking. 계획 단계가 `research.md`, `data-model.md`, `contracts/`, `quickstart.md`를 파생 산출물로 생성한다.
- **스펙(spec) 문서의 표준 절**(`templates/spec-template.md`): User Scenarios & Testing(우선순위 P1/P2/P3를 단 스토리, 각 스토리는 독립 검증 가능해야 하고 "if you implement just ONE of them, you should still have a viable MVP" / Given-When-Then 수용 시나리오) / Edge Cases / Functional Requirements(`FR-001: System MUST …`, 불명확 항목은 `[NEEDS CLARIFICATION: …]` 마커) / Key Entities / Success Criteria(측정 가능·기술 중립) / Assumptions. 스펙 템플릿은 설계 세부를 금지한다 — "❌ Avoid HOW to implement (no tech stack, APIs, code structure)".
- **converge 단계:** "Repeat **implement → converge** until convergence reports **Converged**."(README) 구현이 스펙에 수렴했는지를 별도 단계로 판정한다.
- **별도 진입점 2개:** 버그픽스(assess→fix→test, "Missing verification is not a successful fix")와 아이디어 평가(증거 기반 go/needs-clarification/kill 결정)는 SDD와 독립 확장이다. 버그픽스 산출물은 `.specify/bugs/<slug>/`, 평가 산출물은 `.specify/assessments/<slug>/`에 기록된다.

### 3.2 태스크 도출과 역추적

- **tasks.md 문법**(`templates/tasks-template.md`): `[T012] [P] [US1] Create [Entity] model in src/models/[entity].py` —
  - `[P]` = 병렬 실행 가능("different files, no dependencies"),
  - `[US1]` = 소속 사용자 스토리 — **태스크 ID가 스토리 ID를 참조하는 것이 역추적의 문법**이다.
  - "Include exact file paths in descriptions" — 태스크에 파일 경로를 명시해 쓰기 범위 충돌을 사전에 식별 가능하게 한다(Loop의 read/write scope 선언과 동형).
- **단계 구성:** Phase 1 Setup → Phase 2 Foundational("No user story work can begin until this phase is complete") → Phase 3+ 스토리별(테스트 먼저, "Write these tests FIRST, ensure they FAIL before implementation") → **Checkpoint** 문장으로 스토리 단위 완료 상태를 고정한다("At this point, User Story 1 should be fully functional and testable independently").
- **정당화의 문서화:** 복잡성 게이트 위반은 plan.md의 Complexity Tracking 표에 `위반 | 필요 이유 | 더 단순한 대안을 기각한 이유`로 남긴다 — 우회가 기록 없이는 불가능한 구조다.

### 3.3 LLM/에이전트 시대의 문서 강제 장치 (템플릿 품질 장치 7가지)

`spec-driven.md`는 템플릿이 에이전트 출력을 구속하는 장치를 7개 명시한다 — Loop의 태스크 지시문 설계에 직접 참조 가능한 목록이다:

1. **조기 구현 세부 금지**(스펙은 WHAT/WHY만),
2. **`[NEEDS CLARIFICATION]` 마커 강제**("Don't guess: If the prompt doesn't specify something, mark it"),
3. **체크리스트 = 스펙의 단위 테스트**("No [NEEDS CLARIFICATION] markers remain" 등 자가 검토),
4. **헌법 게이트**(Simplicity Gate: ≤3 프로젝트? 미래 대비 없음? / Anti-Abstraction Gate),
5. **계층적 상세 관리**(plan은 high-level 유지, 코드 샘플은 별도 파일로 추출),
6. **검사 우선 파일 생성 순서**(contracts → contract/integration/e2e/unit 테스트 → 소스),
7. **투기적 기능 금지**("Every feature must trace back to a concrete user story").

## 4. RFC 문화 — Rust RFCs

### 4.1 표준 섹션 구성

`rust-lang/rfcs`의 `0000-template.md`(출처: raw, master)는 다음 필수 절을 요구한다:

| 절 | 요구 내용 |
| --- | --- |
| Summary | 기능 1문단 설명 |
| Motivation | "solving a problem that users of Rust are having" — 문제·배경·구체적 사용 사례. "one of the most important sections"로 명시 |
| Guide-level explanation | 이미 구현된 것처럼 가르치듯 설명(예제 중심, 이름 붙은 개념 소개, 유지보수성 영향 논의) |
| Reference-level explanation | 구현 상세 — 다른 기능과의 상호작용, 코너 케이스를 예제로 해부 |
| Drawbacks | "Why should we *not* do this?" |
| Rationale and alternatives | "Why is this design the best", 고려한 다른 설계와 기각 이유, 안 했을 때의 영향 |
| Prior art | 다른 언어·커뮤니티의 선행 사례와 교훈 |
| Unresolved questions | RFC 과정/구현 과정에서 해결될 부분, 범위 밖 항목 |
| Future possibilities | 범위 밖이지만 관련된 확장 아이디어 |

### 4.2 프로세스와 역추적

- **적용 임계값(경량화의 RFC 버전):** "substantial" 변경만 RFC 대상이다. RFC 없이 되는 것: 재구성·리팩터링("changing shape does not change meaning"), 객관적 수치 개선, 개발자에게만 보이는 변경, std 사소한 추가(ACP로 대체). 즉 **RFC 문화 자체가 "모든 변경에 문서"가 아니라 임계값 기반 게이트**다.
- **수명주기:** PR로 제출 → 토론 → 서브팀 결정(병합=active 또는 종료, 이유가 불명확하면 결정 사유를 코멘트로 추가) → 구현. 핵심 규칙: *"Being 'active' is not a rubber stamp"* — 승인은 이해관계자 합의이지 병합 보장이 아니다.
- **역추적 체인:** 승인된 RFC마다 Rust 저장소에 **구현 추적 이슈**가 연결되고, 이슈가 트리아지로 우선순위를 받는다 — "Every accepted RFC has an associated issue tracking its implementation". RFC 번호 → 이슈 번호 → PR 번호의 체인이 유지보수자의 "왜 이렇게 만들었나" 질문의 정답 경로가 된다.
- **개정 정책:** 승인된 RFC는 실질 변경 금지 — "Only very minor changes should be submitted as amendments. More substantial changes should be new RFCs, with a note added to the original RFC." RFC는 최종 설계를 반영하려 노력하되 실제 결과와 어긋날 수 있음을 문서 스스로 인정한다 — 과대 문서 유지보수를 금지하는 현실적 균형점이다.
- **Google 문서와의 공통점:** 대안 기각 이유를 필수 절로 요구하고(4.1), 설계 승인과 구현 실행을 분리하며, 문서 갱신에 상한을 두는 점(개정 정책 ↔ Google의 "shipped 전에는 갱신")에서 일치한다.

## 5. Google/Amazon 디자인 문서 관행

### 5.1 Google 디자인 문서 (1차 기록: M. Ubl, "Design Docs at Google")

출처: `industrialempathy.com/posts/design-docs-at-google/`(2026-09-24 원문 fetch, 인용 대조).

- **정의와 기능:** 코드 착수 전 작성하는 "상대적으로 비공식적인 문서"로, 고수준 구현 전략과 **핵심 설계 결정의 트레이드오프**를 기록한다. 문서의 기능 6가지: 설계 문제의 조기 발견("when making changes is still cheap"), 조직 합의, 횡단 관심사 검토, 시니어 지식의 조직 확산, 설계 결정의 조직 기억, 포트폴리오 요약물.
- **표준 섹션 구성:** (비공식 문서라 엄격 규칙은 없다 — "Rule #1 is: Write them in whatever form makes the most sense", 그러나 관습화된 구조가 존재한다)
  1. **Context and scope** — 독자를 맥락에 올려놓기. "This isn't a requirements doc. Keep it succinct!" 객관적 사실만.
  2. **Goals and non-goals** — 비목표는 부정된 목표가 아니라 "목표일 수 있으나 명시적으로 제외한 것"(예: ACID 준수). 비목표 명시가 설계 공간을 줄인다.
  3. **The actual design** — 개요 후 상세. 시스템 컨텍스트 다이어그램, API 스케치(공식 정의 복붙 금지 — "quickly get out of date"), 데이터 저장 형태, 코드/의사코드는 신규 알고리즘일 때만, **해법 공간의 구속 정도(degree of constraint)**에 따라 문서의 초점이 달라짐(그린필드는 규칙 수립이 필요, 레거시 제약은 조합 선택에 집중).
  4. **Alternatives considered** — "this section is one of the most important ones as it shows very explicitly why the selected solution is the best given the project goals".
  5. **Cross-cutting concerns** — 보안·프라이버시·관측가능성을 조직이 표준화해 여기서 강제 검토.
  6. **분량** — 대형 프로젝트 10–20쪽, **1–3쪽 "미니 디자인 문서"** 명시 지원: "especially helpful for incremental improvements or sub tasks in an agile project".
- **수명주기:** 생성·빠른 반복 → 리뷰(경량: 문서 공유·코멘트 ~ 중량: 정식 리뷰 미팅) → **구현과 반복**("If the designed system hasn't shipped yet, then definitely update the doc" — 그러나 문서 갱신은 잘 안 되므로, 개정판 링크를 원문에서 걸어주는 "설계 문서 고고학" 대비 권고) → 유지보수·학습("Where is the design doc?"가 새로 온 엔지니어의 첫 질문).
- **쓰지 말아야 할 때:** "The decision whether to write a design doc comes down to … whether the solution to the design problem is ambiguous." 해법이 명백하면 문서가 아니라 코드. 설계 문서가 "구현 매뉴얼"(트레이드오프·대안·의사결정 없는 "이렇게 만든다")이 되려면 쓰지 말라는 반패턴 명시. 프로토타이핑도 설계 문서 작성의 일부가 될 수 있다("I tried it out and it works").

### 5.2 두 관행의 공통 구조

Google 문서와 Rust RFC는 독립 관행이지만 같은 뼈대를 공유한다: (a) 동기는 문제(Motivation/Context), (b) 본체는 설계+**대안 기각**, (c) 승인은 구현 전 게이트, (d) 승인 후 문서는 안정(미세 개정만), (e) 구현물은 문서로 역참조된다. 차이는 대상 독자 — RFC는 커뮤니티 토론용(공개 토론 기록이 곧 근거), 디자인 문서는 조직 내 합의용.

### 5.3 Amazon Working Backwards / PR-FAQ ⚠️ 서지 출처

> **증거 한계:** 이 절은 Amazon 자체 웹 자산 수집 실패(§증거 경계)로 인해 표준 서지 출처 기반 요약이며, 원문 인용은 없다. Loop 적용 논의(§7 이하)에는 이 절을 사용하지 않는다.

Amazon의 문서 중심 프로세스는 『Working Backwards: Insights, Stories, and Secrets from Inside Amazon』(C. Bryar, B. Carr, St. Martin's Press, 2021)가 표준 공개 기록이다. 핵심 관행: (a) 제품 착수 전 가상의 보도자료+FAQ(**PR/FAQ**)를 먼저 써 고객 경험을 정의, (b) 회의 자료로 슬라이드 대신 **6-pager 서술 문서** 사용, (c) "working backwards from the customer" — 고객 역방향이 아이디어 필터. Loop와의 관련성은 구조적 유비(analogy) 수준이고, 본 조사의 다른 4계열로 충분히 커버된다.

## 6. 사례 간 비교 — 섹션 구성·도출·역추적·경량화

| 축 | Kiro | Spec Kit | Rust RFC | Google 디자인 문서 |
| --- | --- | --- | --- | --- |
| **설계 문서 표준 절** | Architecture, Data Flow, Interfaces, Data Models, Error Handling, Unit Testing Strategy | plan: Summary, Technical Context, Constitution Check, Project Structure, Complexity Tracking | Guide-level/Reference-level 설명, Drawbacks, Rationale and alternatives, Prior art, Unresolved questions, Future possibilities | Context and scope, Goals and non-goals, The actual design, Alternatives considered, Cross-cutting concerns |
| **요구사항 표현** | EARS(`WHEN … THE SYSTEM SHALL …`), 스토리+수용 기준 | `FR-001: System MUST`, `[NEEDS CLARIFICATION]` 마커, Given-When-Then 시나리오 | Motivation 절의 사용 사례(형식 강제 없음) | 요구사항 문서와 명시적 분리("This isn't a requirements doc") |
| **요구사항→설계→태스크 도출** | 3단 게이트 워크플로(변형: Design-First도 가능), Refine/Sync Files로 재동기화 | specify→plan→tasks 명령 체인, 헌법 게이트 통과가 plan 전제, 태스크는 스토리별 그룹 | 해당 없음(RFC 자체가 "설계 승인"); 승인 후 구현 이슈 분리 | 문서 승인(리뷰) 후 구현; 구현 중 설계 변경은 문서 갱신(shipped 전) |
| **구현→설계 역추적** | `#spec` 맥락 주입, EARS 수용 기준, 태스크 체크박스 상태 | 태스크 `[US1]` 문법, 정확한 파일 경로, converge 판정, 체크리스트 게이트 | RFC 번호→구현 이슈→PR 체인, 개정은 원문에 주석 | "design doc archaeology"(개정 링크), 유지보수 진입점 |
| **병렬화 지원** | 태스크 의존성 그래프→wave 동시 실행 | `[P]` 마커(파일 기반 독립성), Foundational 단계 장벽 | 해당 없음 | 해당 없음 |
| **소규모 경량화** | Plan mode(문서 없음)/Quick Spec(게이트 없음)/정식 스펙 | 확장·프리셋으로 단계 생략 가능("independent entry points") | substantial 판정 기준(작은 변경은 RFC 면제) | 1–3쪽 미니 문서, "쓰지 않아도 되는 때" 기준 |
| **기계 강제** | 태스크 실행 인터페이스, Analyze Requirements | 템플릿 7장치, 체크리스트 게이트, "검증 없는 수정은 성공이 아니다" | CI 병합 게이트(토론 기록 자체가 근거) | 없음(조직 리뷰에 의존) — 유일하게 강제가 없는 계열 |

**공통 불변식(4계열 중 3개 이상):**

1. 요구사항(무엇/왜)과 설계(어떻게)의 **문서 분리** — 혼합 금지(Spec Kit은 템플릿 수준에서 금지).
2. 설계 문서에는 **대안과 기각 이유**가 필수.
3. 승인(결정 고정)과 구현(실행)의 **이벤트 분리**.
4. 역추적은 문법(ID/마커/링크 체인)으로 만든다.
5. 전면 적용이 아니라 **임계값 기반 탈출 사다리**.

## 7. 선행 리서치·D1–D3와의 정합성 및 결합 제안

### 7.1 정합성 확인 (충돌 없음, 보강 2건)

| 확인 항목 | 선행 문서의 결론 | 본 조사와의 관계 |
| --- | --- | --- |
| 단일 출처 원칙 | `design-system-practices.md` §3.1 — 토큰 원본은 한 곳, 문서가 아니라 코드가 import하는 상수가 곧 문서 | **정합 + 범위 분리.** design.md 워크플로는 "결정의 원천"을 문서에 둔다. 충돌 없는 이유: 토큰 문서는 "값"의 원천(상수), design.md는 "결정과 이유"의 원천(기록). 양쪽 모두 "두 곳에 두지 않는다"는 동일 원칙의 다른 층위. Loop의 design.md는 결정 이유를 기록하고 값은 상수로 승격되므로 이중 출처가 되지 않는다 |
| 도구 강제 | `design-system-practices.md` §3.2(Polaris 린트), D3(경계 테스트·무결성 테스트) | **보강.** Spec Kit의 템플릿 7장치(§3.3)는 "문서 품질도 기계 강제로"라는 동일 철학의 프로세스 버전이다. Loop의 completion checks(bash 명령)는 이 문서들의 검증 단계를 그대로 실행기로 갖는다 — design.md §9(검증 계획)가 completion checks의 근거 문서가 되는 구조 |
| 에이전트 병렬 실행 | Loop 코어의 DAG·wave 스케줄링, `oss-agent-ui-survey.md`의 워커 표시 관찰 | **동형 확인.** Kiro의 tasks.md 의존성 그래프→wave 실행(§2.2)은 독립 사례가 Loop와 같은 설계에 수렴했음을 보여준다. tasks.md의 `[P]`/파일 경로 명시(Spec Kit)는 Loop 태스크의 read/write scope 선언과 대응 — design.md에서 태스크를 도출할 때 쓰기 범위를 함께 적으면 Loop DAG 변환이 자동화 가능하다 |
| 결정 직렬화 | AGENTS.md — "Serialize decision and integration nodes" | **정합.** 4계열 모두 "설계 승인=직렬화 지점, 구현=병렬화 가능" 구조. Kiro의 게이트, Spec Kit의 헌법 게이트, RFC의 서브팀 결정, Google의 리뷰가 모두 동일 역할 |

### 7.2 D1–D3 결합 제안

후속 결정 태스크가 `docs/design/design.md`를 작성할 때, 그 첫 적용 사례는 D1–D3(표현 어휘 토큰 모듈·시맨틱 토큰+환경 가드·일관성 강제)의 구현이 된다. 결합 방식:

1. **D1–D3 → design.md §4(요구사항)의 EARS화 예:**
   - D1: `WHEN 어떤 TS 파일이 presentation 밖에서 글리프를 출력할 때, THE SYSTEM SHALL @loop/presentation의 어휘 상수를 통해서만 출력한다.`
   - D2: `WHEN NO_COLOR 환경변수가 비어있지 않을 때, THE SYSTEM SHALL 색 이스케이프를 방출하지 않는다.`
   - D3: `WHEN architecture-boundaries 테스트가 실행될 때, THE SYSTEM SHALL presentation 밖의 ANSI/색 리터럴을 위반으로 보고한다.` — 검증 방식이 이미 bash 명령으로 존재하므로 EARS 문장이 completion check로 직역된다.
2. **design-foundations.md §6의 후속 결정 D-1~D-6 → design.md §8(미해결 질문)** — 결정 전 항목은 attention 후보로, 결정되면 §4/§5로 흡수한다.
3. **design-foundations.md §5의 2주 계획(S1–S8) → design.md §7(역추적 표)의 태스크 열** — S1–S8은 이미 검증 명령·위험·롤백을 갖는 8태스크이므로, `kind`(S1은 implementation, S6은 research+decision)와 쓰기 범위만 붙이면 Loop task DAG가 된다. Kiro wave 개념(§2.2)으로 보면 S1→S2/S3→S4가 의존 체인, S5–S8이 2주차 wave다.
4. **"Constitution 신설 금지":** Spec Kit의 헌법에 해당하는 것은 Loop에 이미 존재한다 — `AGENTS.md`(경계·불변식)와 `docs/decisions/**`. design.md §5(설계)의 "Constitution Check"는 "AGENTS.md 경계 위반 여부 + 관련 ADR 나열"로 국소화된다. 새 문서를 만들면 단일 출처가 깨진다.

## 8. Loop용 design.md 절별 규격 (§0 요약표의 상세)

| 절 | 작성 규칙 | 절대 규칙(금지) |
| --- | --- | --- |
| 1. 메타·상태 | 일자, `draft→review→accepted` 상태 전이, 선행 근거(리서치·감사) 링크, 승인 태스크 id | 상태 없는 병합 금지(RFC의 active 개념) |
| 2. 배경과 범위 | 사실만, 기존 문서 링크로 대체, 요약은 짧게 | 요구사항을 여기에 섞지 않음(Google 명시) |
| 3. 목표와 비목표 | 목표/비목표 불릿 각 수 개. 비목표는 "목표일 법한 것"만 | "하지 않는 것"을 목표로 재진술 금지 |
| 4. 요구사항 | EARS 문장 + 각 행에 검증 방식(실행 명령 또는 관찰 방법). 불명확하면 `[NEEDS CLARIFICATION]` 마커(Spec Kit) — 마커 잔존 시 accepted 불가 | 구현 방법(tech stack/파일) 기술 금지(Spec Kit 스펙 절 금지사항) |
| 5. 설계 | Kiro design.md 6항목 중 해당하는 것만 + Loop 특화: 영향받는 계층(crates/packages)과 AGENTS.md 경계 준수 확인. Rust bridge 타입 변경 시 codegen 명시 | 전체 코드 복붙 금지(인터페이스 스케치만 — Google) |
| 6. 검토된 대안 | 채택 대안당 기각 대안 ≥1 + 기각 이유(트레이드오프) | "검토했음" 서술만으로 대체 금지(RFC Drawbacks 존재 이유) |
| 7. 역추적 표 | 행 = 요구사항 ID ↔ 설계 절 ↔ 태스크(`id`·`kind`·쓰기 범위·의존) ↔ 완료 확인 명령. 태스크에 파일 경로 명시(Spec Kit) | 표 없는 태스크 나열 금지 — 역추적은 표가 본체 |
| 8. 미해결 질문·위험 | 질문당 답변 책임(어느 결정/attention에서) 명시 | accepted 상태로 미해결 잔존 금지(RFC Unresolved questions 원칙) |
| 9. 검증 계획 | completion check 명령 목록(`bun run check`, `bun test packages`, `bun run test:architecture` 등), 부분 롤백 경계 | "워커 성공"을 완료 근거로 인정 금지(AGENTS.md) |

**도출 흐름(권고):** `intent` → research 태스크(본 문서류) → design.md(§1–§8, decision 태스크에서 accepted) → §7 표에서 태스크 DAG 자동 파생 → 구현(병렬) → §9 완료 확인 → converge에 해당하는 최종 검증 태스크.

## 9. 소규모 팀(1인 + 에이전트) 경량화 규칙 — 권고 5가지

1. **임계값 기반 적용:** 태스크 1개로 끝나는 변경은 design.md 없이 결정 문서(`docs/decisions/`) 또는 리서치 문서로 충분하다(Rust RFC의 substantial 기준, Google의 "ambiguous 판정"). 멀티 태스크 DAG가 예상되는 변경만 design.md.
2. **미니 design doc:** 1–3쪽 유지(Google). 절 9개는 "해당하는 것만"(§8), 없는 절은 생략하되 §4·§6·§7은 생략 불가(요구사항·대안·역추적이 이 워크플로의 최소 불변식).
3. **게이트는 1개만:** Kiro의 2게이트(요구사항 승인+설계 승인)를 Loop에서는 decision 태스크 1개(design.md accepted)로 수렴. 게이트를 줄이는 대신 Quick Spec의 원칙을 적용 — 명확화 질문을 design.md §8(미해결 질문)에 전면 로드하고, 잔존 질문은 attention으로.
4. **저장소 내 공존:** design.md는 `docs/design/`에, 코드와 같은 저장소(Kiro 관행). 별도 문서 시스템(위키·외부 툴) 금지 — 링크·역추적·버전 관리가 모두 저장소 안에서 해결된다.
5. **문서 갱신 규칙의 상한:** 미출하(shipped 전) 설계 변경은 design.md를 갱신하고, 출하 후 발견은 새 문서+원문 링크(Google의 개정 관행, RFC 개정 정책). 문서를 완전동기화하려는 시도 자체를 금지 — 이것이 문서 워크플로가 유지보수 부담으로 전락하는 주 경로다.

---

## 부록 A: 1차 자료 목록 (모두 2026-09-24 접근)

| 출처 | 형태 | URL |
| --- | --- | --- |
| Kiro 공식 문서 — Specs 개요 | 공식 문서 마크다운 원본 | https://kiro.dev/docs/specs.md |
| Kiro — Feature Specs (워크플로 변형, EARS, design.md 절) | 공식 문서 마크다운 원본 | https://kiro.dev/docs/specs/feature-specs.md |
| Kiro — Specs Best Practices (동기화, `#spec`, 저장, 조직화) | 공식 문서 마크다운 원본 | https://kiro.dev/docs/specs/best-practices.md |
| Kiro — Bugfix Specs (bugfix.md 3동작 구조) | 공식 문서 마크다운 원본 | https://kiro.dev/docs/specs/bugfix-specs.md |
| Kiro — Quick Spec (게이트 없는 일괄 생성) | 공식 문서 마크다운 원본 | https://kiro.dev/docs/specs/quick-spec.md |
| Kiro — Plan mode (문서 미생성 경량 모드) | 공식 문서 마크다운 원본 | https://kiro.dev/docs/specs/plan.md |
| GitHub Spec Kit — README (프로세스 3종, converge) | 공식 저장소 원문 (raw, main) | https://raw.githubusercontent.com/github/spec-kit/main/README.md |
| GitHub Spec Kit — SDD 방법론 (철학, 템플릿 7장치) | 공식 저장소 원문 (raw, main) | https://raw.githubusercontent.com/github/spec-kit/main/spec-driven.md |
| GitHub Spec Kit — templates/{spec,plan,tasks,constitution,checklist}-template.md | 공식 저장소 원문 (raw, main) | https://github.com/github/spec-kit/tree/main/templates |
| Rust RFCs — RFC 프로세스 README | 공식 저장소 원문 (raw, master) | https://raw.githubusercontent.com/rust-lang/rfcs/master/README.md |
| Rust RFCs — 0000-template.md (표준 절) | 공식 저장소 원문 (raw, master) | https://raw.githubusercontent.com/rust-lang/rfcs/master/0000-template.md |
| M. Ubl, *Design Docs at Google* | 실무자 1인칭 공개 상세 기록 | https://www.industrialempathy.com/posts/design-docs-at-google/ |
| C. Bryar, B. Carr, *Working Backwards* (2021) | 서지 출처(원문 웹 미수집 — §5.3) | ISBN 9781250838358, St. Martin's Press |

## 부록 B: 검증

- 본 조사는 읽기 전용이며 코드·테스트 변경이 없으므로 `bun run check` 대상 변경이 없다.
- 쓰기 범위 준수: 본 문서(`docs/design/research/design-md-practices.md`)만 생성했다.
- 완료 확인: `test -s docs/design/research/design-md-practices.md && grep -qiE 'kiro|spec kit|RFC' docs/design/research/design-md-practices.md`
