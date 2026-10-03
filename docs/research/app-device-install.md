# Loop 원격 앱 설치/실행 가이드 (게이트웨이 서비스 + 데스크톱 + 모바일)

- **태스크:** `app-device-install` / `gateway-dual-bind-fix`
- **작성일:** 2026-09-25 (2026-xx 루프백 이중 바인딩 개정)
- **범위:** Tailscale IP `100.80.133.120` **+ 루프백 127.0.0.1**에 이중 바인딩된 Loop 게이트웨이 launchd 서비스, Tauri 데스크톱 앱 빌드 산출물, RN 모바일 앱의 iOS 시뮬레이터 빌드/부팅, iPhone 실기기(15, `100.102.37.28`) 수동 설치 단계
- **선행 문서:** [`docs/decisions/2026-xx-remote-app-architecture.md`](../decisions/2026-xx-remote-app-architecture.md) (§2 D2 바인딩/인증, §4 wire contract), [`docs/decisions/2026-xx-tokenless-auth-and-app-layout.md`](../decisions/2026-xx-tokenless-auth-and-app-layout.md) (§D-A1 토큰리스, §D-A4 루프백 이중 바인딩 개정), [`app-remote-access-verification.md`](app-remote-access-verification.md) (attempt 0 통합 검증)

이 문서의 모든 검증은 결정론적이다. 게이트웨이는 stub planner(단일 `gateway-app` 태스크)로 띄우며 유료 모델 호출은 없다. bearer secret/토큰은 환경변수·프로세스 메모리에만 존재하고 저장소·로그에 기록되지 않는다(AGENTS.md "do not persist or log credentials").

---

## 1. 요약: 무엇이 설치되어 실행 중인가

| 구성요소 | 상태 | 위치/포트 |
| --- | --- | --- |
| 게이트웨이 서비스 | **실행 중** (launchd `kr.ll3.loop.gateway`, KeepAlive) | `http://100.80.133.120:18477/v1` + `http://127.0.0.1:18477/v1` (루프백, §D-A4) |
| 데스크톱 앱 (Tauri) | **빌드 완료, 실행 확인** | `apps/loop-desktop/src-tauri/target/release/bundle/macos/Loop Desktop.app` |
| 모바일 앱 (RN) | **시뮬레이터 빌드/부팅 완료** | `apps/loop-mobile/ios/build/Build/Products/Release-iphonesimulator/LoopMobile.app` |
| 실기기(iPhone 15) | **수동 단계만 문서화** (§6) — 서명/프로비저닝은 사용자 Apple 계정 필요 | `100.102.37.28` (Tailscale 이미 온라인) |

앱의 기본 게이트웨이 URL은 `http://100.80.133.120:18477`로 프리필되어 있다(데스크톱: connect 화면 input 기본값, 모바일: `ConnectScreen`의 `DEFAULT_GATEWAY_HOST/PORT`).

---

## 2. 게이트웨이: 바인딩 구성

게이트웨이는 토큰리스 tailscale 모드(결정 §D-A1)로 **설정된 Tailscale 주소에 더해 루프백 127.0.0.1에 동일 포트로 이중 바인딩**한다(결정 §D-A4 개정 — 루프백 트래픽은 기기를 떠나지 않으므로 토큰리스 서빙이 안전). 시작 시 `OsTailscaleInspector`가 1차 주소의 활성 Tailscale interface 소속 여부를, `validateLoopbackBindHost`가 루프백 리터럴임을 각각 fail-closed로 검사한다. wildcard/LAN 주소는 양쪽 모두 거부된다.

구성은 전부 환경변수다(`packages/gateway/src/config.ts`):

| 환경변수 | 이 설치의 값 | 의미 |
| --- | --- | --- |
| `LOOP_GATEWAY_HOST` | `100.80.133.120` | 바인딩할 Tailscale IP (필수) |
| `LOOP_GATEWAY_PORT` | `18477` | 포트 (필수, 1..65535) |
| `LOOP_GATEWAY_LOOPBACK` | 미설정 (= `on`) | 루프백 리스너 on/off (§D-A4, 기본 on) |
| `LOOP_GATEWAY_LOOPBACK_HOST` | 미설정 (= `127.0.0.1`) | 루프백 리스너 주소 (루프백 리터럴만 허용) |
| `LOOP_GATEWAY_LOOPBACK_PORT` | 미설정 (= 주 포트 동일) | 루프백 리스너 포트 |
| `LOOP_GATEWAY_DATABASE_PATH` | `~/.loop/gateway/loop.db` | Loop store SQLite 경로 (필수) |
| `LOOP_GATEWAY_JWT_SECRET` | `~/.loop/gateway.env`에서 주입 | HS256 서명 secret (토큰리스 모드에서 불요 — bearer-fallback에서만 필수) |
| `LOOP_GATEWAY_JWT_ISSUER` | `loop-gateway` | bearer-fallback 모드의 필수 `iss` |
| `LOOP_GATEWAY_JWT_AUDIENCE` | `loop-gateway` | bearer-fallback 모드의 필수 `aud` |

