# Herdr 라이브 대화 탭 — 탭 안에서 워커 에이전트의 실제 대화 TUI를 실행하는 메커니즘

- **Date:** 2026-09-24
- **Status:** decided (배치 규칙 재확정 2026-09-25 — 아래 Note 참조)
- **Kind:** decision
- **Note (2026-09-25):** 본 문서의 **배치 규칙이 재차 유효**하다: 워커마다 새 탭 1개(`tab create --no-focus`)를 만들고 그 탭의 루트 팬에서 `agent start --pane` + `agent prompt`로 실제 대화 TUI를 띄운다(분할 없음). `2026-09-24-herdr-inline-conversation-panes.md`가 배치를 분할 팬으로 대체했으나 사용자 결정(워커는 탭으로, 분할 불요)으로 회수(reverted)되어 원래 규칙이 복원되었다. 메커니즘 절(§1~§7)은 폐기된 적 없이 계속 유효하다. 런 종료 시 leftover 정리는 "이번 런이 만든 워커 탭"만을 대상으로 한다(Lead/caller 팬·워크스페이스는 보호).
- **Evidence:** `docs/design/research/herdr-live-pane-survey.md`(2026-09-25 실측 — herdr 0.8.2 / pi 0.87.1 / codex / agy 설치본 도움말·격리 워크스페이스 실측, 유료 모델 호출 없음)
- **Read scope:** `packages/herdr/src/**`, `packages/providers/src/**`, 위 조사 문서, `docs/decisions/**`

## 배경과 요구

사용자 요구: herdr 탭을 열면 pi를 직접 실행해 대화할 때와 **동일한 실시간 대화 화면**(에이전트의 인터랙티브 TUI)이 그 탭 안에서 돌아가야 한다.

현상태의 원인은 런치 메커니즘이 아니라 **설정**이다. `#launch`(`packages/herdr/src/client.ts`)의 `agent start <workerId> --kind pi|codex|agy --pane <paneId>` + `agent prompt` 경로는 실측상 이미 팬 안에서 실제 `pi` 프로세스(argv `["pi"]`)를 대화형으로 띄우고 `pane read`에 pi TUI의 푸터(모델·비용·페르소나)와 에디터 커서를 렌더링한다. 탭에 TUI가 없는 것은 현재 `providers.toml`이 헤드리스 모드(pi `process`, codex `exec`, agy `persistent`)이기 때문이며, `mode="interactive"`로 바꾸면 `buildProviderRegistry()`가 `HerdrAgentProvider`를 선택해 워커 탭에 실제 TUI가 뜬다.

### 조사에서 불가능/부적합이 확인된 배경 (이후 대안 논의의 기각 근거)

1. **M2 — `pane run`으로 실제 CLI 직접 실행**: 팬 셸에 명령을 타이핑해 띄우는 경로. TUI 렌더링 자체는 동일하지만 실측상 **관리형 이름이 붙지 않고**(`agent list`에 `name` 필드 없음), 그 팬에서 `agent start`는 영구히 `agent_pane_busy`로 막힌다. ready 계약(`interactive_ready`)과 `agent_blocked` 보호를 모두 잃어, workerName/agentName 식별자 유지라는 과제 조건과 충돌한다.
2. **M3 — 현상태(헤드리스 + 미러 팬)**: 탭에 대화 화면이 없다(미러는 수동 뷰어 + steer 릴레이 호스트). 요구 불충족.
3. **런치 인자 초기 프롬프트**(pi 위치 인자 `messages...`, codex `[PROMPT]`, agy `-i`): 가능은 하나 TUI가 프롬프트를 즉시 자동 전송해 herdr의 `agent start` ready 감지(`agent_not_ready`)와 경쟁한다.
4. **TTY 제약 실측**: codex는 비TTY에서 `stdin is not a terminal`(exit 1), agy는 bubbletea TTY open 실패(**exit 0** — 실패 판정에 exit code 금지), pi는 오류 없이 print 모드로 침묵 폴백. 세 에이전트 모두 TTY(PTY) 필수이며 herdr 팬은 PTY를 제공한다.

## 결정

### 1. 채택 메커니즘: M1 — agent 모드(interactive) 유지·활성화

