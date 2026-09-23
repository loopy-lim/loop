# Defect: 디스패처 워커 클레임·재시도 결함 3건 (좀비 클레임, attempts UNIQUE 충돌, resume 미디스패치)

- **상태**: open (2026-09-23 기록)
- **영향**: 워커 프로세스가 비정상 종료되면 (1) 클레임이 영구 좀비화되고, (2) reconcile 후 재시도가
  attempts UNIQUE 제약으로 반드시 실패하며, (3) `loop resume`은 준비된 태스크를 디스패치하지 않는다.
  세 결함은 합쳐져 wedged run의 자가 복구 경로를 전무하게 만든다.
- **관측 런**: `loop-fc0ffbc6` (2026-09-23, implement-visibility 태스크 wedged → run cancelled)
- **비고**: 이 문서는 기록 전용이다. 코드 변경 없음. 근거 문자열은 관측값과 소스 위치를 그대로 인용한다.

---

## D1. 좀비 워커 클레임 — 죽은 프로세스의 태스크가 'running'으로 무기한 남음

### 재현 요약

1. 런 `loop-fc0ffbc6`의 implement-visibility 태스크 워커가 ~45분 실행 중 프로세스 사망
   (정상 `WorkerFailed` 이벤트 없이 OS 프로세스만 소멸).
2. `loop status loop-fc0ffbc6` → 태스크 상태가 계속 `running`으로 표시.
3. 동일 시점 `ps`로 확인한 워커 프로세스 수: **0개** — 45분 이상 상태 지속.
4. 자동 감지·정리 없음. 사람이 `ps`로 직접 대조한 뒤 수동 reconcile을 해야만 풀린다.

### 근거 (소스 위치)

- `WorkerStarted` 이벤트가 `workers` 행을 `state='running'`으로 넣고 태스크 상태를
  `running`으로 바꾼다 (`crates/loop-store/src/sqlite.rs` — `EventKind::WorkerStarted` 분기,
  `INSERT INTO workers (... , state) VALUES (..., 'running')`).
- workers/attempts 행을 다시 `running`에서 다른 상태로 바꾸는 이벤트는
  `WorkerFinished`/`WorkerFailed`/`WorkerCancelled`뿐이다 — **프로세스 사망은 이벤트를 낳지 않으므로**
  행이 영구히 `running`으로 고정된다.
- 새 디스패처 프로세스의 recovery 가드(coordinator)는 `previous.activeWorkers.length > 0`를
  감지해 attention만 올리고 **아무 판정도 내리지 않고 반환한다**
  (`packages/orchestrator/src/coordinator.ts` 115–127행 부근:
  `Execution owner restarted. Confirm worker ... has stopped, then run: loop reconcile ...`).
- 워커 소유 프로세스는 detached·stdio ignore로 spawn된다
  (`packages/cli/src/dispatcher.ts` `spawnOwner`: `detached: true, stdio: "ignore"`, `unref()`),
  therefore 부모는 자식 사망을 관측할 수 없고, 저장소에는 생존 신호(liveness)가 없다.

### 의심 레이어

디태치드 디스패처/워커 수명 주기 (orchestrator worker lifecycle ↔ loop-store workers 테이블).
liveness 프로브·사망 판정 주체가 어느 계층에도 존재하지 않는 것이 루트 구조적 결함.

### 영향

- wedged run이 영구히 `active`+`running` 표시로 남아 사람의 `ps` 대조와 수동 reconcile 없이는
  복구 불가. D3의 직접적 원인이기도 하다(recovery 가드가 항상 소진됨).
- 좀비 클레임이 lease/maxWorkers 예산을 계속 점유할 수 있다.

### 조사 진입점 제안

- `packages/orchestrator/src/task-execution.ts` — 워커 시작/종료 이벤트 발행 지점.
- `packages/orchestrator/src/coordinator.ts` 115–127행 — recovery 가드가 판정 없이 반환하는 지점.
- `crates/loop-store/src/sqlite.rs` workers 테이블 — 사망 판정용 상태 전이 부재.

---

## D2. reconcile 후 재시도가 attempts UNIQUE 제약으로 실패 — 디스패처가 재디스패치하지 않음

### 재현 요약

1. wedged 태스크에 대해 안내대로 실행:
   `loop reconcile <run-id> <task-id> stopped` → 성공(태스크가 `Ready`로 전이).
2. 이어서 `loop resume <run-id>` → 디스패처가 해당 태스크를 클레임하고 `WorkerStarted`를 발행.
3. 저장소가 삽입 시도 `INSERT INTO attempts (run_id, task_id, attempt, ...)`에서 실패:
   `database error: UNIQUE constraint failed: attempts.run_id, attempts.task_id, attempts.attempt`
4. 디스패처는 예외로 종료되어 **해당 ready 태스크를 영원히 재디스패치하지 않는다.**
   attention id `dispatcher-73907`, `dispatcher-82651`이 런 `loop-fc0ffbc6`에서 이 실패로 생성됨.

### 근거 (소스 위치)

- attempts 테이블 기본키: `PRIMARY KEY (run_id, task_id, attempt)`
  (`crates/loop-store/src/schema.rs` attempts 정의).
- `WorkerStarted` 이벤트가 태스크 스냅샷의 `task.attempt` 값을 그대로 넣는다
  (`crates/loop-store/src/sqlite.rs` 447행 부근:
  `INSERT INTO attempts (run_id, task_id, attempt, compute_class, state) VALUES (?1, ?2, ?3, ?4, 'running')`).
- 그런데 `task.attempt`를 올리는 유일한 경로는 `VerificationFailed`뿐이다
  (`crates/loop-core/src/event/reducer.rs` 185행: `task.attempt = task.attempt.saturating_add(1)`).
