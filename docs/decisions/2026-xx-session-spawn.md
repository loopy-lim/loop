# 결정: 원격 pi TUI 세션 스폰 모델 (tmux 우선) + 게이트웨이 스폰 엔드포인트

- **상태:** 결정됨 (게이트웨이·스포너 계층 구현 완료 — 앱 UI 동선은 후속 태스크)
- **태스크:** `spawn-decision-and-endpoint` (implementation, attempt 0)
- **작성일:** 2026-xx
- **선행 문서와의 관계:**
  - [`2026-xx-tokenless-auth-and-app-layout.md`](2026-xx-tokenless-auth-and-app-layout.md) §D-A의 신뢰 경계(tailnet 멤버십)를 스폰 엔드포인트에도 적용한다 — 스폰은 상태를 바꾸는 쓰기 작업이지만, 그 신뢰 경계 안에서는 새 표면이 아니다(§D-B1 근거).
  - [`2026-xx-terminal-mirror.md`](2026-xx-terminal-mirror.md) / [`2026-xx-gui-conversation.md`](2026-xx-gui-conversation.md) — 기존 tap 확장(`pi-extensions/session-tap.ts`)이 세션을 수집기에 자동 등록하므로, 스폰 이후 별도의 연결 작업 없이 기존 미러·대화 스트림이 그 세션을 앱에 흘린다.
  - [`docs/research/gui-session-events.md`](../research/gui-session-events.md) 경로 A — pi 확장은 interactive(TUI) 모드에서도 로드되므로 "TUI로 뜨는" 스폰이 관찰 가능성을 잃지 않는다.
- **경계:** 스포너는 `packages/gateway/src/spawn.ts`(어댑터 계층)에만 존재한다. loop-core에 터미널·tmux·스폰 개념이 들어가지 않으며, Rust 타입 변경·codegen도 없다(스폰 응답은 steer 응답과 같은 어댑터 로컬 JSON — Rust 도메인 아님). 모델·엔드포인트 개념은 스포너에 없다(pi는 호스트의 자체 auth로 실행, 자격증명 주입 없음).

## 1. 배경

운영자가 앱(모바일/데스크톱)에서 "새 세션(TUI)" 액션을 누르면 호스트에 새 pi TUI가 떠야 한다. 오늘의 게이트웨이는 세션을 관찰(tap/pane 스트림)하지만 생성하지는 않는다 — 세션 생성은 맥에서 수동으로 터미널을 열어 pi를 실행하는 일이었다. 앱 원격 스폰을 지원하려면 (1) 스폰 메커니즘 선택, (2) 보안 게이트, (3) 작업 디렉터리 정책, (4) 게이트웨이 계약이 필요하다.

## 2. 결정 (한 단락)

**(1) 스폰 방식:** **tmux `new-window`가 유일한 1급 스포너다.** 스포너는 `tmux has-session`으로 가용성을 결정론적으로 확인하고, tmux 바이너리 부재는 고정 problem(`spawn_tmux_unavailable`)으로 반환한다. Terminal.app osascript는 "조용한 폴백"이 아니라 `fallback: "osascript"`로 **명시 설정한 경우에만** 실행되는 별도 경로다. **(2) 보안 게이트:** `enabled`(기본 **on**)로 전체 표면을 게이트한다 — 토큰리스 모드의 요청자는 이미 tailnet 멤버이고, 멤버는 SSH로 같은 일을 할 수 있으므로 스폰 엔드포인트는 공격 표면을 넓히지 않는다. bearer 폴백 리스너에서는 `allowOnFallback`(기본 **off**)이 없으면 거부한다 — 검증된 토큰은 tailnet 멤버십보다 약한 근거다. **(3) 작업 디렉터리:** 요청의 `cwd`는 절대 경로 + 실존 + 설정된 allowed roots 하위(realpath 정규화)라는 세 조건을 통과해야 하며, 생략 시 `defaultCwd`(기본: 게이트웨이 프로세스 cwd)를 쓴다. **(4) 계약:** `POST /v1/sessions/spawn` — 성공 201에 tmux 타깃·pane id·pid를 반환하고, 실패는 결정론적 problem+json으로 매핑한다. 스폰된 pi의 실제 sessionId는 tap이 수집기에 등록할 때 확정되므로 응답이 세션 id를 발명하지 않고, 앱은 기존 세션 목록/스트림에서 자동 발견한다.

### D-A. 스폰 방식

