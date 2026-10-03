# 앱 자격증명 영속화 정책 — OS 보안 저장소 한정 예외 (AGENTS 규칙 명시적 개정)

- **태스크:** `auth-persistence-decision` (decision, attempt 0)
- **상태:** 결정됨
- **작성일:** 2026-xx
- **선행 규칙과의 관계(개정):**
  - `AGENTS.md` "Do not persist or log credentials" **문언을 개정**한다 — 자격증명의 **OS 보안 저장소(iOS Keychain / Android Keystore) 한정 저장**을 예외로 허용한다. 일반 파일·AsyncStorage·Tauri store·DB·로그 저장 금지, 로그 마스킹(`[credential]=[redacted]`), `loop-core`에 자격증명 개념 금지는 그대로 유효하다.
  - [`2026-xx-remote-app-architecture.md`](2026-xx-remote-app-architecture.md) **§D2 일부 문언을 개정**한다 — "앱도 bearer를 세션 process memory에만 두고 AsyncStorage, Tauri store, 파일, DB 또는 로그에 저장하지 않는다"에서 **process memory 전용 조건을 해제**하고, **OS 보안 저장소 단일 예외**로 대체한다. gateway 측(token/signing secret은 환경변수 또는 process memory에서만 읽음, event/SQLite/crash report/access log 미기록) 규칙은 무변경이며 이 문서가 다시 판단하지 않는다.
- **입력:** `AGENTS.md`, `apps/loop-mobile/src/screens/ConnectScreen.tsx`(주석 "relaunch 후 재입력", "memory only"), `apps/loop-desktop/src/screens/connect.ts`(동일 메모리 전용 주석), 위 두 결정 문서
- **쓰기 범위:** 이 결정 문서만

## 1. 배경

현재 모바일과 데스크톱 Connect 화면은 자격증명(gateway `host:port` + bearer token)을 process memory에만 두고, 앱 재실행마다 `[credential]=[redacted]` 재입력을 요구한다(`ConnectScreen.tsx` 주석에 명시). 운영자 목표는 "앱 로그인 한 번, 이후 자동 연결"이며, 이를 위해서는 자격증명을 디바이스 어딘가에 저장해야 한다. 보안 규칙("persist 금지")은 자격증명이 **일반 저장소와 로그로 새는 것**을 막기 위한 것이지, OS 수준 하드웨어 백업 암호화 저장소까지 금지하려는 것이 아니므로, 예외를 명시적 개정으로 기록한다 — 암묵적 예외는 만들지 않는다(Loop의 결정 기록 원칙).

## 2. 결정 (한 단락)

앱 자격증명(bearer token, 게이트웨이 `host:port`)은 **iOS Keychain / Android Keystore에만 영속 저장**한다(React Native 앱은 `react-native-keychain` 경유). 저장은 디바이스 전용이다 — iCloud/백업 동기화·클립보드·일반 파일·AsyncStorage·Tauri store·SQLite·로그·git·스크린샷으로의 저장·유출은 계속 금지이며, 로그와 UI에는 토큰이 절대 노출되지 않고 기존 `[credential]=[redacted]` 마스킹 규칙이 유지된다. 첫 Connect 성공 시 저장하고, 다음 실행 시 저장된 토큰으로 자동 연결을 시도하며(실패 시 수동 Connect 화면으로 폴백), 사용자는 로그아웃으로 저장된 자격증명을 **즉시 삭제**할 수 있다(삭제 + 연결 해제, 다음 실행은 수동 화면). 생체인증 게이트(biometric unlock 후 토큰 읽기)는 **옵션**으로 구현한다 — 기본은 on이 아닌 설정 항목이며, 게이트 실패 시 자동 연결을 하지 않고 수동 화면으로 폴백한다(토큰을 대화상자로 노출하지 않는다).

### D1. 저장 매체 — OS 보안 저장소 단일 예외

- **채택:** `react-native-keychain`(iOS Keychain, Android Keystore)에 `host`, `port`, `bearer`를 하나의 service 항목으로 저장. Keychain 접근성은 기기 잠금 시 접근 차급(예: `WHEN_UNLOCKED_THIS_DEVICE_ONLY`)로 **백업/이전 비포함**을 강제한다.
- **금지 유지(개정 후에도 유효):** 일반 파일, AsyncStorage/MMKV, Tauri store/localStorage, SQLite, 콘솔/파일/crash report/access log, git 커밋·테스트 픽스처의 실토큰, 스크린샷·화면 녹화에 토큰 노출, `loop-core`로의 자격증명 개념 반입(이 정책은 adapter/UI 계층에만 적용되고 의존 방향은 불변).
- **기각 — AsyncStorage + 암호화 라이브러리:** 키 관리가 순환(암호화 키도 같은 저장소에 둬야 함)이고 OS 보안 저장소 대비 우월점이 없음.
- **기각 — 저장 없이 런타임 주입 유지(deep link/clipboard):** 매 실행 수동 주입은 운영자 목표("로그인 한 번") 불충족이며, clipboard 경유는 유출 표면을 오히려 늘림.

### D2. 연결 수명주기

