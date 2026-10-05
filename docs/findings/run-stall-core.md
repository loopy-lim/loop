# Run Stall 진단 — core/store 스코프 (r4-core-store)

스코프: `loop-core` 디스패치 판정·리듀서 상태전이, `loop-store` 실행 임대(lease)·복구 의미론.
목적: "run이 non-terminal인데 살아있는 dispatch owner가 없어 진행이 멈추는" 경로를 Rust 쪽 상태 기계에서 전수 확인한다.

---

## 1. 디스패치 판정 상태 기계

### 1.1 게이트 입력과 판정 우선순위

- 게이트 입력은 `DispatchGate { run_state, has_open_attention }` 두 필드뿐이다
  (`crates/loop-core/src/scheduler/decision.rs:13-21`).
- `Scheduler::claim`의 우선순위 (`crates/loop-core/src/scheduler/scheduler.rs:36-47`):
  1. `run_state`가 `Active | Attention`이 아닌 값(pausing/paused/cancelling/terminal/미시작) →
     **`Paused`** (라이프사이클이 가장 강한 홀드; attention보다 우선).
  2. `Active` 또는 `Attention` 상태에서 열린 attention 존재 → **`AttentionHeld`**.
  3. `Active` + attention 없음 → capacity/conflict 스케줄러 실행. 빈 결과면 **`Empty`**,
     아니면 **`Claimed`**.
- 중요한 주석적 약속 (`decision.rs:52-56`): `Empty`가 "홀드 없는 유일한 빈 결과"이고
  "caller 쪽 blocked attention을 정당화하는 유일한 판정"이다. 즉 core는 `Empty`를
  스스로 해소하지 않으며, 해소 책임을 호출자에게 넘긴다. 아래 3절의 스톨 경로 다수가
  이 `Empty`를 잘못된 상태에서 반복 반환하는 형태다.

### 1.2 attention-hold: 열린 attention이 dispatch를 붙잡는 조건

- `AttentionCreated` (`crates/loop-core/src/event/reducer.rs:416-424`): cancelling /
  paused / pausing이 **아닌** 한 `run_state = Attention`으로 전환한다. terminal에서는
  `require_controllable`이 거부한다.
- `AttentionResolved` (`reducer.rs:427-447`): 열린 attention이 모두 사라지면
  `run_state = Active`로 복귀한다. cancelling/paused/pausing이면 라이프사이클을 건드리지 않는다.
- `RunResumed` (`reducer.rs:572-587`): 열린 attention이 남아 있으면 `Attention` 유지,
  모든 task Done이면 `Completed`, 아니면 `Active`.

### 1.3 terminal 전이

- terminal 집합은 `Completed | Failed | Cancelled` 뿐이다
  (`crates/loop-core/src/run/run.rs:26-29`).
- `RunCompleted` (`reducer.rs:453-485`): `Active` + 열린 attention 없음 + 전 task `Done`
  + goal criteria 전부 Verified + 미커버 requirement 없음 조건에서만 `Completed`.
- `RunCompleted`의 **자동 발행은 store의 `append_verification_owned` 한 곳뿐**이다
  (`crates/loop-store/src/sqlite.rs:58-71` → `append_batch_internal(..., auto_complete = true)`,
  자동완성 게이트 `sqlite.rs:117-135`: `run_state == Active && !has_open_attention() &&
  모든 task Done && criteria Verified`). `append_batch` / `append_batch_owned`는
  `auto_complete = false`이다 (`sqlite.rs:50-57`).
- `Failed`: `fail_run_when_all_tasks_are_terminal` (`reducer.rs:649-660`) — **`run_state
  == Active`일 때만** 평가되며, 전 task terminal + Failed/Blocked 1개 이상이면 `Failed`.
  `VerificationClassifiedFailure`의 InvalidContract 경로는 serial task에 한해 즉시
  `run_state = Failed`를 세팅한다 (`reducer.rs:407-413`).
- `Cancelled`: `RunCancelled` (`reducer.rs:561-570`), in-flight work가 남으면 거부.
- terminal 이후에는 `require_controllable`이 모든 제어 이벤트를 거부한다
  (`reducer.rs:678-685`). 유일한 재시작 구멍은 `RunResumed`인데, 이 역시
  terminal에서는 거부된다 — terminal은 되돌릴 수 없다는 설계다.

---

## 2. 실행 임대(lease)가 claim/append를 게이트하는 방식

