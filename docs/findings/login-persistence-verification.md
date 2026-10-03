# 검증: 1회 로그인 유지 (login-persistence-verification)

- **태스크:** `login-persistence-verification` (verification, attempt 0)
- **결과: PASS** — 수용 기준 6/6 통과
- **검증자:** 독립 verification 워커. 의존 태스크(`keychain-login-implementation`, `login-persistence-showcase`)의 구현·캡처를 그대로 수용하지 않고 코드·테스트·정책 문서를 직접 재검증.
- **유료 모델 호출:** 0회. 실기기: 없음.

## 수용 기준별 결과

### 1. 재실행 시 자동 연결 — PASS

- 구현: `apps/loop-mobile/src/auth/restore.ts` `restoreSession()` — 기동 시 키체인 조회 → 저장 토큰으로 probe → 성공 시 `restored`, 실패 시 수동 화면 폴백(**저장 항목 유지**, 구조적으로 `clear` 호출 불가).
- 배선: `apps/loop-mobile/src/App.tsx` — restore는 `connectDriven` 가드로 1회만 실행; 수동 로그인·showcase auto-connect·restore가 모두 `adoptConfig` 단일 경로로 수렴하며 **probe 성공 후에만** `store.save(config)`(L69).
- 증거: `docs/research/simulator-showcase/v6/02-relaunch-autoconnect-chats.png` — `simctl terminate` 후 **무 env 재실행**에서 Connect 화면 우회, Chats 직행(채팅 메타 타임스탬프 +28s = 새 세션 실제 재연결). 캡처는 `login-persistence-showcase`가 10:05–10:07 직접 재실행·재캡처한 1차 증거.

### 2. 로그아웃 시 키체인 삭제 + 재실행 수동 복귀 — PASS

- 구현: `App.tsx` `logout()` (L117–120) — `store.clear()` 즉시 삭제 + 연결 해제. `restoreSession`·`adoptConfig`는 실패 경로에서 절대 삭제하지 않음(폴백 무삭제).
- 유닛: `apps/loop-mobile/test/credential-store.test.ts` + `restore.test.ts` — **15 pass / 0 fail**(삭제 후 조회 null, 폴백 시 항목 유지 포함). 전체 모바일 테스트 91 pass / 0 fail.
- 증거: `v6/03-after-logout-connect-screen.png`(로그아웃 직후 수동 화면, 토큰 빈 플레이스홀더), `v6/04-relaunch-after-logout-manual.png`(무 env 재실행 → 기본 host/port로 수동 Connect = 복원할 항목 없음).

### 3. 토큰 로그/UI/스크린샷 비노출 — PASS

- 마스킹 회귀 없음: `packages/orchestrator/src/redact.ts`의 `[credential]=[redacted]` 치환 정책 유지 확인.
- 런치 로그: `v6/evidence.md` 실측 — `showcase-launch: keys=[autoConnect,bearer,host,port]` 등 **키 이름만**, 값 없음.
- 화면: v6 스크린샷 4장 모두 토큰 재질 미렌더; ConnectScreen 토큰 필드는 `secureTextEntry` + 상시 빈 값. 폴백 사유(`describeConnectFailure`)는 status/code만 포함.
- 문서 스캔: `docs/research/` 전체에서 `bearer[= :]+[A-Za-z0-9_-]{20,}` 패턴(단, 문서화된 상수 `demo-token` 제외) **0건**.

### 4. 일반 파일/AsyncStorage 영속 부재 — PASS

- 코드 스캔(`apps/loop-mobile/src`, `index.js`, AppDelegate, android): `AsyncStorage`/`localStorage`/`setString`/`writeFile`/`UserDefaults` 사용 **0건** — `connection.ts`·`credentialStore.ts`의 매칭 2건은 금지 목록을 서술하는 정책 주석뿐.
- 유일한 영속 경로: `apps/loop-mobile/src/auth/keychain.ts` — `react-native-keychain` 단일 service 항목(`net.loop.gateway.credentials`), `ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY`(백업/마이그레이션 비포함).
- 정책 근거: `docs/decisions/2026-xx-app-credential-persistence.md` — AGENTS.md "Do not persist or log credentials"의 **명시적 개정**(OS 보안 저장소 한정 예외; 파일/AsyncStorage/로그 금지 유지). 개정은 암묵적 예외 없이 ADR로 기록됨.

### 5. 전체 리포 체크 그린 — PASS

- `bun run check` **exit 0**: `codegen:check` + `typecheck` + `test:architecture` + `cargo test --workspace`(모든 suite 0 failed) + bun 테스트 **508 pass / 0 fail / 62 files**.

### 6. 경계 불변 — PASS

- `tests/architecture-boundaries.test.ts` 통과(check 내).
- `crates/loop-core/src`에서 `credential|bearer|keychain|password` 매칭 **0건** — keychain 포트는 adapter 계층(`apps/loop-mobile/src/auth/`)에만 존재하며 의존 방향 불변. keychain 바인딩은 `GatewayKeychainPort` 인터페이스 뒤에 숨어 유닛은 인메모리 목으로 결정적.

## 실행한 체크

| 체크 | 결과 |
| --- | --- |
| `bun run check` | exit 0 (508 bun pass, cargo workspace 0 failed) |
| `bun test apps/loop-mobile/test` | 91 pass / 0 fail |
| credential-store + restore 유닛 | 15 pass / 0 fail |
| 코드 스캔: AsyncStorage/파일 영속 | 부재 (주석 2건은 정책 서술) |
| 문서 스캔: 실토큰 유사 물질 | 0건 (demo-token 상수만) |
| loop-core 자격증명 개념 스캔 | 0건 |
| v6 스크린샷 4장 육안 + evidence.md 대조 | 일치 |

## 변경 파일

- **신규:** `docs/findings/login-persistence-verification.md` (이 문서, 선언된 쓰기 범위 유일 파일)
- 구현·스크린샷 변경 없음(의존 태스크 산출물을 검증만 수행).

## 미해결 위험 (ADR §5 계승)

- 시뮬레이터 검증은 실기기 Keychain/Keystore 동작(Android StrongBox 등)을 보증하지 않음.
- 데스크톱(Tauri)은 ADR D3로 정책만 확정, keyring 구현은 후속 태스크(현재 `apps/loop-desktop` 메모리 전용 — 정책과 일치, 문서화됨).
- 서버 측 토큰 폐기는 v1 범위 밖 — 로그아웃의 보증은 "이 디바이스에서의 삭제"로 한정.
