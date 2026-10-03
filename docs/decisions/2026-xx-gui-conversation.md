# GUI 대화 뷰 v1 — 세션 대화 프레임 계열(Rust-first) + 세션 스트림 엔드포인트 + 앱 대화 화면

- **태스크:** `gui-conversation-decision` (decision, attempt 0)
- **상태:** 결정됨
- **작성일:** 2026-xx
- **선행 결정과의 관계(개정):**
  - [`2026-xx-terminal-mirror.md`](2026-xx-terminal-mirror.md) **§D6(앱 터미널 뷰어)의 위계를 개정**한다 — pane 터미널 뷰는 원격 앱의 **1차 UX에서 2차 "raw" 토글로 강등**되며, 1차 UX는 본 결정의 대화 뷰다. 개정 후에도 유효한 것: pane 프레임 계열·엔드포인트(`GET /v1/panes*`)·`PaneEventLog`·백프레셔 설계 전부 병존(D4/D5 무변경), tap 없는 레인의 폴백 원천 역할, `pane.rs:14-16`의 "구조화 프로토콜 출력 아님" 계약. D1(레인 채택)·D2(리비전 폴링)·D3(Rust-first)·D7(M2 분리)은 본 문서가 다시 판단하지 않는다.
  - [`2026-xx-remote-app-architecture.md`](2026-xx-remote-app-architecture.md) **§D3 일부 문언을 개정**한다 — payload 금지 이름 목록에 **session 관찰 개념을 추가로 해제하지 않는 대신**, pane과 동일한 조건(전송형만 loop-bridge, loop-core 불개입, run 도메인 이벤트 미승격)으로 **세션 대화 프레임 계열이 wire에 병존**함을 추가한다. HTTP route·URL·Tailscale·provider·model·endpoint의 payload 금지, loop-core에 대한 HTTP/SSE/Pi/Herdr 금지는 그대로 유효하다.
- **입력:** `docs/research/gui-session-events.md` (file:line 증거 37건), `docs/decisions/2026-xx-terminal-mirror.md`, `docs/decisions/2026-xx-own-turn-loop-and-subagent-steering.md`, `crates/loop-bridge/src/**`(특히 `pane.rs`, `events.rs`), `packages/gateway/src/**`(특히 `wire.ts`, `events.ts`, `pane-events.ts`, `cursor.ts`, `server.ts`), `packages/orchestrator/src/mailbox.ts`
- **쓰기 범위:** 이 결정 문서만

## 1. 배경

터미널 미러 v1은 pane 화면 버퍼 스냅샷을 앱에 흘리지만, 그것은 사람이 TUI에서 보는 텍스트의 복사이지 대화가 아니다 — 툴 호출 경계·인자·결과 상관을 재구성할 수 없고(`crates/loop-bridge/src/pane.rs:14-16`의 계약 자체가 이를 금지), 폰에서 Loop를 "Codex 앱처럼" 쓰려는 운영자 목표를 채우지 못한다. 연구 문서(`docs/research/gui-session-events.md`)가 네 경로를 비교한 결론: **pi 확장 훅(in-session tap)이 유일하게** 사용자 입력(텍스트+이미지)·어시스턴트 스트리밍·툴 호출 수명(`toolCallId` 상관)·턴/세션 경계를 TUI 존속 하에 전부 관찰한다(pi 0.87.1 `types.d.ts:723,658-696,643-657`; 확장은 interactive/RPC/JSON/print 전 모드에서 로드 — pi docs `extensions.md`). pane 파싱은 스냅샷이라 경계 재구성이 불가하고, `--mode rpc`는 TUI와 배타적이며, 세션 파일 테일은 라이브 델타가 없다. 이 결정은 연구의 v1 권고를 채택하고, 위 두 선행 결정의 개정을 명문화한다.

## 2. 결정 (한 단락)

