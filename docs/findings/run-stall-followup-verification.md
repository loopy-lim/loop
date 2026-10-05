# Run stall 후속 통합 검증 (현재 작업 트리)

## 판정: PASS (이번 수정 범위); 별도 범위의 미해결 항목은 아래 명시

독립 작업 트리 감사: `git diff`에서 `packages/pi-loop/src/extension.ts`와 `packages/orchestrator/src/coordinator.ts`의 실제 변경을 확인했다. pi-loop는 만료 lease 재관측 및 1회 resume, resolve 이후 status 오류 복구와 stale worker 게이트 제거, task별 done 알림을 추가했다. coordinator는 lease 상실 시 교체 소유자의 유효 lease가 없으면 attention을 기록하고 catch 내부 store 오류를 유한 재시도 후 전파한다. gateway의 planner 재시도 및 service reaper 변경도 유지되어 있다. 신규 테스트 파일 5개(각 경로 1개 이상) 존재를 확인했다.

- `bun run check`: **PASS** (codegen:check, lint, typecheck, architecture, cargo 및 Bun 테스트; Bun 919 pass / 0 fail). 로그: `/tmp/loop-verify-real-check.log`. lint 경고는 있으나 종료코드 0.
- `bun test packages/pi-loop/test/restart-recovery.test.ts packages/pi-loop/test/task-done-notify.test.ts packages/orchestrator/test/lease-loss.test.ts packages/gateway/test/lease-reaper.test.ts packages/gateway/test/planner-retry.test.ts`: **PASS**, 11 pass / 0 fail.
- `git diff --check`: **PASS**.

## 경로별 독립 판정

| 조사 경로 | 현재 근거 및 판정 |
| --- | --- |
| coordinator I: lease-lost | **PASS** — 유효 교체 소유자가 없으면 durable attention 기록; `packages/orchestrator/test/lease-loss.test.ts`의 `lost lease records a durable hand-off rather than returning an unowned active run` pass. |
| coordinator A1/A2: 소유권 경쟁 | **PASS(범위 제한)** — 만료된 active lease는 gateway reaper가 다시 실행; `packages/gateway/test/lease-reaper.test.ts`의 `reaper re-dispatches expired active leases but not live or attention runs` pass. gateway 밖에서 실행한 run의 별도 자동 복구는 이번 범위 밖. |
| coordinator K: catch 내부 store 오류 | **PASS(일시 오류)** — snapshot 및 attention 쓰기 실패 각각 유한 재시도; `packages/orchestrator/test/lease-loss.test.ts`의 `transient snapshot failure inside dispatcher catch retries to persist attention`, `transient attention write failure inside dispatcher catch retries to persist attention` pass. 영구 store 장애는 전파되며 외부 복구가 필요함. |
| gateway S2: one-shot execute reject | **PASS(범위 제한)** — 만료 대기 뒤 재시도; `packages/gateway/test/planner-retry.test.ts`의 `failed execution hand-off retries after the old lease expires` pass. 추가 실패는 reaper에 의존. |
| gateway S3: owner 사망/재시작 뒤 만료 lease | **PASS(범위 제한)** — `packages/gateway/test/lease-reaper.test.ts`의 만료 재디스패치, 실패 후 재시도/중복 방지 두 테스트 pass. gateway 가동 및 store 접근 가능 조건이 필요함. |
| gateway S1 / core S1: 공개 attention | **범위 밖(의도된 human-park)** — 사용자 resolve가 필요하며 자동 재점유 대상이 아님. 원격 gateway resolve API는 이번 수정 대상이 아님. |
| CLI S4 / core S2–S4 | **범위 밖/미해결** — CLI 직접 실행, Rust reducer/store 원자성 및 terminal 재평가 문제는 이번 TS 수정으로 해결되지 않음. |
| pi-loop R1: 사망 owner의 미만료 lease | **PASS(범위 제한)** — observer가 lease 만료를 다시 관측해 한 번 resume; `packages/pi-loop/test/restart-recovery.test.ts`의 `recovers dead owner after lease expiry with bounded dispatch` pass. 바인딩된 observer 세션이 필요함. |
| pi-loop R2: resolve 성공 뒤 status/resume 실패 | **PASS(범위 제한)** — status 오류 후 snapshot으로 커밋 확인, resume 실패 후 observer 재시도; 같은 테스트 파일의 `recovers status failure after resolve with bounded dispatch`, `recovers resume failure after resolve with bounded dispatch` pass. 지속 실패 시 수동 resume 필요. |
| pi-loop R3: stale activeWorkers | **PASS** — 재시작 조건에서 stale worker 단독 게이트 제거; 같은 파일의 `recovers stale active worker with bounded dispatch` pass. |
| pi-loop per-task-done notification | **PASS** — task별 done 알림 및 goal 완료음과 분리; `packages/pi-loop/test/task-done-notify.test.ts`의 `observer announces each new done task once without playing the goal sound` pass. |
| pi-loop R4 / terminal reportFinal hang | **범위 밖/미해결** — 다중 attention 노출 및 최종 task 조회 무한 대기는 별도 후속 작업 필요. |

변경 기록 범위: `docs/findings/run-stall-followup-verification.md`만 수정. 미해결 범위는 PASS로 주장하지 않는다.
