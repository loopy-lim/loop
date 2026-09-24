# 결과 기록·attempt 전이·원자성 현행 상태표 — 2026-09-25

## 조사 범위와 결론

이 문서는 현재 worktree의 `loop-bridge`, `loop-core` event/task, `loop-store`, orchestrator, generated protocol을 1차 소스로 읽어 `recordWorkerResult`와 `recordVerification` 이후의 실제 전이를 확정한다.

핵심 결론은 다음과 같다.

1. attempt는 worker 시작 때가 아니라 **`VerificationFailed`를 projection에 적용할 때 1 증가**한다. 초기값은 0이며 `max_attempts = 3`이면 실행 번호 0, 1, 2의 실패 후 projection attempt가 3이 되어 소진된다. [`crates/loop-core/src/task/task.rs:54-55`](../../crates/loop-core/src/task/task.rs), [`crates/loop-core/src/event/reducer.rs:181-195`](../../crates/loop-core/src/event/reducer.rs)
2. worker의 성공 보고는 `Running → Verifying`과 결과 summary 저장까지만 수행한다. `Done`은 별도 `VerificationPassed`가 completion contract 전체를 만족할 때만 가능하다. 따라서 **worker success ≠ completion**은 core guard로 유지된다. [`crates/loop-bridge/src/commands.rs:459-509`](../../crates/loop-bridge/src/commands.rs), [`crates/loop-core/src/task/task.rs:64-103`](../../crates/loop-core/src/task/task.rs), [`crates/loop-core/src/task/contract.rs:55-62`](../../crates/loop-core/src/task/contract.rs)
3. 한 번의 store append batch 안에서는 event 검증, event log, query index, attempts row, projection cache가 SQLite `IMMEDIATE` transaction 하나로 원자적이다. 그러나 **worker 결과와 verification**, **check receipts와 verification**, **소진 전이와 failure attention**, **마지막 task Done과 RunCompleted**는 각각 별도 command/transaction이어서 crash 공백이 있다. [`crates/loop-store/src/sqlite.rs:46-92`](../../crates/loop-store/src/sqlite.rs), [`packages/orchestrator/src/task-execution.ts:116-131`](../../packages/orchestrator/src/task-execution.ts), [`crates/loop-bridge/src/commands.rs:511-573`](../../crates/loop-bridge/src/commands.rs)
4. `Blocked` 타입은 존재하지만 terminal이 아니며, 조사 범위 안에는 실패한 dependency의 후손을 `Blocked`로 만드는 전이가 없다. `Blocked-terminal`에 해당하는 현행 타입·정책은 **없다**. [`crates/loop-core/src/task/state.rs:6-22`](../../crates/loop-core/src/task/state.rs), [`crates/loop-core/src/task/task.rs:78-94`](../../crates/loop-core/src/task/task.rs), [`packages/protocol/src/generated/types.ts:114`](../../packages/protocol/src/generated/types.ts)
5. retry 소진의 현행 결과는 `Failed`가 아니라 task `Attention`과 별도 failure attention이다. dependency terminalization과 독립 branch 지속을 명시적으로 결정하는 core outcome도 없다.

## 1. 정상 실행 end-to-end 상태표

`a`는 event 적용 전 task의 projection attempt다.

