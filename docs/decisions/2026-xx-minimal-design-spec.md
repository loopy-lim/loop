# Minimal design spec — simple is best 전면 정비

- **태스크:** `minimal-design-spec` (decision, attempt 0)
- **상태:** 결정됨
- **작성일:** 2026-09-26
- **입력:** `apps/loop-mobile/src/ui/tokens.ts`(기존 폐쇄 어휘), `apps/loop-desktop/ui/styles.css`, `apps/loop-desktop/src/{screens,features,ui}/**`, `apps/loop-mobile/src/**` 전수 grep 감사, `docs/design/ui-ux-guidance.md`(§1~§9), `docs/decisions/2026-xx-codex-detail-checklist.md`(C1~C16 무개정), `docs/research/simulator-showcase/v8/`(비교 기준 컷)
- **쓰기 범위:** 이 결정 문서만
- **제약:** 유료 모델 호출 금지, 실기기 없음(시뮬레이터·데스크톱 창 기준), 동작 불변(steer/계약/테스트 유지), AGENTS.md 경계 준수

## 1. 배경

운영자 판단: 현재 앱 디자인이 더럽다 — 색 과다, 장식 혼잡. 원칙은 **절제**: 소수의 색(중성 표면 + 단일 액센트, 상태색은 의미 있을 때만), 일관된 타이포/간격 리듬, 그림자·보더 최소화, 목적 있는 모션만. 전수 감사 결과 **노이즈의 중심은 모바일이 아니라 데스크톱**이다: 모바일은 `ui-codex-redesign`·`beauty-polish-pass` 이후 폐쇄 어휘(tokens.ts)만 사용(호출부 hex 0건, 아드혹 간격 0건)이지만, 데스크톱은 하드코딩된 9색과 미스타일 클래스 16개로 기본 브라우저 스타일이 섞여 있다. 이 결정은 (a) 노이즈 감사와 (b) 교체 스펙을 고정하고, 각 항목에 기계 검증 가능한 수용 기준을 붙인다. Codex 앱의 절제가 기준점이다.

## 2. (a) 노이즈 감사 — 무엇이 UI를 더럽게 만드는가

### 2-1. 모바일 (`apps/loop-mobile`) — 이미 규율됨, 잔여물만 처리

전수 grep 증거: `src/**/*.tsx|ts`에서 tokens.ts 외 hex 0건, rgba 0건, `space.* + N` 산술 0건, raw `borderRadius` 0건. 색 사용 분포(호출부 빈도): ink 24 / inkMute 21 / inkFaint 21 / hairline 15 / surface 9 / surfaceAlt 7 / 상태삼합 13 / cta 계열 7 — 위계가 무색 잉크 계층에 있고 색은 상태에만 쓰인다(§4 강조 예산 준수). **잔여 노이즈 3건:**

| # | 항목 | 증거 | 판정 |
| --- | --- | --- | --- |
| M1 | 터미널 미러가 tokens.ts와 별개로 hex 복제 | `apps/loop-mobile/src/ui/terminalLayout.ts:20-21` (`#0D1117`, `#E6EDF3`) | 단일 소스 위반 — tokens 경유로 교체 |
| M2 | 하드코딩 glyph font-size 2건 | `apps/loop-mobile/src/features/run-list.tsx:232` (8), `apps/loop-mobile/src/screens/ConversationScreen.tsx:726` (7) | 등록되지 않은 마이크로 스텝 — tokens에 `glyph`로 등록 |
| M3 | 근흑 배경 위 그림자 장식 | `apps/loop-mobile/src/ui/tokens.ts` elevation.card (opacity 0.3, r10) — #0D1117 위에서 시각적으로 거의 읽히지 않아 순수 장식 | hairline이 모든 모서리를 담당(§3), 그림자는 float(hover 요소)만 유지 |

### 2-2. 데스크톱 (`apps/loop-desktop`) — 실제 더러움의 원천

`ui/styles.css`(94행)와 소스 클래스 전수 대조:

