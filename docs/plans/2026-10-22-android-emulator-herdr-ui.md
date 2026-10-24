# 계획 — 안드로이드 에뮬레이터에서 loop-mobile 테스트·유지 + herdr 내용 표시 + 내부 접근 보강

- **일자:** 2026-10-22
- **요청:** 안드로이드 시뮬레이터 설치해 앱 테스트·유지 / herdr 안의 내용을 codex·claude·agy로 UI에서 잘 보여주기 / 선택부터 UI 부드러움까지 유지 / tailscale 외 funnel(내부 접근) 지원 검토. `/sdd` 전체 흐름.
- **기준 리비전:** aa5b8cc (main, clean)

## 목표와 범위

- 이 머신(WSL2, `/dev/kvm` 있음, sudo 없음)에 **사용자 로컬** 안드로이드 도구(JDK·SDK·에뮬레이터)를 설치해 loop-mobile을 안드로이드에서 빌드·실행·검증한다.
- 게이트웨이+실 herdr와 연결해 claude·codex·agy 세션 내용이 UI(구조화 대화 턴)에서 표현되는지 라이브 관찰하고, 발견된 결함을 수정한다.
- 선택 상호작용(행·시트·탭·복사)과 매끄러움(전환·스크롤·키보드·백 버튼)을 에뮬레이터에서 검증·보완한다.
- `tailscale serve` HTTPS(테일넷 내부) 접근 경로를 설정하고, 앱 연결 계약이 https base URL을 수용하도록 확장한다. **공개 인터넷 funnel은 v1 범위 밖**(decision 2026-xx-remote-app-architecture §D2 유지).
- 제외: APNs/푸시, iOS 회귀 수정(기존 iOS 증거 유지), 커밋(사용자 요청 시 별도).

### 확인한 사실 (조사 근거)

- 앱은 iOS 전용 프로젝트(`ios/`만 존재, `android/` 없음). RN 0.88, new-arch 라이브러리(nitro-modules, vision-camera v5) 사용 — 안드로이드 빌드에 NDK 필요.
- 앱에 안드로이드 폴백 존재: `src/ui/Icon.tsx`는 네이티브 LoopIcon 미탑재 플랫폼에서 글리프 폴백, `useKeyboardVisible`·`AgentScreen` 키보드 이벤트 분기 존재. `BackHandler` 사용처 없음(확인 필요).
- 연결 계약: baseUrl = `http://<host>:<port>` 고정 (`src/auth/connection.ts`, decision 2026-xx-remote-app-architecture — public bind는 v1 범위 밖).
- 게이트웨이: tailscale 바인딩 fail-closed + loopback 보청기 존재 (`packages/gateway/src/main.ts`). herdr 소켓 현재 활성(`~/.config/herdr/herdr.sock`), claude 3 세션 working.
- herdr 내용 복사 표면: `packages/gateway/src/agent-sessions.ts` — CONVERSATION_KINDS = claude(projects JSONL)·codex(rollout JSONL)·agy(transcript.jsonl). 앱은 `src/herdr/conversation.ts`에서 turns/summary 게이팅, 비가용 시 ANSI 트랜스크립트 강등.
- **미해결:** agy 원본 데이터(~/.gemini/antigravity-cli)가 현재 이 머신에 없고 `agy` 바이너리도 PATH에 없음 → 게이트웨이 integration.list로 herdr 관점 가용성 확인 후, 없으면 agy는 실시간 관찰 BLOCKED(계약 테스트 증거로 대체)로 기록.
- 환경: KVM 활성, 952GB 디스크, 58GB RAM, 32코어. sudo 불가 → JDK·SDK 모두 `$HOME` 로컬 설치. 에뮬레이터는 `-no-window -gpu swiftshader_indirect` 헤드리스, `adb` 스크린캡·입력 주입으로 관찰.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | JDK+Android SDK+AVD가 설치되고 에뮬레이터가 KVM 가속으로 부팅한다 (`adb devices` device 상태) | T-1 | V-1 |
| AC-2 | loop-mobile release APK가 에뮬레이터에 설치·실행되어 UI를 렌더한다 | T-2 | V-2 |
| AC-3 | 에뮬레이터 앱이 실게이트웨이+실herdr에 연결해 claude·codex 세션의 구조화 대화(또는 강등 트랜스크립트)를 표시한다; agy는 integration 가용할 때만 실시간, 아니면 계약 테스트 증거 + BLOCKED 기록 | T-3, T-4 | V-3, V-4 |
| AC-4 | 목록 행 선택·새 에이전트 시트(종류×워크스페이스)·탭 전환·복사·백 네비게이션이 에뮬레이터에서 동작하고 프레임 통계에서 이상 jank가 없다; 발견 결함은 수정 후 재검증 | T-5 | V-5 |
| AC-5 | `tailscale serve` HTTPS 내부 경로가 설정되고 앱 연결 계약이 https base URL을 수용한다(단위 테스트 녹색, 가능하면 라이브 접속) | T-6 | V-6 |

