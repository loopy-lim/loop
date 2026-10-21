# 감사 — herdr 앱 네이티브 느낌 (native-motion pass)

- **일자:** 2026-10-21
- **계기:** 사용자 판정 — "지금 앱으로 herdr을 돌리게 했는데, native의 느낌이 전혀 없다"
- **대상:** `apps/loop-mobile` (재구축 v2 위 패스)
- **상태:** 시행 완료 (P0·P1 전부 반영, 시뮬레이터 라이브 검증 병행)

## 1. 감사 결과 — 왜 웹뷰처럼 읽혔나

| # | 등급 | 문제 | 위치(당시) |
| --- | --- | --- | --- |
| 1 | P0 | push/pop 전환 애니메이션 전무 — 라우트가 즉시 스왑 | `app/Shell.tsx` 조건부 렌더 |
| 2 | P0 | 엣지 뒤로 제스처의 연속성 부재 — 커밋 시 스냅(텔레포트), 취소도 즉시 스냅, setState 기반 드래그 | `ui/BackSwipeZone.tsx` |
| 3 | P0 | 탭 전환 시 상태 소실 — 탭 루트 unmount + 스택 리셋 | `Shell` + `app/router.ts` |
| 4 | P0 | 햅틱 0개 | 전면 |
| 5 | P0 | "작업 중" 상태가 정적 — 실시간 앱의 생동감 신호 부재 | `design/primitives.tsx` StatusPill |
| 6 | P1 | RefreshControl 스피너가 다크 배경에서 무표시 | `HerdScreen` |
| 7 | P1 | 세그먼트(대화\|터미널) 슬라이딩 썸 없음 | `AgentScreen` |
| 8 | P1 | 대화형 키보드 내림(interactive dismiss) 없음 | 트랜스크립트 ScrollView |
| 9 | P1 | iOS return 키 전송 불가(멀티라인 TextInput) | 컴포저 |
| 10 | P1 | FAB 눌림 스케일·그림자 부재 | `HerdScreen` |

## 2. 기존 결정과의 충돌 — 명시적 개정

- `design-spec` AC-S6-2("react-native motion mechanisms stay owned by ui/motion.tsx")는 **소유권 규칙**이지 금지가 아니다. 그러나 리빌드에서 `ui/motion.tsx`가 삭제되어 사실상 전면 무애니메이션이었고, `BackSwipeZone` 주석은 이를 "settles directly on release(무애니메이션)"로 해석하고 있었다.
- 본 패스는 그 해석을 **사용자 지시로 개정**한다: motion은 `ui/motion.tsx`(문자상 AC-S6-2 준수)에서만 만들고, 전환·제스처·햅틱으로 네이티브 연속성을 회복한다. AC-S6-2 게이트는 변경 없이 그대로 통과한다.

## 3. 시행 내용

### 구조

- **`ui/motion.tsx` 재생성** — 유일한 `Animated` 소유 지점(AC-S6-2): `AnimatedView`, `useMotionValue`/`createMotionValue`, `animateTo`(native driver timing), `springTo`, `easing.enter/exit`, `PressableScale`, `PulseDot`, `layeredTranslate`(self+above 두 경계의 translateX 합성), `layeredDim`.
- **`ui/ScreenStack.tsx` 신설** — UINavigationController 대위. 화면마다 경계 값 1개(`bounds[i]`: 1=커버, 0=오프스크린). 각 화면의 translate는 **자기 슬라이드(bounds[i]) + 위 화면 패럴랙스(bounds[i+1])** 두 항의 합이라 push/pop/제스처가 같은 값을 구동하고 절대 어긋나지 않는다. 제스처는 최상단 경계를 직접 구동하고, 커밋 시 같은 경계가 이어져 나간다(손가락 위치에서 출발하는 완결성 — 구 BackSwipeZone의 스냅 문제 해소). 뒤로 수학은 기존 `ui/back-swipe.ts`(순수)를 재사용 + `gestureProgress/topOffset/behindOffset/BEHIND_PARALLAX/BEHIND_DIM` 확장.
- **`app/router.ts` 개정** — 탭별 스택 보존(`stacks: Record<TabName, Route[]>`), `switchTab`은 스택을 지우지 않는다(iOS 탭 컨트롤러 계약). 순수 상태기계·단위 테스트 유지·확장.
- **`app/Shell.tsx`** — 탭 루트 3개 상시 마운트(숨김 = opacity 0 + pointerEvents none + a11y 숨김) → 스크롤·컴포저·스택이 탭 전환에 보존. 탭별 ScreenStack. 탭 전환·push에 햅틱.

