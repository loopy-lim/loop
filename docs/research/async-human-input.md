# Async Human Input — immediate receipt, non-blocking application

- **Date:** 2026-09-25
- **Kind:** research (no implementation)
- **Question:** 운영자 입력을 attention/pending으로 막아두지 않고 즉시 수신해 실행 중인 작업에 비동기로 반영하려면 어떻게 설계해야 하는가?
- **Sources:** 로컬 저장소 코드(crates/, packages/), 설치된 pi 문서(`@earendil-works/pi-coding-agent/docs`), 설치된 Claude Code 번들(`~/.local/share/claude/versions/2.1.263`, minified 문자열 증거). 유료 모델 호출 없음.

---

## 1. Loop 오늘의 운영자 입력 처리 (file:line 증거)

### 1.1 steer 경로 — 수신은 즉시·무차단, 반영은 다음 클레임 때

```text
loop steer (CLI) → protocol.steerRun → bridge steer_run → GuidanceAdded 이벤트 → projection.guidance → get_task_context (다음 클레임 시)
```

1. **수신(즉시, 비차단):** `packages/cli/src/main.ts:154-157` — `loop steer <run-id> <task-id|all> <message>`가 `protocol.steerRun` 호출. watch-to-steer 릴레이(`packages/cli/src/main.ts:243-261`, `packages/herdr/src/relay.ts:1-14`)도 같은 `steerRun` 백엔드로 라우팅된다(watch-to-steer 결정: `docs/decisions/2026-09-23-watch-to-steer.md`).
2. **기록(이벤트 소싱):** `crates/loop-bridge/src/execution.rs:248-262` — `steer_run`은 1~16,000 바이트 검증만 하고 `EventKind::GuidanceAdded { task_id, message }`를 즉시 append한다. run 상태를 바꾸지 않는다.
3. **리듀서(거의 항상 수용):** `crates/loop-core/src/event/reducer.rs:94-102` — `GuidanceAdded`는 `require_controllable`만 요구하고, 이는 터미널 상태(Completed/Failed/Cancelled)만 거부한다(`reducer.rs:481-487`, `crates/loop-core/src/run/run.rs:20-22`). 즉 Active·Paused·**Attention** 상태에서도 steer는 수용된다 — 수신 관점에서 이미 "pending 없이 즉시 수신"이다.
4. **소비(지연이 여기서 발생):** `get_task_context`(`crates/loop-bridge/src/execution.rs:280-321`)가 `projection.guidance`를 task로 필터링해 컨텍스트에 포함한다(`execution.rs:304-311`). 이 함수는 coordinator가 **새 클레임 시점에만** 호출한다(`packages/orchestrator/src/coordinator.ts:176`). `executeTask`는 시작 시 받은 `context`를 끝까지 사용한다(`packages/orchestrator/src/task-execution.ts:14-16, 49-50`).

**결론: 실행 중인 worker는 steer를 전혀 보지 못한다.** GuidanceAdded는 (a) 아직 디스패치되지 않은 태스크, (b) 같은 태스크의 재시도 attempt에만 반영된다. `docs/decisions/2026-09-23-watch-to-steer.md` 레인별 참고도 이를 전제한다("원샷은 steer가 재시도/다음 시도 컨텍스트에 반영").

### 1.2 미사용 라이브 채널이 이미 존재

- `packages/providers/src/types.ts:90-97` — `AgentProvider.steer?(workerId, message)`: "optional live-conversation steering channel". 거부 시(예: `agent_blocked`) 기록된 steer 계약(recorded-steer contract)으로 런 히스토리에 남는다.
- 구현: `packages/providers/src/herdr-agent.ts:167-175`(라이브 대화가 있는 pi worker → `runtime.steer`), `packages/herdr/src/client.ts:345-356`, `packages/providers/src/mirror.ts:468-472`(위임).
- **그러나 orchestrator는 `provider.steer`를 호출하지 않는다.** `packages/orchestrator/src` 전체에서 steer 관련 호출은 steerRun/릴레이 구성뿐이다. 즉 채널 파이프라인은 있고 배선(이벤트 → 실행 중 worker)이 없다.

### 1.3 attention 경로 — 이것이 "막아두는" 메커니즘

```text
control.requestAttention → bridge request_attention → AttentionCreated 이벤트 → run_state = Attention → claim 중단
```

1. `packages/orchestrator/src/control.ts:20` — `requestAttention`이 control 표면에 포함.
2. `crates/loop-bridge/src/commands.rs:805-820` — `request_attention`이 `AttentionCreated` 이벤트 append.
3. 리듀서가 `run_state = RunState::Attention`으로 전이(`crates/loop-core/src/event/reducer.rs:245` 등).
4. `crates/loop-bridge/src/commands.rs:500` — `claim_runnable_tasks`는 `run_state != Active || has_open_attention()`이면 빈 목록 반환 → **새 작업 스케줄링 하드 차단**. coordinator 루프는 attention 상태를 보고 summary와 함께 반환한다(`packages/orchestrator/src/coordinator.ts:152-156, 166-171`).

