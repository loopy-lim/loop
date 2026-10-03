---
version: alpha
name: Loop UI/UX 실무 조언 가이드 (corpus 증류)
status: non-canonical practice guide
lifecycle: 조언이 규칙이 되려면 design-language.md 제안 lane으로 접수
---

# UI/UX 주제별 실무 조언 — awesome-design-md corpus 증류

> **상태:** `non-canonical 실무 가이드`다. 이 문서는 규칙·토큰·정본이 아니라, 반입된 외부 corpus 전체([`docs/design/references/awesome-design-md/`](references/awesome-design-md/), MIT snapshot commit `f6961238d5cddcf8042a74a70fc400ec67181abb`, 문서 74건)에서 **브랜드·출처 구분이 아니라 UI/UX 디자인 주제별**로 실무 조언을 증류한 것이다. 조언을 규칙으로 쓰려면 [`design-language.md`](design-language.md)의 **제안 lane에 DP(`DP-YYYYMMDD-N`)로 접수**하고 승인 게이트(검토·분류 → 변경 설계 승인 → integration 반영)를 거쳐야 한다. canonical 본문인 [`design-language.md`](design-language.md)·[`design.md`](design.md)·ADR·references 원문은 이 가이드가 수정하지 않는다.
>
> **사용법:** 화면·출력을 새로 만들거나 고칠 때 각 주제 절의 (c) Loop 실천 항목을 점검한다. 절의 기법 중 채택 기록은 corpus 근거, 기각 기록은 Loop(CLI/TUI, 텍스트 중심) 비적용 사유를 함께 적었다. 절의 어떤 조언도 현재 승인된 Loop 규칙이 아니며, 기존 제안(`DP-20260925-1`~`11`)과 겹치는 조언은 해당 DP가 소유한다.

**목차**

