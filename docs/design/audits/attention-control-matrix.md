# Attention 제어 가능성 매트릭스 — attention × resolution × 배치 실패 경로 전수 조사

- Audit ID: attention-gap-research
- 날짜: 2026-07-18 기준 워킹 트리
- 범위: `crates/loop-core/src/**`, `crates/loop-bridge/src/**`, `packages/orchestrator/src/**`, `packages/pi-loop/src/**`, `packages/protocol/src/generated/**`
- 목적: "어떤 attention 종류 × 어떤 해결 어휘 × 어떤 배치 실패 경로에서도 사용자가 컨트롤 가능한가"를 검증하고, 회복 불가능(또는 프로그램적 회복 불가) 정지 지점을 확정한다.

## 1. 결론 요약

- 코어의 해결 규칙(`Attention::resolve`)과 브리지의 와이어 파서(`parse_resolution`)는 일관되며, Failure 지시어 어휘(Retry / AddTask / Defer / Cancel)는 코어에서 단일 소스로 관리된다. 레이어 위반 없음.
- **확정된 격차 4건**:
  - **G1 (지시받은 격차 a)**: `add_task` 해결의 `correctiveTask` 계약을 Lead 도구(`loop_resolve`)와 CLI(`loop resolve`)가 전달할 수 없다. 와이어(`ResolveAttentionInput.correctiveTask`)와 브리지는 이미 지원하므로 갭은 도구/CLI 계층에만 있다.
  - **G2 (지시받은 격차 b)**: 배치 후보 부재 실패(`provider-…` attention, "no eligible compute candidate satisfies task constraints")에 제약 완화·재자격화 프로그램적 회복 경로가 없다. `update_task`는 상태 전환(Ready)만 노출하고 라우팅 제약(maximumCompute·capabilities)은 변경 불가.
  - **G3**: 표시 계층 해결 어휘(`attentionResolutions`)가 실패에 대해 `["retry","cancel"]`만 광고하고(defer/add_task 누락), approval 토큰 `"approve"/"reject"`는 브리지 파서가 받지 못한다(파서는 `"approved"/"rejected"`만 인식, 그 외는 `Answer`로 해석되어 core가 거부).
  - **G4**: 태스크 비바인딩 failure attention(`blocked-…`, `dispatcher-…`, `owner-spawn-…`)에 대한 `retry`는 브리지에서 `if let Some(task_id)`로 **조용히 무연산** 처리된다. 특히 blocked-goal(`blocked-<runId>-<seq>`)은 자유 서술(Answer)이 core에서 거부되므로, 실효적 출구가 cancel뿐인 루프 위험이 있다.
- 회복 불가능한(사용자 조작으로도 빠져나올 수 없는) 정지 지점은 없다. 모든 정지는 attention 상태로 파킹되며 `loop_resolve`/`loop reconcile`/`loop cancel` 중 하나로는 항상 빠져나온다. 문제는 "가능/불가능"이 아니라 **프로그램적(무료·자동) 회복 경로의 부재와 어휘 전달 단절**이다.

## 2. AttentionKind × AttentionResolution 유효성 매트릭스

출처: `crates/loop-core/src/attention/attention.rs` `resolve()` (pinned contract). 브리지 `parse_resolution`(`crates/loop-bridge/src/commands/guidance.rs`)이 동일 규칙을 사전 검증하고 배치 append가 race-free 재검증한다.

| kind \ resolution | Answer(text) | Approved | Rejected(reason) | Retry | AddTask(corrective) | Defer | Cancel |
|---|---|---|---|---|---|---|---|
| Question | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Decision | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Conflict | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Approval | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Failure | ❌ (지시어만) | ❌ | ❌ | ✅ | ✅ 단, 태스크 바인딩 + `is_well_formed()` 필요 | ✅ | ✅ |

보조 규칙:

- 이미 Resolved인 attention은 `AlreadyResolved`로 거부(재해결 불가, 이중 효과 차단).
- `add_task`는 해결 시 `TaskCreated` + `TaskDependencyAdded`(실패 태스크의 선행 조건으로 정정 태스크 편입) + `TaskReady`를 한 배치로 커밋 (`guidance.rs` `resolve_attention`). 정정 태스크의 write scope는 계약에 고정되어 확대 불가.
- `Retry`/`AddTask`의 재디스패치는 `redispatch_ready_events`가 상태를 검증: pending/ready는 무연산, attention/failed는 TaskReady, blocked/done은 거부, running/verifying/cancelled는 `reconciliation_required` 거부(먼저 `loop reconcile` 필요).

