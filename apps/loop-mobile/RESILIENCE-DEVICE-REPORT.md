# LoopMobile iPhone 15 실기기 확인 리포트 (Personal Team 자동 서명)

- **기기**: 임채승의 iPhone 15 (iPhone15,4) — devicectl ID `B31B68D5-3A83-56EF-8F0D-D7A24E01F311`, xcodebuild destination `00008120-000A0DEA02D1A01E`
- **상태**: `connected` (xcrun devicectl list devices)
- **서명**: Personal Team `88WFD6M5FC` (채승 임, Personal Team) · `CODE_SIGN_STYLE=Automatic` · `-allowProvisioningUpdates` — 빌드 시 연결 기기가 팀에 자동 등록됨
- **빌드**: Release / Release-iphoneos — `** BUILD SUCCEEDED **`
- **아티팩트**: `apps/loop-mobile/ios/build/Build/Products/Release-iphoneos/LoopMobile.app` (codesign: `org.reactjs.native.example.LoopMobile`, arm64, embedded signature)
- **설치**: `devicectl device install app` 성공 — 기기 앱 목록에서 확인:
  `LoopMobile  org.reactjs.native.example.LoopMobile  1.0`
- **실행**: `devicectl device process launch` → **거부됨** (`FBSOpenApplicationErrorDomain error 3`).
  원인: Personal Team 프로비저닝 프로파일이 기기에서 아직 신뢰되지 않음.
  **사용자 조치(사람만 가능)**: iPhone 설정 → 일반 → VPN 및 기기 관리 →
  "채승 임 (Personal Team)" 개발자 앱 신뢰(Trust) → 다시 실행.
  이 조치는 화면 조작이 요구사항에서 금지되어 있어 에이전트가 수행하지 않았다.

## 7단계 기기 확인 체크리스트 (사용자 수동 확인용)

앱 실행 신뢰 설정 후, 기기의 LoopMobile에서 아래 순서대로 확인한다.
게이트웨이는 Mac에서 `loop` 게이트웨이를 실행하고, iPhone은 같은 네트워크에 둔다.

| # | 항목 | 절차 | 통과 기준 |
|---|------|------|-----------|
| 1 | **게이트웨이 연결** | Connect 화면에 게이트웨이 주소 입력 → 연결 | 연결 상태가 `connected`로 표시, 오류 배너 없음 |
| 2 | **프롬프트 제출** | Submit 화면에서 프롬프트 입력 후 전송 | 전송 성공, 런이 생성되어 목록에 표시 |
| 3 | **라이브 상태·출력** | Run 화면에서 진행 중 런 관찰 | 상태가 실시간으로 갱신되고 출력 텍스트가 스트리밍됨 (SSE) |
| 4 | **steer** | 진행 중 런에 steer 입력 전송 | steer가 수용되고 런 상태에 반영됨 |
| 5 | **비행기 모드 후 재접속 이어받기** | 스트리밍 중 비행기 모드 ON → 5초 후 OFF | 재접속 후 커서(Last-Event-ID) 이어받기로 누락 프레임 없이 중복 없이 출력이 이어짐 |
| 6 | **로그아웃 → 재로그인 복원** | 설정에서 로그아웃 → 재연결 | Keychain 자격증명이 지워졌다가 재로그인 후 연결·런 목록 복원 |
| 7 | **오류 표시** | 게이트웨이 중단 또는 잘못된 주소로 강제 오류 | 사람이 읽을 수 있는 오류 메시지 1회 표시, 입력 초안(draft)이 보존됨 |

## 복원력 변경 요약 (이전 실행 mobile-resilience, 테스트 381 pass 기준)

