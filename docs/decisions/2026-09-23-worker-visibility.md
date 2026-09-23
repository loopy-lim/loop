# 워커 가시성 — tee 미러 레이어, 뷰어 표면, 설정 게이팅

- **일자:** 2026-09-23
- **상태:** 결정됨; 구현은 후속 태스크
- **결정 종류:** `decision` (visibility-decision)
- **의존성:** `facts-worker-streams` 팩트 시트 (`docs/research/2026-09-23-worker-visibility-facts.md`)
- **읽기 범위:** `AGENTS.md`, `config/policy.toml`, `config/providers.example.toml`, `docs/decisions/persona-ux.md`, `docs/research/2026-09-23-worker-visibility-facts.md`, `packages/cli/src/main.ts`, `packages/herdr/src/**`, `packages/providers/src/**`
- **쓰기 범위:** 이 결정 문서만. 구현 파일은 각 결정의 "수정 대상 파일"에 후속 태스크용으로 기술.
- **선행 결정과의 관계:** `run-visibility.md`(watch = status 재활용 렌더), `ui-output-limits.md`(`[output]` 단일 한도원), `pi-worker-pane-visibility.md`(interactive 워커의 herdr 탭 경로), `persona-ux.md` D2(비-pi 워커 지시는 requirements 채널)를 위배하지 않는다. 본 문서는 그 위에 **라이브 워커 활동 피드**를 얹는다.

## 배경 팩트 (결정의 전제, 팩트 시트에서 재검증)

1. **어댑터는 이미 이벤트 스트림을 갖고 있다.** `ProcessProvider.subscribe`가 청크를 `ProviderEvent { type: "output" | "lifecycle" | "session" | "final" }`으로 재판매하고(`packages/providers/src/types.ts:49-56`, `process-provider.ts:48-61`), 청크는 리스너에게 가기 **전에** `redactProviderText`로 적목된다(`process-provider.ts:50`). codex `exec --json`은 증분 JSONL 아이템을 이미 stdout에 흘린다(§1.3). agy 영속 드라이버는 `#onLine`에서 줄 단위 파싱 후 `subscribe()`로 `step_update` 델타를 재판매한다(`antigravity/driver.ts:205-285`) — 단 `AgyPersistentProvider`가 이를 조립 안으로 노출하지 않아 오늘날 완전히 보이지 않는다(§1.4).
2. **오케스트레이터는 1 Hz·마지막 한 줄만 소비한다.** `task-execution.ts:60-67`이 `output` 이벤트를 1초 스로틀해 ANSI 제거·300자 적목 후 `control.recordActivity`로 저장하고, 나머지 스트림은 전부 폐기한다. Rust 쪽은 `TaskActivityRecorded` 이벤트 → `activities: BTreeMap<TaskId, String>` 단일 마지막 줄(`loop-bridge/src/execution.rs:297-304`, `loop-core/src/event/reducer.rs:62,108-110`).
3. **watch는 스냅샷 폴링 렌더러다.** `loop watch`는 `observeRun`이 100 ms 폴링·`lastSequence` 변경 시에만 clear-screen + `renderStatus`를 다시 그린다(`cli/main.ts:181-183`, `cli/dispatcher.ts:26-58`). 워커별 라이브 피드는 존재하지 않는다.
4. **소유자와 관찰자는 분리된 프로세스다.** 소유자는 `spawnOwner`로 detached(stdio ignore) 실행되므로(`dispatcher.ts:8-21`) 어댑터가 stdout에 직접 쓰는 tee는 watch 터미널에 절대 보이지 않는다. 트랜스포트는 저장소 또는 herdr여야 한다.
5. **pi `-p`는 증분 출력이 없다.** pi 문서 명시: print 모드는 최종 어시스턴트 텍스트만 stdout에 쓰고 "Intermediate events are not exposed"(`pi docs/cli-integration.md`). 대신 **스트리밍 플래그가 존재한다**: `pi --mode json`(도움말: `--mode <mode>  Output mode: text (default), json, or rpc`) — 세션 헤더 + `message_update.text_delta/thinking_delta` + `toolcall_start/delta/end` + `tool_execution_start/update/end` + `agent_end/agent_settled` JSONL(`pi docs/json.md:30-114`). `-p`와 결합 가능하다(로컬 `pi --help` 확인).
6. **herdr 표면은 이미 존재한다.** 탭 생성/이름변경/닫기(`herdr/client.ts:90-105,169-179`), 미사용이지만 확인된 `herdr pane send-text <paneId> <text>`, 워커 수명 = 탭 수명(start에서 생성, cleanup/cancel/release에서 close). 플러딩은 미측정이라 게이팅 필요(팩트 시트 리스크 4).
7. **한도 정책의 단일 원천이 있다.** `config/policy.toml [output]` 다섯 키 → `LoopConfig.output`(`orchestrator/src/config.ts:152-164`) → `compactLines`. 새 표면은 여기에 키를 추가하고 `compactLines`을 타는 것이 집 규칙이다(`ui-output-limits.md`).

