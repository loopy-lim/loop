# 터미널 미러 v1 — 게이트웨이 pane SSE + rustra pane 프레임 + 앱 터미널 뷰어

- **태스크:** `terminal-mirror-decision` (decision, attempt 0)
- **상태:** 결정됨
- **작성일:** 2026-xx
- **선행 결정과의 관계(개정):**
  - [`2026-xx-remote-app-architecture.md`](2026-xx-remote-app-architecture.md) **§D3의 일부 문언을 개정**한다 — "Rust payload에 들어갈 수 없는 이름: … Herdr, pane …" 중 **pane에 한하여** 해제하고, "v1 output은 snapshot의 bounded `tasks[].activities`를 증분 투영한 것" 뒤에 **pane 텍스트 프레임 계열이 별도로 병존**함을 추가한다. 개정 후에도 유효한 것: HTTP route·URL·Tailscale·Pi·provider·model·endpoint의 payload 금지, loop-core에 대한 HTTP/SSE/Pi/Herdr 금지, herdr가 소비하는 pane 식별자가 run/task 도메인 이벤트로 승격되지 않는 것. 다이어그램 주석 "Herdr adapter (로컬 관찰; wire에 노출하지 않음)"는 "pane 텍스트 관찰은 wire에 노출(본 결정), 기계 활동 경로는 기존대로"로 정정한다.
  - [`2026-xx-real-run-planner.md`](2026-xx-real-run-planner.md) **§D4의 기각부를 개정**한다 — "기각 — `herdr pane` 텍스트를 gateway가 tail"을 뒤집는다. 게이트웨이의 pane 관찰은 어댑터 층 행위로 허용하되, **저장소 activity 이력 → `RemoteRunOutputEvent` 경로는 그대로 병존**하며 pane 스트림이 이를 대체하지 않는다. D4 채택부(worker 출력의 wire 원천 = activity 이력)는 run 이벤트에 한해 유효하다.
- **입력:** `docs/research/pi-terminal-mirror.md` (file:line 증거), `docs/decisions/2026-09-23-worker-visibility.md`, `packages/gateway/src/**`, `packages/herdr/src/**`, `crates/loop-bridge/src/**` codegen 흐름, 설치된 herdr 0.8.2 소켓 스키마(프로토콜 20)
- **쓰기 범위:** 이 결정 문서만

## 1. 배경

오늘 Loop의 herdr 미러는 **쓰기 전용**이다. `MirroringProvider`가 렌더 줄(적목·160자 클램프)을 `BoundedPaneSender`로 pane에 보낼 뿐, Loop에는 pane을 읽거나 구독하는 표면이 없다(`packages/providers/src/mirror.ts`, `packages/herdr/src/bounded-sender.ts`). 인간이 pi interactive 워커의 TUI에서 보는 스트리밍 텍스트와 툴 호출 흐름은 pane 화면 버퍼 안에 살아 있지만 원격 앱은 전혀 볼 수 없다. herdr 소켓 API(프로토콜 20)에는 `pane.list`/`pane.read`(단조 `revision` 포함 스냅샷)와 `pane.output_matched`(매처+스냅샷)가 있으나 **바이트 델타 스트림은 없다** — 라이브 흐름은 "리비전 폴링" 또는 "매처 구독+스냅샷 디핑" 중 하나다(pi 프로세스 `-p` 레인은 원천 자체가 없다). 이 결정은 연구 문서의 v1 권고를 채택하고, 위 두 선행 결정의 개정을 명문화한다.

## 2. 결정 (한 단락)

v1 터미널 미러는 **interactive 워커의 pane 화면 버퍼를 게이트웨이가 폴링해 앱에 SSE 텍스트 프레임으로 흘리는 것**이다: 게이트웨이는 `GET /v1/panes`(구독 가능 pane 인벤토리)와 `GET /v1/panes/{paneId}/events`(SSE pane 텍스트 프레임 스트림)를 새로 열고, 프레임 페이로드는 **`crates/loop-bridge`에 Rust-first로 선언한 pane 프레임 타입**(`RemotePaneSummary`, `RemotePaneListOutput`, `RemotePaneTextEvent`, `RemotePaneResetReason`)을 `bun run codegen`으로 생성해 소비한다(TS 복제 금지, `u64` revision은 10진 문자열 규칙). 게이트웨이↔herdr 구간은 **리비전 폴링**(소켓 1연결 + `pane.list` + pane별 `pane.read`, revision 디듀)로 시작하며, 매처 구독(`pane.output_matched`)은 지연 단축이 필요할 때의 확장점으로 남긴다. 앱은 기존 SSE 인프라 위에 **모노스페이스 라이브 피드 터미널 뷰**(자동 스크롤 — 사용자가 위로 스크롤하면 해제, 맨 아래 도달 시 재개 — 과 중앙 정렬 레이아웃)를 추가하고 프레임 디듀 키는 `paneId + revision`(+ SSE seq)다. **M2로 분리:** 파일·이미지 열람(pi attachments, `tool_execution_end.result.content[]` 이미지 블록)은 base64 프레임의 유계·재전송 정책이 별도 결정을 요구하므로 v1 밖이며, `--mode json` 의미 델타 스트림 채택(기계 캡처 경로 변경 수반)도 별도 후속 결정이다. 스트리밍 원천이 없는 레인(pi `-p` 프로세스)은 앱에서 lifecycle-only로 정직 표기한다.