- **claim** (`crates/loop-store/src/sqlite.rs:230-245`): upsert. 선점은
  `expires_at <= now`(만료)일 때만 다른 owner가 가능하고, 미만료면 동일 owner의
  재-claim만 허용된다. TTL은 1초–60초로 강제된다 (`sqlite.rs:824`,
  `lease.rs`의 `ExecutionLeaseInput` 검증도 동일).
- **renew** (`sqlite.rs:251-265`): owner 일치 + 미만료일 때만 연장. 만료된 임대는
  renew 불가 — 반드시 claim으로 재획득해야 한다.
- **append 게이트** (`require_execution_owner`, `sqlite.rs:477-499`): owned append
  (`append_batch_owned`, `append_verification_owned`)는 "미만료 + owner 일치" 임대를
  요구한다. 만료 직후 임대 보유자는 **영구히 append 불가** — 이 불변식이
  `recycle_interrupted_execution`의 사망 판정 근거다
  (`crates/loop-bridge/src/execution/lease.rs:158-184` 주석).
- 단, `append_batch`(무소유)는 임대 검사를 완전히 우회한다 (`sqlite.rs:50-51`).
  사람/외부 resume 경로가 의도적으로 이 통로를 쓴다.
- **interrupted 사실 수집** (`interrupted_execution_claims`, `sqlite.rs:301-331`):
  `active_workers`에 남은 worker + `Verifying` 상태로 박힌 task만 수집한다.
  `TaskState::Attention`에 박힌 task는 수집하지 않는다(attention 흐름의 소관).
- **recycle** (`crates/loop-bridge/src/execution/lease.rs:162-211`): 새 owner가 임대를
  획득한 후 위 claims를 `TaskExecutionReconciled`로 ready 복귀시키고, 해당 task에 묶인
  열린 Failure attention을 `AttentionResolved(Retry)`로 함께 해소한다.
  reconcile(recycle)이 retry 해소를 자동으로 수행하는 유일한 무인 경로다.

## 3. 스톨(재디스패치 불가) 상태 목록

### S1. 만료된 lease + 열린 attention — 정상 게이트이나 무인 해소 수단 없음 (설계상 사람 개입)

열린 attention은 `AttentionHeld`를 강제하므로(scheduler.rs:37-41) 임대가 만료되어
새 owner가 claim해도 디스패치하지 않는다. 자동 해소는 `recycle`이 Failure attention만
처리하고(lease.rs:195-206), 이는 reconcile 대상 task(running/verifying)에 한정된다.
WorkerStopped/VerificationStopped이 만든 recovery attention(reducer.rs:541-560)은
사람 또는 외부 resume만 해소할 수 있다. → **확인된 스톨: crash 후 run이
`Attention` 상태로 남으면 재개는 외부 행위에 의존.** 기존 테스트:
`interrupted_claims_list_running_workers_and_verifying_tasks`
(`crates/loop-store/tests/recovery.rs:97-165`, reconcile이 유일한 회수 경로임을 검증).

### S2. `AttentionResolved(Retry)` 후 task가 `TaskState::Attention`에 잔류 → 영구 `Empty`

`AttentionResolved`는 attention 레코드와 run_state만 되돌리고 task 상태를 전이하지
않는다(reducer.rs:427-447). task를 `Attention → Ready`로 되돌리는 이벤트는
`TaskReady`(reducer.rs:272-277) 또는 `TaskExecutionReconciled`(reducer.rs:523-538)
뿐이다. resolve 시 `TaskReady`가 함께 append되지 않으면: run은 `Active` + 열린
attention 없음 + claimable task 없음 → 판정은 `Empty`(`AttentionHeld`가 아님) →
decision.rs:52-56의 약속대로 caller가 blocked attention을 raise해도 자동 재개
로직이 없으면 영구 스톨. (bridge의 정상 호출자는 TaskReady를 함께 append한다 —
`crates/loop-bridge/src/commands/guidance.rs:317` — core 계약상 강제가 아님.)

### S3. VerificationFailed 소진과 failure attention 생성 사이의 두 커밋 공백