1. **첫 로그인:** 수동 Connect 성공 → Keychain 저장 → 연결 유지.
2. **재실행:** 기동 시 저장 항목 조회 → 있으면 저장된 토큰으로 자동 연결 시도 → 성공 시 대화 화면 진입.
3. **자동 연결 실패:** (토큰 만료·게이트웨이 부재·401) 저장 항목을 **삭제하지 않고** 수동 Connect 화면으로 폴백(호스트/포트는 저장값 프리필, 토큰 필드는 빈 값 + 미노출). 사용자가 재로그인하면 저장 항목을 덮어쓴다. 폴백 사유는 UI에 표기하되 토큰 값은 절대 포함하지 않는다.
4. **로그아웃:** 연결 화면/설정의 로그아웃 = Keychain 항목 즉시 삭제 + 활성 연결 해제 → 다음 실행은 수동 화면. 서버 측 토큰 폐기는 v1 범위 밖(ADR §D2: 발급/refresh 미범위)이므로, 로그아웃의 보증은 "이 디바이스에서의 삭제"로 한정·정직하게 문서화한다.
5. **생체인증 게이트(옵션):** 설정 on 시 재실행 자동 연결 전 생체인증 요구. 실패/미설정 시 자동 연결 생략 → 수동 화면. 게이트는 토큰 **읽기**만 보호하며 토큰을 화면에 렌더링하지 않는다.

### D3. 데스크톱(Tauri) — 동일 정책, OS keyring으로 적용

정책은 데스크톱에도 **동일하게 적용**한다: 저장 매체는 Tauri process가 아닌 **OS keyring**(macOS Keychain, Windows Credential Manager, Linux Secret Service — Tauri Rust shell에서 `keyring` crate 경유)이며, TS 프런트엔드는 Rust command로만 읽기/쓰기/삭제를 요청하고 Tauri store·localStorage·파일에는 쓰지 않는다. 데스크톱 Connect 화면(`apps/loop-desktop/src/screens/connect.ts`)이 현재 메모리 전용이므로, **구현은 후속 태스크로 분리**한다(이 문서는 정책만 확정; 구현 태스크: desktop keyring 저장 + 자동 연결 + 로그아웃). 모바일과 데스크톱의 수명주기(D2)는 동일 계약을 따른다.

### D4. 로그·UI 노출 금지 유지

기존 규칙 그대로: 토큰은 로그·UI·오류 메시지에 렌더링되지 않는다. 연결 진단 출력에는 `[credential]=[redacted]` 마스킹을 유지하고, Keychain 읽기/쓰기/삭제 동작 자체는 로그에 이벤트명만 남길 수 있다(값 없음). `secureTextEntry` 입력과 토큰 미포함 폴백 사유 표기(D2-3)를 유지한다.

## 3. 기계 검증 가능한 수용 기준

모두 유료 모델 호출 없이 시뮬레이터/유닛으로 검증한다(실기기 불필요):

1. **재실행 자동 연결:** 시뮬레이터에서 로그인 1회 → 앱 종료 → 재실행 → 수동 입력 없이 대화 화면 진입. 증거: 스크린샷(v6) 2장(로그인 직후, 재실행 직후).
2. **로그아웃 후 수동 복귀:** 로그아웃 → 앱 재실행 → 수동 Connect 화면(토큰 필드 빈 값) 표시. 증거: 스크린샷(v6).
3. **저장소 삭제 증명:** 로그아웃 직후 keychain 조회(테스트용 read)가 항목 없음을 반환하는 유닛 테스트. 모바일/데스크톱 각각.
4. **로그 마스킹:** 앱 로그 전체에 원문 토큰 미포함, `[credential]=[redacted]` 유지 — 로그 캡처에 대한 회귀 테스트 또는 수동 검증 절차 문서화.
5. **폴백 무삭제:** 자동 연결 실패(잘못된 포트 등) 시 저장 항목이 유지됨을 확인하는 유닛 테스트.

## 4. 검토한 대안

| 대안 | 장점 | 기각 이유 |
| --- | --- | --- |
| 상태 유지(메모리 전용, 재입력) | 규칙 개정 불필요, 최소 표면 | 매 실행 재입력 — 운영자 목표 불충족 |
| AsyncStorage + 암호화 | 구현 단순 | 키 관리 순환, OS 하드웨어 백업 없음, 실질 저하 |
| 서버 세션/refresh token 도입 | 만료 자동 갱신 | v1 범위 밖(ADR §D2가 발급/refresh를 명시적으로 제외), gateway 변경 필요 |
| **OS 보안 저장소(본 결정)** | 하드웨어 백업 암호화, 디바이스 전용 차급, 사용자 삭제 가능 | (채택) 유일한 비용은 네이티브 브리지 의존 |

## 5. 미해결 위험

- `react-native-keychain`의 Android Keystore 백엔드는 기기/OS 버전에 따라 차등(StrongBox 미탑재 등) — 시뮬레이터 검증이 실기기 동작을 보증하지 않음.
- Linux 데스크톱의 Secret Service는 데스크톱 환경 미구동 시 실패 — 데스크톱 후속 태스크에서 폴백(저장 없음 → 수동 화면)으로 처리해야 함.
- 서버 측 토큰 폐기 미지원(v1) — 디바이스 분실 시 게이트웨이 secret 로테이션이 유일한 만회 수단.