1. [상태 표현 — 로딩·성공·실패·대기](#1-상태-표현--로딩성공실패대기)
2. [정보 위계와 스캔성](#2-정보-위계와-스캔성)
3. [밀도와 여백](#3-밀도와-여백)
4. [강조(색·bold) 사용 예산](#4-강조색bold-사용-예산)
5. [색 역할과 접근성](#5-색-역할과-접근성)
6. [글리프·아이콘 어휘](#6-글리프아이콘-어휘)
7. [빈 상태와 오류 문구](#7-빈-상태와-오류-문구)
8. [일관성 강제 방법](#8-일관성-강제-방법)
9. [빠른 체크리스트](#9-빠른-체크리스트)

---

## 1. 상태 표현 — 로딩·성공·실패·대기

**(a) 원칙.** 상태는 소수의 폐쇄된 어휘(색·글리프·단어)로만 표현하고, 상태가 없는 표면에는 상태를 발명하지 않는다. 상태 신호의 강도는 상태의 심각도에 비례해 **드물게** 쓴다 — 흔한 상태일수록 조용해야 한다.

**(b) corpus 기법.**

채택:

1. **상태색을 소수로 폐쇄하고, 상태 어휘를 1급으로.** 74건 중 63건이 success/error/warning 의미색 절을 두며, 대부분 3~4종으로 폐쇄한다. Linear는 라벤더 accent와 별도로 semantic-success 한 종만 "status pills, success indicators"에 쓴다(출처: `linear.app.md`). Cursor는 agent 동작 단계색(AI timeline)을 일반 semantic(success/error)과 별도 namespace로 분리한다(출처: `cursor.md`). → 상태색 집합은 작게 유지하고, 동작 단계색과 일반 상태색을 섞지 않는다. (관련 기존 제안: `DP-20260925-1`·`5`)
2. **상태 신호는 텍스트/작은 배지로, 표면 채움으로 쓰지 않는다.** Binance는 상승/하락 녹색·적색을 "text color or small badge fill — never as a card surface"로 규정한다(출처: `binance.md`). Meta는 상태 배지에 배경색+짧은 라벨(`caption-bold`) 조합을 쓴다(출처: `meta.md`). → 상태는 행의 한 조각(글리프·단어·배지)이지 전체 화면의 색이 아니다.
3. **상태 표현의 강도를 낮게 유지한다.** BMW M·Bugatti는 success/warning을 "order-confirmation states (rare on marketing surfaces)", "used very sparingly"로 규정한다(출처: `bmw-m.md`, `bugatti.md`). → 성공·대기 같은 잦은 상태일수록 최소 신호(글리프 1개)로 표현하고, attention 같은 드문 상태에만 강한 신호를 남긴다.
4. **상태 변형을 별도 항목으로 정의한다.** Raycast·HP·IBM·Nike 등은 pressed/disabled/active를 별도 variant 항목(`-pressed`, `-disabled`)으로 등록하고 "do not bury them inside prose"를 요구한다(출처: `raycast.md`, `hp.md`, `ibm.md`, `nike.md`). → 대기·진행·실패 같은 상태 변형도 임시 문장이 아니라 이름 붙은 어휘 항목으로 등록한다.
5. **없는 상태를 발명하지 않는다.** Ollama는 "effectively no error/success/warning palette"를 그대로 기록하고, Airbnb는 "Loading states / skeleton screens: not visible"을 정직하게 남긴다(출처: `ollama.md`, `airbnb.md`). → corpus의 known-gap 관행처럼, 아직 승인되지 않은 상태 표현은 gap으로 문서화한다(관련: `design-language.md` §6).

기각 (Loop 비적용 사유 포함):

1. **skeleton screen·shimmer 로딩** — 웹의 비동기 로딩 자리표시자다. Loop 출력은 동기 텍스트라 로딩 자리가 없고, 줄 예산(status 8) 안에서 존재하지 않는 줄을 채우는 것은 밀도 규율 위반이다.
2. **hover 상태** — 포인터 전용 상태다(출처: `raycast.md`는 "No hover states documented"를 정책으로 명시). Loop CLI/TUI는 키보드·텍스트 환경이므로 비적용.
3. **pressed scale 변형(터치/클릭 피드백)** — Nike의 `scale(0.5) opacity 0.5` 등은 포인터 상호작용 피드백이다. 터미널에는 압력 피드백 개념이 없어 비적용.

**(c) Loop 실천 항목.**

- [ ] 상태(running/failed/attention/done)를 표현할 때 상태색·글리프·단어 중 **폐쇄된 어휘 조회 경로 한 곳**만 사용한다(현행: 무색 텍스트 — D-3·D-4 승인 전까지 유지).
- [ ] 성공·대기 등 잦은 상태는 글리프 1개 또는 단어 1개로 최소 표현하고, 표면당 강한 상태 신호는 드물게 쓴다.
- [ ] 새 상태 변형이 필요하면 문장 속에 암묵적으로 넣지 말고 어휘 항목으로 접수한다.
- [ ] corpus에 근거 없는 상태(예: "로딩 중" 스피너)를 새로 발명하지 않고, 필요하면 제안 lane으로 접수한다.

## 2. 정보 위계와 스캔성

**(a) 원칙.** 위계는 크기가 아니라 **대비의 차등**으로 만든다. 터미널처럼 서체 크기가 하나뿐인 매체에서는 굵기·채도·위치·줄 분리가 곧 위계다. 한 화면은 한 번의 훑기에 답해야 한다: "지금 무엇이 문제인가".

**(b) corpus 기법.**

채택:

1. **굵기 이분법으로 위계를 만든다.** Spotify는 대부분의 텍스트를 700/400 이분법으로 두고 600을 드물게 써서 "clear visual hierarchy through weight contrast rather than size variation"을 얻는다(출처: `spotify.md`). → 단일 서체 크기 환경에서 bold/regular 이분법은 가장 직접적인 위계 도구다(관련: `DP-20260925-2`).
2. **제목은 조이고 본문은 늘인다.** Sanity는 heading line-height 1.00–1.24 vs body 1.50의 대비로 위계를 만들고, 기술 라벨은 uppercase 모노스페이스로 "system readout" 미학을 준다(출처: `sanity.md`). → 터미널 변환: 헤더 행은 압축(접두사·구분자 규칙 고정), 목록 행은 균일 리듬, 기술 라벨은 uppercase 또는 고정 접두사.
3. **라벨–값 구분을 균일하게.** Apple의 dense footer는 2.41의 널찍한 줄 간격으로 밀집 열의 스캔성을 확보한다(출처: `apple.md`). OpenCode는 들여쓰기 대신 ASCII 브래킷 접두사로 목록을 스캔 가능하게 만든다(출처: `opencode.ai.md`). → 구분자(`·`, `: `)와 접두사 규칙을 표면 전체에서 통일해야 훑기가 된다(관련 감사 P2-6).
4. **강조가 의심되면 굵기보다 배치 먼저.** Airtable은 "When in doubt about emphasis: bigger type before bolder type"을 규칙으로 둔다(출처: `airtable.md`). → 터미널 변환: bold보다 줄 분리·목록 상위 배치·앞쪽 정렬을 먼저 쓴다.
5. **숫자·식별자는 전용 어휘로 고정.** Binance는 가격·통계 숫자를 전용 타입(BinancePlex)으로 렌더해 "tabular and reliable"하게 만든다(출처: `binance.md`). → 터미널 변환: 수치·ID는 표기 형식(자릿수·단위·경로 형식)을 고정해 세로 스캔을 맞춘다.

기각:

1. **12:1 극단 크기 위계(120px 히어로 → 10px 라벨)** — 출처: `lamborghini.md`. 터미널에는 서체 크기 축이 없어 비적용.
2. **사진·제품 이미지로 하는 위계(photography-as-depth)** — 출처: `airtable.md`. 텍스트 전용 매체에서 재현 불가.

**(c) Loop 실천 항목.**

- [ ] 위계가 필요하면 색·bold보다 **줄 배치(위치·분리)** 를 먼저 쓰고, 그다음 bold/dim, 색은 마지막 수단으로 둔다.
- [ ] 라벨·값·목록의 구분자를 표면 전체에서 동일하게 쓴다(어휘 상수 경유).
- [ ] 한 표면이 "지금 뭐가 문제인가"를 첫 훑기에서 답하는지 확인한다(최상위 행 = 최우선 정보).

## 3. 밀도와 여백

**(a) 원칙.** 밀도는 전역 상수가 아니라 **표면의 목적에 따른 선택**이다. 훑고 판단하는 표면은 넓게, 비교하고 행동하는 표면은 좁게. 여백(터미널: 빈 줄)은 균일하게 쓰고, 구분은 장식이 아니라 하나의 규칙으로.

**(b) corpus 기법.**

채택:

1. **표면 목적별 이중 밀도 철학.** Sentry는 "hero and feature surfaces are spacious, transactional surfaces are dense — users are scanning, comparing, and acting"으로, Shopify도 시네마틱 트랙 128–192px vs 트랜잭셔널 트랙 48–64px로 표면별 밀도를 나눈다(출처: `sentry.md`, `shopify.md`). → 터미널 변환: 요약(status) 표면은 느슑하게(줄 예산 내 소수 행), 리포트(findings/list) 표면은 조밀하게.
2. **밀도 대비로 페이지 리듬을 만든다.** Airbnb는 "open hero, dense marketplace below" — 위는 열리고 아래는 조밀한 대비를 의도한다(출처: `airbnb.md`). → 요약 다음에 상세가 오는 CLI 출력 순서와 같은 원리다.
3. **밴드 사이 간격은 균일하게, 구분은 최소 장식으로.** Binance는 밴드 사이를 항상 균일 간격으로 유지하고, OpenCode는 구분을 1px hairline 규칙 하나로만 하며 장식 구분자를 두지 않는다(출처: `binance.md`, `opencode.ai.md`). → 터미널 변환: 섹션 사이 빈 줄 1개 규칙. `═`·`─` 같은 장식 구분선 대신 균일 공백.
4. **의도적 밀집 구역을 하나 허용한다.** Apple은 전체가 낮은 밀도지만 footer만 의도적으로 밀집해 전체 정보구조를 한눈에 보이게 한다(출처: `apple.md`). → 전체 목록(--json 제외 human 목록)처럼 "다 보여주는" 표면의 밀집은 예산 안에서 허용한다.

기각:

1. **픽셀 간격 체계(8px base, section 64/96px, 카드 padding)** — 출처: `airbnb.md` 등 전반. 터미널에 픽셀이 없다. Loop의 대응물은 논리 줄 예산(`config/policy.toml [output]`)이며 이는 정본이 소유한다.
2. **max-width·breakpoint·반응형 그리드** — 웹 레이아웃 개념. 터미널 폭 인식은 D-5 결정 대기라 비적용.

**(c) Loop 실천 항목.**

- [ ] 표면별 줄 예산(status 8 / attention 6 / findings 5 / list 8)을 지키고, 밀도 차이는 예산 차이로 표현한다.
- [ ] 섹션 구분은 빈 줄 등 단일 규칙으로 하고, 장식 구분선·임의 들여쓰기·임의 빈 줄을 넣지 않는다.
- [ ] 줄 예산을 잠식하는 장식(헤더 프레임·테두리 아스키 아트)을 추가하지 않는다.

## 4. 강조(색·bold) 사용 예산

**(a) 원칙.** 강조는 화폐다 — 희소할 때만 가치가 있다. 표면(한 번의 출력)당 최강조는 1개를 기본으로 하고, 강조가 많아지면 강조는 없는 것과 같다.

**(b) corpus 기법.**

채택:

1. **viewport당 최강조 1개 규율.** Airtable은 primary 버튼을 "one per viewport"로, Raycast는 "at most one solid white pill per fold"로, Ollama는 "fold당 primary pill 최대 1개"(단일 반전 요소)로 규정한다(출처: `airtable.md`, `raycast.md`, `ollama.md`). Figma는 "두 primary가 같은 viewport에 보이면 그 섹션은 과한 일을 하는 것 — 하나를 secondary로 중화하라"고 명시한다(출처: `figma.md`). (관련 기존 제안: `DP-20260925-3`·`7`·`11`)
2. **accent를 소수 역할에 예약하고, 그 밖은 드리프트로 명명한다.** IBM은 "IBM Blue scarce: links, primary CTA, CTA banner, focus underline. Anything beyond that is drift", Linear는 라벤더를 "brand mark, primary CTA, focus, link emphasis"에만 쓴다(출처: `ibm.md`, `linear.app.md`). → 강조의 허용 용도 목록을 폐쇄적으로 정의한다.
3. **핵심 수치에만 accent를 허용.** ClickHouse는 통계 숫자("779+", "47k+")를 노랑+bold로 강조하되 accent 사용을 primary와 핵심 수치로 한정한다(출처: `clickhouse.md`). → 터미널 변환: 강조 후보 = attention 최상위 항목과 핵심 수치(카운트·경과)뿐.
4. **강조의 표면 채움 금지.** Binance는 "Don't use yellow for body text or large surface fills — focal-point CTAs and headlines only"로 강조색의 사용 강도를 제한한다(출처: `binance.md`). → 강조는 행의 일부(단어·글리프)에만.
5. **표면 리듬에서 반복 강조 금지.** Cal.com은 "같은 surface 모드를 연속 밴드에서 반복하지 않는다"로 강조의 지루함·소음을 동시에 막는다(출처: `cal.md`). → 강조 행이 연속으로 늘어서면 강조 예산 초과로 본다.

기각:

1. **표면 반전(dark pricing card)으로 강조** — 출처: `ollama.md`, `coinbase.md`(featured tier 반전). reverse-video로 터미널 변환은 가능하지만 색·표현 도입은 D-4 승인 전까지 불가하므로, 필요하면 제안 lane으로 별도 접수한다.

**(c) Loop 실천 항목.**

- [ ] 한 번의 출력(표면)당 최강조(상태색+bold 동시 사용에 해당하는 강도) 1개를 기본으로 한다.
- [ ] bold는 attention 항목에만 쓰고, 본문·라벨·값에는 쓰지 않는다.
- [ ] 강조를 추가하려면 기존 강조를 하나 중화(제거)할지 먼저 묻는다.

## 5. 색 역할과 접근성

**(a) 원칙.** 색은 정보의 유일한 운반자가 되지 않는다. 색이 꺼진 세계를 먼저 설계하고(무색 텍스트 계층), 그 위에 색을 부가 신호로 덧댄다. 역할 이름은 값보다 먼저고, 값이 바뀌어도 역할은 불변이다.

**(b) corpus 기법.**

채택:

1. **무색 텍스트 계층이 위계를 먼저 만든다.** Warp는 chromatic accent 없이 body-strong/body/mute 텍스트 계층과 surface 대비만으로 우선순위를 만들고(출처: `warp.md`), ClickHouse는 "bigger Inter 700 before adding color"를 규칙으로 둔다(출처: `clickhouse.md`). Notion은 7단계 중립 잉크 + 서체 두께만으로 본문 위계를 세운 뒤 semantic 색을 별도로 얹는다(출처: `notion.md`). (관련 기존 제안: `DP-20260925-2`·`8`)
2. **semantic 삼종 폐쇄 + accent 역할 분리.** Notion은 semantic을 success/warning/error 3종으로 폐쇄하고 브랜드 primary·링크 blue를 별도 역할로 분리해 "상태 신호"와 "행위 유도·강조"가 같은 색을 재활용하지 않게 한다(출처: `notion.md`). (관련: `DP-20260925-9`)
3. **역할은 테마가 바뀌어도 불변.** Binance는 마케팅(다크)과 트랜잭션(라이트) 표면이 캔버스를 뒤집어도 노랑 CTA와 상승/하락 녹·적 semantic을 공유한다(출처: `binance.md`). → 역할 이름(의미)이 정본이고 값은 언제든 다시 매핑된다.
4. **색 외 구분 수단 병행.** Cal.com은 featured 티어를 색 리본이 아닌 표면 반전으로 구분하고("signals highlighted choice without colored ribbons", 출처: `cal.md`), Airbnb는 별점을 노랑이 아닌 잉크색으로 렌더해 "yellow stars feel cheap"라는 판단을 남긴다(출처: `airbnb.md`). → 색 없이도(또는 색 이전에) 형태·위치·잉크 강도로 구분 가능해야 한다.

기각:

1. **WCAG 터치 타깃 44×44px 규율** — 출처: 전반(airbnb, airtable, bmw-m 등). 포인터 타깃 개념이라 터미널 비적용. 대비 자동 검사는 8절의 테스트 강제로 흡수.
2. **24-bit 전용 색값·라이트/다크 듀얼 테마 파일** — ANSI 16/256 폴백 불가 값과 D-6 트리거 전 테마 체계는 기존 제안 lane(`DP-20260925-5` 판정 기준)에서 이미 기각된 원칙과 동일. 비적용.

**(c) Loop 실천 항목.**

- [ ] `NO_COLOR`·파이프·`--json`·로그 캡처 환경에서 정보가 하나도 빠지지 않는지 확인한다(색이 꺼져도 상태·우선순위가 판독되어야 한다).
- [ ] 색을 쓸 때 역할 이름(success/warning/error/accent/…)으로만 참조하고 hex·ANSI 코드를 호출점에 두지 않는다.
- [ ] 색으로만 구분되는 정보가 없는지 확인한다(색 제거 후에도 동일 정보가 남아야 한다).

## 6. 글리프·아이콘 어휘

**(a) 원칙.** 텍스트 중심 제품의 그림 문자는 아이콘이 아니라 **복사·파이프·로그에 남는 텍스트 어휘**다. 어휘는 작고(3~6개), 역할당 1개, 장식이 없어야 한다.

**(b) corpus 기법.**

채택:

1. **브래킷 불릿을 텍스트 콘텐츠로.** OpenCode는 `[+]`/`[-]`/`[x]`를 "the bracket marker is part of the text content, not a separate icon"으로 규정하고 chevron 아이콘·애니메이션 아코디언을 배제한다(출처: `opencode.ai.md`). (관련 기존 제안: `DP-20260925-4`·`6`)
2. **토글·방향도 평문 문자로.** OpenCode는 펼침/접힘을 `+`/`−` 평문으로 렌더한다(출처: `opencode.ai.md`). Loop의 `←`(의존 방향)·`·`(목록 구분)는 같은 원리의 기존 관찰 어휘다.
3. **비교 어포던스로 체크마크 1개.** Figma·Framer는 가격 비교표의 체크마크를 "glyph fill, not a surface"로 쓴다(출처: `figma.md`, `framer.md`). → 역할당 단일 글리프(성공 `✓`)가 비교·점검 어포던스를 대신한다.
4. **장식 글리프의 부재를 원칙으로.** Ollama는 유일한 장식(마스코트)을 명시하고 나머지는 전부 기능 어휘이며, OpenCode는 "no decorative ornament"을 시스템 특징으로 기록한다(출처: `ollama.md`, `opencode.ai.md`). → 장식 글리프는 어휘에 들어오지 않는다.

기각:

1. **일러스트 아이콘 세트·아이콘 폰트** — 출처: `airbnb.md`(hand-illustrated 32px icons), `coinbase.md`(CoinbaseIcons). 터미널에 렌더 수단이 없고 `DP-20260925-4`의 SVG/이미지 아이콘 금지와 충돌한다.
2. **브랜드 ASCII 아트(픽셀 워드마크·터미널 목업 프레임)** — 출처: `opencode.ai.md`. 출력 바이트를 잠식하고 줄 예산과 충돌하므로 비적용.

**(c) Loop 실천 항목.**

- [ ] 글리프는 어휘 상수(역할 소유)를 통해서만 출력하고 포맷터별 하드코딩을 하지 않는다.
- [ ] 글리프 후보는 단일 코드포인트 또는 순수 ASCII로 한정하고(터미널 폭 리스크 관리), 아이콘·이미지를 도입하지 않는다.
- [ ] 파이프·로그로 출력을 재소비했을 때 글리프가 의미를 보존하는지 확인한다.

## 7. 빈 상태와 오류 문구

**(a) 원칙.** 빈 상태와 오류는 예외 처리가 아니라 1급 표면이다. 문구는 짧고, 케이스가 균일하고, 각 표면마다 상수로 소유된다. "없음"을 표현하는 방식이 제품 신뢰를 결정한다.

**(b) corpus 기법.**

채택:

1. **빈 상태를 일급 컴포넌트로 정의.** Warp·Vercel·VoltAgent는 `ex-empty-state-card`를 독립 컴포넌트로 등록해 배경·여백·캡션 위계를 규격화한다(출처: `warp.md`, `vercel.md`, `voltagent.md`). → 빈 상태 문구도 임시 문자열이 아니라 어휘 상수(`empty.<surface>`)로 소유한다(감사 P2-3 대응).
2. **문구 케이스·톤 균일.** IBM Carbon은 all-caps eyebrow 대신 sentence case 14px 라벨을 유지해 라벨 톤을 통일한다(출처: `ibm.md`). → Loop 현행 빈 상태 문구(`No runs`, `No tasks`, `No active workers`)의 sentence case 관행을 유지·통일한다.
3. **상태 배지의 배경과 잉크 분리.** MiniMax는 success 배지에 "pale-green wash(배경) + deep-green ink(문구)" 이중 토큰을 둔다(출처: `minimax.md`). → 터미널 변환: 상태 단어와 본문 문구를 다른 계층(강조/본문)으로 분리해 같은 줄에 섞지 않는다.
4. **안내 문구에 전용 계층.** Stripe는 helper text·캡션·테이블 라벨을 위한 `ink-mute` 전용 잉크 계층을 둔다(출처: `stripe.md`). → overflow 안내(`… N more …`)·도움말 문구도 전용 어휘/계층으로(감사 P2-2 대응, R2 계약).
5. **문서화되지 않은 변형을 렌더하지 않는다.** Cohere는 "Do not render undocumented interaction variants"를 Don't로 명시한다(출처: `cohere.md`). → 어휘에 없는 오류·안내 문구를 코드에서 즉석 조합하지 않는다.

기각:

1. **일러스트 프레임이 들어간 empty state 카드** — 출처: `warp.md` 등의 illustration frame. 텍스트 전용 매체에서는 문구+여백으로 충분하고 이미지 렌더가 불가.
2. **toast(일시적 알림 표면)** — 출처: `warp.md`, `voltagent.md`, `vercel.md`. 시간 기반 소멸 UI는 웹 상호작용 모델이며, Loop 출력은 영속 텍스트(로그·리포트)라 비적용.

**(c) Loop 실천 항목.**

- [ ] 빈 상태 문구를 표면마다 인라인 정의하지 않고 상수로 소유한다(중복 정의 금지 — P2-3).
- [ ] 오류·안내 문구는 "무엇이 비었는가/무엇이 실패했는가 + 다음 행동"을 짧게 담고, 케이스·구두점 관행을 통일한다.
- [ ] overflow·생략 안내는 단일 팩토리의 계약 출력으로 생성한다(R2).

## 8. 일관성 강제 방법

**(a) 원칙.** 일관성은 규율이 아니라 **도구**다. 어휘를 직접 인용하게 하고, 변형은 등록하게 하고, 어긋남을 기계가 잡게 한다.

**(b) corpus 기법.**

채택:

1. **자동 lint로 깨진 참조·대비·고아 토큰을 잡는다.** corpus 다수가 공통으로 "Run `npx @google/design.md lint` — `broken-ref`, `contrast-ratio`, `orphaned-tokens` warnings flag issues automatically"를 사용 규칙으로 둔다(출처: `airtable.md`, `figma.md`, `raycast.md`, `hp.md`, `nike.md` 등 약 30건). → Loop의 대응물은 경계 테스트·무결성 테스트다(R11·R12, `bun run test:architecture`).
2. **토큰 직접 인용 강제.** "Reference tokens directly (`{colors.primary}`, …) — do not paraphrase to hex/px in prose"(출처: `hp.md`, `nike.md`, `meta.md`, `minimax.md`, `mintlify.md`). → 호출점에서 어휘 상수를 직접 참조하고, 값(글리프·ANSI·문구)을 문장·코드에 재서술하지 않는다.
3. **변형은 등록, 매몰 금지.** "Add new variants as separate entries (`-pressed`, `-disabled`) — do not bury them inside prose"(출처: `figma.md`, `ibm.md`, `nike.md`, `hp.md` 등). → 새 상태·문구 변형은 어휘 모듈에 등록한다.
4. **새 토큰 전에 기존 어휘 재조합 질문.** Raycast는 "새 컴포넌트를 도입할 때 기존 surface-ladder+radius+서체 어휘로 표현 가능한지 먼저 묻는다. 이 시스템의 강점은 새 토큰이 거의 필요 없다는 것"(출처: `raycast.md`). → 새 어휘 추가 제안에는 "기존 어휘로 불가능한 이유"를 요구한다.
5. **드리프트를 명명해 금지.** IBM "Anything beyond that is drift", Framer "If you find yourself reaching for a second blue, the brand is drifting", HashiCorp "per-product palette outside its product context — the brand is drifting"(출처: `ibm.md`, `framer.md`, `hashicorp.md`). → 금지 규칙을 "드리프트"라는 이름의 위반으로 정의하면 테스트 메시지·리뷰에서 판정이 명확해진다.
6. **폴백/대체재 사전 문서화.** Binance는 서체 대체재와 조정치(Inter, JetBrains Mono, line-height 보정)를 미리 문서화한다(출처: `binance.md`). → 색 도입 시 ANSI 16/256 폴백 매핑을 값과 함께 문서화한다(`DP-20260925-5`의 ANSI 후보 열 관행).

기각:

1. **`npx @google/design.md lint` 도구 자체** — Google Stitch 생태계 도구다. Loop는 기존 정규식 경계 테스트 패러다임을 유지한다(`design.md` R11 검토 대안과 동일 판정). 관행은 채택, 도구는 기각.

**(c) Loop 실천 항목.**

- [ ] 표현 변경은 어휘·토큰 모듈 수정으로 수행하고, presentation 밖 리터럴이 생기면 경계 테스트가 실패하게 유지한다(R11).
- [ ] 무결성 테스트가 9종 task 상태 매핑·overflow 계약·빈 상태 중복 부재를 계속 검증하게 유지한다(R12).
- [ ] 새 어휘·새 강조 도입 제안에는 기존 어휘로 불가능한 근거를 요구한다.

## 9. 빠른 체크리스트

제품 화면·출력을 만들거나 고칠 때 위 주제 순서대로 점검한다.

1. **[상태]** 상태 표현이 폐쇄된 어휘(글리프·단어, 승인 후 색 역할) 조회 경로 한 곳에서만 결정되는가?
2. **[상태]** 잦은 상태(성공·대기)가 최소 신호로, 드문 상태(attention·실패)만 강한 신호로 표현되는가?
3. **[상태]** corpus·정본에 근거 없는 새 상태 표현(스피너·프로그레스 바 등)을 발명하지 않았는가?
4. **[위계]** 색·bold보다 줄 배치(위치·분리)를 먼저 썼는가?
5. **[위계]** 첫 훑기에 "지금 무엇이 문제인가"가 답히는가 (최우선 정보가 최상위 행)?
6. **[밀도]** 표면별 줄 예산(8/6/5/8)을 지켰고, 밀도 차이가 예산 차이로 표현되는가?
7. **[밀도]** 장식 구분선·임의 들여쓰기·임의 빈 줄 없이 단일 구분 규칙(빈 줄 등)만 썼는가?
8. **[강조]** 표면당 최강조 1개 원칙을 지켰고, 새 강조 추가 전 기존 강조 중화를 검토했는가?
9. **[색]** `NO_COLOR`·파이프·`--json`·로그 환경에서 정보가 하나도 빠지지 않는가?
10. **[색]** 색만으로 구분되는 정보가 없는가 (색 제거 후 동일 정보가 남는가)?
11. **[글리프]** 글리프가 어휘 상수 경유 단일 코드포인트/ASCII이고, 파이프·로그 재소비 시 의미를 보존하는가?
12. **[문구]** 빈 상태·오류 문구가 상수 소유이고, "무엇이 비었는가/실패했는가 + 다음 행동"을 담았는가?
13. **[문구]** overflow·생략 안내가 단일 팩토리 계약(`… N more …`) 출력인가?
14. **[일관성]** 표현 변경이 어휘 모듈 수정으로 수행됐고, presentation 밖 리터럴이 생기지 않았는가?
15. **[일관성]** 새 어휘·강조는 제안 lane(DP)으로 접수됐고 기존 어휘로 불가능한 근거를 갖는가?

---

## 부록 — 결과 요약

- **주제 절 수:** 8 (상태 표현, 정보 위계·스캔성, 밀도·여백, 강조 예산, 색 역할·접근성, 글리프·아이콘 어휘, 빈 상태·오류 문구, 일관성 강제)
- **채택 기법 수:** 31 (주제별 4~6건) — 각 절 (b)의 "채택" 번호 기준
- **기각 기법 수:** 15 — 각 절 (b)의 "기각" 번호 기준, Loop 비적용 사유 명시
- **빠른 체크리스트 항목 수:** 15
- **작성 파일:** `docs/design/ui-ux-guidance.md` (이 문서)
- **근거 corpus:** `docs/design/references/awesome-design-md/` 74건 (MIT snapshot, commit `f6961238d5cddcf8042a74a70fc400ec67181abb`)
- **조언 → 제안 경로:** [`design-language.md` 제안 lane](design-language.md#디자인-논의수정-제안-방법)에 `DP-YYYYMMDD-N` 마커로 접수 → 승인 게이트 → integration 반영. 기존 제안과 겹치는 조언은 해당 DP(`DP-20260925-1`~`11`)가 소유한다.
