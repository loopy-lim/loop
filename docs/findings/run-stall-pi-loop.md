# pi-loop attention resolve/restart 및 옵저버 갭 스톨 추적 (r3-pi-loop)

scope: `packages/pi-loop/src/extension.ts`, `packages/cli/src/run-control.ts`
보조 근거(읽기 전용): `packages/protocol/src/generated/types.ts`(SnapshotOutput 필드 의미),
`packages/cli/src/dispatcher.ts`(observeRun/waitForOwnerReady 존재 확인)

## 핵심 질문

attention이 resolve된 뒤 `resolveAttentionAndRestart`(extension.ts:1186-1205)가 재시작을
건너뛰는 조건(`state !== "active"`, `activeWorkers.length > 0`, `leaseAlive`)에서
구체적으로 어떤 시퀀스가 "owner 없는 non-terminal run"을 남기는가? 또한 run이
completed/failed에 도달했을 때 observer/최종 리포트 경로가 goal review를 홀드하는가,
아니면 대화·옵저버를 정체시키는가?

## 결론 요약

1. **resolve 시점의 lease 판정은 단일 순간 스냅샷이고, 건너뛴 뒤에는 아무도 다시 보지 않는다.**
   `leaseAlive`(extension.ts:1193-1195)는 resolve 커밋 직후 별도 CLI `status` 호출(extension.ts:1284-1290,
   `resolve` → `snapshot` 2회 spawn)에서 읽은 `executionExpiresAt` 하나로 결정된다. owner 프로세스가
   이미 죽었는데 lease 만료 시각이 미래면(사망 직후~TTL 창) 재시작을 건너뛰고, 이후 lease가 만료되어도
   **옵저버(extension.ts:471-491)는 500ms마다 상태를 렌더링만 할 뿐 재디스패치·에스컬레이션을 하지 않는다.**
   pi-loop에는 "active + 워커 0 + lease 만료"를 관측해도 행동하지 않는 구조적 빈곳이 있다.
2. **resolve는 커밋됐는데 restart가 실패하면 수동 복구만 남는다.** resume 실패 시
   attention은 이미 소비된 상태로 throw되고(extension.ts:1197-1204), 같은 attention을 다시
   resolve할 수 없으므로(미공개 → CLI resolve가 "not found") 사용자/Lead가 명시적으로 resume을
   요청하기 전까지 run은 owner 없는 `active`로 남는다. `backend.resolve` 내부의 두 번째
   `status` 호출이 실패해도 같은 상태가 되며(restart 시도 전 throw, extension.ts:1284-1290),
   이때는 "ask to resume" 안내문조차 없다.
3. **`activeWorkers.length > 0` 단독 게이트가 재시작을 막는다.** skip 술어가 OR
   (extension.ts:1196)이라 lease가 만료돼도 stale 워커 항목이 하나만 있어도 재시작하지 않는다.
   워커가 패널 종료·절전 등으로 죽었는데 reconcile되지 않았다면 무기한 정체고, 유일한 열쇠는
   수동 `loop reconcile <run> <task> stopped`(run-control.ts:82-89)뿐이다.
4. **재시작 정책이 CLI와 extension에 중복되면서 술어가 서로 다르다.**
   CLI(run-control.ts:61-65)는 `state === "active" && !leaseAlive`이고 `leaseAlive`가
   `executionOwner`를 보지 않으며 `activeWorkers`를 보지 않는다. extension(extension.ts:1192-1196)은
   `executionOwner`를 lease 판정에 요구하고 `activeWorkers`로 skip한다. 같은 스냅샷에서 두 호출자가
   반대 결정을 내릴 수 있다(예: `executionOwner: null` + 미래 만료각 → extension은 즉시 resume,
   CLI는 만료까지 대기). 재시작 여부는 단일 결정으로 core/bridge에서 내려야 할 정책이다.
5. **terminated 도달 시 goal review 홀드는 대화 쪽에만 존재하고 파기 가능하다.**
   acceptSnapshot의 terminal 분기(extension.ts:460-470)는 observer를 멈추고 `void reportFinal(...)`
   로 fire-and-forget한다. reportFinal은 task별 `backend.task`를 `Promise.all`로 기다린 뒤
   (extension.ts:320-341) 최종 메시지와 final-review 턴을 보내는데(extension.ts:384, 395-405),
   `runLoopCommand`에는 timeout이 없어(extension.ts:1409-1443) `loop task` 자식 하나가 멈추면
   **최종 리포트와 자동 review 턴이 모두 영원히 오지 않는다.** milestone 토스트는 이미 나갔으므로
   사용자는 "끝났는데 보고가 없는" 정지 상태를 본다. run 자체는 terminal이라 재디스패치 스톨은 아니지만,
   "기준 미검증 시 후속 run"이라는 goal review 안전망이 조용히 사라진다.

