# loop-mobile 디자인 전면 감사 + 마이그레이션 계획 (full audit + migration plan)

- **기준 문서:** [`docs/design/design-system.md`](../design-system.md) (canonical), [`docs/design/ui-ux-guidance.md`](../ui-ux-guidance.md) §9 15항목 체크리스트
- **심사 범위:** `apps/loop-mobile/src` 전체(화면 8 + UI/피처 컴포넌트 10 + App 배선), 이번에 추가된 attention 답변 제출 UI(`RunScreen` resolution input + Submit response) 포함
- **심사 방법:** (1) 기계 드리프트 grep — 호출점 hex/rgba, 폰트 크기 리터럴, 간격 산술, 모션 메커니즘 import 경로, 등록 밖 타이머 (2) 소스 직독 — 화면별 §9 체크리스트 15항목 대조
- **기준 증거:** `bun test apps/loop-mobile/test` — 429 pass / 0 fail (감사 시점, 기존 강제 게이트 AC-S3/S5/S6/M1/M2 전부 통과)
- **작성일:** 2026-02-03 (task `design-audit`)

---

## 1. 기계 드리프트 점검 (drift greps)

| # | 드리프트 그립 | 대상 | 결과 | 판정 |
| --- | --- | --- | --- | --- |
| G-1 | 호출점 hex/rgba 리터럴 (§6-1, §2 역할 이름 참조) | `src/**` (`ui/tokens.ts` 제외) | **0건** | 준수 |
| G-2 | `fontSize:` 리터럴 숫자 (§3 리터럴 px font-size 금지) | `src/**` (tokens 제외) | 토큰 경유 외 0건 — 단, **계산형 우회 4건** (`file-viewer.tsx` `fontSize: size` / `base` / `Math.max(11, base-2)` / `Math.max(11, base-3)`) | **위반 (F-1)** |
| G-3 | 간격 산술 (§3 허용 집합 {2,4,8,12,16,24,32}∪{0,auto}) | `src/**` | `space.s + space.xxs` (=10, 집합 밖) **4건**: `conversation-timeline.tsx:309,360`, `composer.tsx:182`, `ConversationScreen.tsx:836` | **위반 (F-2)** |
| G-4 | 등록 밖 모션 메커니즘 (§5 — `Animated`/`LayoutAnimation` import, 등록 밖 주기 타이머) | `src/**` | `Animated`/`LayoutAnimation`는 `ui/motion.tsx` 단일 소비면만 (AC-S6-2 통과). 단 **`markdown-view.tsx:74` 1500ms copied-되돌림 타이머**는 등록 4종 밖 시간 메커니즘 | **경계 (F-3)** |
| G-5 | 그림자 등록 밖 소비 (§3 — `elevation.float` 1종만) | `src/**` | `elevation.float` 소비 1건 (`ConversationScreen` jumpPill), `elevation.card` 0건 (AC-S5-1 통과) | 준수 |
| G-6 | 반경 스케일 밖 (§3 radius 폐쇄 집합) | `src/**` | `borderRadius: 999` 리터럴 1건 (`spawn-card.tsx:143` — `radius.pill`과 동치지만 어휘 밖 인용) | **위반-경미 (F-4)** |
| G-7 | 상태 삼색(ok/warn/danger) 폐쇄 소비 (§2-2, §4-2) | 화면 전체 | 삼색은 glyph+텍스트 액센트 한정, 표면 채움 0건, `runStatusColor`/`TOOL_STATUS` 폐쇄 매핑 경유 | 준수 |
| G-8 | 강조 예산 — viewport당 `cta` 반전 1개 (§4-1) | 화면 8종 | Submit 1 / Connect 1 / Settings 1 / Conversation(Send pill) 1 / Run·Pane·QR·Split 0 — 초과 없음 | 준수 |
| G-9 | 어휘 밖 글리프 하드코딩 (§6 — glyphs.ts 경유) | `src/**` | `⚠` (`RunScreen.tsx:182`), `"▭"` (`file-viewer.tsx:98`), `"•  "` (`markdown-view.tsx:136`) | **위반 (F-5)** |
| G-10 | 어휘 밖 letterSpacing (`type` 토큰 밖 tracking 값) | `src/**` | `letterSpacing: 0.6` **5건 중복** (run-list, markdown-view, ConversationScreen, SettingsScreen, RunScreen) — 값은 일관이지만 어휘 밖 | **경계 (F-6)** |

