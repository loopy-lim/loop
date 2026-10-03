# iOS 시뮬레이터 쇼케이스 — herdr-as-app · 앱 → 게이트웨이 → 실제 run/pane

- **헤더 = 스테이터스바 대체 검증 (2026-09-27):** [`review-header/`](review-header/) — 아일랜드 중앙·좌 제목/우 액션 헤더의 좌우 배치 컷(chats·대화), 헤더 코너 아이콘 탭 → 확인 얼럿(메뉴 표면), destructive 확정 → Connect, 무 env 재런치 유지 5컷 + 픽셀 실측(아일랜드 밴드·하부 인셋 존 밝은 콘텐츠 **0 px**, 바닥 200행 잔재 **0 px**). 요약은 [`docs/findings/header-redesign-verification.md`](../../../findings/header-redesign-verification.md), 재실행은 `review-header/capture.sh`. **모델 호출 0회.**
- **로그아웃 이동 + 위계 정돈 검증 (2026-09-27):** [`review-latest/`](review-latest/) — 조용한 목록 끝 Log out 행(잉크 rgb(130,136,142) 실측), 확인 얼럿, destructive 확정 → 수동 Connect, 무 env 재런치 로그아웃 유지까지 5컷. 요약은 [`docs/findings/logout-polish-verification.md`](../../../findings/logout-polish-verification.md). **모델 호출 0회.**
- **01~06 세션 네이밍 (2026-09-27):** [`review-latest/01~06-*.png`](review-latest/) — 스크립트 세션 네이밍 규칙 컷(아래 §세션 네이밍 캡처 절차).
- **v13 원격 스폰 쇼케이스 (2026-09-27):** [`v13/`](v13/) — 시뮬레이터 앱 chats 홈 **"New TUI session" 탭 한 번**이 `POST /v1/sessions/spawn` → 맥 `loop` tmux 세션에 **새 창에서 실제 pi TUI 구동** → tap 자동 등록 → **앱이 ~1.2s 만에 세션 자동 발견·자동 오픈** 후 같은 대화를 라이브 미러하는 6컷(스폰 전 chats, 자동 오픈, 호스트 터미널 전사, 턴 1 인플라이트, 2턴 최종, 나란히 최종). **실모델 출력 — 유료 2회 gpt-5.5, 합계 $0.048 상당(sub), 전량 공개**는 [`v13/evidence.md`](v13/evidence.md) §유료 호출 공개. 검증이 잡아낸 결함 3건(RN 번들 깨는 import/주석 오류 2건 + launchd PATH `spawn_tmux_unavailable`)은 [`docs/findings/session-spawn-verification.md`](../../findings/session-spawn-verification.md). 재실행은 [`v13/capture.sh`](v13/capture.sh).
- **v12 실사용 pi 세션 라이브 미러 (2026-09-26):** [`v12/`](v12/) — 운영자가 tmux에서 실제로 쓰는 **pi TUI 세션**(`pi-extensions/session-tap.ts` tap)이 실제 게이트웨이 collector(launchd `kr.ll3.loop.gateway`)를 타고 시뮬레이터 앱에 **같은 대화가 라이브로** 렌더되는 나란히 컷 4장: chats 목록의 SESSIONS 섹션(`pi · run_id = null` 구분 라벨, 01), 턴 1 스트리밍 비트(터미널 `⋯ Working` ↔ 앱 `● running`, 02), 완료(툴 카드까지, 03), 2턴 누적 전사(04). **실모델 출력 — 유료 2회 gpt-5.5, 합계 $0.049 상당(sub), 프롬프트·응답 전량 공개**는 [`v12/evidence.md`](v12/evidence.md) §유료 호출 공개. 재실행은 아래 §운영자 재실행 (v12).
- **v11 최소 재설계 전/후 비교 (2026-09-26):** [`v11/`](v11/) — 결정 `2026-xx-minimal-design-spec.md`(simple is best 절제 원칙) 적용 앱을 v8/v9 대표 컷과 나란히 비교한 합성 6장(chats 목록 · 툴카드 대화 · 스트리밍 도착 · 하이라이트 코드 · 컴포저 첨부 · 빈 상태) + AFTER 원본 6장. 캡처 전 실제 게이트웨이 200 두 주소 기록 + demo 게이트웨이(18589) 200 하드 게이트, 스크립트 세션(v8/v9와 동일 `LOOP_SHOWCASE_*` 훅), **모델 호출 0회**. 스펙 준수 감사(호출부 hex 0 · `elevation.card` 0 · raw fontSize 0 · `bun test apps/loop-mobile` 227 pass)는 [`v11/evidence.md`](v11/evidence.md) §스펙 준수 감사. 재실행은 아래 §운영자 재실행 (v11).
- **v10 QR 페어링 (2026-09-26):** [`v10/capture.sh`](v10/capture.sh) + 스크린샷 3장 — CLI `loop pair`가 렌더링하는 `loop://connect?host=…&port=…` 페이로드(`01-cli-pair-qr.png`, QR에 비밀 없음 — 토큰리스 전용 표면)를 딥링크로 주입해 연결(`02-deeplink-connect-chats.png`)하고, 무 env 재실행에서도 키체인 복원으로 연결 유지(`03-relaunch-stays-connected.png`). 자동화 범위는 §v10 요약 명시. 결정 `docs/decisions/2026-xx-qr-pairing.md`. **모델 호출 0회, 유료 비용 0.** 재실행은 아래 §운영자 재실행 (v10).
- **v9 첨부·구문강조·뷰티패스 (2026-09-26):** [`v9/capture.sh`](v9/capture.sh) + 스크린샷 5장 + [`v9/evidence.md`](v9/evidence.md) — (1) 컴포저 사진 첨부(썸네일 스트립 → 스크립트 전송 → **관찰된 user_message 프레임으로 사용자 버블에 인라인 렌더**), (2) 코드블록 구문 강조(의존성 0 토크나이저 — TS 카드+Copy code), (3) 뷰티 패스 룩(Chats+대화). 첨부 이미지는 demo 게이트웨이가 코드로 생성한 PNG 2장, **모델 호출 0회**. 캡처가 실기기 결함 1건(RN Blob 생성자가 typed-array 파트 거부 → `uploadSessionAttachment`를 런타임 Blob 시그니처로 수정, 203 tests pass)과 demo 결함 1건을 잡아냈다. 재실행은 아래 §운영자 재실행 (v9).

