# GUI 세션 이벤트 — pi 세션에서 구조화된 대화 이벤트를 얻는 경로 연구

- **태스크:** `gui-session-research` (research, attempt 0)
- **성격:** 사실 조사. 구현 없음, 유료 호출 없음, Rust/TS 코드 변경 없음.
- **읽은 증거:** `crates/loop-bridge/src/**`, `packages/gateway/src/**`, `packages/herdr/src/**`, `packages/pi-loop/src/**`, `packages/orchestrator/src/**`(steer/mailbox 경로), `packages/providers/src/{herdr-agent,mirror}.ts`, `apps/loop-mobile/src/**`, 설치된 `pi` 0.87.1 문서·타입(`docs/{extensions,json,rpc,rpc-commands,session-format,message-types,sdk}.md`, `dist/core/extensions/types.d.ts`), `pi --help`, `docs/decisions/2026-xx-terminal-mirror.md`, `docs/decisions/2026-xx-remote-app-architecture.md`, `docs/research/pi-terminal-mirror.md`
- **결론 요약:** GUI 대화 뷰(사용자 프롬프트·어시스턴트 텍스트·툴 호출 카드)의 원천은 **pi 확장 훅(in-session tap)이 유일하게 모든 요구를 채운다** — pi 확장은 `input`(텍스트+이미지), `message_start/update/end`(스트리밍 델타+최종), `tool_execution_start/update/end`(인자·부분결과·최종결과·오류), `turn_*`/`agent_*` 이벤트를 세션 안에서 전부 관찰할 수 있고(pi `dist/core/extensions/types.d.ts:723,658-697,643-657,567-571`), TUI 모드에서도 로드된다(pi docs `extensions.md` "Extensions load in interactive, RPC, JSON, and print modes"). pane 텍스트 파싱은 구현돼 있으나(터미널 미러 v1) 스냅샷 텍스트라 툴 호출 경계를 재구성할 수 없고, `--mode rpc`는 TUI와 배타적이며, 세션 파일 테일은 완결 엔트리만 주므로 라이브 델타가 없다. 권고 구성: **확장 tap → 게이트웨이 로컬 수집기(unix socket/NDJSON) → 신규 conversation 프레임 계열(Rust-first, loop-bridge 선언 → codegen) → SSE**. 기존 run 프레임 계열과 pane 프레임 계열은 그대로 병존하며, 로그·커서·백프레셔 기계(`RunEventLog`/`PaneEventLog`)는 코드 재사용이 가능하다. 스티어링은 기존 GuidanceAdded→mailbox→`herdr agent prompt` 경로에 GUI 진입점(gateway steer 엔드포인트 — 오늘 없음)을 앞에 붙이는 것으로 합성된다. 이미지/파일(M2)은 `InputEvent.images`·`tool_result.content[]`가 원천이고 참조형 프레임(inline base64 대신)이 유계 면에서 우세하다.

---

## (a) 구조화된 세션 이벤트의 최적 경로 — 4개 후보 비교

GUI 대화 뷰가 필요로 하는 최소 데이터 세트:

| 필요 항목 | 필요 필드 |
| --- | --- |
| 사용자 프롬프트 | 텍스트, 첨부 이미지(개수/참조), 입력 출처 |
| 어시스턴트 텍스트 | 스트리밍 델타(생략 가능) + 최종 텍스트, thinking(선택) |
| 툴 호출 카드 | toolCallId 상관, toolName, args, 실행 상태(running/done/error), 부분 결과, 최종 결과(유계) |
| 생명주기 | turn 경계, run 시작/종료/자동 재시도, 세션 시작/종료 |

### 경로 A — pi 확장 훅 (in-session tap) — **채택 권고**

pi 확장은 pi 프로세스 내부에서 세션 이벤트 전체를 구독한다. 설치본 0.87.1 타입 기준:

- **사용자 입력:** `InputEvent { type: "input", text, images?: ImageContent[], source: "interactive"|"rpc"|"extension", streamingBehavior?: "steer"|"followUp" }` — pi `dist/core/extensions/types.d.ts:723-731`. 이미지는 `ImageContent { type:"image", data:<base64>, mimeType }`(pi docs `message-types.md:28-37`).
- **어시스턴트 메시지:** `message_start`(658-662), `message_update`(663-668 — `message` 스냅샷 + `assistantMessageEvent` 델타), `message_end`(669-672, "authoritative final"). 델타 종류는 `text_delta`/`thinking_delta`/`toolcall_start|delta|end` 등(pi docs `json.md:81-95` — JSON 모드와 동일한 `AssistantMessageEvent` 어휘).
- **툴 호출:** `tool_execution_start { toolCallId, toolName, args }`(674-680), `tool_execution_update { …, partialResult }`(681-688), `tool_execution_end { …, result, isError }`(689-696). `toolCallId`로 수명 상관이 확정돼 있다(pi docs `json.md:98-110`).
- **경계·수명:** `turn_start`(643-648)/`turn_end`(649-657), `agent_start`(567-570)/`agent_end`(571-587)/`agent_settled`(624-626), `session_start`(417-424, 세션 파일 상관 정보 `previousSessionFile`)/`session_shutdown`(479-486).
- **결과 블록:** `tool_result` 이벤트의 `content: (TextContent | ImageContent)[]`(types.d.ts:791-795) — read 계열 툴 결과와 이미지 블록의 원천.
- **모드 호환:** 확장은 interactive/RPC/JSON/print 전 모드에서 로드된다(pi docs `extensions.md` "UI and modes" 절). 즉 **TUI를 그대로 살린 채** tap이 병동한다 — 운영자 목표("TUI로 쓰지만 휴대폰에서는 GUI")와 정확히 일치한다.
- **세션 내 주입(스티어 반대편):** 확장은 `pi.sendUserMessage(content, { deliverAs: "steer" | "followUp" })`(types.d.ts:1055-1058)를 제공받아, 살아있는 세션의 스트리밍 중에 스티어를 주입할 수 있다(pi docs `extensions.md` ExtensionAPI 표 및 `sdk.md:68` — steer는 "현재 어시스턴트 턴이 툴 호출을 마친 후 다음 LLM 호출 전" 진입).
- **Loop 선례:** 같은 자리에 이미 확장이 둘 살고 있다 — Lead 확장 `registerLoopExtension`(`packages/pi-loop/src/extension.ts:127-131,243-245`)과 herdr 수명 보고기 `registerHerdrLifecycle`(`packages/pi-loop/src/herdr-lifecycle.ts:133-141`, `session_start`/`agent_start`/`agent_end`/`session_shutdown` 구독). tap 확장은 이 등록 패턴의 자연스러운 세 번째 인스턴스다.
- **로딩 경로:** `pi --extension, -e <path>`(`pi --help` 확인). interactive 워커는 `herdr agent start <name> --kind pi --pane <paneId> -- <args>`로 pi에 인수를 전달한다(`packages/herdr/src/client.ts:561-573`), 인수 조립은 `visibleAgent`(`packages/orchestrator/src/composition.ts:252-271`) — `--extension` 추가 지점이 존재한다. 또는 pi 설정의 extensions 배열(pi docs `extensions.md` "Add it to Pi").

**tap의 전송 설계(권고, 구현은 후속 결정):** 확장은 세션당 로컬 수집기에 NDJSON을 흘린다. 수집기의 자리는 게이트웨이 프로세스(이미 SSE 프레임 계열 두 개와 herdr 유닉스 소켓 클라이언트를 소유 — `packages/gateway/src/herdr-pane-source.ts:24-56,160-217`가 소켓 클라이언트 선례). pi docs `extensions.md:36-38`의 "팩토리에서 소켓/타이머 금지, `session_start`에서 시작" 제약은 `registerHerdrLifecycle`이 채택한 것과 같은 지연 시작으로 충족한다. `message_update` 델타는 토큰 단위 고빈도이므로 전송 유계가 필요하다 — `BoundedPaneSender`의 병합·폐기 선례(`packages/herdr/src/bounded-sender.ts:12-68`, 250ms 병합/큐 100/초과 폐기 마커)가 반대 방향(쓰기) 참조 모델이며, v1은 `message_end`/`text_end` 완결 단위만 보내고 델타 스트림은 옵션으로 두는 것이 안전하다(pi docs `json.md:96-99` — 완결 블록이 authoritative).