steer는 이 경로를 전혀 거치지 않는다. 요구사항인 "attention으로 막지 않는 수신"은 steer가 이미 만족하며, 빠진 것은 **실행 중 worker로의 비동기 반영**뿐이다.

### 1.4 관찰된 구조적 리스크 (설계 시 함께 다룰 것)

- `projection.guidance`는 무한 `Vec<Guidance>`(`reducer.rs:59, 99`) — 소비/만료 개념이 없어 긴 런에서 컨텍스트가 계속 커지고, 모든 후속 태스크 컨텍스트에 누적된다.
- 배달 여부를 기록하는 이벤트가 없어 "이 guidance를 이 worker가 봤는가"를 판정할 수 없다(재시도 시 중복 주입 가능).

---

## 2. pi 하니스: 실행 중 입력 처리

설치된 문서 기준(`~/.local/share/fnm/node-versions/v22.21.1/installation/lib/node_modules/@earendil-works/pi-coding-agent/docs/`):

- **두 가지 큐, 명시적 선택:** `docs/sdk.md:66-68` — 스트리밍 중 `prompt()`는 steer/follow-up 중 무엇인지 반드시 지정해야 하고, 아니면 **거부**한다(추측 금지). `steer()`와 `followUp()`이 그 행동을 직접 노출.
- **반영 시점 = 턴 경계:** `docs/how-pi-works.md:11-13` — "Steering messages enter after the current assistant turn(도구 호출 실행 완료 직후, 다음 LLM 호출 직전). Follow-up messages enter after the agent has finished its pending work. Aborting stops the current run and returns queued messages to the editor." 실행을 막지 않고 다음 안전 지점(도구 경계)에서 소비한다.
- **RPC 계약:** `docs/rpc-commands.md:20-29` — 스트리밍 중 prompt는 `streamingBehavior: "steer" | "followUp"` 필수, 미지정 시 에러. `:44-64` — 독립 `steer` 커맨드. `:325-335` — `set_steering_mode`: `"all"`(완료된 턴 뒤 전부 전달) vs `"one-at-a-time"`(턴당 하나, 기본값) — **스팸 처리 정책이 설정으로 노출**된다.
- **수명주기:** `docs/rpc.md:67` — `agent_end`는 한 저수준 런의 끝일 뿐이고 steer/재시도가 뒤따를 수 있으며, 클라이언트는 `agent_settled`를 기다려야 한다.

핵심 패턴: **수신은 언제나 즉시(큐에 적재), 소비는 도구/턴 경계, 차단 없음, 전달량 정책(one-at-a-time/all)이 설정값.**

## 3. Claude Code: 실행 중 입력 처리

설치 번들(`~/.local/share/claude/versions/2.1.263`)의 문자열 증거(minified):

- **타이핑하면 큐잉:** 온보딩 팁 — "Hit Enter to queue up additional messages while Claude is working." / "Send messages to Claude while it works to steer Claude in real-time" (`enter-to-steer-in-relatime`).
- **큐는 편집 가능·즉시 플러시 가능:** "Press up to select a queued message, then Enter to edit it" / "Press up to edit queued messages, Enter to send them immediately" — 큐에 쌓아두되 사용자가 원하면 즉시 전달로 에스컬레이션.
- **반영 시점:** 큐잉된 메시지는 턴 경계에서 transcript로 흡수된다("absorbed queued messages ... content from other turns"). 원격 브리지는 플러시 후 "Drained N queued message(s) ... after flush"로 소비를 드레인한다.
- **서브에이전트 전파:** `tengu_subagent_steer_applied`, `subagent_steer_delegation` 텔레메트리 — 메인 에이전트에 대한 steer가 서브에이전트 계층에도 적용될 수 있음을 시스템이 일급 처리한다.
- **생명주기 게이트:** "Agent ... cannot take queued messages" — 종료/정지 상태 에이전트에는 큐 전달이 실패할 수 있고, 이때 미전달 메시지가 반환된다(stranded messages 경로).

핵심 패턴: **무조건 큐잉(수신 항상 성공) + 턴 경계 자동 소비 + 사용자 주도 즉시 플러시 + 비전달 시 반환.**

## 4. 비교 요약