보조 관찰(판정에 포함하지 않는 기하 상수): `COLUMN_MAX_WIDTH 480`, `TERMINAL_*`, `HEADER_BAR_HEIGHT 44`, `FRAME 240`, 썸네일 64·attachment 200×150, `minHeight: 44` 터치 플로어, `insets.bottom + space.*` (기기 inset 결합) — 간격·반경·폰트 스케일이 규율하는 클래스가 아니므로 허용(디스플레이 기하).

## 2. 화면별 판정 요약

| 화면/컴포넌트 | 판정 | 핵심 근거 |
| --- | --- | --- |
| `ConnectScreen` | **경계** | 강조·상태·색 준수. raw `Text`(DynText 미경유) 7건 — 동적 타입 상한(1.3×) 미적용 (F-7) |
| `SubmitScreen` (chats 홈) | **준수** | CTA 1개, spawn 카드·리스트 quiet, 에러 danger 캡션, 상수 문구 경유 |
| `ConversationScreen` | **위반** | 간격 산술 1건(F-2), 인라인 문구 다수(F-8), letterSpacing(F-6). 위계·강조·모션·빈 상태·jump pill은 준수 |
| `RunScreen` (attention 제출 UI 포함) | **위반** | 어휘 밖 `⚠`(F-5), 인라인 문구·섹션 라벨 중복(F-8). attention=warn 글리프+텍스트, 제출 버튼 quiet surface로 CTA 예산 미침 — 준수 |
| `RunSplitScreen` | **준수** | hairline divider 1규칙, files pill quiet, 인라인 라벨 1건(F-8에 흡수) |
| `PaneScreen` | **경계** | 터미널 미러 토큰 경유, deviations-only 메타 준수. raw `Text` 5건(F-7) |
| `SettingsScreen` | **위반** | 뷰어 폰트 사다리 {12,14,15,17,19,22} — 스케일 밖 스텝 14·19 (F-1 연동), letterSpacing(F-6) |
| `QRScannerScreen` | **경계** | 프레임 borderWidth 2 — hairline 1규칙 밖이나 기능 어포던스(§6-1 QR 기능 면제 취지)로 사유 필요(F-9), raw `Text`(F-7) |
| `Composer` | **위반** | 간격 산술 1건(F-2). 44pt 타깃·steer 마크·resend 계약은 준수 |
| `RunsList` | **준수** | 폐쇄 상태 매핑, 비영(非零) 카운트, readout 라벨 — letterSpacing만(F-6) |
| `TimelineItem` | **위반** | 간격 산술 2건(F-2). 삼색 폐쇄·커서 blink·버블 꼬리 radius.xxs 준수 |
| `MarkdownView` | **위반** | 인라인 불릿 글리프(F-5), 1500ms 되돌림 타이머(F-3), letterSpacing(F-6) |
| `FileViewerPane` | **위반** | 계산형 폰트(스케일 밖 11px 플로어)(F-1), 어휘 밖 `▭`(F-5), 인라인 문구(F-8) |
| `ViewerBottomSheet` | **준수** | 무애니메이션 스냅이 어휘 각주로 문서화됨, hairline+radius.l |
| `SpawnSessionCard` | **위반-경미** | `borderRadius: 999` 리터럴(F-4). quiet 2차 액션 강조 준수 |
| `App` (`QuietButton`/`LogoutButton`) | **경계** | 로그아웃 확인 게이트·헤더 코너 배치 준수. raw `Text` 2건(F-7), "Files & reports" 라벨 RunSplitScreen과 중복(F-8) |
| `AppHeader` / `Screen` / `DynText` / `glyphs` / `copy` / `motion` / `terminalLayout` | **준수** | 토큰 경유, 단일 모션 소비면, 헤어라인 단일 규칙, 동적 타입 상한 |

집계: **준수 8 · 경계 5 · 위반 8** (중복 위반은 파일당 1회 집계).

## 3. §9 빠른 체크리스트 15항목 결과