### 경로 B — `--mode rpc` 브로커 — **기각(이 목적), 별도 레인으로 남김**

RPC 모드는 같은 세션 이벤트(`json.md` 전체)를 stdout으로 흘리고 `prompt`/`steer`/`follow_up`/`abort`/`get_messages`/`get_entries`(entry-id 커서 재생, pi docs `rpc-commands.md:683-700`)를 stdin으로 받는 양방향 프로토콜이다(pi docs `rpc.md:9-13`). 그러나 **모드가 배타적**이라 TUI가 없다 — "TUI로 쓰는 세션을 폰에서 본다"는 요구를 못 채우고, TUI를 포기하면 운영자 경험이 바뀐다. 또한 `herdr agent start --kind pi` 레인의 "conversation TUI가 떴음" 계약(`client.ts:579-586`, `interactive_ready` 검증)과 충돌한다. 전화 우선 무헤드 세션 레인이 필요해질 때의 후속 옵션으로만 남긴다.

### 경로 C — 세션 파일(JSONL) 테일 — **라이브 원천 기각, 백필/재생 원천으로 채용 가치**

세션 파일은 v3 트리 구조 엔트리(`message`/`compaction`/`custom`/`custom_message` 등)로 완결 대화를 저장한다(pi docs `session-format.md:52-99,146-154`). 그러나 (i) 엔트리는 메시지 **완결 시점**에 기록되므로 스트리밍 델타가 없고, (ii) 세션 파일 경로 ↔ pane/worker 상관이 tap 쪽 정보(확장만 세션 파일을 안다)로 존재해 파일 시스템 감시자가 단독으로 매핑을 만들 수 없으며, (iii) 워커가 `--no-session`이면 파일 자체가 없다. 대신 **수집기 재시작 후의 백필/재생 원천**(entry `id`가 durable 커서 — `rpc-commands.md:685`의 `get_entries since` 선례)으로는 정확히 맞는 재료다. 확장 tap이 세션 파일 경로를 수집기에 등록하면 재생 계약이 닫힌다.

### 경로 D — pane 텍스트 파싱 — **이 목적 기각 (터미널 미러 v1로 이미 구현된 병존 표면)**

게이트웨이는 오늘 herdr pane 화면 버퍼를 리비전 폴링해 SSE 텍스트 프레임으로 흘린다(`packages/gateway/src/pane-port.ts:24-38`, `herdr-pane-source.ts:107-135`, `pane-events.ts`). 프레임은 "적목·16KiB 클램프된 스냅샷 텍스트"이며(`wire.ts:170-190`의 pane 유계, `herdr-pane-source.ts:112-120`의 `recent_unwrapped` 읽기), wire 계약 자체가 "구조화 프로토콜 출력으로 취급 금지"를 명시한다(`crates/loop-bridge/src/pane.rs:14-16` "never treat it as structured protocol output"). 툴 호출 경계·인자·결과 상관은 스냅샷 디핑으로 재구성할 수 없다. **역할 재정의:** GUI에서 pane 스트림은 (i) tap이 없는 레인(codex/agy/원천 없는 프로세스 레인)의 정직 폴백, (ii) 대화 뷰의 "터미널" 보조 탭 — 으로 유지한다. 대화 카드의 원천이 아니다.

### 판정

**경로 A(확장 tap)** 라이브 + **경로 C(세션 파일/`get_entries`)** 백필 + **경로 D(pane)** 보조 탭·폴백. 경로 B는 별도 레인 요구가 생길 때의 후속. 이 조합만이 (1) TUI 존속, (2) 툴 카드 상관(`toolCallId`), (3) 스트리밍, (4) 이미지 첨부 관찰(`InputEvent.images`)을 동시에 만족한다.

---

## (b) 기존 RemoteRun*/pane 프레임 타입의 재사용 vs 신규 Rust 타입

### 있는 그대로 재사용 (변경 없음)