포트를 바꾸려면 `~/.loop/gateway.env`의 `LOOP_GATEWAY_PORT`를 수정하고 §3의 재시작 명령을 실행한다. 앱 쪽 기본값도 함께 바꾼다(§5, §6).

### 2.1 스모크 프로브 (결정론적 검증)

```bash
bun run gateway:smoke
```

실제 게이트웨이 어댑터를 **다른 포트(기본 18478)** 로 프로세스 내에서 띄운 뒤, 다음을 확인한다(토큰리스 tailscale 모드 + 루프백 이중 바인딩, 결정 §D-A1/§D-A4):

1. bearer 없는 `GET /v1/runs`(Tailscale IP 경유) → 200 (토큰리스 — bearer 헤더는 무시됨)
2. bearer 없는 `GET /v1/runs`(127.0.0.1 경유) → 200 (루프백 이중 바인딩)
3. `POST /v1/runs` → 202 + `runId`
4. `GET /v1/runs/{runId}` → 200
5. `GET /v1/runs` → 목록에 run 포함
6. `GET /v1/runs/{runId}/events`(`Accept: text/event-stream`) → 초기 `event: status` 프레임

마지막 줄이 검증 결과다: `gateway-smoke: PASS (bound to Tailscale IP 100.80.133.120, port 18478)`. 프로브용 secret/토큰은 프로세스 메모리와 0600 임시 curl config에만 존재하고 즉시 삭제된다.

---

## 3. 게이트웨이: 서비스 설치 (launchd)

이 설치는 LaunchAgent로 상시 실행된다. **부트 타임 자격증명은 사용자 소유의 0600 파일에서만 읽는다** — 저장소·plist·로그에 secret을 쓰지 않는다.

### 3.1 설치 절차 (신규 설치 순서)

```bash
# 1) 환경 파일 (0600, 사용자 관리 — secret 교체는 이 파일 편집 후 재시작)
#    LOOP_GATEWAY_JWT_SECRET=<랜덤 hex>  (bearer-fallback 모드에서만 필수 — 토큰리스 모드에서는 참고용)
mkdir -p ~/.loop/gateway && touch ~/.loop/gateway.env && chmod 600 ~/.loop/gateway.env

# 2) LaunchAgent plist 등록 (secret 없음, scripts/gateway-serve.sh 경유)
#    ~/Library/LaunchAgents/kr.ll3.loop.gateway.plist
#    (스크립트로 설치 권장 — 구 plist 생성 + 이전 라벨 정리를 함께 처리)
scripts/gateway-launchd-install.sh install
#    또는 수동: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/kr.ll3.loop.gateway.plist

# 3) 서비스 로그 (listening 라인만 기록; prompt/토큰 미기록)
#    ~/.loop/gateway/service.log
```

이미 등록된 서비스의 재시작은 `launchctl kickstart -k ...`(아래). plist가 이미 존재하는데 서비스가 언로드 상태였다면 bootstrap 한 번이면 충분하다.

연산 확인 (세 주소 동시 프로브, §D-A4 완료 조건):

```bash
launchctl print gui/$(id -u)/kr.ll3.loop.gateway | grep -E "state|pid"
curl -s -o /dev/null -w '%{http_code}\n' http://100.80.133.120:18477/v1/runs   # → 200 (토큰리스)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:18477/v1/runs       # → 200 (루프백)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18477/v1/runs       # → 200 (루프백)
```

관리 명령:

```bash
launchctl kickstart -k gui/$(id -u)/kr.ll3.loop.gateway    # 재시작 (env 파일 재적용)
launchctl bootout gui/$(id -u)/kr.ll3.loop.gateway         # 중지/등록 해제
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/kr.ll3.loop.gateway.plist  # (재)등록
# 또는: scripts/gateway-launchd-install.sh {install|uninstall|restart|status}
#
# 라벨 변경 이력: 2026-xx 운영자 지시로 `dev.loop.gateway` → `kr.ll3.loop.gateway`.
# 과거 evidence 문서(docs/findings/abc-verification.md, simulator-showcase/*)의
# `dev.loop.gateway` 참조는 당시 실행 기록이므로 원문 유지.
```