VerificationFailed 소진은 task만 `Attention`으로 전이하고 attention 레코드를 만들지
않는다(reducer.rs:368-381). failure attention은 bridge가 **별도 커밋**으로 생성한다
(`crates/loop-bridge/src/commands/task.rs:508-558`: `append_verification_owned` 후
`ensure_failure_attention` → 별도 `append_and_notify_owned`). 두 커밋 사이에서
프로세스가 죽으면: run `Active` + task `TaskState::Attention` + 열린 attention 없음
→ 판정 `Empty` → 영구 스톨. `interrupted_execution_claims`는 `Attention` task를
수집하지 않으므로(sqlite.rs:301-331) recycle로도 회수되지 않는다. **회귀 테스트 없음.**

### S4. 마지막 검증 시 attention이 열려 있으면 자동완성이 영구히 스킵됨

자동 `RunCompleted`는 `append_verification_owned` 커밋에서만 평가되고 게이트가
`!has_open_attention()`을 요구한다(sqlite.rs:117-135). 마지막 task가 `Done`이 되는
검증 이벤트가 열린 attention과 함께 커밋되면 자동완성은 스킵되고, 이후
`AttentionResolved`가 run을 `Active`로 되돌려도(reducer.rs:440-443) 자동완성을
다시 평가하는 커밋은 영원히 오지 않는다(verification append는 이후 없음).
결과: 전 task Done + criteria Verified + run `Active` + `Empty` 판정의 무한 럴.
외부 `RunResumed`는 이를 `Completed`로 만들 수 있으나(reducer.rs:580-583) 무인
경로는 없다. **회귀 테스트 없음.** (유사 케이스로, 모든 task가 terminal이 된
시점에 attention이 열려 있으면 `fail_run_when_all_tasks_are_terminal`도 스킵되고
`AttentionResolved`에서 재평가되지 않아 `Active`에 영구 잔류한다 — reducer.rs:649-660의
`run_state == Active` 전제와 440-443의 재평가 부재.)

### S5. 만료 안 한 lease + 죽은 owner — 임시 스톨 (바운디드)

임대는 최대 60초(sqlite.rs:824)이므로, owner가 죽어도 최대 TTL 후 선점 가능.
영구 스톨 아님. append 게이트도 동일 기간 후 해제. 기존 테스트:
`verification_completion_and_task_insertion_serialize_in_either_order`
(recovery.rs:47-74, 임대 경합에서 terminal 전이가 한 번만 일어남을 검증),
`reconciled_attempt_row_is_cancelled_then_reused_on_redispatch`
(recovery.rs:168-260, reconcile 후 재디스패치 직렬화 검증).

### S6. terminal — 되돌림 불가 (정상)

terminal run은 `require_controllable`이 모든 것을 거부하므로 외부 resume도 없다.
의도된 최종 상태이며 스톨이 아니다. 단 "terminal에 도달했어야 하는데 `Active`+
`Empty`에 갇힌" S3/S4가 실제 스톨이다.

---

## 4. 요약: core/store가 보증하는 것과 보증하지 않는 것

| 보증 | 근거 |
| --- | --- |
| 열린 attention ⇒ 디스패치 정지 (`AttentionHeld`) | scheduler.rs:36-47 |
| terminal은 되돌림 불가, 제어 이벤트 전면 거부 | run.rs:26-29, reducer.rs:678-685 |
| 만료 임대 보유자의 append 영구 차단 → 사망 판정의 durable 근거 | sqlite.rs:477-499, lease.rs:158-184 |
| running/verifying 잔여는 lease 획득자가 무인 회수 가능 | sqlite.rs:301-331, lease.rs:162-211, recovery.rs:97-165 |

| 미보증(스톨원) | 위치 |
| --- | --- |
| attention resolve가 task를 runnable로 되돌린다는 보장 | reducer.rs:427-447 (S2) |
| 소진→attention 생성의 원자성 | reducer.rs:368-381 + task.rs:508-558 (S3) |
| attention 해소 후 완료/실패 판정 재평가 | sqlite.rs:117-135, reducer.rs:440-443, 649-660 (S4) |

권고 방향(구현 워커용): (a) `AttentionResolved(Retry)` 배치에 task 전이를 강제하거나
리듀서에서 함께 처리, (b) verification + failure attention을 한 배치로 원자화,
(c) `AttentionResolved`에서 `fail_run_when_all_tasks_are_terminal` 및
"전 Done + criteria Verified ⇒ RunCompleted" 재평가를 리듀서/store 레벨로 승격.
어느 쪽이든 bridge 타입 변경은 불필요(이벤트 종류 동일)하므로 codegen 영향 최소.
