# Persona·TODO Lead UX — 변경 범위·방식 결정

- **Date:** 2026-09-22
- **Status:** decided
- **Kind:** decision
- **Read scope:** `packages/cli/src/main.ts`, `packages/pi-loop/src/**`, `pi-extensions/**`
- **Write scope:** 이 결정 문서. 구현은 후속 태스크에서 아래 "수정 대상 파일"대로 진행.
- **근거:** 팩트 조사 `facts-run-visibility`, `facts-ui-colors` + 저장소 코드 재검증

## 배경 팩트 (결정의 전제)

1. **DAS run은 단일 agent 턴 안의 `loop_run` 툴 execute에서 일어난다.** `packages/pi-loop/src/extension.ts`의 `loop_run.execute`가 `currentRunId`를 설정하고 `backend.run()` 완료 후 notify한다. pi-loop가 타입한 이벤트는 herdr lifecycle 4종(`session_start|agent_start|agent_end|session_shutdown`, `herdr-lifecycle.ts`)과 `before_agent_start`뿐이라, **run 시작/종료를 알리는 이벤트가 존재하지 않는다** (facts-run-visibility 핵심 격차).
2. **pi 자체는 대안 훅을 제공한다.** `tool_execution_start/update/end`(toolName 포함), 확장 간 통신용 `pi.events` 버스(`pi.events.on/emit`), 상태 영속화용 `pi.appendEntry(customType, data)`가 모두 공개 API다.
3. **todo 위젯 색상은 이미 전부 Theme 토큰이다.** `pi-extensions/todo-widget.ts`는 `theme.fg('accent'|'warning'|'success'|'dim'|'muted'|'text'|'toolTitle'|'error'|'borderMuted', …)`만 사용 (facts-ui-colors 표). 반면 persona 푸터는 `ctx.ui.setStatus(key, plainText)`이며, 이 API는 색상·토큰을 받지 않는다(문자열만).
4. **shift+enter는 pi의 기본 바인딩이다.** `tui.input.newLine = shift+enter, ctrl+j`, `tui.input.submit = enter` (pi docs keybindings.md). 터미널별 차이는 pi docs terminal-setup.md가 정규 해법(Terminal.app 폴백은 pi 내장, tmux는 remap, VS Code ≥ 1.109.5 무설정)을 제공한다.
5. **확장은 pi 프로세스에서만 로드된다.** Lead(pi + loop 확장)와 pi 워커(`pi --no-session -p …`, `packages/providers/src/pi/adapter.ts`)에는 persona·todo가 적용된다. z.ai 기본 라인은 이 pi 워커 레인이다. 반면 codex(`codex exec --json`), antigravity(`agy --print`), zai CLI(`zai --prompt`) 어댑터는 provider CLI를 직접 실행하며 **확장 호스트가 없다**.

## 결정

### D1. 상태줄·위젯 색상/테마 토큰 — **유지** (문서화만)

- todo 위젯은 이미 활성 테마를 추종한다(팩트 3). pending>0 ⇒ `warning`, 전부 완료 ⇒ `success` 헤더와 항목별 `dim/accent/text`는 의미론적으로도 일관적이다. persona 푸터는 `setStatus`가 plain text만 지원하므로 plain text가 유일한 정상 경로다(🎭 접두어로 식별).
- **수정 대상 파일:** 없음(코드 변경 없음). `pi-extensions/README.md`에 토큰 사용 표를 1회 정리.
- **대안 및 기각 이유:**
  - persona 상태를 `ctx.ui.setFooter` 팩토리로 교체해 `theme.fg` 색상 적용 → 기각. 빌트인 푸터 전체를 대체하는 높은 파급력 대비 얻는 것은 색 하나이며, herdr·다른 확장 상태와의 공존 관리 비용이 과대하다.
  - todo 위젯에 ANSI/hex 하드코딩 → 기각. 테마 추종을 깨고 pi 토큰 체계를 이중화한다.
- **테스트 전략:**
  - *색상 가드*: pi-extensions 전체에서 ANSI 이스케이프·16진 색상 코드 부재를 단언하는 grep 체크(스크립트화). "모든 색이 theme 토큰을 경유한다"를 단언.
  - *widgetLines 토큰 단언*: `widgetLines(todos, fakeTheme)`에 호출을 기록하는 가짜 theme를 넣어 pending>0 ⇒ `warning`/전부 완료 ⇒ `success`, 항목행 `dim+accent+text`, 완료 요약 `dim`을 단언. 순수 함수이므로 pi 런타임 불필요.

