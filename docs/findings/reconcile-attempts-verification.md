# reconcile-attempts 검증 결과

작업: reconcile-fix-verification · 날짜: 검증 실행 시점 기준 · 검증자: verification worker

## 결론: PASS

고아 worker → `TaskExecutionReconciled` → run 재개 시나리오에서 attempts
PRIMARY KEY UNIQUE 충돌이 발생하지 않음을 회귀 테스트와 전체 워크스페이스
테스트로 확인했다.

## 검증 대상 수정 (crates/loop-store)

1. `TaskExecutionReconciled` 핸들러(`crates/loop-store/src/sqlite.rs`):
   해당 task의 `attempts` 행 중 `running`/`verifying` 상태를 `cancelled`로
   갱신 (수정 방향 (a)). `workers` 행 취소 시 `updated_at`도 갱신.
2. `WorkerStarted` 핸들러: attempts 삽입을
   `ON CONFLICT(run_id, task_id, attempt) DO UPDATE` 로 변경해 재디스패치 시
   기존 행을 재사용 (수정 방향 (b-재사용)). attempt 번호당 정확히 하나의 행이
   보장되어 충돌이 구조적으로 불가능.
3. retry 예산 소모는 verification 실패 경로에 그대로 존재 — reconcile 재사용은
   `task.attempt`를 증가시키지 않음(결함 범위 밖의 의미론 변경 없음).

## 회귀 테스트 커버리지 확인: 확인됨

`crates/loop-store/tests/recovery.rs`의 두 테스트가 고아→reconcile→재개 경로를
커버한다.

- `reconciled_attempt_row_is_cancelled_then_reused_on_redispatch`:
  WorkerStarted 후 고아 발생 가정 → TaskExecutionReconciled → attempts/workers
  행이 `cancelled`인지 검증 → 동일 attempt로 재디스패치(행 재사용) →
  VerificationFailed로 attempt=1 재시도 → 최종 attempts 행이
  `[(0, failed), (1, running)]`으로 정확히 하나씩 존재함을 검증(중복 없음).
- `reconcile_cancels_verifying_attempt_rows_of_a_finished_worker`:
  verifying 상태 attempts 행도 reconcile 시 `cancelled`로 정리됨을 검증.

### 수정 전 코드에서의 실패 확인 (결함 포착 증거)

`git stash push -- crates/loop-store/src/sqlite.rs`로 수정분만 제거한 상태에서:

```text
running 2 tests
test reconcile_cancels_verifying_attempt_rows_of_a_finished_worker ... FAILED
  left: "verifying" right: "cancelled"   (recovery.rs:287)
test reconciled_attempt_row_is_cancelled_then_reused_on_redispatch ... FAILED
  left: "running" right: "cancelled"     (recovery.rs:154)
test result: FAILED. 0 passed; 2 failed
```

두 테스트 모두 수정 전 코드에서 실패 — 결함을 실제로 잡는 회귀 테스트임.

## 체크 결과

| 체크 | 명령 | 결과 |
| --- | --- | --- |
| workspace-tests | `cargo test --workspace` (cwd=repo root, timeout 600s) | **pass** — exit code 0, 23개 테스트 스위트 전부 `ok`, 총 실패 0 (1 ignored는 기존 무시 케이스) |
| verification-doc-exists | `test -s docs/findings/reconcile-attempts-verification.md` | **pass** — 이 문서가 존재(비어있지 않음) |

## 변경 파일 (이 검증 작업 기준)

- 쓰기: `docs/findings/reconcile-attempts-verification.md` (선언된 쓰기 범위 내 유일한 변경)
- 읽기 전용 참조: `AGENTS.md`, `crates/loop-store/src/sqlite.rs`, `crates/loop-store/tests/recovery.rs`

## 미해결 리스크

- reconcile이 `task.attempt`를 증가시키지 않으므로, 반복적인 고아-재개 사이클에서
  retry 예산이 소모되지 않는다(의도된 설계 — 인프라 복구가 예산을 훼손하지 않음).
  다만 max_attempts 상한 무한 우회가 우려되면 향후 reconcile 횟수 자체의 상한 또는
  Attention 전이를 별도 검토할 것.
- `bun run check`(전체 clippy/fmt/codegen)는 이 작업의 완료 조건이 아니므로 미실행.
  통합 전 메인 워크플로에서 실행 권장.
