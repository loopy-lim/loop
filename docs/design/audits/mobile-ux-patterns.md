# 모바일 UX 패턴 인벤토리 — 스와이프 액션 · 뒤로 제스처 · 사이드 메뉴

- **태스크:** `mobile-ux-patterns` (implementation, attempt 0)
- **작성일:** 2026-10-06
- **근거:** 승인된 방향 A "Quiet Accent"(`redesign-brief.md` §5.0) + iOS HIG(행 스와이프 액션, interactive pop, 탭 바/시트 관행)
- **증거:** `apps/loop-mobile/test/mobile-ux-patterns.test.ts` (23 gates) — 제스처 **결정 계층은 순수 모듈**(`src/features/{row-swipe,back-swipe,side-menu}.ts`, react-native 미임포트)로 분리되어 기기 없이 핀되고, **배선 계층은 소스 검사**로 핀된다(테스트 런타임에 RN이 로드되지 않는 기존 규칙). 전체 스위트 456 pass / 0 fail, `bunx tsc --noEmit` 통과.

---

## 1. 패턴 인벤토리 (화면 · 위치 · 이유)

| # | 패턴 | 화면 | 위치 | 이유 (HIG/브리프 근거) | 결정 계층 | 계약 테스트 |
| --- | --- | --- | --- | --- | --- | --- |
| P-1 | **행 스와이프 액션 — Open 공개** | 채팅 홈 (런 행) | 행 우측 뒤 88pt 스트립(44pt × 2 터치 플로어), 좌드래그로 공개 | iOS HIG 행 액션 관행. 행이 소유한 동사는 **열기 하나뿐** — 모바일 클라이언트 계약에 취소/삭제면이 없으므로 파괴적 동사를 발명하지 않는다(정직 §7). 왼쪽 플링 커밋=Mail식 full-swipe 빠른 열기 | `features/row-swipe.ts` | "row swipe — the decision layer" 3건 + "the wiring" 4건 |
| P-2 | **행 스와이프 액션 — 세션 행 동일 계약** | 채팅 홈 (세션 행) | P-1과 동일 스트립 | 런/세션 행이 같은 어휘를 공유해야 목적지 모델이 서린다(brief §4 교훈: 같은 형태는 같은 의미) | `features/row-swipe.ts` | "run rows and session rows render through SwipeableRow" |
| P-3 | **당겨서 새로고침 (유지·핀)** | 채팅 홈 (리스트) | ScrollView RefreshControl | 기존 C13 배선 유지 — 스와이프 도입이 새 로딩 상태를 만들지 않았다 | — (기존) | "pull-to-refresh stays wired on the chats list (C13)" |
| P-4 | **엣지 뒤로 스와이프 (interactive pop)** | 대화 화면 | 좌측 24pt 엣지 밴드에서 시작한 우드래그만 클레임; 커밋=폭 ~30%(좁은 화면 96pt 플로어) 또는 우플링 ≥56pt | 내비가 JS 소유라 시스템 pop 제스처가 없다 — 이 존이 pop 제스처다. 헤더 셰브론의 `onBack`과 **같은 핸들러** 발화(한 동사, 두 경로 — brief §4 흡수 원칙) | `features/back-swipe.ts` | "edge-back — the decision layer" 4건 + "the wiring" 3건 |
| P-5 | **엣지 뒤로 스와이프 — raw 터미널** | 터미널 상세 (PaneScreen) | P-4와 동일 존 | 상세면 전체에 같은 탈출 제스처 — 화면별 학습 분산 금지 | `features/back-swipe.ts` | "the raw pane surface rides the zone in App" |
| P-6 | **햄버거 → 사이드 메뉴(드로어)** | 채팅 홈·대화·터미널 헤더 | 헤더 우측 코너 `☰` (44pt 플로어, 로그아웃 아이콘과 같은 문법) | 상세면은 탭 바가 숨는다 — 대화 안에서 Settings/Files로 가는 유일한 경로가 이 메뉴다(드로어의 존재 이유). **탭 표면(Files·Settings)에는 두지 않았다** — 탭 바가 보이는 화면에서 중복 제어는 §1 위반(하는 일 없는 컨트롤 금지) | `features/side-menu.ts` | "side menu — the model" 4건 + "the wiring" 5건 |
| P-7 | **드로어 목적지 행 = 탭 바 3키 동일 집합** | 드로어 패널 | 좌측 패널(폭 78%), 활성 목적지=accent+accentSoft | 드로어는 같은 3 목적지의 **제2 접근 경로**지 제3 목적지가 아니다(canon §3 내비 어휘 단일성). 글리프는 등록 어휘(⌂ ▭ ⚙)에서만 | `features/side-menu.ts` DRAWER_ITEMS | "the destination set is exactly the tab bar's three keys, in order" |
| P-8 | **드로어 닫기 제스처 + 스크림 탭** | 드로어 패널/스크림 | 좌드래그(폭 25% 또는 플링 ≥24pt @800)·스크림 탭·행 선택 | HIG 시트 닫기 관행. 패널이 화면을 덮지 않아(78%) 레이어로 읽힌다 | `features/side-menu.ts` | "drag-left past a quarter width closes; a fling closes; drift stays" |
| P-9 | **드로어 푸터 게이트웨이 라인** | 드로어 패널 하단 | 캡션 1줄(host:port, §B 표시 행 에코) | 보조 컨텍스트 — 작업 spawn 전 오퍼레이터가 확인하는 연결 대상. bearer는 절대 렌더링하지 않는다 | — | "the drawer footer echoes the gateway line — never the bearer" |

