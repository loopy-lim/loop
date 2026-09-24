# 자율 완료·검증 계약 사실 조사

- 조사일: 2026-09-25
- 대상: `loop-core`의 task/scheduler, orchestrator 실행·검증 경로, reliable-runs 문서
- 목적: 작업자 성공 보고와 실제 완료를 분리하고, 검증 실패·재시도 소진을 사람 질문 없이 안전하게 종결할 수 있는 정책 후보를 찾는다.

## 범위와 근거 수준

이 문서는 지정된 read scope의 저장소 소스와 1차 문서만 근거로 삼았다. 요청에 포함된 `docs/research/test-gap-map.md`는 현재 worktree에 존재하지 않아 확인하지 못했다. 상태 변경을 실제로 영속화하는 generated protocol/bridge/store 구현은 read scope 밖이므로, 그 내부의 attempt 증가 및 분기 규칙은 사실로 단정하지 않는다. 아래에서 **확인**은 읽은 코드에 직접 존재하는 동작, **경계 밖**은 control 호출 너머에서 확인해야 하는 동작, **후보**는 향후 정책을 뜻한다.

## 핵심 결론

1. 작업자의 `success`는 완료가 아니다. orchestrator는 결과를 먼저 기록한 뒤에만 completionChecks를 실행하고, core는 `Verifying` 상태이면서 모든 계약 check의 evidence가 `true`일 때만 `Done`을 허용한다.
2. 빈 completion contract는 core builder가 거부하므로 fail-open은 아니다. 그러나 check의 **의미적 강도**는 검증하지 않는다. 항상 0으로 종료하는 명령도 유효하며 실제 benchmark fixture가 이 형태다.
3. 검증기는 check를 순차 실행하고 timeout 또는 non-zero exit만 실패로 본다. requirement 충족, 산출물 변경, declared scope 준수, worker summary의 진실성은 completionCheck 자체가 검사하지 않으면 알 수 없다.
4. `attempt`/`max_attempts` 데이터와 재시도 가능한 상태 전이는 있지만, 조사 범위 안에는 worker/verification 실패 종류를 재시도·종결 정책으로 매핑하는 단일 규칙이 없다. 특히 검증 실패에는 retryability 분류가 없다.
5. 현재 orchestrator의 최종 안전망은 “runnable task가 없으면 attention”이다. 따라서 모호한 검증 실패, 소진, 막힌 dependency는 일반적인 사람 개입으로 수렴하며 자동 terminalization 계약은 보이지 않는다.

## 완료 판정 코드 경로

```text
Ready/Pending + dependencies done
  -> scheduler claim
  -> recordWorkerStarted
  -> provider.result
     -> worker failure: recordWorkerResult(success=false), 일부 환경 실패는 attention
     -> worker success: recordWorkerResult(success=true)
        -> completionChecks 순차 실행
        -> check receipt 저장
        -> recordVerification(passed, evidence, reason)
           -> 모두 true: Verifying -> Done
           -> 하나라도 false/실행 예외: Verifying -> Ready | Attention | Failed
              -> Ready이면 scheduler가 다시 claim할 수 있음
              -> runnable 없음 + run active이면 generic blocked attention
```

### 단계별 확인 사항