- **v8 Codex 디테일 체크리스트 (2026-09-26):** [`v8/capture.sh`](v8/capture.sh) + 스크린샷 5장 — 결정 `docs/decisions/2026-xx-codex-detail-checklist.md`의 P0 항목을 demo 게이트웨이 가짜 데이터(스크립트 세션)로 시연. 스크린샷 ↔ 체크리스트 매핑과 재실행은 아래 §v8 요약. **모델 호출 0회, 유료 비용 0.**
- **v7 토큰리스·첨부·데스크톱 (2026-09-26):** [`v7/`](v7/) — Tailscale 바인딩 게이트웨이 무 bearer `GET /v1/runs` → 200 확인 후 iOS 시뮬레이터 첫 실행 Chats(`01-tokenless-first-launch-chats.png`), 로컬 생성 이미지와 파일 카드 대화(`02-attachment-conversation.png`), 재빌드한 Tauri 앱 실행 화면(`03-desktop-app.png`). 데스크톱 연결 성공/첨부 패리티는 스크린샷만으로 확인되지 않음. 모델 호출 없음.
- **v6 1회 로그인 유지 (2026-09-26):** [`v6/evidence.md`](v6/evidence.md) — 로그인 1번 → 앱 종료·재실행 시 **키체인 자동 복원으로 Chats 직행** → 로그아웃 시 저장 삭제·수동 Connect 복귀를 시뮬레이터 실측 스크린샷 4장으로 증명. 정책은 결정 문서(AGENTS.md 비저장 규칙의 명시적 개정): 게이트웨이 자격 증명은 **OS 보안 키체인에만** 저장(디바이스 전용, 로그아웃 즉시 삭제), 파일/AsyncStorage/로그 저장은 계속 금지, 토큰은 화면·로그 어디에도 미노출(런치 로그는 키 이름만: `showcase-launch: keys=[…]`). 데이터는 demo 게이트웨이 가짜 값(bearer 상수 `demo-token`) — **모델 호출 0회, 유료 비용 0.** 원 캡처는 태스크 `keychain-login-implementation`(`apps/loop-mobile/showcase/v6/`), 1차 재실행·재캡처 검증은 `login-persistence-showcase`.
- **v5 SafeArea + Codex 스타일 재설계 (2026-09-26):** [`v5/evidence.md`](v5/evidence.md) — SafeArea(노치·상태바·홈 인디케이터·키보드 회피)와 Codex 앱 스타일 UI를 시뮬레이터 실측 스크린샷 8장으로 증명. 대화 화면은 실행 중(라이브 이벤트 렌더링) 촬영이며 툴 카드 상태 아이콘·steer 마커까지 확인. 데이터는 demo 게이트웨이의 가짜 값 — **모델 호출 0회, 유료 비용 0.** 원 캡처는 태스크 `ui-codex-redesign`(`apps/loop-mobile/showcase/v5/`), 이관·육안 재검증은 `showcase-v5-screens`.
- **v4 GUI 대화 시연 (부분 수용):** [`v4/evidence.md`](v4/evidence.md) — 실제 pi 세션의 입력·어시스턴트 텍스트·툴 카드가 게이트웨이 세션 SSE를 통해 시뮬레이터에 렌더됨. `v4/01-connect-screen.png` ~ `v4/04-conversation-live.png`. **steer 다음 턴 반영은 미시연**: 04에는 `502 steer_unavailable`이 표시된다. 신규 유료 호출 0회; 기존 캡처의 사용량/비용은 검증되지 않음. 재실행 명령·데모 확장의 한계는 evidence 참조.
- **이전 시연:** **v3 (2026-09-26)** — **herdr-as-app**: 실행 중 워커의 pane 화면 버퍼가 게이트웨이 SSE를 타고 앱의 다크 터미널 뷰(Menlo 모노스페이스 · 자동 스크롤 · 중앙 정렬 · `rev N · following` 메타)로 **라이브로** 흐른다. Codex 앱이 에이전트 작업 터미널을 pane으로 보여주는 것과 같은 경험을 Loop 앱으로 구현한 것이 이 v3의 정의다.
- **v3 결과 문서:** [`v3/evidence.md`](v3/evidence.md) — 단계별 시연, 서버 측 프레임(570건)·커서 리플레이, 유료 호출 공개, 발견한 게이트웨이 결함 4건과 데모 래퍼, 재실행 명령
- **v3 스크린샷:** `v3/01-connect-screen.png` ~ `v3/06-pane-live-later.png` (라이브 증거: 같은 pane 뷰가 `rev 427 → 476 → 514`로 진행하며 캡처 시점의 워커 실제 출력을 표시)
- **이력:** v2(deterministic 실제 run), v1(스텁 시대) 기록은 이 파일 하단과 각 디렉터리에 보존

