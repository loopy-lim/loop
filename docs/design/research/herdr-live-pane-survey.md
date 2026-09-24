# herdr 라이브 팬 조사: 워커 탭에 실제 대화 TUI 띄우기

- 날짜: 2026-09-25
- 범위: `packages/herdr/src/**`, `packages/herdr/test/**`, `packages/providers/src/**`
- 증거 수집: 설치본 CLI 도움말 직접 실행(herdr 0.8.2, protocol 20 / pi 0.87.1 / codex / agy), 실행 중인 herdr 서버에 격리 워크스페이스를 만들어 `agent start`·`pane run`·`pane read`를 실측 후 폐기, 바이너리 번들 소스 관찰. 유료 모델 호출 없음(프롬프트 미전송).

## 결과 요약 — 실현 가능한 메커니즘과 핵심 제약 3개

**결론: `herdr agent start <NAME> --kind pi|codex|agy --pane <ID>`는 이미 "탭 안의 실제 대화 TUI"를 만든다.** 실측에서 이 명령은 팬 안에서 실제 `pi` 프로세스(`argv: ["pi"]`)를 대화형으로 띄웠고, `pane read`로 읽은 팬 화면에 pi TUI의 푸터(모델·비용·페르소나)와 에디터 커서가 그대로 렌더링됐다. 즉 "agent 모드라서 TUI가 안 보인다"는 성립하지 않으며, 실제 원인은 **현재 Loop 설정이 팬 없는 헤드리스 모드(`pi mode="process"`, `codex mode="exec"`, `antigravity mode="persistent"`)로 실행 중**이라는 점이다. `mode="interactive"`로 전환하면 `HerdrAgentProvider`가 선택되어 워커 탭에 실제 TUI가 뜬다(`config/providers.example.toml` 주석도 이 분기를 명시한다).

가능한 메커니즘 세 가지:

1. **M1 — agent 모드 유지(권장)**: `agent start --pane` + `agent prompt`. 실제 TUI가 탭에 렌더링되고, 관리형 이름·`interactive_ready` 확인·`agent_blocked` 보호·lifecycle 상태(`agent get/read/wait`)를 그대로 얻는다. workerName/agentName 식별자와 라우팅 유지에 추가 코드가 필요 없다.
2. **M2 — `pane run`으로 실제 CLI 실행**: 팬 셸에 명령을 타이핑해 pi/codex/agy를 띄우는 경로. TUI 렌더링과 herdr의 에이전트 자동 감지(manifest 기반)는 동일하게 일어나지만, **관리형 이름이 붙지 않고**(실측: `agent list`에 `name` 필드 없음) `agent start` 재사용이 `agent_pane_busy`로 막힌다. lifecycle 추적과 차단 보호를 모두 잃으므로 Loop의 요구(workerName/agentName 유지, 상태 폴링)와 맞지 않다.
3. **M3 — 헤드리스(process/exec/persistent) + 미러 팬**: 현상태. 팬에는 워커 TUI가 없고, 미러 팬(`createPane`)은 프로세스 없는 수동 뷰어 + steer 릴레이 호스트(`pane run`으로 릴레이를 띄우고 `send-text`로 한 줄 JSON 프레임을 전송)다. 탭에 "대화 화면"은 없다.

**핵심 제약 3개:**

