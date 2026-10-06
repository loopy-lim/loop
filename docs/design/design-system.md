# Loop 디자인 시스템 — 최소 절제 사양 (canonical)

- **상태:** canonical — GUI 표면(모바일 RN)의 공식 디자인 시스템 문서
- **승격 근거:** 결정 [`2026-xx-minimal-design-spec.md`](../decisions/2026-xx-minimal-design-spec.md) (2026-09-26 결정됨)
- **기계 검증:** [`docs/findings/minimal-design-verification.md`](../findings/minimal-design-verification.md) — AC-S1~S8 기계 기준 14/14 PASS
- **작성일:** 2026-09-26 · **v2 개정:** 2026-10-06 (방향 A "Quiet Accent" — 아래 개정 이력)

## 개정 이력 (DP lane 기록)

| 버전 | 일자 | 내용 | 근거 |
| --- | --- | --- | --- |
| v1 | 2026-09-26 | 최소 절제 사양 초판 (결정 2026-xx-minimal-design-spec) | ADR |
| v2 | 2026-10-06 | 방향 A "Quiet Accent" 채택 — 팔레트 재매핑(bg 한 단계 심화·잉크 4단·hairline 0.16), **accent/accentSoft/inkGhost 3역할 신설**, 버튼 위계 3층 + pill 반경 한정, 하단 탭 바 등록, 아이콘 어휘 등록, §4 강조 예산 3층화, §6 REMOVE 갱신. 잉크 역할명은 불변, 값 교체 + 3역할 확장으로 이행 | [`audits/redesign-brief.md`](audits/redesign-brief.md) §4(pill 재판정)·§5.0(direction: A, 승인됨) — DP 접수 경유. v1의 폐쇄 집합 원칙은 유지되며, accent는 이 절차를 거쳐 등록된 유일한 신규 강조 계열 색이다 |
| v3 | 2026-10-08 | **아이콘 렌더 체계 개정 + 스폰 FAB 신설.** (1) 아이콘 어휘를 역할 키 폐쇄 레지스트리로 승격 — 각 역할이 SF Symbol(iOS 렌더)과 VS15 고정 텍스트 폴백을 이중 등록하며, iOS는 SF Symbol을 LoopIcon 네이티브 뷰로 렌더링한다. 유니코드 글리프의 이모지 프리젠테이션 렌더링(⚠→색 이모지 변형)은 드리프트로 금지. (2) 채팅 홈의 "New TUI session" 카드를 우하단 "플로팅 액션 버튼(FAB)"으로 교체 — 2차 버튼 티어(표면+헤어라인) + elevation.float 확장, 생성 중·대기·타임아웃 상태는 버튼 위 동반 pill로 유지 | [`audits/fab-icons-brief.md`](audits/fab-icons-brief.md) (task `fab-icons`) — DP 접수 경유. 역할 폐쇄 집합 원칙은 v1/v2와 동일하게 유지되며, 신설은 렌더 경로와 컴포넌트 등록뿐이다 |

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

- 모바일(RN): `tokens.ts`를 직접 import — 호출부 hex/rgba 0건.
- (v2) v1의 데스크톱 DOM 미러와 동등성 테스트는 데스크톱 앱 폐기와 함께 철수됐다. 제3의 표면이 생기면 §8의 코드젠 승격으로 간다.

위반의 이름은 **드리프트**다: 호출점 hex/rgba, 스케일 밖 px, 미등록 모션 타이머는 전부 드리프트이며 테스트가 잡는다.

## 2. 팔레트 — 역할 이름만, 폐쇄 집합

색은 항상 역할 이름으로 참조한다. 값은 테마 매핑일 뿐이고 역할은 불변한다(guidance §5-3). v2 매핑(방향 A "Quiet Accent"): 근흑 캔버스 + 잉크 4단 + 단일 액센트(Linear 라벤더 패밀리의 온다크 변형).

