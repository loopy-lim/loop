# loop-mobile (React Native)

Loop 원격 모바일 앱 스캐폴드. Tailscale 네트워크의 Loop HTTP 게이트웨이(`http://<host>:<port>`, `/v1`)에 접속해 프롬프트를 제출하고 run 상태와 bounded output을 SSE로 실시간 표시한다.

계약 원본: [`docs/decisions/2026-xx-remote-app-architecture.md`](../../docs/decisions/2026-xx-remote-app-architecture.md) (v1 wire contract §4).

## 레이아웃

```text
src/
  config/connection.ts     base URL(http://<host>:<port>) 검증 + bearer. 프로세스 메모리 전용.
  gateway/wire.ts          v1 wire payload 타입 (임시 seam — 아래 "wire seam" 참고)
  gateway/problem.ts       RFC 9457 problem 파싱, code/status 분기
  gateway/sse.ts           증분 SSE 프레임 파서(id/event/data, keepalive 무시)
                           + Utf8ChunkDecoder(Hermes에 TextDecoder가 없다)
  gateway/xhr-sse.ts       RN용 SSE 전송(RN fetch는 response.body가 없다 — XHR 증분 이벤트)
  gateway/client.ts        GatewayClient: submitPrompt / listRuns / getRun / observeRun
                           (실행 시 프루브로 표준 fetch 스트림 ↔ XHR 전송 선택)
  state/runProjection.ts   이벤트 리듀서: activityId dedupe, reset/terminal 반영
  ui/Screen.tsx            공용 화면 레이아웃 — 중앙 컬럼(maxWidth 480), 내부 좌측 정렬 리듬
  screens/ConnectScreen.tsx  host:port + token 입력(메모리에만 보관)
  screens/SubmitScreen.tsx   prompt 제출, runId 수신 + 실제 runs 목록(Recent runs)
  screens/RunsList.tsx       GET /v1/runs 목록 — 행 탭으로 라이브 RunScreen 진입
  screens/RunScreen.tsx      live status(태스크별 행 포함) + bounded output
  App.tsx                  화면 전환 wiring(모든 분기를 Screen으로 감쌈)
test/
  mock-gateway.ts          로컬 목 게이트웨이(Bun.serve) — 계약 fixture 제공
  contract-client.test.ts  목 게이트웨이 대상 contract-client 테스트
  run-projection.test.ts   리듀서 단위 테스트
  sse-decoder.test.ts      Utf8ChunkDecoder: 청크 경계 멀티바이트/malformed 처리
  xhr-sse.test.ts          XHR 전송: 증분 청크/조기 중단/문제 본문/네트워크 실패
```

## 실행

헤드리스 계약/리듀서 테스트는 루트에서 즉시 실행된다(네트워크·유료 모델 호출 없음):

```bash
bun test apps/loop-mobile/test
```

네이티브 iOS 빌드(시뮬레이터):

```bash
cd apps/loop-mobile
bun install
cd ios && pod install && cd ..
bash scripts/build-ios-simulator.sh          # Release 빌드 + 시뮬레이터 설치/부팅
bun run ios                                  # 개발 모드(Metro dev 서버 필요)
```

기본 게이트웨이 주소는 `src/screens/ConnectScreen.tsx`의 `DEFAULT_GATEWAY_HOST/PORT`
(이 설치 기준 `loopy-macbookpro.tail42f248.ts.net:18477` — iOS 26 ATS는 숫자 IP에
`NSAllowsArbitraryLoads`를 무시하므로 MagicDNS 호스트명이 기본값이다)이며, 앱 첫 화면에 프리필된다.
전체 설치/실행 가이드는 [`docs/research/app-device-install.md`](../../docs/research/app-device-install.md) 참고.
시뮬레이터 실제 run 시연은 [`docs/research/simulator-showcase/`](../../docs/research/simulator-showcase/README.md)(v2) 참고.

## 자격증명 정책

- bearer token은 `ConnectionConfig`에만 존재하며 프로세스 메모리에서만 유지된다.
- AsyncStorage, 파일, DB, 로그 어디에도 쓰지 않는다. 앱 재시작 후 재입력/재주입한다.
- 게이트웨이 로그와 마찬가지로 앱도 prompt를 로깅하지 않는다.

## wire seam (임시)

`src/gateway/wire.ts`는 v1 wire payload의 읽기 측 타입 표면이다. `bridge-protocol-types` 작업이 `crates/loop-bridge`의 Rust 타입과 `packages/protocol` 생성물을 다시 확정하면:

1. `src/gateway/wire.ts`를 삭제하고,
2. 모든 import를 `@loop/protocol` 생성 타입(`SubmitPromptInput`, `SubmitPromptAccepted`, `RemoteRun`, `RemoteRunStatus`, `TaskCounts`, `RemoteRunSummary`, `RemoteTask`, `RemoteAttention`, `RemoteRunEventEnvelope` 등)으로 교체한다.
3. `bun test apps/loop-mobile/test`가 green이면 seam 제거 완료다.

이 파일은 Rust 도메인 타입이 아직 저장소에 존재하지 않기 때문에, 기록된 계약(ADR §4)에 대한 앱 측 읽기 뷰로 두었으며 유일한 drift 지점으로 하나의 파일에 모아 있다.

## 대화 디테일 (결정 2026-xx-codex-detail-checklist)

- C1~C16 수용 기준은 `src/features`(markdown/markdown-view/tool-summary/time-format/timeline-rows), `src/ui`(copy/DynText/glyphs), `src/screens/ConversationScreen`에 구현돼 있다. 신규 npm 의존성 0(마크다운 자체 파서, 클립보드는 RN 코어 `Clipboard` 폴백), 신규 프로젝션 상태 0(모두 기존 `occurredAt`/`final`/`argsJson`/`truncated` 필드의 렌더 시 소비).
- 날짜 헤더와 행 캡션은 렌더 파생 행(`src/features/timeline-rows.ts`)이며 프로젝션/타임라인 어휘에 들어가지 않는다(D4 §6 준수).

## 타임라인 가상화 — 후속 트리거 (C17, 이번 사이클 무변경)

타임라인 렌더는 `ScrollView`(동작 불변, AC17-1). 장기 세션에서 아이템 수가 권고 상한(500)을 넘기고 스크롤 프레임 드랍이 관측되면, `FlatList` + `inverted` 전환을 후속 결정으로 접수한다(AC17-2). 전환 시 D4 멱등 키와 날짜 파생 행 체계(`timeline-rows.ts`)를 그대로 유지할 것.
