# pi 터미널 미러 — herdr pane 스트림 구독과 pi TUI 표면 연구

- **태스크:** `pane-mirror-research` (research, attempt 0)
- **성격:** 사실 조사. 구현 없음, 유료 호출 없음.
- **읽은 증거:** `packages/herdr/src/**`, `packages/providers/src/mirror.ts`, `packages/orchestrator/src/{composition,task-execution}.ts`, `packages/gateway/src/**`, `crates/loop-bridge/src/**`, `docs/decisions/2026-09-23-worker-visibility.md`, `docs/decisions/2026-xx-real-run-planner.md`, `docs/decisions/2026-xx-remote-app-architecture.md`, 설치된 `herdr` 0.8.2 CLI/소켓 스키마(프로토콜 20, `herdr api schema --json`), 설치된 `pi` 0.87.1 문서(`@earendil-works/pi-coding-agent/docs/{json,message-types,tui}.md`), `pi --help`, `herdr pane --help`
- **결론 요약:** herdr 미러는 오늘 **쓰기 전용**이다(렌더 줄 → `pane send-text`). pane 텍스트를 **읽는** 프로그램적 경로는 CLI 스냅샷(`pane read`), CLI 대기(`pane wait-output`), 소켓 API(`pane.read`, `events.subscribe`의 `pane.output_matched`) 세 가지이며 어느 것도 델타 스트림이 아니라 "알림 + 스냅샷" 모델이다. pi 워커가 인간에게 보여주는 것(스트리밍 텍스트·툴 호출 흐름)과의 격차는 두 축이다: (1) `-p` 프로세스 워커는 증분 이벤트가 원천 자체가 없고(pi 명세), (2) herdr interactive 워커의 실제 TUI 텍스트는 pane 안에 있지만 Loop는 pane을 읽지 않는다. v1 스코프(게이트웨이 pane 구독 SSE + 앱 터미널 뷰)는 **pane 프레임 타입을 loop-bridge에 Rust-first로 추가**하고 `bun run codegen`으로 생성하는 경로가 맞지만, 이는 원격 앱 ADR D3의 "wire payload에 pane 이름 금지"와 real-run-planner D4의 "herdr pane tail 기각"을 **명시적으로 개정하는 후속 결정**을 요구한다.

---

## (a) herdr pane 미러가 오늘 담는 것

### 파이프라인 전체

```text
AgentProvider.subscribe 이벤트
  → MirroringProvider (데코레이터, 기계 경로 무손상 통과)
  → renderProviderEvent (패밀리별 순수 렌더러, ANSI 제거·적목·160자 클램프)
  → MirrorSink (compositeSink: StoreActivitySink + PaneMirrorSink)
  → PaneMirrorSink → BoundedPaneSender (250ms 병합, 큐 100, 초과 폐기)
  → HerdrWorkerRuntime.sendText → `herdr pane send-text <paneId> <text>` (CLI 자식 프로세스)
```

### 단계별 사실 (file:line)

