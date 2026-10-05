# Coordinator 디스패치 루프 정지(stall) 경로 추적 — r1-coordinator

조사 대상: `Orchestrator.execute` 디스패치 루프(`packages/orchestrator/src/coordinator.ts`)에서
실행 promise가 종료·예외·블록으로 빠져나가는데 run이 종료 상태(completed/failed/cancelled)가
아닌 모든 경로. 각 경로에 대해 execute 반환 후 re-dispatch 소유권이 남아 있는지를
file:line 근거와 함께 기록한다.

## 재디스패치 소유자 판정 (사전 정리)

| 소유자 | 근거 | 재디스패치 조건 |
| --- | --- | --- |
| gateway planner fire-and-forget | `packages/gateway/src/planner.ts:184-188` — `options.execution.execute(...).catch(() => {})` 로 오류를 의도적으로 삼킴. 1회 실행 후 다시 execute를 부르는 경로 없음 | **없음** (재디스패치 소유자 아님) |
| gateway snapshot pump | `planner.ts:165-167` 주석 — 실행 실패는 store 상태로만 표면화. 만료된 lease를 자동 재점유하는 reaper 없음 | **없음** (관측만 수행) |
| pi-loop resolveAttentionAndRestart | `packages/pi-loop/src/extension.ts:1186-1204` — attention 해석 후 state=active && activeWorkers 없고 && lease 만료면 `backend.resume` → CLI `resume` (`extension.ts:1269-1271`) | **사람이 attention을 resolve할 때만**. resume 실패 시 예외로 사용자에게 노출(`extension.ts:1201-1204`)되고 run은 active 잔존 |
| CLI `loop resolve` | `packages/cli/src/run-control.ts:56-66` — resolve 후 state=active && lease 만료면 `launchOwner`로 자동 재점유 | resolve 시점에만. pi-loop는 이 CLI의 자동 재점유를 쓰지 않고 자체 guard로 resume을 별도 호출 |
| CLI `loop resume` | `packages/cli/src/run-control.ts:87-90` — `resumeRun` + `launchOwner` | **수동** |
| 상시 복구 reaper | 없음 — `loop status` 등 어떤 명령도 만료 lease를 자동 재점유하지 않음 (run-control.ts 전체에서 조건부 launchOwner는 resolve/resume뿐) | **없음** |

즉, execute가 attention 없이 (또는 resolve 실패로) 반환되면 **사람 개입 없이는 아무도
디스패치를 다시 소유하지 않는다**. 아래 표의 "재시작 가능"은 이 기준으로 판정했다.

## 경로별 분석

coordinator.ts 줄 번호는 현재 작업 트리 기준. 터미널 상태 = completed/failed/cancelled.

| # | 경로 | 트리거 | run 최종 상태 | 재시작 가능한 주체 | 판정 |
| --- | --- | --- | --- | --- | --- |
| A1 | 초기 lease 거절 후 타 소유자 갱신 관측 (coordinator.ts:224) | 다른 owner의 `executionExpiresAt`이 연장됨 → `return summary`(status=running) | active (비터미널) | 타 lease 소유자만. 그 소유자가 직후 죽으면 무재디스패치 | **경쟁 착취(race) stall 가능** — 갱신 관측은 "살아있음"의 증거가 그 순간까지만 유효 |
| A2 | 초기 lease 거절, 만료 대기 후에도 재점유 실패 (coordinator.ts:227) | 만료+250ms 대기 후 `lease()` 재거절 → `return summary`(status=running) | active | 방금 lease를 가져간 제3 소유자. 그 소유자가 죽으면 무재디스패치 | **경쟁 stall 가능** (창은 좁음) |
| B | cancelling/cancelled 분기에서 cancelRun 후에도 state≠cancelled (coordinator.ts:283-301) | cancel 경쟁 실패 → `summary.status="attention"` 반환이지만 store에는 attention 부재 가능 | cancelling/attention 잔존 가능 | attention 기록이 없으면 pi-loop resolve 불가 | **낮은 확률 에지** — attention 미기록 시 재시작 경로 없음 |
| C | settled worker `task.error` 재던짐 (coordinator.ts:307) → 외부 catch (513-533) | worker 실행 중 예외(예: recordWorkerStarted 실패 재던짐 412, mailbox/cleanup 오류) | store=attention (`dispatcher-${owner}`, 518-526) 또는 failed | lease가 살아있고 비터미널이면 attention 기록 → 사람 resolve 시 pi-loop/CLI 재시작 | **설계된 human-park**. 단, catch 내 `requestAttention` 자체가 실패하면(예: store 장애) attention 없이 반환 → 무재디스패치 |
| D | terminal 상태 반환 (coordinator.ts:311-312) | snapshot completed/failed | 터미널 | 불필요 | 정상 |
| E1 | `active.size===0` + attention/pausing/paused 반환 (coordinator.ts:314-317) | attention 오픈 또는 pause 확정 시 | attention 또는 paused (비터미널) | 사람 resolve(pi-loop) 또는 resume(pi-loop/CLI) | **설계된 park** — failure-kind attention(`blocked-`/`provider-`)은 인간 의사결정 대기. resolve되면 재시작. 무인 환경에서는 정지로 보임 |
| E2 | `claims.outcome === "attention_held"/"paused"` 스핀 (coordinator.ts:332-334) | loop-core attention-hold/pause로 claim 보류 → 50ms 폴링 후 continue → 다음 루프 상단에서 E1로 수렴 | attention/paused | E1과 동일 | E1로 수렴. 무한 블록 아님(상단 상태 체크가 반드시 반환) |
| G | provider 라우팅 실패 attention (coordinator.ts:386-395) | `#routeFor`/`selectWhileActive` 예외(타임아웃 포함, 556-565) → `provider-` attention 기록 후 break | attention (active.size>0이면 워커 소진 후 E1로) | 사람 resolve | **설계된 park**. 단 `blocked-`와 달리 남은 runnable이 있어도 attention-hold가 claim을 막아 워커 전부 소진될 때까지 대기 후 반환 |
| I | **lease 상실** (coordinator.ts:287, 492 throw → catch 513-533) | heartbeat 갱신 실패(이벤트 루프 5s 초과 블록, store 일시 장애, 타 owner 강탈) → `leaseLost=true` throw. catch의 `!leaseLost` 가드(518)가 **attention 기록을 건너뜀** | **store=active 잔존**, owner 없음, attention 없음 | **아무도 없음** — pi-loop는 attention이 없어 resolve 불가, gateway는 fire-and-forget, reaper 없음. `loop resume` 수동만 가능 | **확정 무재디스패치 stall (핵심 결함)** |
| J | pi-loop 재시작 실패 (extension.ts:1199-1204) | attention resolve는 성공했으나 `backend.resume` 예외 | store=active(attention 해석됨), owner 없음 | 사용자에게 오류 메시지 후 수동 resume만 | **확정 무재디스패치** — resolve 성공과 owner 재점유 사이 원자성 없음 |
| K | catch 경로 내 store 호출 실패 (coordinator.ts:515-526) | catch에서 `getSnapshot`/`requestAttention` 예외 → execute reject → gateway `.catch(()=>{})` 삼킴 (planner.ts:185) | store 상태 불명(주로 active) | 없음 | **에지 stall** — finally의 `releaseExecution`(536)도 실패 시 lease가 TTL 5s 후 만료되지만 재점유자 없음 |