| 역할 | 값 (tokens.ts) | 용도 |
| --- | --- | --- |
| `bg` | `#0B0E13` | 화면 배경 (근흑, GitHub-dark 계열 — 터미널 미러와 같은 색온도) |
| `surface` | `#12161E` | 카드·행·입력·컴포저 |
| `surfaceAlt` | `#181D27` | 카드 내 중첩 표면 — 코드 블록, 펼친 툴 출력 |
| `userBubble` | `#202734` | 사용자 버블 (surface보다 한 단계 밝음) |
| `hairline` | `rgba(242,245,249,0.16)` | **모든** 모서리 분리 (1px) — 0.12→0.16 강화 (C-1) |
| `ink` | `#F2F5F9` | 본문·제목 |
| `inkMute` | `ink 72%` | 보조 텍스트·헬퍼 |
| `inkFaint` | `ink 54%` | 희미한 안내·타임스탬프 — AA 본문 하한(4.5:1) 유지 |
| `inkGhost` **(v2)** | `ink 40%` | **장식 글리프 전용** — 비활성 탭 아이콘·대기 도트. 본문 금지, 비텍스트 3:1 하한(contrast.test.ts 핀) |
| `accent` **(v2)** | `#7C89E8` | **단일 액센트 — 상태색이다.** 활성 탭·선택·포커스 링 전용. 강조(CTA)와 이원화 — §4 |
| `accentSoft` **(v2)** | `accent 16%` | 액센트의 등록 워시 — 선택 배경 전용. 큰 표면 채움 금지 |
| `cta` / `ctaInk` | `#F2F5F9` / `#0B0E13` | **유일한 강한 강조** — 근백색 반전 |
| `ctaDisabled` | `cta 16%` | 비활성 CTA |
| `ok` / `warn` / `danger` | `#3FB950` / `#D29922` / `#F85149` | 상태 삼합 — glyph+텍스트 액센트 전용 |
| `syntax*` (5종) | 현행 유지 | 코드펜스 한정. `plain`은 무색(ink 상속) |

규칙:

1. **무색 잉크 계층이 위계를 먼저 만든다.** 위계 필요 → 위치·간격 → 굵기(ink 계층) → 색은 마지막 수단. 잉크 사다리는 4단(ink→inkMute→inkFaint→inkGhost)이며 각 단은 모든 표면에서 직전 단보다 엄격히 어둡다(테스트 핀).
2. 상태색은 큰 표면 채움 금지 — 행의 한 조각(글리프·단어·얇은 액센트)만. 잦은 상태(ok/대기)는 **도트 하나**로 충분하다 — 목록에서 상태 단어를 반복하는 것은 드리프트다(v2, C-4. 드문 상태 attention/failed만 단어+색을 유지).
3. 색만으로 구분되는 정보 금지 — 색이 꺼져도(그레이·스크린샷 흑백) 동일 정보가 남아야 한다.
4. 접근성 하한: `ink`/`inkMute`/`inkFaint`는 모든 표면 위 WCAG AA(4.5:1), `accent`는 텍스트로 쓰는 표면에서 4.5:1, `inkGhost`·상태 글리프는 비텍스트 3:1로 유지한다(`test/contrast.test.ts`가 강제).
5. **accent는 상태이지 강조가 아니다:** viewport당 화이트 CTA가 여전히 유일한 강한 강조다. accent는 활성·선택·포커스라는 현재 상태만 표시하며, 주목을 끄는 강조로 쓰면 드리프트다.

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

**pill 반경 한정 (v2, pill 재판정 / v3 확장):** pill은 더 이상 버튼 모양이 아니다. 허용처는 전송 **원형 버튼**·**플로팅 액션 버튼**(원형=50%와 동치), **상태 배지**, **시트 핸들** 4가지뿐이다. 일반 버튼·입력·내비에 pill을 쓰면 드리프트다 — 형태가 위계 정보를 가져야 한다(C-6: 형태 남발은 위계를 지운다).

### 표면과 그림자

- 모서리 분리는 `hairline` 1px **하나**. 행별 border(출력 줄마다 선) 금지 — 블록 분리는 표면 차이(surfaceAlt)로.
- 그림자 등록은 `elevation.float` 1종만. 근흑 배경 위 resting 그림자는 읽히지 않는 순수 장식이므로 금지 — 카드는 hairline만. v3: float의 대상은 **스크롤 콘텐츠 위에 떠 있는 요소로 한정**된다 — jump-to-bottom pill, 채팅 홈 스폰 FAB, 그 FAB의 상태 pill(각 뷰포트에 하나의 플로팅 묶음).

### 버튼 위계 (v2 신설, 채움과 형태로 구분한다)

