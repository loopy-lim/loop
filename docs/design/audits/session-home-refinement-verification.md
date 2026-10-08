# 세션 홈 정리 통합 검증 (2026-10-08)

## 판정 및 근거

| 항목 | 판정 | 증거 |
| --- | --- | --- |
| 전송 수정 | 코드·모의 게이트웨이 검증 통과; 실제 앱에서 실제 게이트웨이로 메시지를 보내는 수동 검증은 미실시 | `src/state/composer.ts`: 세션이 있으면 runId 없이도 `submitSessionInput`, 실행 중이고 runId가 있을 때만 steer. `ConversationScreen.tsx`의 `sendText`/재전송은 동일 경로, 실패 시 draft 유지. `test/composer-retry.test.ts` 세션 입력·실패·재전송 통과. 실제 게이트웨이 curl 202는 서버 경로의 증거일 뿐 앱 전송 성공 증거가 아님. |
| 정렬 | 통과 (단, 세션 상태별 섹션) | `src/state/session-home.ts`: sessionId 내림차순(ULID 생성순), `homeSections`가 live를 맨 위, ended와 unobserved를 분리. `test/session-home.test.ts`의 섹션 및 오래된 ID의 live 사례 통과. |
| ended 캡 | 통과 | `endedWindow` 기본 10건, 나머지는 hiddenCount. `SubmitScreen.tsx`는 접힌 목록을 렌더링. `test/session-home.test.ts` 캡/경계 테스트 통과. |
| 확장 | 통과 (소스 계약 검증) | `SubmitScreen.tsx`: `endedExpanded` 컴포넌트 로컬 상태로 전체 ended 렌더링/접기; 다른 화면 이동 없음. `test/session-home.test.ts` 소스 계약 통과. 실제 299건 화면 조작은 미검증. |

## P0 세션 홈 대조

`SubmitScreen.tsx`에서 inventory → `sessionHomeRows` → `homeSections` → `endedWindow`로 이어지며 live가 먼저 노출된다. P0의 세션 중심 진입 및 이번 정렬·캡 변경은 같은 홈 표면에 연결되어 있다. 다만 기존 `docs/design/audits/dp-session-centric-verification.md`가 기록한 불일치는 남는다: 홈의 `onOpenSession(sessionId)`는 연관 runId를 전달하지 않고, `ConversationScreen.tsx`는 sessionId→runId 역상관을 하지 않는다. 따라서 세션 직접 진입 시 실행 중인 연결 run의 steer/attention 응답 경로가 연결되지 않을 수 있다. 이번 세션 입력 우회는 일반 텍스트 전송 경로를 제공하지만 해당 P1 동작을 검증하거나 대체하지 않는다.

## 체크 및 기동

- `bun run typecheck`: 통과 (`tsc -p tsconfig.json`).
- `bun test apps/loop-mobile/test`: 507 pass, 0 fail (45 files).
- `apps/loop-mobile/scripts/build-ios-simulator.sh`: Release `BUILD SUCCEEDED`, 앱 설치 및 초기 실행. 빌드 기록: `apps/loop-mobile/ios/build/final-build.log`.
- iPhone 17 (UDID `99B087B5-DEF6-4CF1-9177-81A5DE564CFC`, Booted): 재실행 `simctl launch` 성공, 12초 뒤 `pgrep -f LoopMobile` 성공 (`LAUNCH-OK`). 시작 시 프로세스 크래시는 관찰되지 않음. 이 프로세스 검사는 UI 응답성이나 실제 메시지 배달을 증명하지 않는다.

미검증: 앱 UI에서 실제 live 세션으로 전송하고 게이트웨이 이벤트의 수신을 확인하는 종단 간 절차, 299건 목록의 실제 스크롤/확장 조작, 세션에서 연결 run의 attention 응답.