| 타입/기계 | 위치 | 재사용 역할 |
| --- | --- | --- |
| `RemoteRunSummary`/`RemoteRun`/`RemoteRunPage` | `packages/gateway/src/wire.ts:56-91`(TEMPORARY seam; Rust-owned 전환 대기) | runs=채팅 목록 화면의 상태·태스크 카운트 — GUI 채팅 리스트의 본체 |
| `RemoteRunOutputEvent` | `wire.ts:93-100` | 태스크별 bounded activity 텍스트 피드(기존 output 라인). 대화 카드가 아니라 활동 피드로 병존 |
| `RemotePaneSummary`/`RemotePaneListOutput`/`RemotePaneTextEvent`/`RemotePaneResetEvent`/`RemotePaneState`/`RemotePaneResetReason` | `crates/loop-bridge/src/pane.rs:24-112`(`#[bridge_type]`) | 터미널 보조 탭 + tap 없는 레인 폴백. M2 참고: pane.rs:14-16이 "구조화 출력 아님"을 계약으로 명시 |
| `GuidanceDeliveredEvent` | `crates/loop-bridge/src/events.rs:19-25` | 스티어 도달 기록의 wire 형태 — GUI "steer delivered" 표시에 그대로 소비 가능 |
| `RunEventLog` / `PaneEventLog` | `packages/gateway/src/events.ts:20-129` / `pane-events.ts:1-146` | **코드 재사용**(wire 타입 아님): per-key seq 링 버퍼 + generation-scoped 커서 재생 + slow-consumer 리셋 기계. 세 번째 로그(conversation)가 같은 패턴으로 파생된다(`cursor.ts` 코덱, key 자리에 sessionId — pane-events.ts가 paneId를 runId 슬롯에 넣은 선례) |
| SSE 전송/문제 응답 | `server.ts:346-460`(`sseTransport`), `problem.ts` | 프레임 계열이 하나 늘어도 같은 전송 계층 재사용 — pane 가족이 이미 증명한 확장 선례(`server.ts:128-217`의 pane 라우트가 run 라우트와 평행) |

### 신규로 필요한 Rust-first 타입 (loop-bridge 선언 → `bun run codegen` → 생성물 동봉 커밋)

이름은 제안이며 후속 결정에서 확정한다. pane 계열(`pane.rs`)과 동일한 자리·원칙을 따른다:

- `RemoteSessionSummary { session_id, run_id: Option<String>, task_id: Option<String>, worker_id: Option<String>, lane, title: Option<String>, state }` — 대화 인벤토리/상관. run·task 상관은 어댑터 메타데이터다(아래 경계 참고).
- `RemoteSessionListOutput { sessions: Vec<RemoteSessionSummary> }` — `GET /v1/sessions` 응답.
- 대화 프레임 계열(SSE 이벤트명이 판별자, `data`에 중복 판별 필드 없음 — ADR §4.1 규칙, `wire.ts:12-16`):
  - `ConversationUserMessage { seq, text, image_count }` — `InputEvent`(types.d.ts:723) 대응. 이미지 본문은 M2 참조형(아래 (d)).
  - `ConversationAssistantMessage { seq, message_id, text, truncated }` — `message_end` 완결 단위(v1 기본).
  - `ConversationAssistantDelta { message_id, delta }` — 델타 옵션(병합 유계는 후속 결정, `bounded-sender.ts:55-66` 선례).
  - `ConversationToolCallStarted { tool_call_id, tool_name, args_json(bounded) }` / `ConversationToolCallEnded { tool_call_id, result_text(bounded, truncated), is_error }` — `tool_execution_start/end`(types.d.ts:674-696) 대응. 카드 상태는 started/ended 쌍으로 도출.
  - `ConversationLifecycle { phase }` — turn/run/세션 경계 요약(`turn_start/end`, `agent_start/end/settled` 대응).
- `RemoteSessionResetReason { cursor_unavailable | session_gone | slow_consumer }` + `RemoteSessionResetEvent` — `pane.rs:87-112`의 리셋 쌍과 대칭(pane이 늘린 `slow_consumer` 변형 포함).
- u64/seq가 wire를 건널 때 10진 문자열 규칙(ADR §4.1; `pane.rs:9-11`, `wire.ts:13` 선례)을 그대로 적용한다.

### 경계 준수 (아키텍처 제약 확인)