### D1. 채택 레인 — pane 화면 버퍼, 원천 없는 레인은 정직 표기

- **채택:** herdr가 소유한 interactive 워커 pane(TUI 화면 버퍼)과 미러 pane(`mirror·<taskId>`, codex/agy 렌더 줄 도착처)을 동일 표면으로 스트리밍한다. pane 스냅샷은 **적목·클램프된 화면 버퍼**지 의미 이벤트 스트림이 아님을 wire 계약과 앱 UI 모두에서 명시한다.
- **기각 — v1에서 `--mode json` 채택:** `message_update`/`tool_execution_*` 델타는 의미 스트림으로서 우월하지만 요약 추출 키와 종료 코드 의미가 달라져 기계 캡처 경로가 변경된다(worker-visibility D2가 별도로 분리한 결정). 본 결정은 기계 경로를 동결한다.
- **기각 — 원천 없는 레인을 흉내:** pi `-p` 레인에 증분 이벤트는 없다. 앱은 해당 pane을 "lifecycle only" 배지로 표시하고 빈 스트림을 재시도로 메우지 않는다.

### D2. 게이트웨이↔herdr — 리비전 폴링(S1), 매처 구독은 확장점

- **채택:** herdr 소켓 API에 단일 연결로 `pane.list` 인벤토리 + pane별 `pane.read`(기본 폴링 간격은 구현 시 확정, 기본 250ms — `BoundedPaneSender` 병합 간격과 같은 축)를 돌리고 `revision`이 바뀐 경우에만 새 텍스트 프레임을 만든다. 폴링 간격 사이의 복수 변경은 **마지막 스냅샷 하나로 병합(coalesce)** 된다 — 스냅샷 모델의 정직한 의미이며 wire 계약에 문서화한다(D5).
- **기각 — CLI 자식 프로세스 폴링(`herdr pane read` spawn):** 호출별 spawn 비용이 폴링 주기와 곱해진다. 소켓 클라이언트는 herdr 어댑터(`@loop/herdr`)가 소유하고 프로토콜 버전(현재 20) 불일치 시 fail-closed로 pane 관찰만 비활성화한다(기계 경로 무영향).
- **기각 — 매처 구독(S2)을 v1 본체로:** pane당 구독 상태와 스냅샷 디핑이 필요하고, regex `.` 매처의 남발이 herdr에 부하를 준다. 지연 요구가 커지면 후속 결정으로 승격한다.

### D3. Rust-first 프레임 타입 + codegen

- **채택:** `crates/loop-bridge/src/**`에 먼저 선언한다 — `RemotePaneSummary { pane_id, label, task_id, workspace_id, state }`, `RemotePaneListOutput { panes }`, `RemotePaneTextEvent { pane_id, revision: u64, text, truncated, occurred_at }`, `RemotePaneResetReason { cursor_unavailable | pane_gone }`. 선언 직후 `bun run codegen`으로 `packages/protocol/src/generated`를 재생성하고 **Rust 변경과 함께 커밋**한다(AGENTS.md). `revision`은 wire에서 10진 문자열(ADR §4.1 u64 규칙, 기존 `lastSequence` 선례). loop-core에는 어떤 pane 개념도 추가하지 않는다.
- **게이트웨이 seam:** 게이트웨이는 `PaneObservationPort`(인벤토리 조회 + 구독)를 정의하고 herdr 소켓 구현은 composition root(`main.ts`)가 주입한다 — real-run-planner D1의 planner port와 동일한 "seam 유지 + 구현 교체" 패턴으로 gateway thin을 유지한다.
- **기각 — `wire.ts`에 pane 타입 수작업 추가:** `wire.ts`는 TEMPORARY seam이며 pane 프레임은 신규 계열이므로 처음부터 Rust 소유로 만든다. (`wire.ts`의 run 계열은 기존 계획대로 별도 전환 과제로 남는다.)

### D4. 게이트웨이 엔드포인트 — run 이벤트와 별도 프레임 계열

