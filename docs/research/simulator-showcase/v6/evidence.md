# v6 — 1회 로그인 유지 시연 (로그인 1번 → 재실행 자동 연결 → 로그아웃 리셋)

> **증거 분류:** 아래 01–04는 iPhone 17 시뮬레이터(UDID `99B087B5-…`, iOS 26.2)의 **실제 Loop 앱** 화면이며, 이 문서의 작성 태스크(`login-persistence-showcase`)가 `xcrun simctl io screenshot`으로 **직접 재캡처해 1차 검증**했다. 이전 캡처(태스크 `keychain-login-implementation`, `apps/loop-mobile/showcase/v6/` 09:59–10:01)도 육안 검증했으나 본 문서의 증거는 모두 10:05–10:07 재실행 분이다. 데이터는 **모두 가짜 데모 값**(`demo-gateway.ts`, 루프백 127.0.0.1:18499, bearer 상수 `demo-token` — 자격 증명 아님). **모델 호출 0회, 유료 비용 0, 실기기 없음.**
>
> **정책 근거:** `docs/decisions/2026-xx-app-credential-persistence.md` — AGENTS.md "자격증명 비저장"의 **명시적 개정**: 게이트웨이 bearer+host:port는 **OS 보안 키체인(iOS Keychain)에만** 저장(디바이스 전용·백업/마이그레이션 금지·로그아웃 즉시 삭제). 일반 파일·AsyncStorage·SQLite·로그 저장은 계속 금지. 구현: `apps/loop-mobile/src/auth/{credentialStore,keychain,restore}.ts`, 화면 배선: `apps/loop-mobile/src/App.tsx`.

## 재검증 시나리오 (10:05–10:07, 2026-09-26)

| 시각 | 단계 | 실행 | 기대 | 결과 |
| --- | --- | --- | --- | --- |
| 10:05 | 전제 | env 없이 기동 | 저장 항목 없음 → 수동 Connect | ✅ 수동 Connect(기본 host/port, 토큰 빈 필드) |
| 10:06 | 1차 로그인 | `LOOP_SHOWCASE_CONNECT=1` + bearer/host/port | 검증된 연결 후 키체인 저장 → Chats | ✅ [01](01-first-login-chats.png) |
| 10:06 | 종료→재실행 | `simctl terminate`(프로세스 소멸 확인) → **env 없이** 기동 | 키체인 복원 → 자동 연결 → Chats 직행 | ✅ [02](02-relaunch-autoconnect-chats.png) |
| 10:07 | 자동 로그아웃 | `CONNECT=1` + `LOGOUT=1`(6s 지연) | 재연결 후 Log out 핸들러 → 수동 화면 | ✅ [03](03-after-logout-connect-screen.png) |
| 10:07 | 로그아웃 후 재실행 | **env 없이** 기동 | 저장 항목 삭제됨 → 수동 Connect(기본값) | ✅ [04](04-relaunch-after-logout-manual.png) |

## 단계별 화면

| 단계 | 화면 | 확인 가능한 내용 |
| --- | --- | --- |
| 1 | [01-first-login-chats.png](01-first-login-chats.png) | 첫 로그인(런치 env auto-connect — 사람의 Connect 탭과 동일 핸들러) 직후 Chats: new-run 카드, 채팅 행(상태 점 배지), 하단 **Log out** 버튼. 토큰은 어디에도 렌더되지 않음 |
| 2 | [02-relaunch-autoconnect-chats.png](02-relaunch-autoconnect-chats.png) | 종료 후 **무 env 재실행**: Connect 화면을 거치지 않고 Chats 직행(키체인 복원+자동 연결). 상태바 10:06, 채팅 메타 타임스탬프가 01 대비 +28s 갱신(재 fetch = 새 세션의 실제 연결) |
| 3 | [03-after-logout-connect-screen.png](03-after-logout-connect-screen.png) | Log out 실행 직후: 수동 Connect로 복귀, 토큰 필드 **빈 플레이스홀더**(bearer 미표시), 당시 세션의 host/port(127.0.0.1:18499)만 프리필 |
| 4 | [04-relaunch-after-logout-manual.png](04-relaunch-after-logout-manual.png) | 로그아웃 후 무 env 재실행: 자동 연결 없이 수동 Connect, host/port가 **기본값**(tailnet 호스트:18477) — 저장 항목이 삭제되어 복원할 것이 없음을 화면으로 증명 |

## 자격 증명 비노출 검증 (`[credential]=[redacted]` 계열)

- **런치 로그:** AppDelegate는 showcase env의 **키 이름만** 로깅한다 — `xcrun simctl spawn $UDID log show` 실측:
  - `showcase-launch: keys=[autoConnect,bearer,host,port]` (10:06:05, 1차 로그인)
  - `showcase-launch: keys=[autoConnect,autoLogout,autoLogoutDelayMs,bearer,host,port]` (10:07:02, 로그아웃 실행)
  - bearer **값**은 로그 어디에도 없음(AGENTS.md 비로그 유지).
