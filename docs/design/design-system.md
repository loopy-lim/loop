# Loop 디자인 시스템 — 최소 절제 사양 (canonical)

- **상태:** canonical — GUI 표면(모바일 RN + 데스크톱 DOM)의 공식 디자인 시스템 문서
- **승격 근거:** 결정 [`2026-xx-minimal-design-spec.md`](../decisions/2026-xx-minimal-design-spec.md) (2026-09-26 결정됨)
- **기계 검증:** [`docs/findings/minimal-design-verification.md`](../findings/minimal-design-verification.md) — AC-S1~S8 기계 기준 14/14 PASS
- **작성일:** 2026-09-26

## 0. 이 문서의 위치 — 다른 디자인 문서와의 관계

문서가 많아 혼란을 막기 위한 지도다. **이 문서는 GUI 표면의 유일한 정본**이다.

| 문서 | 역할 | 정본 여부 |
| --- | --- | --- |
| **이 문서** (`design-system.md`) | GUI(모바일·데스크톱)의 토큰·스케일·색 예산·모션·REMOVE 목록 | **정본** |
| [`ui-ux-guidance.md`](ui-ux-guidance.md) | 외부 corpus 증류 실무 조언 — 이 문서의 **왜(why)의 근거 저장소** | non-canonical (§참조 전용) |
| [`design.md`](design.md) | CLI/TUI 표면(presentation 어휘·줄 예산·NO_COLOR) — **GUI 정본을 대체하지 않는다** | CLI/TUI lane 정본(draft) |
| [`design-language.md`](design-language.md) | 디자인 변경 제안 lane(DP) — 이 문서를 고치려면 여기서 접수 | 절차 문서 |
| 결정 `2026-xx-minimal-design-spec.md` | 이 사양의 결정 근거·대안 비교·AC | ADR |

정합성 규칙: 이 문서의 각 조항은 ui-ux-guidance의 대응 절을 근거로 인용한다(아래 표). ui-ux-guidance의 조언 중 채택된 것은 이 문서에 사양으로 굳혔고, 나머지는 조언으로 남는다. 두 문서가 충돌하면 **이 문서가 이긴다**; 이 문서를 고치려면 `design-language.md` DP lane으로 접수한다.

| 이 문서 조항 | ui-ux-guidance 근거 |
| --- | --- |
| §2 팔레트·역할 | §5 (색 역할과 접근성) |
| §3 타입/간격/반경 스케일 | §3 (밀도와 여백) |
| §4 색·강조 예산 | §4 (강조 사용 예산), §1 (상태 표현) |
| §5 모션 | §1-3 (잦은 상태는 조용히) |
| §6 REMOVE 목록 | §8 (일관성 강제 — 드리프트 명명) |

## 1. 단일 소스

**모든 값의 단일 소스는 `apps/loop-mobile/src/ui/tokens.ts`다.**

- 모바일(RN): `tokens.ts`를 직접 import — 호출부 hex 0건.
- 데스크톱(DOM): `ui/styles.css`의 `:root` 블록(`:13-37`)이 같은 hex를 CSS 변수로 미러링 — `styles.css` 내 리터럴은 이 블록이 유일한 장소. 일치는 `apps/loop-mobile/test/design-spec.test.ts`(AC-S1-1 동등성 테스트)가 강제한다.
- RN과 DOM은 런타임을 공유할 수 없으므로 값 공유 + 동등성 테스트가 채택 방식이다(결정 §4 — 코드젠 방식은 제3의 표면 생길 때까지 보류).

위반의 이름은 **드리프트**다: 호출점 hex, 스케일 밖 px, 미등록 모션 타이머는 전부 드리프트이며 테스트가 잡는다.

## 2. 팔레트 — 역할 이름만, 폐쇄 집합

색은 항상 역할 이름으로 참조한다. 값은 테마 매핑일 뿐이고 역할은 불변한다(guidance §5-3).