1. **데코레이터:** `MirroringProvider`는 `subscribe`를 가로채 원본 `ProviderEvent`를 리스너에 그대로 통과시킨 뒤(1 Hz activity·기계 결과 경로 보존) 렌더 줄을 sink에 발행한다 — `packages/providers/src/mirror.ts:488-503`. 어댑터 자체는 미러를 모른다.
2. **렌더러:** `renderProviderEvent`(`mirror.ts:53-100`)는 이벤트 유형별로: lifecycle → `[lifecycle] <status>`, session → `[session] <id>`, final → `[result] <summary>`, output → 패밀리 분기. **pi 패밀리는 output 이벤트를 렌더하지 않고 버린다**(worker-visibility D2: print 모드는 증분 출력이 없다는 pi 명세의 정직한 반영) — `mirror.ts:74-78`. codex는 stdout JSONL 아이템을 파싱해 `[thread]`/`[item] started`/`[message]`/`[command] … (exit N)` 줄로 바꾼다(`mirror.ts:102-152`). agy/generic은 줄 단위 통과(`mirror.ts:154-165`).
3. **줄 위생:** `cleanLine`(`mirror.ts:167-174`)이 ANSI 이스케이프 제거 정규식 → `redactProviderText` 적목 → `lineTextLimit`(기본 160) 클램프. 즉 pane에 담기는 것은 **원문이 아니라 적목·절단된 렌더 줄**이다.
4. **pane sink:** `PaneMirrorSink`(`mirror.ts:289-387`)는 워커당 수동 pane 하나를 만든다. `HerdrWorkerRuntime.createPane`(`packages/herdr/src/client.ts:203-239`)이 `tab create --workspace … --no-focus` + `pane rename`으로 `mirror·<taskId>` 라벨의 수동 뷰어 탭을 만들고 프로세스는 없다. pane 한도 기본 4(`mirror.ts:319`), 초과 워커는 watch 피드로만 폴백(`mirror.ts:313-315`), HERDR_* 문맥 없으면 sink 전체 비활성(`mirror.ts:311`, `mirror.ts:389`). interactive 워커(HerdrAgentProvider 소유 TUI pane)는 send-text 제외 대상(`packages/orchestrator/src/composition.ts:236-238`). pane 수명 = 워커 수명(`onWorkerFinish` → `sender.close()` → `closePane`, `mirror.ts:376-387`; `client.ts:236-239`).
5. **병합·폐기 유계:** `BoundedPaneSender`(`packages/herdr/src/bounded-sender.ts:12-68`)가 최소 간격 250 ms로 줄을 병합해 한 번의 `sendText`로 보내고(`bounded-sender.ts:55-66`), 큐 100 초과분은 폐기했다가 플러시마다 `… N lines suppressed` 마커 한 줄로 보고한다(`bounded-sender.ts:29-35`, `bounded-sender.ts:59-60`). pane 쓰기 실패는 삼켜 기계 경로를 절대 끊지 않는다(`bounded-sender.ts:62-65`).
6. **전송:** `sendText`는 `herdr pane send-text` CLI를 자식 프로세스로 실행한다(`client.ts:241-243`; 러너는 호출별 spawn, `client.ts:91-135`).
7. **릴레이 프레이밍:** steer 릴레이가 pane을 호스팅하는 동안(`herdr pane run`, `client.ts:250-252`) 미러 줄은 단일 줄 JSON 디스플레이 프레임 `{"loopDisplay": <line>}`으로 감싸진다(`mirror.ts:338-339` 프레임 스위치, `packages/herdr/src/relay.ts:23-27` 인코더). 프레임이 아닌 줄은 사용자 steer 입력으로 분류된다(`relay.ts:29-45`).

### 미러가 담지 **않는** 것

- 프로세스 stdout 원문(적목·클램프 전), 160자를 넘는 줄의 나머지, ANSI 스타일, 큐에서 폐기된 줄의 내용.
- **pi 워커의 모든 중간 활동**(model 출력 스트리밍, 툴 호출) — `mirror.ts:74-78`이 output을 의도적으로 드롭하고 `-p` 모드 자체가 증분 이벤트가 없기 때문(`packages/providers/src/pi/adapter.ts:60-64`: `--no-session -p` 고정).
- pane 텍스트의 **읽기/구독** — 미러 파이프라인에는 읽기 표면이 존재하지 않는다(쓰기 전용).

## (b) pane 텍스트 스트림의 프로그램적 구독 방법

설치 버전 기준(herdr 0.8.2, 소켓 프로토콜 20, 소켓 `~/.config/herdr/herdr.sock` — `herdr status` 출력).

### CLI 경로 (Loop가 오늘 쓰는 방식, 호출별 자식 프로세스)

| 명령 | 성격 | 증거 |
| --- | --- | --- |
| `herdr pane read <PANE_ID> --source <visible\|recent\|recent-unwrapped\|detection> [--lines N] [--format text\|ansi]` | **스냅샷**. `--follow`/스트림 옵션 없음. `recent`는 스크롤백 포함 버퍼, `visible`은 뷰포트만. | `herdr pane read --help` (0.8.2) |
| `herdr pane wait-output <PANE_ID> --match TEXT\|--regex PATTERN [--timeout MS]` | 매치가 나올 때까지 **블록**(즉시 검색 후 폴링). 스트림이 아니라 상태 대기. | `herdr pane wait-output --help` |
| `herdr agent read <name> --source recent-unwrapped --lines N` | 에이전트 스냅샷. `read` 계열만 JSON 봉투가 아니라 원문 텍스트를 stdout에 출력. | `client.ts:312-364` (`read`), `client.ts:366-373` (`#readSurface` 주석: "read prints the raw pane text instead of the JSON envelope") |

Loop 내 기존 소비 선례: `HerdrWorkerRuntime.read`가 `agent read`(에이전트 소멸 시 `pane read` 폴백)로 80줄 스냅샷을 얻는다(`client.ts:312-324`). `herdr pane --help` 하위 명령 목록에 **pipe/stream/follow 계열은 존재하지 않는다**(2026-09-25 로컬 확인).