**A1. tmux new-window 우선(1급), 전용 세션.** 스폰 타깃은 `spawn.tmuxSession`(기본 `loop`)이라는 **전용 tmux 세션**이다 — 게이트웨이 자신이 tmux 안에서 실행되는지와 무관하게 예측 가능한 타깃을 준다. 세션이 없으면 `tmuxAutoCreate`(기본 **on**)가 `tmux new-session -d -s loop -c <cwd>`로 만든다(첫 사용이 무설정 동작); off이면 `spawn_tmux_session_missing`(503)을 반환한다. 스폰 명령은 순수 함수 `buildSpawnCommand`가 결정론적으로 조립한다:

```text
tmux new-window -P -F '#{pane_id}\t#{pane_pid}' -t loop: -n pi-<spawnId> -c <cwd> 'pi' <quoted args…>
```

pi 본체는 POSIX single-quote로 하나의 shell-command 문자열이 되어 tmux 기본 셸에서 실행된다(인자 조립의 인젝션 경계는 quote). `-P -F '#{pane_id}\t#{pane_pid}'` 출력에서 **pane id(`%N`, 안정적 핸들)**와 pid를 뽑아 응답한다. 창 이름 `pi-<spawnId>`은 표시용 best-effort다 — tmux `automatic-rename`이 실행 프로그램 이름으로 바꿀 수 있으므로 계약상 안정 핸들은 paneId다.

**A2. tmux 부재 = 결정론적 에러, osascript는 명시 옵트인.** `has-session` exec가 reject(ENOENT 등 바이너리 부재)하면: `fallback: "error"`(기본) → `spawn_tmux_unavailable`(503); `fallback: "osascript"`(macOS 전용 명시 설정) → `osascript -e 'tell application "Terminal" to do script "cd <cwd> && <pi…>"'`를 실행하고 `launcher: "terminal-app"`으로 응답한다(pane id·pid는 null — Terminal은 핸들을 주지 않는다, 정직한 계약). osascript를 기본 폴백으로 하지 않은 이유: 헤드리스·SSH 환경에서 무의미, 자동화 권한 승인 다이얼로그가 비결정론, 창 수명이 게이트웨이와 무관하게 방치됨. **tmux를 설치하는 것이 정답이고 에러는 그것을 말한다.**

**A3. pi 실행 인자.** 스폰되는 pi는 interactive(TUI) 모드이며 인자는 설정(`piPath`, `piArgs`)에서만 온다. tap 확장은 사용자 pi 설정(`~/.pi/agent/settings.json` extensions 배열)에 이미 등록되어 있으므로 스포너가 `--extension`을 강제하지 않는다 — 등록이 안 된 호스트에서는 `LOOP_GATEWAY_PI_ARGS="--extension <tap 경로>"`로 넣는다(pi docs: 확장은 interactive 모드에서도 로드). 스폰 직후 tap이 수집기에 `register`하면 기존 미러·대화 SSE 경로가 자동으로 그 세션을 앱에 스트리밍한다 — 스폰 이후의 새 파이프라인은 없다.

**기각한 대안:**

| 대안 | 기각 이유 |
| --- | --- |
| Terminal.app osascript 기본 폴백 | 헤드리스/SSH에서 무의미, 자동화 권한 승인이 비결정론, 창 수명 방치 — 명시 설정 시에만 허용(§D-A2) |
| herdr agent start 경유 | `--kind pi` 레인은 herdr가 pane 소유권·수명을 관리하는 관리형 워커 레인; 운영자 자유 세션(Lead 세션)과 수명 모델이 다름 — 병존하되 본 엔드포인트의 경로가 아님 |
| 게이트웨이가 pty를 직접 소유 + 웹 터미널 | 새 표면(pty 프록시)이 크고 "새 터미널 창"이라는 운영자 요구와 불일치 — 필요해지면 별도 결정 |
| sshd 트리거 / launchd | 게이트웨이 밖 사전 설정 필요, 앱 단일 액션 요구 불충족 |

### D-B. 보안 게이트