| 역할 | 값 (tokens.ts) | 용도 |
| --- | --- | --- |
| `bg` | `#0D1117` | 화면 배경 (근흑, GitHub-dark 계열) |
| `surface` | `#161C26` | 카드·행·입력·컴포저 |
| `surfaceAlt` | `#1D2530` | 카드 내 중첩 표면 — 코드 블록, 펼친 툴 출력 |
| `userBubble` | `#242E3C` | 사용자 버블 (surface보다 한 단계 밝음) |
| `hairline` | `rgba(230,237,243,0.12)` | **모든** 모서리 분리 (1px) |
| `ink` | `#E6EDF3` | 본문 |
| `inkMute` | `ink 64%` | 보조 텍스트·헬퍼 |
| `inkFaint` | `ink 40%` | 희미한 안내·타임스탬프 |
| `cta` / `ctaInk` | `#F0F6FC` / `#0D1117` | **유일한 강한 강조** — 근백색 반전 |
| `ctaDisabled` | `cta 16%` | 비활성 CTA |
| `ok` / `warn` / `danger` | `#3FB950` / `#D29922` / `#F85149` | 상태 삼합 — glyph+텍스트 액센트 전용 |
| `syntax*` (5종) | 현행 유지 | 코드펜스 한정. `plain`은 무색(ink 상속) |

규칙:

1. **무색 잉크 계층이 위계를 먼저 만든다.** 위계 필요 → 위치·간격 → 굵기(ink 계층) → 색은 마지막 수단.
2. 상태색은 큰 표면 채움 금지 — 행의 한 조각(글리프·단어·얇은 액센트)만.
3. 색만으로 구분되는 정보 금지 — 색이 꺼져도(그레이·스크린샷 흑백) 동일 정보가 남아야 한다.
4. 접근성 하한: `ink`/`inkMute`는 `bg`·`surface` 위 WCAG AA(4.5:1) 이상으로 유지한다. `inkFaint`(40%)는 장식·보조 한정으로 본문에 쓰지 않는다.

## 3. 폐쇄 스케일 — 타입 · 간격 · 반경

### 타입 (8단계, 신설 금지)

| 토큰 | 크기/줄높이 | 굵기 | 용도 |
| --- | --- | --- | --- |
| `display` | 26/32 | 700 | 화면 최상위 제목 |
| `title` | 17/24 | 600 | 섹션 제목 |
| `body` / `bodyStrong` | 15/22 | 400/600 | 본문·강조 본문 |
| `caption` / `captionStrong` | 12/17 | 400/600 | 라벨·보조 |
| `mono` | 12/18 | 400 | 코드·터미널 (Menlo) |
| `glyph` | 8/17 | 400 | 장식 글리프 전용 — 본문 금지 |

두 서체만: 시스템 sans(prose) + Menlo(코드·터미널 미러). 본문 최소 크기는 `caption`(12) — 그 아래는 `glyph` 1스텝뿐이고 산문에 쓰면 드리프트다. 리터럴 px font-size 금지 — 변수 또는 토큰 경유만.

### 간격 (4pt 기반 7스텝, 산술 조합 금지)

`space = { xxs:2, xs:4, s:8, m:12, l:16, xl:24, xxl:32 }` — 유일 스케일. `s + 2` 같은 스텝 산술 금지; 스텝 추가는 tokens 개정(DP 접수)으로만. margin/padding/gap 허용 집합: {2,4,8,12,16,24,32} ∪ {0, auto}.

### 반경 (4스텝 + pill, 신설 금지)

`radius = { xxs:4, s:8, m:12, l:16, pill:999 }` ∪ {0, 50%(원형 도트)}. 카드=radius.m, 버블=radius.l, pill=999.

### 표면과 그림자

- 모서리 분리는 `hairline` 1px **하나**. 행별 border(출력 줄마다 선) 금지 — 블록 분리는 표면 차이(surfaceAlt)로.
- 그림자 등록은 `elevation.float` 1종(스크롤 위에 떠 있는 요소 — jump-pill 등)만. 근흑 배경 위 resting 그림자는 읽히지 않는 순수 장식이므로 금지 — 카드는 hairline만.