- **채택:** `GET /v1/panes`(pane 목록)와 `GET /v1/panes/{paneId}/events`(SSE)를 run 엔드포인트와 평행하게 추가한다. 인증·Tailscale fail-closed 바인딩·keepalive·문제 응답(RFC 9457)은 기존 표면을 그대로 재사용한다. pane 이벤트는 run `RunEventLog`와 **별도의 per-pane 로그**로 관리하며, pane 스트림은 run activity 스트림을 대체하지 않는다(병존). pane 소멸(워커 수명 종료) 시 `pane_gone` 리셋 후 스트림을 종료한다.
- **기각 — run 이벤트 로그에 pane 프레임 혼적:** dedupe·replay 키가 달라지고(pane별 revision vs run seq) 리셋 의미가 충돌한다. 별도 계열로 격리한다.

### D5. Backpressure — 유계 재생 버퍼 + 커서, 기존 이벤트 커서 설계와 동일 축

- **재생 버퍼:** pane당 링 버퍼(프레임 수 상한, 기존 `REPLAY_BUFFER_FRAMES`와 별도 pane 변형값)를 프로세스 메모리에 유지한다. `Last-Event-ID` 커서는 기존 `StreamCursor`와 동일한 generation-scoped 불투명 코드(`cursor.ts` 재사용, runId 자리에 paneId)이며, 말됨·타 generation·버림된 이력은 `reset(reason: "cursor_unavailable")` 1프레임으로 수렴한다 — 기존 `RunEventLog.replay`의 의미를 그대로 이식한다.
- **프레임 상한·절단:** 텍스트 프레임당 UTF-8 바이트 상한(pane 변형 재정의, 기본값 구현 시 확정)을 넘는 스냅샷은 `truncated: true`로 절단한다. 절단·병합·폐기 의미는 wire 계약(프로토콜 생성물 헤더 주석 + 이 문서)에 문서화를 강제한다: (i) 폴링 간격 사이 복수 변경은 마지막 스냅샷으로 병합, (ii) herdr 스냅샷 모델상 중간 revision은 복구 불가, (iii) 링 버퍼 밖 이력은 리셋으로만 수렴.
- **느린 소비자:** 기존 `SseClientStream`의 연결별 큐 한도·droppable 프레임 규칙을 pane 프레임에 재사용하고, 초과 시 연결-로컬 리셋으로 수렴한다(공유 로그 오염 없음 — 기존 설계와 동일).
- **상류 유계:** 게이트웨이→herdr 폴링은 pane 수 × 간격으로 비용이 선형이므로 pane 관찰 대상 상한(설정)을 두고, 초과분은 인벤토리에서 `state`로 표기만 한다.

### D6. 앱 터미널 뷰어

- **채택:** 모노스페이스 라이브 피드(pane당), 자동 스크롤(사용자 스크롤업 시 해제, 하단 도달 시 재개), 중앙 정렬 레이아웃(`docs/design/ui-ux-guidance.md` §2 위계). 프레임 디듀 키는 `paneId + revision`, SSE `id` 커서는 기존 앱 디코더 재사용. 레인 정직 표기(스트리밍 원천 없는 pane은 lifecycle-only 배지)와 "스냅샷 기원 텍스트" 고지를 UI에 넣는다.

### D7. M2 분리 — 파일·이미지 열람

pi attachments(`ImageContent` base64)와 read 계열 툴 결과의 파일 열람은 별도 `RemotePaneAssetEvent` 계열과 base64 유계(재생 버퍼 예산, 참조형 fetch vs 인라인 비교)를 요구하므로 M2 후속 결정으로 분리한다. v1 pane 텍스트 프레임 타입에 asset 필드를 미리 넣지 않는다(확장 지점은 비용이 들 때만).

## 3. 마일스톤과 기계 검증 가능한 수용 기준

### M-TM0 — Rust 선변경 + codegen

- 스코프: `crates/loop-bridge/src/**`, `packages/protocol/src/generated/**`. 의존: 없음.
- 수용 기준:
  - pane 프레임 타입이 `crates/loop-bridge`에 `#[bridge_type]`으로 존재하고 `bun run codegen:check` 통과(생성물 동기화).
  - `cargo test -p loop-bridge` 통과.
  - `rg -i "pane" crates/loop-core/src` 결과 0건을 `bun run test:architecture` 게이트로 추가하고 통과.

### M-TM1 — 게이트웨이 pane 관찰 + 엔드포인트

