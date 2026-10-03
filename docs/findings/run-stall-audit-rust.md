# Rust 경로 런 스톨 후보 감사

범위: `loop-core`, `loop-bridge`, `loop-store`의 상태 전이, 작업 claim, 실행 lease 및 복구 경로. 이는 코드 정적 감사 결과이며, 아래 항목들은 실제 발생이 확인된 장애가 아니라 런을 전진시키지 못할 수 있는 조건부 후보이다. 순위는 상태를 지속적으로 멈춰 세울 개연성과 영향 범위를 기준으로 했다.

## 결과 요약 — 상위 3개

1. **Lease 갱신 실패 후 실행자가 정지하지 않으면 구 실행자/신규 실행자가 충돌할 수 있다.** `crates/loop-store/src/sqlite.rs:237-245`는 만료된 lease의 갱신을 `false`로 반환한다. 호출자는 이 반환값을 실행 중단으로 강제하지 않으면 소유권을 잃은 채 이벤트 쓰기가 거부되고 기존 워커가 남는다. bridge는 결과를 `accepted`로만 전달한다(`crates/loop-bridge/src/execution.rs:574-580`). 오케스트레이터가 false를 즉시 처리하는지 확인이 필요하다.
2. **검증 단계가 별도 실행 프로세스에서 끊기면 task가 `verifying`에 고착할 수 있다.** reducer는 `WorkerFinished`에서 task를 verifying으로 전이한다(`crates/loop-core/src/event/reducer.rs:295-300`); `RunProjection::has_in_flight_work`도 verifying을 진행 중으로 취급한다(`crates/loop-core/src/event/reducer.rs:634-637`). `VerificationStopped` 복구 이벤트가 존재하지만(`crates/loop-core/src/event/reducer.rs:483-510`), 복구 호출이 누락되거나 bridge 기록 실패 시 자동 만료/재조정 경로가 코어에는 보이지 않는다.
3. **복구된 실행 상태는 계산되지만 이벤트/인덱스에 자동 반영되지 않는다.** `recover_run`은 관측 불가 worker를 task Attention으로 바꾸고 active worker 목록에서 제거하며 run을 Attention으로 바꾼다(`crates/loop-store/src/sqlite.rs:283-310`). 이 함수는 읽기 경로 결과만 만들고 이벤트를 기록하지 않는다. 따라서 호출자가 결과를 별도로 커밋하지 않는다면 재시작 뒤 상태 복구가 일회성 뷰에 그치고 원본 projection은 계속 running으로 남을 수 있다.

## 후보 목록 (가능성 높은 순)

### 1. Lease 소유권 상실 후 실행 계속 — 중상

- `crates/loop-store/src/sqlite.rs:237-245`: 갱신은 owner와 유효 만료 시각이 일치할 때만 성공하며, 갱신 실패는 `false`다.
- `crates/loop-bridge/src/execution.rs:574-580`: bridge는 결과를 오류로 승격하지 않고 `accepted` 필드로 반환한다.
- 위험: 실행자가 false를 놓치거나 처리 지연 시 새 owner가 lease를 인수한 뒤 기존 워커의 후속 쓰기는 거부된다. 워커 중지/재조정이 빠지면 run에 실행 중 태스크가 남는다.
- 확인/권고: TS 경로에서 false 즉시 중단·취소, lease 상실 시 관측 가능한 진단 이벤트를 보장하는지 검증한다. Rust 경로 단독으로는 프로세스 강제 종료를 보장하지 못한다.

### 2. `verifying` 단계의 복구 의존성 — 중상

- `crates/loop-core/src/event/reducer.rs:295-300`: worker 종료 기록만으로 task가 verifying이 된다.
- `crates/loop-core/src/event/reducer.rs:634-637`: verifying은 in-flight로 간주되어 pause/cancel 완료를 막는다.
- `crates/loop-core/src/event/reducer.rs:483-510`: 명시적인 `VerificationStopped`는 Attention 복구를 제공하지만, 이벤트가 들어와야만 전이된다.
- 위험: 검증 프로세스가 비정상 종료하고 중지/실패 이벤트가 전달되지 않으면 task는 verifying에 남는다. 자동 검증 lease/타임아웃 sweep는 이 범위에서 확인되지 않았다.
- 확인/권고: orchestrator의 verifier 감시·종료 처리와 재시작 reconcile 호출을 함께 점검한다.

### 3. 복구 projection이 이벤트 로그에 커밋되지 않음 — 중간