| 축 | Loop 오늘 | pi | Claude Code |
|---|---|---|---|
| 수신 | 즉시(이벤트 append), 비차단, 터미널 런만 거부 (`execution.rs:248`) | 즉시 큐잉, 모드 미지정 시 거부 (`sdk.md:66`) | 즉시 큐잉, 항상 수용 |
| 실행 차단 | 없음(steer는 상태 미변경) | 없음 | 없음 |
| 소비 시점 | **다음 클레임/재시도뿐 — 실행 중 worker는 못 봄** (`coordinator.ts:176`, `task-execution.ts:14`) | 다음 턴 경계(도구 호출 직후) (`how-pi-works.md:13`) | 다음 턴 경계, 사용자가 즉시 플러시 가능 |
| 전달량 정책 | 없음(누적 전부) | one-at-a-time / all (`rpc-commands.md:325`) | 큐 전체 / up으로 편집 |
| 실행 중 라이브 채널 | provider API는 있으나 미배선 (`types.ts:97`, `herdr-agent.ts:167`) | 자체 에이전트가 소유 | 자체 에이전트가 소유 |
| 영속화 | 이벤트 로그(GuidanceAdded), 리플레이 시 자동 포함 | 세션 파일 | 세션/transcript |

공통 원칙(두 하니스 모두): **수신과 소비를 분리한다.** 수신은 큐 적재뿐이고, 소비는 모델 호출 사이의 안전한 경계에서 일어난다. 인터럽트(현재 도구 중단)는 기본이 아니며, abort가 별도 명시적 행동이다.

---

## 5. 설계 옵션 (Loop)

### O1 — 이벤트 소싱 유지 + orchestrator 이벤트 탭 (선행 조건 없음)

`GuidanceAdded`를 수신 표면으로 유지하고, orchestrator(coordinator 루프와 별행)가 `subscribe_events`(`crates/loop-bridge/src/commands.rs:887`, after_sequence 폴링)로 새 guidance를 폴링해 활성 worker에 전달한다. 실행 중 worker에게는 이미 있는 `provider.steer?`(`types.ts:97`)를 통해 pi 라이브 대화 경로로 보내고, 미지원 provider(원샷 codex exec, pi -p)는 기록된 steer 계약대로 재시도/다음 attempt 컨텍스트에 반영된다(이미 동작).

- 장점: core 변경 0(정책은 이미 Rust에 있음). TS 어댑터 얇은 폴링 루프만 추가. 의존성 방향 준수(orchestrator가 bridge 위에서만 동작).
- 단점: 폴링 지연(폴링 주기만큼). 전달 시맨틱(누구에게 무엇을 보냈는가)이 orchestrator 메모리에만 존재.

### O2 — 활성 worker별 메일박스 (권장 코어)

orchestrator가 worker당 메일박스를 유지: `{workerId → {pendingGuidance: GuidanceAdded[], deliveredThroughSeq: number}}`. 이벤트 탭(O1)이 메일박스를 채우고, 소비는 두 지점에서 일어난다:

1. **즉시 경계:** provider가 라이브 steer를 지원하고 worker가 `running`이면 드레인해 `provider.steer` 호출.
2. **자연 경계:** attempt 종료/재시도/새 클레임 시 — `get_task_context`가 이미 guidance를 포함하므로 무변경.

전달 확인을 위해 `GuidanceDelivered { task_id, worker_id, through_sequence }` 이벤트를 추가하면(bridge 타입 선变更 → `bun run codegen`) 리플레이 시 중복 주입을 막고, "미전달 guidance"를 정확히 계산할 수 있다.

- 장점: 스팸·경합 처리 지점이 하나로 모인다(아래 §6). pi의 steeringMode/Claude의 큐 드레인과 동일한 모양.
- 단점: 이벤트 1종 추가 + 리듀서/스냅샷 확장(Rust 우선 변경 필요). AGENTS.md 경계 준수를 위해 loop-core는 메일박스 개념이 아니라 이벤트·프로젝션만 알게 유지해야 한다(메일박스는 orchestrator 어댑터 상태).

### O3 — 인터럽트 vs 다음 턴

- **다음 안전 지점(기본):** pi·Claude Code 공통. 현재 도구 호출을 건드리지 않으므로 원자성·검증(verification) 계약이 깨지지 않는다. Loop의 completion contract(`AGENTS.md` — "worker success is not verification")와 잘 맞는다.
- **인터럽트(도구 경계까지도 안 기다림):** Loop에서는 attempt abort + 재시도로 근사한다. `executeTask`에 이미 `abort()`(`task-execution.ts:23`)와 재시도 경로가 있으므로, "중단 후 새 컨텍스트로 재시작"은 구현 비용이 낮다. 다만 진행 중 도구의 부작용 정리(cleanup/attention 경로, `task-execution.ts:55`)를 타므로 비용이 크고 attention으로 번질 위험이 있다.
- 결론: 인터럽트는 별도 명시 커맨드(예: steer + `--restart`)로만 노출하고 기본은 다음 경계. pi가 abort와 steer를 분리한 것(`how-pi-works.md:13`)과 같은 판단.