### 2.1 레이어별 어휘 전달 경로 (단절 지점 표시)

| 계층 | 파일 | Failure 지시어 전달 | AddTask/correctiveTask |
|---|---|---|---|
| 코어 어휘 | `loop-core/src/attention/{attention,resolution}.rs` | ✅ 전 지시어 | ✅ `CorrectiveTask` 계약 + well-formed 검사 |
| 브리지 커맨드 | `loop-bridge/src/commands/guidance.rs` `resolve_attention` | ✅ 전 지시어 | ✅ `ResolveAttentionInput.corrective_task` |
| 생성 프로토콜 | `protocol/src/generated/types.ts` `ResolveAttentionInput` | ✅ 문자열 | ✅ `correctiveTask?` 필드 존재 (codegen 반영됨) |
| CLI | `cli/src/run-control.ts` `resolve` 서브커맨드 | ✅ 문자열 토큰 | ❌ **파라미터 없음** (문자열만 전달) |
| Lead 도구 | `pi-loop/src/extension.ts` `loop_resolve` (L1046) | ✅ 문자열 토큰 (파라미터 설명에 어휘 미기재) | ❌ **파라미터 없음** |
| 표시 힌트 | `presentation/src/attention.ts` `attentionResolutions` | ⚠️ `retry`/`cancel`만 광고 (defer/add_task 누락) | ❌ |

## 3. Attention 생성 지점 전수 조사

| 생성 주체 | 위치 | kind | 바인딩 | attention id 패턴 |
|---|---|---|---|---|
| 임베딩 앱(제어평면) | `loop-bridge/src/commands/guidance.rs` `request_attention` | 임의 5종 | 선택 | 호출자 지정 |
| 검증 실패 | `loop-bridge/src/commands/task.rs` `ensure_failure_attention` | Failure | 태스크 | `failure-<run>-<task>-<attempt>` |
| 워커 유실(리듀서 자동) | `loop-core/src/event/event.rs` `worker_recovery_attention` (reducer/sqlite 적용) | Failure | 태스크 | `recovery-<run>-<worker>` |
| 검증 유실(리듀서 자동) | `event.rs` `verification_recovery_attention` | Failure | 태스크 | `recovery-<run>-<task>-verification` |
| 오케스트레이터 | `orchestrator/src/coordinator.ts` L258, L478, L588, L624 / `task-execution.ts` L183, L201, L368, L557 / `runtime.ts` L144 | **전부 Failure** | 대부분 태스크, 일부 null | `cleanup-`, `cancel-`, `startup-`, `failure-…-environment/timeout-exhausted`, `provider-…`, `blocked-…`, `dispatcher-…`, `owner-spawn-…` |
| Lead UI/테스트 외 | Question/Decision/Conflict/Approval 생성은 프로덕션 오케스트레이터 경로에 없음 (브리지 테스트 L729의 Approval이 유일한 브리지 내 생성) | — | — | — |

핵심 관찰: **프로덕션에서 열리는 attention은 사실상 전부 Failure 종류**다. Question/Decision/Conflict/Approval은 어휘와 저장소·렌더링은 갖춰져 있으나 생성 주체가 없어 현재로선 임베딩 앱용 확장점이다. 따라서 아래 실패 경로 매트릭스의 회복 어휘는 Failure 지시어가 기준이다.

## 4. 실패 상황 × 회복 경로 매트릭스

회복 분류: **P** = 프로그램적(유료 호출·사용자 판단 없이 자동), **H** = 인간 지시 필요(하지만 유효한 출구 존재), **G** = 격차(출구는 있으나 프로그램적 경로 부재 또는 어휘 전달 단절).