### 소켓 API 경로 (프로그램적 구독의 본체)

`herdr api schema --json`(protocol 20)에서 확인한 표면:

- **봉투:** 요청 `{id, method, params}`(request 스키마: `required: ["id"]`, 각 분기 `required: ["method","params"]`), 응답 `{id, result}`(success_response).
- **메서드**(전체 90종 중 관련 것): `pane.list`, `pane.get`, `pane.read`, `pane.wait_for_output`, `events.subscribe`, `events.wait`, `session.snapshot`.
- **`pane.read`** — `PaneReadParams { pane_id, source: visible|recent|recent_unwrapped|detection, lines?, format: text|ansi(기본), strip_ansi: true(기본) }`. 응답 `PaneReadResult { pane_id, workspace_id, tab_id, source, format, text, revision: uint64, truncated }` — **단조 증가 `revision` 카운터가 스냅샷 변경 감지의 훅**이다.
- **`events.subscribe`** — `{subscriptions: Subscription[]}`, 구독 가능 종류 27종(`workspace.*`, `worktree.*`, `tab.*`, `pane.*`, `layout.updated`). 수신 이벤트(`subscription_event`)의 pane 관련 실체는 정확히 셋:
  1. `pane.output_matched` → `PaneOutputMatchedEvent { pane_id, matched_line, read: PaneReadResult }` — **매처( substring|regex )에 걸린 출력이 생겼을 때 스냅샷째로 전달.**
  2. `pane.agent_status_changed` → `{pane_id, agent_status: idle|working|blocked|done|unknown, …}`.
  3. `pane.scroll_changed` → `{pane_id, scroll: {offset_from_bottom, max_offset_from_bottom, viewport_rows}}`.
- **`OutputMatch`** — `{type:"substring", value}` | `{type:"regex", value}`.

### 핵심 판정: 델타 스트림이 없다

소켓 API에도 **"모든 출력 변경" 이벤트나 바이트 델타 프레임은 없다.** `pane.output_matched`는 매처 필요 + 스냅샷 전달이므로, 라이브 텍스트 흐름의 현실적 구성은 둘 중 하나다:

- **(S1) 리비전 폴링:** 일정 간격 `pane.read` → `revision` 비교로 변경 시에만 재렌더. 구현이 가장 단순하고 접속 1개로 N pane 커버. 폴링 간격만큼 지연.
- **(S2) 매처 구독:** pane당 `events.subscribe`로 `pane.output_matched`를 regex `.`(모든 줄 매치)로 구독 → 이벤트 도착 시 스냅샷 수신 → 리비전/텍스트 디듀. 푸시 지연은 최소지만 pane당 구독 상태와 스냅샷 디핑이 따라온다.

게이트웨이는 앱에 SSE를 다시 내므로, 게이트웨이↔herdr 구간은 S1(또는 S2)이고 앱↔게이트웨이 구간은 기존 `RunEventLog` 패턴(`packages/gateway/src/events.ts:20-129`: seq 커서, 링 버퍼 1024, 리셋 프레임)을 재사용하는 것이 집 규칙에 맞다.

### 역방향 표면 (참고)

`herdr pane run`(`client.ts:250-252`)은 pane **안에** 프로세스를 호스팅해 pane 키보드 → 프로세스 stdin, 프로세스 stdout → pane 디스플레이를 만든다(steer 릴레이가 쓰는 길, `relay.ts:7-15`). 이것은 pane 출력의 구독 경로가 아니라 입력 주입 경로다.

## (c) 인간이 보는 pi TUI와의 격차

pi TUI가 인간에게 보여주는 것(0.87.1 기준): 스트리밍 어시스턴트 텍스트·싱킹, 마크다운 렌더, 툴 호출 블록(이름·인자·부분/최종 결과), 테마 색. 이 렌더링의 원천이 곧 JSON 모드 이벤트다(pi docs `tui.md:34` — `Text/Markdown/Image` 컴포넌트; `json.md` 전체).

pi `--mode json`(설치본에서 `pi --help`로 플래그 확인, `-p`와 결합 가능)은 LF-framed JSONL로 정확히 다음을 흘린다(pi docs `json.md`):