## 확정 결함 요약

1. **I (lease 상실 무알림)** — 가장 명확한 결함. `leaseLost` 시 catch에서 attention을
   기록하지 않아 run이 `active` 상태로 owner·attention 없이 방치된다
   (coordinator.ts:518의 `!leaseLost` 조건). 심지어 반환 summary만 `attention`이라
   gateway 와이어 상태(store)와 어긋난다. loop-core의 lease TTL(5s)이 지나도
   claimExecution을 다시 부르는 주체가 없으면 영구 정지.
2. **A1/A2 (초기 lease 경쟁 낙관)** — 갱신 연장 관측(224)과 재점유 실패 반환(227)은
   "다른 소유자가 계속 살아있다"는 순간 스냅샷에 의존한다. 소유자 사망 시 동일한
   무재디스패치 상태로 수렴한다.
3. **J (resolve–재시작 비원자성)** — pi-loop의 resolve 성공 후 resume 실패는
   active 잔존 + owner 부재를 남긴다(extension.ts:1194-1204). CLI `loop resolve`는
   같은 조건에서 launchOwner까지 자동 수행하므로(run-control.ts:61-66) 두 재시작
   경로의 강도가 불일치한다.
4. **E1/G (설계된 human-park의 무인 정지)** — 결함이라기보다 정책이지만, failure-kind
   attention이 `blocked-`(coordinator.ts:499-507), `provider-`(391-395),
   `dispatcher-`(523-526)로 열리고 execute가 반환되면 무인 실행에서는 영구 대기다.
   "재시도 가능한 failure attention은 유한 재시도 후 자동 해석" 같은 정책적 보완이
   없는 한 무인 stall은 이 설계의 필연적 귀결이다.

## 권고 (후속 수정 과제용)

- I: catch에서 `leaseLost`여도 store 상태가 비터미널이면 failure attention을 기록해
  pi-loop/CLI resolve 경로를 열어 둔다 (또는 lease 재획득 재시도 후 실패 시 기록).
- A1/A2: 반환 직전 마지막 snapshot에서 owner 생존 신호(lastProgress/owner health,
  `GraphOwnerHealth` 어휘 존재)를 확인하고, 부재 시 자체 재점유를 시도한다.
- J: resolve와 owner 재점유를 한 CLI 트랜잭션으로 통일하거나, resume 실패 시에도
  attention을 재오픈해 재시도 가능하게 한다.
- E1/G: failure-kind attention에 대한 bounded auto-retry(예: `blocked-` N회까지
  자동 resolve+resume)는 정책 결정이 필요하므로 별도 결정 기록(ADR)으로.

## 검증 방법

- 각 경로의 줄 번호와 인용은 `packages/orchestrator/src/coordinator.ts`,
  `packages/gateway/src/planner.ts`, `packages/pi-loop/src/extension.ts`,
  `packages/cli/src/run-control.ts` 현재 작업 트리 기준.
- 회귀 테스트 대상(후속 수정 시): leaseLost attention 기록(coordinator), 초기 lease
  경쟁에서 소유자 사망 재점유(coordinator), resolve-resume 비원자성(pi-loop seam).