| # | 실패 상황 | attention (kind/binding) | 자동 완화 선행 단계 | 사용자 회복 경로 | 분류 |
|---|---|---|---|---|---|
| 1 | 워커 결과 실패(재시도 가능, 시도 예산 남음) | 없음 | 스케줄러 재시도 사다리(백오프, `policy/failure.rs`), 프로바이더 폴백 체인(`task-execution.ts` selectFallback) | 불필요 | P |
| 2 | 워커 실패: retryable=false / quota / auth / timeout 예산 소진 | `failure-…-environment` 또는 `…-timeout-exhausted` (Failure/태스크) | 동일 세션 수리 1회(provider.repair), 프로바이더 폴백 | loop_resolve: `retry`/`defer`/`cancel`; `add_task`(G1로 도구에서 불가, CLI로도 불가) | H+G1 |
| 3 | 완료 검사 실패 | `failure-<run>-<task>-<attempt>` (Failure/태스크) | 동일 세션 수리 1회, §D criteria self-heal 1회 | loop_resolve 동일 어휘 | H+G1 |
| 4 | 워커 유실(cancellation 외 정지) | `recovery-<run>-<worker>` (Failure/태스크) | 없음(신규 오너의 `recycleInterruptedExecution`이 lease 만료 사실로 자동 Retry 해소 — D1/D3) | `loop reconcile <run> <task> stopped`(자동 Retry 해소 포함) 또는 loop_resolve | P(인수 시)/H |
| 5 | 검증 프로세스 유실 | `recovery-<run>-<task>-verification` (Failure/태스크) | 동일 #4 | 동일 #4 | P/H |
| 6 | 워커 기동 불확실(startup timeout/interrupt) | `startup-<workerId>` (Failure/태스크) | 늦게 뜬 핸들 자동 cancel | reconcile(확인 후) 또는 loop_resolve retry | H |
| 7 | 정리(cleanup/cancel) 결과 불명 | `cleanup-<workerId>` / `cancel-<workerId>` (Failure/태스크) | release 2회 바운드 재시도 | 확인 후 reconcile 또는 resolve | H |
| 8 | **배치 후보 부재**(라우팅 실패: `no eligible compute candidate satisfies task constraints`, `policy/routing.rs` `NoSufficientCandidate`; capability lookup timeout 포함) | `provider-<run>-<task>-<attempt>` (Failure/태스크) | 없음 — "strongest" 바이어스의 ceiling-miss 시 선호 컴퓨트로 1회 강하는 있으나, 후보가 전무하면 즉시 attention | loop_resolve `retry`(동일 제약 재시도 → 환경 미변경 시 재발), `defer`, `cancel`; **제약 완화·재자격화 경로 없음** (`update_task`는 Ready 전환만 허용) | **G2** |
| 9 | 디스패처 크래시/리스 상실 | `dispatcher-<owner>` (Failure/비바인딩) | 리스 만료 후 차기 오너 자동 인수 + stale attention 자동 Retry 해소 | loop_resolve로 폐쇄 가능(효과 없음, G4) | P |
| 10 | 오너 스폰 실패 | `owner-spawn-<owner>` (Failure/비바인딩) | 없음 | `loop resume`(오너 재기동) 후 resolve, 또는 cancel | H |
| 11 | 활성 런에서 빈 claim("No runnable task remains") | `blocked-<run>-<seq>` (Failure/비바인딩) | 없음 | 원인 정비(의존성/reconcile) 후 resolve retry — retry 자체는 무연산(G4) | H+G4 |
| 12 | 목표 기준 미검증 상태로 전 태스크 완료 | `blocked-<run>-<seq>` (Failure/비바인딩) | §D self-heal(안정 소스 재검증 1회) 선실행 | 증거 검토 후 loop_add_task/steer 승격으로 검증 경로 정비 후 resolve; **자유 서술 수용(Answer) 불가**, add_task는 비바인딩이라 불가 → 실효 출구는 정비+retry 또는 cancel | H+G4 |
| 13 | attention 해결 배치 append 실패(`attention_resolution_failed` 등) | 없음(커맨드 에러) | — | 재호출(멱등: resolve는 AlreadyResolved로 재커밋 차단) | P |
| 14 | 일시정지/취소 게이트(claim verdict `paused`/`attention_held`) | 없음/기존 attention | — | loop_control resume/cancel, 또는 attention 해결 | P/H |

### 4.1 정지 탈출 보증

- 런이 `attention` 상태로 파킹된 경우: open attention을 전부 해소하면 리듀서가 런 상태를 되돌리고(reducer L436-441), `loop resume`/오너 재기동으로 디스패치가 재개된다. `loop_resolve`는 해소 후 오너가 없으면 resume까지 시도한다(`extension.ts` L1219-1253, 실패 시 1회 바운드 재시도 후 안내).
- `defer`로 파킹된 태스크: 프로토콜 `updateTask`(Ready 전환)로 재자격화 가능 — 단, **CLI/Lead 도구 어느 쪽으로도 노출되지 않아** 실사용 경로는 브리지 직접 호출뿐(관찰 사항, 별도 격차로 추적하지 않음).

## 5. 확정 격차 상세 및 수정 권고

### G1 — Lead 도구가 add_task 해결의 correctiveTask 계약을 전달할 수 없음 (격차 a)