## resolveAttentionAndRestart 스톨 시퀀스 (step · state · who acts)

전제: 워커 실패 등으로 attention이 raise됐고 owner 프로세스는 곧 죽거나 이미 죽었다
(orchestrator/coordinator 측 정황은 r3-core 범위. pi-loop 입장에서 owner 생존은 스냅샷의
lease 필드로만 추정 가능 — extension.ts:1192-1195).

### R1. lease 만료 전 resolve → owner 사망 (TOCTOU, 확정 스톨)

| step | run 상태 (DB) | 행위 주체 | 근거 |
|---|---|---|---|
| 1 | `attention`, owner 만료각 T+L | 사용자/Lead가 loop_resolve 실행 | extension.ts:1013-1038 |
| 2 | `active` (attention 소비) | CLI `resolve` 커밋 | extension.ts:1284-1288 |
| 3 | — | extension이 별도 CLI `status`로 스냅샷 재조회 (수십~수백 ms 후) | extension.ts:1289-1290 |
| 4 | `active`, `executionExpiresAt=T+L>now`, `activeWorkers=[]` | `leaseAlive=true` → **restart skip** | extension.ts:1196 |
| 5 | `active`, lease 만료 (owner는 이미 사망) | **아무도 없음.** observer는 렌더링만, resolve는 끝났고 execute는 반환됨 | extension.ts:471-491 (poll은 acceptSnapshot뿐) |
| 6 | `active` 영구 | 사용자가 수동 resume/resolve 전까지 정체 | — |

재시작 skip이 "올바른" 판단이었으려면 4의 lease 뒤에 산 owner가 살아 있어야 한다.
owner가 죽은 뒤에는 5에서 만료를 재검토하는 주체가 pi-loop에 없다.

### R2. resume 실패/지연 → resolve는 커밋, 재시작은 없음

| step | run 상태 | 행위 주체 | 근거 |
|---|---|---|---|
| 1 | `attention` | loop_resolve → CLI resolve 커밋 | extension.ts:1189 |
| 2 | `active`, lease 만료, 워커 0 | 재시작 조건 통과 → `backend.resume` = CLI `resume` spawn | extension.ts:1197-1199, 1269-1272 |
| 3 | `active` | spawn 실패/CLI 비정상 종료 → catch 후 안내문과 함께 throw | extension.ts:1200-1204 |
| 4 | `active`, owner 없음 | attention은 이미 소비 → loop_resolve 재시도 불가("not found"). Lead가 안내문을 보고 loop_control resume을 골라야만 복구 | extension.ts:1030-1036(도구 에러), run-control.ts:87-89 |

variant: `backend.resolve`의 두 번째 `status` 호출이 실패하면 restart 분기 도달 전에 throw
(extension.ts:1289-1290) — 동일 결과, 안내문 없음, tool 에러는 raw CLI stderr.

### R3. stale activeWorkers → lease와 무관하게 skip

| step | run 상태 | 행위 주체 | 근거 |
|---|---|---|---|
| 1 | `attention` | loop_resolve | extension.ts:1189 |
| 2 | `active`, `activeWorkers=[죽은 워커]`, lease 만료 | OR 술어의 `activeWorkers.length > 0` → **restart skip** (lease 만료여도) | extension.ts:1196 |
| 3 | `active` 영구 | 워커 항목은 reconcile 돼야만 정리됨 | run-control.ts:82-89 (수동, `stopped` 확인 요구) |

### R4. resolve 후 state가 `attention` 잔존 (정상이지만 노출 의존)

| step | run 상태 | 행위 주체 | 근거 |
|---|---|---|---|
| 1 | `attention`(A, B 공개) | loop_resolve(A) → state 여전히 `attention` → skip(정상) | extension.ts:1196 |
| 2 | `attention` | acceptSnapshot이 B를 신규 attention으로 발화 | extension.ts:427-459 |
| 3 | `attention` | B 해소 시 R1~R3과 동일한 재시작 판정 재사용 | — |

R4 자체는 스톨이 아니지만, observer가 바인딩되지 않은 세션(restore 후보 0개 또는 2개 이상,
extension.ts:531-549)에서는 2의 발화가 없어 B가 침묵한다. 추가로 세션 복원 시
`announcedAttention`을 세션 엔트리에서 재구성하므로(extension.ts:512-517) 크래시 전 발화됐으나
여전히 공개된 attention은 **다시 발화되지 않는다** — 사용자가 못 본 채로도.

## 옵저버/최종 리포트 경로 (completed/failed 도달 시)

