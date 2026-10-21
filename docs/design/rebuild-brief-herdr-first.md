# 앱 리빌드 브리프 — herdr 우선 클라이언트

- **일자:** 2026-10-21
- **상태:** 승인됨 (사용자 지시: "앱으로 herdr과 잘 연결하는 것을 1번 목적", "처음부터 다시 쌓자")
- **대상:** `apps/loop-mobile` (전면 재구축), `packages/gateway` (herdr 표면 확장)
- **비교 레퍼런스:** Orca IDE(iOS 컴패니언 앱), Paseo 모바일(네이티브 풀 클라이언트). `herdr-web-ui`류 웹 클라이언트의 "못생기고 깨지는" 문제를 네이티브 앱 품질로 해소한다.

## 1. 목표 / 비목표

**목표**

1. 앱의 1급 탐색 단위는 **herdr 세계의 실체**(워크스페이스 · 탭 · 페인 · 에이전트)다. Loop run·Pi Lead는 부가 표면로 강등된다.
2. 폰에서 herdr 안의 모든 에이전트 종류(`claude`, **`agy`**, `codex`, `pi`, `gemini` 등 herdr 24종)를 **대화하듯** 구동한다: 프롬프트 전송, 상태(working/idle/blocked/done) 실시간 표시, 승인 대기(blocked) 배너, esc/ctrl+c 개입.
3. Orca/Paseo 수준의 앱다움: 네이티브 내비게이션 제스처, 실시간 상태 pill, ANSI 색이 살아있는 트랜스크립트/터미널, 키보드 합성, 빈 상태·오류 상태의 솔직한 처리.
4. 게이트웨이는 herdr **소켓 API(프로토콜 22)**의 얇은 HTTP/SSE 어댑터가 된다. 폰은 herdr를 직접 알지 못한다.

**비목표 (이번 리빌드에서 하지 않는 것)**

- Loop run 오케스트레이션 UI 개선 (runs/sessions/pi-tap 표면은 게이트웨이에 호환으로 남긴다 — 앱 홈 경로에서 제외할 뿐).
- 멀티 머신(`herdr --machine`) UI — v1은 로컬 머신 1대. 게이트웨이 계약은 머신 식별자 필드를 미리 열어둔다.
- 푸시 알림(APNs) — v1은 포그라운드 상태 실시간성. 백그라운드 알림은 후속.
- 파일 뷰어 이관 — 기존 files 표면은 유지하나 새 IA에 즉시 포함하지 않는다.

## 2. 근거 (연구 요약)

- **herdr 소켓 API(0.9.5, protocol 22)**: `herdr api schema --json` 기준 `session.snapshot`(워크스페이스·탭·페인·에이전트 전체 상태 1회 호출), `pane.read`(visible/recent/recent_unwrapped, ansi 지원, revision 증가분), `agent.prompt`(pane 대상 허용, `agent_blocked` 사전 거절), `agent.send_keys`, `agent.focus`, `agent.start`(24종), `workspace.create`, `integration.list`.
- **실시간 푸시 확인(스파이크)**: 소켓에서 `events.subscribe`에 구독 목록(workspace/tab/pane 라이프사이클 전역 + 페인별 `pane.agent_status_changed`)을 보내면 `subscription_started` 후 **연결이 열린 채 이벤트를 푸시**한다. 단일 요청-연결 제약은 구독 연결에는 적용되지 않는다.
- **기존 자산**: 게이트웨이는 이미 Tailscale 바인딩·토큰리스 인증·RFC 9457·SSE 커서/리플레이/slow-consumer 인프라와 `pane.list/pane.read` 기반 터미널 미러(SSE)를 갖는다. 앱에는 검증된 전송 프리미티브(XHR-SSE, Utf8ChunkDecoder, 키체인 자격증명, QR 페어링)와 토큰 테스트가 있다.
- **기존 앱의 구조적 부채(감사 문서 합의)**: App.tsx 554줄 신 컴포넌트, run/session 이중 신원이 UI에 누출, SSE 루프 3중 복제, showcase 훅의 프로덕션 혼입, 홈 자동 갱신 부재. IA 결정(세션 중심)은 선행 문서(dp-session-centric-proposal)에서 확정됐으나 UI 층이 그 이전에 작성됐다.