## 설계

- **android/ 부트스트랩:** RN 0.88 템플릿의 android 프로젝트를 임시 디렉터리에 생성해 `apps/loop-mobile/android`로 이식. 적응점: applicationId `com.loopmobile`(안드로이드 관례 — iOS bundle id `org.reactjs.native.example.LoopMobile`과 다르게 둠; 딥링크는 스킴 `loop://` 공유라 id 불일치 무해), 앱 이름 LoopMobile, `loop://` 딥링크 intent-filter(Info.plist 대응), 디버그/릴리스 서명은 템플릿 기본. 템플릿 외 그래들 커스텀 금지(autolink 의존).
- **빌드 형태:** `assembleRelease`(JS 번들 APK 내장, Metro 무요 실행). `scripts/build-android.sh`로 에뮬레이터 부팅 확인→빌드→설치→실행을 iOS 스크립트 대응으로 제공.
- **https 계약 확장(어댑터 층 한정):** `createConnectionConfig(host|url, port?)` — `http(s)://` 완전 URL 입력을 허용하고 기존 host+port 형태는 그대로 유지(기본 http). `parseBaseUrl`은 https 허용. 페어 URL은 `tls=1` 파라미터 추가(시크릿 파라미터 아님). decision 문서에 amendment 기록. gateway 인증은 무변경(serve 프록시 뒤 bearer 없음 유지 — serve는 같은 tailnet 멤버십을 전제).
- **백 네비게이션:** router(`src/app/router.ts`)가 스택 소유 — Android 하드웨어 백을 router.pop에 연결(Shell에서 BackHandler 구독). 스택 비었으면 기본 동작 위임.
- **오류·복구 경계:** 에뮬레이터 네트워크(NAT)로 tailscale IP가 닿지 않으면 `adb reverse tcp:18477` 폴백(앱은 127.0.0.1:18477 연결). 에뮬레이터 키체인은 Android Keystore 사용(라이브러리 지원).
- **UI 디자인 원천:** 기존 토큰/디자인 시스템(`src/design/tokens.ts`, docs/design/design-system.md) 무변경 — 이번 작업은 이식·검증이 원칙, 신규 화면 없음.

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 | 상태 |
|---|---|---|---|---|---|
| T-1 | JDK·SDK·AVD 설치, 에뮬레이터 헤드리스 부팅 (AC-1) | repo 외: `~/tools/jdk17`, `~/android-sdk`, `~/.android/avd` | 없음 | V-1 | done (TCG) |
| T-2 | android/ 프로젝트 부트스트랩+빌드 스크립트 (AC-2) | `apps/loop-mobile/android/**`(신규), `apps/loop-mobile/scripts/build-android.sh`(신규) | T-1 | V-2 | done |
| T-3 | 게이트웨이 기동·에뮬레이터 연결 경로 확보 (AC-3) | repo 무변경(실행 환경); 필요 시 문서 | T-1 | V-3 | done |
| T-4 | 종류별 세션 내용 표시 라이브 검증 (AC-3) | repo 무변경(관찰); 결함 시 수정 | T-2, T-3 | V-4 | done |
| T-5 | 선택·부드러움 검증과 결함 수정(백 네비게이션 등) (AC-4) | `apps/loop-mobile/src/app/Shell.tsx`, `src/screens/HerdScreen.tsx` | T-2 | V-5 | done |
| T-6 | https 계약 확장 + tailscale serve 설정 (AC-5) | `src/auth/connection.ts`, `src/auth/credentialStore.ts`, `src/screens/ConnectScreen.tsx`, 테스트, decision 문서 | T-4 | V-6 | done (serve 설정 BLOCKED) |