## 결정

### D1. tee 아키텍처 — `AgentProvider.subscribe` 봉합 위의 미러 데코레이터 (기계 경로 불변)

- **채택:** `packages/providers`에 `MirroringProvider` 데코레이터를 둔다. 기존 어댑터를 감싸 `subscribe`를 가로채고, 가공하지 않은 `ProviderEvent`는 그대로 통과시키며(오늘의 1 Hz activity 경로 보존), 동일 이벤트를 **패밀리별 렌더러**(codex JSONL 아이템 → 사람 줄, agy `step_update` 델타 → 줄, lifecycle → 줄)로 바꿔 주입된 `MirrorSink` 콜백으로 발행한다. 렌더러는 providers 패키지 안의 순수 함수다. `AgyPersistentProvider`는 기존 `AgyStreamDriver.subscribe`를 `subscribe` 메서드로 노출하는 순수 조립 추가만 한다. **기계 파싱 경로(`extractMachineResult`, `provider.result`, 종료 코드, 256 KB 캡처)는 한 글자도 바꾸지 않는다** — 미러는 옆에서 달린다(replace 금지).
- **수정 대상 파일:** `packages/providers/src/mirror.ts`(신규: 데코레이터 + 렌더러 + `MirrorSink` 타입), `packages/providers/src/antigravity/persistent.ts`(`subscribe` 노출), `packages/orchestrator/src/composition.ts`(sink 주입 래핑), `packages/providers/test/mirror.test.ts`(신규).
- **대안 및 기각 이유:**
  - 어댑터 4곳마다 내부에 구독자 팬아웃을 직접 추가 → 기각. 같은 팬아웃 로직을 어댑터 수만큼 복제하고 기계 경로 회귀면을 넓힌다. 데코레이터 한 점이 어댑터 셋을 균일하게 커버한다.
  - 렌더링+tee를 오케스트레이터 `task-execution`에 둠 → 기각. codex `item.completed`·agy `step_update`·pi `message_update` 같은 **프로바이더 이벤트 형태 지식이 providers 경계 위로 새어난다.** 오케스트레이터는 형태 무지를 유지해야 한다.
  - `NodeProcessRunner` 청크 단위에서 tee → 기각. `AgyStreamDriver`는 러너를 소유하지 않고(`driver.ts:76-83` 별도 spawn) `HerdrAgentProvider`도 커버하지 못한다. `AgentProvider.subscribe` 봉합이 유일한 전 어댑터 공통 지점이다.

### D2. pi 레인 — 정직한 한계 고지, `--mode json`은 이름을 밝히고 후속 결정으로 분리

- **채택:** v1에서 pi 프로세스 워커(`pi --no-session -p`)는 **라이프사이클(starting/running/completed/failed/cancelled) + 캡처된 최종 결과**만 보인다. 이는 플래그 실수가 아니라 print 모드의 명세다("Intermediate events are not exposed"). 해결 플래그는 존재하며 **`pi --mode json`**이다: 세션 헤더, `text_delta`/`thinking_delta`, `toolcall_*`, `tool_execution_start/update/end`(도구 이름·인자·부분 결과), `agent_end/agent_settled`를 LF-framed JSONL로 stdout에 흘리고 `-p`와 결합된다. 그러나 채택은 **이 결정에서 하지 않는다**: json 모드의 최종 메시지는 나체 최종 텍스트 줄이 아니라 `message_end.message` 형태라 기존 요약 키 목록(`final|final_message|result|output_text`, `process-provider.ts:181-207`)이 맞지 않고, 종료 코드 의미도 달라진다(error/aborted stop reason에서 비영종료). 이는 **리드가 동결한 기계 캡처 경로의 변경**이므로, 전용 매핑(`message_end` → 요약, stop reason → 실패 판정)과 테스트를 갖춘 후속 결정+태스크로 분리한다.
- **수정 대상 파일:** 없음(문서로 고지). 후속 태스크 후보: `packages/providers/src/pi/adapter.ts`(플래그 전환), `process-provider.ts`(요약 매핑), `adapters-v2.test.ts`(json 모드 스크립트 러너 회귀).
- **대안 및 기각 이유:**
  - 가시성 플래그에 `--mode json` 전환을 즉시 묶음 → 기각. 뷰어 기능과 기계 경로 변경이 한 번에 실린다. 요약 추출·종료 코드 회귀가 UI 기능과 동시에 터지는 결합은 "캡처 경로 불변" 원칙 위반이다.
  - pi는 영원히 안 보인다고 단정 → 기각. 플래그가 존재하므로 거짓이고, 이름을 밝히고 분리하는 편이 정직하다. 사용자는 "pi 레인은 v1에선 라이프사이클+결과만"을 기대치로 명시적으로 받아야 한다.