### 표면

- StatusPill working 도트 = `PulseDot`(조용한 opacity pulse, 토큰 `motion.pulse` 계열).
- `NativeRefresh`(RefreshControl 토큰 착색) — 다크 배경에서 스피너 가시.
- 세그먼트 썸 슬라이드(onLayout 측정 기반 translate, 토큰 준수), `keyboardDismissMode="interactive"`, Enter 전송, 전송 성공 햅틱, FAB = `PressableScale` + `elevation.float`.
- `ui/haptics.ts` — `react-native-haptic-feedback` 지연 로딩 래퍼(네이티브 부재 시 무음 폴백; bun test 안전).
- 삭제: `ui/BackSwipeZone.tsx`, `back-swipe.ts`의 `backDragTranslate`.

### 시행 중 발견·수정 (레이아웃 회귀)

1. 탭 루트를 absoluteFill로 바꾸며 스테이지 컨테이너 누락 → 탭 바가 화면 상단에 렌더 → `stage`(flex:1)로 재분리.
2. ScreenStack 루트 `flex:1` → 탭 콘텐츠와 세로 절반 분할(푸시 화면이 하단 반만 커버) → 루트를 absoluteFill로.
3. absoluteFill 루트가 행 터치를 가로챔 → `pointerEvents="box-none"`(레이어만 터치, 팬은 레이어 경유 협상).
4. FAB `bottom` 앵커 분실(스테이지 재분리 때) → `bottom: space.l` 복원.
5. **제스처 값 의미 반전** — 경계(1=커버)에 손가락 진행도(0→1)를 직접 대입해 드래그 즉시 화면이 튕겨 나가고, 취소 분기도 0(오프스크린)으로 스프링해 "레이어 소실 + 라우트 잔존(탭 바 부재)" 상태를 만들었다 → `setValue(1 - gestureProgress)`·취소 스프링 target 1로 수정.

### 검증

- `bun test apps/loop-mobile` 162 pass(라우터 탭별 스택·전환 보간 신규 계약 포함), `tsc` 클린, `tests/architecture-boundaries` 8 pass(레이어 그래프·AC-S6-2 유지).
- 시뮬레이터 라이브(실게이트웨이 ↔ 실 herdr 0.9.5/protocol 22): 키체인 자동 복구, Herd 실시간 목록(작업 중/완료 전환), Panes 트리, push 전환(상세 전체 렌더: 헤더·세그먼트·상태 pill·ANSI 트랜스크립트), 버튼 pop 후 탭 바·FAB 복귀(픽셀 스캔 대비 0.76% 기준선 일치).
- 잔여(수기 확인): 엣지 스와이프의 손가락 추종 감각은 합성 이벤트(cliclick)가 RN PanResponder 클레임에 불안정하여 기기에서 확인 요망. 로직은 순수 수학 테스트로 고정.

### 도구 메모 (시뮬레이터 좌표 구동)

Simulator 창은 세션 중 이동한다. 매 클릭마다 `osascript`(front window position)으로 재독해야 하고, 장치 좌표 = 창 원점 + (베젤 ~27pt, 타이틀+베젤 ~84pt), 배율 1:1(논리 pt). 캡처 비교는 `sips`→BMP 픽셀 스캔(탭 바 좌측 60% 밝은 픽셀 비율, 정상 기준선 0.76%)이 비전 추정보다 신뢰된다.