Loop의 원격 앱 1차 UX는 **세션 대화 뷰**로 확정한다: 원천은 pi 확장 tap(완결 단위 + 유계 델타)이 NDJSON으로 흘리는 것을 게이트웨이가 수집해, **`crates/loop-bridge`에 Rust-first로 선언한 대화 프레임 타입**(`RemoteSessionSummary`/`RemoteSessionListOutput`, 아이템 계열 `ConversationUserMessage`·`ConversationAssistantDelta`·`ConversationAssistantMessage`·`ConversationToolCallStarted`·`ConversationToolCallEnded`·`ConversationLifecycle`·`ConversationSteerQueued`, 리셋 쌍 `RemoteSessionResetReason`/`RemoteSessionResetEvent`)을 `bun run codegen`으로 생성해 게이트웨이·앱이 **생성 타입만 소비**한다(TS 복제 금지, u64는 10진 문자열). 게이트웨이는 `GET /v1/sessions`(인벤토리)와 `GET /v1/sessions/{sessionId}/events`(SSE, generation-scoped 불투명 커서 + 링 버퍼 재생 + 리셋 수렴 — `PaneEventLog`와 동일 축의 세 번째 로그 `SessionEventLog`)를 열고, 스티어는 신규 `POST /v1/runs/{runId}/steer`가 기존 `steer_run` 브리지 호출 앞머리만 붙여 3단 피드백(접수 응답 → `ConversationSteerQueued` 프레임 → tap이 관찰한 `source=steer` 사용자 버블)으로 정직하게 합성한다. 앱 화면은 (1) 채팅 목록=기존 runs 화면(세션은 run 상관으로 귀속, 상관 없는 세션은 별도 섹션), (2) 대화 뷰(사용자 버블·어시스턴트 텍스트·툴 카드(running→done|error 상태 기계)·스티어 마커·접기), (3) 컴포저(실행 중 steer 포함)이며, 기존 pane 터미널 뷰는 대화 화면 안의 2차 "raw" 토글로 강등돼 그대로 병존한다. 파일·이미지는 M2로 분리한다 — v1 프레임은 `image_count`만 실고, M2에서 참조형 `RemoteSessionAssetRef { attachment_id, mime_type, byte_len }` 필드 + `GET /v1/sessions/{sessionId}/attachments/{attachmentId}` 본문 엔드포인트를 추가한다(base64 inline 기각 — 링 버퍼·재생 예산을 소진하는 터미널 미러 D7 판례 재적용). run output 피드(`RemoteRunOutputEvent`)와 pane 스트림은 오늘 그대로며 대화 계열이 대체하지 않는다.

### D1. 원천 — pi 확장 tap + 게이트웨이 로컬 수집기

- **채택:** pi 확장(기존 `registerLoopExtension`/`registerHerdrLifecycle`과 같은 등록 패턴의 세 번째 인스턴스)이 `session_start`에서 수집기(게이트웨이 유닉스 소켓)에 연결해 NDJSON으로 이벤트를 흘린다. 관찰 범위: `input`(텍스트+이미지 수), `message_update`/`message_end`, `tool_execution_start`/`end`, `turn_start`/`turn_end`, `session_shutdown`. 확장은 지연 시작(`session_start` 훅)과 비(非)블로킹 전송만 한다 — 전송 실패 시 대화 관찰을 조용히 포기하고 기계 경로에 영향이 없다(fail-observer, pane 관찰 fail-closed와 같은 축).
- **세션↔run 상관:** interactive pi 워커 기동 시 composition이 `LOOP_RUN_ID`/`LOOP_TASK_ID` env 마커를 주입하고, tap이 수집기 등록 메시지에 이를 포함한다. 마커 없는 세션(Lead 등)은 `run_id=null`로 인벤토리에 정직 표기된다. 이 매핑은 어댑터 메타데이터다 — loop-core 상태가 아니다.
- **기각 — RPC 모드 브로커:** TUI와 배타적(운영자 목표 불충족). 원천 없는 전화 우선 세션 레인이 필요해질 때 후속 결정.
- **기각 — pane 텍스트 파싱을 대화 원천으로:** 스냅샷 텍스트에서 툴 호출 경계·`toolCallId` 상관을 재구성할 수 없음(wire 계약이 명시적 금지). pane은 raw 토글과 폴백으로 남는다.

### D2. Rust-first 프레임 타입 + codegen