### D3. watch 피드 트랜스포트 — 저장소 기반 워커별 활동 이력 (bridge/core를 먼저, codegen 동봉)

- **채택:** 워커별 활동을 마지막 한 줄에서 **경계 있는 이력**으로 확장한다. `TaskActivityRecorded` 이벤트와 `recordActivity` 브리지 입력은 줄 하나를 유지하되, 리듀서가 태스크별 **고정 상한 순환 버퍼(코어 상수, 기본 8 — `list_line_limit` 기본값과 동일한 저장 상한)**를 유지하고(`loop-core/src/event/reducer.rs`의 `activities: BTreeMap<TaskId, String>` → `BTreeMap<TaskId, VecDeque<String>>`), 스냅샷이 `Vec<String>`으로 노출한다. 표시 개수는 프레젠테이션 예산(`worker_activity_lines`)이 자른다 — 저장 상한은 Rust의 결정적 정책, 표시 예산은 TS 프레젠테이션 정책으로 분리한다. 기존 1 Hz 스로틀(`task-execution.ts:61`)이 그대로 발행 속도 상한이 되어 무료로 유계가 된다. `loop watch`는 워커 줄 아래 이력을 렌더한다. **Rust 브리지/코어 타입을 먼저 바꾸고 `bun run codegen`, 생성 파일을 Rust 변경과 함께 커밋한다**(집 규칙).
- **수정 대상 파일:** `crates/loop-core/src/event/reducer.rs`(이력 버퍼), `crates/loop-bridge/src/commands.rs`(스냅샷 타입), generated protocol(codegen), `packages/presentation/src/snapshot.ts`(피드 렌더), `packages/cli/src/main.ts`(watch 분기), `packages/cli/test/cli.test.ts`.
- **대안 및 기각 이유:**
  - 런별 JSONL 사이드카 로그를 소유자가 쓰고 watch가 tail → 기각. 저장소의 activity와 별개 **제2의 진실원**이 생기고, watch가 두 비동기원을 인터리브해야 하며, 타입이 없고 파일 수명·정리 관리가 따라온다. `loop status`로 사후 조회도 불가하다.
  - herdr만을 트랜스포트로 → 기각. 1차 표면은 herdr 부재 환경에서도 동작해야 한다는 요구 자체다. HERDR_*는 환경 우연이다.
  - 현 상태(1줄) 유지 → 기각. 오늘의 상태가 그것이고 요구는 라이브 피드다. N줄 이력이 "활동처럼 읽히는" 최소 델타이며 저장소·스로틀이 이미 유계를 보장한다.
- **경계 비고:** 이 확장은 loop-core에 provider/pane/터미널 개념을 넣지 않는다 — "워커 활동"은 이미 존재하는 도메인 개념이고 바뀌는 것은 원소 개수뿐이다.

### D4. herdr 표면 — 워커당 패널, 수명 = 워커 수명, 상한 + 오버플로 정책