1. **TTY(PTY) 필수 — 단, pi만 침묵 폴백**: TUI는 TTY를 요구한다. 실측: `codex < /dev/null` → `Error: stdin is not a terminal`(exit 1), `agy -i < /dev/null` → `bubbletea: could not open TTY`(단 **exit 0** — 실패 판정에 exit code를 쓰면 안 된다). pi는 `stdin.isTTY && stdout.isTTY`가 아니면 오류 없이 조용히 print 모드로 폴백한다(번들 소스 `getCommandAppMode`). herdr 팬은 PTY이므로 세 에이전트 모두 TUI 가능하지만, 팬 밖 래퍼·테스트 하니스에서 pi는 "조용한 헤드리스"로 빠져 TUI 부재가 조용히 묻힐 수 있다.
2. **팬 하나 = 포그라운드 프로세스 하나**: `agent start`는 팬이 "대화형 셸 프롬프트" 상태일 때만 성공하고(포그라운드 프로세스 존재 시 `agent_pane_busy: ... is not an available shell` — 실측 및 `client.ts` 재시도 로직), `pane run`과 `agent start`는 같은 팬에서 상호배타다. 워커 TUI 팬에 steer 릴레이를 같이 호스팅할 수 없으므로 watch-to-steer는 미러 팬 쪽에만 성립한다(현재 `composition.ts`도 interactive 워커를 미러 `excluded`로 뺀다).
3. **TUI 렌더링은 스냅샷일 뿐, 전사(转录)가 아니다**: TUI는 화면을 지우고 다시 그린다. `herdr pane/agent read`는 스냅샷 소스(`visible/recent/recent-unwrapped/detection`)를 읽을 뿐이고, alternate screen 풀스크린 TUI의 행은 host scrollback에 들어오지 않아 `read`로 대화 전문을 복구할 수 없다(pi `--tui-mode fullscreen` 사용 시 해당). 탭에서 "사용자가 보는 것"은 실제 TUI가 맞지만, Loop가 프로그램적으로 읽는 `agent read` 텍스트는 TUI 뷰포트의 근사값이다.

---

## 1. Loop의 herdr 구동 실상

### 1.1 호출 구조

- 바이너리: `#command = "herdr"`(기본값, `PATH`에서 해석 — 실측 `/Users/loopy/.local/bin/herdr`). 모든 제어는 `NodeHerdrRunner.run()`이 `spawn("herdr", args)`로 수행한다(`packages/herdr/src/client.ts`). stdin은 `ignore`, stdout/stderr 파이프, 15초 타임아웃(124 반환).
- 응답 규약: `#run()`은 exit 0일 때 stdout을 JSON envelope로 파싱하고, 0이 아니면 stderr/stdout의 `{error:{code,message}}`를 `redact()`한 메시지로 던진다. 예외적으로 `read` 계열은 raw 텍스트를 반환한다.
- 호출자 앵커: `herdrCallerFromEnvironment()`가 `HERDR_PANE_ID=<workspaceId>:<paneId>`에서 caller를 만든다. 있으면 워커 탭이 caller 워크스페이스의 형제 탭으로 들어가고, 없으면 `loop-<runId>` 워크스페이스를 만든다.

### 1.2 워커 시작 경로 (`start()` → `#launch()`)

```text
start():
  tab create --workspace <ws> --cwd <worktree> --label <label> --no-focus
  pane rename <paneId> <label>
  #launch():
    execution.type === "agent":
      agent start <workerId> --kind pi|codex|agy --pane <paneId> [-- <args...>]
      agent prompt <workerId> <prompt>        # 프롬프트가 있으면
    execution.type === "command":
      pane run <paneId> <command> <args...>
```

- `agentName`은 `execution.type === "agent"`일 때만 handle에 설정되고, 이후 `status/read/cancel`이 `agent get/read/send-keys`로 향한다. command 실행은 `pane get/read/send-keys`를 쓴다.
- `#startAgentWithRetry()`는 herdr가 새 팬 초기화 직후 반환하는 `agent_pane_busy`를 250ms 간격 최대 3회 재시도한다(실측 재현: 포그라운드 프로세스가 있는 팬에 `agent start` → `{"error":{"code":"agent_pane_busy","message":"agent target pane w4P:p2 is not an available shell"}}`).

### 1.3 프로바이더 조립 — "탭에 TUI가 없는" 실제 원인

`packages/orchestrator/src/composition.ts`의 `buildProviderRegistry()`는 `providers.toml`의 `mode`로 분기한다:

| mode | pi | codex | antigravity(agy) | 팬/TUI |
|---|---|---|---|---|
| `interactive` | `HerdrAgentProvider(kind=pi)` | `HerdrAgentProvider(kind=codex)` | `HerdrAgentProvider(kind=agy)` | **워커 탭에 실제 TUI** |
| `process` | `PiProvider`(헤드리스) | — | — | 없음 |
| `exec` | — | `CodexProvider`(헤드리스) | — | 없음 |
| `persistent` | — | — | `AgyPersistentProvider`(stream-json 파이프) | 없음 |

