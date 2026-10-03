# 스킬 기반 디자인 관행 vs Loop `design.md` 워크플로 — 종합 권고

- **일자:** 2026-09-24 KST
- **태스크:** `synthesize-skill-vs-loop-workflow` (integration, attempt 0)
- **상태:** recommendation — `docs/design/design.md` 승인 전 의사결정 입력
- **범위:** 선행 조사 2건과 Loop의 워크플로·designer 페르소나·D-1~D-6을 대조한다.
- **비범위:** `docs/design/design.md`, `config/personas/designer.md`, 코드·토큰·테스트의 변경. 본 태스크는 이 문서만 작성한다.

## 0. 판정 요지

1. **부분 채택:** designer는 긴 스타일 백과사전이 아니라 기존 결정·근거를 찾고, 출처와 적합성을 확인하며, 불확실하면 기권하는 **얇은 절차 라우터**로 보강할 가치가 있다.
2. **현 시점 비채택:** 별도 `designs.md`/루트 `DESIGN.md`, `MASTER.md` override 트리, 범용 style/brand DB는 Loop의 승인된 `design.md`와 presentation 상수에 제3의 원천을 더한다.
3. **유지:** `design.md` 승인 게이트 + ADR + 타입 있는 presentation 정책 + 기계 검증이 Loop의 현재 규모와 경계에 가장 단순하다. D-1·D-3·D-4는 진행하고 D-2·D-5·D-6의 연기를 유지한다.

## 1. 판정 기준

본 문서는 인기나 설치 수가 아니라 다음 기준으로 채택 여부를 판단한다.

1. **역할 분리:** 변경 제안, 현재 규범 값, 실행 지침의 수명주기가 섞이지 않는가.
2. **단일 원천:** 같은 디자인 값이나 요구사항을 둘 이상의 문서·코드가 독립 선언하지 않는가.
3. **결정성:** 모델의 취향 판단이 아니라 저장소에 고정된 정책·문서·테스트로 결과를 재현할 수 있는가.
4. **역추적성:** 추천의 원문 근거와 적용 이유가 EARS 요구사항·결정·태스크·검증으로 이어지는가.
5. **경계 정합성:** `loop-core → loop-store → loop-bridge → generated protocol → orchestrator → adapters/UI` 의존 방향, 얇은 TypeScript 어댑터, 결정·통합 노드 직렬화를 지키는가.
6. **현재 비용:** CLI/TUI 중심의 좁은 표면에서 유지 주체와 실제 소비자가 있는가.

## 2. 종합 비교·판정표