- **loop-core에 session/pane/provider 개념 금지 유지:** 대화 프레임은 `pane.rs`와 같은 **loop-bridge 전송형**으로만 존재한다. `bun run test:architecture`의 `rg -i "pane" crates/loop-core/src` 0건 게이트(터미널 미러 M-TM0 선례)를 session 키워드로도 확장 검토할 가치가 있다.
- **run 도메인 오염 금지:** 대화 프레임이 run 이벤트 로그로 혼입되지 않는다(터미널 미러 D4의 "별도 프레임 계열" 판례 재적용 — `pane-events.ts:1-7` 헤더 주석이 분리 이유를 기록). 대화는 세 번째 로그다.
- **상관의 자리:** sessionId ↔ runId/taskId 매핑은 loop-core 상태가 아니라 어댑터 메타데이터다. 근거: 워커에게 run/task 문맥을 env 마커(`LOOP_RUN_ID`, `LOOP_TASK_ID`)로 주자는 제안이 이미 기록돼 있다(`docs/research/pi-ecosystem-generalization.md:76`) — 미구현 갭이며, tap 확장의 상관 근거로 후속 결정에서 확정해야 한다. 게이트웨이가 미러 pane 라벨에서 taskId를 뽑는 선례(`herdr-pane-source.ts:36-38,262-269`, `mirror·<taskId>`)는 interactive pane에 적용되지 않는다(미러 pane만 라벨 규약 존재).
- **wire.ts 해소 순서:** run/pane 원격 타입의 Rust 전환이 아직 pending인 TEMPORARY seam인 만큼(`wire.ts:5-19`, `apps/loop-mobile/src/gateway/wire.ts:3-19`), conversation 계열은 **처음부터 loop-bridge Rust-first**로 시작하는 것이 wire.ts 2좌 복제를 늘리지 않는 길이다(pane.rs가 그렇게 made된 동일 판단 — 터미널 미러 D3 "pane 프레임은 신규 계열이므로 처음부터 Rust 소유").

---

## (c) 스티어링 합성 — GuidanceAdded → 턴 경계 주입 → GUI 렌더

오늘의 전체 사슬(전부 구현돼 있음):

1. **진입:** `loop steer <run> <task|all> <message>`(`packages/cli/src/main.ts:154-157`) → bridge `steer_run`(`crates/loop-bridge/src/execution.rs:248-259`) → `EventKind::GuidanceAdded { task_id, message }` 이벤트 영구 기록(`crates/loop-core/src/event/event.rs:66-69`).
2. **읽기:** steer mailbox가 이벤트 로그의 GuidanceAdded를 폴링 탭으로 읽는다(`packages/orchestrator/src/mailbox.ts:1-40` — "receive path stays exactly the existing steer surface … This adapter only READS").
3. **주입:** 살아있는 워커는 턴 경계에서 드레인된다 — inbox(자기-병합 채널)는 매 틱, window(대화형 채널)는 공침(coalescing) 창 후(`mailbox.ts:15-22,126-144`). pi 대화형 워커의 채널은 `HerdrAgentProvider.steer`(`packages/providers/src/herdr-agent.ts:170-183`) → `herdr agent prompt`(TUI 에디터에 타이핑, `packages/herdr/src/client.ts:345-360`)다.
4. **장부:** 성공 드레인/claim 주입마다 `GuidanceDelivered { task_id, worker_id, through_sequence }` 기록(`mailbox.ts:28-40`; bridge `record_guidance_delivered`, `crates/loop-bridge/src/commands.rs:566-591`; wire형 `events.rs:19-25`).
5. **워커 화면:** steer는 pi TUI에 사용자 입력으로 나타나고, tap 확장은 이를 `input` 이벤트로 관찰한다(types.d.ts:723, `source`·`streamingBehavior: "steer"` 필드가 채널 구분을 이미 제공 — types.d.ts:728-730).

**GUI 합성에 필요한 덧붙임(후속 결정 항목):**

