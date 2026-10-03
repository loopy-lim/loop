# 결정: 토큰 없는 Tailscale 인증 모델 + 앱 파일 계층 목표 구조

- **상태:** 결정됨 (draft → 확정, 본 문서가 결정 기록)
- **태스크:** `tokenless-auth-and-layout-decision` (decision, attempt 1)
- **작성일:** 2026-xx
- **선행 문서와의 관계(개정):**
  - [`2026-xx-app-credential-persistence.md`](2026-xx-app-credential-persistence.md) **§2 결정 및 D1을 부분 개정**한다 — OS 보안 저장소(Keychain/Keystore/keyring) 저장은 유효하나, 그 대상은 **비-Tailscale 폴백 모드의 bearer 전용**으로 한정된다(§D-A3).
  - [`2026-xx-remote-app-architecture.md`](2026-xx-remote-app-architecture.md) **§D2의 "모든 `/v1/**` 요청은 `Authorization: Bearer`를 요구한다" 문언을 개정**한다 — Tailscale 바인드 리스너에서는 bearer가 요구되지 않는다(§D-A1). 나머지(바인드 fail-closed, Origin 거부, HS256 사양, secret 환경변수 전용)는 무변경.
  - `AGENTS.md` "Do not persist or log credentials"는 개정되지 않는다 — 토큰리스 모드에서는 저장할 자격증명 자체가 없고, 폴백 bearer에만 기존 Keychain 예외(credential-persistence 결정)가 적용된다.
- **읽은 증거:** `packages/gateway/src/tailscale.ts`(CGNAT 100.64.0.0/10 + 활성 인터페이스 fail-closed 검증 이미 구현), `packages/gateway/src/server.ts`(handle()이 무조건 `deps.verifier.verify` 호출 — 현재는 Tailscale 바인드에서도 bearer 요구), `packages/gateway/src/auth.ts`(Hs256BearerVerifier, 미설정 시 fail closed), `apps/loop-mobile/src/**`(screens/ui/state/gateway/auth/config 계층 존재, `features/` 없음, `gateway/` 명칭), `apps/loop-desktop/src/**`(screens/state/wire 계층, `wire/gateway-client.ts`가 seam), `apps/loop-desktop/test/boundaries.test.ts`(계층 강제 아키텍처 테스트 선례)

## 1. 배경

운영자 요구 4가지 중 (1) 토큰 없는 설치와 (4) 앱 계층 정리를 하나의 결정으로 고정한다. 현재 게이트웨이는 Tailscale 주소 바인드를 fail-closed로 강제하지만(`validateBindableHost`), 리스너에 도달한 요청까지 전부 bearer를 요구하므로 설치마다 토큰 발급·주입이 필요하다. 반면 바인드가 이미 "활성 Tailscale 인터페이스의 CGNAT 주소"로 한정되어 있으므로, 연결 도달성 자체가 tailnet 멤버십(WireGuard 암호화 + ACL 통과)을 증명한다. 앱 측은 모바일과 데스크톱의 계층 명칭(`gateway/` vs `wire/`)과 깊이가 어긋나 데스크톱 패리티 작업의 저항이 된다.

## 2. 결정 (한 단락)

**(1) 토큰리스 인증:** 게이트웨이는 **Tailscale 인터페이스에만 바인드**하며(기존 fail-closed 검증 유지), Tailscale 바인드 리스너에 도달한 요청은 **tailnet 멤버십을 신뢰하여 bearer 검증을 생략**한다. 플랫폼이 지원하면(예: Linux에서 tailscaled whois 소켓) peer identity 확인을 **옵션 설정**으로 켤 수 있고, 최초 1회 페어링은 identity 확인이 불가능한 플랫폼에서만 필요 시 선택한다. bearer 인증은 **비-Tailscale 폴백 모드에서만** 존재한다 — 폴백은 명시적 설정 옵트인 없이는 활성화되지 않고, 옵트인 시 기존 `Hs256BearerVerifier`가 필수다. **(2) 앱 계층:** 모바일·데스크톱 모두 `screens/features/gateway-client/state/ui/auth` 계층으로 수렴하고, import 방향 규칙을 아키텍처 테스트로 강제한다(§D-B).

### D-A. 토큰리스 인증 모델

**A1. 신뢰 경계 = tailnet 멤버십.** `validateBindableHost`는 변경 없이 유지한다(와일드카드·루프백·링크로컬·CGNAT 밖 주소는 시작 거부). `server.ts`의 `handle()`은 **리스너 모드**에 따라 인증을 분기한다: Tailscale 바인드 리스너(기본)는 `verifier.verify`를 호출하지 않고, 폴백 리스너만 호출한다. 신뢰 근거는 네트워크 계층이다 — CGNAT 주소로의 도달은 tailnet 멤버의 WireGuard 트래픽임을 의미하며, 게이트웨이는 애플리케이션 계층에서 이를 재확인하지 않는다. Origin 헤더 거부 규칙은 두 모드 모두 유지한다.