### D2. codex/z.ai/antigravity에서의 persona·todo — **유지(pi 전용) + 적용 범위 문서화**

- z.ai 라인은 pi 워커 어댑터 경유라 이미 적용된다: 확장은 pi 프로세스에서 자동 로드되고, headless에서 `notify/setStatus/setWidget`은 `ctx.hasUI` 가드로 no-op이지만 `before_agent_start` 시스템 프롬프트 주입과 `todo` 툴은 유효하다. codex·agy·zai CLI는 확장 호스트가 없는 provider CLI이므로, 이들 워커에 대한 역할 지시는 **기존 채널인 TaskSpec requirements로만** 전달한다(Lead가 이미 requirements에 역할 맥락을 기술).
- **수정 대상 파일:** `pi-extensions/README.md`(어댑터별 적용 범위 매트릭스: Lead ✓ / pi 워커 ✓(headless, UI 비표시) / codex·agy·zai CLI ✗).
- **대안 및 기각 이유:**
  - `buildWorkerPrompt`에 persona 주입, 어댑터에 extension/system-prompt 후크 추가 → 기각. provider 어댑터가 pi 확장 개념을 알게 되는 경계 위반이고, persona 영속화는 pi 세션 엔트리(`persona-state`)에 의존해 이식 불가능하며, pi `before_agent_start`의 중복 구현이다.
  - 비-pi 워커용 todo 상태 파일 미러링 → 기각. 상태 이중화·파일 경합을 만들고, 세션 브랜치 재구성(`getBranch()` 스캔) 보장을 깬다. UI가 없는 워커에는 위젯 자체가 무의미하다.
- **테스트 전략:** 신규 테스트 없음. 기존 `packages/providers/test/adapters-v2.test.ts`가 pi 레인 argv에 `-p`를 포함함을 이미 단언한다(= 프롬프트 주입 경로 유지 증거). 문서 매트릭스는 리뷰로 검증. 실제 provider 로그인 상태에서의 동작은 유료 호출이므로 별도 evidence로만 남긴다(저장소 규칙 준수).

### D3. shift+enter(개행 vs 전송) — **유지** (코드 변경 없음, 수동 검증)

- 요구 동작(enter=전송, shift+enter=개행, ctrl+j 별칭)은 pi 기본 바인딩으로 이미 충족된다(팩트 4). 입력 처리는 pi의 소유이며 Loop·확장이 관여할 지점이 없다.
- **수정 대상 파일:** 없음.
- **대안 및 기각 이유:**
  - 확장에서 keybinding 재정의 → 기각. 상류 기본값과의 드리프트를 만들 뿐 요구를 이미 충족하는 동작을 바꾼다.
  - Loop 자체 입력 처리 → 기각. pi TUI 위임 구조를 깨는 경계 위반.
- **테스트 전략:** 자동 테스트 없음(TTY 하네스가 필요하고 터미널 에뮬레이션으로는 pi의 수정자 폴백을 재현할 수 없음). pi docs terminal-setup.md의 터미널별 체크리스트(Terminal.app, tmux, VS Code, WezTerm)로 **수동 검증**을 수행하고 결과를 기록: enter 즉시 전송, shift+enter 개행 삽입, ctrl+j 대체 개행.

### D4. Loop 실행(DAS) 중 /todos 위젯 표시 — **수정** (이벤트 버스 계약 도입)