| 측면 | 생태계 관행 | Loop 현황 | 채택 권고 |
| --- | --- | --- | --- |
| **설계 전 절차** | Anthropic `frontend-design`은 plan→brief 대조→build→critique를 요구한다([원문](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/frontend-design/SKILL.md#L36-L59)). UI UX Pro Max는 제품·대상·맥락을 추출하고 검색 결과가 빗나가면 한 번 좁혀 재검색한다([원문](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/SKILL.md#L47-L81)). | designer는 Read scope 선행 읽기, 범위, 인터페이스, 대안, 완료 기준을 이미 요구한다. `design.md`는 draft→accepted 게이트와 EARS·역추적을 제공한다. | **부분 채택.** 현재 절차를 교체하지 말고 “기존 결정 우선→외부 후보 검색→적합성 확인→1회 재검색→근거 부족 시 기권”만 보강한다. 추천은 승인 전 입력이지 요구사항이 아니다. |
| **reasoning rules** | UI UX Pro Max는 허용 condition/action만 받는 비실행 closed grammar와 발동 규칙 audit trail을 둔다([원문](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/reasoning_contract.py#L1-L123)). | 검증 가능한 규칙은 EARS, ADR, `policy.toml`, 타입 있는 presentation 상수와 테스트로 표현하도록 이미 설계했다. persona는 행동 지침일 뿐 규범 값의 원천이 아니다. | **절차 규칙만 채택, rule engine은 비채택.** persona에는 우선순위·기권·출처 기록 같은 reasoning 절차를 둘 수 있다. 제품 profile/action DSL은 반복 질의와 유지 주체가 생기기 전에는 이중 정책 엔진이다. |
| **스타일 참조** | `styles.csv`는 stable ID·alias·용도·금기·교체 관계를 가진 taxonomy이며 79개 비-deprecated 스타일을 검색한다([원문](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/data/styles.csv)). Anthropic은 스킬 본문에 미학 원칙을 둔다. | Loop의 문제는 범용 웹 스타일 선택이 아니라 상태 판독성, 글리프·문구 단일화, `NO_COLOR`, 비-TTY 안전, 줄 예산이다. | **persona 내 스타일 카탈로그 비채택.** Loop 고유 quality floor와 canonical 내부 문서 링크만 둔다. 특정 glyph·색 값은 D-1/D-3/D-4와 presentation 정책이 소유한다. |
| **프로젝트 디자인 문서** | UI UX Pro Max는 `designs.md`가 아니라 `design-system/<project>/MASTER.md`+page override를 생성하고 master부터 재소비한다([원문](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/README.md#L434-L466)). Google은 루트 `DESIGN.md`의 YAML token+prose를 agent context로 쓴다([원문](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md#L99-L110)). | `docs/design/design.md`는 현재 변경의 요구사항·설계·태스크·검증을 담고, ADR은 영속 결정, presentation 상수·테스트는 현재 값의 규범 원천이다. | **별도 경량 `designs.md`/루트 `DESIGN.md` 비채택.** 이름이 비슷해도 시각 truth와 변경 설계는 다른 수명주기다. 지금 추가하면 R13 링크 허브·ADR·상수에 이어 제3의 원천이 된다. |
| **전역+국소 override** | UI UX Pro Max는 Master 후 page 문서가 다른 값만 override한다. 기본 no-overwrite이고 `--force`는 기존 문서 선행 읽기와 명시 승인을 요구한다([생성기](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/design_system.py#L972-L1073)). | `design.md`의 accepted 요구사항을 바꾸려면 decision 태스크와 문서 개정이 필요하며 실행 상태는 orchestrator가 단일 원천이다. | **no-overwrite는 채택, 암묵 override는 비채택.** 표면별 차이가 필요하면 전역 문서를 조용히 덮는 page 파일이 아니라 근거가 링크된 annex/ADR 후보로 만들고, EARS 변경이면 승인 게이트를 다시 거친다. 현 규모에서는 annex도 만들지 않는다. |
| **brand 지식과 토큰** | brand 스킬은 사람용 `docs/brand-guidelines.md`를 JSON/CSS 토큰으로 동기화하고 기존 토큰 원천 발견 시 기본 중단한다([원문](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/brand/SKILL.md#L25-L66)). | Loop는 단일 TS presentation 소비자를 위한 타입 있는 어휘·색 역할과 무결성 테스트를 계획했다. Rust/TS 공유는 아직 없다. | **원천 충돌 시 fail-closed 원칙만 채택.** brand 문서→JSON→CSS 파이프라인은 비채택. 두 번째 runtime 소비자가 생기면 D-6에서 Google `DESIGN.md`, DTCG JSON, bridge 생성 타입을 비교한다. |
| **검색 가능 style/brand DB** | UI UX Pro Max는 products/reasoning/colors/styles/type/landing/UX CSV와 BM25를 사용해 후보를 합성하고 provenance를 남긴다([생성기](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/design_system.py#L451-L578)). | 현재 표면과 문제는 이미 감사 P1–P4, 요구사항 R1–R13으로 좁혀졌다. 반복되는 범용 디자인 질의나 DB 관리 주체가 없다. | **비채택.** 유지·검색 calibration 비용이 이득보다 크다. 동일 질문이 반복되고 2개 이상의 표면이 같은 taxonomy를 소비하며 owner가 정해질 때만 재검토한다. |
| **출처·provenance** | UI UX Pro Max는 source identity/derivation과 발동 rule을 결과에 남긴다. Vercel 스킬은 모든 최신 규칙을 적용하고 `file:line` finding을 요구한다([원문](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md#L168-L190)). | `design.md` §4는 감사·사례 근거, §7은 R↔태스크↔완료 확인을 기록한다. 다만 persona는 외부 후보의 source/applicability/기권 방식을 명시하지 않는다. | **채택.** 외부 제안에는 고정 원문, Loop 적용 이유, confidence/fallback을 남긴다. 리뷰 finding은 `file:line` 또는 `R<n>`에 연결한다. 별도 DB 없이 문서 계약으로 충분하다. |
| **최신 원격 규칙 로드** | Vercel `web-design-guidelines`는 리뷰마다 별도 저장소의 최신 `command.md`를 fetch하는 얇은 라우터다([원문](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines/SKILL.md#L10-L37)). | Loop completion은 저장소에 고정된 명령으로 끝나야 하고 유료/외부 호출에 의존하지 않는다. | **라우터 형태만 채택, latest fetch는 비채택.** persona는 canonical 저장소 문서와 테스트를 가리키되, 외부 자료는 커밋에 고정한 조사 입력으로만 사용한다. |
| **검증과 리뷰** | Google `DESIGN.md`는 lint/diff/export와 contrast 검사를 제공한다([원문](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md#L318-L356)). Impeccable은 audit finding, detector, screenshot, 별도 reviewer를 둔다([원문](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/reference/audit.md#L7-L103)). | `design.md` §9와 각 태스크 completion check가 검증 원천이며 R11/R12는 경계·무결성 테스트를 계획한다. | **machine-checkable 사상은 채택, 별도 도구 체인은 비채택.** 기존 `bun test packages`, `bun run test:architecture`, `bun run check`에 집중한다. checklist나 worker 성공은 완료 근거가 아니다. |
| **문서 갱신 시점** | Impeccable은 구현 전 surface direction contract와 finish review 뒤 실제 구현에서 추출한 루트 `DESIGN.md`를 분리한다([원문](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/reference/new-work.md#L71-L83)). | Loop는 계획·근거를 `design.md`, 영속 결정을 ADR, 현재 규범 값을 타입 있는 코드·테스트에 둔다. 머지 뒤 발견은 새 문서/ADR로 처리한다. | **수명주기 구분 채택.** 그러나 구현 후 별도 `DESIGN.md`를 만들 필요는 없다. 현재 truth는 presentation 상수와 테스트에서 추출·검증한다. |
| **AGENTS/persona 문서** | 생태계의 `SKILL.md`/`AGENTS.md`는 무엇을 언제 읽고 어떤 출력을 만들지 라우팅한다. 값까지 내장한 스킬은 반복 세션 drift를 기계적으로 막지 못한다. | `AGENTS.md`가 전역 경계·검증 불변식, `config/personas/designer.md`가 설계 워커 계약을 소유한다. | **현 구조 유지.** AGENTS에 시각 값을 넣거나 새 헌법을 만들지 않는다. designer에는 중복 규칙이 아니라 canonical 링크·소비 순서·기권 계약만 추가하는 안을 승인 후 검토한다. |

## 3. 핵심 질문별 최종 판정

### 3.1 designer 페르소나에 reasoning rules/스타일 참조를 추가할 것인가

**판정: reasoning 절차는 추가 권고, 스타일 값·카탈로그는 추가하지 않는다.**

현재 `config/personas/designer.md`는 읽기 범위, 범위/비범위, 인터페이스, 대안, 검증, 경계 준수를 이미 강하게 규정한다. 빠진 것은 “후보를 어떻게 찾고 버릴지”다. 아래 네 규칙이면 충분하다.

1. 저장소의 accepted `design.md`·관련 ADR·현재 코드/테스트를 외부 사례보다 먼저 읽는다.
2. 외부 검색은 한 번에 하나의 디자인 질문으로 좁히고, 고정 원문·적용 이유를 기록한다.
3. 결과가 맞지 않으면 한 번만 좁혀 재검색하며, 근거가 없으면 추측값을 저장하지 않고 기권한다.
4. material finding은 `R<n>` 또는 `file:line`에 연결하고, checklist 수행을 completion으로 판정하지 않는다.

이는 UI UX Pro Max의 검색/기권 계약과 Vercel의 구조화 finding을 가져오되, 모델이 해석하는 제품 profile을 정책 엔진으로 만들지 않는 절충안이다. 특정 `✓/!/-`, 색, spacing, 스타일 이름은 persona에 쓰지 않는다. 그런 값은 D-1/D-3/D-4의 결정과 presentation의 타입 있는 상수가 소유해야 한다.

### 3.2 `design.md` 외 경량 `designs.md`/`DESIGN.md`를 도입할 것인가

**판정: 지금은 도입하지 않는다.**

- Loop `docs/design/design.md`는 **변경 제안과 승인**의 문서다.
- Google/Impeccable의 루트 `DESIGN.md`, UI UX Pro Max의 `MASTER.md`는 **현재 시각 identity/truth**의 문서다.
- Loop의 현재 truth는 presentation 상수·테스트이고, 영속 근거는 ADR이다.

따라서 새 문서는 더 가벼운 consumer artifact가 아니라 동기화해야 할 세 번째 원천이 된다. 실제 두 번째 표면이 동일 시각 규범을 소비하고 코드만으로 발견하기 어려워질 때에만, “값 복제 금지·canonical 원천 링크·편차와 근거만 기록”하는 surface annex를 검토한다. annex가 accepted EARS를 바꾸면 자동 override가 아니라 새 decision/approval을 거쳐야 한다.

### 3.3 style/brand DB 데이터 자산을 도입할 것인가

**판정: 비채택, 명시적 트리거까지 연기한다.**

UI UX Pro Max의 DB는 192개 제품 profile, 79개 비-deprecated 스타일, 192개 팔레트 등 범용 웹 추천을 위한 운영 자산이다. Loop는 CLI/TUI라는 좁은 도메인이고 현재 질문은 감사 P1–P4와 R1–R13으로 이미 특정됐다. 지금 CSV/BM25를 들이면 모델 프롬프트와 별개인 또 하나의 정책 체계, 데이터 freshness, 검색 calibration, 테스트를 운영해야 한다.

재검토 조건은 모두 충족되어야 한다.

1. 같은 디자인 후보 탐색 질문이 여러 에픽에서 반복된다.
2. 둘 이상의 실제 표면/도구가 같은 taxonomy를 소비한다.
3. 데이터 owner와 갱신·검증 completion contract가 정해진다.
4. 기존 ADR/presentation 상수와의 단일 원천 규칙이 정의된다.

## 4. Loop 아키텍처 경계 검사

| 권고 | 배치해야 할 곳 | 금지되는 누수 | 경계 충돌 판정 |
| --- | --- | --- | --- |
| 검색·기권·출처 절차 | `config/personas/designer.md` 같은 워커 계약과 조사 문서 | style/color 값을 persona와 코드에 중복 선언; 외부 latest 문서를 milestone 의존성으로 사용 | **충돌 없음.** 모델 지침은 adapter 코드나 `loop-core`가 아니라 설정/문서에 남는다. |
| EARS·승인·역추적 | `docs/design/<slug>.md` + orchestrator decision/integration 흐름 | 추천 엔진 결과를 accepted 요구사항으로 자동 승격; 태스크 상태를 문서에 복제 | **충돌 없음.** 현재 `design.md` 워크플로를 유지한다. |
| 디자인 규범 값 | `packages/presentation`의 타입 있는 상수와 테스트(승인 뒤 구현) | `loop-core`에 색·glyph·provider/Pi/Herdr 개념 유입; CLI 호출점의 자체 값 | **충돌 없음.** 결정적 presentation 정책을 leaf에 집중하고 TS 어댑터를 얇게 한다. |
| 모델 프롬프트/페르소나 | config 문서가 소비하고 어댑터는 선택·전달만 담당 | provider별 프롬프트를 코어/도메인 타입에 넣거나 adapter 구현에 규칙 복제 | **충돌 없음.** “모델 프롬프트는 어댑터 밖” 원칙을 유지한다. |
| style/brand DB | 현 시점 배치하지 않음. 향후 도입 시 독립 문서/데이터 자산 + validator | DB를 Rust 도메인 정책으로 오인하거나 생성 결과가 bridge 타입을 우회 | **현재 비채택으로 충돌 회피.** 도입 시 별도 설계가 필요하다. |
| 루트 `DESIGN.md`/token JSON | 현 시점 배치하지 않음 | presentation 상수와 값 원천 이중화; Rust/TS 수기 타입 복제 | **현재 비채택으로 충돌 회피.** D-6 트리거 시 Rust bridge 타입부터 설계하고 codegen을 거쳐야 한다. |

핵심 seam은 **후보 생성과 승인된 결정 사이**다. 외부 스킬·검색은 후보와 근거를 내는 도구일 뿐이고, `design.md` decision gate가 이를 Loop 요구사항으로 바꾸는 유일한 인터페이스다. 승인된 값은 문서 프롬프트가 아니라 presentation 정책과 테스트가 집행한다. 이 분리는 모델 취향이 런타임 도메인으로 새는 것을 막고, 삭제 시 복잡성이 여러 호출점에 재등장하는 단일 presentation 모듈에 locality를 만든다.

## 5. D-1~D-6 종합 판정

| 결정 | 선행 조사에서 얻은 근거 | 종합 권고 | 경계 영향 |
| --- | --- | --- | --- |
| **D-1 토큰·어휘 이름** | stable style ID와 점 경로 token은 출처·참조 안정성을 높인다. UI UX Pro Max의 alias도 canonical 항목으로 redirect한다. | **채택 진행.** `status.<state>.glyph`, `color.role.<role>` 같은 canonical 이름 하나를 ADR로 확정한다. persona·문서·코드에 값 목록을 각각 복제하지 않는다. | presentation 정책의 이름만 정하며 core/bridge 무변경. |
| **D-2 herdr 라벨 소유권** | Master/page 구조는 같은 렌더 체계 안의 상속 근거일 뿐 adapter 고유 32자 제약의 이동 근거가 아니다. 생성 문서 경로 drift 사례는 분산 소유의 위험을 보인다. | **연기 유지.** herdr 소유+`design.md` 규격화를 유지하고 두 번째 소비자가 생길 때 presentation 이관을 재결정한다. | 불필요한 herdr→presentation seam을 만들지 않는다. |
| **D-3 glyph 3역할** | 생태계는 semantic role을 값보다 먼저 두지만 특정 glyph 합의는 없다. | **역할 분리 채택, 값 유지.** success/warning/neutral을 타입·테스트로 고정하고 `✓/!/-`는 Loop 로컬 결정으로 둔다. | 값은 presentation에만 존재한다. |
| **D-4 색 1차 범위** | 구현형 사례의 공통점은 semantic color와 환경/접근성 가드이지 대형 테마 엔진이 아니다. | **최소안 채택.** task 상태색+`NO_COLOR`/비-TTY 가드, ANSI 16색부터 시작한다. | adapter는 환경을 전달하고 presentation이 결정적으로 렌더한다. core 무변경. |
| **D-5 terminal width** | 웹 viewport 관행은 terminal grapheme·pipe 동작의 직접 증거가 아니다. | **연기 유지.** 실제 폭 관찰 증거가 있을 때 `policy.toml` 변경으로 별도 결정한다. | 운영 정책 변경이므로 추정으로 presentation에 박지 않는다. |
| **D-6 token 포맷 승격** | Google `DESIGN.md`는 lint/export를 제공하지만 alpha이고, UI UX Pro Max의 Markdown→JSON→CSS는 다중 산출물에서만 비용을 정당화한다. | **연기 유지.** Rust/TS 또는 CLI/pi가 같은 token을 실제 공유할 때 Google 포맷, DTCG JSON, bridge 생성 타입을 비교한다. | 채택 시 Rust bridge 먼저→`bun run codegen`; 수기 TS 복제 금지. |

## 6. 승인 게이트 이후 후속 태스크 후보

아래는 **후보**이며 현재 `draft`인 `docs/design/design.md`의 승인이나 §7 역추적 표를 우회하는 실행 지시가 아니다. 현재 에픽 범위에 넣으려면 승인 리뷰에서 요구사항·태스크 대응을 추가해야 하고, 그렇지 않으면 별도 design.md 적용 기준으로 판단한다.

1. **`harden-designer-evidence-routing` — 문서/정책 decision**
   - 목적: §3.1의 기존 결정 우선, 고정 원문, 적용 이유, 1회 재검색, 기권, `R<n>`/`file:line` finding 규칙을 designer 페르소나에 최소 문구로 반영한다.
   - read scope 후보: `config/personas/designer.md`, accepted `docs/design/design.md`, 본 문서.
   - write scope 후보: `config/personas/designer.md`만.
   - 의존: `docs/design/design.md` 승인 및 이 권고의 채택 decision.
   - 완료 확인 후보: persona에 검색/기권/출처 계약이 존재하고 style/color 값이 없음을 검토; `bun run check`.

2. **`decide-token-naming-adr` — 기존 D-1 decision 태스크 실행**
   - 목적: canonical 경로 이름과 별칭 금지/이관 규칙을 ADR로 확정한다.
   - 의존·완료 확인: `docs/design/design.md` §7의 기존 정의를 그대로 따른다. 본 조사 때문에 별도 태스크나 병렬 이름 원천을 만들지 않는다.

3. **`add-presentation-vocabulary-module` 이후 R11/R12 실행 — 기존 구현 태스크 묶음**
   - 목적: 외부 스킬의 “machine-checkable consistency”를 Loop 기존 구조로 구현한다.
   - 범위: presentation 상수·무결성 테스트·architecture test이며, style DB나 `DESIGN.md` generator는 포함하지 않는다.
   - 의존·완료 확인: `design.md` §7·§9를 그대로 따른다.

4. **`review-design-knowledge-assets-trigger` — 즉시 생성하지 않는 추후 decision**
   - 착수 트리거: §3.3의 네 조건 또는 D-6의 다중 runtime consumer 조건 충족.
   - 비교 대안: (a) 현행 ADR+typed constants, (b) 링크형 surface annex, (c) Google `DESIGN.md`, (d) DTCG/bridge 생성 자산, 필요 시에만 (e) searchable DB.
   - 금지: 트리거 전 빈 `DESIGN.md`, CSV, tokenizer/generator를 선제 생성하는 것.

## 7. 위험과 비채택 사유의 재검토 조건

- **persona가 비대해질 위험:** 절차가 5개를 넘거나 canonical 규칙 본문을 복사하기 시작하면 라우터가 아니라 두 번째 규정집이 된다. 링크와 소비 순서만 남긴다.
- **문서 이름 충돌:** `docs/design/design.md`와 루트 `DESIGN.md`는 목적이 다르다. 후자를 재검토하더라도 이름·수명주기·원천 우선순위를 ADR에서 먼저 정한다.
- **추천의 권위 과대평가:** BM25 top-1, 제품 profile, marketplace 인기, star 수는 후보 발견 신호일 뿐 acceptance evidence가 아니다.
- **문서-only 강제의 한계:** no-overwrite, 기권, 출처 규칙도 기계 검증 가능한 부분은 테스트로 옮긴다. 단, 현 시점에는 별도 스킬 엔진을 만들지 않는다.
- **외부 원문 변동:** 본 판정은 각 링크의 고정 commit을 근거로 한다. latest fetch를 completion contract에 넣지 않는다.

## 8. 결론

Loop가 가져올 것은 “스킬 파일·스타일 DB·`DESIGN.md` 파일명”이 아니라 **지식과 실행 지침의 분리, 검색의 출처/기권 계약, 기존 결정의 no-overwrite, 문서보다 강한 기계 검증**이다. 이를 가장 단순하게 구현하는 구조는 현재의 `design.md` 승인 게이트를 중심으로 designer를 얇은 라우터로 두고, 실제 디자인 값을 presentation의 타입 있는 정책과 테스트에 유지하는 것이다.

따라서 승인 리뷰에서는 D-1·D-3·D-4를 기존 최소안대로 진행하고, D-2·D-5·D-6을 연기하며, 별도 `designs.md`/루트 `DESIGN.md`와 style/brand DB는 도입하지 않는 것을 권고한다.

## 부록 — 직접 근거 문서

- Loop: [`config/personas/designer.md`](../../../config/personas/designer.md), [`docs/decisions/design-md-workflow.md`](../../decisions/design-md-workflow.md), [`docs/design/design.md`](../design.md), [`docs/design/design-foundations.md`](../design-foundations.md)
- 선행 조사: [`2026-09-24-design-skill-ecosystem.md`](2026-09-24-design-skill-ecosystem.md), [`2026-09-24-ui-ux-pro-max-study.md`](2026-09-24-ui-ux-pro-max-study.md)
- 외부 고정 원문: 위 비교표의 UI UX Pro Max `dcc40ff…`, Anthropic `34040c…`, Vercel `063bee9…`/`e3d624b…`, Impeccable `e0881d2…`, Google `9bf8eae…` 링크.