---

## v10 요약 (2026-09-26) — QR 원 페어링

결정 `2026-xx-qr-pairing.md`의 수용 기준 2·3·4(딥링크 연결 + 재시작 유지, 수동 폴백 유지, 비밀 비포함)를 실제 게이트웨이(Tailscale MagicDNS `loopy-macbookpro.tail42f248.ts.net:18477`) 대상 스크린샷 3장으로 증명한다:

| # | 스크린샷 (`v10/`) | 증명 내용 | 화면에서 확인되는 것 |
| --- | --- | --- | --- |
| 01 | `01-cli-pair-qr.png` | CLI 렌더 표면 + 페이로드에 비밀 없음 | Terminal 창의 `loop pair` 출력 — 평문 URL `loop://connect?host=loopy-macbookpro.tail42f248.ts.net&port=18477` + ASCII QR. 페이로드는 연결 위치뿐(token/secret 파라미터 부재 — 파서가 거부) |
| 02 | `02-deeplink-connect-chats.png` | 딥링크 스캔 → 연결 | 01과 동일 페이로드를 콜드 `simctl openurl`로 주입 → OS 열기 확인 배너 승인 → 파싱·프리필·프루브·연결을 거쳐 게이트웨이 연결된 Chats 목록. 수동 타이핑 0회 |
| 03 | `03-relaunch-stays-connected.png` | 재실행 유지 ("stay connected") | launch env 없이 재실행 → 키체인의 토큰리스 설정(host:port + 모드 마커) 자동 복원 → 다시 연결된 Chats 직행 |

**자동화 범위 (정확한 경계):** `simctl openurl`이 **시스템 카메라 스캔의 등가물**이다 — 시스템 카메라가 QR을 스캔해 배너의 `loop://` 링크를 탭하는 것과 앱이 받는 입력은 동일한 딥링크 페이로드다. OS 열기 확인 배너는 스크립트 클릭 1회로 승인하며, 배너는 설치 후 첫 `loop://` 오픈에만 뜨므로 스크립트가 재설치로 이를 결정적으로 만든다. **앱이 하는 일 전부(파싱 → 프리필 → 프로브 → 연결 → 저장 → 재실행 복원)는 프로덕션 코드 경로다.** 실기기 카메라 스캔 UX는 미검증(결정 §4 위험), 수동 host/port 입력 폴백은 제거 없이 유지(결정 D-B 폴백 1). 유료 호출 0회.

## v12 요약 (2026-09-26) — 실사용 pi TUI 세션 → 앱 라이브 미러

| # | 파일 (`v12/`) | 증명 | 화면에서 확인되는 것 |
| --- | --- | --- | --- |
| 01 | `01-chats-live-sessions.png` | tap 실세션이 앱 채팅 목록에 진입 | CHATS(runs) 아래 SESSIONS 섹션 — `pi · run_id = null (no run correlation)` 라벨, ● live/ended 상태 점, 데모 세션 `01a0ddfc-e465…` 포함 6건 |
| 02 | `02-live-streaming-turn1.png` | 턴 1 스트리밍 동기화 | 왼쪽 pi TUI(ghostty/tmux): 입력 + `⋯ Working` / 오른쪽 앱: 같은 입력 버블 + `● running` |
| 03 | `03-live-completed-turn1.png` | 턴 1 완료 + 툴 카드 | 터미널 `Thinking…`·`[skill] using-superpowers`·응답 `돌`·`$0.038 (sub)` ↔ 앱 동일 버블·툴카드(`read … using-super… done`)·응답 `돌` |
| 04 | `04-live-two-turns-final.png` | 2턴 누적 라이브 성장 | 양쪽에 동일한 6행 전사(입력 2·툴카드 1·응답 2, `23:04 → 23:05`), 터미널 누계 `$0.049 (sub)` |

실행 모드: **게이트웨이는 실서비스(launchd)** — 시뮬레이터가 Tailscale 주소에 닿지 못해 같은 서비스의 루프백 바인딩(127.0.0.1:18477) 사용(실기기는 Tailscale 주소, v10 참조). 세션 상태 전이(live→ended)와 다른 pi 프로세스의 자동 등록(fail-open 실증)도 [`v12/evidence.md`](v12/evidence.md)에 기록.

## 운영자 재실행 (v12)

```bash
cd /Users/loopy/dev/ll3/loop
bash docs/research/simulator-showcase/v12/capture.sh   # tap 등록(멱등) + tmux pi + 앱 런치·캡처 안내
# 유료 프롬프트(승인 한도 1~2회 소형)만 스크립트가 멈춘 지점에서 운영자가 직접:
#   tmux send-keys -t v12demo -l '<tiny prompt>'; tmux send-keys -t v12demo Enter
bash docs/research/simulator-showcase/v12/compose.sh   # 나란히 컷 3장 합성 (ImageMagick)
# 전제: 부팅된 시뮬레이터 1대, launchd 게이트웨이 기동. 앱·게이트웨이·tap 코드는 그대로(재빌드 불필요).
```

## v11 요약 (2026-09-26) — 최소 재설계 before/after