- **채택:** `crates/loop-bridge/src/conversation.rs`(신규)에 `#[bridge_type]`으로 선언하고 `bun run codegen` 생성물을 Rust 변경과 함께 커밋한다(AGENTS.md; pane.rs가 만든 동일 판단 — wire.ts TEMPORARY seam에 세 번째 좌를 늘리지 않는다). SSE `event` 이름이 판별자고 `data`에 중복 판별 필드가 없다(ADR §4.1).
- **프레임 어휘(v1, 전부 유계 텍스트 + 적목 관문 통과):**
  - `ConversationUserMessage { message_id, text, source: interactive|steer|api, image_count: u32, occurred_at }`
  - `ConversationAssistantDelta { message_id, delta, occurred_at }` — 유계 병합(아래 D4)
  - `ConversationAssistantMessage { message_id, text, truncated, occurred_at }` — authoritative final
  - `ConversationToolCallStarted { tool_call_id, tool_name, args_json, args_truncated, occurred_at }`
  - `ConversationToolCallEnded { tool_call_id, result_text, result_truncated, is_error: bool, occurred_at }`
  - `ConversationLifecycle { phase: session_started|turn_started|turn_ended|session_ended, occurred_at }`
  - `ConversationSteerQueued { steer_id, text, run_id, occurred_at }` — steer 접수의 대화 스트림 미러
  - `RemoteSessionResetEvent { reason: cursor_unavailable|session_gone|slow_consumer, occurred_at }` — 재생 버퍼에 안 들어가는 연결-로컬 수렴(`session_gone`만 pane 가족의 `paneGone`처럼 공유 기록·재생 후 수렴)
- **인벤토리:** `RemoteSessionSummary { session_id, run_id: Option, task_id: Option, worker_id: Option, lane, title: Option, state: live|ended|unobserved }`, `RemoteSessionListOutput { sessions }`.
- **기각 — `wire.ts` 수작업 추가** 및 **기각 — run 이벤트 로그에 대화 프레임 혼입**(dedupe·replay 키와 리셋 의미 충돌; 터미널 미러 D4 판례). 대화는 run, pane에 이은 **세 번째 로그**다.

### D3. 게이트웨이 엔드포인트 — 세 번째 SSE 계열 + steer 진입점

- **채택:** `GET /v1/sessions`(인벤토리), `GET /v1/sessions/{sessionId}/events`(SSE), `POST /v1/runs/{runId}/steer`. 인증·Tailscale fail-closed 바인딩·keepalive·RFC 9457 문제 응답은 기존 표면 재사용. steer는 `handleSubmit`의 검증 선례(비어 있지 않음, `MAX_PROMPT_BYTES`, 멱등 불요 — 기존 steer 표면과 동일)를 따르고 기존 `steer_run` 브리지를 호출한다(오케스트레이터·메일박스 무변경).
- **M2:** `GET /v1/sessions/{sessionId}/attachments/{attachmentId}`(참조형 본문, 크기·개수 유계). v1에 attachment 엔드포인트를 열지 않는다.
- **커서/재생:** `cursor.ts`의 generation-scoped 불투명 커서를 sessionId 슬롯으로 재사용(`PaneEventLog` 선례). `Last-Event-ID` 재생, 말됨·타 generation·퇴출 이력은 `conversation_reset(cursor_unavailable)` 1프레임으로 수렴, 세션 종료는 `session_gone`이 공유 기록돼 재연결도 동일 수렴, 느린 소비자는 연결-로컬 `slow_consumer` 리셋.

### D4. 렌더링 계약 — 게이트웨이와 앱의 병렬 구현을 위한 고정 규격

게이트웨이(M-GC1/M-GC2)와 앱(M-GC3)은 아래 규격만 알면 독립 구현된다. SSE 프레임 순서가 곧 대화 순서다(로그 seq 단조, 커서가 이를 주소).