| # | 항목 | 결과 | 비고 |
| --- | --- | --- | --- |
| 1 | 상태 어휘 단일 조회 경로 | **준수** | `glyphs.ts` + `runStatusColor`/`TOOL_STATUS` 폐쇄 매핑 (단 F-5의 3 글리프 예외) |
| 2 | 잦은 상태 최소 신호 / 드문 상태 강한 신호 | **준수** | running=pulse 도트, attention=warn 글리프+텍스트, reconnect만 warn |
| 3 | 근거 없는 상태 발명 금지 | **준수** | 스피너·프로그레스 없음 — `···`/busy 글리프 재사용 |
| 4 | 색·bold보다 배치 먼저 | **준수** | 잉크 3계층+위치로 위계, 색은 마지막 수단 |
| 5 | 첫 훑기에 문제 식별 | **준수** | notices → attention 블록 최상위, 뱃지는 헤더 코너 |
| 6 | 표면별 줄 예산 | **해당 없음(해석)** | 8/6/5/8 예산은 CLI lane 규율 — GUI는 밀도 차이(카드/캡션/본문 계층)로 동일 원리 이행 확인 |
| 7 | 단일 구분 규칙 | **준수** | hairline 1px + 표면 차이, 행별 border 없음 (F-9 QR 프레임만 사유 필요) |
| 8 | 표면당 최강조 1개 | **준수** | G-8 전 화면 통과 |
| 9 | 색이 꺼져도 정보 보존 | **준수** | 모든 상태가 글리프+단어 동반 (C4) |
| 10 | 색만으로 구분 금지 | **준수** | disabled=opacity+잉크 계층, 상태=도트+단어 |
| 11 | 글리프 어휘 상수 경유 | **위반** | F-5: `⚠`/`▭`/`•` 하드코딩 |
| 12 | 문구 상수 소유 + 다음 행동 | **위반** | F-8: PaneList·RunScreen·FileViewer 인라인 문구, "Terminals" 2곳 중복 |
| 13 | overflow 안내 단일 팩토리 | **준수** | `TRUNCATED_NOTICE` 단일 상수, `countsText` 폐쇄 포매터 |
| 14 | 어휘 모듈 경유 표현 변경 | **위반** | F-1/F-2/F-6: 토큰 밖 계산·산술·리터럴 |
| 15 | 신규 어휘는 DP 접수 | **경계** | F-3(1500ms), F-6(tracking 0.6)은 등록 밖 값 — 재결합 불가분은 DP 접수 필요 |

**과목별 요약:** 위반은 전부 §3(폐쇄 스케일)·§6(글리프 어휘)·§7(문구 소유) 집중 — 팔레트·강조·모션·표면 규율은 준수. 시스템의 뼈대(색 역할·강조 예산·모션 등록)는 건재하고, 스케일 말단 재결합 규율에서 드리프트가 누적된 상태다.

## 4. 위반 내역 상세