| # | 합성 (`v11/`) | BEFORE | AFTER | 비교 포인트 |
| --- | --- | --- | --- | --- |
| 01 | `01-chats-list.png` | v9 refreshed chats | 재설계 앱 Chats | 카드 경계 hairline 하나(그림자 제거 M3), 상태색 예산(§S1) |
| 02 | `02-conversation-tool-card.png` | v8 running chip | 툴카드 대화 | 표면·반경·상태어 색 어휘 유지·정독(§S1/S5) |
| 03 | `03-conversation-streaming-arrival.png` | v8 typing indicator | +8s 비트 후 | entrance 모션 도착 상태(§S6) — 02→03 차이는 신규 행 하나 |
| 04 | `04-conversation-code.png` | v9 syntax code | 코드펜스 카드 | 문법강조 5종 코드펜스 한정, 행 구분선 없음(§S5) |
| 05 | `05-composer-attach.png` | v9 attach thumbnails | 컴포저 첨부 | 근백 반전 CTA 단일 강조(§S1), v9 동일 스크립트 경로 |
| 06 | `06-empty-state.png` | v8 empty state | 빈 상태 | 글리프+2줄 안내만(장식 0) |

**성립 조건:** 설치 번들(19:50)이 토큰 적용 소스(20:41)보다 오래됨을 확인 → Release 재빌드(20:53) 후 캡처해 AFTER가 재설계 토큰을 렌더함을 보장. 캡처 전 실제 게이트웨이 `100.80.133.120:18477`·MagicDNS 주소 모두 200 기록, demo 게이트웨이(루프백 18589, 가짜 데이터) 200 하드 게이트. 12장 MD5 전부 상이. 모바일 전/후 델타는 스펙 §2-1 결론(모바일은 이미 규율됨)대로 미묘 — 데스크톱 패리티 컷(AC-S1-4·AC-S8-2)은 쓰기 범위 밖, 후속. 상세: [`v11/evidence.md`](v11/evidence.md).

## 운영자 재실행 (v11)

```bash
cd /Users/loopy/dev/ll3/loop
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..   # 앱 변경 시 1회: AFTER 번들 보장
bash docs/research/simulator-showcase/v11/capture.sh   # preflight(게이트웨이 200 기록·demo 200 하드 게이트) + 6컷
bash docs/research/simulator-showcase/v11/compose.sh   # BEFORE/AFTER 합성 6장 (ImageMagick)
# 전제: 부팅된 시뮬레이터 1대. 실제 게이트웨이 다운은 증거 기록 후 계속(캡처는 demo 게이트웨이 사용).
# 18589 점유 프로세스는 스크립트가 먼저 정리. 모델 호출 0회.
```

## 운영자 재실행 (v10)

```bash
cd /Users/loopy/dev/ll3/loop
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..   # 앱 변경 시 1회
cd packages/cli && bun test test/pairing.test.ts && cd ../..             # 페이로드 왕복·비밀 거부 유닛 (선행 확인)
bash docs/research/simulator-showcase/v10/capture.sh
# 전제: 게이트웨이가 MagicDNS 주소(18477)에서 /v1/runs -> 200이어야 함 (스크립트가 preflight에서 확인·중단).
# 1회성 OS 동의(첫 실행만): osascript 자동화 + 손쉬운 사용(합성 클릭). 스크립트가 앱을 재설치한다.
```

페이로드 출처·배너 클릭 좌표 산출·설치 재현 근거는 스크립트 헤더 주석 참조. 결정 문서: [`2026-xx-qr-pairing.md`](../../decisions/2026-xx-qr-pairing.md), 검증 기록: [`docs/findings/qr-pairing-verification.md`](../../findings/qr-pairing-verification.md).

## v8 요약 (2026-09-26) — Codex 디테일 체크리스트

스크립트 세션(demo 게이트웨이 `run_demo_details_0005`/`run_demo_live_0006`/`run_demo_history_0007`/`sess_demo_orphan_0003`, 루프백 18488)으로 결정 문서 `2026-xx-codex-detail-checklist.md` §3의 P0 항목을 정지 캡처로 증명한다. 스크린샷별 매핑:

| # | 스크린샷 (`v8/`) | 증명하는 체크리스트 항목 | 화면에서 확인되는 것 |
| --- | --- | --- | --- |
| 01 | `01-markdown-code-block-copy.png` | C1 마크다운 렌더 · C2 코드블록 카드+복사 | 어시스턴트 응답에서 `**`/`##`/`` ` `` 기호가 원문으로 노출되지 않고, 코드펜스가 본문과 분리된 카드(`surfaceAlt`·모노폰트·우상단 복사 컨트롤)로 렌더됨 |
| 02 | `02-tool-card-expanded-running-chip.png` | C3 접힘 인자 요약 · C4 상태어 색 대비 | 라이브 세션의 툴 카드(확장+접힘 요약), `running` 상태어가 상태 파생 색으로 표시됨 |
| 03 | `03-typing-indicator-streaming.png` | C7 스트리밍 타이핑 인디케이터 | 02 촬영 직후 게이트웨이 비트(구독 +8s)로 생긴 빈 어시스턴트 자리의 busy 행 — 02와의 픽셀 차이가 타임라인 행 하나에 국한됨(신규 busy 행) |
| 04 | `04-jump-pill-date-header-timestamps.png` | C6 타임스탬프 · C8 날짜 헤더 · C11 점프 필 | 이틀에 걸친 히스토리에서 날짜 경계 헤더, 첫 행 `HH:MM` 캡션, 스크립트 스크롤업(마운트 +6s) 뒤 우하단 "맨 아래로" pill |
| 05 | `05-empty-state.png` | C9 빈 상태 | 미상관(orphan) 세션 직접 진입 시 타임라인 중앙의 글리프+2줄 안내 블록 |

실행 모드: `apps/loop-mobile/scripts/demo-gateway.ts`(루프백 전용 가짜 데이터, bearer 상수 `demo-token`) + `LOOP_SHOWCASE_*` launch env 훅. 유료 호출 0회.

> **캡처 신뢰성 (2026-09-26 재검증):** 최초 캡처 세트는 `launch()`가 추가 `LOOP_SHOWCASE_*` env를 `simctl launch` 인수로 넘겨(simctl은 argv를 환경변수로 전달하지 않음) auto-open 훅이 전혀 발화하지 않았고, 5장 중 3장이 동일한 Chats 목록이었다. `capture.sh`를 `env(1)` 경유로 수정하고 02 촬영 시점을 비트(+8s) 이전으로 조정한 뒤 재촬영했다. 검증: 시스템 로그 `showcase-launch: keys=[autoConnect,autoOpenRunId,…]` 단계별 확인, 스크린샷 5장 MD5 전부 상이, 교차 픽셀 차이 21~36%, 02↔03 차이는 타임라인 신규 행에 국한.

---

## 운영자 재실행 (v9)

```bash
cd /Users/loopy/dev/ll3/loop
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..   # 앱 변경 시 1회: Release 빌드 + 부팅된 시뮬레이터 설치
bash docs/research/simulator-showcase/v9/capture.sh
# demo 게이트웨이(루프백 18588)를 매 실행 새로 띄우는 것이 의도(첨부 전송 라운드 트립 1회성).
# 18588 점유 프로세스는 스크립트가 먼저 정리한다. 캡처 전 실제 게이트웨이 200도 기록한다.
```

스크린샷 ↔ 증명 매핑·결함 리포트·한계는 [`v9/evidence.md`](v9/evidence.md). 스크립트 첨부 훅(`LOOP_SHOWCASE_ATTACH_ASSETS` 등)은 OS 픽커의 "picked" continuation과 동일한 지점으로 진입한다 — 사람 경로와 다른 것은 본문 소스(로컬 생성 PNG)뿐.

## 운영자 재실행 (v8)

전체 절차(게이트웨이 기동·200 대기·4회 런치·스크린샷)는 스크립트 하나로 재현된다:

```bash
cd /Users/loopy/dev/ll3/loop/apps/loop-mobile
bash scripts/build-ios-simulator.sh       # 1회: Release 빌드 + 부팅된 시뮬레이터에 설치
cd ../..
bash docs/research/simulator-showcase/v8/capture.sh
# 게이트웨이를 매 실행마다 새로 띄우는 것은 의도(라이브 비트 1회성 — 스크립트 헤더 주석 참조).
# 18488 점유 프로세스가 있으면 먼저 정리할 것.
```

단계별 수동 재현은 `v8/capture.sh` 본문(launch env 조합과 sleep 타이밍 주석)을 따른다.

## 운영자 재실행 (v7)

```bash
cd /Users/loopy/dev/ll3/loop
# 먼저 게이트웨이 확인: tokenless Tailscale listener여야 200 (기존 bearer-only면 중지 후 아래 실행)
curl -s -o /dev/null -w '%{http_code}\n' http://100.80.133.120:18477/v1/runs
LOOP_GATEWAY_HOST=100.80.133.120 LOOP_GATEWAY_PORT=18477 \
LOOP_GATEWAY_DATABASE_PATH=$HOME/.loop/gateway/loop.db LOOP_GATEWAY_PROJECT_ROOT=$PWD \
  bun docs/research/simulator-showcase/v7/gateway-wrapper.ts &
# 이미 200이면 위 시작 명령은 생략. 18477 점유 프로세스 중복 기동 금지.
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..
UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
BUNDLE=org.reactjs.native.example.LoopMobile
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
SIMCTL_CHILD_LOOP_SHOWCASE_HOST=100.80.133.120 SIMCTL_CHILD_LOOP_SHOWCASE_PORT=18477 \
SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 xcrun simctl launch "$UDID" "$BUNDLE"
sleep 9; xcrun simctl io "$UDID" screenshot docs/research/simulator-showcase/v7/01-tokenless-first-launch-chats.png
# 로컬 생성 PNG + 파일 카드: 루프백 fake gateway. 실행 후 demo session id는 demo-gateway.ts 참조.
bun apps/loop-mobile/scripts/demo-gateway.ts 18499 &
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
SIMCTL_CHILD_LOOP_SHOWCASE_HOST=127.0.0.1 SIMCTL_CHILD_LOOP_SHOWCASE_PORT=18499 \
SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_RUN=run_demo_assets_0004 \
  xcrun simctl launch "$UDID" "$BUNDLE"