| 경로 | 동작 | 홀드/정체 여부 | 근거 |
|---|---|---|---|
| terminal 스냅샷 관측 | 1회 최종 발화(`announcedFinal`) → milestone 토스트 → `void reportFinal` → `stopObserver` | observer는 정상 종료. 이후 progress 렌더링 없음(정상) | extension.ts:460-470, 307-313 |
| reportFinal 정상 | task별 `backend.task` 수집 → `loop-final` 메시지(triggerTurn:false) → `loop-final-review` 턴(triggerTurn:true, followUp) | **goal review 홀드는 이 턴이 전부.** 기준 미검증 시 Lead가 후속 run을 시작하도록 프롬프트로 유도 | extension.ts:316-341, 384-386, 388-406 |
| reportFinal 중 hang | `runLoopCommand`에 timeout 없음 → `loop task` 자식 정지 시 Promise.all 불수렴 → 최종 메시지·review 턴 미발송, 무응답 promise 방치 | **조용한 홀드 상실.** 토스트는 나갔으니 "끝났는데 보고 없음" | extension.ts:320-341, 1409-1443 |
| reportFinal 중 rebind | `currentRunId !== snapshot.runId`면 findings 계산 후 조용히 return | review 턴 소실(터미널 run이므로 재디스패치 스톨은 아님) | extension.ts:341 |
| `pi.sendMessage` 부재/거절 | 최종 리포트 생략 또는 catch로 notify만 | review 홀드 없음 — 사용자 프롬프트 의존 | extension.ts:383-386, 400-406 |
| observer 오류 루프 | snapshot 예외 시 status "observation unavailable" + 위젯 해제, 인터벌은 계속 | 재시도는 하지만 재디스패치·종료 판단 없음(DB 삭제 시 무한 500ms 폴링) | extension.ts:483-491 |
| `inFinalReviewTurn` 잔존 | final-review 메시지에 true, user 메시지/agent_end에 해제 | 턴 크래시로 agent_end 미발화 시 steer/add_task가 다음 사용자 메시지까지 차단 (dispatch 스톨 아님) | extension.ts:1221-1229, 909, 939 |
| runTool hang | `backend.run`이 `__execute-plan --detach` 종료를 무기한 대기(timeout 없음) | 턴 홀드 가능(abort signal 시 SIGTERM은 감) | extension.ts:644-666, 1446-1493 |

## 아키텍처 관찰: 재시작 정책의 이중화

`loop resolve` 후 owner 재기동 여부가 두 곳에서 서로 다른 술어로 결정된다.

| | CLI (run-control.ts:61-65) | extension (extension.ts:1192-1196) |
|---|---|---|
| 재시작 조건 | `state === "active" && !leaseAlive` | NOT(`state==="active"` \|\| `workers>0` \|\| `leaseAlive`) |
| `leaseAlive` 정의 | `executionExpiresAt > now` | `executionOwner && executionExpiresAt > now` |
| `activeWorkers` 고려 | 없음 — stale 워커가 있어도 기동 (이중 owner 위험은 core 몫) | 있음 — stale 워커면 skip (R3 스톨) |

동일 스냅샷에서 반대 결정이 가능한 것은 정책이 호출자별로 복제됐다는 신호다. AGENTS.md의
graph-first 원칙상 "owner가 필요한가?"는 결정적 정책이므로 스냅샷 한 필드(예: `needsOwnerRestart`)
또는 단일 명령(예: `ensureOwner`)으로 bridge/core가 답하고, CLI와 extension은 그 답을 실행하는
얇은 어댑터가 되어야 한다. 이 경우 R1의 재검토 루프(lease 만료 후 1회 재판정)도 한 곳에 넣을 수 있다.

## 권고 (pi-loop 범위)

1. **R1 재검토:** restart skip 시 이유(`leaseAlive`/`workers>0`)를 결과에 남기고, observer의
   acceptSnapshot이 `active && workers===0 && lease 만료`를 관측하면 1회에 한해 resume 재시도 또는
   상태를 "owner 상실"로 에스컬레이션한다(현재는 렌더링만, extension.ts:471-491).
2. **R2 안내 강화:** `backend.resolve`의 status 재조회 실패 시에도 "resolve는 커밋됨, resume 필요"
   안내를 유지하고, loop_resolve 도구가 에러 대신 재시작-실패 스냅샷을 반환해 Lead가 loop_control로
   이어가게 한다(extension.ts:1197-1204, 1284-1290).
3. **R3 최소 완화:** lease가 만료됐는데 `activeWorkers`만 존재하는 조합은 skip 대신
   "reconcile 필요" 상태로 명시 노출한다(현재는 정상 active처럼 렌더링됨).
4. **reportFinal 방어:** task 수집에 timeout을 두거나 실패 시 최종 메시지를 먼저 보내도록 순서를
   바꿔 review 홀드 상실을 막는다(extension.ts:316-341).
5. **정책 단일화:** 위 표의 재시작 술어를 bridge/core 스냅샷 결정으로 이동(4번 관찰).