| 이벤트 | 필드 | 의미 |
| --- | --- | --- |
| `session` | version,id,timestamp,cwd | 세션 헤더(첫 레코드) |
| `message_update` | `assistantMessageEvent` | `text_delta`/`thinking_delta`/`toolcall_start|delta|end` 등 델타 전용(`json.md:81-95`), 와이어는 delta-only라 스트림 크기 선형 |
| `tool_execution_start/update/end` | toolCallId, toolName, args, partialResult/result, isError | 툴 실행 수명 상관 가능(`json.md:98-114`) |
| `message_end` | message | 최종 메시지(권위적) |
| `agent_end`/`agent_settled` | messages, willRetry / — | 실행 종료/자동 잔여 작업 없음 |

### 레인별 격차 매트릭스

| 워커 레인 | 오늘 Loop가 아는 것 | 원격 뷰어에 흐를 수 있는 것 | 격차 원인 |
| --- | --- | --- | --- |
| **pi 프로세스** (`pi --no-session -p`, `packages/providers/src/pi/adapter.ts:60-64`) | lifecycle + 최종 캡처 결과뿐(`mirror.ts:74-78`; `-p`는 "Intermediate events are not exposed", worker-visibility D2) | **아무것도 스트리밍 불가** — 원천 이벤트가 없음 | `--mode json` 미채택. 채택 시 기계 캡처 경로 변경(최종 메시지가 `message_end.message` 형태, 종료 코드 의미 변화 — worker-visibility D2가 별도 결정으로 분리한 이유) |
| **pi interactive** (`herdr agent start --kind pi`, `composition.ts:251-271`, `client.ts:561-586`) | pane 안에 실제 TUI가 살아 있으나 Loop는 **pane을 전혀 읽지 않음**(미러는 이 레인을 send-text에서 제외, `composition.ts:236-238`) | pane 스냅샷 텍스트는 (b)의 경로로 즉시 가능. 단 그것은 **화면 버퍼 스냅샷**이지 의미 이벤트 스트림이 아님 — 툴 호출 경계·델타는 스냅샷 디핑으로 재구성해야 함 | Loop의 pane 읽기/구독 표면 부재(이번 v1 스코프의 본체) |
| **codex** (`exec --json`) | 증분 JSONL 아이템의 렌더 줄(`mirror.ts:102-152`) | 렌더 줄 수준의 라이브 흐름은 이미 가능(저장소 activity 경유) | 줄 렌더라 TUI 수준의 구조(인자·부분 결과)는 아님 |
| **agy persistent** | `step_update` 델타 스트림(`mirror.ts:154-159`) | 동일 | — |
| **turnloop lane** (`TurnLoopProvider`, `composition.ts:285-303`) | in-process 실행, 터미널 pane 자체가 없음 | 터미널 미러 대상 아님 — 별도 이벤트 표면 필요(범위 밖 명시 권장) | pane 개념과 무관 |

요컨대 "원격에서 pi 터미널을 그대로 보는 것"은 두 갈래로 쪼개진다: **(i) interactive 워커의 화면 버퍼를 스트리밍**(herdr pane 읽기 — 오늘 바로 가능, 텍스트 화질은 스냅샷 한계), **(ii) 의미 단위 스트림**(json 모드 델타 — `--mode json` 채택 결정이 선행). v1 스코프를 (i)로 하고 (ii)를 후속으로 두는 것이 기계 경로 동결 원칙(worker-visibility D6)과 일치한다.

## (d) rustra 경로 — Rust-first 프레임 타입과 codegen 흐름

### 오늘의 codegen 흐름 (확인된 사실)

1. Rust 타입이 `crates/loop-bridge/src/**`에 `#[bridge_type]`로 선언된다(예: `events.rs:3-23`의 `EventOutput`, `RunChangedEvent`, `GuidanceDeliveredEvent`; `commands.rs:23-283`의 30여 개 입출력 타입).
2. `crates/loop-bridge/src/bin/generate.rs:5-11`이 `loop_package().generate_typescript().write_schema_to_dir(...)`로 스키마와 TS를 생성한다. `rustra.json`이 schema/output을 `packages/protocol/src/generated`로 고정한다.
3. `bun run codegen` = `bun scripts/rustra-codegen.ts`, `codegen:check`가 동기화 검증(`package.json:14-15`). 생성물: `types.ts`, `commands.ts`, `events.ts`, `frame-codecs.ts`, `frame-registry.ts`, `bun.ts`, `contract.ts`, `schema.json`.
4. 집 규칙: **Rust 타입 선변경 → `bun run codegen` → 생성 파일을 Rust 변경과 함께 커밋**(AGENTS.md; worker-visibility D3가 동일 절차 선언).

### 현 상태의 중간 단계