**A2. 선택적 identity 확인 / 페어링.** `GatewayConfig`에 `identity?: "off" | "whois"`(기본 `off`)를 추가한다. `whois`는 tailscaled가 제공하는 peer identity(플랫폼 지원 시 한정)를 확인해 비-멤버 요청을 거부한다 — 이는 인증 강화이지 필수가 아니며, 미지원 플랫폼에서는 설정 자체가 거부된다. 최초 1회 페어링(디바이스 등록 목록)은 v1에서 **구현하지 않으며**, 멀티 테넌트 요구가 생기는 경우에만 별도 결정으로 열린다. 단일 운영자 tailnet을 전제로 한다.

**A3. 폴백 모드와 Keychain 한정.** 폴백은 `fallback?: { host: string; port: number }` 형태의 명시적 옵트인으로만 존재하며(바인드 검증에서 CGNAT 밖을 허용하는 유일한 경로), 이 리스너의 모든 요청은 bearer를 요구한다(기존 auth.ts 사양·fail-closed 유지). credential-persistence 결정의 Keychain/Keystore/keyring 저장·생체인증 게이트·로그아웃 삭제 수명주기는 **이 bearer 폴백 전용으로 한정**된다. 토큰리스 모드에서는 앱이 저장할 비밀이 없고, `host:port`는 자격증명이 아니므로 일반 설정값으로 둘 수 있다(단, 저장 금지 목록 파일/로그/콘솔 규칙은 그대로 적용). bearer 미설정 상태로 폴백 리스너를 띄우려는 시도는 시작 시 fail closed한다.

**A4. 루프백 이중 바인딩(개정, localhost 도달성 요구 반영).** 토큰리스(tailscale) 모드의 게이트웨이는 설정된 Tailscale CGNAT 주소에 더해 **기본값으로 루프백 리스너(127.0.0.1, 동일 포트)를 함께 바인드**한다. 보안 근거: (i) 127.0.0.0/8과 ::1로 향하는 트래픽은 커널 루프백 장비만 거치며 물리적·논리적으로 기기 밖으로 나갈 경로가 존재하지 않는다 — 루프백 리스너는 off-box 공격 표면을 넓히지 않는다; (ii) 루프백 도달성은 "같은 호스트의 프로세스 실행"을 의미하는데, 그 신뢰 도메인은 이미 `gateway.env`(0600), SQLite 저장소, 게이트웨이 프로세스 메모리를 읽을 수 있는 운영자 자신과 동일하므로 토큰리스 서빙으로 새로 노출되는 정보가 없다; (iii) 기기 밖의 유일한 표면은 Tailscale 리스너이며 그 신뢰 경계(tailnet 멤버십)는 변경되지 않는다; (iv) 이중 바인딩은 인증을 완화하지 않는다 — 두 리스너는 동일한 fetch 파이프라인(동일 모드·Origin 거부·문제 계약)을 공유하고, bearer-fallback 모드에서는 루프백 리스너를 시작하지 않는다(폴백의 단일 명시 바인드가 그 표면을 이미 정의). 구현 강제: `validateLoopbackBindHost`가 루프백 리터럴(127.0.0.0/8, ::1) 외의 host를 시작 시 거부하고(`LoopbackBindRejectedError`), 설정은 `LOOP_GATEWAY_LOOPBACK=off`(기본 on), `LOOP_GATEWAY_LOOPBACK_HOST`, `LOOP_GATEWAY_LOOPBACK_PORT`로 재정의할 수 있다. `off`는 본 개정 이전의 단일 바인드 자세를 복원한다. 운영 근거: localhost/127.0.0.1 접속이 실패하면 동일 기기의 앱·데모·curl 검증이 전부 Tailscale 주소를 강요당하며, 이는 설치 검증과 디버깅을 불필요하게 어렵게 한다.

**기각한 대안:**

| 대안 | 기각 이유 |
| --- | --- |
| mTLS / 클라이언트 인증서 | 인증서 발급·배포로 "토큰 없는 설치" 목표를 충족하지 못함(토큰을 인증서로 치환한 것) |
| 앱별 API key 발급 서버 | 발급·refresh 인프라가 v1 범위 밖이고 설치 복잡도만 증가 |
| 상태 유지(전 구간 bearer) | 운영자의 토큰리스 설치 요구 불충족; 바인드가 이미 Tailscale 한정인데 이중 인증은 비용만 추가 |

### D-B. 앱 파일 계층 목표 구조

모바일·데스크톱 공통 목표 구조와 import 방향:

```text
src/
  screens/        # 라우트 대상 화면 합성만; 비즈니스 판단 없음
  features/       # 기능 단위 위젯+로직 (예: composer, run-list, attachment 카드)
  gateway-client/ # generated protocol/HTTP/SSE 소비의 유일한 경계 (구 mobile `gateway/`, desktop `wire/`를 통합)
  state/          # projection/store; 위젯 import 금지
  ui/             # 공유 디자인 시스템; 내부 계층 import 금지
  auth/           # 토큰리스/폴백 자격증명 처리 (mobile 기존 auth/ 유지, desktop 신설)
```

