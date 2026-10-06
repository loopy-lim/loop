# 런 정지 수정 통합 검증

## 판정

**실패 — 통합 게이트 미통과.** attempt 3의 `bun run check` 종료 코드 1 (`/tmp/loop-stall-integrate-attempt3.log`): codegen:check와 lint는 통과했으나 typecheck에서 다수의 TS 오류로 중단됐다 (예: `packages/gateway/test/pane-stream.test.ts:329`, `packages/pi-loop/test/attention-recovery-contract.test.ts:204`). 해당 파일은 이 태스크의 write scope 밖이다. attempt 2는 `apps/loop-mobile/src/features/run-list.tsx:29:10`의 미사용 `glyph` import로 lint에서 중단됐다 (`/tmp/loop-stall-integrate-attempt2.log`); 이번 실행에서는 해당 lint 차단이 재현되지 않았다. 이전 전체 테스트 실행에서도 `bun run check` 종료 코드 1 (942 pass, 1 fail, 943 tests). 실패: `packages/orchestrator/test/fallback-transition.test.ts:122`의 `an exhausted fallback chain stops the run clearly instead of hanging`. 기대 provider 순서 `[zai, openai-codex]`, 실제 `[zai, openai-codex, zai, openai-codex]`. Interrupted를 시도 사다리에서 다시 dispatch하는 정책과 기존 fallback 테스트 기대값이 충돌한다. 테스트만 수정하기 전에 반복 fallback이 의도된 계약인지 판단해야 한다. 로그: `/tmp/loop-stall-integrate-check.log` (이전 실행의 로컬 임시 파일).

이전 `bun run check`는 테스트 단계에서 종료되었고 최신 실행은 typecheck에서 종료되었으므로 별도로 `bun run codegen:check` (exit 0), `bun run test:architecture` (8 pass, exit 0)를 실행했다. 로그: `/tmp/loop-stall-codegen.log`, `/tmp/loop-stall-architecture.log`.

**경계/착지 판정:** 아키텍처 테스트의 generated-only Rust/TS seam은 통과했고, 확인한 수정에서는 Rust 도메인 타입의 수기 TS 복사본을 발견하지 못했다. 그러나 `packages/protocol/src/generated/{.rustra-generated.json,contract.ts,frame-codecs.ts,schema.json,types.ts}`가 attempt 3의 `git status --short`에서도 수정 상태로 **미커밋**이다 (`git status --short`). Rust 변경과 생성 파일을 함께 커밋했다는 요구는 충족되지 않았다. 이것도 통합 실패 항목이며 codegen:check 통과로 대체할 수 없다.

## 후보별 근거 (진단: `.loop/diagnostics/stall-rust.md`, `.loop/diagnostics/stall-ts.md`)

| 후보 | 코드/회귀 증거 | 판정 |
|---|---|---|
| rust C1 Interrupted 즉시 Attention | `crates/loop-core/src/event/reducer.rs`의 Interrupted 분기가 남은 attempt에서 Ready, 소진 시 Attention으로 전이. `packages/orchestrator/test/fallback-transition.test.ts`에서 새로운 반복 dispatch가 관측되지만 기존 기대와 불일치 | 정책 변경됨, 통합 **미검증** |
| rust C2 해결 후 조용한 파킹 | `crates/loop-bridge/src/commands/guidance.rs`의 `resume_parked_task_events`; `crates/loop-core/tests/attention_recovery_integration.rs`, `crates/loop-store/tests/attention_retry.rs` 및 `packages/pi-loop/test/attention-recovery-contract.test.ts` | 코드 및 회귀 테스트 존재, 전체 게이트 실패로 최종 미검증 |
| rust C3 리스 상실 | 자동 renew/append 복구의 통합 수정 증거 없음 | **열림** |
| ts C1 owner 종료/terminal 레이스 | `packages/cli/src/dispatcher.ts`의 종료 후 재폴링, `packages/cli/test/detached.test.ts`의 terminal 재확인 테스트 (전체 테스트에서 해당 파일 통과) | 변경 및 테스트 확인 |
| ts C3 resume 침묵 실패 | `packages/cli/src/run-control.ts`의 owner 준비 대기, `packages/cli/test/detached.test.ts`의 resume 실패 테스트 (전체 테스트에서 해당 파일 통과) | 변경 및 테스트 확인 |
| ts C6 stderr 소실 | `packages/cli/src/dispatcher.ts`의 owner 로그 리다이렉트, `packages/cli/test/detached.test.ts`의 stderr 수집 테스트 (전체 테스트에서 해당 파일 통과) | 변경 및 테스트 확인 |

남은 위험: rust C3 리스 복구 미구현, fallback 반복의 계약 미확정, 전체 게이트 실패 (현재 typecheck 차단 및 이전 테스트 실패), generated protocol 파일 미커밋. 이 기록은 코드 변경·회귀 테스트 관측과 전체 통합 승인 여부를 구분한다.