- `visibleAgent()`가 interactive일 때 args를 구성한다: pi `["--model", id]`, codex `["--sandbox","workspace-write","--model",id]`, agy `["--sandbox","--model",id]`. 이 args는 `#launch`에서 `--` 뒤에 붙어 `agent start`로 전달된다.
- **현재 사용자 설정**(`~/.config/loop/providers.toml`, 2026-09-23 pi-only 전환): `[providers.pi] mode="process"`, `[providers.codex] mode="exec"`, `[providers.antigravity] enabled=false, mode="persistent"`. → 어떤 워커도 herdr 팬에서 실행되지 않는다. 워커 가시성이 켜져 있으면 `PaneMirrorSink`가 `createPane()`으로 만든 미러 팬에 텍스트 라인만 보낸다.
- 참고로 `config/providers.example.toml`은 이미 `[providers.pi] mode="interactive"`를 예시로 보여주며 주석에 "interactive면 Herdr 탭에서 pi TUI가 보이고, process면 `pi -p` 헤드리스로 돈다"고 명시한다.

### 1.4 미러 팬과 steer 릴레이 (`createPane`/`sendText`/`runInPane`)

- `createPane()`은 **프로세스 없는 수동 팬**을 `mirror·<taskId>` 라벨로 만든다(`tab create --no-focus` + `pane rename`).
- `sendText()`는 `pane send-text`로 리터럴 텍스트를 팬에 쓴다(도움말: "Send literal text to a pane ... next: `herdr pane run` sends text and Enter in one call").
- `runInPane()`은 `pane run <paneId> <command> <args...>`로 **팬의 프로세스 자리에 명령을 띄운다**. 현재 용도는 steer 릴레이 호스팅뿐(`relay.ts`): 릴레이가 팬의 포그라운드 프로세스가 되어 stdin에 들어온 줄을 steer 메시지로 전달하고, 미러 표시줄은 한 줄 JSON 프레임으로 구분한다. 팬이 닫히면 stdin EOF로 릴레이도 끝난다(lifetime = pane lifetime).
- 즉 미러 팬은 대화 TUI가 아니라 "텍스트 꼬리표 + 릴레이 채널"이며, `pane run`을 워커 에이전트 실행에 쓸 경우(M2) 릴레이와 같은 팬을 공유할 수 없다(제약 2).

## 2. `agent start --pane` 팬에서 실제로 렌더링되는 것 (실측)

격리 워크스페이스(`herdr workspace create --cwd <repo> --label loop-survey-research --no-focus` → `w4P`)에서 실측:

```console
$ herdr agent start loop-survey-pi --kind pi --pane w4P:p1
{"result":{"agent":{"agent":"pi","agent_status":"idle","interactive_ready":true,
 "name":"loop-survey-pi","pane_id":"w4P:p1","terminal_title_stripped":"π - loop", ...},
 "argv":["pi"],"type":"agent_started"}}

$ herdr pane read w4P:p1 --lines 25
(빈 행들 — 트랜스크립트 영역)
──────────── (구분선)
──────────── (구분선)
~/dev/ll3/loop (main)
$0.000 (sub) 0.0%/272k (auto)          (openai-codex) gpt-5.5 • medium
🎭 아키텍트 (auto)
```

- `argv:["pi"]`: herdr가 종류별 canonical 실행 파일을 팬 안에서 직접 띄운다. `terminal_title`이 `π - loop`로 바뀌고, `pane read`에 pi TUI의 푸터(모델/비용/컨텍스트/페르소나)와 에디터 커서(ANSI 역상 스페이스)가 렌더링된다. **관리형 에이전트 뷰가 아니라 실제 TUI다.**
- `interactive_ready:true` + `agent_status:"idle"`: herdr는 "expected agent가 같은 터미널에서 감지되고 입력 준비가 끝날 때까지" `agent start`를 블록한다(`agent start --help`, 기본 30초, `--timeout` 최대 300초).
- 감지 규칙은 manifest 기반이다: `herdr agent explain loop-survey-pi` → `agent: pi / state: idle / manifest: .../agent-detection/remote/pi.toml / rule: none / fallback_reason: default_known_agent_idle_fallback`.

### 2.1 `pane run`과의 차이 (실측)