sleep 9; xcrun simctl io "$UDID" screenshot docs/research/simulator-showcase/v7/02-attachment-conversation.png
(cd apps/loop-desktop && bunx tauri build --bundles app)
open 'apps/loop-desktop/src-tauri/target/release/bundle/macos/Loop Desktop.app'
# 앱 창을 전면으로 이동한 후:
screencapture -x docs/research/simulator-showcase/v7/03-desktop-app.png
```

> 이전 설치 가이드 `app-device-install.md`는 bearer 방식 기록으로 v7 tokenless 기본값과 다르다. 이 스크린샷은 모바일 tokenless와 모바일 첨부를 별도 게이트웨이로 시연한다. 데스크톱 앱은 실제 번들 실행 화면이며 서버 연결 성공까지 증명하지 않는다.

## v6 요약 (2026-09-26)

| # | 단계 | 화면 | 확인 가능한 내용 | 근거 |
| --- | --- | --- | --- | --- |
| 0 | 전제 | 수동 Connect | 저장 항목 없음(무 env 기동) | v6/evidence §재검증 시나리오 |
| 1 | 첫 로그인 | Chats | 검증된 연결 후 키체인 저장, 하단 Log out, 토큰 미렌더 | `v6/01-first-login-chats.png` |
| 2 | 종료→재실행 | Chats 직행 | 무 env 재실행에서 키체인 자동 복원(Connect 화면 우회), 메타 타임스탬프 +28s | `v6/02-relaunch-autoconnect-chats.png` |
| 3 | 로그아웃 | 수동 Connect | 저장 삭제·연결 해제, 토큰 필드 빈 플레이스홀더 | `v6/03-after-logout-connect-screen.png` |
| 4 | 로그아웃 후 재실행 | 수동 Connect | 복원 없음(기본 host/port) = 삭제 증명 | `v6/04-relaunch-after-logout-manual.png` |

실행 모드: `apps/loop-mobile/scripts/demo-gateway.ts`(루프백 전용 가짜 데이터, bearer 상수 `demo-token`) + `LOOP_SHOWCASE_*` launch env 훅(`CONNECT`/`LOGOUT`/`LOGOUT_DELAY_MS`). 구현은 `apps/loop-mobile/src/auth/{credentialStore,keychain,restore}.ts` + `App.tsx` 배선. 유료 호출 0회.

## 운영자 재실행 (v6)

```bash
cd /Users/loopy/dev/ll3/loop/apps/loop-mobile
bun install && (cd ios && pod install)
bash scripts/build-ios-simulator.sh       # Release 빌드 + 부팅된 시뮬레이터에 설치·기동
bun scripts/demo-gateway.ts 18499 &       # 가짜 데이터 게이트웨이 (루프백 전용)

UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
BUNDLE=org.reactjs.native.example.LoopMobile
OUT=docs/research/simulator-showcase/v6

# 1) 첫 로그인: auto-connect(사람의 Connect 탭과 동일 핸들러) → 키체인 저장
xcrun simctl terminate $UDID $BUNDLE 2>/dev/null; sleep 1
SIMCTL_CHILD_LOOP_SHOWCASE_BEARER=demo-token SIMCTL_CHILD_LOOP_SHOWCASE_HOST=127.0.0.1 \
SIMCTL_CHILD_LOOP_SHOWCASE_PORT=18499 SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
  xcrun simctl launch $UDID $BUNDLE
sleep 9 && xcrun simctl io $UDID screenshot $OUT/01-first-login-chats.png

# 2) 종료 → 무 env 재실행 → 키체인 자동 복원(Chats 직행)
xcrun simctl terminate $UDID $BUNDLE; sleep 2
xcrun simctl launch $UDID $BUNDLE
sleep 9 && xcrun simctl io $UDID screenshot $OUT/02-relaunch-autoconnect-chats.png

# 3) 재연결 후 자동 로그아웃(6s) → 수동 Connect + 저장 삭제
xcrun simctl terminate $UDID $BUNDLE 2>/dev/null; sleep 1
SIMCTL_CHILD_LOOP_SHOWCASE_BEARER=demo-token SIMCTL_CHILD_LOOP_SHOWCASE_HOST=127.0.0.1 \
SIMCTL_CHILD_LOOP_SHOWCASE_PORT=18499 SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
SIMCTL_CHILD_LOOP_SHOWCASE_LOGOUT=1 SIMCTL_CHILD_LOOP_SHOWCASE_LOGOUT_DELAY_MS=6000 \
  xcrun simctl launch $UDID $BUNDLE
sleep 14 && xcrun simctl io $UDID screenshot $OUT/03-after-logout-connect-screen.png

# 4) 무 env 재실행 → 수동 Connect(기본 host/port) = 삭제 증명
xcrun simctl terminate $UDID $BUNDLE 2>/dev/null; sleep 2
xcrun simctl launch $UDID $BUNDLE
sleep 9 && xcrun simctl io $UDID screenshot $OUT/04-relaunch-after-logout-manual.png
```

> 시뮬레이터는 앱 삭제 후에도 키체인 항목이 남을 수 있다(실기기와 상이). "첫 로그인" 재현 시 저장 항목이 이미 있으면 3번(로그아웃)을 먼저 실행해 비운다. 자동 복원 실패 폴백(게이트웨이 다운 → 수동 화면 + 저장 유지)은 이번 캡처에서 미시연 — 단위 테스트(`restore.test.ts`)로 검증. 상세·한계는 [`v6/evidence.md`](v6/evidence.md).

---

## v5 요약 (2026-09-26)

| # | 화면 | 확인 가능한 내용 | 근거 |
| --- | --- | --- | --- |
| 1 | Connect | 상태바와 제목 분리(SafeArea), 라벨링 필드, 빈 토큰 시 비활성 CTA | `v5/01-connect-screen.png` |
| 2 | Chats 목록 | 대형 타이틀, new-run 카드, 상태 점 배지+최근 활동 메타, `run_id = null` 정직 표기 | `v5/02-chats-list.png` |
| 3 | 대화(실행 중) | 사용자 버블/어시스턴트 텍스트 구분, 툴 카드(✓ done 접힘 / ◐ running… 펼침), 하단 고정 컴포저 | `v5/03-conversation-running.png` |
| 4 | steer 전달 | `↳ steer · delivered` 마커 | `v5/04-conversation-steered.png` |
| 5 | raw 토글 | 터미널(raw mirror) 목록 | `v5/05-conversation-raw.png` |
| 6 | pane 미러 | 다크 터미널 표면, `rev 7 · following` 메타 | `v5/06-terminal-mirror.png` |
| 7 | 가로 모드 | 컬럼이 노치 inset 회피(비대칭 마진) | `v5/07-landscape-chats.png` |
| 8 | 키보드 | 컴포저가 키보드 바로 위 부착(이중 간격 0) | `v5/08-composer-keyboard.png` |

실행 모드: `apps/loop-mobile/scripts/demo-gateway.ts`(루프백 전용 가짜 데이터) + `LOOP_SHOWCASE_*` launch env 훅. 유료 호출 0회. 재설계 본체(토큰·SafeArea·화면)는 `apps/loop-mobile` 쪽 태스크 `ui-codex-redesign` 소속 변경이며 상세는 [`v5/evidence.md`](v5/evidence.md).

## 운영자 재실행 (v5)

```bash
cd /Users/loopy/dev/ll3/loop/apps/loop-mobile
bun install && (cd ios && pod install)   # react-native-safe-area-context 추가분
bash scripts/build-ios-simulator.sh       # Release 빌드 + 부팅된 시뮬레이터에 설치·실행
bun scripts/demo-gateway.ts 18499 &       # 가짜 데이터 게이트웨이 (루프백 전용)

