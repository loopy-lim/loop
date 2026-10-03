# v4 — GUI 대화 시뮬레이터 시연 (부분 수용)

> **증거 분류:** 아래 01–04는 iPhone 17 **시뮬레이터의 실제 Loop 앱** 화면이다. `04`의 사용자 메시지·어시스턴트 텍스트·툴 카드는 기존 pi 세션의 실제 이벤트를 데모 확장(`demo-tap-extension.ts`)이 로컬 수집기 → 게이트웨이 session SSE로 전달한 것이다. **실행 중 steer가 다음 턴에 반영됐다는 시연은 아니다.** 04의 컴포저에는 `502 steer_unavailable` 오류가 표시된다. fake 프레임을 실제 결과처럼 표시하지 않는다.

## 단계별 화면

| 단계 | 화면 | 확인 가능한 내용 |
| --- | --- | --- |
| 1 | [01-connect-screen.png](01-connect-screen.png) | 시뮬레이터 앱 연결 화면 |
| 2 | [02-chats-list.png](02-chats-list.png) | chats 목록과 세션 진입점 |
| 3 | [03-conversation-waiting.png](03-conversation-waiting.png) | 세션 스트림 연결 대기 |
| 4 | [04-conversation-live.png](04-conversation-live.png) | pi 입력 버블, 접힌 `read`/`bash` 카드(`done`), 어시스턴트 최종 텍스트, 컴포저의 steer 실패 표시 |

**미달:** 전달된 steer 마커 및 다음 턴의 `source=steer` 사용자 메시지를 보여주는 스크린샷 없음. 이번 데모에서 실행한 gateway의 steer port가 unavailable(502)이었고, 수동 `pi -e demo-tap-extension.ts` 세션은 run mailbox와 연결되지 않는다. 확장의 input 훅은 pi의 native `interactive|rpc|extension`만 알아서 `source=steer`를 생성하지 못한다. 즉 이미 촬영한 04의 결과를 steer 성공으로 간주할 수 없다. 실제 워커의 run 상관 및 mailbox 주입 연결 후 별도 재시연이 필요하다. 또한 상단 iOS 상태바가 제목과 겹쳐 화면 다듬기가 남아 있다.

## 호출·데이터 출처

이 문서 작성 중 **신규 유료 호출 0회**. 기존 04 캡처에 사용된 pi 세션의 데모 프롬프트는 `Use the bash tool to run exactly: echo loop-v4-showcase — then answer with one short sentence stating the command output.`였고, 화면에는 `read` 2회 및 `bash` 1회 호출과 `The command output was: loop-v4-showcase.`가 보인다. 이 세션의 모델 ID·토큰 사용량·비용은 현재 보존된 증거만으로 검증할 수 없으므로 추정하거나 1–2회 제한 준수를 주장하지 않는다. **새로운 유료 호출을 승인 없이 실행하지 않는다.** 사진에 bearer 값은 보이지 않는다; 스크린샷의 적목 회귀(`[credential]=[redacted]`)도 이 프롬프트에는 credential 입력이 없으므로 증명하지 않는다.

## 재실행 (시뮬레이터 전용)

사전 조건: `bun install`, Xcode 시뮬레이터, 본인 게이트웨이 설정 및 테스트용 토큰. 보안상 bearer를 명령 이력·문서에 남기지 않는다. 토큰 발급 절차는 [`../../app-device-install.md`](../../app-device-install.md) §3.2 참조. **아래 pi 명령은 모델 호출 비용이 발생할 수 있다: 운영자 승인 후에만 실행.** run 상관 없는 standalone 세션이므로 steer 성공을 재현하는 명령은 아니다.

```bash
cd /Users/loopy/dev/ll3/loop
# 현재 환경에 맞는 게이트웨이 설정을 로드한 후 실행; 별도 터미널에서 유지.
# 표준 gateway가 SSE 단절 시 중단되면 데모 한정 wrapper를 사용한다.
set -a; . "$HOME/.loop/gateway.env"; set +a
export LOOP_GATEWAY_HOST=100.80.133.120 LOOP_GATEWAY_PORT=18477
bun docs/research/simulator-showcase/v4/gateway-wrapper.ts

# 새 터미널 (본인 설정과 승인된 모델로만):
cd /Users/loopy/dev/ll3/loop
LOOP_SHOWCASE_TITLE='v4 showcase — real pi session' \
  pi -e docs/research/simulator-showcase/v4/demo-tap-extension.ts
# pi 대화에서 위의 단일 프롬프트 실행. 데모 확장은 실제 pi 이벤트를 collector socket으로 보낸다.

# 새 터미널: gateway 인증 토큰은 app-device-install.md §3.2에 따라 메모리에만 발급.
UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..
# TOKEN 환경변수는 로컬에서만 설정; 화면에 노출하거나 로그로 출력하지 않는다.
SIMCTL_CHILD_LOOP_SHOWCASE_BEARER="$TOKEN" SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
  xcrun simctl launch "$UDID" org.reactjs.native.example.LoopMobile
mkdir -p docs/research/simulator-showcase/v4
xcrun simctl io "$UDID" screenshot docs/research/simulator-showcase/v4/02-chats-list.png
# 앱에서 해당 세션을 탭하고 스트림이 도착하면:
xcrun simctl io "$UDID" screenshot docs/research/simulator-showcase/v4/04-conversation-live.png
```

`LOOP_GATEWAY_HOST`는 예시 Tailscale IP이므로 각 환경에서 실제 승인된 바인드 주소로 변경한다. `gateway-wrapper.ts`는 프로덕션 gateway 코드를 수정하지 않고 SSE disconnect unhandled rejection만 가로채는 데모 우회다. 클라이언트 연결 해제에서 발생한 오류를 숨기는 방식은 운영용 수정이 아니다. 실제 run-steer 시연에는 run에 매핑된 worker 세션, 작동하는 steer bridge와 pi mailbox 주입, tap의 `source=steer` 분류가 모두 필요하다.
