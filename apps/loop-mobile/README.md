# loop-mobile — herdr 클라이언트 (재구축 v2)

Loop의 원격 모바일 앱. **1급 목적은 herdr 연결이다**(재구축 계약:
[`docs/design/rebuild-brief-herdr-first.md`](../../docs/design/rebuild-brief-herdr-first.md)).
Tailscale 네트워크의 Loop 게이트웨이(`/v1/herdr/*`, HTTP/SSE)에 접속해
워크스페이스·페인·에이전트를 폰에서 본다: 실시간 상태(작업 중/대기/승인
대기/완료), ANSI 색이 살아있는 대화 트랜스크립트, 프롬프트 전송, esc·ctrl+c
개입, 어떤 에이전트 종류(claude, codex, **agy** 등 herdr 전종류)든 시작.

Loop run·Pi Lead 표면은 이 앱의 홈 경로에 없다(게이트웨이에는 호환으로
남아 있다).

## 레이아웃 (레이어 계약: `tests/architecture-boundaries.test.ts`)

```text
src/
  App.tsx                부트: 키체인 복구 → probe → StoreProvider → Shell
  app/                   Shell(탭 3+스택), router(형식화 상태기계),
                         storeContext(useSyncExternalStore)
  screens/               Herd(홈) · Agent(대화|터미널) · Terminal ·
                         Panes · Connect · QR · Settings
  features/              NewAgentSheet(종류×워크스페이스×이름), qrScanModel,
                         clipboard, time-format
  herdr/                 wire(DTO) · client(HTTP) · stream(SSE 관찰 1본) ·
                         store(단일 상태 소유자) · transcript · kinds
  design/                tokens 기반 primitives, ansi(SGR 파서), TerminalText
  gateway-client/        sse · xhr-sse · problem · retry · probe (리프 계층)
  auth/                  connection · credentialStore · keychain · pairing ·
                         restore (검증된 원형 유지)
  ui/                    tokens · glyphs/Icon · BackSwipeZone · followScroll
  copy.ts                모든 표면 문구(한국어, herdr 어휘)
```

가져오기 방향은 아키텍처 테스트가 기계적으로 잠근다(예: `design`은
`ui`·`herdr`만, `gateway-client`는 리프).

## 제품 흐름

1. **연결**: `loop pair` QR(`loop://connect?…` 딥링크·카메라 스캔) 또는
   수동 host:port. probe(GET /v1/herdr/state) 성공 시에만 키체인 저장.
2. **Herd(홈)**: 워크스페이스별 에이전트 목록, 실시간 상태 pill.
   FAB → 새 에이전트(종류/워크스페이스/이름) → `POST /v1/herdr/agents/start`.
3. **에이전트 상세**: 대화(recent_unwrapped ANSI 트랜스크립트 + 컴포저 +
   esc/ctrl+c) | 터미널(원본 미러). blocked 배너는 승인을 데스크톱으로 유도
   (앱이 승인 대화에 답하지 않는다).
4. **Panes**: 워크스페이스→탭→페인 전체(셸 포함) 열람·터미널 뷰·생성.
5. **설정**: 연결·herdr 서버·에이전트 종류 인벤토리·로그아웃.

## 실행

```bash
# 헤드리스 계약/순수 테스트 (네트워크·유료 모델 호출 없음)
bun install && bun test test

# 시뮬레이터 빌드 + 실행 (booted 기기, self-contained JS bundle)
bun run pod   # 최초 1회
bun run ios:release
```

게이트웨이: `LOOP_GATEWAY_HOST=<tailscale-ip> LOOP_GATEWAY_PORT=18477
LOOP_GATEWAY_DATABASE_PATH=… bun packages/gateway/src/main.ts` — herdr
소켓(`~/.config/herdr/herdr.sock`)이 있으면 `/v1/herdr/*` 표면이 켜진다.

## 검증 증거 (2026-10-21, 재구축 M1–M4 + 네이티브 모션 패스)

- 게이트웨이 13 계약 테스트(가짜 herdr 소켓) + 실소켓 라이브 확인
  (state/SSE/read/prompt/keys/start/integrations).
- 앱 162 테스트 + `bun run check` 녹색.
- 네이티브 모션 패스(감사: `docs/design/audits/2026-10-21-native-motion-audit.md`):
  push/pop 슬라이드+패럴랙스 전환(`ui/ScreenStack`), 엣지 제스처 연속성, 탭 상태
  보존(탭별 스택), 햅틱, working pulse, 슬라이딩 세그먼트, 인터랙티브 키보드
  내림, Enter 전송, RefreshControl/FAB 마감. 시뮬레이터 라이브에서 push 전환·
  버튼 pop·탭 전환 확인.
- 이전 검증(재구축 M1–M4): 시뮬레이터 라이브 — 자동 복구 연결 → Herd 실시간
  목록 → 에이전트 상세(ANSI 트랜스크립트) → 프롬프트 전송 → 상태 전환·제목
  갱신 → agy 시작·블록 감지·키 승인·응답. 캡처:
  `showcase-captures/rebuild-v2-*.png`.