| 단계 | 확인된 동작 | 근거 |
| --- | --- | --- |
| 계약 구성 | completion contract는 최소 한 check가 필요하고, check id/command는 비어 있지 않아야 하며 id는 유일하고 timeout은 양수여야 한다. 기본 `max_attempts`는 3이다. | `crates/loop-core/src/task/task.rs:128,175-184,202-213` |
| 배정 | scheduler는 `Pending` 또는 `Ready`이고 dependency가 모두 done인 task만 claim한다. Decision/Integration은 직렬화된다. | `crates/loop-core/src/scheduler/scheduler.rs:17-43`, `crates/loop-core/src/task/kind.rs:15-17` |
| worker 결과 | provider 결과를 받은 뒤 `recordWorkerResult`를 호출한다. `success=false`이면 completionChecks를 실행하지 않는다. | `packages/orchestrator/src/task-execution.ts:116-123` |
| 환경 실패 | worker가 non-retryable이라고 보고하거나 failure kind가 authentication/quota이면 별도 failure attention을 요청한다. 이 판단은 worker 결과를 기록한 **뒤** 수행된다. | `packages/orchestrator/src/task-execution.ts:116-121` |
| 검증 실행 | worker success 뒤 `verifier.verify(context.task.completionChecks, ...)`를 호출한다. check는 배열 순서대로 실행된다. | `packages/orchestrator/src/task-execution.ts:125`, `packages/orchestrator/src/completion.ts:37-58` |
| check 판정 | timeout이 아니고 exit code가 0일 때만 개별 check가 pass다. cwd는 project root 내부의 realpath로 제한하고 timeout은 양의 safe integer인지 재검사한다. | `packages/orchestrator/src/completion.ts:45-54,88-106` |
| 증거 저장 | command/args/cwd/exit/stdout/stderr/timeout/duration receipt를 먼저 기록하고, 모든 check의 `passed`를 `every`로 집계해 verification을 기록한다. | `packages/orchestrator/src/task-execution.ts:127-131` |
| 예외 | worker 완료 뒤 verifier/check 실행이 throw하면 빈 checks와 `passed:false`인 verification으로 기록한다. abort이면 `stopVerification`을 사용한다. | `packages/orchestrator/src/task-execution.ts:126,138-149` |
| Done guard | core는 현재 상태가 `Verifying`이고 계약에 선언된 모든 id의 evidence가 true인 경우에만 `Done`을 허용한다. 계약 자체도 non-empty여야 한다. | `crates/loop-core/src/task/contract.rs:55-61`, `crates/loop-core/src/task/task.rs:67-74` |
| 실패 후 상태 공간 | core가 허용하는 경로는 `Verifying -> Ready | Attention | Failed`; `Failed -> Ready`도 허용한다. `Done`, `Failed`, `Cancelled`는 terminal이다. | `crates/loop-core/src/task/task.rs:82-95`, `crates/loop-core/src/task/state.rs:16-18` |
| 재배정 | policy/control이 task를 `Ready`로 만들면 scheduler가 다시 claim할 수 있고, 다음 context의 attempt가 worker id와 attention id에 들어간다. | `crates/loop-core/src/scheduler/scheduler.rs:34-36`, `packages/orchestrator/src/coordinator.ts:168-195` |
| 최종 안전망 | active worker가 없고 run은 active인데 claim도 없으면 generic blocked failure attention을 만든다. | `packages/orchestrator/src/coordinator.ts:217-221` |

`docs/reliable-runs.md:32`도 “작업자의 성공 보고 이후에도 완료 조건의 명령이 통과해야 완료”라고 사용자 계약을 명시한다. 즉 현재 설계의 좋은 핵심은 **worker success와 verified completion의 분리**다.

### 경계 밖이라 확인되지 않은 부분

`recordWorkerResult` 및 `recordVerification`은 generated protocol을 통한 control 명령이다(`packages/orchestrator/src/control.ts`). 이 조사 범위에서는 다음을 확정할 수 없다.

- 정확히 어느 호출에서 `attempt`가 증가하는가.
- worker failure와 verification failure 각각이 몇 번째 실패에 `Ready`, `Failed`, `Attention`으로 가는가.
- `max_attempts` 도달 시 run 및 dependency가 자동 terminal 상태가 되는가.
- `retryable:false` attention 요청 전에 `recordWorkerResult`가 어떤 상태를 만들며 두 결정이 원자적인가.

따라서 위 흐름의 `Verifying -> ...` 분기는 core가 허용하는 상태 공간이고, 실제 선택 규칙은 bridge/store 정책 소스를 추가 조사해야 한다. 이 정책이 read scope 안에서 보이지 않는 것 자체가 orchestrator가 실패 분류를 일관되게 설명하거나 선제적으로 종결하기 어렵게 만드는 계약 가시성 문제다.

## completionChecks 부재·약화가 만드는 패턴

### 1. check가 아예 없음: 실행 전 거부, 질문보다는 준비 실패

`TaskBuilder::build`는 `EmptyCompletionContract`를 반환한다(`task.rs:183-184`). 따라서 정상 core 생성 경로라면 빈 checks가 성공으로 간주되지 않는다. 다만 `Orchestrator.run()`은 `prepare()`를 execute 바깥에서 호출하고(`coordinator.ts:69-75`), 이 범위에는 plan validation 오류를 구조화된 자동 보정이나 attention으로 바꾸는 로직이 없다. 결과적으로 잘못 분해된 task는 실행 중 질문이 아니라 **run 준비 자체의 예외**가 될 가능성이 있다.

