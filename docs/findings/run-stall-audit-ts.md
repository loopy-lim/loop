# TS 오케스트레이터/워커 경로 stall 후보 감사

범위: `packages/orchestrator/src/**`, `packages/herdr/src/**`. 정적 소스 감사이며, 아래 순위는 코드 경로의 무기한 대기 가능성·영향 범위 기준이다. 동기적 외부 호출/저장소 호출의 내부 타임아웃은 이 범위만으로 확인할 수 없다.

## 결과 요약 — 상위 3개

1. **취소 후 워커 종료·정리 대기** — `packages/orchestrator/src/coordinator.ts:243-246`, `packages/orchestrator/src/task-execution.ts:144-148,263-276`. 디스패처는 취소 시 모든 `task.done`을 무기한 기다린다. abort는 provider 결과 race를 깨지만 뒤따르는 `provider.cancel`, release(일부 경로 최대 5초), 컨트롤 기록 및 finally 정리 호출은 별도 timeout이 없거나 거부/정지할 수 있다. 따라서 취소가 걸린 실행 전체를 붙잡을 수 있다.
2. **Herdr CLI 호출의 timeout 미전파/유효성** — `packages/herdr/src/client.ts:76-90,107-110`, 사용처 예 `:147-174,375-397,659-660`. 기본 CLI runner 자체는 15초 timeout과 SIGTERM/SIGKILL을 갖지만 임의 주입 `HerdrRunner`는 이 계약을 보장하지 않는다. 한 CLI 호출이 resolve되지 않으면 start/cancel/status/cleanup 호출자도 정지하고, `cancel`의 외부 grace deadline도 각 status 호출 대기 중에는 확인되지 않는다.
3. **실행 소유권 정리(finally)의 무기한 대기** — `packages/orchestrator/src/coordinator.ts:376-380`. 종료 때 heartbeat 완료, mailbox tap 정지, execution lease 해제를 순차 await한다. mailbox `stop()`은 진행 중인 poll/drain 완료를 기다리고(`packages/orchestrator/src/mailbox.ts:273-276,364-373`), control 호출 역시 이 TS 계약상 timeout이 없다. 어느 하나가 멈추면 execute 반환 및 소유권 정리가 막힌다.

## 남은 후보 (가능성 높은 순)

### 1. 취소/중단 경로에서 provider 및 control 정리 대기 — 높음

`task.done`의 취소 대기는 제한 시간이 없다 (`packages/orchestrator/src/coordinator.ts:243-246,367-369`). worker는 결과를 abort race로 끊은 뒤 취소·release·상태 기록을 직렬로 수행한다 (`packages/orchestrator/src/task-execution.ts:144-149`). 취소 외 오류 처리 및 finally에서도 cancel/release/control 기록이 순차 대기한다 (`:255-276`). release만 `bounded(..., 5000)`이며(`:81-92`), provider.cancel과 control API는 여기서 제한되지 않는다. 일부 예외 경로의 provider.release는 해당 bounded wrapper가 아니라 직접 호출된다 (`:125`). **재현/완화 권고:** provider 어댑터 계약에 취소/정리 deadline을 적용하고, abort 후 task 종료 대기를 제한해 미확인 정리를 attention/reconcile로 전환한다.

### 2. Herdr 명령의 runner 계약·취소 폴링 — 높음

기본 `ProcessHerdrRunner.run`은 timeout 후 TERM/KILL하고 close/error에서 resolve한다 (`packages/herdr/src/client.ts:71-110`). 그러나 `HerdrWorkerRuntime`은 `HerdrRunner`를 주입받으므로 모든 구현이 그 timeout을 갖는다고 보장되지 않는다. 모든 명령은 `#run`을 통해 runner 완료를 기다린다 (`:659-660`). 특히 cancel은 send-keys 완료 후 grace deadline을 만들지만, 각 `#statusForCancel` await가 정지하면 deadline 루프조차 진행하지 못한다 (`:375-397`). **권고:** runtime 경계에서 runner 호출 자체를 제한하고, cancel의 전체 작업(deadline 포함)을 감싸며 타임아웃을 명시적 미확인 상태로 기록한다.

### 3. Dispatcher 종료의 비제한 cleanup 체인 — 중상

`finally`는 heartbeat, mailbox, lease 해제를 차례로 기다린다 (`packages/orchestrator/src/coordinator.ts:376-380`). mailbox stop은 tap promise가 끝나길 기다리고, tap은 subscribe/drain 및 sleep 루프에 의존한다 (`packages/orchestrator/src/mailbox.ts:273-276,364-373`). poll chain은 실패를 삼켜 다음 tick 재시도하지만, pending 호출이 영구 미완료면 이후 poll/stop도 진행하지 않는다 (`:380-383,386-387`). **권고:** shutdown signal로 poll/drain을 중단 가능하게 하고, finally 각 단계에 bounded cleanup과 실패 보고를 둔다.

### 4. 시작 타임아웃 이후 늦은 handle 정리의 fire-and-forget — 중간

startup은 30초 후 `StartupUncertain`을 던져 실행 경로를 풀어주므로 직접적인 stall은 제한된다 (`packages/orchestrator/src/task-execution.ts:295-305`). 다만 늦게 성공한 start의 cancel/release는 분리된 비동기 체인으로 실행되며 그 완료를 기다리거나 결과를 durable하게 기록하지 않는다 (`:120-127`). 정리 요청이 멈추거나 실패하면 외부 worker가 남을 수 있다. **권고:** 미확정 시작은 attention/reconcile 계약을 유지하고, 늦은 handle cleanup을 관측·추적 가능하게 한다.

### 5. Provider capability lookup watchdog은 dispatcher 응답성에 한정 — 낮음

`selectWhileActive`는 30초 deadline과 50ms polling을 제공한다 (`packages/orchestrator/src/coordinator.ts:387-395`). 다만 `stillActive()`의 control snapshot 호출 자체가 멈추면 deadline 검사 전에 정지할 수 있다. 현재 timeout은 선택 promise를 취소하지 않으므로 underlying provider lookup이 계속 실행될 수도 있다. **권고:** control 호출 경계에도 timeout을 두고, 가능하면 capability lookup에 AbortSignal을 전달한다.

## 판단 경계

이 항목들은 코드상 대기 취약점 후보이지 특정 런의 stall 원인 확정이 아니다. 기본 Herdr 프로세스 runner 및 provider/bridge 내부 timeout 구현, 실제 이벤트 타임라인은 별도 실행 로그와 구현체를 대조해야 한다. `coordinator`는 50ms 주기로 상태를 확인하고 provider lookup에는 별도 30초 제한이 있어 정상 worker 완료를 기다리는 루프 자체는 의도된 대기다 (`packages/orchestrator/src/coordinator.ts:364-365,387-395`).