수동 포그라운드 실행이 필요하면: `bun run gateway:serve` (같은 스크립트, 같은 env 파일 사용).

### 3.2 v7 쇼케이스 임시 wrapper 청소 (gateway-dual-bind-fix)

`docs/research/simulator-showcase/v7/gateway-wrapper.ts`는 데모 당시 SSE 클라이언트 단절 시 프로세스 사망을 막으려는 프로세스 레벨 예외 가드 때문에 존재했다. 해당 방어가 `sseTransport` 펌프 가드(server.ts)로 정상 구현되어 더 이상 필요 없으므로, 임시 wrapper 프로세스를 종료하고 실제 launchd 서비스로 대체한다:

```bash
# 임시 wrapper(포트 18477 점유)와 그 부모 셀 종료
pkill -f "bun docs/research/simulator-showcase/v7/gateway-wrapper.ts" || true

# 실제 서비스 기동 (§3.1)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/kr.ll3.loop.gateway.plist
```

### 3.3 bearer 토큰 발급 (bearer-fallback 모드에서만 필요)

토큰리스 tailscale 모드에서는 앱이 bearer 없이 연결된다(§D-A1). 순수 LAN 등 비-Tailscale 폴백 모드 운영 시에만 저장소의 `signHs256Token` 헬퍼로 out-of-band 발급한다:

```bash
bun -e '
const fs = require("node:fs");
const env = Object.fromEntries(fs.readFileSync(process.env.HOME + "/.loop/gateway.env", "utf8")
  .trim().split("\n").map((l) => l.split("=", 2)));
const { signHs256Token } = await import("./packages/gateway/src/auth.ts");
const exp = Math.floor(Date.now() / 1000) + 24 * 3600; // 24시간
process.stdout.write(signHs256Token({ iss: env.LOOP_GATEWAY_JWT_ISSUER, aud: env.LOOP_GATEWAY_JWT_AUDIENCE, exp }, env.LOOP_GATEWAY_JWT_SECRET));
' 2>/dev/null
```

출력된 토큰을 앱 connect 화면의 bearer 필드에 붙여넣는다. 토큰은 앱 프로세스 메모리에만 존재한다(재시작 후 재입력).

---

## 4. 데스크톱 앱 (Tauri)

### 4.1 산출물

- **앱 번들:** `apps/loop-desktop/src-tauri/target/release/bundle/macos/Loop Desktop.app` (arm64, ad-hoc 서치 — 로컬 실행 가능, Gatekeeper 공개 배포용 아님)
- **원본 바이너리:** `apps/loop-desktop/src-tauri/target/release/loop-desktop`

실행 확인(이 설치에서 수행): `open "Loop Desktop.app"` → 프로세스 기동 확인 → 정상 종료.

### 4.2 재빌드 방법

```bash
cd apps/loop-desktop
bun install                 # @tauri-apps/cli 포함
bun run build:frontend      # src/main.ts → ui/app.js
bunx tauri build --bundles app
```

아이콘 소스(`src-tauri/icons/*`)는 `bunx tauri icon <1024x1024.png>`로 재생성할 수 있다.

### 4.3 연결

1. 앱 실행 → **게이트웨이 주소** 필드에 `http://100.80.133.120:18477` 프리필 (그대로 사용)
2. bearer 필드는 비워 둔다(토큰리스 tailscale 모드, §D-A1) → 연결
3. 프롬프트 제출 → run 상태/bounded output SSE 표시

known risk: Tauri webview의 fetch는 `tauri-plugin-http`를 거치며 SSE body 스트리밍 지원 여부는 폴링 폴백(`GET /v1/runs/{id}`)으로 보완된다(앱 README "알려진 리스크" 참고).

---

## 5. 모바일 앱 — iOS 시뮬레이터 (이 설치에서 수행)

네이티브 프로젝트(RN 0.81.4 템플릿 `ios/`)가 `apps/loop-mobile/ios`에 포함되어 있다. JS 소스는 기존 `src/`(React 19.1 / RN 0.81.4 고정)를 그대로 사용하고, `index.js`가 `./src/App`을 등록한다.

### 5.1 빌드 + 설치 + 부팅 (재현 명령)

```bash
cd apps/loop-mobile
bun install
cd ios && pod install && cd ..
bash scripts/build-ios-simulator.sh     # Release 빌드 → 시뮬레이터 설치/부팅 (기본: 부팅된 기기, 없으면 iPhone 17)
```