- **채택:** `worker_visibility = "panes"`이고 HERDR_* 문맥이 있을 때 한해, 미러 퍼블리셔가 워커당 탭을 만들고(`tab create` + `pane rename`, 기존 `HerdrWorkerRuntime` 패턴) 적목·클램프된 렌더 줄을 `herdr pane send-text`로 쓴다. **발행 유계:** 줄 단위 병합(coalesce), 최소 간격 250 ms, 대기 행렬 초과분은 폐기하고 마지막에 `… N lines suppressed` 마커 1줄. **수명:** 탭은 워커 start에서 생성, finish/cancel/release의 기존 cleanup 경로에서 close — 워커 수명과 정확히 동일(팩트 6의 수명 모델 재사용). **상한:** `worker_pane_limit = 4`(기본). 초과 정책: 시작 시 선착순으로 패널을 배정하고, 한도를 넘은 워커는 watch 피드로만 폴백한다. v1에서 패널 재할당 큐는 만들지 않는다. **interactive 모드 워커(HerdrAgentProvider 소유 TUI 패널)는 send-text 미러링에서 제외한다** — 패널이 이미 네이티브 화면이다.
- **수정 대상 파일:** `packages/herdr/src/client.ts`(`send-text` 래퍼 + 유계), `packages/providers/src/mirror.ts`(패널 sink — providers는 이미 `@loop/herdr` 의존이 있다), `packages/orchestrator/src/composition.ts`(sink 조립), `packages/herdr/test/*`(가짜 러너 확장).
- **대안 및 기각 이유:**
  - 워커 전체를 한 공유 "loop workers" 탭에 인터리브 → 기각. N워커 줄이 섞여 어느 워커 활동인지 판독 불가. 워커당 분리가 요구의 정신 모델이다.
  - 상한 도달 시 패널 재할당 큐 → 기각. v1 가치 대비 상태 추적·경합 비용이 크다. 상한+폴백이 지루하고 예측 가능하다.
  - 프로세스 워커를 `herdr agent start`로 전환해 네이티브 패널 획득 → 기각. 실행 모드 자체가 바뀌고 캡처 경로가 herdr을 경유하게 된다. 기계 경로 동결 위반.

### D5. 설정 게이팅 — `policy.toml [output]`의 단일 스위치, 기본 off

- **채택:** `config/policy.toml [output]`에 **단일 가시성 설정**을 둔다:

  ```toml
  [output]
  # ... 기존 다섯 키 유지 ...
  worker_visibility = "off"   # "off" | "watch" | "panes"
  worker_activity_lines = 5   # 워커당 표시 이력 줄 수 (≤ 저장 상한 8)
  worker_pane_limit = 4       # herdr 패널 동시 상한 ("panes"에서만 소비)
  ```

  `worker_visibility`가 유일한 온/오프 결정이다. `"off"`(기본)면 현 동작과 바이트 동일 — 어댑터 래핑도 이벤트 구독도 발생하지 않는다. `"watch"`는 watch 피드만, `"panes"`는 watch + herdr 패널(HERDR_* 부재 시 자동으로 watch로 폴백, 기존 fail-open 선례 `herdr-lifecycle.ts:44-56` 준수). 모든 렌더 줄은 적목 후 `line_text_limit`(160)로 클램프되고 피드 섹션은 `ui-output-limits.md`의 `… N more workers` 오버플로 규칙을 따른다. 파싱은 `LoopConfig.output` 확장으로 enum·양의 정수 검증을 거친다(`config.ts:152-164` 패턴).
- **수정 대상 파일:** `config/policy.toml`, `packages/orchestrator/src/config.ts`(enum 파서), `packages/orchestrator/test/config.test.ts`.
- **대안 및 기각 이유:**
  - providers.toml에 프로바이더별 불리언 → 기각. 설정이 N개로 늘고 가시성은 어댑터 속성이 아니라 **프레젠테이션 예산**이다. providers.toml의 역할은 어댑터 선택(command/mode/enabled)으로 유지한다.
  - 기본 on → 기각. 안전한 기본이 요구이며, `enabled = false` 기본값(`providers.example.toml:57-66`)과 fail-open 보고 선례와 일치한다. 끈 상태의 동일성이 회귀 기준선이다.

### D6. 경계·보안 규칙 (위반 금지선)

- **loop-core:** provider·herdr·pane·터미널 개념 진입 금지. 허용되는 유일한 변경은 활동 이력의 원소 개수(D3)이며, 이는 도메인 개념의 카디널리티 변경이다.
- **어댑터는 얇게:** 렌더러는 providers 안의 순수 함수, 어댑터 자체는 미러를 모른다(데코레이터가 감쌈). sink 구현(저장소 기록은 오케스트레이터, 패널 기록은 herdr 클라이언트)은 composition에서 주입한다. 어댑터가 저장소·프레젠테이션을 import하지 않는다.
- **적목:** 미러는 `redactProviderText` **하류**의 이벤트만 렌더하고(`process-provider.ts:50`), 렌더러가 직접 텍스트를 추출하는 경로(agy 델타 등)는 방어적으로 재적목한다. 패널 전송 텍스트도 동일한 적목·클램프 줄만 보낸다. 환경변수·argv·인증 자료는 렌더 줄에 절대 들어가지 않고, herdr 오류는 기존대로 2000자 클램프(`client.ts:561-571`)를 유지한다. `loop doctor` 검증 규칙 그대로 자격 증명은 어느 표면에도 새지 않는다.
- **기계 경로 동결:** `provider.result`, `extractMachineResult`, 종료 코드, 256 KB 캡처 바운드, 1 Hz activity 스로틀은 미러와 무관하게 불변이다. watch의 스냅샷 폴링·`--json` 출력도 변경하지 않는다.