UDID=$(xcrun simctl list devices booted | grep -oE '[A-F0-9-]{36}' | head -1)
SIMCTL_CHILD_LOOP_SHOWCASE_BEARER=demo-token SIMCTL_CHILD_LOOP_SHOWCASE_HOST=127.0.0.1 \
SIMCTL_CHILD_LOOP_SHOWCASE_PORT=18499 SIMCTL_CHILD_LOOP_SHOWCASE_CONNECT=1 \
SIMCTL_CHILD_LOOP_SHOWCASE_OPEN_RUN=run_demo_running_0001 \
SIMCTL_CHILD_LOOP_SHOWCASE_STEER="Focus on the slow-consumer reset path" \
  xcrun simctl launch $UDID org.reactjs.native.example.LoopMobile
# ~20초 후 단계별: xcrun simctl io $UDID screenshot docs/research/simulator-showcase/v5/<stage>.png
```

> 키보드 캡처(08)는 하드웨어 키보드 연결 해제 필요, 가로 캡처(07)는 Simulator 창 Mac 화면 캡처로 대체 — 상세·한계는 [`v5/evidence.md`](v5/evidence.md) §재실행·§미달.

---

## v3 요약 (2026-09-26)

| # | 단계 | 결과 | 근거 |
| --- | --- | --- | --- |
| 1 | 시뮬레이터 부팅·Release 빌드·기동 (iPhone 17, UDID `99B087B5-…`) | JS 정적 번들, Metro 불필요 | `apps/loop-mobile/scripts/build-ios-simulator.sh` |
| 2 | Connect 화면 — 중앙 정렬, 프리필 | 호스트/포트 프리필 | `v3/01-connect-screen.png` |
| 3 | Connect → 실제 runs 목록 + 프롬프트 프리필 | 목록 + 프리필 | `v3/02-runs-and-submit.png` |
| 4 | Submit → RunScreen: status·출력·terminal 수신 + **Terminals(pane 인벤토리, 라벨 포함)** | run completed 4/4 | `v3/03-run-live.png` |
| 5 | pane 탭 → **라이브 워커 pane 뷰** (herdr → 게이트웨이 SSE → 앱) | `rev 427 · following` | `v3/04-pane-live.png` |
| 6 | 시간차 재캡처 — **라이브 스트리밍 입증** | `rev 476 → 514`, 내용 갱신 | `v3/05-pane-live-advanced.png`, `v3/06-pane-live-later.png` |

실행 모드: run은 게이트웨이 기본 `deterministic-local`(무료), pane 텍스트는 **실제 pi 워커 세션 출력**(이 태스크 구현 워커 자신). 데모 전용 유료 호출은 검증용 1회(한 줄 산술, `$0.027` 표시) — 전량 공개는 [`v3/evidence.md`](v3/evidence.md) §4.

## 운영자 재실행 (v3)

전체 명령(래퍼 게이트웨이 포함)은 [`v3/evidence.md`](v3/evidence.md) §6. 요점:

```bash
cd /Users/loopy/dev/ll3/loop
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..
UDID=99B087B5-DEF6-4CF1-9177-81A5DE564CFC
OUT=docs/research/simulator-showcase/v3
# TOKEN 발급은 app-device-install.md §3.2 — SIMCTL_CHILD_LOOP_SHOWCASE_* 로
# autoConnect/autoSubmit/autoOpenPane 구동 후 단계별 xcrun simctl io screenshot
```

> **게이트웨이 pane 미러 불안정 (중요):** herdr 0.8.2 프로토콜 비호환으로 표준 launchd 경로에서는 pane이 `paneGone`으로 가기 쉽다(결함 4건 + 래퍼 우회: [`v3/evidence.md`](v3/evidence.md) §5). 안정 시연은 §6.2의 래퍼 경로를 쓴다. 수정은 게이트웨이 후속 과제로 넘긴다(이 태스크 쓰기 범위 밖).

## v3에서 수정한 것 (앱)

1. 터미널 뷰 완성: 제네릭 `monospace` → **Menlo**, 다크 터미널 표면(`#0D1117`/`#E6EDF3`), 고정 뷰포트 + 내부 스크롤(메타 라인 상시 가시), 프레임 렌더 스로틀 300ms.
2. showcase 확장: `autoOpenPaneId`/`autoOpenPaneDelayMs`(사람의 탭과 동일 핸들러, 인벤토리 재시도 포함).
3. 테스트: `bun test apps/loop-mobile/test` **47 pass / 0 fail** (showcase 파싱 신규, 레이아웃 계약 갱신, 기존 import 경로 결함 수정).

