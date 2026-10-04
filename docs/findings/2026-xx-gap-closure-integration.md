# gap-closure 통합 트리 전체 검증 (integration-check)

태스크 `integration-check`. 미해결 항목 수습(결함 3건, WorkerState 흡수, bridge/cli 분해,
테스트 보강, ADR)을 마친 통합 트리에서 `bun run check` 전체를 실행해 결과를 기록한다.

- 검증 시점: `8dacc34` (docs(defects): 디스패처 결함 3건에 대한 WIP 착지 판정 기록) + 미커밋 워킹 트리
- **최종 판정: PASS — `bun run check` 전체 그린 (codegen:check / lint / typecheck /
  architecture / cargo / bun 테스트 모두 통과)**

## 단계별 판정 (3차 검증, 전 단계 개별 재확인)

`check` = `codegen:check && lint && typecheck && test:architecture && test`
(`test` = `cargo test --workspace && cargo build -p loop-bridge && bun test …`)

| 단계 | 판정 | 증거 |
| --- | --- | --- |
| `bun run codegen:check` | **pass** | exit 0 — 재생성 결과가 커밋된 생성 파일과 일치 (bridge 분해 후에도 와이어 계약 유지) |
| `bun run lint` | **pass** | exit 0 — 에러 0 (기존 `no-non-null-assertion` 등 경고만 존재, 판정에 영향 없음) |
| `bun run typecheck` | **pass** | `tsc -p tsconfig.json` exit 0, 에러 0 |
| `bun run test:architecture` | **pass** | 8 pass / 0 fail (599 expect, 계층·credential confine 게이트 포함) |
| `cargo test --workspace` | **pass** | 27개 테스트 바이너리 전부 `ok`, 총 **195 passed / 0 failed** |
| `cargo build -p loop-bridge` | **pass** | exit 0, 빌드 에러 0 |
| `bun test packages tests plugins scripts/rustra-codegen.test.ts` | **pass** | **908 pass / 0 fail** (107 파일, 5,248 expect) |
| **`bun run check` 전체** | **pass** | exit 0 — 체인 끝까지 실행 완료 |

## 이전 시도의 차단자와 해소 경로

1·2차 시도에서는 cli-split 산출 파일 3곳의 미사용 import(`EventOutput` / `GoalCriterionInput`
/ `UsageError`)가 oxlint 에러로 `check`를 lint 단계에서 중단시켰다. 이 태스크의 쓰기 범위는
보고서 문서 한정이므로 2차에서 에스컬레이션했고, 지시대로 cli-split이 재실행되며 세 import를
제거했다. 3차에서 `rg`로 세 식별자 잔존 없음을 확인한 뒤 전체 `check`를 재실행해 그린 전환을
확인했다. 범위 밖 수정 없이 에스컬레이션 → 소유자 수정 경로로 해소된 케이스다.

## 통과 항목이 담보하는 것

- **결함 3건 수정·scheduler 이동** (`loop-core/src/scheduler/*`, `loop-store` 변경):
  `cargo test --workspace` 그린 — recovery, scheduler_domain, worker-state-vocabulary 등
  회귀 없음.
- **WorkerState 생성 프로토콜 흡수 + lockstep 테스트**
  (`packages/orchestrator/test/lockstep.test.ts`): bun test 908 pass에 포함.
- **bridge 커맨드 패밀리 분해 + 직접 테스트** (`commands/{mod,run,task,guidance,cleanup,
  benchmark}.rs`): codegen:check 그린 — 등록 순서(숫자 와이어 commandId) 불변 확인,
  `tests/commands-direct.rs` 전부 통과.
- **CLI 모듈 분할** (`packages/cli/src/*`): lint·typecheck·bun test(cli 스위트) 그린.
- **benchmark 배치 ADR** (`docs/adr/benchmark-placement.md`): 문서 전용, 코드 영향 없음.

## 검증 실행 기록 (3차)

1. 차단자 잔존 확인: `rg`로 3식별자 검색 — 3파일 모두 미발견 (cli-split 수정 반영 확인).
2. `bun run lint` 단독 — exit 0 (경고만 존재).
3. `bun run check` 전체 — exit 0, bun test 908 pass까지 체인 완주.
4. 단계별 증거 보강: `codegen:check` / `typecheck` / `test:architecture` /
   `cargo test --workspace` / `cargo build -p loop-bridge` 개별 재실행, 전부 exit 0
   (수치는 위 표).

## 미해결 리스크

없음. 완료 계약(`bun run check` 그린)과 보고서 작성 계약 모두 충족했다. 참고로 lint 경고
(`no-non-null-assertion` 등)는 기존 상태 그대로이며 에러가 아니어서 판정에 영향 없다.