## 2. 제스처 결정 상수 (핀된 계약값)

| 모듈 | 상수 | 값 | 의미 |
| --- | --- | --- | --- |
| row-swipe | `ROW_ACTION_WIDTH` | 88pt | 공개 스트립 폭 = 44pt 터치 플로어 ×2 |
| row-swipe | `ROW_REVEAL_FRACTION` | 0.5 | 액션 폭의 절반을 넘긴 릴리즈 = 공개 의도 |
| row-swipe | `ROW_FLING_VELOCITY` / `ROW_FLING_MIN_DISTANCE` | 600pt/s / 12pt | 플링 커밋(빠른 열기)의 속도/이동 하한 |
| row-swipe | `ROW_RUBBER_BAND` | 0.3 | 경계 초과분 감쇠 — 벽이지 절벽이 아님 |
| back-swipe | `BACK_EDGE_WIDTH` | 24pt | 시작 밴드 — 밖에서 시작한 터치는 수학 전에 취소 |
| back-swipe | `BACK_COMMIT_FRACTION` / `BACK_COMMIT_MIN_DISTANCE` | 0.3 / 96pt | 커밋 거리(비율 + 좁은 화면 플로어) |
| back-swipe | `BACK_FLING_VELOCITY` / `BACK_FLING_MIN_DISTANCE` | 900pt/s / 56pt | 근거리 플링 커밋 하한 — 흔들플링은 사고 |
| side-menu | `DRAWER_WIDTH_FRACTION` | 0.78 | 패널이 화면을 덮지 않아 레이어로 읽힌다 |
| side-menu | `DRAWER_CLOSE_FRACTION` / `DRAWER_FLING_VELOCITY` / `MIN` | 0.25 / 800pt/s / 24pt | 닫기 드래그/플링 임계 |

공통 원칙: **모든 플링 커밋에는 최소 이동량이 있다**(센서가 속도를 줘도 멈춘 탭 릴리즈는 제스처가 아니다). 수평 팬은 `|dx| > |dy|` 게이트로만 클레임 — 수직 스크롤·당겨서 새로고침·컴포저를 훔치지 않는다.

## 3. 설계 판정 (대안과 근거)