원격 앱 wire 페이로드(`SubmitPromptInput`, `RemoteRun*` 계열)는 **아직 loop-bridge에 없고**(crates 전체 grep으로 부재 확인), 게이트웨이가 `wire.ts`의 수작업 타입을 쓰며 스스로 "TEMPORARY seam"이라고 표기한다 — `packages/gateway/src/wire.ts:8-21`("the authoritative payloads are Rust-owned types in `crates/loop-bridge` … That regeneration is not in this tree yet … when `packages/protocol` exports the generated remote gateway types, delete this file"). 원격 앱 ADR D3가 Rust-owned 목록을 고정해 두었다(`2026-xx-remote-app-architecture.md` §D3: `RemoteRunOutputEvent` 등 17종).

### pane 스트리밍 v1에 추가할 Rust-first 타입 (제안)

`crates/loop-bridge/src/`에 신규 선언하고 codegen하는 형태. 이름은 제안이며 후속 결정에서 확정:

- `RemotePaneSummary { pane_id, label, task_id, workspace_id, state }` — pane 목록/구독 대상 열거.
- `RemotePaneListOutput { panes: Vec<RemotePaneSummary> }` — "이 run에 열린 터미널" 인벤토리.
- `RemotePaneTextEvent { pane_id, revision: u64, seq: u64, text: String, truncated: bool, occurred_at: String }` — 스냅샷 기원 텍스트 프레임. herdr의 `PaneReadResult.revision`을 그대로 u64로 옮기되 **JSON에서는 10진 문자열 규칙**(ADR §4.1의 u64 규칙, `wire.ts:14-15` 선례)을 후속 결정에서 명문화.
- `RemotePaneResetReason { cursor_unavailable | pane_gone }` — 기존 `RemoteRunResetReason`(`wire.ts:117`)과 대칭.
- 경계: 이 타입들은 **loop-bridge(브릿지)에만** 존재한다. `loop-core`는 pane 개념을 전혀 모른다(AGENTS.md; worker-visibility D6 경계 비고 재확인 — 활동 이력 확장 때와 동일 원칙). 게이트웨이가 herdr을 `pane read/events.subscribe`로 관찰하는 것은 어댑터 층 행위다.

### 반드시 개정해야 할 선행 결정 두 건 (아키텍트 지적)

1. **원격 앱 ADR D3**(`2026-xx-remote-app-architecture.md` §D3): "특히 다음 이름은 Rust payload에 들어갈 수 없다: … Herdr, pane …"이자 "v1 output은 snapshot의 bounded `tasks[].activities`를 증분 투영한 것"이며, 다이어그램 주석도 "Herdr adapter (로컬 관찰; wire에 노출하지 않음)". pane 프레임을 wire에 올리면 이 문장을 **수정(개정)** 해야 한다. pane 타입의 자리는 loop-bridge이므로 AGENTS 경계 자체와는 충돌하지 않지만, ADR 문언과 충돌하므로 후속 결정 문서가 개정 사실과 영향 범위를 명시해야 한다.
2. **real-run-planner D4**(`2026-xx-real-run-planner.md` §D4): "기각 — `herdr pane` 텍스트를 gateway가 tail: herdr를 wire 전송 계층으로 승격하는 것이고 원격 앱 ADR이 명시적으로 배제했다" + "lossless pane transcript는 v1 범위 밖". 이번 인텐트는 정확히 이 기각을 뒤집는 것이므로, 같은 문서의 후속 결정 또는 신결정이 **대체(supersede) 관계**를 명시해야 한다. 저장소 activity 경로(D4 채택부)는 그대로 병존 가능하다 — pane 스트림은 activity를 대체하지 않고 별도 프레임 계열이다.

또한 유계 정책을 후속 결정에 포함해야 한다: herdr→게이트웨이 폴링 간격/리비전 디듀, 게이트웨이→앱 프레임 상한(기존 `MAX_OUTPUT_BYTES = 8 KiB`, `wire.ts:161` 착안하되 텍스트 프레임 단위 재정의), 링 버퍼(`REPLAY_BUFFER_FRAMES = 1024`, `wire.ts:167`)의 pane 변형, 느린 소비자 리셋. `BoundedPaneSender`의 병합·폐기 선례(`bounded-sender.ts:29-35`)가 반대 방향(쓰기)의 유계 참조 모델이다.

## (e) 파일·이미지 흐름 (이후 마일스톤 M2)

pi의 데이터 형태(0.87.1 docs `message-types.md`):