## 3. 제품 형태 (IA)

```text
┌ 하단 탭 3개 ────────────────────────────┐
│ ① Herd(홈)   ② Panes        ③ Settings │
└─────────────────────────────────────────┘

① Herd: 에이전트 목록(워크스페이스 그룹핑). 각 행 = 에이전트
   종류 글리프 · 제목(terminal_title) · 상태 pill · cwd.
   상태 실시간(SSE). FAB "+ Agent" → 종류/워크스페이스/cwd
   선택 시트 → agent.start. 행 탭 → Agent 상세.
② Agent 상세(스택 push): 헤더(제목·상태 pill·cwd·워크스페이스)
   + Chat|Terminal 세그먼트.
   Chat: agent.read(recent_unwrapped) 트랜스크립트(ANSI 색 유지,
   revision 증분) + 컴포저(전송=agent.prompt) + 퀵키(esc, ctrl+c)
   + blocked 배너("데스크톱에서 승인 필요" + 포커스 버튼).
   Terminal: 기존 pane 미러 SSE의 ANSI 뷰.
③ Panes: 워크스페이스→탭→페인 트리, 비에이전트 셸 포함.
   페인 탭 → 터미널 뷰 + 입력(셸 대상 send).
   워크스페이스 생성 지원.
④ Settings: 연결(QR/수동/복구/로그아웃 — 기존 검증 플로우 이식),
   herdr 서버 상태(version·protocol·agent 종류 가용성),
   표시(글자 크기).
```

**용어 규율**: UI는 herdr 어휘를 그대로 쓴다 — 워크스페이스/탭/페인/에이전트, 상태는 `Working · Idle · Blocked · Done · Unknown`을 한국어 표면어로. Loop run 어휘(run/task/attention)는 홈·상세에서 노출하지 않는다.

## 4. 게이트웨이: herdr 표면 (신규)

기존 run/session/spawn/files 표면은 그대로 유지(호환). 신규 경로만 추가한다. 인증·problem·SSE 인프라 재사용.

**소켓 클라이언트** (`herdr-socket.ts`)

- 요청 1건당 연결 1개(herdr 서버 특성, 기존 소스 검증과 일치). `request(method, params)` — 3s 타임아웃, 오류 응답을 `HerdrSocketError`로 변환.
- `subscribe(subscriptions)` — 영속 연결, 프레임 콜백, 재연결 시 자동 재구독. 구독 목록: 전역 라이프사이클 전부 + 스냅샷 시점 전 페인의 `pane.agent_status_changed`.
- 기본 소켓 `~/.config/herdr/herdr.sock`, `LOOP_GATEWAY_HERDR_SOCKET`로 치환(기존 env 존중).

**상태 모니터** (`herdr-state.ts`)

- `session.snapshot` 1회 → 전체 상태. 이후 `events.subscribe` 푸시 + 5s 안전 폴링. 푸시 실패 시 1s 폴링으로 강등. 변경 병합 후 구독자에게 상태 버전 발행(500ms 코얼레싱).
- herdr 부재 → `{available: false}` 상태(실패 닫기, 기존 pane-mirror 규약과 동일).

**HTTP/SSE 경로**

