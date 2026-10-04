# loop-improvements 통합 트리 전체 검증 (verify-and-commit)

태스크 `verify-and-commit`. gap-closure-followup 재수습 라운드의 개선 3건 변경분이 놓인
통합 트리에서 `bun run check` 전체를 실행해 통과/실패 항목으로 기록하고, 녹색인 변경분을
한국어 Conventional Commits 논리 커밋으로 착지한다.

- 검증 시점: `55fef3c` (feat(loop): failure attention 해결을 지시어 어휘로 고정 —
  add_task/defer 지시어 착지) + 미커밋 워킹 트리(loop-core focused rerun 정책)
- **최종 판정: PASS — `bun run check` 전체 그린, 실패 항목 0건**

## 단계별 판정

`check` = `codegen:check && lint && typecheck && test:architecture && test`
(`test` = `cargo test --workspace && cargo build -p loop-bridge && bun test …`)

| 단계 | 판정 | 증거 |
| --- | --- | --- |
| `bun run codegen:check` | **pass** | exit 0 — 재생성 결과가 커밋된 생성 파일과 일치 |
| `bun run lint` | **pass** | exit 0 — 에러 0 (기존 경고만 존재: `no-useless-constructor`, `no-shadow`, `consistent-function-scoping` 등, 판정에 영향 없음) |
| `bun run typecheck` | **pass** | `tsc -p tsconfig.json` exit 0, 에러 0 |
| `bun run test:architecture` | **pass** | 8 pass / 0 fail (599 expect, 계층·credential confine 게이트 포함) |
| `cargo test --workspace` | **pass** | 27개 테스트 바이너리 전부 `ok`, 총 **211 passed / 0 failed** |
| `cargo build -p loop-bridge` | **pass** | exit 0, 빌드 에러 0 |
| `bun test packages tests plugins scripts/rustra-codegen.test.ts` | **pass** | **908 pass / 0 fail** (107 파일, 5,248 expect) |
| **`bun run check` 전체** | **pass** | exit 0 — 체인 끝까지 실행 완료 |

실패 항목: 없음.

## 개선 3건 착지 상태

| 개선 | 상태 | 위치 |
| --- | --- | --- |
| 지시형 어텐션 어휘 (attention-directive-resolution) | **커밋 완료** | `55fef3c` — attention resolution/event reducer/bridge guidance·task/generated protocol 포함 |
| focused 재검증 core 결정론 정책 | **이번 라운드에서 커밋** | `crates/loop-core/src/policy/verification.rs` + `mod.rs` (아래 커밋 목록 참조) |
| 제출 시점 계약 lint 규칙 (writeScope가 lint 대상 glob에 닿는 implementation 태스크는 lint 체크 필수) | **미착지** | 의존 태스크(contract-lint-submission)가 구현 없이 중단 — 워크트리에 코드 흔적 없음 (`rg`로 write scope·lint 규칙 검색 미발견) |

## focused 재검증 core 정책 (녹색 보존분)

stalled된 corrective-focused-reverify 부분 작업 중 녹색인 부분만 보존한다는 의도에 따라
판정했다.

- `focused_rerun_check_ids`: 기존 체크 판정(`CheckOutcome::StablePass` / `Failed`)을
  입력받아 안정 통과 체크는 `reuse_check_ids`로, 실패·불안정·기록 누락 체크는
  `rerun_check_ids`로 분배하는 순수 결정론 함수. core 정책 계층에만 존재하며 provider·
  endpoint 개념을 수입하지 않는다.
- 계층 준수: orchestrator/bridge 채택은 이번 트리에 없으므로 변경분이 core에 한정된다.
  채택 절반은 후속 재작업 기반으로 남긴다(아래 리스크).
- 테스트: `focused_rerun_reuses_stable_passes_and_reruns_failures_and_unknowns`,
  `focused_rerun_empty_input_produces_empty_plan` 통과
  (`cargo test -p loop-core --lib policy` — 18 passed / 0 failed).

## 커밋 목록 (한국어 Conventional Commits)

- `55fef3c` feat(loop): failure attention 해결을 지시어 어휘로 고정 — add_task/defer 지시어 착지
- `5f7b155` feat(loop-core): focused 재검증 체크 분배 정책 추가 — 이 문서와 같은 라운드에서 착지
- findings 문서 커밋: 이 문서 자체

## 검증 실행 기록

1. 워크트리 판독: `git status` — 더티 파일은 `crates/loop-core/src/policy/{mod,verification}.rs`
   2개뿐. 개선 3건 중 계약 lint 구현물은 트리에 부재.
2. `bun run check` 전체 실행 — exit 0, bun test 908 pass까지 체인 완주.
3. 단계별 증거 보강: `codegen:check` / `lint` / `typecheck` / `test:architecture` /
   `cargo test --workspace` / `cargo build -p loop-bridge` 개별 재실행, 전부 통과.
4. 보존 대상 확인: `cargo test -p loop-core --lib policy`로 focused rerun 테스트 2건 통과 확인.

## 미해결 리스크

1. **제출 시점 계약 lint 규칙 미착지** — writeScope가 lint 대상 glob에 닿는 implementation
   태스크에 lint 체크를 요구하는 규칙이 구현되지 않았다. 이 태스크의 쓰기 범위(`.git/**`,
   findings 문서)로는 구현할 수 없어 후속 태스크가 필요하다.
2. **focused 재검증의 orchestrator/bridge 채택 미착지** — core 정책만으로는 실제 재검증
   실행이 단축되지 않는다. `criteria-self-heal.ts`가 아직 선언된 체크를 전부 재실행하며,
   채택 작업은 분해된 후속 태스크(core 정책은 착지됨)로 재개해야 한다.
3. lint 경고는 기존 상태 그대로이며 에러가 아니어서 판정에 영향 없다.
