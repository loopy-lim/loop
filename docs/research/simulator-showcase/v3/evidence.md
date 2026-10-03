# Simulator showcase v3 — herdr-as-app, live worker pane in the simulator

- **태스크:** `simulator-showcase-3` (implementation, attempt 0)
- **일시:** 2026-09-26 00:15–01:10 KST (2026-09-25 15:15–16:10 UTC)
- **프레이밍:** 이 앱은 **"herdr를 앱으로 쓰는 것"**이다 — Codex 앱이 데스크톱 에이전트의 작업 터미널을 pane으로 보여주듯, Loop 앱은 herdr가 관리하는 실행 중 워커의 pane 화면 버퍼를 게이트웨이 SSE로 받아 **pi 터미널처럼 라이브로** 흘린다(모노스페이스 · 자동 스크롤 · 중앙 정렬).
- **스크린샷:** `01-connect-screen.png` ~ `06-pane-live-later.png` (이 디렉터리)
- **운영자 재실행:** §6. **결함과 래퍼 우회:** §5 (게이트웨이 후속 과제 입력)

> bearer 토큰은 이 문서에 없다(재발급은 `docs/research/app-device-install.md` §3.2). 토큰은 프로세스 메모리와 0600 임시 파일에만 존재했고 캡처 직후 삭제했다.

## 1. 무엇을 시연했나 (단계별)

| # | 단계 | 근거 |
| --- | --- | --- |
| 1 | iPhone 17 시뮬레이터(UDID `99B087B5-…`)에 Release 빌드 설치·기동 | `scripts/build-ios-simulator.sh` |
| 2 | Connect 화면 — 중앙 정렬, 호스트/포트 프리필 | `01-connect-screen.png` |
| 3 | bearer + autoConnect 기동 → **실제 runs 목록** + 프롬프트 프리필 | `02-runs-and-submit.png` |
| 4 | autoSubmit(12s) → `POST /v1/runs` 202 → RunScreen에서 status·output 12프레임·terminal 수신, 하단 **Terminals 섹션에 게이트웨이가 관찰하는 pane 인벤토리**(라벨 포함: `simulator-showcase-3·impl·a0` 등 5건) | `03-run-live.png` |
| 5 | Terminals의 pane 탭(자동화는 사람의 탭과 동일 핸들러 호출) → **PaneScreen**: 다크 터미널 뷰포트(내부 스크롤) + Menlo 모노스페이스 + 자동 스크롤, 메타 라인 `rev N · following` | `04-pane-live.png` |
| 6 | **라이브 흐름 증명** — 같은 화면을 시간차 캡처: `rev 427 → 476 → 514`, 각 샷의 터미널 내용이 캡처 시점의 워커 실제 출력(방금 실행된 명령 에코 포함)으로 갱신 | `04` vs `05-pane-live-advanced.png` vs `06-pane-live-later.png` |
| 7 | 커서 리플레이: 마지막 SSE id `{"v":1,"g":1,"r":"w53:p2M","n":547}`로 `Last-Event-ID` 재접속 → `n:548`부터 `pane_text` 재개 | §3.2 |

시연 pane은 `w53:p2M` — **이 태스크의 구현 워커 자신**이다. "작업 중인 워커를 앱에서 지켜보는 것"이 herdr-as-app 시연의 정의이며, 스크린샷 속 텍스트는 pi 세션의 실시간 출력(도구 호출 에코, Thinking, 세션 푸터)이다.

## 2. 앱 변경 (쓰기 범위 내)

1. **showcase 확장** (`src/showcase.ts`, `ios/LoopMobile/AppDelegate.swift`): `LOOP_SHOWCASE_OPEN_PANE`/`LOOP_SHOWCASE_OPEN_PANE_DELAY_MS` → `autoOpenPaneId`/`autoOpenPaneDelayMs`. RunScreen이 pane 인벤토리에서 대상 pane을 확인하면 사람의 탭과 동일한 `onOpenPane` 핸들러를 1회 호출한다. 인벤토리가 아직 안 뜨면(게이트웨이 워밍업/재시작) 2초 간격 최대 10회 재시도한다.
2. **터미널 뷰 완성** (`src/ui/terminalLayout.ts`, `src/screens/PaneScreen.tsx`):
   - 폰트: 제네릭 `"monospace"`(iOS RN에서 신뢰성 없음) → **Menlo** (모노스페이스 요구사항을 실제 렌더로 충족).
   - 터미널 표면: 다크 스크린(`#0D1117`) + 라이트 글리프(`#E6EDF3`) + 고정 뷰포트(430pt, 내부 스크롤) — 터미널은 "스크롤되는 문단"이 아니라 "고정 스크린"이고, 메타 라인(rev/following)이 항상 보인다.
   - **렌더 스로틀(300ms)**: pane 프레임은 화면 버퍼 전체 스냅샷이므로 최신 1건만 UI에 반영하면 충분하다(프레임당 3KB 모노스페이스 Text 재레이아웃 방지).