`herdr agent start <workerName> --kind pi|codex|agy --pane <paneId> [-- <args...>]` + `agent prompt`의 **현행 `#launch` 구조를 채택**한다. 코드 구조 변경 없이 `providers.toml`의 `mode="interactive"` 전환으로 활성화되며, 관리형 이름 등록, `interactive_ready` 확인, `agent_blocked` 보호, lifecycle 상태(`agent get/read`)를 그대로 얻는다. Loop는 런치 메커니즘을 새로 만들지 않고, interactive 모드에서 대화 탭 계약이 성립하도록 아래 3~5절의 표면만 보강한다.

`agent_pane_busy` 초기화 경쟁은 팬 생성 직후 상시 발생 가능하므로 기존 `#startAgentWithRetry`(250ms×3, `250*(attempt+1)` 백오프)를 **그대로 유지**한다. 제거 금지.

### 2. 에이전트별 런치 명령

종류별 차이는 `visibleAgent()`가 만드는 `--` 뒤 args로만 존재하며, Loop 런치 코드에 종류별 분기를 추가하지 않는다(canonical 바이너리 선택은 herdr 소관).

| kind | 런치 명령 (pane 생성·rename은 `start()` 기존 경로) |
|---|---|
| pi | `agent start <workerName> --kind pi --pane <paneId> -- --model <modelId>` |
| codex | `agent start <workerName> --kind codex --pane <paneId> -- --sandbox workspace-write --model <modelId>` |
| agy | `agent start <workerName> --kind agy --pane <paneId> -- --sandbox --model <modelId>` |

`--tui-mode fullscreen`(또는 전체화면 UI 유발 플래그)은 금지한다. alternate screen TUI는 host scrollback에 행을 남기지 않아 `agent read`로 이력 복구가 안 된다(regular 모드 기본 유지).

### 3. 초기 프롬프트 전달: `agent prompt` 유지 (런치 인자 기각)

초기 프롬프트는 `agent start`(ready 대기 완료 후) → `agent prompt <agentName> <text>` 1회 호출로 전달한다(현행 유지). 근거: (a) 런치 인자 자동 전송은 ready 감지와 경쟁한다(배경 3); (b) `agent prompt`는 bracketed-paste를 존중해 텍스트+Enter를 TUI 에디터에 타이핑하므로 사용자에게 "직접 입력해 전송하는" 것과 동일하게 보이고, `--wait`/blocked 의미론이 이 표면에 정합한다.

- **셸 인용 불필요**: 프롬프트는 `herdr` 바이너리의 argv 한 원소로 전달된다(`NodeHerdrRunner`가 `spawn(shell:false)`). Loop가 send-keys로 조립·타이핑하지 않는 한 인용 문제는 구조적으로 없다.
- **크기 한도**: 상한은 OS argv 예산(macOS 인자당 ~256KB). 워커 프롬프트(persona+task context)는 이보다 수 배 작다. 프롬프트를 send-keys 타이핑으로 분해하는 대안은 키 인터레이스 타이밍 깨짐·차단 UI 오탐을 만들므로 채택하지 않는다. 한도 초과는 후속 결정 사항으로 남긴다(현 스코프에서 발생하지 않음).

### 4. steer(대화 입력) 전달: `agent prompt` 표면 재사용, `send-keys`는 cancel 전용

- **사용자가 탭에서 직접 타이핑**하는 것은 TUI 네이티브 동작이다(팬이 PTY를 소유). Loop 개입 없이 이미 성립하며 이것이 interactive 모드의 1급 인터랙션이다.
- **Loop의 steer 채널**(orchestrator steerRun — `loop steer`와 동일 코드, 기록·라우팅 유지)이 interactive 워커에 대화 입력을 내릴 때는 **`herdr agent prompt <agentName> <message>`**로 전달한다. 초기 프롬프트와 동일 표면이므로 새 herdr 의존 개념이 없다. 구현은 `AgentProvider`에 선택적 확장(예: `steer?(workerId, message)`)으로 추가해 기존 인터페이스를 깨지 않는다.
- **`agent send-keys`는 `ctrl+c`(cancel) 전용**으로 한정한다. 기존 `cancel()`이 이미 그렇게 쓰며, 일반 텍스트 steer에 원시 키 주입을 쓰지 않는다(2026-09-23 watch-to-steer 결정의 "날것 주입 금지" 원칙과 정합).
- **호환·폴백**: `agent prompt`는 차단 UI 중 `agent_blocked`로 사전 거부한다. 거부 시 steer는 실패로 반환되고 메시지는 기존 계약대로 run 기록에 남아 다음 시도/턴 컨텍스트에 반영된다(원샷 레인 폴백과 동일).
- **watch-to-steer 릴레이 존치 범위**: 릴레이는 팬의 포그라운드 프로세스 자리를 요구하므로(`pane run`과 `agent start` 상호배타) interactive 워커 탭에는 부착되지 않는다. 릴레이+미러 팬은 **헤드리스 워커 전용** 표면으로 존치한다(composition의 interactive 미러 `excluded` 유지).