| ID | 심각도 | 위치 | 내용 |
| --- | --- | --- | --- |
| **F-1** | 높음 | `features/file-viewer.tsx:57-81,182`, `screens/SettingsScreen.tsx:14` (`FONT_STEPS`), `state/settings.ts:18-19` | 뷰어 타입 사다리가 폐쇄 스케일 밖: base {12,14,15,17,19,22}(14·19 비스텝), `Math.max(11, …)` 플로어 11px는 본문 최소 `caption`(12) 하회, `lineHeight: base + 7` 산술. §3 "리터럴 px font-size 금지 — 변수 또는 토큰 경유만" 위반(변수라도 스케일 밖 값 산출) |
| **F-2** | 높음 | `conversation-timeline.tsx:309,360`, `composer.tsx:182`, `ConversationScreen.tsx:836` | `space.s + space.xxs` = 10px — §3 허용 집합 밖 스텝 산술. 기존 grep(AC-S3-2)은 token+token 합을 못 잡는 맹점 |
| **F-3** | 중간 | `features/markdown-view.tsx:62-75` | 코드 복사 확인 라벨 되돌림 1500ms 타이머 — 등록 모션 4종(fold/entrance/blink/pulse) 밖 시간 메커니즘 |
| **F-4** | 낮음 | `features/spawn-card.tsx:143` | `borderRadius: 999` 리터럴 — `radius.pill` 어휘 인용 누락(값 동치) |
| **F-5** | 중간 | `RunScreen.tsx:182` (`⚠`), `file-viewer.tsx:98` (`▭`), `markdown-view.tsx:136` (`•  `) | 어휘 밖 글리프 하드코딩 — §6 "글리프는 어휘 상수 경유" 위반, 포맷터별 재서술 |
| **F-6** | 중간 | 5개 파일 (`run-list.tsx:316` 등) | `letterSpacing: 0.6` 5곳 중복 — 어휘 밖 tracking 값(§2 system-readout 처리의 사실상 미등록 토큰) |
| **F-7** | 중간 | `ConnectScreen`(7), `PaneScreen`(5), `QRScannerScreen`(4), `App.tsx:335,470`(2) | raw RN `Text` 18건 — 공용 `DynText`(동적 타입 상한 1.3×) 미경유. 접근성 텍스트 확대 시 대화면만 상한 적용, 타 화면은 미한clipping 위험 — 표현 경로 이중화 |
| **F-8** | 중간 | `ConversationScreen.tsx:622,738,741,754`, `RunScreen.tsx:170,212,221,231`, `file-viewer.tsx:175`, `App.tsx:410`+`RunSplitScreen.tsx:84` | 인라인/중복 사용자 문구: "Terminals" 2곳, pane 안내 4종, "Waiting for run projection…", "Empty directory.", "Files & reports" 2곳 — §7 상수 소유 위반 |
| **F-9** | 낮음 | `QRScannerScreen.tsx:112` | 스캔 프레임 `borderWidth: 2` — hairline 단일 규칙(§3) 밖. 기능 어포던스로 정당화 가능하나 면제 사유가 문서화되어 있지 않음 |

## 5. 마이그레이션 계획 (토큰 신규 없이 재결합 우선)

원칙: `ui/tokens.ts`의 8단계 타입·7스텝 간격·4반경·팔레트를 **그대로 재결합**해 해소한다. 어휘 모듈(`glyphs.ts`·`copy.ts`)에 항목을 **추가**하는 것은 §9-14가 규정한 정규 표현 변경 경로다(토큰 신규 아님). 불가분 2건만 DP 접수로 남긴다.

| 순서 | 대상 | 재결합 방법 | 비고 |
| --- | --- | --- | --- |
| M-1 (P1) | F-2 간격 산술 4건 | `space.s + space.xxs`(10) → **`space.m`(12)** 로 통일. 버블/툴카드 세로 패딩·jumpPill·uploadBadge 전부 12로 수렴 — 리듬은 카드 패딩(`space.m`)과 일치 | 값 하나 선택, 4파일 치환. 시각 회귀는 showcase 스크린샷으로 확인 |
| M-2 (P1) | F-4 | `borderRadius: 999` → `radius.pill` import 경유 | 기계적 치환 |
| M-3 (P1) | F-5 | `glyphs.ts`에 역할 항목 3개 추가: `attention: "⚠"`, `file: "▭"`, `bullet: "•"` — 호출부는 어휘 상수 인용으로 교체 | §6-1(단일 코드포인트·평면 텍스트) 준수 확인. 어휘 모듈 수정이므로 DP 불요 |
| M-4 (P1) | F-8 | 모든 인라인 문구를 `ui/copy.ts` 상수로 승격: `TERMINALS_HEADING`, `PANE_LOADING_NOTICE`, `NO_PANES_NOTICE`, `LIFECYCLE_ONLY_SUFFIX`, `WAITING_FOR_PROJECTION_NOTICE`, `EMPTY_DIRECTORY_NOTICE`, `FILES_REPORTS_LABEL` — 중복 호출부는 동일 상수 공유 | 문구 값 변경 없음, 소유지만 이동 |
| M-5 (P2) | F-6 | 5곳의 `captionStrong + uppercase + letterSpacing 0.6` readout 스타일을 **하나의 공유 스타일 상수**(예: `ui/tokens.ts`의 파생 스타일 또는 `ui/readout.ts`)로 통합 — 값은 현행 0.6 유지, 중복 제거 | tracking 값 자체의 등록은 불가분 → **DP 접수(아래 D-1)** |
| M-6 (P2) | F-1 | 뷰어 타입 사다리를 기존 스케일로 재결합: 허용 스텝을 {12, 15, 17, 22} + **{24}는 XXL 프리셋 대신 `display`(26) 사용** → `FONT_STEPS = [12, 15, 17, 22, 26]`, 플로어 11 → **12(`type.caption` 크기)**, 코드블록은 `type.mono`(12)로 클램프, `lineHeight`는 각 스텝의 토큰 줄높이 경유 | `state/settings.ts` 클램프와 `SettingsScreen` 스텝, `file-viewer` 렌더를 함께 수정. 사용자 확장성 유지, 어휘는 폐쇄 |
| M-7 (P2) | F-7 | raw `Text` 18건 → `DynText` 경유로 교타입(App·ConnectScreen·PaneScreen·QRScannerScreen) | 렌더 결과 동일, 동적 타입 상한 일원화 |
| M-8 (P3) | F-9 | 스캔 프레임 2px 유지 + `QRScannerScreen` 주석과 본 감사 문서에 **기능 면제 사유 기록**(카메라 미리보기 위 조준 어포던스 — hairline은 불가시) | 또는 1px+`ink`로 시험 후 유지 결정 |
| 보류 | F-3 | 1500ms 되돌림은 기존 4종 모션으로 표현 불가 — **DP 접수(아래 D-2)** 전까지 현행 유지, 본 문서에 gap으로 기록 | corpus §1-5 "없는 상태를 발명하지 않고 gap 문서화" 관행 |

