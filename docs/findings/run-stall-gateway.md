# Gateway 실행 수명주기 스톨 경로 추적 (r2-gateway)

scope: `packages/gateway/src/{planner,service,events,projection}.ts`, `packages/gateway/src/main.ts`(composition 근거), `packages/cli/src/{execute-plan,run-lifecycle}.ts`
보조 근거(읽기 전용): `packages/orchestrator/src/coordinator.ts`, `packages/orchestrator/src/runtime.ts`, `packages/cli/src/{run-control,dispatcher}.ts`

## 핵심 질문

`orchestratorPlanner`가 `options.execution.execute(...)`를 fire-and-forget으로 넘긴 뒤
(planner.ts:185, `.catch(() => {})`로 에러 흡수), 그 promise가 settle되었을 때
run은 어떤 상태로 남고, 재실행(re-dispatch) 주체가 있는가?

## 결론 요약

게이트웨이에는 **어떤 계층에도 자동 재실행 주체가 없다.** execute가 정상 종료하든
던지든(thrown), 게이트웨이는 관찰(snapshot pump)만 하고 dispatch는 다시 걸지 않는다.
또한 게이트웨이 프로세스 재시작 시 in-process LoopRuntime이 사라지며, 부팅 시
active run 스캔/재기동 로직도 없다. 재실행은 전적으로 (a) 사람이 CLI `loop resolve`
혹은 `loop nightly --execute`를 돌리거나, (b) 아무도 안 하는 상태로 남는다.

## execute settle 이후 상태 전이 (planner.ts:180-188)

| 트리거 | execute 결과 | store에 남는 run 상태 | gateway 관찰(status) | 재실행 주체 |
|---|---|---|---|---|
| prepare 실패 | — (execute 미호출) | run 없음/계획 실패 | `failed`(terminal, service.ts:305-315 `#planningFailed`) | 없음 — terminal이므로 불필요 (정상 경로) |
| 모든 task 완료 | `RunSummary{completed}` | `completed` | `completed` → terminal frame, pump 정지 (service.ts `#absorb`) | 없음 — terminal (정상) |
| attention 보유 중 claim hold → 상태 확인에서 attention 복귀 (coordinator.ts:314-318) | `RunSummary{attention}` | **`attention` (non-terminal)** | `attention` (non-terminal, projection.ts:31-44) — terminal frame 없음, pump는 계속 돌지만 상태는 영원히 attention | **NONE (gateway)**. CLI `loop resolve`만 재실행 (run-control.ts:69-78) |
| task 에러 throw / lease 상실 (coordinator.ts:523, 531 catch) | **rejected** → planner.ts:185 `.catch(() => {})`로 흡수 | lease 유지 시 `attention`(`dispatcher-*` failure attention, coordinator.ts:525-531) / lease 상실 시 `active` 잔존 후 TTL 5s 만료 (coordinator.ts:224-232 참고: ttlMs 5000) | `attention` 또는 **`running` 영구 표시** | **NONE (gateway)** |
| 일시정지(pausing/paused) (coordinator.ts:314-317) | `RunSummary{paused}` | `paused` (non-terminal) | `attention`으로 투영 (projection.ts:33) | steer/resolve 수동만 존재 |
| 시그널 abort (게이트웨이 shutdown, main.ts `abort`) | cancel 경로 → `cancelled` 또는 `attention` (coordinator.ts:270-283) | `cancelled`(terminal) 또는 `attention` | 그에対応 | cancelled는 정상, **attention은 NONE** |

## 트리거별 스톨 경로 상세

### S1. attention 상태에서 execute 정상 복귀 (no-re-dispatch, 확정)

- 근거: planner.ts:185-188 — promise 결과를 보는 코드가 없음.
  coordinator.ts:314-318에서 `active.size === 0 && state ∈ {attention, pausing, paused}`면
  summary만 만들고 return. 이후 게이트웨이에서 `execute`/`resume`을 다시 부르는 곳 없음
  (`grep -rn "resume|re-dispatch|restart" packages/gateway/src/{main,service,planner}.ts` → 0건).
- 결과: run은 `attention`으로 non-terminal. service.ts `#absorb`는 terminal일 때만
  pump를 멈추고 terminal frame을 append하므로, attention에서는 pump가 살아
  status만 반복 투영. SSE 클라이언트는 클로저 신호를 영원히 못 받음.
- 유일한 재실행: `loop resolve` CLI — resolveAttention 후
  `state === "active" && !leaseAlive`면 `launchOwner` 재기동 (run-control.ts:69-78).
  **게이트웨이에는 attention-resolve 엔드포인트 자체가 없다** (server.ts에 resolve 라우트 없음,
  steer만 존재 — main.ts:246-259, steerRun은 guidance append만 하고 dispatch를 걸지 않음).
  원격 게이트웨이 클라이언트는 attention을 해소할 방법이 없음 → 인간이 같은 DB에
  CLI로 접속해야만 함.

### S2. execute reject가 삼켜지는 경로 (확정)

- 근거: planner.ts:184-188 `.catch(() => { /* Contained on purpose */ })`.
  coordinator.ts:519-531 catch 블록은 lease를 아직 보유 중일 때만
  `dispatcher-${owner}` failure attention을 요청하고, 그렇지 않으면(lease 상실)
  **store에 아무 표시도 남기지 않고** summary만 반환/재throw.