## 검증 계획과 결과

| ID | 방법 | cwd·환경 | 기대 결과 | 실제 결과 | 판정 |
|---|---|---|---|---|---|
| V-1 | `adb devices`, `emulator -avd` 부팅 후 sys.boot_completed | WSL2, 헤드리스 | emulator-5554 device, boot_completed=1 | emulator-5554 온라인, boot=1, API 36. 단 /dev/kvm 그룹 미권한으로 **TCG 소프트웨어 에뮬레이션** (sudo usermod -aG kvm 필요) | PASS (가속 조건부) |
| V-2 | `./gradlew assembleRelease` + `adb install` + `am start` + `screencap` | apps/loop-mobile/android | BUILD SUCCESSFUL, 앱 UI 스크린샷 | BUILD SUCCESSFUL in 7m27s (31.6MB APK), 설치·실행·렌더 확인 (showcase-captures/android/v2-*) | PASS |
| V-3 | `curl /v1/herdr/state` + integration.list | WSL2 | herdr available, 종류 목록 | herdr 0.9.5 protocol 22, claude/codex available, agy(antigravity_cli) not_installed | PASS |
| V-4 | 앱에서 연결→세션 상세→screencap | 에뮬레이터 | 종류별 대화 렌더 | claude: 구조화 마크다운 대화 + 실시간 상태 pill 라이브 렌더 ✓; codex: 시작·라이브 목록·ANSI 트랜스크립트(브라유 아트 로고) ✓, 구조화 턴 프롬프트는 **BLOCKED**(이 머신에 codex 인증 없음 — ~/.codex/auth.json 부재); **agy: 사용자가 설치 완료(2026-10-22 2차 세션) — 라이브 검증 PASS**: 승인 대기 배너(↵ 글리프 수정 확인) + 구조화 턴(유저 버블·run_command/read_file 카드) 렌더 (v9-agy.png) | PASS (codex 프롬프트만 BLOCKED 기록) |
| V-5 | adb input 조작 + gfxinfo + 스크린샷 | 에뮬레이터 | 선택 동작, 백 pop, jank 관찰 | 행 선택→push ✓, 시트 칩 선택(종류×워크스페이스) ✓, 탭 전환·상태 보존 ✓, 시스템 백 pop ✓ (BackHandler 신규), 새 에이전트 시작 E2E ✓. gfxinfo p50 113ms는 TCG 소프트웨어 렌더 한계로 절대 판정 불가 — KVM 권한 후 재측정 권장 | PASS (성능 수치 환경 한계) |
| V-6 | 앱/gateway 테스트 + https 라이브 + tailscale serve | WSL2 | 테스트 녹색, serve 200 | https 연결 계약 단위 테스트 녹색(앱 211 중), curl https 라이브 및 `tailscale serve`는 **BLOCKED**(sudo/operator 설정 필요) — 앱 측 구현·테스트·decision 개정 완료 | PASS (serve 설정 BLOCKED 기록) |

## 실행 결과 요약 (2026-10-22)

