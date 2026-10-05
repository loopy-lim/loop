# 개선 사이클 통합 검증 (integration-check)

승인된 ADR(docs/decisions/2026-xx-proposal-approval-cycle.md) 제안 1·3·4 세 구현의 결합 결과에 대해
전체 `bun run check`를 실행하고 그 결과를 기록한다. 제안 2(stall 상한 측정 기반 튜닝)는 운영
측정 데이터 부재로 이번 사이클에서 제외되었다.

- 검증 시점: 워킹 트리(미커밋) — 구현 3건 + ADR·진단 문서 2건이 트리에 존재
- **최종 판정: PASS — `bun run check` 전체 그린 (exit 0)**

## 검사 결과

`check` = `codegen:check && lint && typecheck && test:architecture && test`
(`test` = `cargo test --workspace && cargo build -p loop-bridge && bun test …`)

| 단계 | 판정 | 증거 |
| --- | --- | --- |
| `bun run codegen:check` | **pass** | exit 0 — 재생성 결과가 커밋된 생성 파일과 일치(scheduler-relax는 Rust 도메인 로직만 변경, bridge 타입·와이어 계약 무 drift) |
| `bun run lint` | **pass** | exit 0 — 에러 0, 기존 경고(no-shadow, preserve-caught-error 등)만 존재 |
| `bun run typecheck` | **pass** | `tsc -p tsconfig.json` exit 0, 에러 0 |
| `bun run test:architecture` | **pass** | 8 pass / 0 fail — 계층 경계·credential confine 게이트 포함 |
| `cargo test --workspace` | **pass** | 전 바이너리 `ok`, 총 **218 passed / 0 failed** |
| `cargo build -p loop-bridge` | **pass** | exit 0 |
| `bun test packages tests plugins …` | **pass** | **923 pass / 0 fail** (113 파일, 5,286 expect) |
| **`bun run check` 전체** | **pass** | exit 0 — 체인 끝까지 실행 완료 |

## 수용 기준별 증거

1. **세 구현의 결합 결과에 대해 bun run check 통과** — 위 표 전체. 결합 상태(3 변경 동시 적용
   트리)에서 실행했으므로 교차 회귀 없음이 증명된다. 특히 dead-config-keys가 `decision_parallelism`
   /`integration_parallelism` 키를 제거한 것과 scheduler-relax의 claim_plan 직렬 불변식이 결합된
   상태에서 `cargo test --workspace` 그린 — Capacity{max_workers, max_frontier_workers} 기반
   클레임 제한과 정책 테스트(scheduler_domain 17건, 신규 6건 포함)가 함께 통과했다.
2. **검증 기록 착지** — 본 문서.
3. **결과 요약 반환** — 태스크 응답으로 전달.

## 변경 파일 목록 (구현 3건)

| 제안 | 파일 | 변경 |
| --- | --- | --- |
| 3 scheduler-relax | `crates/loop-core/src/scheduler/scheduler.rs` | 직렬 종류 세계 정지 제거 → claim_plan(결정·통합은 빈 세계에서만 클레임), ClaimSkip/ClaimSkipReason 기록 |
| 3 | `crates/loop-core/src/scheduler/conflicts.rs` | 빈 writeScope 보편 충돌 제거(normalized_prefix: 공백 요소는 단언 없음), glob 선행 요소 보수적 보유 |
| 3 | `crates/loop-core/src/scheduler/mod.rs` | ClaimPlan/ClaimSkip/ClaimSkipReason 재노출 |
| 3 | `crates/loop-core/tests/scheduler_domain.rs` | 정책 고정 테스트 6건 신설 |
| 1 spawn-observability | `packages/orchestrator/src/coordinator.ts` | #execute startup 관측 경계: 실패→run-level attention+오류 재던짐, 성공→takeover 기록, 방관자 무기록 |
| 1 | `packages/orchestrator/test/owner-spawn-observability.test.ts` | 신규 4건 (923 pass에 포함) |
| 4 dead-config-keys | `config/policy.toml` | 죽은 키 3개(decision_parallelism, integration_parallelism, unknown_write_scope_is_exclusive) 제거 + 판정 근거 주석 |

트리에 추가로 존재하는 문서(이번 검증의 입력): `docs/decisions/2026-xx-proposal-approval-cycle.md`,
`docs/diagnosis/2026-xx-death-patterns.md`.

## 미해결 위험 (후속 권장)

1. 라이브 설정 `~/.config/loop/policy.toml`(홈 경로)에 제거된 키 3개가 잔존 — 파서가 무시하므로
   inert, 운영자 직접 정리 권장.
2. 죽은 키 재유입에 대한 자동 경감 테스트 부재 — config 주석 기록만 존재. orchestrator 테스트에
   [scheduler] 키 집합 드리프트 알람 추가 권장.
3. syscall 수준 spawn 실패(ENOENT 등)는 owner 프로세스 실행 전이라 저장 상태에 기록 불가 —
   spawnOwner 동기 reject로 resume 호출자에게만 보임. cli 패키지 변경이 후속 과제.
4. 성공 takeover 기록이 첫 태스크 활동 채널에 귀속됨 — run-level 전용 EventKind는 Rust+codegen
   이 필요해 후속 ADR 후보. 진단·결함 문서(D3 관측성 절반) 갱신도 후속.