| 단계 / 호출 | 선행 상태 | 같은 transaction에 기록되는 것 | projection 결과 | attempt / attempts table | 다음 동작 |
| --- | --- | --- | --- | --- | --- |
| `claimRunnableTasks` | `Pending`, dependency·scope 조건 충족 | 필요하면 `TaskReady` | `Ready` | 변화 없음 | coordinator가 context를 읽는다. |
| `recordWorkerStarted` | `Ready` | `WorkerStarted`; task index, worker row, attempt row `(a, compute, running)` | `Running`, active worker 등록 | projection `a` 유지; attempt row `a` 생성 | provider side effect는 이 durable reservation 뒤에 시작한다. [`packages/orchestrator/src/coordinator.ts:168-199`](../../packages/orchestrator/src/coordinator.ts) |
| `recordWorkerResult(success=true)` | `Running`, worker id 일치 | **한 batch:** `WorkerFinished` + `TaskOutputRecorded` | `Verifying`, active worker 제거, summary 저장 | projection `a` 유지; attempt row `a → verifying` | provider release 후 completion checks 실행. |
| `recordCheckReceipts` | 보통 `Verifying` | `CheckReceiptsRecorded` | 상태 변화 없음, receipt 교체 저장 | 변화 없음 | 별도 transaction 뒤 `recordVerification` 호출. |
| `recordVerification(passed=true)` | `Verifying` | `VerificationPassed(evidence)` | contract를 모두 만족하면 `Done` | projection `a` 유지; attempt row `a → done` | 모든 task가 Done이면 별도 transaction으로 `RunCompleted`. |
| `recordVerification(passed=false)` | `Verifying` | `VerificationFailed(reason)` | `a+1 < max`: `Ready`; compute class는 다음 class로 올리되 maximum에서 제한 | projection `a → a+1`; attempt row `a → failed` | scheduler가 새 worker를 시작하고 attempt row `a+1` 생성. |
| 동일, retry 소진 | `Verifying` | `VerificationFailed(reason)` | `a+1 >= max`: task `Attention`; failure reason 저장 | projection `a → a+1`; attempt row `a → failed` | bridge가 projection을 다시 읽어 **별도 transaction**으로 failure attention 생성. |

근거: bridge command 조립은 [`crates/loop-bridge/src/commands.rs:459-573`](../../crates/loop-bridge/src/commands.rs), core 전이는 [`crates/loop-core/src/event/reducer.rs:149-195`](../../crates/loop-core/src/event/reducer.rs), SQL index/attempt 반영은 [`crates/loop-store/src/sqlite.rs:479-526`](../../crates/loop-store/src/sqlite.rs)에 있다. attempt의 `(run_id, task_id, attempt)` 유일성은 [`crates/loop-store/src/schema.rs:29-36`](../../crates/loop-store/src/schema.rs)에 있다.

### worker 실패 보고의 실제 의미

`recordWorkerResult(success=false)`는 `WorkerFailed`를 기록하지 않는다. `WorkerFinished`와 `VerificationFailed`를 한 batch로 기록하여, 논리상 `Running → Verifying → Ready|Attention`을 한 transaction 안에서 적용한다. 그러므로 provider/worker 실패도 verification 실패와 같은 attempt 예산을 소비하고 같은 compute escalation을 받는다. 실패 class나 retryability는 bridge/core 입력에 없다. generated protocol도 `WorkerResultInput`에 `success`, `summary`만, `VerificationInput`에 `passed`, checks, reason만 노출한다. [`crates/loop-bridge/src/commands.rs:459-509`](../../crates/loop-bridge/src/commands.rs), [`packages/protocol/src/generated/types.ts:380-399`](../../packages/protocol/src/generated/types.ts)

orchestrator는 worker 결과의 `failure.retryable`과 kind를 알고 있지만, 먼저 위의 untyped 실패를 기록한 뒤 일부 non-retryable/authentication/quota에 별도 attention을 추가한다. 즉 retry 여부의 최종 전이는 여전히 core의 단일 `max_attempts` 규칙이며, adapter 사실과 durable failure taxonomy가 연결되어 있지 않다. [`packages/orchestrator/src/task-execution.ts:116-123`](../../packages/orchestrator/src/task-execution.ts)

## 2. 원자성 보장과 공백