Import 방향 규칙 (화살표 = 허용):

```text
screens → features, gateway-client, state, ui, auth
features → gateway-client, state, ui, auth
auth → gateway-client
state → gateway-client
gateway-client → generated protocol 만
ui → (내부 계층 import 없음)
```

핵심 금지: (i) `screens`/`features`에서 generated protocol 직접 import — 반드시 `gateway-client` 경유; (ii) `ui`/`state`/`gateway-client`에서 `screens`/`features` import (상향 참조 금지); (iii) 위 6개 계층 밖의 신규 최상위 디렉터리. 강제는 데스크톱 `boundaries.test.ts` 선례를 확장한 **정적 import 스캔 스크립트/아키텍처 테스트**로 한다(규칙 테이블 기반, 양 앱에 동일 적용, `bun test packages`에 포함). 리네임(`mobile gateway/ → gateway-client/`, `desktop wire/ → gateway-client/`)과 `features/` 추출은 후속 구현 태스크로 분리하며, 본 문서는 목표 구조만 고정한다.

### D-C. 데스크톱 패리티 기대

데스크톱(Tauri)은 동일한 계층 구조와 동일한 `gateway-client` seam을 갖는다. 패리티 판정은 픽셀이 아니라 **계층·기능 수준**이다: M2 이미지 인라인/파일 카드 렌더링(pi attachments/read 경유)이 모바일과 같은 wire contract로 데스크톱에서 동작하고, 인증 모드(토큰리스 기본/폴백)가 동일 설정 계약으로 선택되며, 계층 강제 테스트가 양 앱을 동일 규칙으로 통과하는 것을 기대치로 한다. Rust-first 스키마 확장이 필요한 경우 codegen + 네이티브 재빌드를 전제로 한다(AGENTS 경계 유지).

## 3. 기계 검증 가능한 수용 기준

모두 유료 모델 호출·실기기 없이 검증한다:

1. **zero-[credential]=[redacted] 기동 연결:** Tailscale 바인드 config + `auth` 환경변수 미설정 상태로 게이트웨이 기동 → 클라이언트가 bearer 헤더 없이 `/v1` 요청 → 200/정상 응답. `bun test` 유닛으로 커버(현재는 401이므로 구현 태스크의 회귀 기준).
2. **폴백 bearer 유지:** (a) 폴백 리스너에서 bearer 없음 → 401, 유효 HS256 토큰 → 통과(기존 auth 테스트 재사용), (b) 폴백 옵트인 없이 CGNAT 밖 바인드 시도 → `BindRejectedError`, (c) 폴백 리스너 + secret 미설정 기동 → fail closed.
3. **계층 규칙 강제:** import 스캔 테스트가 (i) screens/features의 generated protocol 직접 import, (ii) ui/state의 screens/features import, (iii) 허용 6계층 밖 신규 디렉터리를 발견하면 실패. 양 앱에 동일 적용.
4. **Keychain 경로 한정:** `auth/` 밖에서 keychain/keyring/credential-store 참조가 나타나면 테스트 실패 — bearer 폴백 전용임을 코드 수준에서 강제.
5. **로그 마스킹 유지:** `[credential]=[redacted]` 규칙과 토큰 비로그 규칙은 모든 모드에서 유효(기존 테스트 유지).
6. **루프백 이중 바인딩(§D-A4):** tailscale 모드 기동 시 Tailscale 주소와 127.0.0.1 모두에서 bearer 없이 `GET /v1/runs` → 200; `LOOP_GATEWAY_LOOPBACK=off` 또는 bearer-fallback 모드에서는 루프백 리스너 미시작; 루프백 밖 host(예: LAN IP)를 `LOOP_GATEWAY_LOOPBACK_HOST`로 지정하면 `LoopbackBindRejectedError`로 시작 거부.

## 4. 미해결 위험

- tailscaled whois(`identity: "whois"`)는 플랫폼별 제공 방식이 달라(Linux 소켓 vs macOS 앱) 옵션 구현 시 플랫폼 분기 필요 — 기본 `off`이므로 결정 자체는 블록되지 않음.
- Tailscale 미설치 환경(순수 LAN)에서는 폴백 모드가 유일한 경로이며, 이때만 Keychain 저장이 개입한다 — 폴백은 편의가 아닌 예외임을 문서·UI에 명시해야 한다.
- `gateway/ → gateway-client/` 리네임은 모바일 import 다수를 건드리므로 계층 강제 테스트와 같은 태스크에 묶어 한 번에 검증하는 것을 권장.
- identity 확인·페어링의 "필요 시" 판단 기준(멀티 유저 tailnet 발생 등)은 아직 정량 기준 없음 — 발생 시 별도 결정 문서로 다룬다.
