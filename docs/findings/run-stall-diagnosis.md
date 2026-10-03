# 런 중단(stall) 진단 — complex-codec 수정 및 잔여 후보

날짜: 2026-10-03 · 상태: 확정 원인 수정·회귀 검증 완료, 잔여 후보 정적 감사 완료

## 요약

확정된 런 스톨 원인은 두 문제가 겹친 `@rustra/types` complex-codec 와이어 버그였다. 응답 디코더가 Bun FFI caller-buffer의 capacity 잉여 바이트를 프레임 후행 바이트로 오인했고, 입력 인코더는 non-required nullable struct 필드에 presence와 Option 태그를 중복 기록했다. 따라서 이는 **trailing bytes 오류만의 문제가 아니라 Bun FFI의 zero-copy caller-buffer 계약과 디코더의 엄격한 trailing 검사 충돌, 그리고 별개의 입력 태그 불일치**였다. 두 수정 모두 `patches/@rustra%2Ftypes@0.12.0.patch`에 적용됐으며 `packages/protocol/test/complex-worker-roundtrip.test.ts` 회귀 테스트가 통과했다. createComplexCodec 사용 명령 5개 전수 점검에서 패치 후 잔여 와이어 스톨 후보는 확인되지 않았다.

수정으로 확정된 원인은 해소됐지만, 아래 TS/Rust 감사 항목은 별개의 조건부 stall 후보이며 특정 런에서 실제 발생했다는 증거는 아니다. 가능성 순으로 통합하면:

1. **취소 후 worker 종료·정리 대기 (높음):** dispatcher가 `task.done`을 제한 없이 기다리고 provider cancel/control 기록 및 정리도 무기한 대기할 수 있다 (`coordinator.ts:243-246`, `task-execution.ts:144-149,255-276`).
2. **Herdr runner 호출 미완료 (높음):** 기본 프로세스 runner에는 timeout이 있으나 주입된 `HerdrRunner` 계약은 이를 보장하지 않으며, cancel 중 status 호출이 멈추면 grace deadline도 진행되지 않는다 (`packages/herdr/src/client.ts:76-110,375-397,659-660`).
3. **dispatcher 종료 cleanup 체인 정지 (중상):** heartbeat, mailbox stop, lease 해제가 순차 await되고 mailbox poll/drain 또는 control 호출이 영구 미완료면 반환이 막힌다 (`coordinator.ts:376-380`, `mailbox.ts:273-276,364-373`).
4. **Lease 상실 후 실행 지속 (중상):** SQLite lease 갱신 실패는 `false`이며 bridge는 이를 `accepted`로 전달한다. 소비자가 즉시 중단·취소하지 않으면 소유권을 잃은 worker와 새 owner가 충돌할 수 있다 (`crates/loop-store/src/sqlite.rs:237-245`, `crates/loop-bridge/src/execution.rs:574-580`). TS 소비자에서 false 처리 보장이 후속 확인 대상이다.
5. **verifying 상태 및 복구 미영속화 (중상~중간):** `WorkerFinished` 후 task는 verifying/in-flight가 되고, 복구 이벤트가 전달되지 않으면 고착할 수 있다 (`crates/loop-core/src/event/reducer.rs:295-300,483-510,634-637`). `recover_run`의 계산 결과도 자체적으로 이벤트 로그에 커밋되지 않아 호출자가 복구 이벤트를 append하지 않으면 projection이 다시 running으로 나타날 수 있다 (`crates/loop-store/src/sqlite.rs:283-310`).
6. **기타 조건부 후보 (중간 이하):** 시작 timeout 뒤 늦은 handle cleanup은 fire-and-forget이고 외부 worker가 남을 수 있다 (`task-execution.ts:120-127,295-305`). scheduler의 충돌로 빈 claim 반환은 의도된 직렬화일 수 있어 상위 dispatcher가 재스케줄하는지 확인해야 한다 (`crates/loop-core/src/scheduler/scheduler.rs:40-59`). reconcile의 lease 해제 오류는 원래 결과를 덮을 수 있고, DB 커밋 후 별도 알림 실패는 관측 상태를 일시적으로 불일치시킬 수 있다.

## 확정 원인과 적용된 수정

디스패처는 워커를 Herdr에 스폰하기 전에 `recordWorkerStarted`로 소유권을 예약한다 (`packages/orchestrator/src/coordinator.ts:307`). 이 호출에서 complex-codec 디코드/인코드가 실패하면 dispatcher failure attention은 남지만 worker는 0명이고 런이 전진하지 않아 Herdr agents에도 표시되지 않았다.