| 경계 | 현행 보장 | 공백 / crash 직후 durable 상태 |
| --- | --- | --- |
| store의 단일 append/batch | `BEGIN IMMEDIATE` 후 기존 projection을 읽고 모든 event를 순서대로 검증한다. event log, workers/tasks/attempts index, projection cache를 모두 쓰고 한 번 commit한다. 중간 오류는 batch 전체를 남기지 않는다. | process 밖 side effect와는 transaction이 아니다. provider 실행·검증 process 상태는 DB commit과 원자적이지 않다. |
| worker 성공 결과 내부 | `WorkerFinished`와 `TaskOutputRecorded`는 같은 batch다. summary만 저장되고 worker가 active로 남는 반쪽 성공은 없다. | `recordWorkerResult`와 실제 checks/`recordVerification`은 분리되어 있다. crash 시 task는 `Verifying`, output은 존재하고 Done은 아니다. |
| worker 실패 결과 내부 | `WorkerFinished`와 `VerificationFailed`가 같은 batch라 active worker 제거, attempt 증가, retry/소진 판정은 함께 commit된다. | 소진 후 `AttentionCreated`는 `ensure_failure_attention`의 다음 transaction이다. 그 사이 crash면 task=`Attention`, run=`Active`, open attention 없음이다. |
| receipt와 완료 판정 | receipt 자체는 durable하고 verification event 자체도 원자적이다. `VerificationPassed`의 evidence가 contract를 덮지 못하면 core guard가 transaction을 거부한다. | `recordCheckReceipts`와 `recordVerification`은 분리되어 있다. crash면 receipts가 있지만 task는 `Verifying`; receipts 자체는 Done evidence로 재사용되지 않는다. 반대로 bridge `VerificationPassed` evidence와 receipt의 일치 여부를 core/store가 대조하지 않는다. |
| task Done과 run 완료 | `VerificationPassed` 하나로 task Done과 attempt row done이 함께 commit된다. | 마지막 task의 `VerificationPassed` 뒤 projection 재조회와 `RunCompleted` append가 별도다. crash면 모든 task=`Done`, run=`Active`. `RunResumed`는 이런 상태를 `Completed`로 계산하지만 coordinator의 `execute`는 자동으로 `RunResumed`를 기록하지 않는다. [`crates/loop-core/src/event/reducer.rs:333-344`](../../crates/loop-core/src/event/reducer.rs), [`crates/loop-bridge/src/commands.rs:737-743`](../../crates/loop-bridge/src/commands.rs) |
| concurrent writers | transaction 시작 시 write lock을 먼저 잡고 projection을 읽어 stale projection에 대한 이중 전이를 막는다. owned append는 유효한 execution lease owner도 확인한다. | 여러 command로 나뉜 위 공백은 lease가 있어도 남는다. lease는 단일 writer를 제한할 뿐 command들을 하나의 transaction으로 합치지 않는다. |

중요한 세부사항: SQL `apply_indexes`의 `VerificationFailed` 분기는 먼저 task index를 `ready`로 쓰지만, 같은 transaction 끝의 `sync_projection_indexes`가 core projection의 최종 상태(`Ready` 또는 `Attention`)와 증가한 attempt를 `tasks.data_json`에 덮어쓴다. 따라서 정상 commit 뒤 index와 projection의 최종 task 상태는 일치한다. [`crates/loop-store/src/sqlite.rs:523-526`](../../crates/loop-store/src/sqlite.rs), [`crates/loop-store/src/sqlite.rs:632-654`](../../crates/loop-store/src/sqlite.rs)

## 3. crash·중단·복구 상태표

| 중단 지점 | DB에 남는 상태 | 현행 복구 동작 | attempt 영향 / 위험 |
| --- | --- | --- | --- |
| `recordWorkerStarted` 전 provider side effect | 정상 순서는 reservation을 먼저 기록하므로 해당 경로에서는 없음 | 시작 command 실패 시 provider를 시작하지 않는다. | attempt row 없음. |
| `recordWorkerStarted` 후, provider 결과 기록 전 process crash | task `Running`, active worker와 attempt row `a/running` | 새 coordinator는 active worker를 발견하면 recovery failure attention을 만들고 종료한다. 자동 재실행하지 않는다. 수동 `reconcileTask(confirmed_stopped=true)`가 task를 `Ready`로 되돌리고 worker를 cancelled 처리한다. | reconcile은 attempt를 증가시키지 않는다. 같은 `a`로 다시 `WorkerStarted`하면 attempts PK 충돌 가능성이 있다(아래 미확인 위험). |
| provider start가 timeout/abort되어 생존 여부 불명 | durable task는 `Running`; 실제 process 존재 여부 불명 | orchestrator가 startup attention을 만들고 reservation을 유지하며 명시 reconcile을 요구한다. | attempt 증가 없음; 중복 side effect 방지 쪽으로 fail-closed. [`packages/orchestrator/src/task-execution.ts:64-76,134-137`](../../packages/orchestrator/src/task-execution.ts) |
| worker success batch 후 checks 전/중 crash | task `Verifying`, active worker 없음, output 저장, attempt row `verifying` | 새 coordinator는 verifying task에 recovery attention을 만들고 종료한다. `stopVerification`도 cancellation 중이 아니면 task/run attention과 recovery attention을 만든다. reconcile 뒤 Ready. | attempt 증가 없음; worker 작업을 다시 수행하게 될 수 있다. |
| check receipts commit 후 verification 전 crash | 위와 같고 previous checks만 추가 저장 | receipts를 자동 판정에 재사용하지 않고 verifying recovery로 간다. | 검증 process가 이미 끝났어도 pass/fail을 자동 확정하지 못한다. |
| `VerificationFailed` commit 후 소진 attention 전 crash | task `Attention`, run `Active`, open attention 없음 | coordinator가 runnable task를 찾지 못하면 generic blocked failure attention을 만든다. 원래 failure attention의 정확한 생성은 재개 시 보장되지 않는다. | increment와 소진 판정 자체는 이미 durable. |
| 마지막 `VerificationPassed` commit 후 `RunCompleted` 전 crash | 모든 task `Done`, run `Active` | `resumeRun` event를 명시적으로 넣으면 reducer가 Completed로 바꾼다. 단순 `execute`는 runnable 없음으로 generic blocked attention을 만들 수 있다. | 완료 진실성은 보존되지만 run 종결성이 깨진다. |
| append transaction 도중 crash | SQLite가 batch 전체를 commit했거나 rollback한다. projection cache도 같은 transaction이다. | 다음 projection load는 유효 cache를 쓰거나 event replay한다. | 반쪽 attempt 증가나 반쪽 event batch는 없다. |