### 5. 워커 상태 폴링: `agent get` 폴링 유지 + 소실 시 팬 관찰 폴백

- 1차: `agent get <agentName>`의 `agent_status` 폴링(현행 `HerdrAgentProvider.#wait`, 250ms 기본, 시작 유예 5s). herdr 측 블로킹 대기(`agent wait`)로의 전환은 기각 — 폴링이 기존 fake-runner 테스트 봉합과 일치한다.
- **agent 기록 소실 시**(already-gone: `not_found`/`not_running`): `pane get <paneId>`로 폴백 관찰한다. `status()`가 이미 파싱하는 `result.pane.agent_status`/`state` 필드를 재사용하며, `exited`→`completed` 매핑(`mapState`)이 이를 흡수한다. 이것이 "팬 프로세스 종료 감지" 대안이다.
- 팬/탭까지 소실(`tab_not_found`/`pane_not_found`): 종료 확정으로 처리(현행 `isAlreadyGone` → `completed` 계약 유지). 최종 요약은 `agent read`(스냅샷)로 확정한다.
- TUI 렌더링은 스냅샷일 뿐 전사가 아니므로 `agent read`는 뷰포트 근사값이다. 프로그램적 요약 품질 한계는 수용한다(사용자에게는 실제 TUI가 보인다).

### 6. TTY·미러 팬·헤드리스 모드 존치

- **TTY**: 팬(PTY) 안에서만 워커를 띄우므로 세 에이전트 모두 TUI 가능. pi 침묵 폴백(비TTY → print 모드, exit 0)은 팬 밖 회귀를 조용하게 만드므로, interactive 모드의 건강 신호는 `agent get`의 `interactive_ready`로 한정한다(테스트·런타임 모두 exit code나 stdout 유무로 판정 금지 — agy exit 0 함정).
- **헤드리스 모드(process/exec/persistent) 존치**: (a) 사용자가 명시적으로 선택한 실행 형태(현재 `~/.config/loop/providers.toml`); (b) 미러 팬+steer 릴레이의 존재 이유; (c) 모드 분기는 이미 `buildProviderRegistry()`에 있어 코드 추가 없음. 본 결정은 interactive를 "탭=실시간 대화" 요구의 정답으로 확정할 뿐 헤드리스를 폐기하지 않는다.
- **미러 팬 존치**: 헤드리스 워커 가시성 표면으로 유지. interactive 워커는 미러 제외(이중 표면 방지, 팬 상호배타 제약).

### 7. 식별자 유지

`workerName`(`loop-<taskId>` 규칙, 32자 해시 절단)이 `agent start`의 1번 인자이자 handle의 `agentName`인 현행 계약을 그대로 유지한다. 라우팅(registry→loop-core 결정), 표시 라벨(`<taskId>·<kind>·a<attempt>`), caller 앵커링(2026-09-24 결정) 모두 무변경.

## 대안 및 기각 이유 (요약)

| 대안 | 기각 이유 |
|---|---|
| M2 `pane run` + 실제 CLI 플래그 | 관리형 이름·ready 계약·`agent_blocked` 상실, `agent start`와 상호배타, 릴레이와 팬 공유 불가 → 식별자 유지 요구 위반 |
| 런치 인자 초기 프롬프트(pi 위치/codex `[PROMPT]`/agy `-i`) | ready 감지 경쟁(`agent_not_ready`), lifecycle 의미론이 `agent prompt`에 집중 |
| steer를 `agent send-keys` 텍스트 타이핑 | 원시 키 주입 금지 원칙 위반, bracketed-paste/차단 보호 상실, 기록 경로 이중화 |
| `agent wait` 블로킹 폴링 전환 | fake-runner 테스트 봉합 변경 대비 이득 없음 |
| 헤드리스 + 미러 팬(M3) 유지 | 탭에 대화 화면 부재 — 요구 자체를 불충족 |

