# 세션 중심 모바일 통합 검증

## P0 판정 — 부분 충족

- 홈 `SubmitScreen.tsx`는 session inventory를 sessionId 기준으로 표시하고 live 행을 먼저 배치한다. 원격 run 제출은 Task history 보조 표면으로 이동했고 `+`는 `SpawnFab`을 사용한다. `session-home.test.ts` 포함 모바일 테스트 통과.
- 회귀/잔여 위험: 목록은 첫 로드와 수동 새로고침만 수행한다. 새 세션이 다른 경로에서 관측되어도 자동 갱신되지 않으며 spawn 후 홈으로 돌아왔을 때 기존 inventory가 그대로 보일 수 있다. `loadError` 발생 시 직전 목록도 남는다. 0개/다중/live+ended 상태의 시뮬레이터 수동 조작은 수행하지 않았다.

## P1 판정 — 미충족 (P0→P1 정합 문제)

- `ConversationScreen.tsx`는 세션 화면에서 터미널 토글을 제공하고 runId가 있을 때에만 steer 모드를 사용한다. 그러나 sessionId로 직접 진입한 경우 `runId` 역상관을 수행하지 않는다(`ConversationScreen.tsx:227-255`는 runId→sessionId 방향만 조회). 따라서 연결된 run의 attention 질문·전용 resolve 동선이 세션 상세에 존재하지 않는다. 기존 run 상세의 응답과 세션 대화는 분리된 상태다. 제안서의 P1 세션 내 질문→답변 기준 미달이며 이 점은 테스트 통과로 대체할 수 없다.
- `SubmitScreen.tsx`의 새 세션 행에서 `onOpenSession(sessionId)`만 전달되므로 연관된 run이 있어도 세션 상세에 runId가 전달되지 않는다. 이 때문에 연결된 실행의 steer도 세션에서 사용할 수 없다. 기존 conversation contract 테스트의 run-correlated steer 증거는 이 진입 경로를 검증하지 않는다.
- P1 어휘 변경(`copy.ts`, run 화면 및 터미널 안내 문구)은 테스트·타입 검사를 통과했으나 세션 상세 attention 통합 완료를 의미하지 않는다.

## 체크 증거

- `bun run typecheck`: 통과 (`tsc -p tsconfig.json`).
- `bun test apps/loop-mobile/test`: 491 pass, 0 fail (45 files).
- `bun test apps/loop-mobile/test/design-spec.test.ts apps/loop-mobile/test/tokens.test.ts apps/loop-mobile/test/contrast.test.ts`: 33 pass, 0 fail.
- `cd apps/loop-mobile && bash scripts/build-ios-simulator.sh > ios/build/verify-build.log 2>&1`: Release `BUILD SUCCEEDED`, 설치·기동 기록 (UDID `99B087B5-DEF6-4CF1-9177-81A5DE564CFC`). 동일 UDID에서 종료 후 `simctl launch` 성공, 12초 후 `pgrep -fl LoopMobile`에서 해당 시뮬레이터 프로세스 PID 50880 확인. 시작 크래시 관측되지 않음. 로그: `apps/loop-mobile/ios/build/verify-build.log`.
- 이 통합 작업의 쓰기 대상은 이 보고서 및 `apps/loop-mobile/ios/build/**`이며 기존 앱 소스 변경은 수정하지 않았다. 전체 `bun run check` 및 실제 gateway 연결 수동 검증은 수행하지 않았다.