- **증거**: `pi-loop/src/extension.ts` L1046-1071 (`resolution: Type.String()` 단일 파라미터, L1331-1338 backend가 CLI `resolve <runId> <attentionId> <resolution> --json`만 호출), `cli/src/run-control.ts` L51-70 (문자열만 `protocol.resolveAttention`에 전달). 반면 `protocol/src/generated/types.ts` L766-773의 `ResolveAttentionInput`은 `correctiveTask?`를 이미 갖고, 브리지는 payload 검증(`CorrectiveTask::is_well_formed`)과 TaskCreated+DependencyAdded+Ready 배치 커밋까지 구현 완료(`guidance.rs` L129-201).
- **영향**: 워커/검증 실패의 유일한 구조적 수리 지시어(정정 태스크 편입 후 재디스패치)가 모델·오퍼레이터 어느 쪽도 발동 불가. 실패 회복이 retry(재발 위험)·defer(파킹)·cancel(포기)로 수렴.
- **수정 위치**: 어댑터 계층만 — 코어/브리지 변경 불요. (1) `loop_resolve` 파라미터에 `resolution` 리터럴 유니온(`answer|approved|rejected|retry|defer|cancel|add_task`) + `correctiveTask` 객체 스키마(id/title/writeScope/requirements/completionChecks, 생성 타입 `CorrectiveTaskInput` 재사용) 추가, (2) `backend.resolve`와 CLI resolve에 `--corrective-json` 또는 옵션 플래그 전달, (3) 도구 description에 Failure 지시어 어휘 명시(현재 어휘 안내 부재). 정책은 이미 Rust에 있으므로 어댑터는 얇게 유지됨.

### G2 — 배치 후보 부재 실패에 제약 완화·재자격화 프로그램 경로 없음 (격차 b)

- **증거**: `loop-core/src/policy/routing.rs` L163 `NoSufficientCandidate` → `orchestrator/src/coordinator.ts` L478-489 `provider-<run>-<task>-<attempt>` failure attention. `retry` 해소는 `#routeFor`를 동일 태스크 제약(`TaskRouting`의 minimum/maximum compute, capability requirements — `loop-core/src/policy/routing.rs` `effective_minimum`)으로 재진입시킬 뿐이고, `loop-bridge/src/commands/task.rs` `update_task` L251-286은 상태 전환(Ready)만 노출해 제약 변경이 불가. 태스크 제약 변경 커맨드 자체가 없음.
- **영향**: 프로바이더 구성 변경·모델 축소 등으로 회복 가능한 상황에서도, 환경을 고쳐도 retry는 동일 제약을 재검증할 뿐 프로그램적 완화가 없어 attention→retry→재발 루프 또는 cancel로 수렴.
- **수정 위치(권장)**: 정책은 코어에 — (대안 1) `FailureDirective`에 `RelaxConstraints` 신설: `AttentionResolution`에 완화된 제약(상한 컴퓨트·capability)을 실어 코어가 배치로 `TaskRoutingUpdated` 이벤트+재디스패치. 결정 기록이 계약에 남는다는 기존 설계와 일치. 단, 어휘 확장이라 리듀서·codegen·브리지 파서 동반 변경 필요. (대안 2, 권장) 범용 `update_task` 확장: Ready 전환에 더해 `TaskRouting` 완화(상향된 maximum/compute class 하향, capability 제거)를 허용하는 `UpdateTaskRouting` 브리지 커맨드 신설 + Lead에 `loop_resolve(retry)` 전 제약 완화 수단으로 노출. 코어가 "완화는 downgrade 방향만" 검증(권한 상승 방지). 재자격화는 기존 `redispatch_ready_events`가 Attention 상태 태스크의 TaskReady를 이미 허용하므로 신규 경로 불요.

### G3 — 표시 계층 해결 어휘의 누락·불일치

- **증거**: `presentation/src/attention.ts` L58-71 `attentionResolutions`: failure에 `["retry","cancel"]`(defer·add_task 누락), approval에 `"approve"/"reject"` 반환 — 브리지 파서(`guidance.rs` `parse_resolution`)는 `"approved"/"rejected"`만 인식하고 그 외 비공백 문자열은 `Answer`로 해석되어 core가 Approval에 대해 `InvalidResolution`으로 거부. 현재는 테스트 전용이지만, 어댑터가 이 힌트를 채택하는 순간 해결 불능 토큰을 사용자에게 안내하게 됨.
- **수정 위치**: presentation 힌트를 브리지 파서 문법과 일치(`approved`/`rejected`, failure에 `defer` 추가, `add_task`는 payload 필요 각주)하도록 수정 — 단일 진실은 브리지 파서이므로 힌트를 생성 타입/문서에서 파생시키는 것을 권장.

