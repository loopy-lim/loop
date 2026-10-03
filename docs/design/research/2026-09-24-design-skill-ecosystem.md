# 에이전트 디자인 스킬·DESIGN.md 문서 관행 생태계 조사

- **일자:** 2026-09-24 KST
- **태스크:** `survey-design-skill-ecosystem` (research, attempt 0)
- **조사 사례:** 6개 계열 — UI UX Pro Max, Anthropic `frontend-design`, Anthropic 아티팩트·브랜드 스킬, Vercel Web Interface Guidelines, Impeccable, Google `DESIGN.md`
- **비교 대상:** `docs/design/design.md`, `docs/design/research/design-md-practices.md`
- **코드 변경:** 없음

## 0. 요약

에이전트 디자인 생태계는 디자인 지식을 한 종류의 문서에 모두 넣지 않는다. 대체로 **(1) 실행 시 불러오는 짧은 스킬 지침, (2) 검색·재사용 가능한 규칙/토큰 데이터, (3) 프로젝트에 남는 시각적 결정 문서, (4) 산출물 또는 코드를 검사하는 체크**의 조합이다. UI UX Pro Max는 이 네 층 중 검색 데이터·생성 문서·체크리스트를, Impeccable과 Google `DESIGN.md`는 프로젝트 문서·기계 검증을 가장 강하게 구현한다.

Loop에는 이 구조를 그대로 복제하기보다 다음만 선택적으로 채택할 가치가 있다.

1. `docs/design/design.md`는 계속 **요구사항·아키텍처·태스크 추적 문서**로 둔다. 시각 토큰을 그 안의 두 번째 원천으로 만들지 않는다.
2. designer 페르소나는 긴 디자인 백과사전이 아니라 **소비 시점과 검색/검증 절차를 라우팅하는 얇은 스킬**이어야 한다.
3. 현재 규모에서는 presentation의 타입 있는 어휘·색 역할과 테스트가 규범 값의 원천이다. 별도 루트 `DESIGN.md`, 대형 CSV 스타일 DB, W3C/Google 토큰 문서는 소비자가 생길 때까지 도입하지 않는다.

## 1. 조사 방법과 증거 경계

### 1.1 수집