- 결과 분기:
  - lease 유지 + attention 기록 성공 → S1과 동일한 attention 스톨.
  - lease 상실 → run이 `active`로 남고 lease는 TTL 5s 후 만료
    (coordinator.ts:224 heartbeat ttlMs 5000). 이후 gateway 투영은
    `active → running` (projection.ts:32)이라 **영구 `running` 표시**.
    `executionExpiresAt`은 snapshot 필드로는 노출되지만 투영 상태 판정에 쓰이지 않음.
- 재실행 주체: **NONE**. `loop nightly --execute`가 `stalled` disposition으로
  이 상태를 감지해 재기동할 수 있으나(run-lifecycle.ts:82-135, nightlyDisposition),
  게이트웨이는 nightly를 실행하지 않고, 자동 실행 스케줄도 없음.

### S3. 게이트웨이 프로세스 재시작 mid-run (확정)

- 근거: main.ts:433-471 `bootGatewayFromEnv` — LoopRuntime을 in-process로 생성하고
  `execution: RunExecutionPort = loopRuntime` (main.ts:463). 게이트웨이 종료 시
  runtime·heartbeat·워커가 모두 소멸. 부팅 시퀀스 어디에도 `listRuns()` 결과의
  `state === "active"` 행을 훑어 execute를 다는 코드가 없다
  (`listRuns`는 service.ts:138-144(목록 병합)와 `#adopt`(service.ts:280-287, 관찰 only)에서만 사용).
- 결과: store에는 `active` run + 만료된 lease(TTL 5s) 잔존. coordinator.ts:203-231의
  lease 인수 대기 로직은 **execute를 다시 부르는 누군가가 있을 때만** 의미가 있고,
  게이트웨이는 부르지 않으므로 무의미. 투영은 영구 `running`.
- 재실행 주체: **NONE (gateway)**. 수동 remedy: `loop nightly --execute`
  (run-lifecycle.ts — `ready|settlement|stalled` disposition만 재기동, lock으로 중복 방지).

### S4. CLI `__dispatch` / `__execute-plan` 경로의 동일 패턴 (참고)

- execute-plan.ts:96-107: payload 없는 `__dispatch`는 in-process
  `runtime.execute(runId, stop.signal)` 후 프로세스 종료(exit 0). attention으로
  복귀해도 그대로 종료 → S1과 동일한 non-terminal 잔존.
- execute-plan.ts:54-77: `__execute-plan` payload 경로는 `launchOwner`로 detached
  owner를 띄우고 `waitForOwnerReady`로 인수 확인 — 이 경로는 owner 프로세스가
  살아 있는 동안은 자체 dispatch 루프가 있으므로 안전. 단 owner 프로세스가 죽으면
  S3과 동일해짐(detached owner에 대한 게이트웨이/CLI의 자동 감시 없음).

### S5. 관찰 계층은 스톨을 만들지 않음 (확인)

- events.ts: stateless ring buffer — lifecycle 정책 없음 (주석 명시).
- projection.ts:31-44: `attention → attention`, `active/pausing/cancelling → running`
  모두 non-terminal. terminal 집합은 completed/failed/cancelled뿐이라
  attention/paused에서 투영이 "끝났다"고 거짓말하지 않음 → 스톨의 원인이 아니라
  스톨을 그대로 드러냄.
- service.ts `#absorb`/`#startPump`: pump는 terminal에서만 정지, attention에서는
  유지 — 관찰은 계속되지만 dispatch는 여전히 없음.

## 요약 테이블

| # | 트리거 | 결과 run 상태 | 재실행 주체 |
|---|---|---|---|
| S1 | attention 보유로 execute 정상 복귀 | `attention` (non-terminal) | **NONE** (CLI `loop resolve` 수동, 게이트웨이에 resolve 엔드포인트 없음) |
| S2 | execute reject (worker error / lease 상실) → `.catch` 흡수 | `attention` 또는 `active`(만료 lease) → 영구 `running` 투영 | **NONE** (`loop nightly --execute` 수동) |
| S3 | 게이트웨이 재시작 mid-run | `active` + expired lease → 영구 `running` 투영 | **NONE** (`loop nightly --execute` 수동) |
| S4 | CLI `__dispatch` attention 복귀 후 exit | `attention` (non-terminal) | **NONE** (수동 resolve) |
| S5 | prepare 실패 / 완료 / cancel | `failed`/`completed`/`cancelled` (terminal) | 불필요 (정상) |

## 수정 방향 제안 (이 워커 scope 밖, 후속 구현용)

1. **최소 수정(S1/S2)**: planner.ts의 fire-and-for그램에서 settle 결과를 받아
   `attention`/`paused` 복귀 시 재dispatch 정책을 명시적으로 결정
   (재시도 상한 포함, 무한 재dispatch 방지). `.catch(() => {})`는 rejection만
   흡수하도록 좁히고 결과는 로깅/attention 정책으로 승격.
2. **게이트웨이 부팅 복구(S3)**: `bootGatewayFromEnv`에서 `listRuns()`의
   non-terminal 행을 훑어 expired-lease active run을 coordinator execute로 재인수
   (CLI `resolve`/`nightly`의 판정 로직과 동일한 조건: `state === active && !leaseAlive`).
   store의 lease CAS가 이미 이중 소유를 막으므로 안전.
3. **원격 해소(S1의 원격 반쪽)**: 게이트웨이에 attention resolve 엔드포인트 추가 시
   resolve 성공 후 재dispatch 조건(`active && !leaseAlive`)을 서버 쪽에서도
   동일히 적용해야 run-control.ts:69-78과 정합.
