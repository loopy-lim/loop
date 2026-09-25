# 네트워크 stall 시 worker run hang 진단

## 결론 / root cause

일반 프로세스 기반 provider의 stall은 **모델 스트림을 소비하는 코드라기보다 worker subprocess의 종료를 기다리는 경로**에서 영구 대기한다. `NodeProcessRunner.start()`의 `result`는 child `exit`/`close` 이벤트(또는 spawn error)가 있어야 resolve한다(`packages/providers/src/process.ts:97-112`). 실행 프로세스가 살아 있는 채 네트워크 응답을 기다리면 이벤트가 오지 않으므로 결과 Promise가 끝나지 않는다. `ProcessRunner.start`에는 호출 timeout 옵션이 없고, runner의 `probeTimeoutMs`는 `probe()`에만 적용된다(`process.ts:31-35, 44-48, 51-68`).

결과를 기다리는 다음 연결고리는 `ProcessProvider.startProcess()`가 `process.result.then(...)`을 worker result로 전달하는 곳(`packages/providers/src/process-provider.ts:82-100`)이며, `executeTask()`는 `provider.result(handle.id)`를 취소 signal에만 race한다(`packages/orchestrator/src/task-execution.ts:87-93, 155-160`). run 취소가 없는 한 이 대기는 제한 시간이 없다. 따라서 coordinator는 해당 `task.done`이 끝나지 않는 동안 계속 poll할 뿐 완료 상태를 만들 수 없다(`packages/orchestrator/src/coordinator.ts:226-227`).

이는 모든 공급자에 공통인 사실은 아니다. Antigravity persistent driver는 턴별 timer를 두고 timeout 시 `timeout`, `retryable: true`를 반환한다(`packages/providers/src/antigravity/driver.ts:172-190`). 해당 구현의 작동 여부와 provider별 네트워크 계층은 별도로 테스트해야 한다. 반면 일반 process provider에선 runner가 child 종료 전 timeout 결과를 만들지 않는다.

## 기존 timeout / retry 경로와 갭

- `process.ts`의 `cancelGraceMs`, `killWaitMs`는 명시적으로 `cancel()`이 불린 뒤 프로세스를 정리하는 유예 시간이지, 무응답 감지 timer가 아니다. `probeTimeoutMs` 역시 probe만 제한한다.
- `process-provider.ts`의 `classifyFailure()`는 이미 생성된 종료 결과의 텍스트에서 timeout/deadline을 분류하고 이를 retryable로 지정한다(`:224-238`). 무한 대기에서는 결과 문자열/WorkerResult가 없으므로 분류 코드까지 도달하지 않는다. 즉 단순히 분류 정규식을 추가해도 해결되지 않는다.
- `task-execution.ts`의 worker 결과 처리에서 retryable 실패를 durable `recordWorkerResult`로 남기고 돌아온다(`:116-124`). 비재시도 실패 및 auth/quota는 attention으로 올리지만, retryable 실패는 여기에 직접 attention을 요청하지 않는다. 그 이후 attempt 재시도/attention 정책은 Rust core 및 상위 run 제어 흐름이 소유한다. `failure.rs`는 FailureClass별 retry budget/backoff/소진 동작을 결정하는 순수 정책(`crates/loop-core/src/policy/failure.rs:135-169`)이지만, 여기서 process timeout 자체를 감지하지 않는다.
- startup 30초(`task-execution.ts:171-181`)와 worker cleanup 5초(`:25-33`) 제한은 worker 실행 결과 대기와 별개다. completion check timeout도 provider 실행 시간을 제한하지 않는다.

## 권장 수정 위치와 계층