- GitHub REST API의 저장소, 재귀 tree, 최신 commit, repository search 응답으로 저장소 실재·구조·인기도를 확인했다. 예: [UI UX Pro Max 저장소 검색](https://api.github.com/search/repositories?q=%22ui-ux-pro-max-skill%22&sort=stars&order=desc), [DESIGN.md 저장소 검색](https://api.github.com/search/repositories?q=%22design.md%22%20visual%20identity%20agents&sort=stars&order=desc).
- 아래 본문 인용은 가능한 한 조사 시점 commit SHA에 고정한 GitHub 원문 링크다. `raw.githubusercontent.com` 원문도 직접 내려받아 줄 단위로 대조했다.
- [skills.sh 전체 순위](https://skills.sh/)에서 조사 시점에 `frontend-design` 7위, `web-design-guidelines` 42위, `ui-ux-pro-max` 156위로 표시되는 것을 확인했다. 순위·설치 수는 변하는 **발견성 신호**일 뿐 품질 증거로 사용하지 않았다.
- GitHub star 역시 2026-09-24 API 스냅샷이다: UI UX Pro Max 약 13.0만, `anthropics/skills` 약 17.8만, Impeccable 약 7.1만, Vercel `agent-skills` 약 3.2만, Google `design.md` 약 2.8만. 인기와 설계 적합성은 분리해 판단했다.

### 1.2 기존 조사와의 차이

`design-md-practices.md`는 Kiro·Spec Kit·Rust RFC·Google 설계 문서의 **요구사항→설계→태스크 승인 워크플로**를 조사했다. 본 문서는 그 내용을 반복하지 않고 다음 신규 축만 다룬다.

- 에이전트가 디자인 지식을 어떻게 패키징하고 필요할 때 불러오는가.
- 검색형 디자인 데이터와 reasoning rule이 어떤 방식으로 추천을 만드는가.
- 빌드 전 계획, 구현 중 소비, 배포 전 리뷰가 어떻게 분리되는가.
- 시각 정체성용 루트 `DESIGN.md`가 기술 설계용 `docs/design/design.md`와 어떻게 다른가.

따라서 기존 문서의 “문서 먼저·승인 게이트·역추적 ID”는 본 조사에서 전제로만 사용한다.

### 1.3 제한

선언된 read scope 때문에 `config/personas/designer.md` 원문은 직접 읽지 않았다. 아래 “designer 페르소나” 비교는 현재 `design.md`가 요구하는 역할 경계와 태스크 intent에 대한 **적용 권고**이며, 현 페르소나 문구의 충족 여부 판정은 아니다. 후속 통합 단계에서 해당 파일을 read scope에 넣어 문구별 대조가 필요하다.

## 2. 사례 1 — nextlevelbuilder/ui-ux-pro-max-skill

### 2.1 저장 형태: 스킬 + 검색 DB + 제한된 규칙 문법 + 생성 문서

이 사례는 단순 프롬프트 모음이 아니다.

- `SKILL.md`는 적용 조건, 검색 순서, 실패 처리, persistence 정책을 담는 실행 지침이다. 새 페이지·프로젝트에는 `--design-system`을 요구하고, 검색 결과가 맞지 않으면 한 번 좁혀 재검색한 뒤 검증되지 않은 결과를 저장하지 말라고 한다([SKILL.md 47–81](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/SKILL.md#L47-L81)).
- 지식 본체는 `styles.csv`, `colors.csv`, `typography.csv`, `ux-guidelines.csv`, stack별 CSV, `ui-reasoning.csv` 등 로컬 데이터다. 생성기는 제품→스타일·색·랜딩 패턴·타이포그래피를 다중 검색하고 reasoning rule로 우선순위와 anti-pattern을 조합한다([README 131–163](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/README.md#L131-L163), [design_system.py 451–578](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/design_system.py#L451-L578)).
- reasoning rule은 임의 코드가 아니라 허용 condition/action과 토큰 문법만 받는 “closed, non-executable grammar”다. 알 수 없는 condition/action, 빈 배열, 중복 action을 거부하고 활성화된 규칙 audit trail을 반환한다([reasoning_contract.py 1–123](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/reasoning_contract.py#L1-L123)).
- 선택적으로 `design-system/<project>/MASTER.md`와 `pages/<page>.md`를 생성한다. page 문서에는 master와 다른 값만 두고 page가 master를 override한다([README 434–466](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/README.md#L434-L466)). 즉 저장소 루트 `DESIGN.md`가 아니라 **프로젝트별 master + 국소 override** 관행이다.
- 별도 `brand` 스킬은 `docs/brand-guidelines.md`를 source of truth로 두고 JSON/CSS token으로 동기화하며, context injection과 asset validation 스크립트를 제공한다([brand/SKILL.md 25–66](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/brand/SKILL.md#L25-L66)).

### 2.2 소비 시점

- **빌드 전:** 요청에서 제품·대상·스타일·stack을 추출하고, 신규 surface면 design-system 검색/생성을 먼저 수행한다.
- **구현 중:** master를 먼저 읽고 해당 page override를 덮어쓴다([SKILL.md 88–109](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/SKILL.md#L88-L109)).
- **리뷰 전:** 모바일/네이티브 UI는 `pro-rules.md`의 canonical pre-delivery checklist를 읽는다([SKILL.md 212–214](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/SKILL.md#L212-L214)).

### 2.3 일관성 강제

- 생성 `MASTER.md` 자체에 아이콘, 포인터, hover, 4.5:1 contrast, focus, reduced motion, 4개 viewport 체크리스트가 들어간다([design_system.py 904–913](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/design_system.py#L904-L913)).
- 기존 master는 기본적으로 덮어쓰지 않는다. 임시 파일 작성 후 원자적으로 publish하고, 동시 에이전트가 같은 파일을 만들면 기존 결정을 보존한다. `--force`는 명시 승인을 전제한다([design_system.py 972–1073](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/design_system.py#L972-L1073)).
- 데이터 계약·검색·색 모드·stack freshness 테스트가 있다. 다만 checklist의 모든 항목이 실제 UI를 자동 검사하는 것은 아니다. **규칙 데이터의 무결성**과 **최종 산출물의 준수**를 혼동하면 안 된다.

### 2.4 Loop 판단

**부분 채택.** 검색의 “한 dominant intent→결과 검증→1회 좁혀 재검색→검증 실패 시 fallback 표시” 계약은 designer 페르소나에 유용하다. master/page override와 덮어쓰기 방지도 장기 프로젝트에는 좋은 패턴이다. 그러나 Loop의 현재 표면은 터미널 중심이고 표현 어휘 문제가 이미 13개 요구사항으로 좁혀져 있다. 79개 스타일·제품별 palette DB와 페이지 override 트리는 과잉이며, 일반 웹 취향 데이터를 들이면 domain과 presentation 경계를 흐린다.

## 3. 사례 2 — anthropics/skills `frontend-design`

### 3.1 저장 형태

단일 `SKILL.md`에 미학 원칙, AI 생성물의 상투적 패턴, 빌드 전 두 단계 절차를 넣는다. 외부 스타일 DB나 장기 프로젝트 문서는 없다. 핵심 산출물은 brief에 근거한 소형 token plan(색 4–6개, 타입, 레이아웃, 원칙)이다([frontend-design/SKILL.md 36–53](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/frontend-design/SKILL.md#L36-L53)).

### 3.2 소비 시점

- **빌드 전:** 먼저 디자인 계획을 만들고, 유사 prompt에도 나올 법한 generic default인지 brief와 대조해 수정한 뒤에만 코드를 쓴다.
- **구현 중/후:** 모바일 반응형, keyboard focus, reduced motion, 접근 가능한 색을 quality floor로 두고 가능하면 screenshot으로 자기 비평한다([동 파일 57–59](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/frontend-design/SKILL.md#L57-L59)).

### 3.3 일관성 강제

강제 수단은 계획→brief review→build→critique라는 순서와 금지/회피 목록뿐이다. token 파일, lint, 테스트는 없다. 따라서 **방향성 생성에는 강하지만 반복 세션의 값 일관성에는 약하다.** Anthropic 저장소도 이 스킬들을 교육·시연용이며 중요한 작업에서는 직접 시험하라고 명시한다([README 6–27](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/README.md#L6-L27)).

### 3.4 Loop 판단

**절차만 채택.** “계획을 brief와 대조한 뒤 구현”은 `design.md` 승인 게이트와 맞는다. 반면 “distinctive aesthetic”는 운영 TUI의 핵심 기준이 아니다. Loop designer는 개성보다 상태 판독성·바이트 안정성·비-TTY 안전을 우선해야 한다. 이 스킬의 screenshot 자기 비평도 Loop에는 ANSI 제거 문자열 계약과 환경 가드 테스트로 치환해야 한다.

## 4. 사례 3 — anthropics/skills의 브랜드·아티팩트 계열

### 4.1 저장 형태

이 계열은 범용 UI 규칙 대신 **산출물 종류별 작은 지식 묶음**을 둔다.

- `brand-guidelines`는 Anthropic의 정확한 색과 heading/body font를 한 스킬 문서에 직접 고정한다([brand-guidelines/SKILL.md 15–36](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/brand-guidelines/SKILL.md#L15-L36)).
- `theme-factory`는 10개 theme 파일과 showcase PDF를 제공하고, 사용자에게 시각적으로 보여준 뒤 명시 선택을 기다리고 적용한다([theme-factory/SKILL.md 8–26](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/theme-factory/SKILL.md#L8-L26)).
- `canvas-design`은 먼저 4–6문단 design philosophy `.md`를 만든 뒤 같은 철학을 PDF/PNG로 표현한다([canvas-design/SKILL.md 7–31](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/canvas-design/SKILL.md#L7-L31)).

### 4.2 소비 시점

brand 지침은 해당 회사 look-and-feel이 필요한 산출물에 즉시 적용한다. theme는 **적용 전 인간 선택**을 거친다. canvas의 철학 문서는 아티팩트 생성 전에 만들어 같은 실행의 시각 방향 입력으로 소비한다.

### 4.3 일관성 강제

정확한 RGB/font 값, theme별 파일, 승인 대기가 일관성 수단이다. 그러나 코드 lint나 프로젝트 전역 drift 검사는 없다. `canvas-design`의 반복적인 “masterpiece” 품질 문구는 판단 프레임이지 검증 가능한 completion contract가 아니다.

### 4.4 Loop 판단

**역할 분리는 채택, 내장 브랜드 값은 비채택.** 고정 palette를 persona 본문에 박는 방식은 Loop의 “값은 presentation 상수, 이유는 문서” 원칙과 충돌한다. 다만 “선택 가능한 방향은 적용 전에 승인”하는 theme-factory 패턴은 D-1·D-3·D-4 같은 material decision을 decision 노드에서 직렬화하는 근거가 된다.

## 5. 사례 4 — Vercel Web Interface Guidelines

### 5.1 저장 형태

`agent-skills`의 `web-design-guidelines`는 실제 규칙을 복사하지 않고, 매 리뷰마다 별도 공식 저장소의 최신 `command.md`를 fetch하라는 **얇은 라우터 스킬**이다([SKILL.md 10–37](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines/SKILL.md#L10-L37)). 규칙 원문은 접근성, focus, form, motion, typography, overflow, 성능, URL state, touch, dark mode, i18n 등을 체크리스트로 저장한다([command.md 12–167](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md#L12-L167)).

### 5.2 소비 시점

명시적으로 **리뷰 시점**에만 작동한다. 사용자가 준 파일/pattern을 읽고 모든 최신 규칙을 적용한다. 입력 파일이 없으면 먼저 범위를 묻는다.

### 5.3 일관성 강제

모든 규칙 점검과 `file:line` 출력 형식을 요구하며 pass도 표시한다([command.md 168–190](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md#L168-L190)). 그러나 기본 구현은 정적 분석기가 아니라 agent checklist다. 최신 원격 원문 fetch는 freshness에는 유리하지만 재현성·오프라인성·공급망 안정성에는 불리하다.

### 5.4 Loop 판단

**형태만 채택.** persona는 규칙을 중복하지 않고 저장소 내 canonical 문서와 테스트를 가리키는 라우터여야 한다. 반대로 매 실행 원격 fetch는 Loop milestone 검증의 결정성을 해치므로 비채택한다. Loop의 규칙 버전은 저장소 commit에 고정하고 `bun run test:architecture`·단위 테스트로 집행해야 한다.

## 6. 사례 5 — pbakaus/impeccable

### 6.1 저장 형태: skill router + 루트 DESIGN.md + machine sidecar

Impeccable은 조사 대상 중 `DESIGN.md`를 agent context로 가장 적극적으로 운용한다.

- 세션 시작 launcher가 `PRODUCT.md`, `DESIGN.md`, surface brief를 읽는다([SKILL.md 15–21](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/SKILL.md#L15-L21)).
- `document` 명령은 프로젝트 루트 `DESIGN.md`를 만든다. machine-readable token frontmatter가 규범이고 prose는 적용 맥락이며, canonical 8개 section 순서를 따른다([document.md 1–62](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/reference/document.md#L1-L62)).
- 신규 visual world는 구현 **전**에 direction contract를 surface brief에 적지만, 루트 `DESIGN.md`는 구현이 끝난 뒤 실제 만들어진 world에서 추출한다. “미리 쓴 rulebook을 현실에 방어”하지 않기 위한 의도적 분리다([new-work.md 71–83](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/reference/new-work.md#L71-L83)).
- 기존 시스템이 있으면 코드·token·component·rendered output부터 scan한다. `DESIGN.md`가 없다는 사실만으로 greenfield로 판단하지 않는다([SKILL.md 23–27](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/SKILL.md#L23-L27), [document.md 80–114](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/reference/document.md#L80-L114)).

### 6.2 소비 시점

- **빌드 전:** 기존 DESIGN/코드/토큰을 읽고 surface direction contract를 확정한다.
- **구현 중:** 선택한 direction과 token/component vocabulary를 따른다.
- **finish review 후:** fresh reviewer의 판정이 끝난 다음 documenter가 새 world 또는 승인된 시스템 변경을 `DESIGN.md`와 `.impeccable/design.json`에 반영한다([new-work.md 131–145](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/reference/new-work.md#L131-L145)).

### 6.3 일관성 강제

- 기존 `DESIGN.md`를 조용히 덮어쓰지 않고 refresh/overwrite/merge를 사용자에게 묻는다([document.md 64–78](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/reference/document.md#L64-L78)).
- audit은 접근성·성능·theming·responsive·implementation integrity를 0–4로 채점하고 P0–P3, file/line, 영향, 권고를 기록한다([audit.md 7–103](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/reference/audit.md#L7-L103)).
- detector hook, screenshot, viewport capture, 별도 finish reviewer, bounded fix pass가 있다. 저장소 자체도 anti-pattern rule 변경에 fixture-first와 Rust/Bun oracle 검증을 요구한다([AGENTS.md 45–65](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/AGENTS.md#L45-L65)).

### 6.4 Loop 판단

**핵심 구분은 채택, 도구 체인은 비채택.** “계획 문서(direction contract)와 구현에서 추출한 시각 truth(DESIGN.md)는 다른 수명주기”라는 발견은 중요하다. Loop의 `docs/design/design.md`는 전자이고, presentation 상수·테스트는 후자의 규범 값 역할을 이미 한다. 루트 `DESIGN.md`까지 만들면 현재는 세 번째 출처가 된다. 이미지 comp, screenshot diff, 별도 reviewer chain은 CLI 규모에 비해 과도하다.

## 7. 사례 6 — google-labs-code/design.md

### 7.1 저장 형태

Google의 공개 포맷은 루트 `DESIGN.md`를 “coding agents를 위한 visual identity”로 정의한다. YAML frontmatter의 token이 규범 값이고 Markdown prose가 이유·적용 맥락이다([README 1–7, 99–110](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md#L1-L7), [동 파일 99–110](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md#L99-L110)). 명세는 색·타이포그래피·spacing·rounded·component token과 고정 section 순서를 정의하되 알 수 없는 이름을 허용하는 확장 정책을 둔다([spec.md 4–17, 98–115](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/docs/spec.md#L4-L17), [동 파일 98–115](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/docs/spec.md#L98-L115)).

### 7.2 소비 시점

에이전트가 새 UI를 생성하거나 기존 UI를 확장할 때 persistent context로 읽는다. CLI의 `spec` 명령은 명세와 lint rule을 agent prompt에 주입할 수 있다([README 304–315](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md#L304-L315)).

### 7.3 일관성 강제

`lint`는 깨진 token ref, missing primary/typography, orphan token, section order, unknown key 등을 구조화된 finding으로 내고 contrast도 검사한다. `diff`는 token/prose regression을 비교하고, `export`는 Tailwind와 DTCG로 변환한다([README 54–89, 318–356](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md#L54-L89), [동 파일 318–356](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md#L318-L356)). 다만 포맷은 명시적으로 **alpha**다([README 360](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md#L360)).

### 7.4 Loop 판단

**현 시점 비채택, D-6의 유력 재검토 후보.** 사람이 읽는 rationale와 machine token을 한 파일에 두는 깊은 인터페이스는 매력적이지만, Loop는 현재 TypeScript presentation만 token 소비자이고 타입·무결성 테스트를 이미 설계했다. alpha schema와 추가 CLI를 지금 들이면 D-6에서 연기한 변환 체인 비용이 즉시 발생한다. Rust/TS 또는 CLI/pi가 같은 token을 실제 공유하게 될 때 Google 포맷과 W3C DTCG 중 하나를 비교 결정한다.

## 8. 사례 비교

| 사례 | (a) 지식 저장 형태 | (b) 소비 시점 | (c) 일관성 강제 수단 |
| --- | --- | --- | --- |
| UI UX Pro Max | `SKILL.md` + CSV DB + closed reasoning JSON + `MASTER.md`/page override + brand 문서 | 신규 build 전 검색, page build 시 master/override, delivery 전 | 데이터/규칙 테스트, canonical checklist, 원자적 no-overwrite |
| Anthropic frontend | 단일 지침 + 실행 중 compact token plan | plan→brief review→build→screenshot critique | 순서·anti-default checklist; 자동 검사 없음 |
| Anthropic artifact/brand | 고정 RGB/font 지침, theme 파일/PDF, 실행별 philosophy `.md` | 적용 전 선택/승인, artifact 생성 전 | 정확한 값, 사용자 승인; drift 검사 없음 |
| Vercel WIG | 얇은 skill + 원격 최신 checklist | 코드 리뷰 시 | 모든 rule 점검 + `file:line`; agent 판정 중심 |
| Impeccable | router skill + PRODUCT/DESIGN/surface brief + sidecar | 기존 context 선읽기, finish review 뒤 문서화 | detector, audit score, screenshot/reviewer, overwrite 승인 |
| Google DESIGN.md | 루트 Markdown + 규범 YAML token | UI 생성/확장 전 persistent context | lint, contrast, diff, export, 구조화 JSON finding |

## 9. Loop 워크플로·페르소나·D-1~D-6 대조

### 9.1 `docs/design/design.md`와의 관계

생태계에는 이름이 비슷하지만 목적이 다른 문서가 둘 있다.

- Loop `docs/design/design.md`: EARS 요구사항, 계층·데이터 흐름, 대안, 태스크 역추적, 검증 계획을 담는 **변경 설계/승인 문서**.
- Impeccable/Google 루트 `DESIGN.md`: palette·typography·shape·component token을 담는 **현재 시각 정체성 문서**.

둘을 합치면 설계 제안과 현재 규범 값의 수명주기가 섞인다. Loop가 루트 `DESIGN.md`를 도입하더라도 `docs/design/design.md`를 대체해서는 안 된다. 지금은 R13의 링크 허브 + presentation 상수/테스트 조합이 더 단순하다.

기존 조사와 비교하면 신규 발견은 “문서 먼저”가 아니라 **언제 어떤 디자인 문서를 읽고, 구현 뒤 무엇을 다시 추출하는가**다. 특히 Impeccable은 구현 전 surface contract와 구현 후 global DESIGN 문서를 명시적으로 분리한다.

### 9.2 designer 페르소나에 권고할 인터페이스

원문 대조는 후속 scope가 필요하지만, 생태계 근거상 페르소나가 맡을 책임은 다음처럼 제한하는 편이 좋다.

1. **라우팅:** 신규 방향 결정, 국소 구현, 리뷰 중 어느 작업인지 판정한다.
2. **검색 계약:** 저장소 내 canonical 근거를 먼저 읽고, 외부 검색은 질문 하나씩 수행하며 출처·적합성을 확인한다. 검증 실패 결과를 규범으로 저장하지 않는다.
3. **결정 입력:** palette나 glyph 값을 persona에 박지 않고 D-1/D-3/D-4 decision에 대안과 근거를 제공한다.
4. **리뷰 출력:** material finding만 file/line 또는 requirement ID에 연결한다. 취향과 기계적 위반을 분리한다.
5. **완료 판정 금지:** checklist 수행이나 worker 성공을 verification으로 간주하지 않고 `design.md` §9 명령 결과를 요구한다.

대안은 (A) persona에 모든 디자인 규칙을 내장하거나 (B) persona를 얇은 라우터로 두는 것이다. **B를 권고**한다. A는 UI UX Pro Max 같은 대형 검색 DB가 지속적으로 관리될 때만 작동하며 Loop에는 현재 그 운영 주체와 소비 표면이 없다.

### 9.3 보류 결정별 권고

| 결정 | 생태계 신호 | Loop 권고 |
| --- | --- | --- |
| **D-1 이름 규칙** | UI UX Pro Max는 stable style ID·제한된 action token을 쓰고, Google은 경로 참조를 쓰되 token name은 열린 집합으로 둔다. | **부분 채택.** `status.<state>.glyph`, `color.role.<role>` 같은 안정 path와 폐쇄 role은 적절하다. 이름을 persona/문서와 코드에 중복 선언하지 말고 ADR→presentation 상수로 확정한다. |
| **D-2 herdr 라벨 소유권** | 조사 사례의 master/page override는 동일 렌더 계층 안의 상속 문제다. adapter 고유 32자 라벨의 계층 이동 근거는 제공하지 않는다. | **현행 연기 유지.** 먼저 규격만 문서화한다. presentation 이관은 실제 두 번째 소비자가 생길 때 재질의한다. |
| **D-3 glyph 3역할** | Anthropic/Vercel은 의미 있는 구조와 상태 피드백을, Google은 semantic component variant를 강조한다. 특정 glyph 자체의 업계 합의는 없다. | **역할 분리는 채택, 값은 현행 유지.** success/warning/neutral 의미와 테스트가 핵심이며 `✓/!/-`는 Loop 로컬 결정이다. |
| **D-4 색 1차 범위** | 모든 구현형 사례가 semantic color·contrast·focus를 quality floor로 둔다. 대형 theme 엔진 없이도 역할 기반 적용이 공통이다. | **제안대로 최소 채택.** task 상태색 + 환경 가드부터 시작하고, closed `ColorRole`과 contrast/ANSI 테스트로 강제한다. |
| **D-5 terminal width** | 웹 생태계는 375/768/1024/1440 viewport, overflow, responsive capture를 검사하지만 terminal grapheme budget·pipe 출력에는 직접 적용되지 않는다. | **유추 도입 금지, 연기 유지.** 체감 문제와 터미널 폭 관찰 증거가 생긴 뒤 별도 정책으로 결정한다. |
| **D-6 W3C JSON 승격** | Google DESIGN.md는 DTCG export를 제공하지만 alpha이며, UI UX Pro Max도 Markdown persistence와 내부 dict/CSV를 병행한다. 포맷 통일보다 실제 consumer가 먼저다. | **연기 유지.** Rust/TS 또는 CLI/pi 공유가 생기면 Google DESIGN.md vs DTCG JSON vs bridge 생성 타입의 3안을 비교한다. |

## 결론

### 생태계 공통 패턴 3개

1. **지식과 실행 지침을 분리한다.** `SKILL.md`는 언제 무엇을 읽을지 라우팅하고, 값과 규칙은 CSV/theme/token/프로젝트 문서에 둔다. 인기 스킬도 긴 persona 하나로 모든 지식을 운반하지 않는다.
2. **소비 시점을 분리한다.** 빌드 전에는 brief·방향·compact token plan을, 구현 중에는 master/token을, 리뷰 시에는 접근성·반응형·drift checklist를 쓴다. 한 번의 “디자인 검토”로 합치지 않는다.
3. **문서만으로 강제하지 않는다.** 성숙한 사례는 closed grammar, no-overwrite, lint/diff, detector, test 또는 구조화 finding을 붙인다. checklist만 있는 사례는 방향 제시에는 유효하지만 완료 증거로는 약하다.

### Loop 적용 시 주의점

- **이름 충돌:** 기술 변경 설계인 `docs/design/design.md`와 시각 정체성 포맷인 루트 `DESIGN.md`를 같은 개념으로 취급하지 않는다.
- **단일 원천:** 표현 값은 presentation의 타입 있는 상수에, 결정 이유와 범위는 design/ADR에 둔다. 생성 Markdown token을 추가해 두 번째 값 원천을 만들지 않는다.
- **결정성:** 외부 latest rule fetch, 유료 모델 review, screenshot 도구를 milestone completion에 넣지 않는다. 원격 조사는 결정 입력일 뿐이며 검증은 저장소에 고정된 테스트로 끝나야 한다.
- **표면 적합성:** 웹의 theme·responsive 관행을 터미널에 문자 그대로 이식하지 않는다. Loop에서는 비-TTY, `NO_COLOR`, grapheme/line budget, 바이트 보존이 대응 quality floor다.
- **확장 조건:** root `DESIGN.md`/DTCG는 두 개 이상의 실제 runtime consumer가 생길 때, 검색 DB는 반복되는 디자인 질문과 관리 주체가 생길 때만 도입한다.
- **페르소나 검증:** `config/personas/designer.md` 원문 대조는 이번 read scope 밖이었다. 후속 통합은 위 5개 책임이 이미 있는지 확인하고, 값·규칙 복제보다 링크/라우팅을 보강해야 한다.

**최종 권고:** Loop는 UI UX Pro Max의 검색 계약, Vercel의 얇은 리뷰 라우터, Impeccable의 계획/현재-truth 수명주기 분리, Google의 machine-checkable token 사상을 **원칙 수준에서만** 채택한다. 현재 구현안인 `docs/design/design.md` 승인 게이트 + presentation 상수 + 경계/무결성/계약 테스트가 가장 단순한 조합이다. 별도 디자인 스킬 DB나 루트 `DESIGN.md`는 지금 만들지 않는다.

## 부록 A — 1차 자료

| 계열 | 고정 원문 |
| --- | --- |
| UI UX Pro Max | [README](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/README.md), [UI/UX SKILL](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/SKILL.md), [generator](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/design_system.py), [reasoning contract](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/ui-ux-pro-max/scripts/reasoning_contract.py), [brand skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/dcc40ff5133ef78276117db0cc34e7b83cc8aeba/.claude/skills/brand/SKILL.md) |
| Anthropic | [frontend-design](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/frontend-design/SKILL.md), [brand-guidelines](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/brand-guidelines/SKILL.md), [theme-factory](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/theme-factory/SKILL.md), [canvas-design](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/canvas-design/SKILL.md) |
| Vercel | [router skill](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines/SKILL.md), [guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/e3d624baaf29dc1fc645aff3e38f03e564d2d6b1/command.md) |
| Impeccable | [SKILL](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/SKILL.md), [new-work](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/reference/new-work.md), [document](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/reference/document.md), [audit](https://github.com/pbakaus/impeccable/blob/e0881d2de397d5e9761d7b35ff5017d8f5ebf69b/.agents/skills/impeccable/reference/audit.md) |
| Google DESIGN.md | [README](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/README.md), [format spec](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/docs/spec.md), [linter source](https://github.com/google-labs-code/design.md/tree/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/packages/cli/src/linter) |
| Marketplace snapshot | [skills.sh](https://skills.sh/) |

## 부록 B — 검증 범위

이 문서는 조사 산출물만 추가한다. Rust·TypeScript·protocol·codegen은 변경하지 않았다. 완료 확인은 파일 존재, `## 결론`, 외부 URL 포함 여부로 한정한다.