1. **아이덴티티·멱등 렌더:** 앱은 `message_id`/`tool_call_id`/`steer_id`를 키로 렌더한다. 동일 키 재도착(재생 중복 등)은 상태를 바꾸지 않는다(멱등). 프레임에 seq 필드가 없는 것은 의도다 — 순서는 SSE `id` 커서 순서가 유일한 원천이고, 페이로드는 식별자만 든다.
2. **어시스턴트 텍스트:** `assistant_delta`는 `message_id` 버퍼에 append한다. `assistant_message`(final) 도착 시 **해당 `message_id`의 버퍼 전체를 final 텍스트로 치환**한다(델타 유실·중복과 무관하게 수렴). final 없이 세션이 끝나면 버퍼 내용을 그대로 확정한다. delta는 게이트웨이가 병합한다 — 토큰 단위 전송 금지, 병합 간격 ≥250ms(`BoundedPaneSender` 동일 축), 세션당 대기 프레임 상한 초과 시 최신 스냅샷 병합 후 폐기 마커 없이 다음 final이 수렴을 보장한다.
3. **툴 카드 상태 기계:** `tool_call_started` → 카드 생성(state=running, args 표시), `tool_call_ended` → state=done 또는 error(`is_error`), 결과 텍스트는 `MAX_OUTPUT_BYTES` 유계 절단(`result_truncated` 표기). **started 없는 ended**(재생 퇴출·수집기 유실)는 앱이 running을 거치지 않는 닫힌 카드를 합성한다. started 후 ended가 없는 세션 종료는 state=running 카드를 error 아닌 "중단" 표기로 둔다(부정 보고 금지).
4. **스티어 마커:** 컴포저 제출 성공 → 앱 로컬 pending 마커. `steer_queued` 프레임(같은 run에 매핑된 세션 스트림에 게이트웨이가 미러) → 마커가 "대기 중"으로 확정. 이후 도착하는 `user_message(source=steer)` → **순서상 처음의 미확정 steer 마커와 짝지어 "전달됨"으로 접는다**(텍스트 비교 없이 순서 매칭만; steer가 관찰되지 않은 채 세션 종료 시 pending 표기 유지 — 정직 표기). run 상관이 없는 세션에는 `steer_queued`가 나오지 않으며 앱은 `user_message(source=steer)` 단독으로 전달 증거를 렌더한다.
5. **접기:** 툴 카드는 결과 도착 시 기본 접힘, 사용자 펼침 유지. `assistant_message`는 항상 펼침. 접기 상태는 앱-로컬이며 wire에 없다.
6. **진행 표시:** `turn_started`~`turn_ended` 사이에 컴포저는 "실행 중" 배지, steer 입력은 언제나 허용(이미 구현된 mailbox → 턴 경계 주입). `lifecycle` 프레임은 UI 축이지 대화 아이템이 아니다 — 타임라인에 렌더하지 않는다.
7. **포워드 호환:** 모르는 SSE `event` 이름은 무시한다(프레임 계열 확장 시 앱 구버전 안전).
8. **적목:** 모든 텍스트 필드(text/delta/args_json/result_text)는 게이트웨이가 `redactProviderText` 관문을 통과시켜 `[credential]=[redacted]`를 유지한다. 앱은 추가 적목을 하지 않는다.

### D5. M2 — 파일·이미지 (분리 확정)

- **채택(M2):** 사용자 첨부 이미지는 `RemoteSessionAssetRef { attachment_id, mime_type, byte_len }` 참조형으로 `ConversationUserMessage.attachments` 필드에 추가하고, 본문은 `GET /v1/sessions/{sessionId}/attachments/{attachmentId}`로 fetch한다(RN base64 데이터 URI 렌더링). 재생 시 참조만 재발급되고 본문은 링 버퍼 밖이다. 세션당 asset 수·개별 byte 상한은 M2 착수 시 수치화.
- **파일(비이미지):** pi는 파일 첨부를 이미지로만 받고 파일 열람은 read 계열 툴 결과 텍스트로 흐르므로, M2 "파일"은 툴 카드 결과 뷰어(유계 텍스트)다. 바이너리 프리뷰는 별도 범위.
- **기각 — inline base64 프레임:** 링 버퍼·재생 예산 소진 + 프레임 상한 재정의 강요(터미널 미러 D7 동일 판단).

### D6. 앱 화면 — runs=채팅 목록, 대화 뷰, 컴포저+steer, raw 토글

- **채팅 목록:** 기존 `RunsList`(run 상태·태스크 카운트)가 진입점이고, run 행에 귀속 세션 표시를 얹는다. 상관 없는 관찰 세션은 별도 "세션" 섹션에 `run_id=null` 정직 표기.
- **대화 뷰:** 사용자 버블(right)·어시스턴트 텍스트(left)·툴 카드·스티어 마커의 타임라인, D4의 멱등 렌더 규칙 적용. 자동 스크롤(스크롤업 해제/하단 재개 — 터미널 뷰 선례 재사용).
- **컴포저:** 텍스트 제출(실행 중이면 steer, 아니면 신규 run — 기존 제출 표면), 제출 후 pending 마커(D4 §4).
- **raw 토글:** 대화 화면 헤더의 보조 탭으로 기존 `PaneScreen` 터미널 뷰를 연다. pane 스트림·프레임 계열은 무변경이며 tap 없는 레인에서는 raw 토글이 유일한 라이브 표면이다(폴백 역할 유지).

