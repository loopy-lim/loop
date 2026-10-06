# React Doctor 점검 — loop-mobile (디자인 마이그레이션 후)

- 실행일: 마이그레이션 작업(design-migration) 직후
- 명령: `npx -y react-doctor@latest apps/loop-mobile --verbose`
- 원본 출력: `docs/design/audits/react-doctor-report.txt`
- 대상: 109 files scanned

## 점수 요약

| 항목 | 값 |
| --- | --- |
| 총점 | **47 / 100 (Critical)** |
| 전체 진단 | 153건 |
| Bugs | **6 errors**, 130 warnings |
| Correctness | 1 warning |
| Maintainability | 9 warnings |
| Performance | 7 warnings |

## error 등급(✖) 진단과 수정 권고

코드 수정은 본 작업 범위 밖이므로 아래를 후속 수정 권고로 남긴다.

### 1. `eslint/no-unused-vars` — src/App.tsx:33

- 사용하지 않는 변수. 제거 또는 사용 경로 정리 권고.

### 2. `react-doctor/rn-no-deprecated-modules` — src/features/markdown-view.tsx:8

- react-native 코어에서 제거된 모듈 import. 커뮤니티 패키지 또는 자체 구현으로 대체 권고.

### 3. `react-doctor/no-ref-current-in-render` — src/screens/ConversationScreen.tsx:179

- 렌더 중 ref 변경. ref 쓰기를 effect나 이벤트 핸들러로 이동 권고.

### 4. `react-doctor/effect-needs-cleanup` — src/screens/ConversationScreen.tsx:209

- effect의 구독/타이머 미정리. cleanup 함수 반환 권고.

### 5. `react-doctor/rn-no-scroll-state` ×2 — src/screens/ConversationScreen.tsx:318, src/screens/PaneScreen.tsx:103

- onScroll 핸들러 내 setState로 스크롤마다 리렌더 유발. `onScroll` 값은 Animated/Reanimated 값 또는 ref로 보관하고, 화면 갱신이 꼭 필요하면 throttle/rAF로 제한 권고.

## 주요 warning 군집 (참고)

- `typescript/no-non-null-assertion` ×105 — 대부분 test 파일, 일부 `src/features/syntax.ts`, `src/gateway-client/sse.ts`
- `react-doctor/no-array-index-as-key` ×12 — `src/features/file-viewer.tsx`, `src/features/markdown-view.tsx`
- 거대 컴포넌트 ×2 — `src/App.tsx:61`, `src/screens/ConversationScreen.tsx:98`
- 리스트 렌더 최적화 — `file-viewer.tsx` inline renderItem/handler, `ConversationScreen.tsx:636` ScrollView 내 mapped list
- 지연 초기화 — `rerender-lazy-state-init` / `rerender-lazy-ref-init` (file-viewer, viewer-sheet, QRScannerScreen, motion)
- `eslint/prefer-const` ×4 — `test/resilience.test.ts`

## 결론

- 마이그레이션 자체로 인한 신규 error는 확인되지 않음. error 6건은 기존 화면 로직(App, ConversationScreen, PaneScreen, markdown-view)에 있는 항목.
- 점수 47점은 주로 warning 군집(no-non-null-assertion, array-index-key, 리스트 최적화)이 끌어내림. error 6건 우선 수정 시 점수 개선 선행 조건.
