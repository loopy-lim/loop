# 로그아웃 위치 이동 + 텍스트 위계 정돈 — 검증 (task `logout-showcase-verify`)

**결론: PASS.** 의존 태스크 `logout-relocation-polish`의 결과물을 새로 빌드한 Release
앱에서 재현·촬영하고, 확인 얼럿 경유 로그아웃 플로우를 끝까지(연결 해제 → 수동
Connect 복귀 → 재실행 후에도 로그아웃 유지) 실측했다. 조건: iPhone 17 시뮬레이터
(iOS 26.2, 부팅 1대), demo 게이트웨이(루프백 18589, 가짜 데이터 `demo-*`),
`LOOP_SHOWCASE_*` launch env. **모델 호출 0회, 유료 비용 0, 실기기 없음.**

## 캡처 절차 (재현 가능)

1. `cd apps/loop-mobile && bash scripts/build-ios-simulator.sh` — Release 재빌드 +
   설치 + 런치 (`** BUILD SUCCEEDED **`, 2026-09-27 02:4x).
2. `bun apps/loop-mobile/scripts/demo-gateway.ts 18589 --max-runs=2` 기동 후
   `GET /v1/runs` 200 확인.
3. `SIMCTL_CHILD_LOOP_SHOWCASE_{BEARER,HOST,PORT,CONNECT}` env로 런치 → Chats.
4. 촬영은 `xcrun simctl io <udid> screenshot`, 행 유도는 Simulator 창 좌표
   cliclick 클릭(좌표는 Raw 토글·Back·세션 행 프로브 탭으로 보정·검증).
5. 로그아웃 행 탭 → 얼럿 캡처 → destructive "Log out" 탭 → 수동 Connect 캡처 →
   env 없이 재런치 → 수동 Connect 유지 캡처.

## 컷 구성 (`docs/research/simulator-showcase/review-latest/`)

| 파일 | 상태 | 증명 |
| --- | --- | --- |
| `20-chats-top-no-logout.png` | AFTER | 목록 상단에 고정 로그아웃 없음. CHATS/SESSIONS 위계(섹션 헤더 caption, 행 제목/메타 2단 톤), 메타 간결 카운트(`6m • 1 running`, `42m • 4 done • terminal`) |
| `21-chats-bottom-logout-row.png` | AFTER | 목록 끝의 조용한 Log out 행(텍스트 y≈2046/2622): hairline 위, 홈 인디케이터 여백. **잉크 실측** rgb(130,136,142) — 세션 제목 rgb(230,237,243) 대비 절반 이하 잔잔 톤, hairline rgb(39,44,50) |
| `22-logout-confirm-alert.png` | AFTER (탭) | 행 탭 → 확인 얼럿 "Log out?" + "The saved gateway credential is deleted on this device; the next launch asks you to sign in." + Cancel / **Log out(destructive)** |
| `23-after-logout-connect.png` | AFTER (확정) | destructive 탭 → 수동 Connect 복귀. HOST/PORT 프리필(127.0.0.1/18589), TOKEN 필드 "empty = tokenless" — credential 결정 D2-4 계약 유지 |
| `24-relaunch-stays-logged-out.png` | AFTER (재실행) | launch env 없이 재런치 → **수동 Connect 직행**(자동 복원 없음 = 키체인 삭제 실측) |

비교 BEFORE 컷: `apps/loop-mobile/showcase/logout-hierarchy/before-01-chats.png` —
구 App 고정 pill이 y≈2541/2622(화면 맨 아래 가장자리)에서 마지막 세션 행
("Showcase v8: two-day touchpoint map")과 겹쳐 렌더. AFTER에서 소멸.

## 종단 간 확인 얼럿 경로 (실측 시퀀스)

1. Chats 하단 조용한 행 탭 → `Alert.alert` 얼럿 표시(22 캡처). 파괴 동작 즉시 실행
   없음 — 확인 게이트 존재.
2. "Log out" (destructive) 탭 → 연결 해제 + 수동 Connect 복귀(23).
3. 앱 종료 후 무 env 재런치 → 자동 연결 없음(24) → 저장 credential 삭제 확인.
4. Cancel 경로는 태스크 `logout-relocation-polish`의 `test/logout-placement.test.ts`
   게이트 3(행 onPress는 `Alert.alert` 개봉뿐, 핸들러는 destructive 버튼이 유일한
   호출 경로)이 소스 수준에서 보장.

## 검사 결과

- `bun run check` (codegen:check → typecheck → test:architecture → cargo test
  --workspace + bun test packages/tests/plugins): **전부 통과, 594 pass / 0 fail,
  3971 expect()** (2026-09-27).
- `bun test apps/loop-mobile/test` 278 pass는 의존 태스크 보고(동일 커밋 상태).
- steer/기존 테스트 계약 변경 없음 — 본 태스크는 신규 코드 변경 0건(검증 전용).

## 변경 파일 (본 태스크)

- `docs/research/simulator-showcase/review-latest/20~24-*.png` (신규 5컷)
- `docs/research/simulator-showcase/README.md` (인덱스 1줄)
- `docs/findings/logout-polish-verification.md` (본 문서)

## 미해결 리스크

- 시뮬레이터 창 좌표 클릭 기반이므로 창 크기/디스플레이 배율이 바뀌면 재현 시
  좌표 재보정 필요(본 문서의 프로브 탭 절차로 재보정 가능). 앱 코드 경로 자체는
  실제 터치와 동일한 RN TouchableOpacity/Alert.
- Cancel 탭의 런타임 실측은 없음(소스 게이트 + destructive 실측으로 대신).
- 실기기(H/W 터치, 실 Tailscale 주소) 재확인은 본 태스크 범위 밖.
