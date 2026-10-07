# 잔여 스톨 한계 통합 검증

## 판정

| 항목 | 판정 | 근거 |
| --- | --- | --- |
| rust C3: 단일 소유자 renew 실패 | **해결** (일시적 실패에 한함) | `crates/loop-store/src/sqlite.rs`의 유한 갱신 재시도와 TTL/3 임계선; `crates/loop-store/tests/execution.rs`의 일회 실패 후 append 유지, 재시도 소진 후 durable hand-off, 리스 상실 시 즉시 종료 및 최소 TTL 예산 테스트 통과. |
| ts C5: 공급자 무응답 | **완화** (유한 대기) | `packages/providers/test/provider-timeout-coverage.test.ts`의 process, Herdr 실행·제어, Zai API 무응답·취소 테스트 5건과 `packages/orchestrator/test/stall-watchdog.test.ts`의 무응답 result·repair 및 progress 리셋 테스트 5건 통과. 공급자 경계 타임아웃과 owner 스톨 워치독이 대기를 종료한다. |

## 실행 증거

- 집중 검증: `cargo test -p loop-store --test execution` — 10 passed, 0 failed; `bun test packages/providers/test/provider-timeout-coverage.test.ts packages/orchestrator/test/stall-watchdog.test.ts` — 10 passed, 0 failed. 실행 출력: `/tmp/loop-limits-focused.log`; 영속적 테스트 근거: 위 테스트 파일.
- 전체 게이트: `bun run check` — **exit 0**, Bun 950 passed, 0 failed. 실행 출력: `/tmp/loop-limits-full-check.log`; 재현 명령: `bun run check` (저장소 루트). `/tmp` 로그는 로컬 임시 증거이며 저장소에 포함되지 않는다.

## 남은 범위

- C3에서 실제 리스 만료·타 소유자 선점은 재시도 대상이 아니다. 기존 durable hand-off 및 새 소유자의 복구가 필요하다.
- C5의 타임아웃은 미응답 외부 작업을 종료했다고 증명하지 않는다. 취소 결과가 불확실하면 재조정·durable 상태 확인이 필요하다. 공급자 인증 실환경 호출은 이 게이트의 검증 범위 밖이다.