- **GUI 진입점 부재가 유일한 갭:** 게이트웨이 라우트는 오늘 `POST/GET /v1/runs`, `GET /v1/runs/{id}`, `GET /v1/runs/{id}/events`, `/v1/panes*` 뿐이다(`server.ts:55-63,128-133,239-332`). 폰 컴포저 → `POST /v1/runs/{runId}/steer`(신규) → 동일 `steer_run` bridge 호출로 사슬 앞머리만 붙이면 나머지는 전부 기존 경로다. 멱등성·빈 메시지·바이트 상한 검증은 `handleSubmit`의 선례(`server.ts:246-266`, `MAX_PROMPT_BYTES`)를 따른다.
- **GUI 피드백 루프 3단:** (i) steer 접수 — 새 steer 엔드포인트의 동기 응답, (ii) steer 기록 — GuidanceAdded/GuidanceDelivered는 이미 이벤트 로그에 있으므로 run 스트림에 새 프레임으로 노출하거나(설계 선택) 대화 스트림에 lifecycle 프레임으로 미러, (iii) steer 반영 — 워커 pi가 steer를 입력으로 받은 뒤 tap이 내보내는 `ConversationUserMessage`(input 이벤트, `streamingBehavior: "steer"`)가 GUI에 사용자 버블로 뜬다. 인텐트가 지적한 "mailbox → 실시간 반영"은 이 3단으로 정직하게 합성된다(폰 스티어가 TUI 에디터에 타이핑되는 지연 = mailbox 드레인 주기, `mailbox.ts:47-52` 기본 2s 공침 창).
- **Lead 세션(워커가 아닌 운영자 자신의 pi)에 대한 스티어는 별도 길이다:** mailbox는 task 워커 전용이라(`mailbox.ts:88-92` RegisteredWorker 등록 모델) Lead 대화에는 적용되지 않는다. Lead가 herdr 관리 에이전트면 같은 `herdr agent prompt` 표면이 유효하고, 아니면 tap 확장이 수집기 소켓의 제어 명령을 받아 `pi.sendUserMessage(…, { deliverAs: "steer" })`(types.d.ts:1055-1058)로 주입하는 pi 네이티브 길이 있다. 어느 쪽을 v1에 넣을지는 "GUI 대화의 1급 주체가 run인지 세션인지"에 달린 후속 결정 사항이다(인텐트는 runs=채팅 목록이므로 run 연동 우선이 자연스럽다).

---

## (d) 이미지/파일 흐름 — M2 범위

**원천(pi 0.87.1 기준, 전부 tap이 이미 관찰 가능):**

- **사용자 첨부:** `InputEvent.images: ImageContent[]`(types.d.ts:727; `ImageContent { type:"image", data:<base64>, mimeType }` — `message-types.md:28-37`). RPC `prompt`/`steer`도 images 배열을 받는다(`rpc-commands.md:19-23,55-59`) — 폰→pi 업로드의 역방향 근거.
- **툴 결과 블록:** `tool_result` 이벤트 `content: (TextContent | ImageContent)[]`(types.d.ts:791-795), `tool_execution_end.result`의 content 배열(pi docs `json.md:105-114` 예제). read/bash 계열 텍스트 결과와 이미지 블록이 동일 통로다.
- **재생:** 세션 파일의 메시지 content 배열(`session-format.md:52-99`)과 RPC `get_entries`(`rpc-commands.md:683-700`)가 커서 있는 백필을 준다.

**와이어 설계 권고(터미널 미러 D7의 M2 분리 판례를 세션 계열에 적용):**