- `crates/loop-store/src/sqlite.rs:283-310`: `recover_run`은 로그를 재생하고 관측되지 않는 worker를 Lost/Attention으로 반환한다.
- `crates/loop-store/src/sqlite.rs:283-310`: 함수 내부에는 append/transaction 호출이 없으며, 복구 변경은 반환 projection에만 적용된다.
- 위험: 호출자가 반환 결과를 기준으로 `WorkerStopped` 또는 `TaskExecutionReconciled`를 append하지 않으면, 다음 projection 로드는 원래 이벤트를 재생해 다시 running 상태가 된다.
- 확인/권고: 재시작 경로에서 복구 결과를 영속 이벤트로 변환하는지 확인하고, 그렇지 않으면 복구 이벤트를 커밋하는 명시적 단계를 추가한다.

### 4. Conflict 기반 scheduler가 선택 가능한 task 없이 정상 반환 — 낮음/조건부

- `crates/loop-core/src/scheduler/scheduler.rs:40-59`: serial task는 병렬 작업이 없을 때만 선택되고, 충돌하는 read/write scope 또는 semantic touchpoint는 후보를 건너뛴다.
- 위험: 모든 ready task가 서로 충돌한다고 판단되거나 serial 작업 앞에 실행을 막는 상태가 있으면 빈 claim이 반환된다. 이는 의도된 직렬화일 수 있으며 scheduler는 스핀/재시도를 직접 하지 않는다. 상위 dispatcher가 빈 결과를 완료로 판단하지 않고 다시 스케줄하는지 확인해야 한다.

### 5. `reconcile_task`의 lease 해제 오류가 결과를 덮어쓸 수 있음 — 낮음

- `crates/loop-bridge/src/execution.rs:614-645`: 작업은 클로저에서 실행되지만, 이후 `release_execution`이 실패하면 원래 작업 결과 대신 lease 오류를 반환한다.
- 위험: SQLite 오류 등에서 상태 변경은 커밋됐지만 호출자는 reconcile 실패로 판단할 수 있다. 동일 작업 재요청은 상태 검증에서 실패하거나 불필요한 재시도를 야기할 수 있다.
- 권고: 작업 결과와 lease 정리 실패를 구분해 노출하고, lease는 TTL 만료로 회수 가능하다는 점을 진단에 기록한다.

### 6. Bridge multi-event 작업은 원자적이지만 알림은 별도 부작용 — 낮음

- `crates/loop-store/src/sqlite.rs:90-150`: 이벤트, projection 및 인덱스 변경은 Immediate 트랜잭션 하나로 커밋된다.
- `crates/loop-bridge/src/commands.rs:786-808`: verification 커밋 후 별도 attention 생성 및 notification을 수행한다.
- 위험: 커밋과 후속 notify/attention 사이의 오류는 저장된 상태와 외부 관측을 잠시 불일치시킬 수 있다. 원자적 이벤트 배치는 DB 고착 위험을 낮추지만, 호출자는 오류를 받았어도 상태 전이가 이미 성공했을 수 있으므로 재조회해야 한다.

## 제외/완화 근거

- SQLite event append는 `TransactionBehavior::Immediate`에서 projection 재생·적용, 이벤트/인덱스 기록과 projection cache 저장을 같은 트랜잭션으로 수행한다(`crates/loop-store/src/sqlite.rs:90-150`). 부분 기록으로 인한 일반적인 상태 분리는 이 경로에서 낮은 위험이다.
- Worker 종료 불일치는 `WorkerStopped`에서 task를 Attention으로 옮기고 복구 attention을 만든다(`crates/loop-core/src/event/reducer.rs:513-527`). 즉 이벤트가 전달된 뒤의 고착은 방지된다.
- 감사 범위에는 Rust core/bridge/store뿐 아니라 TS dispatcher·verifier 소비자도 포함되지 않았다. 따라서 lease 갱신 실패 처리와 복구 결과 영속화는 후속 TS 감사가 필요한 교차 경계 질문이다.

## 와이어 코덱 관련 참고

이 보고서는 상태 전이 감사다. 기존 진단 문서가 기록한 complex-codec trailing bytes 및 nullable struct 입력 수정은 `patches/@rustra%2Ftypes@0.12.0.patch`와 `packages/protocol/test/complex-worker-roundtrip.test.ts`에 대한 별도 증거이며, Rust 코드 경로의 잔여 상태 고착 후보를 제거하는 근거로 보지는 않는다.