- **화면:** 4장 모두 토큰 재질이 렌더되지 않는다. Connect 화면의 TOKEN 필드는 상시 빈 플레이스홀더.
- **저장 위치:** iOS Keychain 단일 항목(`credentialStore.ts` — username=`host:port`, password=bearer, 디바이스 전용). 데모 bearer는 상수 `demo-token`이므로 이번 시연에서 저장값 자체가 민감하지 않으나, 경로는 실제 자격 증명과 동일하다.

## 운영자 재실행 (시뮬레이터 전용, 유료 호출 0)

```bash
cd /Users/loopy/dev/ll3/loop/apps/loop-mobile
bun install && (cd ios && pod install)
bash scripts/build-ios-simulator.sh       # Release 빌드 + 부팅된 시뮬레이터에 설치·기동
bun scripts/demo-gateway.ts 18499 &       # 가짜 데이터 게이트웨이 (루프백 전용, bearer: demo-token)

UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
BUNDLE=org.reactjs.native.example.LoopMobile
OUT=docs/research/simulator-showcase/v6

# (선택) 초기화: 마지막 상태가 로그아웃이면 이미 저장 항목이 없다.
#   아니면 아래 3번을 먼저 실행해 키체인을 비운 뒤 시작한다.

# 1) 첫 로그인: auto-connect(사람의 Connect 탭과 동일 핸들러) → 키체인 저장
xcrun simctl terminate $UDID $BUNDLE 2>/dev/null; sleep 1
SIMCTL_CHILD_LOOP_SHOWCASE_BEARER=demo-token SIMCTL_CHILD_LOOP_SHOWCASE_HOST=127.0.0.1 \
SIMCTL_CHILD_LOOP_SHOWCASE_PORT=18499 SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
  xcrun simctl launch $UDID $BUNDLE
sleep 9 && xcrun simctl io $UDID screenshot $OUT/01-first-login-chats.png

# 2) 종료 → 무 env 재실행 → 키체인 자동 복원(Chats 직행)
xcrun simctl terminate $UDID $BUNDLE; sleep 2     # 프로세스 소멸 확인: ps aux | grep LoopMobile.app
xcrun simctl launch $UDID $BUNDLE
sleep 9 && xcrun simctl io $UDID screenshot $OUT/02-relaunch-autoconnect-chats.png

# 3) 재연결 후 자동 로그아웃(6s 지연) → 수동 Connect 복귀 + 키체인 삭제
xcrun simctl terminate $UDID $BUNDLE 2>/dev/null; sleep 1
SIMCTL_CHILD_LOOP_SHOWCASE_BEARER=demo-token SIMCTL_CHILD_LOOP_SHOWCASE_HOST=127.0.0.1 \
SIMCTL_CHILD_LOOP_SHOWCASE_PORT=18499 SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
SIMCTL_CHILD_LOOP_SHOWCASE_LOGOUT=1 SIMCTL_CHILD_LOOP_SHOWCASE_LOGOUT_DELAY_MS=6000 \
  xcrun simctl launch $UDID $BUNDLE
sleep 14 && xcrun simctl io $UDID screenshot $OUT/03-after-logout-connect-screen.png

# 4) 무 env 재실행 → 자동 복원 없음(수동 Connect, 기본 host/port) = 삭제 증명
xcrun simctl terminate $UDID $BUNDLE 2>/dev/null; sleep 2
xcrun simctl launch $UDID $BUNDLE
sleep 9 && xcrun simctl io $UDID screenshot $OUT/04-relaunch-after-logout-manual.png

# (선택) 레닥션 로그 실측 — bearer 값 없이 키 이름만 출력됨
xcrun simctl spawn $UDID log show --last 5m --style compact \
  --predicate 'eventMessage CONTAINS "showcase-launch"'
```

> 시뮬레이터에서는 앱을 지워도 키체인 항목이 남을 수 있다(실기기와 다른 동작). 재현 시 "첫 로그인" 전에 저장 항목이 있으면 3번(로그아웃)을 먼저 실행해 비운다 — 이번 재검증도 이 전제 확인(10:05 수동 Connect)으로 시작했다.

## 한계·미달

- **자동 복원 실패 폴백(게이트웨이 다운/401 → 수동 화면 + 저장 항목 유지)은 이번 캡처에서 미시연.** 단위 테스트로는 검증됨(`apps/loop-mobile/test/restore.test.ts`, 91 pass 전체). 화면 증거가 필요하면 demo-gateway를 내린 채 재실행하는 후속 캡처로 보강 가능.
- 02는 "같은 화면의 재캡처"이므로 종료→재실행의 물리적 증거는 상태바 시각(10:06)과 채팅 메타 타임스탬프(+28s), 종료 직전 `ps` 확인(프로세스 소멸)으로 뒷받침한다. 연속 영상이 필요하면 후속 과제.
- 데스크톱(Tauri) 동일 정책 적용은 결정 문서 §D3에 후속으로 기록됨(이번 범위 밖, 미구현).
- 이번 시연의 저장값은 상수 `demo-token`이다. 실제 자격 증명을 사용한 유출 검증은 수행하지 않았으며(금지), 화면·로그 비노출 경로만 검증했다.