`SqliteStore::recover_run`은 event를 replay하고 관측되지 않은 active worker를 **반환 projection 안에서만** `Attention`/lost로 표시한다. 이 함수 자체는 event나 attention을 persist하지 않는다. 현재 TypeScript coordinator는 이 API를 호출하지 않고 snapshot을 직접 검사한다. 별도의 `LoopRuntime.recover`도 worker를 observe해 attention만 추가하며 task reconciliation은 하지 않는다. [`crates/loop-store/src/sqlite.rs:221-258`](../../crates/loop-store/src/sqlite.rs), [`packages/orchestrator/src/coordinator.ts:132-143`](../../packages/orchestrator/src/coordinator.ts), [`packages/orchestrator/src/runtime.ts:104-118`](../../packages/orchestrator/src/runtime.ts)

## 4. Blocked-terminal과 dependency 전파 현황

| 항목 | 현행 사실 | 후속 정책과의 차이 |
| --- | --- | --- |
| `TaskState::Blocked` | Rust와 generated protocol에 존재한다. | 이름만으로 terminal이 아니다. `is_terminal`은 `Done | Failed | Cancelled`만 포함한다. |
| Blocked 전이 | core transition 표에는 `Pending → Blocked`, `Blocked → Ready|Cancelled`가 있다. | 조사 범위 내 event reducer/bridge/orchestrator에는 `Pending → Blocked`를 발생시키는 event/command가 없다. |
| failed dependency 전파 | snapshot의 `blockedBy`는 dependency가 Done이 아닌지를 계산한 표시값이다. | 후손 task를 durable terminal state로 바꾸지 않는다. |
| retry 소진 | task `Attention`, 이어서 run attention. | `Failed` terminalization이 아니며 후손 `Blocked-terminal`/`Cancelled` 전파도 없다. |
| runnable 없음 | orchestrator가 run-level generic failure attention을 만든다. | 실패 원인·후손·독립 branch를 typed policy로 구분하지 않는다. [`packages/orchestrator/src/coordinator.ts:217-222`](../../packages/orchestrator/src/coordinator.ts) |
| run failure | protocol `RunState`에 `failed` 문자열은 있다. | 조사한 event enum에는 run failure event가 없고, 이 경로에서 run을 `Failed`로 만드는 실행이 없다. |

따라서 후속 구현에서 기존 `Blocked`를 그대로 “Blocked-terminal”로 재해석하면 안 된다. 대안은 (A) 별도 terminal variant를 추가하거나, (B) `Blocked`에 terminal reason/policy를 결합하고 `is_terminal` 및 허용 전이를 바꾸는 것이다. A는 의미가 명확하고 migration/codegen 영향이 크며, B는 wire variant 추가가 적지만 기존 non-terminal `Blocked → Ready` 의미와 충돌한다. 현행 사실에 가장 안전한 기본안은 **별도 terminal 상태 또는 명시적 terminalization outcome을 추가**하는 것이다.

## 5. 후속 구현이 받아야 할 확정 상태표