1. **감지는 provider adapter 경계**(`packages/providers/src/process.ts` 또는 process-provider 옵션)에서 한다. 전체 worker 실행 deadline을 명시적으로 받고 만료 시 `cancel()` 후 timeout을 나타내는 `WorkerResult { failure: { kind: "timeout", retryable: true } }`를 반환한다. 더 세밀한 stall 의미가 필요하면 전체 deadline보다 “마지막 출력 이후 idle timeout”을 별도 정책으로 설정하되, 조용히 생각 중인 정상 모델 호출을 잘라낼 수 있다는 트레이드오프를 고려한다.
2. `process.ts`는 현재 `RunningProcess.result`가 exit에만 의존하므로 timeout 만료 후 cancel이 실제 프로세스 종료를 기다리다 무한정 멈추지 않는지도 보장해야 한다. 반환/kill 정책은 runner가 소유하고, provider adapter가 process internals를 재구현하지 않도록 한다.
3. 재시도 횟수와 backoff는 adapter에 넣지 말고 orchestrator/core retry 정책에서 관리한다. provider는 분류된 retryable failure만 전달한다. retry가 소진되었을 때 attention 승격은 run 정책의 명시적 결과로 연결한다. 이는 provider→orchestrator→core 경계를 지키는 변경이다.

대안: **고정 전체 턴 deadline**은 단순하고 fake timer로 결정적으로 검증 가능하지만 긴 정상 응답도 중단할 수 있다. **출력 idle timeout**은 네트워크 stall을 직접 탐지하지만 출력이 드문 정상 작업의 false positive 위험이 있고, 스트림 이벤트/heartbeat 계약이 필요하다. 가장 작은 우선 수정은 전체 턴 상한을 설정 가능하게 도입하고, idle timeout은 실제 provider 특성과 관측 근거가 있을 때 추가하는 것이다.

## fake 기반 재현/검증

- 현행 재현: `FakeProcessRunner`(또는 `ProcessRunner` 테스트 double)의 `start()`가 handle을 즉시 반환하고 `result` Promise는 resolve하지 않도록 만든다. Fake process-provider의 `result(handle.id)` 역시 그 Promise를 노출한다. `executeTask(...).done`가 미완료 상태로 남는지 확인한다. fake result를 reject/resolve할지와 무관하게 이 검사는 네트워크/유료 호출이 없다.
- 수정 후 테스트: 짧은 설정 timeout으로 위 fake stalled process를 구동하고, timeout 전에 task가 끝나지 않음을 확인한 뒤 timeout 후 `timeout + retryable:true` 실패 및 runner cancel 호출을 검증한다. orchestrator integration test에서는 retry budget이 남으면 다음 attempt가 시작되고, 예산 소진이면 attention 또는 설정된 terminal 상태로 끝나는 것을 확인한다.
- 별도 확인: fake provider만으로 process-runner의 실제 child kill 동작은 입증되지 않는다. 실제 네트워크 없이 `sleep`/무응답 로컬 subprocess를 쓰는 runner 단위 테스트로 timeout 후 프로세스 정리까지 확인해야 한다.

## 구현 결과 (stall-implementation)

- `NodeProcessRunner`가 설정 가능한 `runTimeoutMs`를 제공하며 기본값은 **30분(1,800,000ms)**이다. deadline은 worker 실행 전체 시간에 적용된다.
- 만료 시 runner가 프로세스 그룹에 TERM, 유예 만료 시 KILL을 보내며 timeout 결과를 반환한다. 종료 확인/결과 대기는 유한한 grace/kill wait로 제한해 cancel이 무기한 기다리지 않는다. 결과 stderr의 timeout 표식을 기존 provider 분류기가 `timeout`, retryable로 변환한다.
- Orchestrator는 timeout retryable 결과를 기록하고 task의 retry attempt가 소진된 경우 failure attention을 요청한다. 재시도/backoff 결정은 provider adapter가 소유하지 않는다. Core `FailurePolicy`의 `RequireAttention` exhaustion도 단위 테스트로 검증한다.
- Fake 없이 subprocess 기반 테스트는 deadline 전 미완료 및 deadline 후 retryable timeout을 확인한다. Persistent fixture는 재시도 및 소진 attention을 유료 모델 호출 없이 확인한다.

남은 위험: 30분은 전체 턴 상한이므로 정상적인 장시간 실행도 종료할 수 있다. 실제 provider별 적정값은 운영 측정에 따라 조정해야 한다. Windows는 process-group kill 경로가 아니며 별도 플랫폼 검증이 필요하다.