| 층 | 모양 | 용도 |
| --- | --- | --- |
| 1차 | `cta` 필 + `ctaInk` 글자, radius.m | viewport당 1개 — 그 화면의 주 액션 |
| 2차 | `surface` 필 + hairline 테두리, radius.m, inkMute 글자 | 보조 액션 (스캔 입구, 파일 시트 열기). **스폰은 v3에서 FAB로 이동 — 아래 플로팅 액션 버튼 조항** |
| 3차 | 채움 없는 텍스트/글리프, inkMute | 정정 액션(Resend), 셰브론 back |

**플로팅 액션 버튼 (v3 신설):** 채팅 홈의 스폰 진입("New TUI session")은 우하단 원형 FAB(56pt, ≥44pt 터치)다. 위계는 **2차 티어**를 유지한다 — `surface` 필 + hairline + `elevation.float`; 화이트 CTA를 쓰면 Submit과 강조가 이원화되므로 금지(§4). 뷰포트에 FAB는 1개뿐이며, 플로우 상태(생성 중·대기·문제)는 버튼 위 유일한 동반 pill(2차 티어, float)로 인라인 표시한다 — 모달 홉 없음. 생성 중에는 "···" 정적 마크로 상태를 말한다(신설 모션 금지, §5).

공통: 44pt 터치 하한, press.activeOpacity. 입력은 채움(surface)+내부 hairline+**포커스 시 accent 링**(canon §4) — 채움 변화로 포커스를 표현하지 않는다.

### 탐색과 아이콘 (v2 신설)

- **하단 탭 바 3탭**이 유일한 최상위 내비다(Chats·Files·Settings — ui/TabBar). 활성 탭=accent 아이콘+라벨, 비활성=inkGhost 아이콘+inkFaint 라벨, 상단 hairline 1줄. 근거: pill 재판정 — 하단 위치는 엄지 아크상 옳고, 알약 형태는 목적지/액션을 구분 못 해 폐기했다.
- 상세 화면(대화·터미널·스캐너)은 탭 바를 숨기고 헤더 back 셰브론으로 흡수한다 — 하단 액션 알약("Back to chats" 류)은 재도입 금지.
- **아이콘 어휘는 역할 키 폐쇄 레지스트리**이며 ui/glyphs.ts가 단일 소스다(v3 개정). 각 역할은 두 렌더 경로를 등록한다: **iOS = SF Symbol**(ui/Icon → LoopIcon 네이티브 뷰, 토큰 색 틴트) / **비-iOS·인라인 텍스트 플로우 = VS15(U+FE0E) 고정 유니코드 폴백**. 탐색 `⌂ ▭ ⚙`(탭) `‹ ›`(셰브론), 상태 `● ◐ ✓ ✕ ⚠`, 동작 `↑ ⧉ ▣ ✕ ▸ ▾ ↳`, 기타 `⏻ • ··· ▍` + `+`(스폰 FAB). 신규 아이콘은 glyphs 개정(DP 접수)으로만. 아이콘 없는 텍스트 전용 내비·액션 행은 드리프트다(C-5).
- **이모지 프리젠테이션 렌더링 금지 (v3):** 레지스트리 밖의 글리프 렌더, VS16(U+FE0F) 사용, VS15 미고정 이모지 기본 표시 코드포인트(⚠류) — 전부 드리프트다. 뷰 레벨 아이콘은 반드시 ui/Icon을 거르고, 인라인 텍스트 플로우는 `glyph.역할`(파생 뷰, VS15 고정)만 참조한다. 근거: iOS에서 ⚠가 색 이모지 변형으로 렌더링된 v2 결함 — [`audits/fab-icons-brief.md`](audits/fab-icons-brief.md) P-1.

## 4. 색·강조 예산

강조는 화폐다 — 희소할 때만 가치가 있다(guidance §4). v2는 강조를 3층으로 나눈다:

1. **강조 — `cta` 반전, viewport당 1개:** 그 화면의 주 액션만. 새 강조를 추가하려면 기존 강조 하나를 중화할지 먼저 묻는다.
2. **상태 — `accent`, 소면적 자유:** 활성 탭·선택 칩·포커스 링이라는 현재 상태 표시 전용. 강조(주목 끌기)로 쓰면 §2-5 위반이다. accentSoft 워시는 선택 배경으로만.
3. **의미 — 상태 삼합, 의미 있을 때만:** 잦은 상태(ok/대기)는 도트 1개 최소 신호 + 목록에서 단어 반복 금지; 드문 상태(attention/danger)만 단어+색의 강한 신호. attention 인박스·attention 패널의 warn 엣지는 이 조항이 허용하는 유일한 섹션급 warn 노출이다.