### G4 — 비바인딩 failure attention의 retry 무연산과 blocked-goal 출구 협소

- **증거**: `guidance.rs` L173-177 `Some(FailureDirective::Retry) => { if let Some(task_id) … }` — task_id 부재 시 이벤트 없이 해소만 커밋. `coordinator.ts` L588-599의 blocked attention은 `blocked-<runId>-<lastSequence>`로 시퀀스가 바뀌어 매번 새 id가 발급되므로, "No runnable task remains" 상황에서 retry-해소→재개→재차 blocked의 id 증식 루프가 가능. blocked-goal의 경우 core 규칙상 Answer(자유 서술, 예: "증거 수용")가 거부되고 add_task는 태스크 바인딩 요구로 거부되어, 증거 수용 결정을 기록할 어휘가 없음.
- **수정 위치(권장)**: (1) 브리지 `resolve_attention`에서 비바인딩 failure에 대한 Retry/Defer를 사전 검증 단계에서 거부하거나(`invalid_resolution: unbound failure attention requires cancel or concrete repair`), 최소한 해소 응답에 "재디스패치 없음"을 명시 — 조용한 무연산 제거. (2) blocked-goal의 증거 수용은 기존 어휘로 풀리는 길을 권장: 기준 소유 태스크에 대한 `add_task`(G1 수정 선행) 또는 steer 승격으로 검증 태스크를 정비한 뒤 retry. 새 Answer-on-Failure 완화는 failure=directive pinned contract를 깨므로 비권장.

## 6. 권고 우선순위

1. **G1** (도구 계층만 수정, 코어 무변경) — 즉시 실현 가능하고 failure 회복의 구조적 수리를 여는 최소 변경.
2. **G2** (UpdateTaskRouting 브리지 커맨드 + 코어 다운그레이드 검증) — 제약 완화의 결정 기록을 이벤트 로그에 남기는 방향.
3. **G4** (무연산 retry의 명시적 거부) — 계약 명확화, 소규모.
4. **G3** (표시 힌트 정합화) — 위 3건 완료 시 add_task/defer 포함해 갱신.

## 7. 판정 업데이트 — 회복 경로 구현 및 전체 검증

검증일: 2026-07-18 워킹 트리.

- **G1 해소**: `loop_resolve`가 `add_task`에 `correctiveTask` 계약을 내장해 브리지에 전달하며, 테스트가 계약 필드와 코어의 정정 태스크 생성·선행 조건 연결을 확인한다.
- **G2 해소**: 배치 후보 부재 경로에 제약 완화 선택과 코어의 완화 기록·재자격화가 추가됐다. 통합 테스트는 완화 전 배치 거절에서 완화 후 배치 성공으로의 경로를 확인한다.
- **G3 해소**: attention 렌더링이 결정 설명과 명시적 선택지를 포함하는 답변 가능한 질문을 제공하며, 배치 부재 선택지와 resolve 계약이 결합 테스트로 검증됐다.
- **G4**: 이번 변경의 완료 계약에 포함되지 않아 **미해결**로 남긴다. 비바인딩 failure의 retry 무연산 및 blocked-goal의 협소한 출구는 별도 후속 과제다.

전체 체크 판정:

- `bun run check`: **통과** (재검증, exit 0) — `codegen:check`, `lint`, `typecheck`, `test:architecture`, `test` 완료. 최종 테스트 요약: `937 pass`, `0 fail`, 116개 파일. 이전 실행에서는 `apps/loop-mobile/src/App.tsx:33:3: error eslint(no-unused-vars): Identifier 'READOUT_STYLE' is imported but never used.`로 lint가 실패했으나 이번 재검증에서는 재현되지 않았다. 경고는 통과 판정과 별개로 남을 수 있다.
- `bun run build:cli && ./dist/loop verify-install`: **통과** — CLI/native build 완료, Loop offline acceptance `State: completed`, `Tasks: 7`, `Escalations: 1`.

따라서 현재 워킹 트리의 전체 저장소 검증과 오프라인 설치 검증은 통과했다. G1–G3는 해당 구현·회복 통합 테스트 기준 해소로 판정한다. **남은 격차: G4** (비바인딩 failure의 retry 무연산 및 blocked-goal의 협소한 출구). 이전 lint 실패는 재검증에서 재현되지 않았으며, 별도 유료 호출은 수행하지 않았다.
