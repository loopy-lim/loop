# Async Tool Harness — Unreal Agent 패턴과 Loop/pi 실행 모델 비교

- **Date:** 2026-09-25
- **Kind:** research (no implementation, no paid model calls)
- **Question:** Unreal Agent의 완전 비동기 툴 하니스 패턴(in-progress 이벤트 기록 + 백그라운드 완료 후 모델 호출, 대기 없는 스티어링, 턴당 툴 병렬 발행)을 Loop에 무엇을 도입할 수 있는가? 무엇은 도입하지 말아야 하는가?
- **Sources:** 원문 로컬 사본 `docs/research/references/unreal-agent.html`(https://unreallabs.ai/blog/unreal-agent/, 2026-09-22 게시, 43,281바이트 저장), 설치된 pi 하니스 문서(`@earendil-works/pi-coding-agent/docs`)와 `pi-agent-core` 배포 코드, 로컬 저장소 코드. 선행 연구: `docs/research/async-human-input.md`(스티어링 메일박스 설계, 이미 구현됨). 유료 모델 호출 없음.

---

## 1. Unreal 패턴 정리 (원문 인용)

### 1.1 핵심 주장

원문(`docs/research/references/unreal-agent.html`)에서:

> "Every time Unreal Agent issues a tool call, we immediately append an event-log record that the tool has returned in the "in-progress" state, while continuing its execution in the background. Once a tool actually finishes, we append the result into the session log and call an LLM."

> "The Unreal Agent harness manages tool calls in a completely asynchronous way, relieving the underlying model of the need to manage waits, polls, and heartbeats for tools."

구성 요소를 분해하면:

1. **툴 호출 즉시 in-progress 기록:** 모델이 툴 호출을 발행하면 하니스가 이벤트(세션) 로그에 "in-progress" 상태의 결과 항목을 즉시 append한다. 실행은 백그라운드에서 계속된다.
2. **완료 시 결과 append 후 모델 호출:** 툴이 실제로 끝나면 최종 결과를 세션 로그에 append하고 LLM을 호출한다. 완료 시점이 곧 다음 모델 턴의 트리거다 — 배치 전체를 기다리지 않는다.
3. **모델에서 wait/poll/heartbeat 제거:** 대기·폴링을 모델 토큰으로 처리하지 않는다. 비용 절감의 직접 원인.
4. **대기 없는 스티어링:** "it always allows users to steer the agent without the need to wait for tool calls to finish" — 스티어링이 툴 완료에 묶이지 않는다.
5. **턴당 툴 병렬 발행:** "issue more heavy tool calls per model turn without wasting tokens on polling" — 한 턴에 무거운 툴 작업(수 분 걸리는 dev 환경 셋업 + 코드 탐색 + 웹 검색)을 동시 발행한다.

### 1.2 비용 주장과 근거 구조

원문은 절감을 두 요인으로 귀속한다: (a) 최소 하니스 발자국 — "simple prompts, token-optimized tool results, and **no sub-agents or workflows**", (b) 모델 턴당 더 많은 툴 작업. 벤치마크(GPT-6 Astra xhigh, Terminal-Bench 4.0/SWE-Atlas/DeepSWE/ALE-CLI)에서 pass rate는 동률이면서 turns와 total $가 일관되게 낮다(예: TB4.0 — unreal-agent 57.9%/$1428/28 turns vs Pi 55.0%/$1827/44 turns vs Codex 57.9%/$2350). "40% vs Codex, 20% vs Pi"는 이 표에서 온 주장이다.

### 1.3 원문이 인정하는 한계 (각주 2)

> "The use of two tool-call result items (one in progress, one final) in a single context is underspecified in the Responses API documentation. During testing, we encountered rejections with some models on some inference providers (not OpenAI), and the function_call_output status field seemed to have no impact in those cases."

즉 in-progress/final 두 항목 패턴은 **공급자별 API 수용 여부가 갈리는, 아직 표준화되지 않은 트릭**이다. 모델은 running→final 진행을 이해하지만 일부 비(非)OpenAI 추론 공급자는 거부한다. 또한 "Making this work without breaking cache was an interesting engineering challenge" — in-progress 항목 삽입과 final 항목 치환 사이에 컨텍스트 접미사가 변하므로 KV 캐시 보존이 설계 포인트였음을 스스로 인정한다.

---

## 2. Loop/pi 현재 실행 모델 (file:line 증거)

분석을 위해 계층을 구분해야 한다. **Loop의 orchestrator는 모델 턴 루프를 소유하지 않는다.** 툴 호출 루프는 provider 하니스(pi, codex, agy) 프로세스 내부에 있고, Loop는 그래프(태스크 DAG) 수준 스케줄러다.

### 2.1 pi 하니스 내부 — 이미 "배치 병렬", Unreal과의 차이는 턴 경계 동기화

- **기본 병렬 실행:** `pi-agent-core/dist/agent.js:143` — `this.toolExecution = runtimeOptions.toolExecution ?? "parallel"`. `agent-loop.js:364-368` — `executeToolCalls`는 모든 도구가 `executionMode: "sequential"`을 선언하거나 설정이 sequential일 때만 순차로 간다.
- **병렬 경로:** `agent-loop.js:409-455` — 배치의 모든 툴 호출을 준비하고 `Promise.all`(`agent-loop.js:451`)로 동시 실행한다. 결과는 **원래 toolCall 순서대로** 재조립해 기록한다(`orderedFinalizedCalls`) — 세션 로그 순서가 결정적이므로 배치 내 캐시 안정성이 이미 확보되어 있다.
- **차이 1 — 턴 경계가 배치 전체를 기다린다:** pi는 배치의 모든 툴 결과가 모여야 다음 모델 요청을 보낸다(`agent-loop.js:451`이 끝나야 toolResult 메시지 기록 → 다음 턴). Unreal은 **툴 하나가 끝나는 즉시** 결과를 붙이고 모델을 호출한다. 긴 툴 하나(수 분 bash)가 같은 배치의 짧은 툴 결과들도 모델까지 도달하는 시간을 지연시킨다.
- **차이 2 — 모델 컨텍스트에 in-progress 항목이 없다:** `agent-loop.js:543-551`의 `partialResult`는 `tool_execution_update` 이벤트로 **UI에만** 흐른다(pi docs `how-pi-works.md:11` — "executes each tool call, and records the results"; 결과 기록은 완료 후). 모델은 실행 중 툴의 존재를 컨텍스트에서 볼 수 없다.
- **차이 3 — 스티어링 반영이 배치 경계에 묶인다:** pi docs `sdk.md:68` — "A steering message enters after the current assistant turn **and its tool calls**." `how-pi-works.md:13` 동일. 스티어링 지연 상한은 배치 내 최장 툴 실행 시간이다.
- **캐시 설계는 이미 의식적:** pi에는 `cache_warming_decision` 이벤트·`promptCache` 모델 메타데이터가 존재하고(pi docs/SDK), 세션 트리 구조(`how-pi-works.md:3-5`)는 append-only 브랜치라 캐시 친화적이다. 스티어링 메시지도 턴 경계에서 **뒤에 붙는다** — 접두사 무효화 없음.

### 2.2 Loop 그래프 레벨 — worker 시도 단위로는 이미 Unreal 모양

Loop의 이벤트 로그는 worker 시도(attempt) 입도에서 이미 in-progress→final 패턴이다:

1. **시작 즉시 기록:** `coordinator.ts:207` — OS 부수효과 전에 `recordWorkerStarted`로 이벤트 append("Reserve durable ownership BEFORE the OS side effect"). 
2. **백그라운드 실행 + 완료 시 기록:** `task-execution.ts:87` — `await untilAborted(provider.result(handle.id), signal)`로 worker 프로세스 전체를 기다렸다가 `coordinator.ts` 폴링 루프가 완료를 감지하고 `task-execution.ts:129`의 `recordWorkerResult`로 final 기록. 완료 감지는 `coordinator.ts:237` — `Promise.race([delay(50), ...[...active.values()].map(task => task.done)])`, 즉 worker 종료 즉시 다음 클레임 라운드로 진행된다. **"백그라운드 완료 → 즉시 후속 진행"은 그래프 레벨에서 이미 동작한다.**
3. **병렬성:** 태스크 수준 병렬은 `coordinator.ts:185`(`claimRunnableTasks` + `maxWorkers`/`maxFrontierWorkers`). 다만 이는 그래프 노드 병렬이지 모델 턴 내 툴 병렬이 아니다.
4. **검증은 순차:** `completion.ts:42` — `for (const check of checks)`로 completion check를 하나씩 실행한다. `task-execution.ts:133`의 `verifier.verify`가 이 순차 루프를 기다리는 동안 의존 태스크 클레임은 대기한다. (기록은 `recordCheckReceipts` 하나의 이벤트에 배열로 모이므로 이벤트 순서의 결정론은 유지 여지가 있다.)
5. **스티어링 — 수신 즉시, 반영은 안전 경계 (신규 구현):** `mailbox.ts` 전체. 이벤트 탭이 `subscribeEvents`를 100ms 폴링해(`mailbox.ts:186-190, 199-214`) worker별 메일박스를 채우고, 2초 응집 창 후 라이브 worker에 `provider.steer`로 드레인한다(`mailbox.ts:222-246`). 워터마크(`deliveredThroughSequence`, `coordinator.ts:216-224`)로 시작 컨텍스트 중복 주입을 막는다. 미지원 provider는 기존 recorded-steer 계약(다음 클레임/재시도 컨텍스트, `async-human-input.md` §1.1)에 맡긴다.

### 2.3 격차 요약

| 축 | Unreal Agent | pi (Loop의 하니스) | Loop 그래프 레벨 |
|---|---|---|---|
| 툴 발행 → 기록 | 즉시 in-progress append | 완료 후에만 기록 (`agent-loop.js:451` 이후) | **WorkerStarted 즉시 append** (`coordinator.ts:207`) — 이미 동일 패턴 |
| 다음 모델 호출 트리거 | 툴 1개 완료마다 | 배치 전체 완료 후 | worker 완료 즉시 다음 클레임 (`coordinator.ts:237`) |
| 모델의 실행 중 툴 인지 | in-progress 항목으로 가능 | 불가(update는 UI 전용, `agent-loop.js:551`) | 해당 없음(모델 컨텍스트를 Loop가 조립하지 않음) |
| 스티어링 대기 | 툴 완료와 무관 | 배치 경계 (`sdk.md:68`) | 수신 즉시·무차단 + 2초 응집 → 라이브 worker는 pi 배치 경계에 묶임 (`mailbox.ts:222`) |
| 턴당 툴 병렬 | 하니스가 적극 유도 | 기본 parallel (`agent.js:143`) — 단 sequential 도구 선언 시 배치 전체 순차화 | 태스크 병렬만 (`coordinator.ts:185`) |
| 서브에이전트/워크플로 | 없음(비용 절감 요인으로 주장) | pi 자체엔 서브에이전트 개념 없음(Loop가 그래프를 구성) | 그래프 DAG가 정체성 (`AGENTS.md`) |

**결론적 격차:** Loop↔Unreal의 진짜 격차는 (i) 하니스 내부의 "배치 전체 대기 vs 개별 완료 트리거"와 (ii) in-progress/final 두 항목 컨텍스트 패턴이며, 둘 다 **pi 자체의 구현 영역**이다. Loop가 소유한 영역(그래프 스케줄링, 이벤트 로그, 스티어링 수신)은 이미 구조적으로 대응되어 있다. 남은 Loop 측 격차는 검증 순차 실행 정도다.

---

## 3. 채택 / 비채택 판단

### 3.1 채택 권고 상위 3가지

**A1. pi 배치 병렬 기본값 보존 (코드 변경 0, 가드레일만)**
- 내용: Loop의 worker는 이미 pi 기본 `toolExecution: "parallel"`(`agent.js:143`)의 이점을 받는다. Loop 어댑터가 이 설정을 sequential로 덮어쓰지 않는지 확인하고, 프롬프트/구성 가이드에 "독립 툴 호출은 한 턴에 묶어 발행"을 유지한다. (packages/providers는 이 연구 읽기 범위 밖 — 확인 항목으로 아키텍트에게 이관, §7)
- 기대 효과: Unreal의 "턴당 더 많은 툴 작업" 이점을 추가 비용 0으로 유지. 위험: 낮음 — 되돌림 불가한 결정이 아님.

**A2. completion check 병렬 실행 (orchestrator TS만 변경)**
- 내용: `completion.ts:42`의 순차 루프를 소규모 동시성 한정(예: 4) 병렬 실행으로 바꾸되, 결과 수집을 check id 순으로 재조립해 `CompletionEvidence[]` 순서와 `recordCheckReceipts` 페이로드의 결정론을 보존한다. 타임아웃·abort는 기존 `NodeCompletionRunner` 계약 그대로.
- 기대 효과: `bun run check`류 다중 검증에서 verifying 구간 단축 → 의존 태스크 클레임이 빨라진다. 그래프 레벨의 "완료당 즉시 진행"에 부합. 위험: 중간—자원 경합(동시 bun/cargo)으로 개별 check가 느려지거나 실패로 비칠 수 있음 → 동시성 cap 설정화, 기본값 보수적으로.

**A3. GuidanceDelivered 이벤트로 메일박스 워터마크 영속화 (Rust 선변경 + codegen)**
- 내용: `mailbox.ts:14-18`이 문서화한 후속 과제. 라이브 드레인 후 `GuidanceDelivered { task_id, worker_id, through_sequence }` append → 리플레이 정합성 확보, "미전달 guidance" 정확 산출, 스티어링 지연 측정 가능(수신 시각−전달 시각) → 응집 창 2초의 근거 있는 튜닝.
- 기대 효과: Unreal 이점 1(즉시 스티어링)의 **측정 가능성** 확보. at-least-once 중복(현재 수용, `async-human-input.md` §O5) 제거. 위험: 낮음 — 이벤트 1종 추가, 리듀서는 소비만 하면 됨. 브리지 타입 선변경 절차(`bun run codegen`) 준수 필요.

### 3.2 도입하지 않을 것 (명시적 판단)

**N1. in-progress/final 두 항목 컨텍스트 패턴의 Loop 도입 — 기각.**
- 이유: (a) 이 패턴의 유일한 소비자는 모델 컨텍스트이고, Loop는 모델 컨텍스트를 조립하지 않는다(하니스인 pi가 조립). Loop가 이걸 하려면 orchestrator가 자체 모델 턴 루프를 가져야 한다 — 하니스를 이중화하는 것이고 `loop-core → … → orchestrator → adapters` 위계에서 orchestrator가 provider 개념을 삼키는 경계 침해다. (b) 원문 각주 2가 인정했듯 공급자별 수용 불안정 — Loop는 다중 provider(pi/codex/agy)이므로 공급자 특이 트릭을 코어에 넣을 여지가 애초에 없다. (c) KV 캐시 리스크: in-progress 삽입→final 치환 사이 접미사 무효화가 발생하며, pi는 이미 배치 결과를 원순서 재조립(`agent-loop.js:451`)으로 캐시 안정성을 확보한 상태에서 이득이 불확실한 실험을 감수할 이유가 없다.
- 판정: 이 패턴이 값진다면 **pi 업스트림(확장/코어)의 실험 과제**다. Loop 관점에서는 "이를 깨지 않는다"가 정답.

**N2. 서브에이전트/그래프 제거 철학 — 기각.**
- Unreal은 "no sub-agents or workflows"를 절감 요인으로 든다. 그러나 Loop의 그래프 우선 설계(태스크 DAG, 의존성, 완료 계약, attention)는 제품의 정체성이며 AGENTS.md가 첫 줄에 고정한 원칙이다. 같은 목적(토큰 낭비 제거)은 A1~A3과 기존 frontier 통제(`maxFrontierWorkers`)로 달성한다. 그래프를 녹여 단일 세션 에이전트로 가는 것은 연구가 아니라 방향 전환이다.

**N3. 툴 실행 중 인터럽트형 스티어링 — 기각 (기존 판단 유지).**
- Unreal의 "툴 완료를 기다리지 않는 스티어링"의 Loop 대응은 이미 구현된 메일박스다. 남는 차이는 pi가 스티어링을 배치 경계에 넣는 것뿐인데, 실행 중 도구 중단은 검증 계약("worker success is not verification")과 도구 원자성을 깨뜨린다(`async-human-input.md` §O3 결정 재확인). 인터럽트가 필요한 명시적 상황은 기존 abort+재시도 경로(`task-execution.ts:23, 151-157`)로 충분하다.

### 3.4 KV 캐시 친화성 평가 (요구사항 명시 항목)

- in-progress/final 패턴의 캐시 경제: in-progress 항목을 작고 형태 고정(예: 고정 템플릿 한 줄)으로 유지하면 삽입 시점 캐시 손실은 접미사 한 조각이고, final 치환 시 그 조각만 무효화된다. 다만 **배치 내 다른 툴 결과들이 그 뒤에 붙는 순간마다** 치환 위치가 어긋나면 무효화 범위가 커진다 — 이것이 원문의 "engineering challenge"이다. pi의 현재 구조(배치 완료 후 원순서 일괄 기록)는 이 문제를 구조적으로 회피한다.
- Loop 레벨의 대응물(WorkerStarted/WorkerResult 이벤트)은 모델 컨텍스트가 아니라 프로젝션 입력이므로 KV 캐시와 무관하다. 이벤트 로그의 append-only 성질은 리플레이 결정론에 기여하며 비용 논점과 별개다.
- 결론: 캐시 관점에서 Loop가 지금 할 일은 "pi의 append-only 세션과 원순서 기록을 깨는 입력을 보내지 않는 것" — 스티어링 메일박스가 턴 경계 append만 하도록 둔 현재 설계(`mailbox.ts:5-10`)가 정확히 그것이다.

### 3.5 스티어링 메일박스와의 상호작용 (요구사항 명시 항목)

스티어링 체인의 지연 분해: `loop steer` → GuidanceAdded append(즉시) → 탭 폴링(≤100ms, `mailbox.ts:157-159`) → 응집 창(≤2s, `mailbox.ts:230`) → `provider.steer` → **pi 배치 경계(상한 없음 — 최장 툴 실행 시간)**. 앞의 세 구간은 유계이고 이미 구현됐다. 유일한 무계 구간은 pi 내부 배치 경계로, 이는 N3(수용)이며 A3의 측정으로 실체를 확인할 수 있다. 원샷 worker(codex exec, pi -p)는 애초에 실행 중 수신 채널이 없으므로 recorded-steer 계약(재시도/후속 클레임)이 유일한 경로 — 이는 Unreal과 비교 불가한 별개 축이다.

---

## 4. AGENTS.md 경계 준수 방안

- **정책은 Rust, 결정론 유지:** A3의 신규 이벤트(GuidanceDelivered)는 bridge 타입을 Rust에서 먼저 바꾸고 `bun run codegen`으로 생성 파일을 함께 커밋한다. 리듀서는 상태 전이를 최소(전달 기록 프로젝션)로 유지하고, 응집 창·동시성 cap 같은 튜닝값은 어댑터 설정에 둔다(실행 타이밍 정책은 이벤트 로그 진실원을 오염시키지 않음).
- **코어에 provider 금지:** A1~A3 어느 것도 loop-core에 provider/모델/하니스 개념을 유입시키지 않는다. 메일박스가 그 선례(orchestrator 어댑터 메모리, `mailbox.ts:16-19`)다. N1을 기각한 근본 이유도 이 경계다.
- **TS 어댑터는 얇게:** A2는 기존 `CompletionRunner` 인터페이스 안의 실행 전략 변경이고, A1은 설정 확인이다. 타입 복제 없이 `@loop/protocol` 생성 타입만 사용.
- **검증 비용:** 모든 채택 항목은 유료 모델 호출 없이 단위 테스트 가능(A2: 가짜 러너로 순서 결정론 검증, A3: 이벤트 리듀서 테스트). 실제 provider 행동 확인이 필요한 부분은 §7에 별도 표기.

---

## 5. 단계별 구현 계획 (마일스톤, 리스크)

| 단계 | 내용 | 의존 | 리스크/완화 |
|---|---|---|---|
| **M0** (0코드) | pi 어댑터가 `toolExecution`을 덮어쓰지 않음을 확인·기록. 프롬프트 가이드에 "독립 툴 한 턴 묶음 발행" 명시 여부 점검 | 없음 | 확인 자체가 providers 패키지 읽기 필요 — 별도 소범위 작업으로 |
| **M1** | A2: completion check 동시 실행(기본 cap, config화), 결과 재조립으로 결정론 보존 + 테스트 | 없음 | 자원 경합 → cap 보수적 기본값, 실패 시 순차 폴백 불필요(개별 실패는 기존 경로) |
| **M2** | A3: `GuidanceDelivered` 이벤트 — Rust bridge 타입 → `bun run codegen` → 리듀서 프로젝션 → 메일박스 드레인 후 append → 워터마크 영속화 | M0 불필요, 독립 | 크래시 시 at-least-once(전달 후 append 순서 유지, `async-human-input.md` §O5) |
| **M3** (선택, 외부) | pi 업스트림 실험: in-progress/final 항목 + 캐시 영향 측정 | pi 저장소, 실측 필요 → 유료 호출 가능성 | Loop 스코프 밖. 채택 여부와 무관하게 Loop는 영향 없음 |

비추천 항목(N1~N3)은 계획에 넣지 않으며, N1은 pi 업스트림 동향(Responses API 표준화, 각주 2의 제안)을 지켜볼 것만 기록한다.

---

## 6. 상위 3개 권고 요약 (태스크 요구 응답)

1. **A1 — pi 배치 병렬 기본값 보존:** 이득 "턴당 툴 작업 극대화" 무비용 유지 / 위험 낮음.
2. **A2 — completion check 병렬 실행:** 이득 verifying 구간 단축, 의존 클레임 조기화 / 위험 중간(자원 경합) — cap으로 완화.
3. **A3 — GuidanceDelivered 워터마크:** 이득 스티어링 지연 측정 + 리플레이 정합 / 위험 낮음(Rust 선변경 절차 필요).

## 7. 미해결 항목 (아키텍트 결정 대기)

- packages/providers의 pi 어댑터가 `toolExecution`/`executionMode`를 건드리지 않는지 확인(M0 — 이 연구 읽기 범위 밖).
- A2 도입 시 동시성 cap 기본값과 config 위치.
- A3 도입 시점(메일박스 안정화 관측 후 권고)과 이벤트 스키마 확정.
- 무한 `Vec<Guidance>` 성장 한정 정책(`async-human-input.md` §1.4) — A3와 함께 다룰 것.