- run 경계는 툴 execute 내부에 있으므로(팩트 1), pi-loop가 run 시작/진행/종료를 **pi.events 버스로 발행**하고 todo 위젯이 이를 반영한다. 단일 발행자(pi-loop)·단일 구독자(todo-widget) 구조로, todo-widget은 Loop 모듈을 import하지 않고 이벤트 이름 계약만 안다.
- **방식:**
  - `loop_run.execute` 시작 시: `pi.events.emit("loop:run-start", { runId, tasks: [{ id, title }] })` + `pi.appendEntry("loop-run-tasks", { runId, tasks })`(세션 재시작·`/tree` 복원용).
  - `onProgress` 스냅샷마다: `pi.events.emit("loop:run-progress", { runId, doneTaskIds })`.
  - run 종료 시: `pi.events.emit("loop:run-end", { runId, status })` — 위젯 루프 구간을 최종 상태(완료 ✓/미완 ×)로 고정. 새 run-start가 이전 루프 구간을 대체.
  - `pi-extensions/todo-widget.ts`: 세 이벤트 구독 + `reconstructState`가 `getBranch()`에서 `loop-run-tasks` 커스텀 엔트리를 추가 스캔. 위젯(에디터 위)과 `/todos` 오버레이 모두에 todos 뒤에 "Loop run" 구간을 렌더.
- **수정 대상 파일:** `packages/pi-loop/src/extension.ts`(`PiExtensionApi`에 `events`, `appendEntry` 추가 + 발행), `pi-extensions/todo-widget.ts`(구독·재구성·렌더), `packages/pi-loop/test/lead.test.ts`(fakePi 확장), `pi-extensions/README.md`(이벤트 계약·페이로드 문서).
- **대안 및 기각 이유:**
  - pi-loop가 자체 `loop-widget`을 `setWidget`으로 표시 → 기각. 요구는 "/todos 위젯"의 가시화이며, 위젯이 분산되고 `/todos` 오버레이와 내용이 갈라진다.
  - Lead 프롬프트로 todo 툴 미러링을 유도 → 기각. LLM 동작에 의존해 비결정적이고, run 중 done 갱신이 불가능(todo 위젯 동기화는 todo 툴 execute 시에만 일어남)하며 이중 기록이다.
- **테스트 전략:**
  - *발행 단언*(lead.test): 가짜 backend로 `loop_run` execute 시 `events.emit("loop:run-start", …)`와 `appendEntry("loop-run-tasks", …)`의 runId·tasks 페이로드를 단언. onProgress 스냅샷에 완료 태스크가 있으면 `loop:run-progress` 발행을 단언.
  - *병합 렌더 단언*(todo-widget): `loop:run-start` → 루프 구간 표시, `loop:run-progress` → 해당 항목 ✓, `loop:run-end` → 최종 고정을 단언.
  - *재생 호환 단언*: 루프 엔트리가 없는 기존 브랜치 재구성 결과가 기존 출력과 동일함을 단언(아래 호환 섹션).

### D5. Loop 실행 시작 시 architect(auto) 페르소나 상태 표시 — **수정** (persona가 run 경계를 구독)

- 현재 persona 상태는 `session_start`/`session_tree`에서만 설정되므로, 긴 턴 중간에 시작하는 DAS run의 경계에서는 상태 갱신이 없다. `pi-extensions/persona.ts`가 `pi.events.on("loop:run-start")`를 구독해 (a) 푸터 상태를 재단얼(`setStatus` 재호출)하고 (b) run 시작당 1회 info notify(`🎭 아키텍트 (auto) — Loop 실행 시작` 형식, run 길이가 분 단위이므로 소음 한도 내)한다.
- **수정 대상 파일:** `pi-extensions/persona.ts`, `pi-extensions/README.md`.
- **대안 및 기각 이유:**
  - `agent_start`에서만 재단얼 → 기각. run은 턴 중간(loop_run execute)에 시작하며, 요구가 가리키는 경계는 run 시작 시점이다.
  - pi-loop가 persona 상태를 직접 표시 → 기각. persona 선택은 persona.ts의 사유 상태라 로직이 중복되고, packages/pi-loop에 persona 개념이 유입된다.
- **테스트 전략:** `statusText(cwd)` 순수 함수 단언(`🎭 아키텍트 (auto)` 형태, off·미해석 ⇒ undefined) + 가짜 ctx로 `loop:run-start` 수신 시 `setStatus('persona', …)` 재호출과 notify 1회 발생을 단언. auto 해석 규칙(AGENTS.md → architect 등)은 기존 동작 회귀 테스트로 고정.

## 경계 방향 (위반 금지선)