## 3. 마일스톤과 기계 검증 가능한 수용 기준

### M-GC0 — Rust 선변경 + codegen

- 스코프: `crates/loop-bridge/src/**`(conversation.rs 신규), `packages/protocol/src/generated/**`. 의존: 없음.
- 수용 기준:
  - D2 전 타입이 `#[bridge_type]`으로 존재하고 `bun run codegen:check` 통과(생성물 동기화, 생성물 커밋 동봉).
  - `cargo test -p loop-bridge` 통과.
  - `bun run test:architecture` 게이트 확장: `rg -e "RemoteSession" -e "Conversation(UserMessage|AssistantDelta|AssistantMessage|ToolCall|Lifecycle|SteerQueued)" crates/loop-core/src` 결과 0건(M-TM0 pane 게이트의 세션 계열 확장; `ExternalSession` 정책 어휘는 무관하므로 식별자 기반 검사).

### M-GC1 — tap 확장 + 수집기 + 세션 로그

- 스코프: `packages/pi-loop/src/**`(tap 확장), `packages/gateway/src/**`(수집기 인그레스 + `SessionEventLog`), 워커 기동 env 마커(composition). 의존: M-GC0.
- 수용 기준 (전부 Fake tap 소스, 유료 호출 0):
  - 상관: env 마커 있음 → 인벤토리 `run_id` 채움, 없음 → null. 테스트: `bun test packages/gateway`.
  - 델타 병합: 1초 내 N개 `message_update` → ≥250ms 간격으로 병합된 델타 프레임만, final 프레임이 버퍼를 치환함을 프레임 시퀀스 스냅샷으로 증명.
  - 유계: args_json/result_text가 상한 초과 시 `*_truncated: true` 절단, 텍스트에 심은 토큰/bearer가 `redactProviderText` 경유로 `[credential]=[redacted]` 프레임으로 나감(적목 회귀 테스트 신규 케이스 + 기존 적목 테스트 무변경 통과).
  - 커서 수렴: 퇴출 이력 커서 → `reset(cursor_unavailable)` 1프레임 후 재개; `session_shutdown` → `reset(session_gone)`이 재연결에도 동일 수렴; 큐 초과 → 연결-로컬 `slow_consumer`. 테스트 동일.
  - 전송 실패 격리: 수집기 소켓 단절 시 tap이 세션 기계 경로에 영향 없음(pi-loop 테스트, 유료 0).
  - 경계: 게이트웨이가 생성 타입(`@loop/protocol`) 외 수작업 대화 타입을 갖지 않음, `crates/loop-core/src`에 D2 식별자 0건 — `bun run test:architecture` 통과.

### M-GC2 — 엔드포인트 + steer 라우트

- 스코프: `packages/gateway/src/**`(server 라우트 3건). 의존: M-GC1.
- 수용 기준 (Fake 소스, 유료 0):
  - `GET /v1/sessions` → `RemoteSessionListOutput`; `GET /v1/sessions/{id}/events` → D2 프레임 이름 그대로 SSE 발행; 문제 응답 RFC 9457.
  - `POST /v1/runs/{runId}/steer`: 빈 메시지 400, `MAX_PROMPT_BYTES` 초과 413, 성공 시 기존 `steer_run` 1회 호출(브리지 스파이 검증) + 매핑된 세션 스트림에 `steer_queued` 정확 1프레임(재생 포함 멱등).
  - 커서 재생이 run/pane 계열과 동일 시맨틱임을 공유 테스트로 증명. `bun run check` 전체 통과.

### M-GC3 — 앱 대화 화면

- 스코프: `apps/loop-mobile/**`. 의존: M-GC2.
- 수용 기준 (Fake 게이트웨이 클라이언트, 유료 0):
  - D4 규격 계약 테스트: 델타 append→final 치환, 동일 키 재도착 무효과, started→ended 상태 기계, started 없는 ended의 닫힌 카드 합성, steer 마커 순서 매칭 접힘, 미지 이벤트 무시 — 각 1건 이상.
  - 화면 플로우: runs 목록 → 대화 뷰 → raw 토글로 PaneScreen 전환 복귀 — 스냅샷 테스트.
  - 컴포저: 실행 중 제출이 steer 엔드포인트로, 대기 중 제출이 기존 run 제출로 감 — 클라이언트 스파 테스트.
  - 상관 없는 세션이 별도 섹션에 `run_id=null` 표기 — 테스트 동일.

