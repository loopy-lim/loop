# v12 — 실사용 pi TUI 세션이 시뮬레이터 앱에 라이브 미러 (2026-09-26)

**주장:** 운영자가 터미널(ghostty + tmux)에서 실제로 쓰는 pi 대화 세션이, pi-extensions/session-tap.ts tap → 실제 게이트웨이(launchd `kr.ll3.loop.gateway`) session-collector → `GET /v1/sessions`·SSE를 타고 iOS 시뮬레이터의 Loop 앱에 **같은 대화가 라이브로** 나타난다. 유료 모델 호출은 운영자 승인 한도(1–2회 소형)를 지켰고 전량 아래에 공개한다.

## 스크린샷 ↔ 증명 매핑

| # | 파일 | 증명 | 화면에서 확인되는 것 |
| --- | --- | --- | --- |
| 01 | `01-chats-live-sessions.png` | tap 세션이 앱 채팅 목록에 구분 라벨과 함께 표시 | CHATS(게이트웨이 run 카드들) 아래 **SESSIONS 섹션**에 실세션 6건 — `pi · run_id = null (no run correlation)` 라벨, 상태 점(● live 3건 / ● ended 3건). `01a0ddfc-e465-74d4…`는 본 데모 세션 |
| 02 | `02-live-streaming-turn1.png` | **턴 1 스트리밍 비트** — 터미널(왼쪽)과 앱(오른쪽)이 같은 대화를 같은 순간에 렌더 | 터미널: 입력 `1+1은? 정확히 한 단어로만 답해.` + `⋯ Working` / 앱: 같은 입력이 유저 버블로 도착 + 헤더 `● running` |
| 03 | `03-live-completed-turn1.png` | **턴 1 완료** — 툴 호출과 최종 응답까지 양쪽 동기화 | 터미널: `Thinking…`, `[skill] using-superpowers:1-200`, 응답 `돌`, 푸터 `$0.038 (sub)` / 앱: 같은 프롬프트 버블, **툴 카드** `✓ read /Users/loopy/.agents/skills/using-super… done`, 같은 응답 `돌` |
| 04 | `04-live-two-turns-final.png` | **턴 2까지 누적된 최종 전사** — 다중 턴 라이브 성장 | 터미널: 2턴 전체(입력 2건·`돌`·`넷`·총액 `$0.049 (sub)`) / 앱: 타임스탬프 `23:04 → 23:05`로 동일 6행(유저 2·툴카드 1·어시스턴트 2) |

원본(raw) 캡처는 같은 디렉터리에 보존: `raw-02-conversation-open.png`(앱 진입 시 세션의 정직한 빈 상태 "Nothing here yet"), `raw-03/04-*`(턴 1 스트리밍/완료), `raw-05/06-*`(턴 2 완료 — 턴이 캡처 시점 전에 끝나 05·06이 동일 프레임).

## 파이프라인과 관찰된 사실

```text
pi TUI (tmux v12demo, ghostty 창)
  └─ pi-extensions/session-tap.ts  (settings.json extensions 등록, interactive 로드)
      └─ unix socket $TMPDIR/loop-session-collector.sock
          └─ packages/gateway session-collector (launchd kr.ll3.loop.gateway — 실서비스)
              ├─ GET /v1/sessions        → 세션 인벤토리 (lane "pi", run_id null)
              ├─ GET /v1/sessions/{id}/events (SSE) → 앱 타임라인
              └─ GET /v1/sessions/{id}/attachments (이번 시연 미사용)
```