| # | 항목 | 증거 | 왜 더러운가 |
| --- | --- | --- | --- |
| D1 | 하드코딩 distinct 색 9종 | `styles.css:8` #101014, `:9,30` #e6e6ea, `:22` #a0a0ac, `:29` #1a1a20, `:31` #2c2c34, `:39` #2f5fd0, `:54` #ff7b72, `:63,81` #1c1c22, `:91` #8b949e | 모바일 팔레트(#0D1117 계열)와 **다른 별개 팔레트** — 같은 제품이 두 개의 배경색을 가짐 |
| D2 | 채도 높은 파랑 액센트 | `styles.css:39` `#2f5fd0` (button 배경) | 화면당 단일 강조 원칙(§4) 위반 + 모바일 CTA(근백색 반전)와 무관한 제3의 강조. 빨강 `:54` #ff7b72는 모바일 syntax 키워드 색과 우연히 충돌(상태 체계 아님) |
| D3 | 스타일 없는 클래스 16개 | TS 사용: `chats-list.ts:22-28`(chat-row*), `conversation-timeline.ts:65-199`(conv-* 14종) — styles.css에 대응 규칙 **0건** | 타임라인·채팅 목록이 브라우저 기본 스타일로 렌더 — 패딩·폰트·정렬이 화면마다 제각각 |
| D4 | 스케일 밖 값 산재 | `styles.css:32,42` radius 6px(모바일 4/8/12/16 체계 밖), `:33` padding 8px 10px, `:43` 8px 18px(4pt 배수 아님), `:70` 20px | 간격·반경 리듬 불일치 |
| D5 | 행마다 보더 노이즈 | `styles.css:63` `.output-line { border-bottom }` — 모든 출력 줄에 1px 선 | §3 "분리는 하나의 조용한 선" 위반 — 선이 내용보다 많음 |
| D6 | 모션·상태 체계 부재 | styles.css 전체에 transition 0건, 상태색 role 없음 | 스트리밍 페이드 등 목적 있는 모션 스펙 미적용 |

### 2-3. 정량 요약

| 지표 | 모바일 | 데스크톱 | 목표 |
| --- | --- | --- | --- |
| distinct 색(장식 제외) | 23 role, 호출부 hex 0건 | 9 hex 하드코딩, role 0건 | 양면 동일한 role 팔레트, 호출부 hex 0건 |
| 미스타일 클래스 | 0 | 16 | 0 |
| 그림자 등록 | 2(card/float) | 0 | 1(float 전용) |
| 스케일 밖 간격/반경 | 0 | 6곳 | 0 |

## 3. (b) 교체 스펙 — 절제 원칙의 구체 사양

### S1. 팔레트 — 단일 소스, 역할 이름만

**단일 소스는 모바일 `apps/loop-mobile/src/ui/tokens.ts`의 hex다.** 데스크톱은 동일 hex를 CSS 사용자 정의 속성으로 미러링한다(RN과 DOM이 런타임을 공유할 수 없으므로 값 공유 + 동등성 테스트로 강제 — §5 채택 결정). 폐쇄 팔레트:

- 중성: `bg #0D1117` / `surface #161C26` / `surfaceAlt #1D2530` / `userBubble #242E3C`
- 잉크: `ink #E6EDF3` / `inkMute 64%` / `inkFaint 40%` / `hairline 12%`
- **단일 액센트:** `cta #F0F6FC` + `ctaInk #0D1117`(근백색 반전 — 화면에서 유일한 강함)
- 상태 삼합(의미 있을 때만, glyph+텍스트 액센트): `ok #3FB950` / `warn #D29922` / `danger #F85149`
- 문법 강조(코드펜스 한정): syntax 5종(현행 유지)

