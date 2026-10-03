# v5 — SafeArea + Codex-like GUI redesign (task `ui-codex-redesign`)

> **증거 분류:** 아래 01–08은 iPhone 17 **시뮬레이터의 실제 Loop 앱** 화면이다. 데이터는 **모두 가짜 데모 값**이다(`apps/loop-mobile/scripts/demo-gateway.ts`가 로컬 루프백(127.0.0.1)에서 서빙하는 `demo-*` id/텍스트). **모델 호출 0회, 유료 비용 0.** 실제 pi 세션·run과 무관하며 bearer도 상수 `demo-token`(자격 증명 아님)이다. v4와 달리 실행 중 steer의 전달 증거(접힘)까지 화면으로 확인된다 — 가짜 소스임을 이 문서로 명시한다.

## 디자인 시스템 (`src/ui/tokens.ts`)

- **색 역할 토큰(다크 매핑):** `bg #0D1117`, 표면 `surface/surfaceAlt/userBubble`, 잉크 3단 `ink/inkMute/inkFaint`, CTA 흰색 필(`cta/ctaInk/ctaDisabled`), 상태 삼종 `ok #3FB950 / warn #D29922 / danger #F85149` — 상태색은 글리프+텍스트 액센트로만 쓰고 표면 채움 금지(docs/design/ui-ux-guidance.md §1/§4/§5). 호출점에서 hex 금지, 역할 이름만.
- **타이포 스케일:** display 26/32·700, title 17/24·600, body 15/22, caption 12/17, mono 12/18(Menlo).
- **간격:** 4pt 기반 `space 4/8/12/16/24/32`, radius 8/12/16/pill, 콘텐츠 컬럼 최대폭 480(중앙 정렬).
- **글리프 어휘(`src/ui/glyphs.ts`):** 상태 `◐ ✓ ✕`, run 배지 `●`, steer `↳`, 접기 `▸ ▾`, 전송 `↑` — 역할당 단일 코드포인트.

## SafeArea 처리 (`react-native-safe-area-context` 5.10.0)

- 루트 `SafeAreaProvider`(App) → 공용 `Screen`이 top/bottom inset을 패딩으로, 가로 노치는 컬럼 좌우 마진으로 소비. ConversationScreen은 자체 레이아웃이라 직접 소비.
- 컴포저는 홈 인디케이터 `insets.bottom`을 패딩으로 존중하고, 키보드 표시 중에는 0으로 양도한다(iOS KAV가 홈 인디케이터 영역을 포함한 키보드 높이로 패딩 — 이중 간격 방지, `ui/useKeyboardVisible.ts`).
- 가로 회전 시 컬럼이 노치 쪽 inset을 피해 비대칭 마진으로 배치됨(07 증거).

## 단계별 화면

| 단계 | 화면 | 확인 가능한 내용 |
| --- | --- | --- |
| 1 | [01-connect-screen.png](01-connect-screen.png) | 상태바와 제목 분리(SafeArea), 라벨링된 입력, 빈 토큰 시 비활성 CTA |
| 2 | [02-chats-list.png](02-chats-list.png) | 대형 타이틀, new-run 카드, 채팅 행(제목+상태 점 배지+최근 활동 메타), 세션 섹션의 `run_id = null` 정직 표기 |
| 3 | [03-conversation-running.png](03-conversation-running.png) | 사용자 버블(우측)/어시스턴트 텍스트(좌측) 구분, 툴 카드 상태 아이콘(✓ done 접힘 / ◐ running… 펼침+mono args), 실행 중 배지, 하단 고정 컴포저(Steer 플레이스홀더, 원형 전송 버튼) |
| 4 | [04-conversation-steered.png](04-conversation-steered.png) | steer 마커 `↳ steer · delivered · "…"` 접힘 — 접수→큐→세션 내 `source=steer` 확인의 3단 피드백(D4 §4) |
| 5 | [05-conversation-raw.png](05-conversation-raw.png) | raw 토글(헤더)로 전환한 터미널 목록 섹션 |
| 6 | [06-terminal-mirror.png](06-terminal-mirror.png) | PaneScreen: 스냅샷 출처 고지, 다크 터미널 표면, rev/following 메타 |
| 7 | [07-landscape-chats.png](07-landscape-chats.png) | 가로 모드: 컬럼이 노치 inset을 피함(비대칭 마진), Mac 화면 캡처(Simulator 창) |
| 8 | [08-composer-keyboard.png](08-composer-keyboard.png) | 키보드 회피: 컴포저가 키보드 바로 위에 부착(추가 간격 0), 캐럿 표시 |

## 재실행 (시뮬레이터 전용, 유료 호출 0)

```bash
cd /Users/loopy/dev/ll3/loop/apps/loop-mobile
bun install && (cd ios && pod install)   # react-native-safe-area-context 추가분
bash scripts/build-ios-simulator.sh       # Release 빌드 + 부팅된 시뮬레이터에 설치·실행
bun scripts/demo-gateway.ts 18499 &       # 가짜 데이터 게이트웨이 (루프백 전용)

UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
xcrun simctl terminate $UDID org.reactjs.native.example.LoopMobile
SIMCTL_CHILD_LOOP_SHOWCASE_BEARER=demo-token SIMCTL_CHILD_LOOP_SHOWCASE_HOST=127.0.0.1 \
SIMCTL_CHILD_LOOP_SHOWCASE_PORT=18499 SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_RUN=run_demo_running_0001 \
SIMCTL_CHILD_LOOP_SHOWCASE_STEER="Focus on the slow-consumer reset path" \
  xcrun simctl launch $UDID org.reactjs.native.example.LoopMobile
# ~20초 후: steer가 자동 제출되고 demo 게이트웨이가 steer_queued → user_message(source=steer)로 접어준다
xcrun simctl io $UDID screenshot v5.png
```

 steer 엔드포인트는 `run_demo_running_0001`만 202로 받고 1.2초 뒤 프레임을 미러링한다(다른 run은 실제 게이트웨이처럼 502 `steer_unavailable`). 새 run 제출(POST /v1/runs)도 202를 돌려준다.

## 미달·한계

- 가로 캡처(07)는 `simctl io screenshot`이 회전 버퍼를 그대로 내보내는 관계로 Simulator 창의 Mac 화면 캡처로 대체했다. 시뮬레이터에 Mac 하드웨어 키보드가 연결되어 있으면 소프트 키보드가 뜨지 않으므로(08 캡처 조건) `ConnectHardwareKeyboard=false` 필요.
- 이미지 첨부는 M2 미착속(v1 계약대로 `image_count`만) — 03의 카드 상태는 가짜 스트림 기준이며, 실제 pi 세션 재현은 v4 노트의 운영자 승인 절차를 따른다.