| 경로 | 목적 | herdr 매핑 |
| --- | --- | --- |
| `GET /v1/herdr/state` | 전체 상태 스냅샷 | `session.snapshot` |
| `GET /v1/herdr/events` (SSE) | 상태 실시간 프레임 `herdr_state` | 모니터 구독 |
| `GET /v1/herdr/panes/{paneId}/read` | 페인 텍스트 (`?lines=&source=&format=ansi`) | `pane.read` |
| `POST /v1/herdr/panes/{paneId}/prompt` | 프롬프트 전송 → 202 | `agent.prompt`(pane 대상, no-wait) |
| `POST /v1/herdr/panes/{paneId}/keys` | 키 입력(esc, ctrl+c…) | `agent.send_keys` |
| `POST /v1/herdr/panes/{paneId}/focus` | 데스크톱에서 포커스 | `pane.focus` |
| `POST /v1/herdr/agents/start` | 에이전트 시작 `{kind, name?, workspaceId?, tabId?, cwd?}` | 탭 해석 → 가용 셸 페인 → `agent.start`(필요 시 `pane.split`) |
| `POST /v1/herdr/workspaces` | 워크스페이스 생성 `{label?}` | `workspace.create` |
| `GET /v1/herdr/integrations` | 설치된 에이전트 종류 | `integration.list` |

**오류 매핑**: herdr `agent_blocked` → 409, `agent_not_found`/`pane_not_found` → 404, `agent_not_ready` → 202(페인 반환, 시작 계속 관찰), 소켓 부재 → 503 `herdr_unavailable`.

**경계 준수**: 모든 신규 코드는 gateway(어댑터 층)에 머문다. loop-core/store/bridge/protocol 무변경 → codegen 불필요. `packages/herdr`(워커 런타임)도 무변경 — 소켓 클라이언트는 게이트웨이 자산으로 시작하고, 성숙 후 `@loop/herdr` 이관은 별도 결정.

## 5. 앱: 재구축 구조

이식(검증된 모듈 — 로직 보존, 경로/네이밍 정리): `sse.ts`(SseParser·Utf8ChunkDecoder), `xhr-sse.ts`, `problem.ts`, `keychain/credentialStore/settings`, QR 스캔·페어딥링크, back-swipe, follow-scroll.

신규 작성:

```text
src/
  app/        App.tsx(부트+연결 게이트), router.ts(형식화된 스택+탭 상태기계),
              Shell.tsx(탭바/스택 렌더)
  design/     tokens.ts(v2), theme.ts, primitives.tsx(Pill·Card·Row·
              SectionHeader·EmptyState·Sheet·PressableScale), ansi.ts(파서)
  herdr/      types.ts(와이어 DTO), client.ts(HTTP), stream.ts(SSE 관찰 1본),
              store.ts(단일 HerdrStore, useSyncExternalStore),
              transcript.ts(revision 증분 트랜스크립트 모델)
  screens/    herd/ (홈), agent/ (상상세), panes/, connect/, settings/
  features/   new-agent 시트, quick-keys, 상태 pill 등 조립 요소
  copy.ts     모든 표면 문구 (한국어)
```

원칙: 상태는 `HerdrStore` 한 곳(화면별 useState 금지 영역 명시), SSE 관찰 루프 1본, showcase 자동화 훅의 프로덕션 혼입 금지(대신 `test/` 계약 테스트로 승격), 디자인 토큰 밖 인라인 색 금지(기존 tokens/contrast 테스트 계승).

## 6. 마일스톤과 검증 계약

| 마일 | 산출 | 승인 증거 |
| --- | --- | --- |
| M1 | 게이트웨이 herdr 표면(소켓 클라이언트·모니터·9경로·SSE) | `bun test packages/gateway`(신규 계약 테스트, 목 소켓 서버) + 실소켓 curl 확인 |
| M2 | 앱 골격: 재구축 구조·연결 이식·HerdStore·Herd 홈 실시간 목록 | 시뮬레이터에서 실게이트웨이 연결, 에이전트 3종 상태 실시간 반영 스크린샷 |
| M3 | Agent 상세: 트랜스크립트(ANSI)·프롬프트·퀵키·blocked 배너·focus | 폰에서 실제 `claude`와 `agy` 프롬프트 1회씩, 상태 전환 관찰 스크린샷 |
| M4 | `+ Agent`(종류 선택 통합 `integration.list`)·워크스페이스 생성·Panes 트리 | 앱에서 `agy` 시작 → 프롬프트 → done 관찰 스크린샷 |
| M5 | 디자인 마감·계약 테스트·문서(README·감사) | `bun run check` 녹색, `bun test apps/loop-mobile`, 스크린샷 세트 |

