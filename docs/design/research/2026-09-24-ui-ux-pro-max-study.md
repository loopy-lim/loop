# ui-ux-pro-max-skill 심층 조사 — 워크플로·산출물·문서 재소비 관행

- 조사일: 2026-09-24 KST
- 대상: [`nextlevelbuilder/ui-ux-pro-max-skill`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
- 고정 스냅샷: [`dcc40ff5133ef78276117db0cc34e7b83cc8aeba`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/dcc40ff5133ef78276117db0cc34e7b83cc8aeba) (`main`)
- Loop 대조 기준: [`docs/design/design.md`](../design.md)의 9절 골격, EARS 요구사항, 승인 게이트, D-1~D-6
- 조사 방법: GitHub REST API의 재귀 tree를 조회하고 `raw.githubusercontent.com`에서 원문을 내려받아 읽었다. 핵심 소스·데이터·문서 **22개**를 직접 조사했으며, 같은 커밋의 API tarball로 생성기를 `/tmp`에서 1회 실행해 실제 산출물도 확인했다. 저장소 안의 CLI 배포용 중복 사본은 별도 파일 수로 세지 않았다.

## 요약

1. `ui-ux-pro-max`는 자연어 요구를 제품 유형으로 분류한 뒤 로컬 CSV를 BM25 검색하고, 제품별 reasoning profile을 적용해 스타일·팔레트·타이포그래피·랜딩 패턴을 합성하는 **추천 엔진**이다.
2. 결과를 `design-system/<project>/MASTER.md`와 `pages/<page>.md`로 영속화하며, 후속 에이전트가 Master를 먼저 읽고 페이지 override를 덮어쓰는 명시적 재소비 규칙을 `SKILL.md`와 생성 문서 양쪽에 둔다.
3. 별도 `brand` 스킬은 `docs/brand-guidelines.md`에서 색을 추출해 W3C 형태의 JSON 토큰과 CSS 변수로 내보내지만, 기존 토큰 원천을 발견하면 기본적으로 중단한다. 이는 Loop의 단일 원천·경계 강제와 닮았지만 생성 추천을 승인된 요구사항으로 간주해서는 안 된다.

## 1. SKILL.md가 정의하는 사용 계약

[`SKILL.md`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/SKILL.md)는 다음을 한 문서에서 규정한다.

- **적용 범위와 제외 범위:** UI 구조, 시각 결정, 상호작용, 접근성, 반응형, 타이포그래피, 색, 차트에는 적용하고 순수 백엔드·인프라에는 적용하지 않는다.
- **우선순위:** 접근성 → 터치/상호작용 → 성능 → 스타일 → 레이아웃 → 타이포그래피/색 → 애니메이션 → 폼 → 탐색 → 차트 순이다.
- **질의 계약:** 새 프로젝트/페이지는 `--design-system`, 국소 문제는 명시적 `--domain`, 구현체 문제는 감지한 `--stack`을 사용한다. 결과가 없거나 빗나가면 한 번만 좁혀 재검색하고, 검증하지 않은 결과는 영속화하지 않는다.
- **생성 단계:** 요구사항에서 제품 유형·대상·맥락·스타일 키워드·스택을 추출하고, 디자인 시스템 생성 후 필요할 때만 도메인/스택 검색을 추가한다. 스택은 프로젝트 파일에서 감지하며 추측하지 않는다.
- **품질 체크:** 앱 UI 납품 전에 [`pro-rules.md`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/references/pro-rules.md)의 체크리스트를 읽도록 한다.

**Loop와 한 줄 대조:** 이 계약은 검색·추천·구현 행동을 절차화하지만, Loop `design.md`처럼 배경→목표→EARS 요구사항→설계→대안→요구사항-태스크 역추적→위험→검증의 **승인 가능한 설계 명세**를 만들지는 않는다.

## 2. Design System Generator의 실제 동작

### 2.1 데이터와 검색 형태

검색기는 [`core.py`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/core.py)에 구현된 외부 의존성 없는 BM25 인덱스를 사용한다. 각 도메인은 CSV 파일, 검색 열, 출력 열을 선언하며 질의 커버리지·최소 점수·일부 도메인의 top/runner-up margin으로 기권(abstain)할 수 있다. CSV snapshot과 BM25 index를 캐시하고, 자동 도메인 감지에는 고정 tie-break 순서를 둔다. CLI 진입점은 [`search.py`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/search.py)다.

직접 센 현재 CSV 행과 형태는 다음과 같다.

| 데이터 | 행 수 | 핵심 열/역할 |
| --- | ---: | --- |
| [`ui-reasoning.csv`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/data/ui-reasoning.csv) | 192 | `UI_Category`, 권장 패턴, 스타일 우선순위, 색/타입 mood, 효과, `Decision_Rules`, anti-pattern, severity |
| [`products.csv`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/data/products.csv) | 192 | 제품 유형과 검색 키워드, 1·2차 스타일, 랜딩/대시보드 패턴, 고려사항 |
| [`colors.csv`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/data/colors.csv) | 192 | 제품별 primary/on-primary 등 16개 시맨틱 역할과 notes |
| [`styles.csv`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/data/styles.csv) | 88 | 안정 ID·alias, 키워드, 용도/금기, 모드·성능·접근성, CSS 힌트, 상태/대체 관계 |
| [`typography.csv`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/data/typography.csv) | 74 | 폰트 페어, mood, 용도, URL/CSS/Tailwind |
| [`landing.csv`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/data/landing.csv) | 34 | 안정 ID·alias, 섹션 순서, CTA, 색/효과/전환 전략 |
| [`ux-guidelines.csv`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/data/ux-guidelines.csv) | 119 | 문제·플랫폼·Do/Don't·좋은/나쁜 코드·severity |

README/SKILL의 “79 searchable styles (50 active)”는 88개 행 전체가 아니라 **deprecated 9개를 제외한 79개(50 active + 29 supplemental)**를 뜻한다. deprecated 행은 parent/replacement로 canonical 항목에 redirect된다. 따라서 “79개 UI 스타일 DB”는 단순 이름 목록이 아니라 검색·생성·이관을 위한 taxonomy다.

또한 “192 reasoning rules”는 서로 독립인 범용 UX 규칙 192개라기보다 **192개 제품 카테고리에 1:1 대응하는 reasoning profile 192행**이다. 범용 UX 가이드라인은 별도 119행이다. `Decision_Rules`는 JSON으로, 예를 들어 조건이 맞으면 `style:<stable-id>`, `pattern:<name>`, `constraint:<token>`, `mode:dark|light`를 활성화한다. 파싱과 적용 계약은 [`reasoning_contract.py`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/reasoning_contract.py)에 분리되어 있다.

**Loop와 한 줄 대조:** 이 CSV는 “어떤 디자인을 추천할지”를 검색 가능한 휴리스틱으로 제공하지만, Loop의 EARS는 “어떤 조건에서 시스템이 무엇을 보장해야 하는지”를 검증 가능하게 고정한다. 전자는 후보 생성, 후자는 승인·검증 계약이다.

### 2.2 합성 파이프라인

[`design_system.py`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/design_system.py)의 파이프라인은 다음과 같다.

1. `product` 검색 top-1으로 카테고리를 정한다.
2. 같은 카테고리의 reasoning row를 찾고 질의 문구에 맞는 `Decision_Rules`를 적용한다. 매칭이 없으면 Minimalism/Flat Design 등의 기본값으로 내려간다.
3. 제품·reasoning constraint를 보강한 질의로 product/style/color/landing/typography를 각각 검색한다.
4. reasoning의 stable style ID를 lexical BM25 후보보다 우선하고, dark 요청/스타일이면 색 모드를 먼저 결정한 뒤 호환 팔레트를 고른다.
5. 패턴, 스타일, 16개 시맨틱 색, 타이포그래피, 효과, anti-pattern, 발동한 규칙, source identity/derivation을 하나의 dict로 합성한다.
6. 선택적으로 1–10의 variance/motion/density dial을 적용한다. density는 spacing table, motion은 GSAP snippet, variance는 스타일 검색 편향을 바꾼다.
7. ASCII, Markdown 또는 JSON으로 출력한다.

여기서 중요한 장점은 **선택의 provenance**다. 결과 dict에 제품/reasoning/style/color/type/landing의 source identity와 derivation을 남겨, 단순 LLM 자유 생성보다 결정 출처를 추적하기 쉽다. 반면 제품 top-1 분류와 CSV 휴리스틱에서 시작하므로 실제 제품 제약·현재 코드 감사·이해관계자 승인을 대신하지는 못한다.

**Loop와 한 줄 대조:** 생성기는 한 질의에서 추천안을 빠르게 합성하지만, Loop 9절은 현행 감사 근거, 비목표, 대안, 계층 영향, 롤백, 완료 명령까지 요구하므로 느리지만 변경 통제와 양방향 추적성이 더 강하다.

## 3. 프로젝트 산출물과 후속 세션 재소비

### 3.1 현재 저장소의 문서 이름

현재 커밋의 [재귀 tree](https://api.github.com/repos/nextlevelbuilder/ui-ux-pro-max-skill/git/trees/dcc40ff5133ef78276117db0cc34e7b83cc8aeba?recursive=1)와 전체 원문에서 프로젝트 산출물로서 `designs.md` 또는 `DESIGN.md`를 생성하는 코드는 발견되지 않았다. 현재의 동등 관행은 다음 **Master + Overrides** 구조다.

```text
design-system/
└── <project-slug>/
    ├── MASTER.md
    └── pages/
        └── <page-slug>.md
```

`--design-system --persist -p <name> --output-dir <project-root>`가 Master를 만들고, `--page dashboard`가 page override를 추가한다. 실제 실행에서도 `design-system/loop-probe/MASTER.md`와 `pages/status.md`가 생성되었다.

### 3.2 생성·갱신 정책

- `MASTER.md`에는 시맨틱 색/CSS 변수, 타이포그래피, spacing, shadow, button/card/input/modal 예시, 스타일·페이지 패턴, motion, anti-pattern, pre-delivery checklist가 들어간다.
- page 문서에는 Master와 다른 layout/spacing/type/color/component/recommendation만 기록한다.
- 기본 쓰기는 임시 파일을 fsync한 뒤 같은 파일시스템 hard link로 게시해 동시 생성 시 기존 파일을 덮어쓰지 않는다.
- Master가 있으면 기본값은 `skipped_exists`다. page만 새로 추가할 수 있고, 기존 Master/page를 바꾸는 `--force`는 `SKILL.md`상 사용자의 명시적 허가와 기존 문서 선행 읽기가 필요하다.
- project/page 이름은 `[a-z0-9_-]`만 남기는 slug로 바꿔 path traversal을 막는다.

이 방식은 자동 재생성보다 인간/동료가 수정한 결정을 보존하는 쪽을 택한다. 다만 “업데이트”는 merge가 아니라 **건너뛰기 또는 전체 강제 덮어쓰기**라서, 생성 DB 갱신과 프로젝트 고유 결정의 안전한 병합/이력 관리 기능은 없다.

### 3.3 후속 에이전트의 재소비 규칙

[`SKILL.md`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/SKILL.md)와 [README의 persistence 절](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/README.md#persist-design-system-master--overrides-pattern)은 후속 작업에 다음 순서를 지시한다.

1. `design-system/<project>/MASTER.md`를 읽는다.
2. 해당 페이지의 `pages/<page>.md` 존재 여부를 확인한다.
3. 있으면 page 규칙이 Master를 override하고, 없으면 Master만 따른다.
4. 기존 Master를 재생성하려면 먼저 읽고 명시적 허가를 받은 뒤 `--force`를 사용한다.

즉 검색 DB는 스킬 내부 지식, `MASTER.md`는 프로젝트 전역 결정, page 문서는 국소 편차라는 3단계 기억 구조다.

**주의할 결함:** 실제 생성된 Master/page 헤더는 override 경로를 각각 `design-system/pages/...`, `design-system/MASTER.md`로 적어 `<project-slug>` 단계를 빠뜨린다. 반면 SKILL/README와 실제 파일 배치는 `design-system/<project-slug>/...`다. 후속 에이전트가 생성 문서만 읽으면 잘못된 경로를 탐색할 수 있다.

**Loop와 한 줄 대조:** 계층적 재소비와 기본 no-overwrite는 Loop의 단일 진입점·승인 게이트에 유용한 보완책이지만, page override는 EARS/태스크 역추적 없이 전역 명세를 암묵적으로 재정의하므로 그대로 도입하면 승인 경계를 약화한다.

## 4. brand 스킬의 token injection

별도 [`brand/SKILL.md`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/brand/SKILL.md)는 다음 데이터 흐름을 정의한다.

```text
docs/brand-guidelines.md (사람이 읽는 원천)
  → sync-brand-to-tokens.cjs (색상 table/quick reference 파싱)
  → assets/design-tokens.json (primitive → semantic → component)
  → design-system/generate-tokens.cjs
  → assets/design-tokens.css (CSS custom properties)
```

- [`brand-guidelines-starter.md`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/brand/templates/brand-guidelines-starter.md)는 색, 접근성, typography, logo, voice/tone, imagery, components, AI image prompt, changelog 골격을 제공한다.
- [`sync-brand-to-tokens.cjs`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/brand/scripts/sync-brand-to-tokens.cjs)는 Markdown에서 primary/secondary/accent hex를 추출하고 각 색의 50–900 scale을 생성한다. JSON의 primitive를 갱신하고, 이미 semantic/component 구조가 있으면 참조를 새 primitive로 바꾼 뒤 sibling `design-system` 스킬의 generator로 CSS를 만든다.
- JSON 값은 `$value`/`$type`과 `{primitive.color.<name>.<shade>}` 참조를 쓰며, [`generate-tokens.cjs`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/design-system/scripts/generate-tokens.cjs)가 참조를 풀어 CSS 변수를 생성한다.
- 기존 `assets/design-tokens.*`, `:root` 변수, Tailwind v4 `@theme`, Tailwind config의 colors/preset/theme spread를 발견하면 기본적으로 중단한다. 즉 병렬 토큰 원천을 자동으로 만들지 않는다. `--force`만 덮어쓴다.
- [`inject-brand-context.cjs`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/brand/scripts/inject-brand-context.cjs)는 brand Markdown에서 색·타이포그래피·voice·attributes·image style을 구조화해 텍스트/JSON으로 내보내 후속 프롬프트가 다시 소비하게 한다.

제약도 명확하다. 이름은 “brand-to-tokens”지만 sync 구현이 실제로 토큰에 반영하는 핵심은 **색상**이며, typography·voice는 context injection 대상이지 token sync 대상이 아니다. 또한 빈 JSON에서 시작하면 primitive는 만들지만 기존 starter 같은 semantic/component 골격을 새로 채우지는 않는다. 문서의 “all design systems” 표현보다 구현 범위가 좁다.

**Loop와 한 줄 대조:** 사람용 원천→기계 토큰→소비 코드 흐름과 기존 원천 감지 fail-closed는 Loop R1/R7/R11/R12에 잘 맞지만, Loop는 현재 단일 TS 소비자뿐이라 이 전체 JSON/CSS 변환 체인은 D-6 트리거 전에는 과잉이다.

## 5. Loop `design.md`와 구조별 대조

| ui-ux-pro-max 관행 | Loop 구조와 차이 | 판단 |
| --- | --- | --- |
| SKILL의 우선순위·질의 계약 | Loop §4는 각 요구를 EARS와 감사 근거·검증에 결박한다. 스킬 규칙은 범용 휴리스틱이며 프로젝트별 acceptance criterion이 아니다. | 검색 전 체크리스트로만 사용 가능 |
| BM25 + CSV taxonomy | Loop에는 디자인 후보를 찾는 검색 DB가 없고, 대신 조사 문서와 ADR을 근거로 사용한다. | 후보 탐색 비용이 커질 때만 도입 |
| 192 제품 reasoning profile | Loop는 TUI/CLI라는 좁고 이미 알려진 제품 맥락이며 §2 감사가 더 정확하다. | 현재는 불필요 |
| provenance/source identities | Loop §4 근거, §7 역추적과 목적이 같다. 다만 현재 문서 링크는 수동이다. | 가벼운 출처 메타데이터는 가치 있음 |
| `MASTER.md` + page override | Loop `design.md`는 단일 진입점이고, 세부 영속 결정은 ADR로 분리한다. override는 승인된 전역 요구를 우회할 수 있다. | “override”가 아닌 링크된 surface annex로 변형 필요 |
| no-overwrite + explicit `--force` | Loop accepted 전환·decision task·리드 리뷰 게이트와 같은 보존 방향이다. | 채택 가치 높음 |
| pre-delivery checklist | Loop §9는 실제 명령과 완료 판정까지 명시한다. 스킬 체크리스트는 관찰 항목 위주이며 실행 증거를 저장하지 않는다. | §9 보조 항목으로만 사용 |
| brand Markdown→JSON→CSS | Loop D-6은 Rust/TS 공유 필요 전까지 W3C JSON을 연기했다. 현 범위는 presentation TS 상수가 더 단순하다. | 지금은 도입하지 않음 |
| page 생성 문서의 암묵적 override | Loop는 decision/integration node 직렬화와 승인 후 착수를 요구한다. | 그대로는 이식 불가 |

## 6. D-1~D-6에 주는 시사점

- **D-1 토큰 이름:** `styles.csv`의 stable ID/alias와 brand 토큰의 점 경로 참조는 Loop의 `status.<state>.glyph`, `color.role.<role>` 제안을 지지한다. 별칭은 외부 입력 호환에만 두고 canonical 이름은 하나여야 한다.
- **D-2 herdr 라벨 소유권:** page override 관행은 국소 소유를 허용하지만, 잘못된 경로 문구 사례가 보여주듯 분산 문서는 쉽게 drift한다. 현행 “herdr 유지 + `design.md` 규격화” 뒤 기계 검증을 두는 쪽이 안전하다.
- **D-3 글리프:** DB의 anti-pattern/priority 분류 방식은 역할을 먼저 이름 붙이고 값을 매핑하는 접근을 뒷받침한다. 현재 값 보존의 3역할 분리가 타당하다.
- **D-4 색 1차 범위:** 생성기의 16개 웹 시맨틱 색은 Loop의 텍스트 CLI에는 과하다. status 중심 폐쇄 집합과 환경 가드부터 시작한다는 최소안이 더 적합하다.
- **D-5 터미널 폭:** 이 저장소는 반응형 웹 breakpoints만 제공하고 grapheme/터미널 폭 정책 근거는 주지 않는다. 결정 연기를 변경할 근거가 없다.
- **D-6 W3C JSON:** brand pipeline은 다중 산출물(JSON/CSS)에서 JSON 원천이 유용함을 보이지만, 동시에 generator·validator·sync 충돌 비용도 보여준다. Rust/TS 공유라는 기존 트리거를 유지해야 한다.

## 결론

### Loop에 이식 가치가 있는 요소 상위 3개

1. **“기존 결정 먼저 읽기 + 기본 no-overwrite + 명시적 강제 갱신” 규칙**  
   `design.md`가 accepted이면 생성/수정 도구가 먼저 상태와 기존 ADR을 읽고, 별도 승인 없이는 덮어쓰지 않도록 하는 규칙이다. 동료·에이전트 결정을 조용히 소실하지 않으며 Loop의 승인 게이트와 직접 정합한다.

2. **전역 원칙과 표면별 편차의 계층적 재소비**  
   `MASTER + pages`를 그대로 복제하지 말고, `design.md`를 전역 source of truth로 유지하면서 표면별 annex/ADR이 “편차와 근거만” 기록하고 상호 링크하게 한다. 후속 designer가 전역 문서→해당 표면 문서 순으로 읽도록 페르소나에 명시할 가치가 있다. override가 EARS를 바꾸면 반드시 decision task/승인 게이트를 거쳐야 한다.

3. **검색 결과의 canonical ID·출처·기권 계약**  
   외부 사례나 디자인 패턴을 추천할 때 stable identity와 원문 출처를 남기고, 부정확하면 한 번 좁혀 재검색한 뒤 “근거 없음”으로 기권한다. 거대한 CSV 엔진 없이도 조사 문서 템플릿에 `source`, `applicability`, `confidence/fallback`을 넣어 채택할 수 있고, Loop §4 근거와 §7 역추적 품질을 높인다.

### 이식 불가 또는 현재 불필요한 요소

- **192 제품 profile·79 스타일 검색 DB 전체:** Loop는 범용 웹 디자인 생성기가 아니며 현재 표면은 CLI/TUI로 좁다. 데이터 유지·검색 calibration 비용이 현재 문제보다 크다.
- **생성 추천을 곧바로 디자인 명세로 영속화:** top-1 분류와 휴리스틱 추천에는 현행 감사, EARS, 대안, 계층 영향, 승인 상태가 없다. Loop의 `design.md`를 대체할 수 없다.
- **page override의 무승인 우선권:** 전역 요구사항과 충돌할 때 조용히 덮어쓰므로 Loop의 승인·역추적 계약과 양립하지 않는다.
- **즉시 W3C JSON/CSS token pipeline 도입:** 좋은 다중 소비자 패턴이지만 현재 Loop에는 CSS 소비자와 Rust/TS 공유 요구가 없다. D-6의 기존 트리거 전에는 TS 상수+무결성 테스트가 더 단순하다.
- **고정 웹 컴포넌트 CSS와 1–10 taste dial:** button/card/modal·GSAP·breakpoint 기본값은 터미널 제품에 맞지 않고, 수치 dial은 승인 가능한 요구사항보다 취향을 불투명하게 압축한다.

종합하면 `ui-ux-pro-max`에서 가져올 핵심은 스타일 카탈로그 자체가 아니라 **결정을 재소비하는 문서 계층, 기존 결정을 보존하는 쓰기 정책, 검색 결과의 출처/기권 규율**이다. Loop의 9절/EARS/승인 게이트는 유지해야 하며, 추천 엔진은 있다면 승인 전 후보 생성기로만 위치시켜야 한다.

## 조사 원문 목록

직접 읽은 22개 파일은 다음 범주다.

- 루트: [`README.md`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/README.md)
- ui-ux-pro-max: `SKILL.md`, `references/pro-rules.md`, `scripts/{search,core,design_system,reasoning_contract}.py`, `data/{ui-reasoning,styles,products,colors,typography,landing,ux-guidelines}.csv` — 위 본문 링크
- brand: `SKILL.md`, `references/update.md`, `templates/brand-guidelines-starter.md`, `scripts/{sync-brand-to-tokens,inject-brand-context}.cjs` — 위 본문 링크와 [`update.md`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/brand/references/update.md)
- design-system: [`SKILL.md`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/design-system/SKILL.md), [`generate-tokens.cjs`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/design-system/scripts/generate-tokens.cjs), [`design-tokens-starter.json`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/design-system/templates/design-tokens-starter.json)

API 근거: [repository metadata](https://api.github.com/repos/nextlevelbuilder/ui-ux-pro-max-skill), [recursive tree at 조사 커밋](https://api.github.com/repos/nextlevelbuilder/ui-ux-pro-max-skill/git/trees/dcc40ff5133ef78276117db0cc34e7b83cc8aeba?recursive=1). 모든 수량은 README 배지만 복사하지 않고 해당 CSV를 직접 파싱해 확인했다.