- 데모 세션 id: `01a0ddfc-e465-74d4-9f09-fdb57b9ebae7`. 시작 직후 `{"sessionId":"01a0ddfc-e465-…","runId":null,"taskId":null,"workerId":null,"lane":"pi","state":"live"}` 등록을 `curl /v1/sessions`로 확인했고, `/exit` 후 `state:"ended"`로 정직 종료됨(01 캡처에 ended 행으로 함께 보임).
- 앱은 `LOOP_SHOWCASE_CONNECT=1`로 실게이트웨이에 연결(토큰리스), `LOOP_SHOWCASE_OPEN_SESSION=<id>`로 대화 진입 — v11 이후 이어진 "사람의 탭과 동일 핸들러" 경로.
- **fail-open 실증:** tap 등록 이후 기기에서 시작된 다른 pi 프로세스들(연산자의 다른 세션)이 별도 설정 없이 같은 collector에 자동 등록되어 같은 목록에 나타났다(01의 live/ended 혼재 행들). 세션 간 간섭 없음.
- **경계 준수:** tap은 pi 프로세스 안에서 입력/메시지/툴/턴 이벤트만 관찰해 NDJSON으로 전송한다(송신자 소유는 pi 확장). loop-core에는 pane/pi 개념이 전혀 추가되지 않았고, 이 태스크의 저장소 쓰기는 `apps/loop-mobile` 없이 문서뿐 — 앱·게이트웨이 코드는 선행 태스크 산출물을 그대로 사용했다.

## 유료 호출 공개 (전량)

운영자 사전 승인: "최소 유료 1~2회 소형 호출, 전량 공개". 실제 사용 **2회, 모델 `(openai-codex) gpt-5.5 · medium`**, pi 푸터 기준:

| 턴 | 프롬프트 (tmux send-keys로 입력) | 응답 | 비용 (pi 사용량 보고치) |
| --- | --- | --- | --- |
| 1 | `1+1은? 정확히 한 단어로만 답해.` | `돌` | $0.038 (sub) |
| 2 | `그럼 2+2는? 역시 한 단어로만.` | `넷` | +$0.011 (누계 $0.049, sub) |

합계 **$0.049 상당** — `(sub)`는 운영자의 Codex 구독 플랜 과금이라는 뜻(토큰당 API 청구 없음). 프롬프트·응답 전문은 위 표와 스크린샷 그대로다. 턴 1에서 모델이 운영자 환경의 using-superpowers 스킬을 읽는 `read` 툴 호출 1건이 실시간 툴 카드로 함께 미러링되었다(03).

## 환경·한계 (정직 기록)

- **실기기 없음** — iPhone 17 시뮬레이터(UDID `99B087B5-DEF6-4CF1-9177-81A5DE564CFC`). 카메라 QR 스캔 등 실기기 전용 경로는 미검증.
- 시뮬레이터에서 Tailscale 주소(`100.80.133.120:18477`) 접속이 실패해(auto-connect failed — 시뮬레이터 NAT가 utun 경로를 못 감) **같은 launchd 게이트웨이가 함께 바인드한 루프백 `127.0.0.1:18477`**을 사용했다. 실기기는 Tailscale 주소를 쓴다(v10이 그 경로를 증명).
- 터미널 컷은 `screencapture -l<windowID>`(ghostty 창 32558, Retina 2x)로 창 단위 캡처했다. 창이 화면 뷰포트 밖에 걸쳐 있어도 현재 레이어를 반환함을 이번 캡처로 확인했다(05·06 동일 프레임은 staleness가 아니라 턴 완료가 캡처보다 빨랐기 때문).
- 앱 번들(21:55 설치)이 Sessions 섹션 소스(21:45)보다 새 것이라 재빌드 없이 사용 — `01`에 섹션이 렌더되는 것으로 확인.
- 게이트웨이 session-collector는 프로세스 메모리 + 소켓만 있고 프레임 로그를 파일에 쓰지 않는다(재시작 시 세션 인벤토리 초기화, tap이 재등록). 서버 측 2차 증거는 위 `curl /v1/sessions` 스냅샷이 전부다.
- 본 문서 작성 중 무결성: 스크린샷 9장의 md5는 전부 상이(05/06 동일 프레임 페어 제외 — 의도된 중복). 운영자의 다른 창 화면은 실수로 캡처한 1장을 즉시 폐기했고 증거에 포함되지 않았다.

## 재실행

```bash
cd /Users/loopy/dev/ll3/loop
bash docs/research/simulator-showcase/v12/capture.sh
```

스크립트가 tap 등록(멱등) → tmux pi 기동 → 세션 등록 확인 → 앱 3회 런치·캡처 포인트 안내까지 자동화한다. **유료 프롬프트 2회는 스크립트가 멈춰서 운영자 승인 하에 `tmux send-keys`로 직접 넣는다**(본 캡처 때처럼). 수동 절차 전문은 `capture.sh` 헤더 주석 참조.