자동화 관점의 공백은 “비어 있으면 거부”는 있지만 task kind/requirements에서 적절한 check를 합성하거나, 제출 전에 actionable validation report를 만드는 정책이 없다는 점이다.

### 2. 항상 성공하는 약한 check: 거짓 완료

core가 검사하는 것은 id/command/timeout의 구조와 선언 id별 boolean뿐이다. check가 requirement, write scope 또는 산출물과 관련 있는지는 검사하지 않는다. 실제 `benchmarkScenario`는 모든 stage에 `node --eval process.exit(0)`을 completionCheck로 둔다(`packages/orchestrator/src/benchmark.ts:140-149`). 이는 성능 fixture로는 타당하지만 contract API가 무의미한 check도 “강한 완료 증거”와 구별하지 못함을 입증한다.

이 경우 질문/실패는 현재 task가 아니라 downstream integration 또는 verification task에서 늦게 발생한다. 이미 `Done`인 선행 task의 잘못된 결과 때문에 dependency chain 끝에서 재시도하거나, runnable이 사라져 generic blocked attention으로 수렴할 수 있다.

### 3. 부분적인 check: 검사하지 않은 요구의 거짓 음성/양성

모든 **선언된** check가 pass하면 충분하다(`contract.rs:55-61`). requirements와 checks 사이 cardinality/coverage 연결이 없다. 예를 들어 “파일 존재”만 확인하면 내용의 정확성, 테스트 통과, 타입 검사, write scope 밖 변경 여부는 검증되지 않는다. 반대로 환경 의존 check 하나가 timeout이면 나머지 산출물이 옳아도 전체 task가 실패한다.

### 4. 운영상 잘못된 check: 같은 작업 전체를 재시도

존재하지 않는 cwd, root 밖 symlink, 잘못된 timeout 또는 process runner throw는 검증 예외가 되고, worker가 이미 성공한 뒤 `checks: []`, `passed:false`로 기록된다(`completion.ts:88-106`, `task-execution.ts:138-149`). 검증 계약 오류와 구현 오류를 구분하는 failure kind가 없으므로, policy가 단순 attempt 기반이면 worker를 다시 실행해도 같은 check가 반복 실패한다. 소진 뒤에는 사람에게 원인을 판별하게 할 가능성이 높다.

### 5. 불안정한 check: 분류·backoff 없는 반복

개별 evidence에는 timeout, exit code, stderr/stdout이 있지만 `recordVerification`에 전달되는 결정 입력은 `{id, passed}`와 합친 reason뿐이다(`task-execution.ts:127-131`). timeout/spawn/environment처럼 재시도 가치가 있는 실패와 deterministic assertion failure를 policy가 typed field로 받지 못한다. check별 retry, backoff, 동일 fingerprint 감지 없이 task 전체 attempt를 소비할 위험이 있다.

### 6. worker failure 메타데이터의 늦은 사용

orchestrator는 worker의 `failure.retryable`/`kind`를 알고도 먼저 일반 `recordWorkerResult(success=false)`를 호출하고, 이후 별도 attention을 요청한다(`task-execution.ts:116-121`). failure taxonomy가 core의 단일 결정 입력에 포함되지 않는다면 상태 전이와 attention 생성이 분리되어 경쟁하거나 중복될 수 있다. quota는 같은 reservation 안에서 provider fallback을 시도하는 좋은 예외지만, fallback이 소진되면 다시 generic failure/attention 경로다(`task-execution.ts:95-121`).

## 상위 5개 약점

| 순위 | 약점 | 영향 | 코드 근거 |
| ---: | --- | --- | --- |
| 1 | completionCheck의 의미적 coverage를 표현·검사하지 않음 | 항상-pass/부분 check가 `Done`을 만들어 “검증됨”의 신뢰를 훼손 | `contract.rs:55-61`; `benchmark.ts:140-149` |
| 2 | retry/exhaustion 결정 계약이 관찰 가능한 typed policy로 모이지 않음 | 같은 deterministic failure 반복, 소진 시 행동 예측 불가, 어댑터가 설명하기 어려움 | `task.rs:55,82-95`; `control.ts`; `task-execution.ts:116-131` |
| 3 | verification failure taxonomy가 boolean + 문자열 reason으로 축약됨 | timeout·환경 오류·assertion 실패·계약 오류를 서로 다른 방식으로 처리할 수 없음 | `completion.ts:45-54`; `task-execution.ts:127-131,149` |
| 4 | no-runnable의 기본값이 generic attention | dependency 실패/소진/중단 검증의 서로 다른 원인을 사람이 다시 진단해야 함 | `coordinator.ts:217-221` |
| 5 | worker 실패 분류와 상태 기록이 분리되고 분류가 늦게 적용됨 | non-retryable 실패도 일반 retry 상태를 먼저 거칠 수 있으며 원자적 정책 보장이 이 범위에 없음 | `task-execution.ts:116-121` |