## 4. 색·강조 예산

강조는 화폐다 — 희소할 때만 가치가 있다(guidance §4).

1. **화면당 최강조 1개:** `cta` 반전 요소는 viewport당 1개. 새 강조를 추가하려면 기존 강조 하나를 중화할지 먼저 묻는다.
2. **상태 삼합은 의미 있을 때만:** 잦은 상태(ok/대기)는 글리프 1개 최소 신호, 드문 상태(danger/attention)만 강한 신호.
3. **accent 드리프트 금지:** 새 색상("두 번째 파랑")은 드리프트 — 기존 역할로 불가능한 근거를 들어 DP로 접수.

## 5. 모션 — 목적 있는 등록 4종만

신설 타이머·이징 금지. 모바일 메커니즘의 단일 소비면은 `ui/motion.tsx`다.

| 대상 | 토큰 | 시간 | 이징 | 목적 |
| --- | --- | --- | --- | --- |
| 툴카드 폴드 | `motion.fold` | 220ms | LayoutAnimation ease-in-out | 공간 연속성 |
| 타임라인 행 등장 | `motion.entrance` (+4pt rise) | 240ms | `Easing.out(Easing.quad)` | 스트리밍 도착 신호 |
| 커서·실행 뱃지 | `motion.blink` 530ms / `pulse` 900ms | 2프레임 opacity | — | 느린 주기로 표면을 조용히 유지 |
| 데스크톱 스트리밍 행 | CSS `fade-in` | 240ms | ease-out | 모바일 entrance와 동일 목적 — 유일한 데스크톱 모션 |

**감소 모션:** 데스크톱은 `@media (prefers-reduced-motion: reduce)`에서 fade-in·transition 비활성(즉시 표시). 모바일은 OS Reduce Motion에서 `Entrance` no-op. 등록된 4종 밖의 transition/animation은 드리프트다.

## 6. REMOVE 목록 — 절제가 금지하는 것

이 목록은 이미 소멸이 검증됐고(verification §2), 회귀 감시 테스트가 상시 잡는다. **다시 도입하면 드리프트다.**

1. 토큰 밖 hex/rgba 리터럴 (데스크톱 `:root` 미러 블록과 QR 스캐너 기능색 2건 면제 외 전부)
2. 행별 border-bottom(출력 줄마다 구분선) — 줄 분리는 자연 개행
3. 근흑 배경 위 resting 그림자 (`elevation.card`류) — 카드는 hairline만
4. tokens 밖 hex 복제 (터미널 미러 등)
5. 등록 밖 font-size (7/8px 마이크로 스텝 → `glyph` 토큰 경유만)
6. 스케일 밖 간격(10/18/20px)·반경(6px)
7. 미스타일 클래스 — 데스크톱 className은 styles.css 규칙 100% 커버(커버리지 테스트)
8. 파랑 액센트류 제3의 강조 (`#2f5fd0` 교체 — CTA는 `cta`/`ctaInk`만)

## 7. 회귀 감시 (이 사양의 강제 장치)

| 테스트 | 위치 | 감시 항목 |
| --- | --- | --- |
| 동등성 테스트 | `apps/loop-mobile/test/design-spec.test.ts` | styles.css `:root` == tokens.ts (§1) |
| 커버리지 테스트 | 동상 | 데스크톱 className → CSS 규칙 100% |
| 회귀 grep 테스트 | 동상 | 간격 산술, elevation 소비, 모션 import 단일 경로 |
| 실행 방법 | — | `bun test apps/loop-mobile/test` (check 게이트는 apps 미포함 — 별도 실행) |

## 8. 후속 트리거

- 제3의 표면(TUI·웹) 추가 → 토큰 공유 JSON + 코드젠 승격(결정 §4).
- 라이트 테마 → role 구조 불변, hex 매핑만 교체.
- 본 사양 개정 → `design-language.md` DP lane 접수 → 결정 문서 갱신 → 이 문서 반영.