- **응답 방향 — trailing bytes:** `@rustra/bun` FFI는 caller가 제공한 버퍼를 zero-copy로 반환하며 byteLength가 실제 응답 길이가 아닌 버퍼 capacity일 수 있다. `@rustra/types` complex response decoder는 자체 종료 프레임 계약과 달리 남은 capacity를 거부해 `trailing bytes in complex response`를 냈다. 패치에서 이 엄격 검사를 제거했다.
- **입력 방향 — Option 태그 중복:** non-required nullable 필드(예: `WorkerInput.executionOwner`)에서 complex encoder가 presence 바이트와 Option 태그를 모두 기록했다. Rust plain serde `Option<T>`는 단일 태그를 기대하므로 다음 필드 경계가 밀려 `postcard decode: Found an Option discriminant that wasn't 0 or 1`가 발생했다. 패치에서 nullable 필드의 option 래퍼를 언랩해 단일 태그로 맞췄다.
- **수정 근거:** `patches/@rustra%2Ftypes@0.12.0.patch`가 두 변경을 포함한다. 회귀 테스트 `packages/protocol/test/complex-worker-roundtrip.test.ts`는 `recordWorkerStarted`/`recordWorkerResult` 왕복, `executionOwner` 및 `state` 변형을 exercise하고 코덱 오류 대신 정상 응답 또는 도메인 거부임을 확인한다. 감사 기록상 테스트 통과.
- 패치/코덱 변경 후 detached dispatcher가 사용하는 `dist/loop`는 번들 바이너리이므로 `bun run build:cli` 재빌드가 필요하다. 과거 재빌드 후 Workers 3, attention 0으로 정상화된 기록이 있다.

## 감사 결과 통합

### 와이어 명령 전수 점검

`createComplexCodec` 사용 명령은 정확히 5개다: `recordWorkerStarted`, `recordWorkerResult`, `recordWorkerStopped`, `evaluateFailurePolicy`, `evaluateCleanupDisposition`. 첫 세 명령은 dispatcher/worker live path에 있고, 마지막 둘은 현재 TS 호출자가 없다. `docs/findings/run-stall-audit-codecs.md`에 각 호출 경로와 증거가 있다. 패치 후 엔진 왕복은 모두 정상이며 동일 와이어 취약으로 인한 잔여 후보는 없다. 다만 `recordWorkerStopped`는 CI 회귀 테스트가 아닌 인라인 왕복 확인만 있어 테스트 확대가 바람직하다.

### TS 오케스트레이터/워커

`docs/findings/run-stall-audit-ts.md`는 위 1~3위 후보 외에 startup timeout 이후 늦은 handle 정리, capability lookup의 watchdog 경계도 기록한다. 이는 정적 코드 감사이며 실제 stall 발생 증거가 아니다. 기본 Herdr 프로세스 runner의 timeout은 주입 runner 전체에 대한 보장이 아니고, 동기 외부 호출 내부의 timeout도 별도 검증이 필요하다.

### Rust core/bridge/store

`docs/findings/run-stall-audit-rust.md`는 lease 소유권 상실, verifying 복구 이벤트 누락, 복구 projection의 비영속화를 주요 후보로 든다. scheduler 빈 claim, reconcile lease 해제 오류, 커밋 뒤 별도 notification 실패는 낮은 우선순위다. SQLite event append는 projection 적용·event/index 기록을 단일 Immediate 트랜잭션에 묶으므로 일반적인 부분 기록 위험은 낮다. Rust 감사만으로 TS 소비자가 lease 실패를 처리하는지 또는 복구 projection을 append하는지 확정할 수 없다.

## 후속 권고 (우선순위 순)

1. **디스패처 spawn-전 실패의 가시성·복구를 견고화:** `recordWorkerStarted` 등 spawn 이전 실패를 일반 dispatcher attention에만 남기지 말고, 원인 분류(코덱/전송/도메인), task/run의 명시적 terminal 또는 retryable 상태, Herdr에 worker가 아직 없다는 사실을 관측 가능하게 한다. 재시도 가능 오류와 fail-fast 오류를 구분하고 소유권 예약 rollback/reconcile 규칙을 둔다. 이는 재발 방지 설계이며 이번 수정 범위에는 포함되지 않았다.
2. **무기한 대기 경계에 deadline/cancellation 적용:** `task.done`, 주입 Herdr runner, provider cancel/release, mailbox stop, lease/control 정리 각각에 bounded 대기와 미확인 상태 보고를 둔다. cleanup 실패가 원래 결과를 숨기지 않게 분리한다.
3. **Lease/verifying/recovery 교차 경계 확인:** lease 갱신 false 시 worker 즉시 중단·취소하는지 테스트하고, verifier 비정상 종료 및 재시작 시 `VerificationStopped`/reconcile 이벤트가 영속화되는지 보장한다.
4. **회귀·의존성 유지:** `recordWorkerStopped`(및 필요시 두 노출 정책 명령) CI 왕복 테스트를 추가한다. `@rustra/types` 버전 변경 시 패치 이식/업스트림 수정 확인을 릴리스 체크리스트에 포함하고, 수정 후 `bun run build:cli`를 수행한다.
5. **운영/진단 증거 보강:** 재현 런의 이벤트 타임라인, dispatcher attention 원인, spawned worker 수, lease/reconcile 결과를 함께 수집해 정적 후보와 실제 원인을 구분한다.

## 근거 문서

- `docs/findings/run-stall-audit-codecs.md`
- `docs/findings/run-stall-audit-ts.md`
- `docs/findings/run-stall-audit-rust.md`
- 회귀 테스트: `packages/protocol/test/complex-worker-roundtrip.test.ts`