## 사람 개입 없는 폴백 정책 후보

아래 후보는 “검증 없이 Done”을 허용하지 않는다. `Task::transition`의 `Done` guard를 유지하는 것이 안전 기준이다.

### 후보 A — 분류된 bounded retry 후 fail-closed terminalization (권고 기본값)

1. verification evidence를 `assertion | timeout | process_start | invalid_contract | interrupted | environment`처럼 typed failure로 정규화한다.
2. transient 종류만 짧은 check-level retry + bounded backoff를 허용한다.
3. deterministic assertion/invalid contract는 동일 worker 전체를 재실행하지 않거나 최대 1회만 수정 기회를 준다.
4. `max_attempts` 소진 시 task를 `Failed`로 terminalize하고 dependency subtree를 `Cancelled` 또는 명시적 `Blocked-terminal`로 닫아 run을 `completed_with_failures`/`failed`로 종결한다. 질문은 만들지 않는다.

**코드 근거:** terminal `Failed`가 이미 있고 `Verifying -> Failed`가 허용된다(`task.rs:89`, `state.rs:16-18`). check receipt에는 timeout/exit/output이 이미 있으므로 분류 입력을 만들 데이터도 있다(`task-execution.ts:127`).

**장점:** 거짓 성공 없이 가장 단순하고 예측 가능하다. **단점:** recoverable하지만 분류하지 못한 외부 장애도 자동 실패할 수 있다. run-level 실패 상태와 dependency terminalization 계약이 필요하다.

### 후보 B — 실패 task 격리 + 영향 없는 branch 계속 실행

소진 task를 `Failed`로 닫고, 그 task에 의존하는 후손만 terminal blocked/cancelled로 전파한다. 다른 독립 branch는 scheduler가 계속 실행한다. 마지막에 성공/실패를 함께 담은 terminal run summary를 만든다.

**코드 근거:** scheduler는 dependency done 여부를 task별로 판정하고 독립 task를 claim한다(`scheduler.rs:34-36`). task별 terminal state도 이미 존재한다. 현재 generic no-runnable attention(`coordinator.ts:217-221`)을 “남은 nonterminal task의 원인 분류 및 전파”로 대체할 수 있다.

**장점:** 한 branch 실패가 전체 유용한 결과를 막지 않는다. **단점:** `dependencies_done`만으로는 failed dependency 의미가 부족하므로 graph/policy에 terminal propagation 규칙이 필요하다. integration/decision처럼 전체 일관성이 필요한 serial node에는 적용하면 안 된다.

### 후보 C — 검증 전용 대체 경로(escalated verifier), 그래도 실패하면 종결

worker success 후 primary checks가 실패하면 worker를 즉시 재실행하지 않고, 저장된 receipt를 입력으로 verification-kind task 또는 더 강한 deterministic check bundle을 한 번 실행한다. 둘 다 실패하면 후보 A처럼 `Failed`로 닫는다.

**코드 근거:** `Verification` task kind와 serializable completion contract가 이미 있고(`task/kind.rs`), orchestrator는 worker와 독립된 `CompletionVerifier` seam을 주입받는다(`coordinator.ts:45-56`). receipt도 영속 기록된다.

**장점:** 구현 재실행 비용 없이 flaky/불완전 check를 교차 확인할 수 있다. **단점:** 대체 검증이 LLM 판단만이면 결정성이 약해진다. 어떤 check bundle을 신뢰할지 plan 시점에 선언해야 하며, 임의의 “검증자가 괜찮다고 함”으로 Done guard를 우회해서는 안 된다.

### 후보 D — 안전한 자동 취소(cancel-on-exhaustion)

산출물 보존보다 clean finish가 중요한 run profile에서는 retry 소진 또는 invalid completion contract를 만나면 전체 run을 자동 `Cancelled`로 닫고 정리 절차를 수행한다. 실패한 task를 Done으로 만들지 않는다.

