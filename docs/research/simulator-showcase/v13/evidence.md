# v13 — 앱에서 원격 스폰 → 호스트에 새 tmux pi 세션 → 앱 라이브 미러 (2026-09-27)

**주장:** 시뮬레이터 Loop 앱의 chats 홈 "New TUI session" 카드 탭 한 번으로 (1) 게이트웨이 `POST /v1/sessions/spawn`이 호출되고, (2) 맥의 전용 tmux 세션 `loop`에 **새 창이 열려 실제 pi TUI가 구동**되며, (3) tap이 그 세션을 수집기에 자동 등록해 **앱이 세션을 자동 발견·자동 오픈**하고 같은 대화가 라이브로 미러된다. 결정 `docs/decisions/2026-xx-session-spawn.md` §D-D(앱 동선)의 실측 증명이다.

## 스크린샷 ↔ 증명 매핑

| # | 파일 | 증명 | 화면에서 확인되는 것 |
| --- | --- | --- | --- |
| 01 | `01-chats-before-spawn.png` | 탭 직전 chats 홈 — 스폰 표면이 존재 | 컴포저 아래 **"New TUI session" 필 버튼**(AX frame `0,234 402x44`, enabled), RunsList 위 조용한 라벨 배치 |
| 02 | `02-app-auto-opened-after-tap.png` | **탭 → 자동 발견·자동 오픈 (~1.2s)** | 탭 +1.2s 후 벌써 새 세션의 대화 화면 진입(빈 타임라인 "Nothing here yet") — 앱이 스폰 응답의 tmuxTarget이 아니라 세션 인벤토리 변화로 새 세션을 스스로 찾아 들어감 |
| 03 | `03-host-tmux-window-pi.png` | **맥에 새 tmux 창에서 실제 pi TUI 구동** | Terminal 창(800x700)에서 `tmux attach -t loop` — 스폰된 창 `pi-6798c365`의 실전사: 프롬프트 2건 · `Thinking…` · `[skill] using-superpowers` · 응답 `둘`/`넷` · 푸터 `$0.048 (sub) (openai-codex) gpt-5.5 • medium` |
| 04 | `04-app-turn1-inflight.png` | **턴 1 진행 중 앱 미러** | 같은 프롬프트가 앱 타임라인에 유저 버블로 도착(우측 정렬), 어시스턴트 응답 도착 전 상태 — 진행 중 스트리밍 비트 |
| 05 | `05-app-two-turns-final.png` | **2턴 누적 최종 앱 전사** | 유저 버블 2건(376, 1260) + 툴카드/상태 행 + 어시스턴트 응답 — 터미널 전사(03)와 동일 순서 |
| 06 | `06-side-by-side-final.png` | 나란히 최종 비교 | 왼쪽 맥 터미널(pi TUI, `$0.048 (sub)`) \| 오른쪽 앱(같은 2턴 전사) |

## 파이프라인 (관찰된 실측 경로)

```text
시뮬레이터 앱 chats "New TUI session" 탭 (idb HID tap @ 201,256)
  └─ POST /v1/sessions/spawn {}  →  201 {"spawnId":"6798c365","tmuxTarget":"loop:pi-6798c365",
       "paneId":"%1_25437","cwd":"/Users/loopy/dev/ll3/loop","launcher":"tmux"}
      └─ tmux new-window -t loop: -n pi-6798c365 (spawn.ts buildSpawnCommand 조립)
          └─ pi TUI 기동 → pi-extensions/session-tap.ts 가 수집기에 자동 등록
              ├─ GET /v1/sessions     → 새 live 세션 01a0e1a5-9f97-7762-872e-3267b27cfbb2
              ├─ 앱이 before/after 스냅샷 차분으로 자동 발견 → 대화 화면 자동 오픈 (탭 +1.2s)
              └─ GET /v1/sessions/{id}/events (SSE) → user_message → turnStarted → assistant_message
```

서버 측 2차 증거 — 스폰 응답 본문(위 코드블록)과 SSE 프레임 실측치:

```text
event: user_message      data: {"text":"1+1은? 정확히 한 단어로만 답해.","source":"interactive",…}
event: lifecycle         data: {"phase":"turnStarted",…}
event: assistant_message data: {…}   # 두 턴 모두 프레임 확인
```

종료 상태까지 정직: `/exit` 후 `01a0e1a5`(본 데모)·`01a0e1a9`(상태 컷용 2차 스폰) 모두 `state:"ended"` 확인, `tmux kill-session -t loop`으로 창 수명 종료.

## 검증이 잡아낸 결함 (전부 수정 후 데모 진행)