단위·계약 테스트는 유료 모델 호출을 요구하지 않는다(AGENTS.md 검증 규약). 목 herdr 소켓 서버를 `test/`에 두고 게이트웨이 계약을 고정한다.

## 7. 위험과 완화
- **herdr 프로토콜 진화(22→23…)**: 소켓 DTO를 게이트웨이 한 파일 계층에만 둔다. `herdr api schema --json`을 계약 고정의 원본으로 삼고 테스트가 최소 메서드 집합을 핀한다.
- **ANSI/트랜스크립트 "깨짐"**: 파서는 SGR(색·굵기·반전)만 지원하고 커서 제어 시퀀스는 제거. `revision` 기반 전체 교체 위주로 증분 오차를 구조적으로 못 받게 한다(누적 패치 금지). 앞으로 벤치마크는 텍스트 고정 fixture.
- **에이전트 상태 오판**: herdr 상태를 신뢰하되 `unknown`을 1급으로 표시(과신 금지 — herdr 스킬 규약 준수). blocked는 "앱에서 답하지 않는다" 원칙: 데스크톱 포커스 유도만 한다(v1).
- **구독 연결 수명**: herdr 서버 재시작 시 소켓 재연결·재구독, 스냅샷 재수화. 모니터가 유일한 소켓 구독자(경로 핸들러는 모니터만 본다).

## 8. 실행 기록 (2026-10-21, M1–M4 완료)

- **M1 게이트웨이**: `herdr-pane-source.ts`에 `HerdrControlClient`(단일 요청-연결,
  구독 피드 자동 재연결) 추가, `herdr-state.ts` 모니터(푸시+10s 안전 폴링,
  변경 시에만 version bump), `/v1/herdr/*` 9경로 + `herdr_state` SSE.
  경계 고정(단일 herdr-프로토콜 파일) 유지 — 서버는 포트 어휘만 말한다.
  계약 테스트 13건(가짜 유닉스 소켓) 통과, 실소켓 라이브 확인.
- **구현 중 발견·수정**: (a) herdr `agent.start`의 `name`은 필수 string —
  `null` 전송이 `invalid_request`를 유발 → 생략으로 수정. (b) 생성 직후
  워크스페이스로 start 시 상태 뷰 미수화 404 → 1회 재수화로 수정.
  (c) `pane.agent_status_changed` 구독은 페인 지정 필수 → 구독 목록을
  페인 집합 함수로 구성, 구조 이벤트 시 피드 재시작. (d) 25초 실측에서
  라이프사이클 푸시는 상태 전환 시에만 옴 → 안전 폴링이 정합성 담당.
- **M2 앱 골격**: 전면 재구축(레이어 app/design/herdr 신설, state·showcase
  제거), 아키텍처 테스트를 새 레이어 그래프로 개정. 앱 167 테스트 통과.
- **M3/M4 라이브(시뮬레이터 ↔ 실게이트웨이 ↔ 실 herdr)**: 키체인 자동 복구
  연결, Herd 실시간 목록(작업 중↔완료 전현), ANSI 트랜스크립트, 프롬프트
  전송 후 제목 자동 갱신("1+1 math question")·완료 pill 전환,
  **agy 시작 → 신뢰 대화상자 blocked 감지(409) → esc/enter 키 승인 →
  프롬프트 → "ok" 응답**까지 전 구간 확인. 캡처는
  `apps/loop-mobile/showcase-captures/rebuild-v2-*.png`.
- **잔여 (M5 후속)**: 표시 설정(글자 크기) 영속화, APNs 백그라운드 알림,
  머티리얼-3 스타일 마감 다듬기, `herdr-web-ui` 대비 스크린샷 브리프.
