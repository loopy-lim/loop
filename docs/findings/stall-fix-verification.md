# 런 정지 수정 통합 검증 (후속 런, 컴팩트 계약)

## 판정

**통과: `bun run check` exit 0.** 스테이지 전부 통과 — `codegen:check`, lint(오류 0, 기존
경고만 존재), `tsc -p tsconfig.json`, `test:architecture` (9 pass), `cargo test --workspace`
+ bridge build, 전체 Bun 테스트 **943 pass / 0 fail** (116 파일, 5443 expect). 2회 실행해
동일 결과 재확인. 이전 attempt 4의 실패였던
`packages/orchestrator/test/fallback-transition.test.ts` "an exhausted fallback chain stops
the run clearly instead of hanging"도 이번 실행에서 통과 — Interrupted 자동 재시도가
fallback 체인과 합의된 정책으로 수렴했음을 확인.

## 진단 후보별 판정

진단: `.loop/diagnostics/stall-rust.md`, `.loop/diagnostics/stall-ts.md`.

| 후보 | 수정 증거 | 검증 증거 | 판정 |
|---|---|---|---|
| rust C1 Interrupted 즉시 Attention | `crates/loop-core/src/event/reducer.rs:407-424`: 남은 attempt → `Ready`(기록된 라우팅 유지), 소진 시에만 `Attention` | `fallback-transition.test.ts`, `interventions.test.ts` retry 사다리 테스트 포함 전체 Rust·Bun 테스트 통과 | **해결** |
| rust C2 어텐션 해결 후 조용한 파킹 | `crates/loop-bridge/src/commands/guidance.rs`의 `redispatch_ready_events`와 `redispatched_task_id` 응답 필드 — defer/answer 해결이 파킹 태스크를 재개 | `crates/loop-core/tests/attention_recovery_integration.rs`, `crates/loop-store/tests/attention_retry.rs`, `packages/pi-loop/test/attention-recovery-contract.test.ts`, `resolve-vocabulary.test.ts` 통과 | **해결** |
| rust C3 실행 리스 상실 | 스토어 레벨 자동 renew 복구는 없음. 대신 리스 상실을 치명 종료가 아닌 **durable hand-off**로 기록하고(`lease-loss.test.ts`), 다른 소유자의 `recycle_interrupted_execution`이 running/verifying 클레임을 재디스패치(`recovery-dispatch.test.ts`: running·verifying 모두) | `packages/orchestrator/test/lease-loss.test.ts`, `recovery-dispatch.test.ts` 통과 | **완화(수용)** — 단일 소유자 내 자동 renew 재시도는 여전히 부재. 리스 갱신 누락은 재시작 복구 경로로 회수됨 |
| ts C1 owner 종료/terminal 레이스 | `packages/cli/src/dispatcher.ts:132-148`: owner 종료 감지 시 스냅샷 1회 재폴링, clean exit + lease 부재를 정상 종료로 판정 | `packages/cli/test/detached.test.ts` 통과, 전체 게이트 통과 | **해결** |
| ts C3 resume 침묵 실패 | `packages/cli/src/run-control.ts:94`: `loop resume`이 `waitForOwnerReady`로 owner 기동 확인 | `packages/cli/test/detached.test.ts` 통과 | **해결** |
| ts C6 owner stderr 소실 | `packages/cli/src/dispatcher.ts:5`: owner stdout/stderr를 DB 옆 로그 파일에 기록 | `packages/cli/test/detached.test.ts` 통과 | **해결** |

## 경계 확인

- **Rust 도메인 타입의 수기 TypeScript 복사본 없음.** `codegen:check` 통과
  (생성 출력이 커밋된 `packages/protocol/src/generated/**`와 일치),
  `tests/architecture-boundaries.test.ts` 9 pass, 게이트의
  "the gateway declares no conversation frame shapes; it consumes generated types only"
  경계 테스트 통과.
- 이 태스크에서 수정한 소스 없음 — write scope(documents)만 변경했다.

## 남은 위험

1. rust C3의 단일 소유자 자동 renew 재시도 부재 (위 표의 완화 수준). 리스 갱신 누락이
   드물고 복구 경로가 검증된 상태라 후속 과제로 남긴다.
2. ts C5(owner 내부 `runtime.execute` 무기한 대기)는 스톨 워치독
   (`packages/orchestrator`의 `stall_timeout_ms`, `stall-watchdog.test.ts` 통과)으로
   부분 커버. 이번 계약의 대상 후보가 아니므로 미검증 상태로 남긴다.