3. **테스트** (`test/pane-projection.test.ts`, 신규 `test/showcase-config.test.ts`): 47 pass / 0 fail. 기존 `AUTOSCROLL_BOTTOM_EPSILON` import 경로 오류(pane 구현 잔여 결함) 수정.

## 3. 서버 측 증거 (게이트웨이 SSE)

### 3.1 라이브 프레임

시연 창 동안 pane `w53:p2M`에 대해 **pane_text 570프레임** 수집(curl `text/event-stream`, 600s). 프레임 예시:

```text
id: eyJ2IjoxLCJnIjoxLCJyIjoidzUzOnAyTSIsIm4iOjU0N30
event: pane_text
data: {"paneId":"w53:p2M","revision":"547","text":"$ sleep 8 && xcrun simctl io … 05-pane-live-advanced.png …","truncated":false,"occurredAt":"…"}
```

`revision`은 §5.3의 래퍼가 합성한 단조 값이고, 앱 메타 라인이 그대로 표시했다: **427 (04) → 476 (05) → 514 (06)**.

### 3.2 커서 리플레이

마지막 id를 디코드하면 `{"v":1,"g":1,"r":"w53:p2M","n":547}`. `Last-Event-ID` 헤더로 재접속하면 즉시 `n:548`의 `pane_text`부터 재개했다 — 커서 수렴 경로(단절→재생→라이브)가 wire에서 동작한다.

## 4. 유료 모델 호출 공개 (운영자 승인 레인)

| 호출 | 대상 | 내용 | 비용 표시 |
| --- | --- | --- | --- |
| 1회 | 신규 pi 워커(`w53:p2N`, herdr `agent prompt`) | `17 * 23` 한 줄 산술 (M-TL4와 동일 형태, 도구 금지) | pane 푸터 표시 `$0.027` (openai-codex, 세션 표시값) |

- 최종 라이브 시연에는 **추가 유료 호출이 없다**: 시연 pane(`w53:p2M`)은 이 태스크 구현 워커 자신의 pi 세션이며, 그 출력은 운영자의 기존 loop 세션 호출에서 나온다(pane 푸터에 세션 비용 `$0.585→$0.609`로 표시된 것이 그것다 — 데모 전용 지출이 아니다).
- 프롬프트 #1의 목적은 pane 라이브 스트리밍 검증이었고, 이 과정에서 §5의 게이트웨이 결함들을 발견했다. credential은 어디에도 기록·표시되지 않았다(게이트웨이 적목 게이트는 `04` 캡처 역사에서 `[credential]=[redacted]` 프레임으로 육안 확인했다).

## 5. 발견한 결함과 데모 래퍼 (게이트웨이 후속 과제 입력)

`packages/gateway`는 이 태스크의 쓰기 범위 밖이다. 저장소 코드는 수정하지 않았고, 시연은 **저장소 밖 래퍼(`/tmp/v3-gateway-wrapper.ts`, 전문 §6.3)**가 런타임에 우회한 게이트웨이로 수행했다. 래퍼는 in-repo `bootGatewayFromEnv`를 그대로 부팅한다.

| # | 결함 | 증거 | 래퍼 우회 |
| --- | --- | --- | --- |
| D-a | **herdr 0.8.2는 모든 응답 후 소켓을 닫는다.** `HerdrPaneSource`는 영속 연결을 가정하고, 틱 안 연속 read가 임종 소켓에 write하면 즉시 실패 → `PaneMirror`가 한 번의 null로 **영구 `paneGone`**(스티키). 관찰된 pane 생존은 운에 좌우되며 수 초~수 분 내 전멸했다. | 재시작 3회 모두 재현; 직접 소켓 테스트에서 응답 후 FIN(`hadError=false`) 확인; 100ms 간격 재시도 시 4/4 성공 | null read 시 `close()`+재시도(≤3) |
| D-b | **인벤토리 플리커 = paneGone.** herdr 세션 재배치(에이전트 시작/종료, 탭 이동)로 인벤토리에서 pane이 한 틱만 사라져도 스티키 paneGone. 사용자 세션에서 `p4W→p51→p52→p53` 재배치 중 재현 | 재시작 직후 부팅 2초 만에 paneGone, 인벤토리에는 pane 존재 | 최근 관측 pane을 2.5s 유예 유지 |
| D-c | **`pane.read` revision이 항상 0** (`pane.list`의 revision과 무관, 내용 변화와 무관). revision 디듀프가 두 번째 프레임을 영원히 못 보내 모든 pane 스트림이 인트로 이후 고정 | 텍스트 2,201B로 변한 뒤에도 `revision: 0`; 수집기 1프레임 정체 | 텍스트 비교로 단조 합성 리비전 부여 |
| D-d | **클라이언트 단절 시 게이트웨이 프로세스 크래시** — SSE pump의 `Controller is already closed`(`server.ts:410`)가 unhandled로 프로세스 종료. launchd KeepAlive가 재시작해 겉으로는 유지되지만 스트림 전체가 끊긴다 | `~/.loop/gateway/service.log` 반복 스택; 앱 terminate → 크래시 재현 | `unhandledRejection` 가드(프로세스 생존 확인) |
| D-e | **RN XHR 전송 계층이 수백 프레임 인트로 버스트(512×화면버퍼) 후 정체** — 앱이 인트로 뒤 갱신을 못 받음 | 04/05 동일 콘텐츠, 서버는 계속 프레임 전송 | (앱 측 정당 수정) 렌더 스로틀 + (래퍼) 인트로를 마지막 3프레임으로 제한 |