### O4 — 다중 운영자 경합·스팸 처리

- **경합:** 이벤트 로그가 단일 진실원이므로 충돌 해소가 append 순서로 결정된다. 메일박스는 시퀀스 오름차순으로만 드레인(워터마크) — 재정렬 없음.
- **스팸:** pi의 `one-at-a-time`(턴당 하나)과 Claude의 "Enter to send immediately" 사이. Loop 권고: **응집 창(coalescing window)** — 이벤트 탭이 메일박스에 즉시 적재하되, provider.steer 드레인은 (a) worker가 다음 턴 경계에 있을 때, (b) 마지막 드레인 후 N초(예: 2s) 경과 시. 연속 입력은 한 턴에 묶여 전달된다. 전달량 상한(메일박스 깊이 cap)과 초과 시 오래된 guidance를 컨텍스트 요약으로 누적하는 정책은 loop-core의 결정론적 정책으로 둘 자리(`ACTIVITY_HISTORY_LIMIT`, `reducer.rs:66-74`의 선례).
- **무한 성장:** §1.4의 무한 `Vec<Guidance>`는 메일박스 도입을 계기로 "미전달 + 최근 전달 N개" 프로젝션으로 한정할지 별도 결정 필요.

### O5 — 영속화·리플레이

- 수신(GuidanceAdded)은 이미 이벤트 로그에 있어 리플레이 시 자동 재생된다 — 이벤트 소싱 관점에서 가장 강한 자산.
- 전달 기록을 남기지 않으면(현 상태) 리플레이는 "모든 guidance가 모든 컨텍스트에 포함된 세계"를 재구성한다 — 시맨틱은 단순하지만 실행 중 전달과 정합이 어긋난다. `GuidanceDelivered`(O2)를 남기면 리플레이가 실제 전달 이력을 재현하고, coordinator 재시작 후에도 미전달 guidance만 새 worker 컨텍스트에 주입된다.
- 크래시 시맨틱: 전달 이벤트 append와 provider.steer 호출 사이 크래시 → at-least-once(중복 steer 가능). 라이브 대화에서 중복 steer는 피해가 낮고(사용자가 같은 말 반복과 동일), 정확히 한 번이 필요 없다면 이 순서(전달 후 append)가 안전하다.

---

## 6. 권고안 — 최소 변경 설계

**"수신 = 기존 steer 그대로, 반영 = orchestrator 메일박스 + 안전 경계 드레인"**

1. **수신(무변경):** `loop steer`/릴레이 → `GuidanceAdded` append. 이미 pending 없이 즉시 수신이며 터미널 런만 거부(`execution.rs:248-262`, `reducer.rs:481-487`). attention 경로와 완전히 분리 유지.
2. **탭·메일박스(orchestrator 어댑터):** coordinator와 별행의 폴링 루프가 `subscribe_events`(`commands.rs:887`)로 GuidanceAdded를 읽어 활성 worker별 메일박스에 적재. run 상태를 전혀 건드리지 않는다 → 차단 없음.
3. **드레인(안전 경계):** (a) provider.steer 지원 + running 라이브 worker면 응집 창 후 즉시 전달, (b) 그 외에는 기존 경로(다음 클레임/재시도의 `get_task_context`)에 맡김 — 이쪽은 이미 동작하므로 코드 추가 없음.
4. **전달 기록(선택, 후속 단계):** `GuidanceDelivered` 이벤트로 워터마크 영속화 — Rust bridge 타입 선변경 후 `bun run codegen`. 리플레이·크래시 정합성이 필요해질 때 추가.
5. **인터럽트:** 기본 아님. 명시적 재시작 커맨드로만 제공.

이 설계는 (i) AGENTS.md 경계(loop-core에 provider/pane 개념 유입 없음, 정책·이벤트는 Rust, 메일박스는 TS 어댑터), (ii) 기존 recorded-steer 계약(`types.ts:90-97`), (iii) pi/Claude Code의 검증된 패턴(즉시 큐잉 + 경계 소비)을 모두 만족하며, 구현 단위는 orchestrator 어댑터 1개 + 테스트다.

### 후속 결정 사항 (이 연구 범위 밖)

- `GuidanceDelivered` 이벤트 도입 시점과 스키마(Rust 우선, codegen 필요).
- 무한 `Vec<Guidance>` 성장 한정 정책(loop-core 결정론 정책).
- 응집 창 길이·메일박스 깊이 cap의 기본값(config 위치).
- 서브에이전트/하위 태스크로의 steer 전파(Claude Code의 `subagent_steer`에 해당) — Loop의 그래프 구조에서는 부모 태스크 worker에 전달 후 그 결정에 맡기는 것이 경계상 자연스러움.