**B1. 마스터 게이트와 기본값.** `spawn.enabled`(기본 **on**, `LOOP_GATEWAY_SPAWN=off`로 끔)가 전체 표면을 게이트하고, off면 핸들러는 tmux·fs에 손대지 않고 `spawn_disabled`(403)로 즉시 답한다. 기본 on의 근거: (i) 토큰리스 모드의 신뢰 경계는 tailnet 멤버십이고(tokenless-auth 결정 §D-A1), tailnet 멤버는 SSH로 동일한 프로세스 스폰이 가능하다 — 엔드포인트는 기존 신뢰 경계 안의 편의 표면이지 새 권한이 아니다; (ii) 스포너는 임의 명령을 받지 않는다 — 실행되는 프로그램은 오직 설정된 `piPath` 하나고 요청은 cwd 하나만 받는다.

**B2. 폴백(bearer) 리스너 조건.** bearer 폴백 리스너의 호출자는 "검증된 토큰 보유자"이지 tailnet 멤버십 증명이 아니므로, `allowOnFallback`(기본 **off**, `LOOP_GATEWAY_SPAWN_ON_BEARER_FALLBACK=on`으로 켬)이 없으면 `spawn_fallback_denied`(403)다. 기본 조합은 "tailscale 리스너에서 스폰 허용, 폴백 리스너에서 거부"다. 게이트 판정은 스포너가 리스너 모드를 인자로 받아 수행한다(서버는 HTTP만).

**B3. cwd 정책.** 요청 `cwd`는 순서대로 (i) 절대 경로(`spawn_cwd_invalid`, 400), (ii) 실존 디렉터리(realpath 실패 → `spawn_cwd_missing`, 404), (iii) `allowedRoots`(기본 `[defaultCwd]`)의 realpath 하나와 같거나 그 아래(`spawn_cwd_outside_roots`, 403)를 통과해야 한다. realpath 정규화 비교라 `..` 트래버설이 중화되고, `/work` 루트가 `/work2`를 접두어 우연으로 축복하지 않는다. problem `fields`는 경로 **값을 담지 않는다**(problem.ts 계약 — 검사 규칙 텍스트만).

**B4. 자격증명·모델 무지.** 스포너는 pi에 자격증명을 주입하지 않고 모델·엔드포인트를 모른다(pi는 호스트 자체 auth 사용). 스폰 응답·로그·display 문자열에 시크릿이 없고, 로그 마스킹 규칙은 그대로 적용된다.

### D-C. 계약(게이트웨이)

`POST /v1/sessions/spawn` — `deps.spawn` 시임이 없으면 404(fail-closed, pane/session/steer 표면과 동일).

- 요청: `{ cwd?: string }`(JSON, 생략/빈 본문 허용 — defaultCwd 사용). `cwd` 비문자열·빈 문자열은 400 `invalid_request`.
- 성공 `201`(어댑터 로컬 JSON):

```json
{ "spawnId": "abc12345", "tmuxTarget": "loop:pi-abc12345", "paneId": "%7", "pid": 4711, "cwd": "/work/nested", "launcher": "tmux" }
```

`tmuxTarget`·`paneId`·`pid`는 terminal-app 경로에서 null이다. **sessionId는 응답에 없다** — tap이 `session_start`에서 수집기에 등록할 때 확정되며, 앱은 `GET /v1/sessions` 갱신에서 자동 발견한다(응답이 세션 id를 발명하지 않는다).

- 실패 problem+json(결정론 매핑, 전부 비재시도 — 재시도로 해결되는 장애가 아님):

| 코드 | 상태 | 원인 |
| --- | --- | --- |
| `spawn_disabled` | 403 | `enabled=false` (게이트, 프로세스 접촉 전) |
| `spawn_fallback_denied` | 403 | 폴백 리스너 + `allowOnFallback=false` |
| `spawn_cwd_invalid` | 400 | 상대/빈 경로 |
| `spawn_cwd_missing` | 404 | 실존하지 않는 디렉터리 |
| `spawn_cwd_outside_roots` | 403 | allowed roots 밖 |
| `spawn_tmux_unavailable` | 503 | tmux 바이너리 부재/기동 불가, new-session 실패 (fields에 tmux exit code) |
| `spawn_tmux_session_missing` | 503 | 세션 부재 + `tmuxAutoCreate=false` |
| `spawn_launch_failed` | 500 | new-window/osascript 실패, 출력 파싱 실패 (fields에 stage·exit code) |