- 스코프: `packages/herdr/src/**`(소켓 pane 관찰 클라이언트), `packages/gateway/src/**`(port + 엔드포인트 + pane 로그). 의존: M-TM0.
- 수용 기준 (전부 Fake pane 소스, 유료 호출 0):
  - revision 디듀: 동일 revision 재송신 없음, revision 증가 시 정확 1프레임. 테스트: `bun test packages/gateway`.
  - 병합 의미: 폴링 간격 사이 3회 변경 → 마지막 스냅샷 1프레임(중간 revision 프레임 부재). 테스트 동일.
  - 커서 수렴: 버림된 이력 커서 → `reset(cursor_unavailable)` 1프레임 후 정상 재개; pane 소멸 → `reset(pane_gone)` 후 스트림 종료. 테스트 동일.
  - 프레임 상한: 상한 초과 스냅샷은 `truncated: true` 절단. 테스트 동일.
  - **적목 회귀:** pane 텍스트에 심은 토큰/bearer가 `redactProviderText` 경유로 `[credential]=[redacted]` 프레임으로 나가고, 기존 적목 테스트(`packages/providers`, `packages/herdr`)가 무변경 통과. 테스트: `bun test packages` + 신규 gateway 적목 케이스.
  - 경계: `packages/gateway/src`에 herdr 소켓 프로토콜 상수/문자열 없음(port 뒤), `crates/loop-core/src` pane 0건. `bun run test:architecture` 통과.
  - 실제 herdr 소켓 대상 통과는 환경 의존 테스트로 분리(별도 표기, 단위 게이트 아님).

### M-TM2 — 앱 터미널 뷰

- 스코프: `apps/loop-mobile/**`(및 공유 게이트웨이 클라이언트). 의존: M-TM1.
- 수용 기준:
  - pane 목록→구독→렌더 플로우가 FakePaneSource 대응 앱 테스트로 증명: 디듀(paneId+revision), autoscroll 상태 기계(스크롤업 해제/하단 재개), 모노스페이스·중앙 정렬 레이아웃 스냅샷.
  - 스트리밍 원천 없는 pane이 lifecycle-only 배지로 렌더됨 — 테스트 동일.

### M-TM3 — 시뮬레이터 시연 v3

- 운영자 승인 하 최소 유료 호출(1~2회 소형, M-TL4 선례)로 실제 pi 스트리밍 출력을 캡처하거나, 불가 시 fake provider 출력으로 대체하고 **캡처에 "fake" 표기를 명시**한다. 유료 호출 내역은 전량 공개 문서화(research 노트). 단위/마일스톤 게이트에 유료 호출은 포함되지 않는다.

## 4. 경계 준수 요약

- **pane은 loop-core에 유입 금지:** pane 개념은 herdr 어댑터(`@loop/herdr`), 게이트웨이 port, loop-bridge 프레임 타입에만 존재한다. loop-core 이벤트·프로젝션·도메인에는 pane이 없고, run/task 도메인 이벤트로 승격되지 않는다(M-TM0/M-TM1 아키텍처 게이트).
- **Rust 선변경 + codegen:** 모든 wire pane 타입은 `crates/loop-bridge`에서 먼저 정의되고 생성물을 함께 커밋한다. TS 수작업 복제 없음.
- **게이트웨이는 얇게:** herdr 소켓 프로토콜 지식은 `@loop/herdr`에, 게이트웨이는 port + 프레이밍 + 로그만. 커서 코덱·큐 한도·keepalive는 기존 어댑터-로컬 자산 재사용.
- **적목 계약 무변경:** `[credential]=[redacted]` 경로(`packages/providers/src/redact.ts`)는 그대로이며 pane 텍스트가 같은 관문을 지난다. 기존 적목 테스트 회귀 없음.
- **병존:** run activity 이력 → `RemoteRunOutputEvent` 경로는 유지되며 pane 스트림이 대체하지 않는다(real-run-planner D4 채택부 보존).

## 5. 리스크

- **폴링 충실도:** 폴링 간격 사이 변경은 마지막 스냅샷만 남는다(스냅샷 모델 한계). "흐름"의 부드러움은 간격 의존이며, S2 매처 구독 승격이 완화 경로다.
- **화면 버퍼 화질:** TUI 리렌더 흔적이 걷어진 텍스트라 인간이 보는 TUI와 동일하지 않다. 앱 고지로 기대치를 정렬한다.
- **herdr 소켓 신규 의존:** Loop가 소켓 API를 직접 쓰는 것은 처음이다. 프로토콜 20 고정 + 불일치 시 pane 관찰 fail-closed로 기계 경로를 격리한다.
- **pane 수 증가 시 폴링 비용:** 관찰 상한 설정 + S1 유지 조건을 문서화한다.

## 6. 미해결 항목

- 폴링 간격(초기 250ms)·pane당 링 버퍼 용량·프레임 바이트 상한의 확정값 — M-TM1 착수 시 테스트와 함께 확정.
- pane 인벤토리의 `state` 어휘(active/idle/gone 등) — herdr `pane.agent_status_changed` 매핑 기준으로 M-TM1에서 확정.
- S2(매처 구독) 승격 트리거 — M-TM3 시연 후 지연 체감으로 판단.