```console
$ herdr pane run w4P:p2 pi        # 팬 셸에 "pi" + Enter 타이핑
$ herdr agent list                # 3초 후
{"agent":"pi","agent_status":"idle","pane_id":"w4P:p2", ...}   # name 필드 없음!
$ herdr agent start loop-survey-p2 --kind pi --pane w4P:p2
{"error":{"code":"agent_pane_busy","message":"agent target pane w4P:p2 is not an available shell"}}
```

- `pane run`으로 띄운 pi도 같은 TUI를 렌더링하고 herdr가 manifest로 자동 감지해 `agent list`에 오른다. 단 **관리형 이름이 없고**(`agent start` 결과와 달리 `name`/`interactive_ready` 부재), `agent start`는 그 팬에서 더 이상 불가능하다.
- herdr 문서(스킬)상 agent 명령은 "unique live agent name 또는 에이전트를 호스팅 중인 pane ID"를 받으므로 감지된 팬 ID로 `agent read/prompt`를 보낼 수는 있지만, Loop의 workerName 기반 세션 관리(resume handle, `agentName` 식별자)와는 맞지 않는다.
- `pane send-keys <pane> ctrl+c`(raw 키)와 `agent send-keys <name> ctrl+c`(이름 기반, 키 검증 후 일괄 기록)의 차이도 같은 맥락: agent 표면은 차단 UI 감지(`agent_blocked`)와 lifecycle을 함께 제공한다.

### 2.2 초기 프롬프트 전달: `agent prompt` vs 런치 인자

- 현재 Loop: `agent start`(ready 대기) → `agent prompt <name> <text>`. `agent prompt --help`: bracketed-paste를 존중해 텍스트+Enter를 보내고, 차단 UI 중이면 `agent_blocked`로 사전 거부, `--wait`는 관찰된 상태 전환(idle/done/blocked)까지 대기. 사용자가 탭을 보면 프롬프트가 TUI 에디터에 "타이핑되어 전송되는" 것과 동일하게 보인다.
- 런치 인자로 초기 프롬프트를 주는 것도 가능은 하다(pi/codex는 위치 인자, agy는 `-i`, §3 참조). 그러나 TUI가 초기 프롬프트를 즉시 자동 전송하면 에이전트가 ready 대기 중 `working`으로 넘어가 herdr의 `agent start` ready 감지와 경쟁할 수 있고(`agent start --help`의 `agent_not_ready` 경로), `--wait` 수명주기 추적도 `agent prompt` 쪽이 정합적이다. 권장: **`agent prompt` 유지**(현행 `#launch` 설계 유지).

## 3. pi / codex / agy 인터랙티브 TUI + 초기 프롬프트 (설치본 증거)

세 에이전트 모두 "기본 인터랙티브 + 위치 인자/플래그로 초기 프롬프트"를 지원한다.

### pi 0.87.1

```console
$ pi --help
Usage: pi [options] [--] [@files...] [messages...]
  --print, -p    Non-interactive mode: process prompt and exit
  --tui-mode <mode>  TUI mode: regular (default) or fullscreen
```

- 기본이 인터랙티브 TUI이고 위치 인자 `messages...`가 초기 프롬프트다. 인터랙티브 경로는 `InteractiveMode` 생성자에 `initialMessage/initialMessages`를 넘기고 `init()`에서 `session.prompt(...)`로 **자동 전송**한다(번들 `dist/bundle/chunks/chunk-OJP47DM6.js`: `initialMessage&&await session.prompt(initialMessage,{images:initialImages})`, `initialMessages)for(let message of initialMessages)try{await this.session.prompt(message)}`).
- TTY 판정: `getCommandAppMode(){return process.stdin.isTTY&&process.stdout.isTTY?"interactive":"print"}` — **비TTY에서 오류 없이 print 모드로 침묵 폴백**(실측: `pi --model gpt-5.3-codex-spark < /dev/null` → 출력 없이 exit 0).
- 정리: `pi --model <id> "<프롬프트>"` = TUI + 자동 전송. `-i`/`--prompt-interactive` 플래그는 없다(위치 인자가 그 역할).

### codex

```console
$ codex --help
Usage: codex [OPTIONS] [PROMPT]
If no subcommand is specified, options will be forwarded to the interactive CLI.
  [PROMPT]  Optional user prompt to start the session
$ codex < /dev/null
Error: stdin is not a terminal        (exit 1)
```