- **AC-S1-1** `[단위 테스트]` 신규 동등성 테스트가 `styles.css`의 `:root` 변수 값과 `tokens.ts` hex/rgba를 파싱해 전부 일치함을 단언(양면 팔레트 단일화).
- **AC-S1-2** `[코드 검사]` `styles.css`에 남은 hex 리터럴은 QR SVG(`src/ui/qr.ts:423-424`, 스캐너 기능색 — 면제)뿐, 그 외 0건.
- **AC-S1-3** `[코드 검사]` `#2f5fd0` 참조 0건 — 버튼 CTA는 `cta`/`ctaInk` 변수 경유.
- **AC-S1-4** `[스크린샷]` 데스크톱 배경이 모바일과 동일한 근흑(#0D1117 계열)으로 보인다(v11 비교 컷).

### S2. 타입 스케일 — 7단계 폐쇄

모바일 `type` 토큰(display 26/title 17/body 15/bodyStrong 15/caption 12/captionStrong 12/mono 12)이 유일한 스케일. 데스크톱 매핑: 라벨 13px→caption(12), 본문 16px→body(15), QR 힌트 12px→caption, 코드 12px→mono. 신규 크기 신설 금지.

- **AC-S2-1** `[코드 검사]` styles.css에 `font-size` 선언은 변수 경유이고 리터럴 px 값은 토큰 스케일 값 {26,17,15,12}뿐.
- **AC-S2-2** `[스크린샷]` 데스크톱 라벨·본문·코드가 시각적으로 3계층(캡션/본문/모노)으로만 구분된다.

### S3. 간격 스케일 — 4pt 기반 7스텝

`space = {xxs:2, xs:4, s:8, m:12, l:16, xl:24, xxl:32}` 유일 스케일. 데스크톱 교체 매핑: `10px→s(8) 또는 m(12)`, `18px→l(16)`, `20px→xl(24)`, `2px→xxs(2)`. 산술 조합(`s + 2` 등) 금지 — 스텝 추가는 tokens 개정으로만.

- **AC-S3-1** `[코드 검사]` styles.css의 모든 margin/padding/gap 값이 {2,4,8,12,16,24,32} ∪ {0, auto}뿐.
- **AC-S3-2** `[단위 테스트]` 모바일 호출부에 `space.* [+*] 숫자` 패턴 0건(회귀 감시 grep을 테스트로 고정).

### S4. 반경 체계 — 4스텝 + pill

`radius = {xxs:4, s:8, m:12, l:16, pill:999}`. 데스크톱 6px→s(8) 교체. 신설 반경 금지.

- **AC-S4-1** `[코드 검사]` styles.css의 `border-radius` 값이 {4,8,12,16,999} ∪ {0, 50%}(원형 도트)뿐.

### S5. 보더·그림자 — hairline 단일 규칙, float 전용 그림자

- 모든 모서리 분리는 `hairline 1px` 하나. **REMOVE:** `.output-line` 행별 border-bottom(§2 D5) → 줄 분리는 자연 개행으로 충분, 블록 분리는 표면 차이(surfaceAlt)로.
- 그림자는 등록 1종 `elevation.float`(스크롤 위에 떠 있는 요소 — 모바일 jump-pill 등)만 유지. **REMOVE:** 근흑 배경에서 읽히지 않는 `elevation.card` 장식 그림자(§2 M3) — 카드는 hairline만.
- **AC-S5-1** `[단위 테스트]` 모바일 소스에서 `elevation.card` 스프레드 0건, `elevation.float`는 등록 소비처(jump-pill 등)에만 사용.
- **AC-S5-2** `[코드 검사]` styles.css에 `box-shadow` 0건, `border` 선언은 hairline 변수 경유뿐.
- **AC-S5-3** `[스크린샷]` 출력 화면에서 행 구분선이 보이지 않고, 카드 경계가 hairline 하나로만 읽힌다.

### S6. 모션 사양 — 목적 있는 4종만

기존 `tokens.motion`·`ui/motion.tsx` 단일 소비면 유지(신설 타이머/이징 금지):

| 대상 | 토큰 | 시간 | 이징 | 목적 |
| --- | --- | --- | --- | --- |
| 툴카드 폴드 | `fold` | 220ms | LayoutAnimation ease-in-out | 공간 연속성 |
| 타임라인 행 등장 | `entrance`(+4pt rise) | 240ms | `Easing.out(Easing.quad)` | 스트리밍 도착 신호 |
| 스트리밍 커서/실행 뱃지 | `blink` 530ms / `pulse` 900ms | 2프레임 opacity | — | 느린 주기로 표면을 조용히 유지 |
| 데스크톱 스트리밍 행 | 신설 CSS `fade-in 240ms ease-out` | 240ms | ease-out(quad 상당) | 모바일 entrance와 동일 목적 — 유일한 데스크톱 모션 |

- **감소 모션:** 데스크톱은 `@media (prefers-reduced-motion: reduce)`에서 fade-in·transition을 비활성화(즉시 표시). 모바일은 OS Reduce Motion 설정 시 `Entrance`를 no-op으로.
- **AC-S6-1** `[코드 검사]` styles.css의 transition/animation 선언이 fade-in 1종 + reduced-motion 블록뿐.
- **AC-S6-2** `[단위 테스트]` 모바일에서 `setTimeout` 기반 자체 모션 타이머 신설 0건(motion.tsx가 유일 소비면).
- **AC-S6-3** `[스크린샷]` 스트리밍 중 컷에서 새 행이 페이드 인됨(연속 캡처 2장 비교 — v11 절차에 포함).

### S7. REMOVE 목록 (요약)

1. `styles.css` 파랑 액센트 #2f5fd0 및 미스매치 9색(→ tokens 미러 변수, D1/D2)
2. `.output-line` 행별 border-bottom(D5)
3. 근흑 배경 위 `elevation.card` 그림자(M3)
4. `terminalLayout.ts` hex 복제(M1)
5. 하드코딩 glyph font-size 7/8px(M2 → `glyph` 토큰 등록)
6. 스케일 밖 padding 10/18/20, radius 6(D4)
7. 미스타일 클래스 16개 방치(D3 → S8에서 최소 규칙 부여)

### S8. 데스크톱 클래스 최소 규칙

16개 미스타일 클래스에 **화면별 역할 규칙만** 부여한다 — 신규 장식 아님: 채팅 행(hairline 하단 1개만 대신 목록은 간격으로 분리), 사용자 버블(userBubble+radius.l), 툴 카드(surfaceAlt+radius.m+hairline), steer 마커(hairline 좌측 인셋 + warn 글리프 — 동작 불변, 표시만), 첨부 카드, 모노 블록. 요소 기본값 리셋은 `box-sizing` 등 최소한만.

- **AC-S8-1** `[단위 테스트]` 신규 커버리지 테스트: 데스크톱 TS의 `className = '…'` 값이 styles.css 규칙(또는 조합 클래스) 100% 커버 — 미스타일 0 회귀 감시.
- **AC-S8-2** `[스크린샷]` 데스크톱 대화 화면에서 툴카드·버블·steer 마커가 모바일과 동일한 표면/반경 어휘로 보인다.

## 4. 데스크톱 채택 — 공유 방식 결정

대안 비교: (A) 토큰을 공유 JSON으로 추출해 양면 코드젠 — 단일 소스는 완전하나 빌드 단계·경계가 늘어나 현재 2-표면 규모엔 과잉. (B) **데스크톱 `:root` CSS 변수가 tokens.ts hex를 값으로 미러링 + 동등성 단위 테스트(AC-S1-1)로 일치 강제** — 런타임 공유는 불가(RN vs DOM)하므로 값 공유가 최선의 단순해. **(B) 채택.** 제3의 표면이 생기면 (A)로 승격하는 것을 후속 트리거로 문서화한다. 토큰 모듈은 표현 계층 자산이므로 loop-core/브리지 경계와 무관(AGENTS.md 준수).

## 5. 검증

```bash
bun test packages                      # 토큰 동등성·커버리지·회귀 grep 테스트
cargo test -p loop-bridge              # 동작 불변 확인(표현 변경이지만 회귀 감시)
bun run codegen:check && bun run check # 전체 게이트
```

스크린샷 증거는 시연 v11 태스크에서 v8 대표 컷(`docs/research/simulator-showcase/v8/01~05`)과 나란히 비교. 유료 모델 호출 0(스크립트 세션·stub planner), 실기기 없음.

## 6. 후속 트리거

- 제3의 표면(TUI·웹 등) 추가 시 → 토큰 공유 JSON + 코드젠 승격(§4).
- 라이트 테마 도입 시 → tokens.ts role 구조 불변, hex 매핑만 교체(기존 문서 계약 유지).
- 타임라인 가상화 필요 시 → codex-detail-checklist G17 트리거 조건 그대로.