- T-1~T-6 완료. 라이브 발견 결함 3건 수정: (F-1) Android Fabric에서 Herd RefreshControl이 전체 서브트리 마운트 실패 → 플랫폼 게이트(HerdScreen); (F-2/F-3) 게이트웨이 agent.start가 herdr 0.9.5의 name 필수와 fresh-pane agent_pane_busy 창을 무시해 409 → 이름 파생 + busy 재시도 + 소켓 예산 오버라이드 (herdr-pane-source.ts, server.ts); (F-4) claude 세션이 시작 후 cd하면 대화 어댑터가 원본 세션 파일을 못 찾음(404→트랜스크립트 강등) → 상태에 foregroundCwd 매핑 + 대화 경로 폴백 해소, w4 세션의 구조화 턴 라이브 확인.
- 세그먼트 전환(대화=턴 카드 ↔ 터미널=ANSI 미러)도 뚜렷한 내용 차이로 검증 (showcase-captures/android/v6-*).
- **2차 세션(10-22 오후) 추가 검증**: KVM 가속 전환(그룹 등록 완료) — 성능 p50 16ms·jank 2.95%(TCG 대비 7배), 전 흐름 무결. 글리프 tofu 수정(⏻→⊙, ⏎→↵) 라이브 확인. **딥링크 페어링**: `loop pair`(게이트웨이 자동기동+MagicDNS QR) 라이브 확인, Android 콜드 스타트 `loop://connect` 딥링크 자동 페어링 PASS(v10-deeplink-paired.png). 기록된 제한: 앱 포그라운드 재스캔(onNewIntent 워밍 경로) 미동작 — P3 후속. QR 스캐너(vision-camera)는 에뮬레이터 가상 카메라에서 FATAL — 실기기 확인 필요.
- **재시작 시나리오 검증(10-22 저녁)**: 게이트웨이 kill→기동 — 앱 무조작 자동 복구(스트림 연결됨 복귀, 대기 중 마지막 상태 유지). 앱 force-stop→재시작 — 키체인 자동 복구. `loop pair` 재사용 — 동일 QR 재출력. 주의: 게이트웨이 다운 상태에서 `loop pair` 자동 스폰은 LOOP_GATEWAY_PORT 미고정 시 임시 포트(34291)로 뜸 — 상용에선 포트 고정 권장.
- **부팅 자동 기동 구성(10-22 밤, 사용자 지시로 진행)**: 이 머신 — systemd 사용자 유닛 2개 설치 완료(loop-gateway: active+enabled, herdr: enabled, linger=yes). 앱은 systemd 게이트웨이로도 자동 복구 확인. 이 머신 재부팅 후 수동 작업 불요.
- **`loop gateway install-service` 신설(일반화)**: planGatewaySpawn 재사용으로 tailscale 바인딩 IP(fail-closed)·포트(기존 기록 고정)·DB 경로를 해석해 systemd 사용자 유닛을 작성·enable·기동(살아있으면 enable-only 멱등)·linger 시도. 주의 수정: 유닛의 LOOP_GATEWAY_HOST는 반드시 프로브한 CGNAT IP여야 하고 런타임 기록의 host(MagicDNS 라벨)를 쓰면 다음 부팅에 바인드 거절 크래시 루프 — 테스트로 핀. 라이브 실행으로 유닛 갱신 확인(IP 고정·18477). 테스트 25(cli gateway)+전체 cli 98 통과, typecheck·lint 녹색.
- **스크롤 바운스 결함 수정(사용자 라이브 보고)**: 라이브 세션에서 매 업데이트마다 `scrollToEnd({animated:true})`가 재시작되어 꼬리 따기가 위아래로 왕복하고, 애니메이션 도중 onScroll이 off-bottom으로 판정해 팔로우가 풀리는(멈추는) 결함 → 프로그램 꼬리따기를 즉시 고정(animated:false)으로 변경, 터치 스크롤만 detach 경로(AgentScreen·TerminalScreen). 수정 후 라이브 미러에서 꼬리 고정·무왕복 확인.
- 표시 설정(글자 크기) 영속화·APNs 등 M5 후속은 기존 범위 밖 유지.
- 남은 사용자 조치: ① `sudo usermod -aG kvm $USER`(KVM 가속), ② `sudo tailscale set --operator=$USER` 후 `tailscale serve --bg 18477`(내부 HTTPS 경로). 테스트로 생성된 herdr 워크스페이스(w8~wP, 라벨 StoryTui)는 사용자 확인 후 수동 정리 권장(파괴적 정리는 승인 보류).

## 평가와 인계

- G3 코드 리뷰는 독립 서브에이전트(reviewer 지침)에 diff·요청·검증 기록을 전달해 판정. G4는 V-4/V-5 관찰 기록으로 self-review(관찰 한계 명시), G5 completion은 독립 위임.
- 릴리스 기준: AC-1~2 PASS(필수), AC-3 PASS(agy만 BLOCKED 가능, 사유 기록), AC-4 PASS(결함 수정 후), AC-5 PASS(serve 설정은 환경 의존 — 불가 시 BLOCKED 사유 기록).
- 커밋은 사용자 요청 시에만.