**accent 드리프트 금지:** "두 번째 브랜드 색"(다른 indigo, 두 번째 강조색)은 드리프트다. accent는 v2 개정(DP 경유)으로 등록된 유일한 액센트이며, 그 어떤 신규 강조 계열 색도 DP 접수 없이는 추가되지 않는다.

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

1. 토큰 밖 hex/rgba 리터럴 (QR 스캐너 기능색 1건 면제 외 전부 — v2: 데스크톱 미러 면제는 앱 폐기로 소멸)
2. 행별 border-bottom(출력 줄마다 구분선) — 줄 분리는 자연 개행
3. 근흑 배경 위 resting 그림자 (`elevation.card`류) — 카드는 hairline만
4. tokens 밖 hex 복제 (터미널 미러 등)
5. 등록 밖 font-size (7/8px 마이크로 스텝 → `glyph` 토큰 경유만)
6. 스케일 밖 간격(10/18/20px)·반경(6px)
7. **버튼 pill 반경 (v2 신설):** 일반 버튼·입력·내비의 pill은 폐기됐다 — 허용처는 전송 원형·상태 배지·시트 핸들뿐 (§3 pill 한정)
8. **하단 액션 알약 내비 (v2 신설):** "Back to chats" 류의 하단 알약은 폐기됐다 — 목적지는 탭 바, 복귀는 헤더 셰브론 (§3 탐색)
9. **목록의 상태 단어 반복 (v2 신설):** 잦은 상태(running 등)의 단어를 행마다 반복 출력 금지 — 도트만 (§4-3, C-4)
10. accent 외 제3의 강조 색 (v1 #8 계승 정정: accent는 등록됐고, 그 밖의 신규 강조 계열 색은 DP 없이는 없다 — CTA는 `cta`/`ctaInk`만)
11. **이모지 프리젠테이션 렌더링 (v3 신설):** 유니코드 글리프는 VS15 고정 텍스트 프리젠테이션이나 SF Symbol 경유만 허용 — 레지스트리 밖 글리프, VS16, 미고정 ⚠류 코드포인트는 전부 드리프트다 (§3 아이콘)
12. **FAB 복수·CTA화 (v3 신설):** 뷰포트에 플로팅 액션 버튼은 1개, 위계는 2차 티어(surface+hairline) 한정 — 화이트 CTA FAB나 뷰포트당 2개 이상의 플로팅 버튼은 드리프트다 (§3 버튼 위계)

## 7. 회귀 감시 (이 사양의 강제 장치)

| 테스트 | 위치 | 감시 항목 |
| --- | --- | --- |
| 드리프트 grep | `apps/loop-mobile/test/design-spec.test.ts` + CI | 토큰 밖 hex/rgba, 스케 밖 fontSize, 간격 산술, elevation 소비, 모션 import 단일 경로 (§6-1~6) |
| 아이콘 레지스트리 게이트 | `apps/loop-mobile/test/icon-registry.test.ts` | 역할 폐쇄성·VS15 고정(이모지 프리젠테이션 차단, §6-11)·SF Symbol 경로 완결성·FAB 상태 유지·2차 티어 한정 (§6-12) |
| 대비 게이트 | `apps/loop-mobile/test/contrast.test.ts` | 잉크 4단+accent 텍스트 AA 4.5:1, accentSoft 워시 위 accent/ink, inkGhost·상태 글리프 비텍스트 3:1, 잉크 사다리 단차 (§2 규칙 4) |
| 토큰 스케일 | `apps/loop-mobile/test/tokens.test.ts` | 간격/반경/타입/모션 폐쇄성 |
| 실행 방법 | — | `bun test apps/loop-mobile/test` (check 게이트는 apps 미포함 — 별도 실행) |

## 8. 후속 트리거

- 제3의 표면(TUI·웹) 추가 → 토큰 공유 JSON + 코드젠 승격(결정 §4).
- 라이트 테마 → role 구조 불변, hex 매핑만 교체.
- 본 사양 개정 → `design-language.md` DP lane 접수 → 결정 문서 갱신 → 이 문서 반영.