### M-GC4 — 시뮬레이터 시연 v4

- 운영자 승인 하 최소 유료 호출(1~2회 소형)로 실제 pi 세션의 대화 프레임(사용자 프롬프트→어시스턴트 텍스트→툴 카드→GUI steer 반영)을 시연하거나, 불가 시 fake tap 출력으로 대체하고 **캡처에 "fake" 표기를 명시**한다. 유료 호출 내역 전량 공개 문서화(research 노트). 단위/마일스톤 게이트에 유료 호출은 포함되지 않는다.

## 4. 경계 준수 요약

- **Rust 선변경 + codegen:** 모든 대화 wire 타입은 `crates/loop-bridge`에서 먼저 정의되고 생성물을 함께 커밋한다. 게이트웨이·앱은 생성 타입만 소비하고 TS 수작업 복제는 만들지 않는다(M-GC0/M-GC1 아키텍처 게이트).
- **loop-core 무개입:** 대화 프레임·세션 개념은 loop-bridge 전송형과 어댑터/게이트웨이에만 존재한다. loop-core에 새 이벤트·프로젝션은 없고(steer는 기존 `GuidanceAdded`/`GuidanceDelivered` 재사용), run/task 도메인 이벤트로 승격되지 않는다. 아키텍처 게이트를 식별자 기반으로 확장한다(§3 M-GC0).
- **게이트웨이는 얇게:** tap 소켓 프로토콜 지식은 pi-loop 어댑터와 수집기 인그레스에, 게이트웨이는 port + 프레이밍 + 세 번째 로그만. 커서 코덱·큐 한도·keepalive·문제 응답은 기존 자산 재사용.
- **loop-core에 provider/pane/Pi 개념 금지 유지:** tap 확장은 pi-loop 어댑터 안의 구현 디테일이고 loop-core는 "워커가 steer를 받았다"(`GuidanceDelivered`)만 안다.
- **적목 계약 무변경:** `[credential]=[redacted]` 관문(`redactProviderText`)이 대화 텍스트 필드 전부를 통과한다. 기존 적목 테스트 회귀 없음.
- **병존:** run 이벤트·output 피드, pane 프레임 계열·엔드포인트는 무변경. 대화 계열은 세 번째 계열로만 추가된다.

## 5. 리스크

- **상관의 약점:** sessionId↔runId 매핑의 근거가 env 마커 주입(신규, composition 변경)이다. 마커 누락·워커 재시작 시 세션은 `run_id=null`로 목록에 남고 `steer_queued` 미러가 없다 — 정직 표기로 흡수하며, 매핑 안정화가 필요해지면 등록 프로토콜 확장을 후속 결정으로.
- **수집기 수명:** 게이트웨이 재시작 사이 프레임은 유실된다(프로세스 메모리 링 버퍼). 만회 경로는 세션 파일 백필(연구 경로 C, durable entry 커서) — 본 결정은 백필을 채택하지 않고 후속 결정 항목으로 남긴다(세션 지속 전제 + 등록 프로토콜 확정 필요).
- **델타 유계:** 병합 간격·큐 한도를 어겨도 final 치환으로 수렴하지만, 고빈도 세션에서 앱 배터리/렌더 비용이 증가한다. M-GC1 테스트가 간격 하한을 고정한다.
- **확장 로딩 배포:** `--extension` 인수 조립 vs pi settings는 배포 정책이며 `--no-extensions` 상호작용(명시 `-e`는 생존)은 유리하나 워커 불변성(임의 확장 미로딩) 검토를 M-GC1 착수 시 요구한다.

## 6. 미해결 항목

- 세션당 링 버퍼 용량·델타 병합 상한 프레임 수의 확정값 — M-GC1 착수 시 테스트와 함께 확정(pane 가족 선례: 512 프레임).
- steer 마커 순서 매칭의 타임아웃(전달 관찰 없는 pending의 만료 표기) — M-GC3 착수 시 확정.
- 세션 파일 백필(수집기 재시작 공백 만회) 채택 여부 — 시연 v4 이후 체감으로 판단.
- 이미지 asset 수·byte 상한 수치 — M2 후속 결정.
