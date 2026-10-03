# UI 재설계 최종 검증 — `ui-final-verification`

- **일시:** 2026-09-26 · **검증자:** verification worker (`ui-final-verification`)
- **범위:** apps/loop-mobile SafeArea + Codex 스타일 재설계의 최종 수용 검증
- **결론: PASS** — 아래 기준별 근거 참조. 변경 파일 없음(쓰기 범위 = 본 문서뿐).

## 기준별 판정

### 1. 전체 화면 SafeArea insets 적용 — PASS (코드 증거)

`react-native-safe-area-context` 5.10.0 (`apps/loop-mobile/package.json`, `ios/Podfile.lock:1751`) 도입 확인. 앱의 4개 화면 상태가 전부 소비 경로를 가진다:

| 화면 | 경로 | 증거 |
| --- | --- | --- |
| 모든 화면(루트) | `SafeAreaProvider` | `src/App.tsx:51` |
| ConnectScreen / SubmitScreen / PaneScreen | 공용 `Screen`이 top/left/right 패딩 + bottom 스크롤 패딩 | `src/App.tsx:55,65,81` → `src/ui/Screen.tsx:25-36` |
| ConversationScreen | 자체 레이아웃에서 직접 소비: 헤더 `insets.top`, 가로 노치 `insets.left/right`, 컴포저 `max(insets.bottom, space.s)` | `src/screens/ConversationScreen.tsx:186,378-380,480` |
| 키보드 표시 중 | 컴포저가 bottom inset을 0으로 양도(iOS KAV 이중 간격 방지) | `src/ui/useKeyboardVisible.ts:7-9`, `ConversationScreen.tsx:480` |

운영자가 지적한 "safe-area 처리 0건" 상태는 해소 — `rg "SafeArea|useSafeAreaInsets"` 결과가 App/Screen/ConversationScreen 3개 파일에 걸쳐 존재하며 Screen 미래경로인 화면은 0개.

### 2. Codex 유사 디자인 — PASS (코드 + 의존 워커 증거)

`docs/design/ui-ux-guidance.md`(awesome-design-md corpus 증류)의 규율과 대조:

- **중앙 정렬 콘텐츠 컬럼:** `COLUMN_MAX_WIDTH = 480` (`Screen.tsx:29`, ConversationScreen 공유) — §2 위계/스캔성.
- **다크 컬러 토큰:** `src/ui/tokens.ts` — bg `#0D1117`, 잉크 3단, 상태 삼종(ok/warn/danger)은 글리프·텍스트 액센트로만 (§4/§5), 호출점 hex 금지.
- **타이포·간격 스케일:** display 26/32·700, title 17/24·600, body 15/22, caption 12/17, mono 12/18, 4pt 간격 그리드.
- **말풍선/툴 카드/steer 마커:** 사용자 버블(우측)/어시스턴트(좌측) 구분, 접을 수 있는 툴 카드에 상태 아이콘 `◐ ✓ ✕`(`TOOL_STATUS`, `ConversationScreen.tsx:56-108`), steer 마커 `↳ steer · {status}`(`:147-151`).
- **글리프 폐쇄 어휘:** `src/ui/glyphs.ts` — 역할당 단일 코드포인트(§6).

### 3. 기존 테스트·steer 플로우 무변화 — PASS

- 전체 검사(아래 §4)에서 steer 관련 기존 테스트 전부 통과: `SteerRelaySession`(3건), turn-boundary steer injection M-TL2(3건), worker capability gating M-TL3, `packages/orchestrator/test/steer-delivery.test.ts` 포함 508 pass / 0 fail.
- 모바일 steer 계약 유지: `gateway/client.ts:366` `steerRun` → `POST /v1/runs/{runId}/steer` (미재시도), `steer_queued` 프레임 → `source=steer` 사용자 메시지 확인의 3단 피드백(D4 §4) — 재설계는 렌더링 계층만 건드림.

### 4. v5 스크린샷 증거 — PASS (직접 의존 워커 검증 수용)

- `docs/research/simulator-showcase/v5/` 8장 + `evidence.md` 존재(의존 워커 `showcase-v5-screens` 완료 조건 2건 PASS).
- **한계 명시:** 본 세션의 모델은 이미지 입력을 지원하지 않아 8장을 재열람하지 못했다. 따라서 시각적 판정은 의존 워커의 전 장 육안 재검증 보고(상태바-제목 분리, 홈 인디케이터 위 컴포저 여백, 가로 노치 회피, 키보드 부착, steer 마커 렌더링)를 **증거로 수용**하고, 코드 증거(§1)와 교차 확인했다. 유료 모델 호출 0, 데모 게이트웨이(루프백 `demo-*`)만 사용 — evidence.md 재실행 절차로 재현 가능.

### 5. 전체 저장소 검사·경계 — PASS

`bun run check` (cwd 루트, ~600s 제한 내 완료):

```
$ bun run codegen:check && bun run typecheck && bun run test:architecture && bun run test
codegen:check — 통과(생성물 무변경)
tsc -p tsconfig.json — 통과
tests/architecture-boundaries.test.ts: Ran 6 tests — 6 pass, 0 fail
cargo test --workspace — 모든 "test result:" 라인 0 failed (grep 검증)
bun test: 508 pass / 0 fail / 2297 expect() across 62 files
```

`grep -c "test result: FAILED"` = 0, `(fail)` 라인 0. 계층 경계 테스트(architecture-boundaries 6건) 통과로 의존성 방향(loop-core → loop-store → loop-bridge → protocol → orchestrator) 변경 없음.

## 검사 실행 목록

| 검사 | 결과 |
| --- | --- |
| `bun run check` (codegen:check + typecheck + architecture + cargo test + bun test) | PASS |
| `rg` SafeArea 사용 검색 (apps/loop-mobile) | 화면 전체 커버 확인 |
| v5 스크린샷 존재 + 의존 워커 육안 검증 보고 | PASS |
| steer 테스트 통과 확인 (cargo + bun 로그 grep) | PASS |

## 변경 파일

- `docs/findings/ui-redesign-verification.md` (신규, 본 문서) — 이외 변경 없음.

## 미해결 리스크

1. **이미지 육안 재검증 불가(이 세션 한계):** 시각적 수용은 의존 워커 보고에 의존했다. 운영자 최종 승인 시 v5 PNG 8장 직접 열람 권장.
2. **가로 캡처(07)** 는 `simctl io screenshot` 회전 버퍼 한계로 Simulator 창의 Mac 화면 캡처로 대체됨(evidence.md 명시) — 실기기 회전 재확인은 별도 과제.
3. **이미지 첨부는 M2 미착속** — 데모 스트림 기준 카드 상태만 화면으로 확인됨. 실 pi 세션 재현은 유료 호출이 수반되므로 운영자 승인 절차 별도.
4. 브랜치 작업물 전체가 커밋 전 상태(`git status` 다수 변경) — 본 검증은 워킹 트리 기준이며 커밋 후 재검사 불요(체크는 트리 내용 기준).