- 서브커맨드 없이 `codex "<프롬프트>"` = 인터랙티브 TUI + 세션 시작 프롬프트. 비TTY는 하드 오류다.

### agy

```console
$ agy --help
  -i                    Short alias for --prompt-interactive
  --prompt-interactive  Run an initial prompt interactively and continue the session
  -p / --print          Run a single prompt non-interactively and print the response
$ agy -i "..." < /dev/null
CLI error: bubbletea: error opening TTY: bubbletea: could not open TTY: open /dev/tty: device not configured
```

- `agy -i "<프롬프트>"` = TUI 진입 + 초기 프롬프트. 비TTY에서 bubbletea(TUI 프레임워크)가 TTY open에 실패하며 죽는데, **exit code는 0**이었다 — 성공 판정은 출력/프로세스 관찰로 해야 한다.

### TTY 정리

| 바이너리 | 비TTY stdin 동작 | exit |
|---|---|---|
| pi | 오류 없이 print 모드로 폴백 | 0 |
| codex | `stdin is not a terminal` 하드 오류 | 1 |
| agy | bubbletea TTY open 실패 | 0 (주의) |

herdr 팬은 PTY를 준다(실측에서 세 조사 모두 팬 안에서 TUI 구동 성공). 따라서 어느 메커니즘(M1/M2)이든 TUI 요구사항은 충족된다.

## 4. 결론과 권고

- "탭 안에서 실제 대화 TUI"의 정답은 **M1: `agent start --kind pi|codex|agy --pane` (interactive mode)** 이다. 이 경로는 이미 실제 에이전트 프로세스의 TUI를 팬에 렌더링하며, herdr가 이름 등록·ready 확인·lifecycle·차단 보호를 대행한다. Loop의 `HerdrWorkerRuntime.start()`/`#launch()`와 `HerdrAgentProvider`는 이 메커니즘의 올바른 클라이언트이며, 구조 변경 없이 **설정(`providers.toml`의 `mode="interactive"`) 전환**으로 활성화된다.
- M2(`pane run`으로 실제 CLI 실행)는 기술적으로 가능하지만 관리형 이름·ready 계약·`agent_blocked` 보호를 포기해야 하고 `agent start`와 상호배타다. watch-to-steer 릴레이와도 팬을 공유할 수 없다. Loop의 식별자/라우팅 요구를 유지해야 한다는 과제 조건과 충돌한다.
- 초기 프롬프트는 현행대로 시작 후 `agent prompt`로 주는 것이 herdr의 lifecycle 의미론(wait/until/blocked)과 맞고, 런치 인자 자동 전송 경로(pi 위치 인자, codex `[PROMPT]`, agy `-i`)는 ready 감지와 경쟁한다.
- 단위 테스트는 기존처럼 `HerdrRunner` fake로 검증한다(`packages/herdr/test/lifecycle.test.ts`가 `agent start → agent prompt → agent get/read/send-keys` 호출열을 이미 고정). 실제 프로세스·유료 호출 불요 — 이번 실측도 프롬프트 없이 TUI 기동만으로 수행했다.

### 위험/유의점

- **pi 침묵 폴백**: 팬 밖(파이프)에서 pi를 "인터랙티브" 의도로 띄우면 오류 없이 print 모드로 간다. TUI 가시성이 깨지는 회귀는 "오류"가 아니라 "조용한 헤드리스"로 나타나므로, interactive 모드에서는 팬 안 `agent get`의 `interactive_ready` 확인이 유일한 건전성 신호다.
- **agy exit 0 관습**: 실패해도 exit 0. 가용성 프로브(`--version`)와 상태 판정에 exit code만 쓰지 않도록 주의.
- **alternate screen**: pi `--tui-mode fullscreen`(또는 다른 에이전트의 전체화면 UI)은 행이 host scrollback에 남지 않아 `agent read`로 이력 복구가 안 된다. interactive 워커에서는 기본 `regular` TUI 모드를 유지할 것.
- **`agent_pane_busy` 경쟁**: 팬 생성 직후 `agent start`가 초기화 지연으로 거부될 수 있다. `#startAgentWithRetry()`(250ms×3)가 이미 있으며 유지 필요.
