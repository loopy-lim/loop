# Loop 실행 죽음 패턴 통합 분류 — 기록·커밋·테스트 근거

작성일: 2026-xx-xx. 이 문서는 `docs/run-stall-diagnosis.md`, `docs/diagnosis/**`,
`docs/defects/**`와 최근 fix/복구 커밋들을 통합해, "실행이 자꾸 죽는" 현상을
반복 패턴으로 분류한다. 각 패턴은 증상 → 의심 계층 → 근거 → 완화 상태 순이며,
마지막에 지금 가장 약한 계층에 대한 결론과 다음 진단·수정 후보를 둔다.

(## 패턴|근거|완화 상태): 각 패턴 섹션의 탐색 키. 섹션은 `## 패턴 N` 헤더로 시작하고,
근거(문서·커밋 해시·테스트명)와 완화 상태 필드를 포함한다.

---

## 패턴 1: 워커 프로세스 무단 사망 — 좀비 running 클레임과 wedged run 자가 복구 전무

- 증상: 워커 OS 프로세스가 `WorkerFailed` 이벤트 없이 소멸하면 태스크가 `running`으로
  무기한 고정된다. `loop resume`은 `State: active`만 반환하고 ready 태스크를
  디스패치하지 않는 "유령 active"가 되고, 수동 reconcile 후 resume은 attempts UNIQUE
  제약 충돌로 디스패처 자체가 사망한다. 사람이 `ps`로 직접 대조해야만 풀린다.
- 의심 계층: 디태치드 디스패처/워커 수명 주기 (orchestrator ↔ loop-store).
  프로세스 사망이 이벤트를 낳지 않는 구조 + 어느 계층에도 liveness 판정 주체 부재.
- 근거
  - 문서: `docs/defects/2026-09-23-dispatcher-claims.md` (결함 D1/D2/D3, 인과 요약 포함).
    관측 런 `loop-fc0ffbc6` (2026-09-23), attention id `dispatcher-73907`, `dispatcher-82651`.
  - 소스: `crates/loop-store/src/sqlite.rs` `WorkerStarted` 분기(행이 `running` 고정),
    `packages/orchestrator/src/coordinator.ts` 구 115–127행 recovery 가드의 판정 없는 반환,
    `crates/loop-core/src/event/reducer.rs` `TaskExecutionReconciled`(attempt 미증가).
  - 테스트: `crates/loop-store/tests/recovery.rs`
    `reconciled_attempt_row_is_cancelled_then_reused_on_redispatch`,
    `packages/orchestrator/test/recovery-dispatch.test.ts`
    "resume recycles a dead dispatcher's running/verifying claim and dispatches the ready task".
- 완화 상태: 완화됨 (2026-10-04). 임대(lease, 하트비트 1초/TTL 5초) 기반 판정으로 교체:
  store `interrupted_execution_claims`, bridge `recycle_interrupted_execution`,
  coordinator 임대 획득 직후 자동 recycle. 관련 커밋 `0ec7db5`(좀비 임대 감시),
  `be23a78`(클레임 결함 3건을 임대 기반 판정으로 수정). 잔여 위험: 이벤트 루프가
  5초 넘게 막힌 디스패처는 오판될 수 있고, 태스크에 묶이지 않은 옛 failure attention은
  recycle이 해소하지 않는다.

## 패턴 2: 프로바이더·네트워크 무응답 — worker run 무한 대기(hang)

- 증상: 모델/네트워크가 stall되면 worker subprocess의 종료를 기다리는 경로가
  영구 대기한다. `task.done`이 끝나지 않아 coordinator가 poll만 반복하고 run이
  완료 상태로 갈 수 없다. 실제 기록: `agy turn timed out after 600000ms` 반복
  (`docs/run-stall-diagnosis.md`, 실행 `cleanup-support-r7`).
- 의심 계층: provider adapter 경계 (`NodeProcessRunner.result`가 exit 이벤트에만 의존,
  `executeTask()`가 결과를 취소 signal에만 race). 무한 대기에서는 실패 결과 문자열이
  없어 기존 `classifyFailure()` 정규식까지 도달하지 않는 것이 구조적 원인.
- 근거
  - 문서: `docs/diagnosis/network-stall-hang.md` — root cause, 갭 분석, 권장 수정 위치
    (감지는 provider adapter, 재시도 정책은 orchestrator/core) 명시.
  - 커밋: `ad21f3a` fix(providers): 네트워크 stall 시 worker run hang 수정
    (`packages/providers/src/process.ts` +34행, orchestrator 작업 실행 모듈 동반 변경).
  - 소스: `packages/providers/src/process.ts` `start()` result resolve 조건,
    orchestrator 작업 실행 모듈(`packages/orchestrator/src/`) 87-93, 155-160행,
    `packages/orchestrator/src/coordinator.ts:226-227`.
  - 테스트: `packages/providers/test/lifecycle.test.ts`(deadline 전 미완료/deadline 후
    retryable timeout), `packages/orchestrator/test/persistent-lifecycle.test.ts`,
    `crates/loop-core` FailurePolicy 소진 attention 단위 테스트.
- 완화 상태: 부분 완화. `runTimeoutMs` 전체 턴 상한 도입(기본 30분) + TERM→KILL 유한
  정리 + timeout을 retryable로 분류해 retry budget/attention 연결. 잔여 위험:
  30분 기본값은 운영 측정 미반영(정상 장시간 응답도 종료 가능), 출력 idle timeout 미도입,
  Windows는 process-group kill 경로가 아니어서 미검증.

## 패턴 3: 완료 신호와 소유자 대기 경로 불일치 — 자식 생존·상태 전이 오판으로 도구 응답 영구 대기

- 증상: 저장소에는 run이 완료됐는데 Pi 세션의 `loop_run` 도구 응답이 끝나지 않고
  자식 프로세스(dispatcher, AGY 영속 프로세스)가 남는다. 반대로 worker의 정상 종료
  (`working → idle`)를 "시작 실패"로 오판해 결과를 거부하기도 했다. Herdr 제어 명령과
  `agent_end` hook의 상태 보고가 시간 제한 없이 대기해 Pi의 다음 동작을 막았다.
- 의심 계층: pi-loop/어댑터 경계 (`packages/pi-loop/src/extension.ts`,
  `herdr-lifecycle.ts`)와 provider 영속 프로세스 정리 경로.
  완료 summary와 프로세스 종료를 동일시하는 가정이 루트.
- 근거
  - 문서: `docs/run-stall-diagnosis.md` — 실제 기록(실행 `cleanup-support-r7`,
    2026-09-22 13:54–14:29 KST)과 5개 경로별 재현·수정 표.
  - 커밋: `9df8872` fix(runtime): Pi 완료 대기와 Herdr 장애 시 정지 경로 수정,
    `a743d6c` fix(orchestrator): 완료된 Herdr worker 탭 자동 정리,
    `3cfe258`/`a28a9dc` fix(loop): attention 해결 후 실행 owner 재기동,
    `b43e126` feat(pi-loop): owner 사망·리스 만료 후 재개 복구.
  - 테스트: `packages/orchestrator/test/persistent-lifecycle.test.ts`,
    `packages/pi-loop/test/herdr-lifecycle.test.ts`, `packages/pi-loop/test/lead.test.ts`,
    `packages/pi-loop/test/restart-recovery.test.ts`(커밋 `b43e126` 동반).
- 완화 상태: 완화됨. summary 수신을 도구 완료로 처리, `working → idle`을 정상 종료로
  판정, Herdr 제어 15초 제한 후 TERM→KILL, 보조 상태 보고 2초 제한.
  검증은 `bun run check` + 가짜 공급자 통합 테스트 + 실제 로컬 영속 프로세스.

## 패턴 4: 병렬 디스패치 세계 정지 — 죽은 것은 아니지만 "멈춘 것처럼 보이는" 실행

- 증상: Decision/Integration 태스크가 하나라도 running이면 다른 모든 클레임이 0이 되고,
  `readScope: ["**"]`나 빈 `writeScope` 하나로 형제 태스크 전부가 직렬화된다.
  진행이 눈에 보이지 않아 stall로 오인된다. 스킵 이유(누구와 겹치는지)가 기록되지 않아
  한계가 관측 불가능하다.
- 의심 계층: loop-core scheduler (`claim_runnable`의 직렬 종류 세계 정지 게이트,
  `normalized_prefix`의 빈 prefix 전역 겹침, `tasks_conflict`의 빈 writeScope 보편 충돌).
- 근거
  - 문서: `docs/diagnosis/2026-xx-parallel-dispatch-diagnosis.md` — Root Cause 5건,
    죽음은 아니지만 stall로 오인되는 대표 원인. live policy `max_parallel = 3`,
    `max_frontier_workers = 1`. `decision_parallelism` 등 3개 config 키는 파싱되지
    않는 죽은 키.
  - 소스(현재 코드 재확인): `crates/loop-core/src/scheduler/scheduler.rs` —
    `if running_tasks.iter().any(|task| task.kind.is_serial()) { return Vec::new(); }`
    세계 정지 게이트가 여전히 존재 (진단 문서의 권장 변경 1 미착지).
  - 커밋: `5f7b155` feat(loop-core): focused 재검증 체크 분배 정책 추가(부분 관련).
- 완화 상태: 미완화(부분). 진단 문서의 권장 5건(세계 정지 제거, 빈 writeScope 제출 시
  거부, 스킵 사유 반환, 죽은 config 키 구현/삭제) 중 착지 확인된 것은 없다.
  이 패턴은 크래시가 아니라 관측 가능성 결함이라 죽음 패턴과 함께 반복 오인의 원인이 된다.

## 패턴 5: 골 마감 영구 차단 — 검사 부수효과의 out-of-scope 오판 귀속

- 증상: 모든 태스크 `done`, 선언된 완료 검사 전부 통과인데도 run이 `completed`에
  도달하지 못하고 영구 block된다. `cargo test`/`bun test`가 쓰는 `target/…`·캐시 등
  검사 자신의 부수효과가 워커의 scope 밖 편집으로 귀속되어 기준이 `pending`에 갇힌다.
  `ProjectionError::IncompleteGoal`로 park.
- 의심 계층: loop-core 판정 정책 (`goal_criteria_status`의 차단 술어가
  "누가 썼는지"를 구분하지 못함) + orchestrator의 git 스냅샷 귀속 경로.
- 근거
  - 문서: `docs/diagnosis/2026-xx-goal-closure-scope-attribution.md` — 증상 런
    `remove-tauri-and-evaluate`, 귀속 경로 3단 추적(orchestrator → bridge → reducer).
  - 소스: orchestrator 작업 실행 모듈(`packages/orchestrator/src/`) 186-188행,
    `crates/loop-bridge/src/execution.rs:500-503`,
    `crates/loop-core/src/event/reducer.rs:92-115, 420-427`,
    `crates/loop-store/src/sqlite.rs:126-129`.
  - 테스트: `crates/loop-core/tests/goal_criteria.rs`
    `declared_check_side_effect_writes_do_not_block_goal_closure`,
    `genuine_source_edits_outside_write_scope_still_block_goal_closure`.
- 완화 상태: 완화됨. `crates/loop-core/src/policy/verification.rs`
  `is_check_side_effect_path`로 생성물 경로를 투영 시점에 면제. 트레이드오프:
  생성물 이름 집합은 gitignore의 결정론적 근사이므로 실제 소스가 `build/` 같은 이름을
  쓰면 진짜 scope 밖 편집이 면제될 수 있음(문서화된 수용 결정).

## 패턴 6: 프로토콜·브리지 코덱 결함 — 디스패처 스톨과 빈 런

- 증상: (a) rustra complex-codec 와이어 버그로 디스패처가 스톨, (b) `loop_run` 래퍼가
  런을 선생성하고 확장 CLI가 같은 runId로 재생성해 `run has already been created` —
  태스크 없는 빈 `active` 런이 남는다. 래퍼의 구버전 코덱 사본은
  `invalid enum value for kind: undefined` TypeError도 냈다.
- 의심 계층: generated protocol ↔ 브리지 경계, 그리고 소스와 dist 생성물의 코덱 불일치.
- 근거
  - 커밋: `22733e0` fix(protocol): rustra complex-codec 와이어 버그 2건 패치로
    디스패처 스톨 해제 (vec_struct 루프 변수 섀도잉).
  - 문서: `docs/defects/2026-09-21-loop-run-wrapper-duplicate-createrun.md`
    (재현 런 `loop-ui-output-limits`, 2026-09-21).
  - 테스트: `bun run codegen:check`(와이어 일치), `packages/orchestrator/test/lockstep.test.ts`
    (러스트 도메인 값 미러, 커밋 `9b0c8e2`).
- 완화 상태: 코덱 버그는 완화됨(`22733e0` + codegen 재생성). 래퍼 중복 createRun 결함
  문서는 open 상태로 기록됨 — 제안 수정(선생성 제거 또는 멱등 제출)의 착지 근거는
  이 문서 작성 시점에 확인하지 못했다.

---

## 지금 가장 약한 계층

결론: **orchestrator ↔ 프로세스(worker/dispatcher) 수명 주기 경계**가 가장 약하다.
근거는 반복 분포다 — 6개 패턴 중 3개(패턴 1·2·3)가 "프로세스의 실제 상태와 저장소·
도구 응답이 담는 상태가 어긋나는" 동일한 뿌리에서 나왔다. liveness 판정 주체가
어느 계층에도 없던 구조적 결함(패턴 1)을 임대로 메웠고, 종료 대기를 상한으로
잘랐고(패턴 2), 완료 신호를 프로세스 종료와 분리했다(패턴 3). 즉 이 경계는
사후 패치가 계속 쌓이는 계층이며, 여전히 (a) 5초 TTL 이벤트 루프 차단 오판,
(b) 30분 상한의 운영 미조정, (c) Windows kill 경로 미검증이라는 열린 구멍이 있다.
반대로 loop-core의 판정 정책(패턴 5)과 코덱(패턴 6)은 한 번 고쳐진 뒤 회귀
테스트로 고정되어 상대적으로 튼튼하다. 패턴 4(scheduler)는 죽음은 아니지만
"죽었다고 오인하게 만드는" 관측 가능성 결함으로, 사용자 체감 죽음 신고의 상당 부분을
여기서 설명할 수 있다.

### 다음 진단·수정 후보 (우선순위 순)

1. **scheduler 세계 정지 게이트 완화 + 스킵 사유 기록** —
   `crates/loop-core/src/scheduler/scheduler.rs`의 직렬 종류 세계 정지(`return Vec::new()`)와
   빈 writeScope 보편 충돌을 제거/축소하고, claim 스킵 사유(serial-held,
   scope-overlap-with X)를 activity로 기록한다. 근거: 진단 문서 권장 5건이
   현재 코드에서도 미착지(위 패턴 4 소스 재확인). 죽음 신고의 오인 원인 1순위.
2. **stall 상한의 운영 측정 기반 튜닝** — `runTimeoutMs` 기본 30분과
   `recovery.stall_timeout_ms`를 실제 provider별 응답 분포로 재조정하고, 근거가
   쌓이면 출력 idle timeout을 별도 정책으로 검토한다. 근거:
   `docs/diagnosis/network-stall-hang.md`의 "남은 위험" 명시.
3. **resume/owner 관측 가능성** — 디태치드 owner가 attention으로 즉시 종료해도
   resume 호출자가 알 수 없는 구조(패턴 1 D3의 관측성 절반)를 확인한다.
   lease recycle로 동작 결함은 닫혔지만 spawn 결과 비관측
   (`spawnOwner` detached·stdio ignore)은 구조적으로 남아 있다.
4. **Windows 플랫폼 검증** — process-group kill이 아닌 플랫폼에서 timeout→cancel 경로가
   프로세스를 실제로 정리하는지 별도 검증. 근거: network-stall-hang.md 잔여 위험.
5. **죽은 config 키 정리** — `decision_parallelism` 등 파싱되지 않는 키를 구현하거나
   삭제해 운영자가 없는 손잡이를 돌리지 않게 한다. 근거: parallel-dispatch 진단
   "dead keys" 섹션.

### 문서 간 관계

- 패턴 1 상세: `docs/defects/2026-09-23-dispatcher-claims.md`
- 패턴 2 상세: `docs/diagnosis/network-stall-hang.md`
- 패턴 3 상세: `docs/run-stall-diagnosis.md`
- 패턴 4 상세: `docs/diagnosis/2026-xx-parallel-dispatch-diagnosis.md`
- 패턴 5 상세: `docs/diagnosis/2026-xx-goal-closure-scope-attribution.md`
- 패턴 6 상세: `docs/defects/2026-09-21-loop-run-wrapper-duplicate-createrun.md`