- D-e의 인트로 제한만 래퍼에 남기고, 스로틀·뷰포트·재시도는 **저장소에 정당한 앱 개선으로 반영**했다(§2).
- **후속 과제 제안(게이트웨이, 범위 밖):** `HerdrPaneSource` 요청 단위 재연결 + herdr 0.9.x에서 read revision 의미 검증, 인벤토리 유예, SSE pump 예외 정리, (필요 시) 인트로 크기 상한. 래퍼 전문이 회귀 테스트의 재현 시나리오가 된다.

## 6. 운영자 재실행

### 6.1 표준 경로 (launchd 서비스)

```bash
cd /Users/loopy/dev/ll3/loop
launchctl kickstart -k gui/$(id -u)/dev.loop.gateway
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..
UDID=99B087B5-DEF6-4CF1-9177-81A5DE564CFC
OUT=docs/research/simulator-showcase/v3
TOKEN=$(bun -e '…signHs256Token…')   # app-device-install.md §3.2
SIMCTL_CHILD_LOOP_SHOWCASE_BEARER="$TOKEN" \
SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
SIMCTL_CHILD_LOOP_SHOWCASE_PROMPT="Showcase v3: complete the deterministic pipeline while the terminal view mirrors the live worker pane." \
SIMCTL_CHILD_LOOP_SHOWCASE_SUBMIT=1 SIMCTL_CHILD_LOOP_SHOWCASE_SUBMIT_DELAY_MS=12000 \
SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_PANE="<paneId>" SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_PANE_DELAY_MS=4000 \
xcrun simctl launch $UDID org.reactjs.native.example.LoopMobile
xcrun simctl io $UDID screenshot $OUT/04-pane-live.png
```

주의(§5): 표준 경로의 pane 미러는 D-a~D-c로 불안정하다. **앱 종료 직후 게이트웨이 재시작 → 30초 안에 pane 화면 진입**이 성공률을 높인다.

### 6.2 안정 경로 (래퍼 게이트웨이, §5 우회 적용)

```bash
launchctl bootout gui/$(id -u)/dev.loop.gateway        # 포트 해제
set -a; . ~/.loop/gateway.env; set +a                  # 동일 env
export LOOP_GATEWAY_HOST=100.80.133.120 LOOP_GATEWAY_PORT=18477 LOOP_GATEWAY_DATABASE_PATH=$HOME/.loop/gateway/loop.db
nohup bun /tmp/v3-gateway-wrapper.ts > /tmp/v3-gateway.log 2>&1 &
# 이후 동일한 showcase launch. 종료: kill <pid>; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.loop.gateway.plist
```

### 6.3 래퍼 전문 (재현용 — `/tmp`는 휘발되므로 이 문서가 유일한 보존본)

래퍼는 ① readPane/listPanes null 시 재연결 재시도, ② 인벤토리 2.5s 유예, ③ 텍스트 비교 합성 리비전, ④ unhandledRejection 가드, ⑤ 인트로 3프레임 제한(`PaneMirror.prototype.observePane` 래핑)을 수행하고, 나머지는 전부 in-repo `bootGatewayFromEnv`를 사용한다. 전문은 이 문서 커밋 시점 기준 `/tmp/v3-gateway-wrapper.ts`와 동일하며, 요점은 §5 표와 같다. (전문 전체는 커밋 시 `v3/gateway-wrapper.ts`로 함께 첨부한다.)

## 7. 스크린샷 해시

| 파일 | bytes | sha256 (12자) |
| --- | --- | --- |
| `01-connect-screen.png` | 99,818 | `430ff51e888e` |
| `02-runs-and-submit.png` | 255,523 | `258ee5421e33` |
| `03-run-live.png` | 260,843 | `4bc50f61de9a` |
| `04-pane-live.png` | 210,056 | `8a59b3dc064d` |
| `05-pane-live-advanced.png` | 225,892 | `092c432af623` |
| `06-pane-live-later.png` | 242,372 | `9816fe59761f` |

## 8. 검증

- `bun test apps/loop-mobile/test` → **47 pass / 0 fail** (신규 showcase 파싱 4건 + 레이아웃 계약 갱신 포함).
- 게이트웨이 pane 표면은 `packages/gateway` 62/62 (선행 pane 구현, 이 태스크에서 회귀 없음 — 게이트웨이 소스 미변경).
- `bun run codegen:check` — 프로토콜 생성물 무변경(Rust/프로토콜 소스 미변경).
- 미해결 리스크: §5의 게이트웨이 결함 4건(범위 밖, 후속 과제 제안). 표준 경로에서는 pane 미러가 불안정하다.