- **429 Retry-After 백오프** (`src/gateway-client/retry.ts`, `client.ts`)
  - Retry-After 파싱: RFC 9110 delta-seconds와 HTTP-date 모두 지원, 없거나 깨진 헤더는 `null` → 백오프 폴백
  - 제출(submit)/steer: 서버 힌트(Retry-After)를 그대로 사용, 힌트 없으면 1s → 2s → 상한 지수 백오프 + 지터(jitter)
  - 스트림(SSE) 연결도 동일 정책 적용, `STREAM_429_MAX_RETRIES` 초과 시 표시 가능한 오류로 포기
  - 재시도 가능/불가 분류: 429는 본문이 깨져도 상태 코드 기준 재시도, **401/403은 본문과 무관하게 비재시도(터미널)** 로 분류
  - 네트워크 실패·400 등 다른 상태는 제출을 정확히 1회만 시도(비멱등 보호)
- **전송 중 단절 시 커서 이어받기** (`src/gateway-client/sse.ts`, `xhr-sse.ts`)
  - SSE 연결이 스트림 도중 끊기면 마지막 이벤트 ID(Last-Event-ID 커서)로 재접속
  - 커서 리플레이로 프레임 누락 없음·중복 없음이 테스트로 검증됨
  - 429로 끊긴 SSE 재연결에도 힌트 지연 적용, 손실 없음
- **폴백 (컴포저 초안 보존 계약)**
  - 게이트웨이 포화(429 소진) 시 화면에 실패 메시지 1회 표시, 작성 중이던 초안은 보존되어 재시도 성공
- **주요 테스트** (`test/resilience.test.ts` 18개 + 관련 파일, 전체 기준선 381 pass)
  - `delta-seconds map 1:1 to milliseconds (0 included)`
  - `HTTP-date resolves to the remaining delay, never negative`
  - `absent or junk header yields null (caller falls back to backoff)`
  - `submit/steer delays honor Retry-After verbatim on every attempt`
  - `submit/steer without a hint: 1s → 2s → capped exponential, jitter added`
  - `stream delays honor Retry-After; otherwise backoff + jitter`
  - `429 is retryable even when the problem body is junk (status wins)`
  - `401/403 are non-retryable regardless of body contents`
  - `GatewayError carries the parsed Retry-After from the response`
  - `transient 429s are absorbed: submit succeeds on a later attempt`
  - `steer honors the same 429 retry budget and succeeds`
  - `past POST_429_MAX_ATTEMPTS submit gives up with a displayable GatewayError`
  - `a network failure still gets exactly ONE submit attempt (non-idempotent)`
  - `a 400 problem still gets exactly ONE submit attempt (no other status retried)`
  - `a 429'd SSE connection is retried with the hinted delay and loses nothing`
  - `persistent 429s past STREAM_429_MAX_RETRIES give up with a displayable error`
  - `mid-stream dropout: cursor replay loses no frame and duplicates nothing`
  - `a saturated gateway surfaces one onFailure message; retry then succeeds`

## 검증 로그

- 기기 연결: `xcrun devicectl list devices` → `임채승의 iPhone … connected iPhone 15`
- 빌드: `xcodebuild -workspace LoopMobile.xcworkspace -scheme LoopMobile -configuration Release
  -destination 'platform=iOS,id=00008120-000A0DEA02D1A01E' DEVELOPMENT_TEAM=88WFD6M5FC
  CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates -derivedDataPath build build` → `BUILD SUCCEEDED`
  (비고: `-destination generic/platform=iOS`로는 무료 팀에 기기 등록이 안 되어
  "Your team has no devices" 오류가 났고, 실기기 destination 지정으로 해결)
- 설치: `xcrun devicectl device install app --device B31B68D5-…F311 …/Release-iphoneos/LoopMobile.app` → `App installed`
- 설치 입증: `xcrun devicectl device info apps --device B31B68D5-…F311 | grep -i LoopMobile` → 1행 일치
- 실행: `xcrun devicectl device process launch --device … org.reactjs.native.example.LoopMobile`
  → `FBSOpenApplicationErrorDomain error 3` (프로파일 미신뢰, 위 사용자 조치 참조)
- 최종 소스 테스트/typecheck: 저장소 선언 체크(`bun test test`, `bun run typecheck`) 재실행 결과는 실행 기록 참조