**코드 근거:** `Cancelled`는 terminal이고 Running/Attention/Blocked 등에서 취소 전이가 존재한다(`task.rs:81,85,92,94`; `state.rs:16-18`). orchestrator에도 cancel drain 경로가 있다(`coordinator.ts:143-155`).

**장점:** 사람 없이 확실히 멈추며 불완전 결과의 후속 통합을 방지한다. **단점:** 독립 branch의 유용한 결과까지 포기한다. 원자적/배포성 작업에 적합하고 일반 research DAG의 기본값으로는 과도하다.

### 후보 E — 제한된 계약 자동 보정 후 재검증

검증 실행 자체가 `invalid_contract`(cwd 부재, 명령 부재, timeout schema 오류)일 때에만, allowlist된 repo 기본 검증(`bun run check`, package-local test 등)을 task kind/scope에 따라 선택해 한 번 대체한다. 대체 검증도 실패하거나 매핑이 없으면 자동 Failed 처리한다.

**코드 근거:** 현재 verifier는 안전한 cwd/timeout 경계를 이미 강제한다(`completion.ts:88-106`). 그러나 benchmark의 always-pass 사례처럼 임의 명령은 품질을 보장하지 않으므로 allowlist/configuration은 core가 아니라 orchestration configuration/plan construction 경계에 두어야 한다.

**장점:** 단순 plan 작성 오류를 사람 없이 복구한다. **단점:** 잘못된 기본 check가 거짓 신뢰를 만들 수 있다. repository별 설정 없이는 사용하지 않는 보수적 opt-in이어야 한다.

## 권고 조합과 아키텍처 경계

가장 단순하고 안전한 기본 조합은 **A + B**다.

- `loop-core`: typed verification outcome, attempt budget, exhaustion 및 dependency terminalization처럼 결정적인 정책을 소유한다.
- generated protocol: receipt의 원자료와 core가 필요로 하는 failure class를 전달한다.
- orchestrator: 명령 실행, process 오류 분류, backoff 수행만 담당하고 “몇 번 뒤 사람에게 물을지”를 임의 결정하지 않는다.
- UI/adapters: terminal failure를 표시하되 open attention을 자동 생성하지 않는다.

대안은 **C + A**다. 비용이 더 들지만 false negative가 비싼 integration/verification task에만 한 번의 escalated verifier를 허용한다. **D**는 atomic profile용 opt-in, **E**는 repository check catalog가 있는 경우에만 opt-in이 적절하다.

결정 작업에서 명시해야 할 최소 정책 키는 다음과 같다.

- task kind별 `on_exhaustion = fail | cancel_run | quarantine_branch | request_attention`
- failure class별 `retry_scope = check | worker | provider | none`, max count, backoff
- serial Decision/Integration의 기본 `on_exhaustion` (권고: fail run, 자동 부분 통합 금지)
- attention 허용 조건 (권고: 안전/권한/비가역 승인과 상태 불명확 cleanup/recovery에 한정)
- run terminal summary가 failed/cancelled branch를 표현하는 방식

## 추가 검증이 필요한 위험

1. generated protocol/bridge/store의 `recordWorkerResult`와 `recordVerification` 구현을 읽어 실제 attempt 증가·소진 전이를 확인해야 한다.
2. 빈 completionChecks가 protocol 입력에서 반드시 Rust `TaskBuilder`를 통과하는지 end-to-end test로 확인해야 한다.
3. verification exception의 `checks: []`가 declared contract와 어떻게 매칭되어 다음 상태를 만드는지 확인해야 한다.
4. non-retryable worker failure에서 `recordWorkerResult`와 `requestAttention` 사이 crash가 나도 일관된 상태인지 확인해야 한다.
5. `docs/research/test-gap-map.md`가 삭제/이동/미생성 중 무엇인지 확인하고, 관련 테스트 공백 근거가 있다면 본 문서에 후속 반영해야 한다.
6. 기존 검증 문서는 fake provider/local process 자동 검증만 보장하고 실제 인증 provider/Herdr E2E는 범위 밖이라고 명시한다(`docs/reliable-runs.md:40`, `docs/reliable-runs-verification.md:39-43`). 폴백 정책을 운영 기본값으로 삼기 전에 실제 adapter 장애 분류를 별도 검증해야 한다.