---

## v2 요약 (2026-09-25)

| # | 단계 | 결과 | 근거 |
| --- | --- | --- | --- |
| 1 | 시뮬레이터 부팅·Release 빌드·기동 (iPhone 17, iOS 26.2, UDID `99B087B5-DEF6-4CF1-9177-81A5DE564CFC`) | JS 정적 번들, Metro 불필요 | `scripts/build-ios-simulator.sh` |
| 2 | Connect 화면 — **중앙 정렬 컬럼 레이아웃**, 호스트/포트 프리필 | `loopy-macbookpro.tail42f248.ts.net:18477` | `v2/01-connect-screen.png` |
| 3 | Connect → **실제 runs 목록**(`GET /v1/runs` = `loop runs`) | durable run 5건 표시 | `v2/02-runs-list.png`, v2/evidence §2.4 |
| 4 | 프롬프트 프리필 → Submit → `POST /v1/runs` 202 | `run_8c4c5a63-…` 생성 | `v2/03-submit-screen.png` |
| 5 | RunScreen — SSE로 status·**워커 출력 12프레임**·terminal 수신 | `completed`, 4/4 done, 태스크별 상태·출력 라인 렌더링 | `v2/04-run-live.png`, `v2/05-run-output.png`, v2/evidence §2.2–3 |
| 6 | 재기동 후 목록에서 앱 run `completed` 확인, `loop status`와 동일 상태 | 앱 목록 6건 = `loop runs` 6건 | `v2/06-runs-list-after.png`, v2/evidence §3 |

실행 모드: gateway `LOOP_GATEWAY_PROVIDER_MODE` 미설정 = **deterministic-local**(FakeProvider + 실제 git 완료 검사, 무료). 실제 provider 레인은 운영자가 구성에서 명시 활성화할 때만 조립된다(결정 D2).

## 운영자 재실행 (v2)

전체 명령(bearer 발급, 게이트웨이 재시작 포함 전제 정비, 단계별 캡처, 서버 측 대조)은 [`v2/evidence.md`](v2/evidence.md) §5. 핵심만:

```bash
cd /Users/loopy/dev/ll3/loop
# 게이트웨이 코드 갱신 시: launchctl kickstart -k gui/$(id -u)/dev.loop.gateway
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..
UDID=99B087B5-DEF6-4CF1-9177-81A5DE564CFC
OUT=docs/research/simulator-showcase/v2
# TOKEN 발급은 v2/evidence.md §5 — SIMCTL_CHILD_LOOP_SHOWCASE_* 로
# autoConnect/autoSubmit(12s) 구동 후 단계별 xcrun simctl io screenshot
./dist/loop runs --database ~/.loop/gateway/loop.db   # 앱 목록과 대조
```

## v2에서 수정한 것

v1에서 "라이브 상태를 본 것"은 사실 아니었다 — 재검증 결과 RunScreen은 스트림 오류 화면이었다. v2에서 앱 전송 계층의 실버그 2건을 고치고 목록·중앙 정렬을 추가했다:

1. **Hermes `TextDecoder` 부재** → `src/gateway/sse.ts`의 자체 `Utf8ChunkDecoder`(청크 경계 멀티바이트 처리).
2. **RN fetch에 `response.body` 없음** → `src/gateway/xhr-sse.ts`(XHR 증분 이벤트 전송) + `client.ts` 전송 프루브.
3. **중앙 정렬 레이아웃**(`src/ui/Screen.tsx`)과 **실제 runs 목록**(`src/screens/RunsList.tsx`) 신설.

테스트: `bun test apps/loop-mobile/test` 28 pass(신규 전송 계층 테스트 포함). 상세: [`v2/evidence.md`](v2/evidence.md) §4.

## v1 기록 (스텁 시대 — 이력 보존)

- **작성일:** 2026-09-25 (task `simulator-showcase`)
- **범위:** `apps/loop-mobile`을 iOS 시뮬레이터에 빌드·부팅하고, 게이트웨이(Tailscale MagicDNS 경유)에 연결해 프롬프트 스텁을 제출 → 실시간 상태 수신까지 시연. 실기기 설치 없음, 유료 모델 호출 없음(stub planner).
- **서버 측 증거:** [`evidence.md`](evidence.md) — run 상태·SSE 프레임·타임라인 (스텁 run `run_c7a84585-…`는 pending 유지)
- **스크린샷:** `01-connect-screen.png` ~ `04-live-output.png` (이 디렉터리, v2와 구분을 위해 v1 명칭 유지)
- **v1이 남긴 주의사항과 현재 상태:**
  - ~~"worker 프로파일 표시는 이번 시연에 없다"~~ — 여전히 wire에 프로파일 필드는 없음(`gateway-turnloop-integration` 후속).
  - ~~"run이 terminal로 안 끝남 — standalone 게이트웨이엔 worker가 없어 pending 유지"~~ — **v2에서 해소**: in-host orchestrator hand-off로 실제 실행·완료.
  - v1의 자동화 방식(launch env → initialProps → 버튼 핸들러 실행)은 v2도 동일하게 계승했다.