- 상태 비보존: 스폰은 DB/메모리 상태를 만들지 않는다 — tmux에 창을 여는 순수 부작용이며, pi exec가 실패해 창이 닫히면 남는 것도 없다(수명은 창의 것).
- 환경 변수(조립 루트 전용): `LOOP_GATEWAY_SPAWN`(on/off), `LOOP_GATEWAY_SPAWN_TMUX_SESSION`, `LOOP_GATEWAY_SPAWN_TMUX_AUTO`, `LOOP_GATEWAY_SPAWN_DEFAULT_CWD`, `LOOP_GATEWAY_SPAWN_ALLOWED_ROOTS`(콜론 구분), `LOOP_GATEWAY_PI_PATH`/`LOOP_GATEWAY_PI_ARGS`, `LOOP_GATEWAY_SPAWN_FALLBACK`(error/osascript), `LOOP_GATEWAY_SPAWN_ON_BEARER_FALLBACK`(on/off). 구조 위반(상대 경로 루트, tmux 세션명의 `.`/`:` 등)은 기동 시 fail-closed.

### D-D. 앱 동선(후속 태스크 범위)

컴포저/헤더 "새 세션(TUI)" 버튼 → `POST /v1/sessions/spawn` → 성공 시 세션 목록 새로고침 + 새 세션 화면 진입(tap 등록 시 자동 발견) → 실패 시 problem+json 코드/detail 표시. 본 태스크는 게이트웨이·스포너까지만 구현했고 앱 UI·게이트웨이 클라이언트 확장은 별도 태스크다.

## 3. 기계 검증 가능한 수용 기준 (전부 실제 tmux 실행·유료 모델 호출 없이 검증됨 — `packages/gateway/test/spawn.test.ts`)

1. **명령 조립 결정론:** `buildSpawnCommand`가 (tmux 타깃, 창 이름, cwd, pi argv) → 완전 argv를 결정론 생성; quote 특수문자(공백·작은따옴표) 스냅샷. ✅
2. **게이트 on/off:** `enabled=false` → `spawn_disabled`, exec 0회(스파이); 폴백 리스너 → `spawn_fallback_denied`; `allowOnFallback=true`면 통과. `spawnConfigFromEnv`의 on/off 파싱과 기동 fail-closed(상대 경로 루트, 금지 세션명, 잘못된 fallback 값) 포함. ✅
3. **cwd 검증:** 상대(400)/부재(404)/루트 밖(403)/`..` 트래버설·접두어 우연(/work vs /work2) 각각 고정 코드, 프로세스 접촉 전 거부. ✅
4. **에러 매핑:** tmux 부재 → `spawn_tmux_unavailable`; 세션 부재+autoCreate off → `spawn_tmux_session_missing`; autoCreate on → new-session→new-window 순서 단정; new-window/new-session/osascript 실패 → `spawn_launch_failed`/`spawn_tmux_unavailable`에 exit code 동봉; 출력 파싱 실패 → 발명된 pane 없이 실패. ✅
5. **게이트웨이 계약:** 실제 HTTP 파이프라인으로 201 본문·헤더(X-Request-Id), problem+json content-type·본문, 404(seam 부재)/405/400 프레이밍, bearer 401이 스포너 호출보다 앞. ✅

## 4. 미해결 위험

- **스폰↔세션 상관 갭:** tap이 현재 spawnId를 에코하지 않으므로, "이 창이 곧 저 세션"임을 앱이 즉시 특정하려면 tap 등록 이벤트와의 시간적 상관(스폰 직후 신규 등록)에 의존한다. 여러 창을 연속 스폰하면 모호해질 수 있다 — 후속으로 tap이 환경 마커(`LOOP_SPAWN_ID`)를 register 라인에 실어 상관을 완결하는 것이 정확한 닫음이다(pi-extensions 쓰기 권한이 필요해 본 태스크 밖).
- 창 이름은 tmux `automatic-rename`에 의해 바뀔 수 있다 — 계약상 안정 핸들은 paneId이고 앱은 tmuxTarget 문자열을 표시용으로만 써야 한다.
- osascript 경로는 결정론 **조립**만 테스트 가능하고 실제 Terminal 승인 다이얼로그는 테스트 밖이다 — 기본 error 폴백이라 데모·검증은 tmux 경로로 한다.
- 스폰 폭주 방지(동시 스폰 상한)는 상태 비보존 원칙과 충돌 — 필요해지면 tmux 창 수 카운트 기반 상한을 별도 결정으로.
- herdr가 자체 멀티플렉서를 쓰는 호스트에서 tmux가 없을 수 있다 — 그 호스트는 `spawn_tmux_unavailable`을 받고, tmux 설치가 운영 절차다(에러가 절차를 말하도록 의도했다).