빌드 산출물: `apps/loop-mobile/ios/build/Build/Products/Release-iphonesimulator/LoopMobile.app` — Release 구성이라 JS가 앱에 정적 번들되고 부팅에 Metro dev 서버가 필요 없다.

개발 모드(HMR): `bun run start`(Metro) + `bun run ios`.

### 5.2 연결

1. 시뮬레이터에서 LoopMobile 실행 → connect 화면에 `100.80.133.120` / `18477` 프리필
2. §3.3은 불요 — bearer 없이 Connect → 프롬프트 제출 (토큰리스 tailscale 모드)

시뮬레이터는 호스트와 네트워크를 공유하므로 호스트의 Tailscale IP로 직접 접속된다. 실기기와 동일한 URL을 쓴다.

---

## 6. 모바일 앱 — iPhone 실기기 (수동 단계, 사용자 수행 필요)

시뮬레이터와 달리 실기기 설치에는 Apple 서명/프로비저닝이 필요하다. 이 단계들은 사용자의 Apple 계정/팀 설정에 의존하므로 자동화하지 않았다. 전제: iPhone 15에 Tailscale 앱이 설치되어 있고 tailnet에 온라인(`100.102.37.28` 확인됨).

1. **Apple ID / 팀 준비**
   - 개인 무료 계정도 가능(7일 유효, 기기 3대 제한). 유료 팀이면 Team ID를 쓴다.
   - Xcode > Settings > Accounts에서 계정 로그인.

2. **서명 설정 (Xcode)**
   - `apps/loop-mobile/ios/LoopMobile.xcworkspace`를 Xcode로 연다.
   - LoopMobile target > Signing & Capabilities:
     - "Automatically manage signing" 체크
     - Team 선택 (또는 Personal Team)
     - Bundle identifier를 고유값으로 변경: 예) `dev.loop.mobile.<이니셜>` — 현재 값은 RN 예약용 `org.reactjs.native.example.LoopMobile`이며 스토어/실기기 부적합. **바꾼 값은 §6.4와 모바일 README에도 반영.**
   - deployment target(iOS 15.1)은 그대로 둔다.

3. **기기 등록 + 빌드**
   - iPhone을 케이블로 연결(또는 무료 계정이면 Wi-Fi 디버깅도 가능) → Xcode가 자동 등록.
   - 기기/destination에서 iPhone 15 선택 → ▶︎ Run (Debug + Metro 자동, 또는 Product > Archive 후 Devices에서 설치).
   - 명령줄 선호 시:
     ```bash
     cd apps/loop-mobile/ios
     xcodebuild -workspace LoopMobile.xcworkspace -scheme LoopMobile \
       -destination 'platform=iOS,name=iPhone 15' -allowProvisioningUpdates build
     ```
   - 무료 계정이면 Xcode에서 한 번 Run해야 개발자 모드 프로비저닝이 완료된다.

4. **iPhone 측 신뢰 + 실행**
   - 설정 > 일반 > VPN 및 기기 관리 > 개발자 앱 신뢰(무료 계정인 경우).
   - LoopMobile 실행 → connect 화면에 기본값 `100.80.133.120` / `18477` 확인 → bearer 없이 Connect(토큰리스, §D-A1).
   - iPhone의 Tailscale이 켜져 있어야 한다(이미 `100.102.37.28`로 온라인 확인). tailnet ACL이 iPhone → Mac(100.80.133.120) TCP 18477을 허용하는지 확인한다.

5. **무선 사용**
   - 케이블 분리 후에도 앱은 `http://100.80.133.120:18477/v1`로 tailnet을 경유해 게이트웨이와 통신한다. Mac이 잠자면 KeepAlive launchd 서비스는 유지되지만 네트워크가 끊길 수 있으므로, 상시 사용 시 Mac 전원 설정에서 "잠자지 않음"(또는 caffinate/`pmset -a sleep 0`)을 권장한다.

---

## 7. 검증 근거 (gateway-dual-bind-fix 시점 갱신)