## 수정 대상 파일 (구현 태스크 범위)

- `packages/providers/src/**`: `AgentProvider` 선택적 steer 확장, `#wait`/`status`의 already-gone→`pane get` 폴백 보강.
- `packages/herdr/src/**`: 폴백 경로에 필요한 최소 클라이언트 보강(구조 변경 없음, `#launch`·`#startAgentWithRetry` 유지).
- `packages/orchestrator/src/**`(composition): interactive steer 전달 배선. `providers.toml` 예시(config/)에 interactive 모드 주석 유지.
- Rust 변경 없음. 생성 프로토콜 변경 없음.

## 테스트 전략 (유료 모델 호출·실제 에이전트 프로세스 불요)

기존처럼 `HerdrRunner` fake 주입으로 검증한다. `packages/herdr/test/lifecycle.test.ts`가 `agent start … --pane` + `agent prompt` 호출열을 이미 고정하며, 다음을 추가 고정한다:

1. **런치 명령**: interactive args(pi/codex/agy별 `--` 뒤 args)가 종류별로 그대로 `agent start` argv에 반영되는지 — providers 패키지의 fake runtime/provider 테스트.
2. **steer 전달**: steer가 `agent prompt <agentName> <message>` 1회 호출로 이어지는지, `agent_blocked` 거부 시 기록 유지 폴백인지 (fake runner 스크립트).
3. **상태 폴백**: `agent get` already-gone → `pane get` → `exited`→`completed` 체인, 탭 소실 시 종료 확정.
4. **재시도 계약**: `agent_pane_busy` 재시도(`#startAgentWithRetry`) 유지 회귀(기존 커버 유지).
5. **TTY 부재 시나리오는 단위 테스트에서 모사하지 않는다**(pi 침묵 폴백 등은 실측 문서로 대체 — 실제 프로세스 구동은 수동 검증 증거로 분리).

## 결과 요약 (구현 태스크 전달)

- **채택**: M1 — `mode="interactive"` + 기존 `agent start --pane` / `agent prompt` 런치 구조 유지, 코드는 표면 보강만.
- **에이전트별 런치**: pi `-- --model <id>`, codex `-- --sandbox workspace-write --model <id>`, agy `-- --sandbox --model <id>`; fullscreen 금지; `agent_pane_busy` 재시도 유지.
- **프롬프트/steer**: 초기 프롬프트 = `agent prompt`(런치 인자 기각); 사용자 직접 타이핑 = TUI 네이티브; Loop steer = `agent prompt` 전달(agent_blocked 시 기록 폴백), `send-keys`는 ctrl+c 전용.
- **상태**: `agent get` 폴링 유지, 기록 소실 시 `pane get` 폴백, 탭 소실 시 종료 확정, 요약은 `agent read` 스냅샷.
- **식별자**: workerName/agentName/라벨/caller 앵커링 전부 무변경.

## 리스크

- **pi 침묵 폴백 회귀**: interactive인데 팬 밖에서 띄워지면 오류 없이 헤드리스로 진행된다. `interactive_ready` 관찰이 유일한 건강 신호 — 폴백 상태 폴백(5절)과 함께 구현 태스크에서 단언할 것.
- **steer와 TUI 상태 경합**: 에이전트가 working 중일 때 `agent prompt` 타이핑이 에디터에 큐잉되는 동작은 에이전트별로 다를 수 있다. `agent_blocked` 폴백 계약으로 흡수하지만, 실제 TUI에서의 사용성은 수동 검증 필요.
- **`agent read` 근사값**: 프로그램적 요약이 TUI 뷰포트로 한정된다. 정밀 전사가 필요해지면 별도 결정(herdr upstream 기능 의존).
- **argv 프롬프트 한도**(macOS ~256KB/인자): 초과 프롬프트 체계는 미결(현 스코프 외).