- **packages/pi-loop → pi ExtensionAPI 표면만 사용**(events, appendEntry, setWidget 등 공개 API). `pi-extensions/` 파일을 import하지 않는다.
- **pi-extensions/* → Loop 프로토콜·오케스트레이터 import 금지, provider(codex/z.ai/agy)·모델·엔드포인트 개념 금지.** Loop와의 통합은 문서화된 버스 이벤트 이름("loop:run-start" 등)과 방어적으로 파싱한 페이로드로만 한다. todo-widget·persona는 Loop 확장이 없는 환경에서도 이벤트를 받지 못해 기존과 동일하게 동작해야 한다.
- **loop-core(Rust) 무변경.** persona·todo·run 가시성은 어댑터/UI 영역의 관심사다.
- **provider 어댑터 무변경.** 비-pi 워커 역할 지시는 TaskSpec requirements 채널만 사용한다(D2).

## 영속 형식·세션 재생 호환

- 기존 형식 불변: `persona-state` 커스텀 엔트리와 `todo` 툴 결과 `details`(TodoDetails)는 그대로 유지.
- 신규 형식은 **additive**: `loop-run-tasks` 커스텀 엔트리만 추가.
- **재생(reconstruct) 호환:** 기존 세션에는 `loop-run-tasks`가 없으므로 재구성 결과에 루프 구간이 없 = 기존 동작과 동일. `/tree`·fork·재시작 시 `getBranch()` 순차 스캔으로 해당 시점의 todos+루프 구간이 복원된다(todo.ts의 reconstructState 패턴과 동일한 방법). 구버전 todo-widget이 새 엔트리를 포함한 세션을 읽는 경우도, 스캔 대상이 아닌 엔트리는 무시되므로 안전하다.

## 검증 커맨드 (구현 태스크용)

```bash
bun test packages/pi-loop        # D4 발행 단언
bun test pi-extensions/test      # D1·D4·D5 단언 (신규, mock.module로 pi 모듈 스텁)
bun run check                    # 전체 회귀
```

pi 런타임이 필요한 위젯 레이아웃·키 입력은 수동 검증 항목으로 분리한다(D3).

## Verification (검증 기록)

- **Date:** 2026-09-22 (verification 태스크, 구현 직후 working tree 기준)
- **변경 범위 확인:** `crates/**` 무변경, `packages/providers/**` 무변경. 변경은 `packages/cli/*`, `packages/pi-loop/*`, 신규 `pi-extensions/`, 본 문서뿐이다.

| 커맨드 | 결과 | 근거 |
|---|---|---|
| `bun run codegen:check` | ✅ 통과 | 임시 디렉터리 재생성 결과가 커밋된 generated 파일과 동일(차이 없음) |
| `bun run typecheck` | ✅ 통과 | `tsc -p tsconfig.json` 오류 없음 |
| `bun run test:architecture` | ✅ 통과 | 6 pass / 0 fail (156 expect), 경계 위반 없음 |
| `cargo test --workspace` | ✅ 통과 | 74 passed / 1 ignored / 0 failed |
| `bun test packages` | ✅ 통과 | 178 pass / 0 fail (25 files, 767 expect) |
| `bun run check` (전체: codegen:check → typecheck → test:architecture → cargo test → cargo build loop-bridge → bun test packages+tests+plugins+scripts) | ✅ 통과 | && 체인 끝까지 도달, 최종 bun test 196 pass / 0 fail (30 files, 960 expect) |

- **D1~D5 대상 테스트 근거** (`bun test packages/pi-loop` = 30 pass / 0 fail): ANSI·hex 색상 부재 가드, `widgetLines` 토큰 의미론, `loopRunLines` 토큰, `loop:run-*` 버스 계약 발행/구독/브랜치 복원, run 실패 시 `run-end` 발행, persona auto 재단언·off 무음 — 모두 (pass).
- **브리지 타입 변경:** 없음. loop-core·loop-bridge(Rust)와 generated protocol 모두 무변경이므로 **codegen 결과는 커밋 대상이 아니다**. `codegen:check`가 기존 커밋분과의 동일성을 증명한다.
- **별도 evidence로 남긴 항목 (저장소 규칙상 유닛 검증에서 제외):** D3 수동 키 검증(enter/shift+enter/ctrl+j, 터미널별), 실제 provider(codex·z.ai·antigravity) 로그인 상태 동작 — 유료/인증 호출.
- **최종 판정: 전체 통과 ✅** — 위 6개 커맨드 전부 통과, 실패 원인 없음.