| 검사 | 결과 |
| --- | --- |
| `bun run gateway:smoke` | **PASS** — 토큰리스 tailscale 모드에서 무인증 `GET /v1/runs` 200, 루프백(127.0.0.1) 경유 200, submit 202, status/list 200, SSE `event: status` 프레임 |
| 삼중 프로브 (§3.1 완료 조건) | **PASS** — `100.80.133.120:18477`, `localhost:18477`, `127.0.0.1:18477` 동시에 200 (launchd 서비스 대상) |
| `bun test packages/gateway/test` | **128 pass / 0 fail** (이중 바인딩·SSE 단절 강화 회귀 포함) |
| v7 임시 wrapper 정리 | **PASS** — `bun docs/research/simulator-showcase/v7/gateway-wrapper.ts` 프로세스 종료, launchd `dev.loop.gateway`로 대체 (§3.2) |
| 데스크톱 실행 | **PASS** — `.app` open → 프로세스 기동/정상 종료 (attempt 0) |
| 시뮬레이터 부팅 | **PASS** — iPhone 17 (attempt 0). 스크린샷에서 Connect 화면과 프리필된 `100.80.133.120` / `18477` 렌더링 확인 |
| 유료 모델 호출 | **없음** (stub planner, 게이트웨이 단위 테스트와 동일 경로) |

## 8. 보안 메모

- `~/.loop/gateway.env`(0600)는 **유일한** secret 저장 위치다. 저장소·plist·로그에는 자격증명이 없다. 이 파일은 사용자 홈의 배포 시크릿이므로 AGENTS.md의 저장소 규칙과 충돌하지 않지만, 회수하려면 파일 삭제 후 서비스 중지(persist를 원치 않으면 `launchctl bootout`).
- 앱 bearer/게이트웨이 토큰은 프로세스 메모리 전용(ADR §D2). 토큰리스 모드에서는 저장·입력할 비밀이 없으며, 비-Tailscale 폴백 모드에서만 §3.3으로 재발급한다.
- prompt/토큰은 게이트웨이 access log(`~/.loop/gateway/service.log`)에 기록되지 않는다. 로그에는 listening 라인만 남는다.

## 9. 변경 파일

- `package.json` — `gateway:smoke`, `gateway:serve` 스크립트 추가 (attempt 0)
- `scripts/gateway-smoke.ts` — 스모크 프로브: 토큰리스 200 + 루프백 이중 바인딩 검증으로 갱신 (gateway-dual-bind-fix)
- `scripts/gateway-serve.sh` — 서비스/수동 포그라운드 러너 (attempt 0 신규; 루프백은 게이트웨이 기본값으로 자동)
- `packages/gateway/src/tailscale.ts` — `validateLoopbackBindHost` + `LoopbackBindRejectedError` (§D-A4)
- `packages/gateway/src/config.ts` — `loopback` 설정 + `LOOP_GATEWAY_LOOPBACK_*` env 파싱 (§D-A4)
- `packages/gateway/src/server.ts` — 이중 바인딩(동일 fetch 파이프라인 공유) + SSE 펌프 단절 가드 (§D-A4 / v7 wrapper 사전조건)
- `packages/gateway/src/main.ts` — 부트 로그에 두 리스너 표기 + `stop()` 재귀 버그 수정
- `packages/gateway/test/dual-bind.test.ts` — 이중 바인딩·SSE 강화 테스트 (신규)
- `packages/gateway/test/helpers.ts` — `TestGateway.authNames` 노출 (추가)
- `docs/decisions/2026-xx-tokenless-auth-and-app-layout.md` — §D-A4 루프백 이중 바인딩 개정
- `apps/loop-desktop/ui/index.html` — 기본 게이트웨이 URL 프리필 (attempt 0)
- `apps/loop-desktop/src-tauri/tauri.conf.json` — bundle icon 목록 추가 (attempt 0)
- `apps/loop-desktop/package.json` — `@tauri-apps/cli` devDependency (빌드 도구, attempt 0)
- `apps/loop-desktop/src-tauri/icons/**` — `tauri icon` 생성 아이콘 세트 (attempt 0)
- `apps/loop-mobile/ios/**` — RN 0.81.4 네이티브 iOS 프로젝트 (attempt 0 신규)
- `apps/loop-mobile/{index.js,app.json,metro.config.js,babel.config.js}` — RN 엔트리/설정 (attempt 0 신규)
- `apps/loop-mobile/package.json` — react/react-native 빌드 의존성 + ios 빌드 스크립트 (attempt 0)
- `apps/loop-mobile/scripts/build-ios-simulator.sh` — 시뮬레이터 빌드/설치/부팅 스크립트 (attempt 0 신규)
- `apps/loop-mobile/src/screens/ConnectScreen.tsx` — 기본 host/port 프리필 (attempt 0)
- `apps/loop-mobile/README.md` — 네이티브 빌드 절차 갱신 (attempt 0)