1. **참조형 우위:** base64를 대화 프레임에 inline하면 링 버퍼·큐 예산을 순식간에 소진한다(터미널 미러 D7이 같은 이유로 pane 프레임에 asset 필드를 넣지 않기로 한 판례; `docs/decisions/2026-xx-terminal-mirror.md` §D7). 권고: `RemoteSessionAssetRef { asset_id, mime_type, byte_len }`(대화 프레임 inline) + 게이트웨이 `GET /v1/sessions/{sessionId}/assets/{assetId}`(본문 fetch). 대안인 inline base64는 프레임 상한(`MAX_OUTPUT_BYTES` 8KiB, `wire.ts:161` — 이미지에 못 미침) 재정의 + 재생(replay) 제외 규칙을 강제하므로 비용이 크다.
2. **수신 경로:** RN은 base64 데이터 URI 렌더링이 가능하고 앱에는 SSE 디코더(`apps/loop-mobile/src/gateway/sse.ts`)와 output 디듀(`activityId`, `apps/loop-mobile/src/screens/RunScreen.tsx` 주석 블록) 선례가 있다 — 참조형이면 asset 캐시 레이어 하나가 추가될 뿐 파이프라인 확장으로 흡수된다.
3. **적목·유계:** asset 본문은 pane 텍스트와 달리 redaction 대상이 아니라 **크기·개수 유계** 대상이다. 세션당 asset 수 상한, 개별 byte 상한, 링 버퍼 제외(replay 시 참조만 재발급)를 후속 결정에서 수치화해야 한다.
4. **파일(비이미지):** pi는 파일 첨부를 이미지로만 받고(types.d.ts:727 `images`), 파일 열람은 read 계열 툴 결과 텍스트로 흐른다 — M2의 "파일"은 툴 카드 결과 뷰어(유계 텍스트)로 충분하고, 바이너리 파일 프리뷰는 별도 범위다.

---

## v1/M2 스코프 권고 (결정 태스크 입력용)

1. **v1 본체:** tap 확장(완결 단위: user input, assistant message_end, tool start/end, lifecycle) → 게이트웨이 로컬 수집기 → conversation 프레임 계열(Rust-first: `RemoteSessionSummary`, `Conversation*` 5종, 리셋 쌍) → `GET /v1/sessions`(인벤토리) + `GET /v1/sessions/{sessionId}/events`(SSE) — 로그·커서·백프레셔는 `PaneEventLog`/`sseTransport` 패턴 재사용. run 상관은 env 마커(`LOOP_RUN_ID`/`LOOP_TASK_ID`) 확정을 선행 과제로.
2. **스티어:** `POST /v1/runs/{runId}/steer` 신규 → 기존 steer_run 재사용; GUI 피드백 3단(접수/기록/반영).
3. **델타 스트림:** 옵션(M2에 미룰 수 있음) — 완결 단위만으로도 카드·버블 UI는 완성된다. 델타 채택 시 병합 유계 결정 필요.
4. **M2:** 이미지 참조형 프레임 + asset 엔드포인트 + RN 렌더; 파일은 툴 카드 결과 뷰어.
5. **병존 유지:** run output 피드, pane 터미널 탭은 오늘 그대로 — 대화 계열이 대체하지 않는다(터미널 미러 D4 병존 판례).

## 미해결 리스크

- **상관의 약점:** sessionId ↔ runId/taskId 매핑의 근거가 env 마커 제안(미구현, `pi-ecosystem-generalization.md:76`)뿐이다. Lead처럼 run 밖 세션은 상관이 아예 없으므로 GUI 정보구조(runs vs sessions)를 결정이 먼저 정해야 한다.
- **수집기 수명:** tap 확장이 붙는 수집기(게이트웨이)가 죽으면 그 사이 프레임은 유실된다 — 세션 파일 백필(경로 C)이 만회 경로지만 세션 지속(`--no-session` 아님)과 파일 경로 등록이 전제다. run 제출의 `accepted/planning` 유실 한계 원격 앱 ADR §"절충/위험"(`2026-xx-remote-app-architecture.md:425`)과 같은 축.
- **델타 유계:** `message_update`는 토큰 단위라 무유계 전송이 불가능하다 — v1 완결 단위 권고의 근거이자, 델타 채택 시 반드시 병합 간격·큐 한도 결정이 선행된다(`bounded-sender.ts` 선례).
- **확장 로딩 경로의 배포:** `herdr agent start -- …` 인수 조립(`composition.ts:252-271`)에 `--extension`을 넣을지, pi settings로 둘지는 배포 정책 결정이다. `--no-extensions` 조합과의 상호작용(`pi --help` — explicit `-e`는 살아남음)은 유리하지만 워커 불변성(워커가 임의 확장을 물지 않음) 검토가 필요하다.
- **유료 출력 필요:** 실제 pi 세션의 대화 프레임 시연/검증은 운영자 승인 하 최소 유료 호출이 필요하며, 불가 시 fake provider 출력과 명확히 구분 표기해야 한다(인텐트 제약). 본 연구는 유료 호출 0회.