- **`TaskExecutionReconciled`는 attempt를 증가시키지 않는다**
  (`crates/loop-core/src/event/reducer.rs` 268행 부근 — Running/Verifying/Attention/Cancelled →
  Ready 전이만 수행).
- 따라서 reconcile → resume → `WorkerStarted`는 **동일한 (run_id, task_id, attempt) 삽입**이 되고,
  1차 시도가 이미 attempts 행을 남긴 상태(좀비 클레임, D1)에서 반드시 UNIQUE 충돌이 난다.
- 디스패처의 오류 처리는 attention 한 장 올리고 루프를 탈출한다
  (`packages/orchestrator/src/coordinator.ts` catch 블록, attentionId: `dispatcher-${owner}`,
  `summary: redact(error)` — 관측된 근거 문자열이 이 경로의 산출물).

### 의심 레이어

loop-store attempts 테이블 + loop-core reconcile 리듀서의 경계.
(reconcile 이벤트가 attempt 카디널리티를 올리지 않는데, 저장소 insert는 카디널리티를 요구한다.)

### 영향

- "reconcile → resume"이라는 시스템이 스스로 제안하는 유일한 복구 절차가
  좀비 클레임이 남은 상태에서 **항상 실패**한다. wedged run의 복구 불가능이 확정된다.
- 실패가 `dispatcher-<pid>` attention으로만 남아 원인(UNIQUE 충돌) 파악이 어렵다.

### 조사 진입점 제안

- `crates/loop-store/src/sqlite.rs` 447행 insert — attempt 번호 소스와 충돌 처리.
- `crates/loop-core/src/event/reducer.rs` 268행 `TaskExecutionReconciled` — attempt 증가 여부 결정.
- `crates/loop-bridge/src/execution.rs` `reconcile_task` — reconcile이 남기는 잔여 상태.
- `packages/orchestrator/src/coordinator.ts` catch 블록 — UNIQUE 오류를 재시도 가능 조건으로 다루는지.

---

## D3. wedged run에서 `loop resume`이 `State: active`만 반환하고 ready 태스크를 디스패치하지 않음

### 재현 요약

1. 워커 사망으로 wedged된 런에 `loop resume <run-id>` 실행 (2026-09-23 여러 차례 관측).
2. 명령은 정상 반환하고 `loop status`는 `State: active`를 표시한다.
3. 그러나 ready 상태 태스크가 있음에도 워커가 하나도 시작되지 않는다 — 디스패치 없음.

### 근거 (소스 위치)

- `loop resume`은 (a) `RunResumed` 이벤트 추가
  (`crates/loop-bridge/src/commands.rs` 737–742행)와 (b) 디태치드 오너 spawn
  (`packages/cli/src/main.ts` 176–179행 → `launchOwner` → `packages/cli/src/dispatcher.ts`
  `spawnOwner`)만 한다.
- spawn된 **새 디스패처의 recovery 가드**가 wedged 상태를 만나면 attention을 올리고
  아무것도 디스패치하지 않고 반환한다 (`packages/orchestrator/src/coordinator.ts` 116–127행:
  `previous.activeWorkers.length > 0 || tasks.some(verifying)` → `summary.status = "attention"; return`).
  D1의 좀비 클레임이 살아 있는 한 이 가드는 **매 resume마다 소진**된다.
- 오너는 `detached: true, stdio: "ignore", unref()`로 띄워지고 resume은 spawn 성공만 확인한다
  (`packages/cli/src/dispatcher.ts` `spawnOwner` — `child.once("spawn", resolve)`).
  오너가 spawn 직후 recovery attention으로 즉시 종료해도 resume 호출자는 그 사실을 알지 못한다
  (`observeRun`을 쓰지 않는 resume 경로).
- 결과: 상태는 `active`, 화면은 성공, 실제로는 아무 일도 일어나지 않는 유령 active.

### 의심 레이어

디태치드 디스패처 수명 주기 (CLI resume/owner spawn ↔ orchestrator recovery 가드).
resume이 오너의 실제 진행(디스패치 or attention)을 관측하지 않는 것이 관측 가능성 결함,
recovery 가드가 좀비 클레임을 판정 없이 소비하는 것이 동작 결함.

### 영향

- 사용자가 resume을 반복해도 아무 진행이 없고, 실패 피드백도 없어
  "명령이 먹통"으로 오인된다. wedged run 복구의 마지막 사용자 수단이 무력화된다.

### 조사 진입점 제안

- `packages/cli/src/dispatcher.ts` `spawnOwner` — detached·stdio ignore로 인한 결과 비관측.
- `packages/cli/src/main.ts` 176–179행 resume 분기 — 오너 결과 대기/보고 부재.
- `packages/orchestrator/src/coordinator.ts` 115–127행 recovery 가드 — 판정 없는 반환.

---

## 결함 간 인과 요약

```text
워커 프로세스 사망 (이벤트 없음)
  └─ D1: workers/tasks 행이 'running' 좀비화 (정리 주체 없음)
       ├─ D3: resume 시 recovery 가드가 좀비를 보고 무조건 attention 반환 → 디스패치 없는 active
       └─ 수동 reconcile → resume
            └─ D2: reconcile이 attempt를 증가시키지 않아 동일 (run_id, task_id, attempt) 재삽입
                 → UNIQUE constraint failed → 디스패처 사망, 재디스패치 없음
```

세 결함 모두 2026-09-23 런 `loop-fc0ffbc6`에서 관측되었으며, 이 문서 기준 코드 변경은 없다.