1. **행 액션을 "Open" 하나로 한정** — 대안: 취소/삭제 액션 추가. 기각: 게이트웨이 클라이언트 표면에 취소/삭제 호출이 없고, 계약에 없는 동사를 UI가 발명하면 상태가 거짓말을 한다(ui-ux-guidance §7 정직 원칙). 액션 신설은 클라이언트 계약 확장 태스크에서 한다.
2. **엣지 백을 RN 네이티브가 아닌 자체 PanResponder로** — 대안: react-native-gesture-handler/stack 내비 의존 신설. 기각: 앱은 이미 자체 화면 전환(헤더 셰브론)을 소유하고 새 네이티브 의존은 앱 수준 결정이라 이 태스크 범위를 넘는다. 결정 수학을 순수 모듈로 분리해 기기 없이 계약 핀 가능.
3. **드로어를 햄버거 전용 개폐로** — 대안: 좌 엣지 드래그로도 열기. 기각: 좌 엣지는 뒤로 제스처의 밴드다(P-4) — 같은 밴드에 두 제스처를 얹으면 상세 화면에서 충돌한다. 열기는 헤더 버튼 하나로 충분(발견 가능성은 관행 위치가 담당).
4. **탭 표면(Files·Settings)에 햄버거 미배치** — 탭 바가 보이는 화면에서 드로어는 중복 제어(§1: 하는 일 없는 컨트롤 금지). 채팅 홈에는 둔다: 로그아웃 옆 보조 허브 + 명시 요구 위치.
5. **애니메이션 미사용, 릴리즈 즉시 스냅** — viewer-sheet 선례(design-spec AC-S6-2: RN Animated는 ui/motion.tsx 전용). 드래그 중엔 1:1 트랙으로 손 따라감.

## 4. 토큰·어휘 정합

- 호출부 hex 0건 — 스트립 `accentSoft`+`accent`(캐논 §4 등록 워시 위 역할 참조), 패널 `surface`+`hairline`, 잉크 사다리 역할 참조만. contrast 스위트(456 테스트 중 포함)가 기존 게이트를 유지.
- 신설 글리프 1개: `glyph.menu = "☰"` — `ui/glyphs.ts` 등록 어휘 안에서만(기존 확장 경로).
- 신설 카피 1개: `ROW_OPEN_ACTION_LABEL = "Open"` — `ui/copy.ts` 소유 상수(§7).
- 신설 TouchableOpacity 전부 `activeOpacity={press.activeOpacity}` — ergonomics 스위트의 전역 카운트 균형 게이트가 그대로 통과한다.

## 5. 변경 파일

| 파일 | 변경 |
| --- | --- |
| `src/features/row-swipe.ts` | 신설 — 행 스와이프 결정 수학(순수) |
| `src/features/back-swipe.ts` | 신설 — 엣지 백 결정 수학(순수) |
| `src/features/side-menu.ts` | 신설 — 드로어 모델+닫기 수학(순수) |
| `src/ui/SwipeableRow.tsx` | 신설 — 행 스와이프 프레젠테이션 |
| `src/ui/BackSwipeZone.tsx` | 신설 — 엣지 백 프레젠테이션 |
| `src/ui/DrawerMenu.tsx` | 신설 — 사이드 시트 프레젠테이션 |
| `src/ui/glyphs.ts` | `menu` 글리프 등록 |
| `src/ui/copy.ts` | `ROW_OPEN_ACTION_LABEL` 등록 |
| `src/features/run-list.tsx` | 런/세션 행을 SwipeableRow로 감쌈 |
| `src/screens/ConversationScreen.tsx` | BackSwipeZone 랩 + 헤더 햄버거(`onOpenMenu`) |
| `src/App.tsx` | 드로어 상태·오버레이, 햄버거 버튼, pane BackSwipeZone, 게이트웨이 라인 |
| `test/mobile-ux-patterns.test.ts` | 신설 — 23 게이트 계약 스위트 |
| `test/logout-placement.test.ts` | 헤더 코너 구성 변경 반영(로그아웃 아이콘 유지 단언 + 햄버거 공존 단언) |

## 6. 한계

- 제스처 임계값은 HIG 관행 문헌과 자사 시트 정책(bottom-sheet.ts) 정합 기준의 핀값이며 실기기 터치 재원(엄지 아크·오작동율) 계측은 없다 — 시뮬레이터 캡처(v8 이후) 검증 대상.
- DrawerMenu 패널 트랜스레이트는 state 구동(뷰어 시트 선례) — 대형 드로어에서 프레임 드랍이 관측되면 Animated 이관은 motion.tsx 예산 안에서 별도 판단.
- 스와이프 액션·뒤로 제스처의 VoiceOver 경로는 각각 행 탭·헤더 셰브론이 동일 기능을 커버한다(제스처는 보조 경로) — 접근성 회귀 없음.
