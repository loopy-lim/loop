# Watch-to-Steer — worker 패널 입력을 steer로 전달하는 상호작용 설계

- **Date:** 2026-09-23
- **Status:** decided
- **Kind:** decision
- **Context:** v1 가시성(run loop-9a95851d 완료)은 worker 활동을 `loop watch`와 herdr 워커당 패널로 렌더한다. 사용자 요구: 보는 화면에서 worker를 직접 건드릴 수 있어야 한다 (codex/Claude Code 서브에이전트처럼 보고, 건드리기).

## 결정

**채택: 스티어 릴레이(steer relay) — worker 패널에 붙는 얇은 릴레이 프로세스.**

- worker 시작 시 열리는 herdr 패널에 릴레이 프로세스를 부착한다. 릴레이는 표준입력으로 타이핑된 줄을 읽고, 각 줄을 orchestrator의 steer 경로(`steerRun` — `loop steer`와 동일한 코드)로 전달한 뒤 사용자 확인 한 줄을 패널에 에코한다.
- 릴레이는 worker 종료와 함께 끝난다 (패널 수명 = worker 수명, v1 계약 유지).
- **절대 금지: provider 프로세스 stdin으로의 날것 주입.** codex exec/agy는 머신 캡처 경로와 충돌하며, pi `-p`는 원샷이라 입력 슬롯이 없다. 입력은 항상 orchestrator steer 채널로 라우팅된다.
- steer는 가시성 게이트(`workerVisibility`)와 독립 옵션이다 — 패널 없이도 `loop steer`는 계속 동작한다.
- 에코되는 입력 줄은 `redactProviderText`를 통과한 텍스트만 패널에 표시한다. 환경변수·argv·인증 자료는 어떤 표면에도 나오지 않는다.
- 경계: loop-core는 pane/relay 개념을 모른다. 릴레이는 orchestrator의 steer 백엔드 함수를 호출하는 TS 어댑터 측 컴포넌트다.

## 대안 및 기각 이유

1. **herdr 패널 입력 가로채기(client API 수준)** — 기각. herdr 클라이언트 API(`createPane/closePane/sendText`)는 출력 방향 전송만 제공하며, 패널 입력 이벤트를 구독하는 경로가 없다. upstream API 변경을 요구하는 비용 대비 이득이 없다.
2. **명시적 어포던스만 유지 (`/loop steer` + watch 힌트)** — 기각이 아니라 **폴백으로 유지**. herdr 환경이 없거나 릴레이 실행이 실패하면 이 경로가 남는다. 사용자 경험 요구(패널에서 바로 치기)를 만족하지 못해 단독 채택은 안 한다.

## 수정 대상 파일

- `packages/herdr/src/**` (릴레이 프로세스 부착 + 수명 관리)
- `packages/orchestrator/src/**` (릴레이가 호출할 steer 백엔드 노출)
- `packages/cli/src/main.ts`, 테스트 파일들

## 테스트 전략

가짜 provider/herdr로: 입력 줄 → 올바른 run/task id의 steer 호출, worker 종료 시 릴레이 종료, headless 폴백, 게이트 오프 상태. 실제 herdr 패널 상호작용은 사용자 수동 검증(별도 evidence).

## 레인별 참고

- steer 자체는 레인 무관하게 orchestrator가 처리한다. persistent agy 드라이버는 다음 턴으로 steer를 전달할 수 있고, 원샷(codex exec, pi -p)은 steer가 재시도/다음 시도 컨텍스트에 반영된다 (기존 steer 계약 그대로).