1. **빌드 깨짐 1 — 잘못된 import 경로:** `src/screens/SubmitScreen.tsx`가 `./spawn-card`를 import(실제 파일은 `src/features/spawn-card.tsx`) → Metro 번들 실패. 한 줄 수정(`../features/spawn-card`). `bun test`가 이를 못 잡은 이유: 앱 테스트는 react-free 모듈(`features/session-spawn.ts`)만 로드.
2. **빌드 깨짐 2 — 주석 종료자 중복:** `src/features/spawn-card.tsx` 헤더 주석의 `*/` 이중 행 → Babel SyntaxError. 한 줄 삭제.
3. **런타임 결함 — launchd PATH로 스폰 불가:** 실제 첫 `POST /v1/sessions/spawn`이 **`spawn_tmux_unavailable`(503)** 반환. launchd 기본 PATH에 `/opt/homebrew/bin`(tmux)과 fnm node bin(`pi`의 `#!/usr/bin/env node`)이 없어서. 결정 문서의 "결정론적 에러 매핑"이 실환에서 그대로 동작한 것으로, 수술은 저장소 코드가 아니라 기기 설정(`~/Library/LaunchAgents/kr.ll3.loop.gateway.plist`의 `EnvironmentVariables.PATH` 추가)에서 끝냈다 — 스포너 코드는 tmux 부재를 정확히 말했고, 절차(tmux 확보)를 따랐다.
4. **UX 발견(결함 아님):** 탭 → 201 → 자동 오픈이 **~1.2초** 만에 끝나 인라인 상태 줄("Opening…"/"waiting…")은 사실상 관측되지 않는다. 상태 줄은 실패 시에만 사실상 보인다 — 후속 UX 논의 거리.

## 유료 호출 공개 (전량)

운영자 사전 승인: "최소 유료 1~2회 소형 호출, 전량 공개". 사용 **2회, 모델 `(openai-codex) gpt-5.5 • medium`**, pi 푸터 기준:

| 턴 | 프롬프트 (`tmux send-keys -l`로 입력) | 응답 | 비용 (pi 사용량 보고치) |
| --- | --- | --- | --- |
| 1 | `1+1은? 정확히 한 단어로만 답해.` | `둘` | $0.038 (sub) |
| 2 | `그럼 2+2는? 역시 한 단어로만.` | `넷` | 누계 $0.048 (sub) |

합계 **$0.048 상당**(`(sub)` = 운영자 Codex 구독 과금). 프롬프트·응답 전문은 03·05 스크린샷과 위 표 그대로. 스폰 자체는 무상(모델 호출 없음)이며, 상태 컷용 2차 스폰(`pi-ace8d011`)은 유료 호출 0회.

## 환경·한계 (정직 기록)

- **실기기 없음** — iPhone 17 시뮬레이터(UDID `99B087B5-DEF6-4CF1-9177-81A5DE564CFC`), 게이트웨이는 launchd `kr.ll3.loop.gateway`의 루프백 `127.0.0.1:18477` 바인딩(토크니스).
- **탭 주입:** 이 환경에서 cliclick/AX 좌표 클릭이 RN 터치로 전달되지 않아(보조접근 권한 경로), **idb HID tap**(`idb ui tap 201 256`, fb-idb venv)으로 실제 터치를 주입했다. 사람의 손가락 탭과 동일한 터치 경로(시뮬레이터 HID 이벤트)이며, 같은 좌표의 컴포저·리스트 행 반응으로 주입 유효성을 교차 확인했다.
- **호스트 창 캡처:** `screencapture -R<region>`이 occluded 창에서 stale 프레임을 반환하는 함정을 확인 — `screencapture -l<windowID>`(Terminal 창 id 34112)로 창 단위 캡처했다.
- 시뮬레이터 창 프레임이 활성화 시점에 저장 프레임으로 복원되어 화면 밖으로 밀리는 현상이 있었음(idb 탭·simctl 캡처는 창 위치와 무관하게 동작해 데모 영향 없음).
- 스폰 응답의 `pid`가 null로 반환되는 것을 관찰(paneId는 정상). 계약상 null 허용 범위이지만 pane_pid 파싱이 이 환경의 tmux 3.7c 출력에서 빈 값을 준 것으로 보인다 — 후속 확인 과제.

## 재실행

```bash
cd /Users/loopy/dev/ll3/loop
bash docs/research/simulator-showcase/v13/capture.sh
```

사전 요건: launchd 게이트웨이 가동(plist PATH에 tmux·node 포함 — 결함 3 참조), tap 등록(`~/.pi/agent/settings.json`, 스크립트가 멱등 등록), `idb` 클라이언트(스크립트 헤더 참조). 유료 프롬프트 2회는 스크립트가 멈춰서 운영자 승인 하에 `tmux send-keys`로 직접 넣는다.