## 사용자 기대에 대한 명시적 답 (요구 5)

"워커가 codex 네이티브 라이브 출력처럼 보이는가?" — **레인별 능력 매트릭스(v1, `worker_visibility` on):**

| 레인 | watch 피드에 보이는 것 | herdr 패널에 보이는 것 | 네이티브 라이브와의 거리 |
| --- | --- | --- | --- |
| **codex** (`exec --json`) | 증분 JSONL 아이템의 렌더: item started/completed, agent_message 텍스트, 라이프사이클 | 같은 렌더 줄의 워커당 패널 스트림 | **가깝다.** `--json`이 이미 증분 아이템을 갖고 있어 렌더만으로 codex의 진행을 그대로 따라간다. 단 렌더 미러이지 TTY 부착이 아니므로 인터랙티브 승인 프롬프트는 없다(승인은 `--approve-for-me`/`--sandbox` 사전 구성대로). |
| **antigravity** (persistent) | `step_update` 텍스트 델타 스트림(드라이버에 이미 존재, `subscribe` 노출만 추가) | 같은 델타의 패널 스트림 | **가장 가깝다.** 델타 자체가 스트림이다. |
| **pi** (process, `-p`) | 라이프사이클 + 캡처된 최종 결과 **만** | interactive 모드면 기존대로 pi TUI가 패널에 그대로 보임 | **제한적임을 명시한다.** `-p`는 증분 출력이 없는 pi 명세다. 스트리밍 플래그 **`--mode json`**이 존재하며 채택 시 `toolcall_*`·`text_delta`까지 보이지만, 최종 메시지 형태(`message_end`)와 종료 코드 의미가 달라지므로 기계 캡처 경로 변경을 수반한다 → 후속 결정으로 분리(D2). |
| **fake/test/zai** | 라이프사이클 + 최종 요약만 (스트림이 존재하지 않음) | 없음 | 이벤트 원천이 없는 어댑터는 미러가 침묵한다(팩트 §1.5). |

요컨대: **codex·agy 레인은 가시성 켜짐 시 실제 내부 활동이 라이브로 보이고, pi 프로세스 레인은 v1에서 라이프사이클+결과만 보인다** — 이 한계는 버그가 아니라 pi print 모드의 명세이며, 닫는 길(`--mode json`)과 그 비용(캡처 경로 매핑)을 이름과 함께 기록해 두었다.

## 구현 후속 태스크 분할 제안 (의존 순서)

1. **bridge/types 먼저:** 활동 이력 `VecDeque` + 스냅샷 타입 + `bun run codegen` + 생성 파일 커밋 (D3) → `cargo test -p loop-core`, `cargo test -p loop-bridge`.
2. **providers 미러:** 데코레이터·렌더러·agy `subscribe` 노출 + 오프라인 스크립트 러너 테스트 (D1, D6) → `cargo test -p loop-store` 불필요, `bun test packages`.
3. **composition 주입 + watch 렌더 + policy 파서** (D3, D5) → `bun run codegen:check`, `bun run test:architecture`.
4. **herdr 패널 sink + 유계** (D4) → 가짜 herdr 러너 테스트, 실제 패널 플러딩 관측은 별도 evidence.
5. **(별도 결정) pi `--mode json` 채택** (D2 후속).

## 검증 커맨드 (구현 태스크용)

```bash
cargo test -p loop-core && cargo test -p loop-bridge   # 활동 이력 리듀서·스냅샷
bun test packages                                       # 미터 렌더러·policy 파서·watch 렌더·herdr 유계
bun run codegen:check                                   # 브리지 타입 변경 동기화 증명
bun run test:architecture                               # 경계 회귀: core의 provider/pane 부재, 어댑터 얇음 유지
bun run check                                           # 전체
```

실제 herdr 패널 플러딩 계측, 실제 codex/agy/pi 로그인 상태의 라이브 관측은 유료·인증 호출이므로 별도 evidence로만 남긴다(저장소 규칙). 모든 유닛 테스트는 기존 패턴(가짜 러너 + 스크립트된 stdout JSONL, `test/adapters-v2.test.ts`)으로 오프라인 유지한다.