**DP 접수 과제(마이그레이션 후 잔여):**

- **D-1:** readout tracking(`letterSpacing: 0.6`)의 어휘 등록 — `type` 스케일에 readout 파생 항목 편입 여부 (`design-language.md` DP lane).
- **D-2:** 복사 확인 되돌림 지속시간(1500ms)의 모션 어휘 제5종 등록 여부 — 등록되면 `tokens.motion`에 편입하고 `ui/motion.tsx`로 소비면 이동.

**강제 게이트 보강(회귀 방지, 테스트만 추가 — 토큰 신규 없음):**

1. AC-S3-2 grep을 token+token 산술까지 확장: `/space\.[a-z]+\s*[+*]\s*(\d|space\.)/` — F-2 재발 차단.
2. `glyphs.ts` 밖 글리프 리터럴 grep(허용: 어휘 모듈 자체) — F-5 재발 차단.
3. raw `Text` import grep(`screens/`·`App.tsx`) — F-7 재발 차단.

## 6. 검증 방법 (마이그레이션 후)

- `bun test apps/loop-mobile/test` — 기존 429 + 신규 회귀 grep 전부 통과.
- `bun run codegen:check` 및 `bun run test:architecture` — 경계 건드림 없음 확인.
- showcase v6 스크린샷 재캡처로 M-1(버블/카드 패딩 10→12)·M-6(뷰어 폰트 스텝) 시각 회귀 확인.

---

## 부록 A — attention 답변 제출 UI (RunScreen) 개별 판정

이번 감사 범위에 포함된 신규 UI의 디자인 시스템 적합성:

- **강조 예산 §4-1:** `Submit response` 버튼이 `cta` 반전이 아닌 `surface + hairline` quiet 스타일 — 화면의 강한 강조는 0개로 예산 초과 없음. attention 자체가 warn 글리프+텍스트(§4-2 강한 신호)로 최우선 정보가 최상위에 위치(§9-5 준수).
- **상태 삼색 §2-2:** warn은 텍스트 액센트 1줄, 제출 후 `resolvedAttentionId`로 블록 소멸 — 잦은 상태 아님, 강한 신호 허용 범위.
- **접근성:** `accessibilityLabel="Attention response"`·`accessibilityRole="button"`, 44pt-class 터치(패딩 m+캡션) — 준수.
- **발견 위반:** `⚠` 어휘 밖 글리프(F-5), 인라인 문구 없음(placeholder "Your response" — F-8에 추가 승격 권장), 버튼 라벨 busy 문구 "Submitting…" 인라인 — M-4에서 `SUBMITTING_LABEL`로 승격 권장.