- `ImageContent { type: "image", data: <base64>, mimeType }`(`message-types.md:28-37`).
- 툴 실행 결과 `result.content[]`는 텍스트/이미지 블록 배열(`json.md:105-114`의 `tool_execution_end` 예제).
- pi TUI 컴포넌트에 `Image`가 존재(`tui.md:34`) — pi 자체도 대화 내 이미지를 렌더한다.

M2 경로 제안(근거 수준, 결정 아님):

1. **원천:** `--mode json` 채택 레인에서 `tool_execution_end.result.content[]`의 이미지 블록과 read 계열 툴 결과 텍스트를 포착한다. interactive 레인은 화면 버퍼 특성상 이미지 복원이 불가능하다 — 파일/이미지 열람은 json 모드 레인 또는 전용 조회 명령과 묶여야 한다.
2. **프레임:** 텍스트 pane 프레임과 **별도의** `RemotePaneAssetEvent` 계열(base64 payload, mimeType, 크기 상한)을 loop-bridge에 추가. 기존 output 프레임 예산(8 KiB, `wire.ts:161`)은 이미지에 못 미치므로 상한·트렁케이션 규칙을 프레임별로 분리해야 한다.
3. **소비:** RN은 base64 데이터 URI를 직접 렌더할 수 있고, 앱에는 이미 SSE 디코더(`apps/loop-mobile/src/gateway/sse.ts:4-98`)와 output 디듀(`activityId` 기준, `apps/loop-mobile/src/screens/RunScreen.tsx:12,39,87-88`) 인프라가 있다 — 프레임 종류 추가가 앱 파이프라인 확장으로 흡수된다.
4. **유계:** base64 프레임은 링 버퍼·큐 예산을 순식간에 소진한다. 이미지 프레임의 재전송(replay) 제외 또는 참조형(게이트웨이가 리소스 엔드포인트를 들고 앱이 fetch) 설계를 후속 결정에서 비교해야 한다.

## v1 스코프 권고 (결정 태스크 입력용)

1. **채택 대상 레인:** interactive 워커(HerdrAgentProvider 소유 pane)의 화면 버퍼 스트리밍을 v1 본체로. 프로세스 `-p` 레인은 스트리밍 원천이 없음을 앱에 정직 표기(라이프사이클만). `--mode json`은 별도 결정으로 분리 — 기계 캡처 경로 변경을 수반하기 때문(worker-visibility D2 선례).
2. **게이트웨이↔herdr:** 리비전 폴링(S1)으로 시작. 소켓 1연결 + `pane.list` 인벤토리 + pane별 `pane.read` 폴링. 매처 구독(S2)은 지연 단축이 필요해질 때의 확장점.
3. **Rust 선변경:** 위 (d) 타입을 loop-bridge에 추가 → `bun run codegen` → 생성물 동봉 커밋. 원격 앱 ADR D3·real-run-planner D4의 해당 문언을 개정하는 결정 문서를 먼저 작성.
4. **앱:** 기존 SSE 인프라 위에 pane 프레임 계열 추가, 모노스페이스 라이브 스크롤 뷰. 프레임 디듀 키는 `pane_id + revision`(+ 프레임 seq).

## 미해결 리스크

- **매처 폴링의 정확성:** S1 폴링 간격 사이의 여러 변경은 마지막 스냅샷만 남는다(herdr 스냅샷 모델의 한계). 라이브 "흐름"의 충실도는 폴링 간격에 의존한다.
- **ANSI/화면 버퍼 화질:** `recent` 스냅샷은 TUI의 리렌더 흔적(커서 이동, 부분 지움)을 걷어낸 텍스트라, 인간이 보는 TUI와 동일하지 않다. `--format ansi`는 색을 준다.
- **소켓 API 소비의 신규성:** Loop는 오늘 소켓 API를 직접 쓰지 않는다(전부 CLI 자식 프로세스, `client.ts:91-135`). 소켓 클라이언트는 herdr 프로토콜 버전(현재 20)에 대한 호환 정책을 요구한다.
- **`--mode json` 채택 비용:** 요약 추출 키와 종료 코드 의미가 달라져 기계 경로 변경이 따른다(worker-visibility D2 기록) — 이번 연구는 채택을 다루지 않는다.
- **유료 출력 필요:** 실제 pi 스트리밍 출력의 시연/검증은 운영자 승인 하 최소 유료 호출이 필요하며, 불가 시 fake provider 출력과 명확히 구분 표기해야 한다(인텐트 제약).