후속 작업 2–6은 다음을 현행 baseline으로 사용해야 한다.

1. `WorkerStarted(a)`가 attempt row를 만들고, 실패 event가 projection attempt를 `a+1`로 만든다. attempt 소비의 단일 durable 지점은 현재 `VerificationFailed`다.
2. worker 실패와 verification 실패가 같은 event kind와 예산을 공유한다. failure class/retry scope 도입 전에는 transient와 deterministic을 저장된 history로 구별할 수 없다.
3. `recordWorkerResult(success=true)`의 원자 단위는 `WorkerFinished + TaskOutputRecorded`이며 completion은 포함하지 않는다. 이 분리는 유지해야 한다.
4. `recordWorkerResult(success=false)`의 원자 단위는 `WorkerFinished + VerificationFailed`이지만, 소진 attention은 포함하지 않는다.
5. `recordVerification`의 원자 단위는 verification event 하나다. receipts, exhaustion attention, `RunCompleted`는 포함하지 않는다.
6. Done guard는 non-empty completion contract의 모든 check id가 true인 evidence를 요구한다. `passed=true`만으로 우회되지 않는다.
7. 현행 소진 outcome은 `Attention`; `Failed`, dependency terminalization, 독립 branch 지속은 새 core 정책으로 명시해야 한다.
8. crash recovery는 unknown process를 자동 retry하지 않고 attention + explicit reconcile로 닫는다. 중복 실행 가능성이 있는 경우 이 fail-closed 성질을 보존해야 한다.

## 6. 미확인·미해결 위험

1. **reconcile 후 attempts PK 충돌:** `TaskExecutionReconciled`는 attempt를 증가시키거나 기존 attempt row를 닫지 않고 task를 `Ready`로 만든다. 다음 `WorkerStarted`는 같은 `(run, task, attempt)`을 insert하므로 실제 재실행이 unique constraint에 걸릴 가능성이 높다. 후속 구현 전에 focused regression test로 확정해야 한다. [`crates/loop-core/src/event/reducer.rs:269-287`](../../crates/loop-core/src/event/reducer.rs), [`crates/loop-store/src/sqlite.rs:479-499`](../../crates/loop-store/src/sqlite.rs)
2. **소진 attention crash window:** 소진 전이와 attention 생성이 분리되어 task `Attention`/run `Active`/attention 없음 상태가 가능하다. 새 원자 command가 함께 기록해야 한다.
3. **all-Done/run-Active crash window:** task 완료와 run 완료가 분리되어 거짓 완료는 없지만 자동 종결이 보장되지 않는다. 마지막 verification outcome과 run terminalization을 같은 core/store command에서 결정할 필요가 있다.
4. **receipt/evidence 결합 부재:** check receipt와 boolean evidence가 별도 event이며 상호 검증되지 않는다. audit receipt를 completion evidence의 authoritative 입력으로 만들지 여부를 결정해야 한다.
5. **복구 경로 불일치:** store `recover_run`, coordinator startup recovery, `LoopRuntime.recover`가 서로 다른 책임과 attention id 형식을 가진다. 하나의 durable core outcome으로 수렴하지 않으면 중복 attention 또는 상태 drift가 남는다.
6. **saturating attempt:** attempt 증가는 `saturating_add(1)`이다. exhaustion 뒤 사람 retry를 반복하면 attempt가 max를 넘은 채 계속 Ready로 되돌아갈 수 있고, 새 attempt row 번호만 증가한다. 새 retry budget은 소진 후 재개 의미를 명시해야 한다.
7. **현재 worktree의 quota fallback:** provider quota fallback은 동일 scheduler attempt/reservation 안에서 여러 handle을 순차 사용한다. 따라서 provider handle 수와 durable attempt 수는 일치하지 않는다. retry 계측에서 둘을 분리해야 한다. [`packages/orchestrator/src/task-execution.ts:58-115`](../../packages/orchestrator/src/task-execution.ts)

## 정책 안전 불변식 확인

- worker 성공만으로 `Done`이 되지 않는다.
- verification 실패를 생략하거나 summary로 대체해 `Done`으로 만드는 경로는 없다.
- approval 자동 승인은 이 결과 기록·복구 경로에 없다.
- 다만 retry 소진은 아직 terminal failure가 아니라 human failure attention이며, 후속 정책 구현 대상이다.
