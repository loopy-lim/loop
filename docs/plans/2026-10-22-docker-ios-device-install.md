# 계획 — Docker 기반 macOS/Xcode로 loop-mobile을 iPhone에 설치

- **일자:** 2026-10-22
- **요청:** "Docker를 이용해서 Xcode를 가지고 iPhone에 설치할 수 있도록 했다고 하는데 그거 연구하고 여기에 적용할 수 있게 해줘." `/sdd` 전체 흐름.
- **기준 리비전:** aa5b8cc (main, 사용자 WIP 다수 — 보존, 본 작업은 신규 파일만 추가)

## 목표와 범위

- "Docker + Xcode로 iPhone 설치"로 불리는 접근이 실제로 무엇인지 조사하고, 이 머신(WSL2)에서 loop-mobile(RN 0.88, `ios/` 네이티브 프로젝트)을 **Mac 없이** 빌드해 iPhone 15에 설치하는 적용 가능한 형태(스크립트·문서)를 저장소에 만든다.
- 조사 대상: dockur/macos 계열(QEMU/KVM macOS VM in Docker), xtool(Linux 네이티브 SwiftPM 빌드), 클라우드 Mac CI(EAS/Codemagic/GH Actions). 선택 근거를 출처와 함께 문서화.
- 제외(명시): 앱 소스·게이트웨이 무변경, 런타임 게이트웨이 연결 검증(기존 경로 유지), 커밋(사용자 요청 시 별도), macOS 라이선스 회피책 제공(한계는 문서로 명시).

### 확인한 사실 (조사 근거)

- **"Docker + Xcode"의 원판:** Xcode는 macOS 전용이므로 Docker 리눅스 컨테이너 안에 직접 실행 불가. 가능한 형태는 (a) Docker가 orchestrate하는 QEMU/KVM **macOS 가상머신**(dockur/macos, dev.to 2024-11 가이드가 이 방식), (b) Linux 네이티브 도구 체인(xtool — SwiftPM 전용), (c) 클라우드 Mac. 출처: [dockur/macos](https://github.com/dockur/macos), [dev.to 가이드](https://dev.to/cabraljv/how-to-build-and-test-ios-applications-on-windowslinux-using-docker-4jfh), [xtool](https://github.com/xtool-org/xtool), [Swift Forums 발표](https://forums.swift.org/t/xtool-cross-platform-xcode-replacement-build-ios-apps-on-linux-and-more/79803).
- **loop-mobile은 RN 0.88** + 네이티브 pod 다수(vision-camera 5, nitro-modules, keychain) → CocoaPods/Xcode 빌드 계열 필수. **xtool은 SwiftPM 프로젝트만 빌드 가능 → RN 부적합**(조사로 확정, README 워크플로 확인).
- **이 머신:** WSL2 3.0.3.0, 32코어/58GB RAM/디스크 921GB 여유, `/dev/kvm` 존재 + AVX2 + `/dev/net/tun` 존재 → dockur/macos 선행 조건 충족. kvm 그룹은 `/etc/group`에 등록됐으나 현재 세션은 그룹 추가 이전에 시작(`sg kvm`로 회피 가능). **Docker 미설치**, usbipd-win 미설치, sudo 비대화형 불가(사용자 설치 필요 — 오늘자 안드로이드 포트 계획과 동일 제약).
- **기존 iOS 자산:** `apps/loop-mobile/ios/`는 git 커밋됨(RN 0.88 재생성). `scripts/device-build-wizard.sh`는 **실제 Mac의 xcodebuild/devicectl** 전제, 팀 이력 기록(VMG62K6D6T SEVEN PICTURES 프로파일 존재, 개인팀 S5W794Z5NN, iPhone 15 UDID `00008120-000A0DE02D1A01E`). `docs/research/app-device-install.md` §6가 수동 설치 절차 문서화 — 과거 설치는 별도 Mac(게이트웨이 호스트 100.80.133.120)에서 수행됨.
- **dockur/macos 사양(README 인증):** 이미지 `dockurr/macos`, `--device=/dev/kvm` `/dev/net/tun` + `cap_add: NET_ADMIN` 필요, 포트 8006(웹 뷰어)/5900(VNC), env `VERSION`(기본 15)/`RAM_SIZE`/`CPU_CORES`/`DISK_SIZE`/`ARGUMENTS`(QEMU 추가 인자 — USB 패스스루 포함). macOS 설치·Xcode 다운로드는 Apple ID 필요.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 5가지 접근(Docker macOS VM 2종, xtool, 클라우드 CI, 기존 Mac 유지)의 비교·판단·출처가 문서화되고, loop-mobile에 대한 적용 설계가 선택된다 | T-1 | V-1 |
| AC-2 | `apps/loop-mobile/docker-ios/`(compose, VM 프로비전/빌드 스크립트)와 호스트 위자드 `scripts/build-ios-docker.sh`가 저장소 스크립트 관례(셔 배너·stage UX, 기존 위자드 라이브러리 스타일)에 맞게 존재하고 앱·게이트웨이 소스는 무변경이다 | T-2, T-3 | V-2 |
| AC-3 | 호스트 위자드 프리플라이트가 이 머신에서 **라이브로 실행**되어 Docker 부재·kvm 세션 그룹·디스크를 검사하고, 사용자가 실행할 정확한 설치 명령을 출력하며 BLOCKED로 명확히 종료한다 | T-3 | V-3 |
| AC-4 | VM 부팅→Xcode→서명 빌드→iPhone 설치의 전체 실행 절차가 단계별 명령으로 문서화된다. 라이브 E2E는 Docker·usbipd·Apple ID 세션이 사용자 설치를 필요로 하므로 **BLOCKED로 명시**하고, 정적 검증(`bash -n`)과 프리플라이트로 부분 충족을 남긴다 | T-4 | V-4 |

## 설계

- **선택: dockur/macos (QEMU/KVM) VM 안에서 기존 `ios/` Xcode 워크스페이스를 그대로 빌드.** xtool은 RN 미지원으로 기각, 클라우드 CI는 로컬 반복 개발 루프·계정/비용 요건으로 채택하지 않되 문서에 대안으로 기록. QEMU 방식의 한계(최초 빌드 수십 분~수 시간, Apple EULA상 macOS는 Apple 하드웨어 전용 — 비 Apple 하드웨어 구동의 적법성은 사용자 책임, 대안으로 동일 스캐폴딩을 보유 Mac에서 실행 가능)를 문서에 명시.
- **구성:** `docker-compose.yml`(kvm/tun 디바이스, NET_ADMIN, 8006·5900·2222→22 포트, 16코어/32G/256G 디스크) + `vm-provision.sh`(VM 내부: Homebrew→node/cocoapods, bun, node_modules 재설치, xcodes로 Xcode 설치 — Apple ID 2FA는 SSH 세션 대화형) + `vm-build.sh`(VM 내부: pod install → Release 기기 빌드 → `xcrun devicectl device install` — 기존 위자드 stage 4–5와 동일 계약) + 호스트 `build-ios-docker.sh`(프리플라이트 → compose up → SSH 대기 → 위 스크립트 실행. 사람 단계: 첫 부팅 macOS 설정·원격로그인·Xcode 계정 로그인·USB 페어링은 VNC 8006에서, 기존 위자드의 사람/자동 stage 구분 관례 재사용).
- **iPhone 연결:** 1회 USB 페어링(usbipd-win → WSL `/dev/bus/usb` → QEMU `ARGUMENTS` usb-host, 위자드가 usbipd 명령을 출력) 후 "네트워크로 연결" 활성화 시 이후 무선. USB 불가 시 대안: VM에서 서명된 .app을 호스트로 꺼내 Windows 쪽 Sideloadly 설치(문서화).
- **실패 경계:** 프리플라이트는 각 선행조건(docker, /dev/kvm 접근, tun, 디스크)을 개별 점검하고 어긋나면 다음 행동 명령과 함께 exit 1. SSH 도달 전까지는 자동 재시도, 타임아웃 시 VNC 안내.

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 | 상태 |
|---|---|---|---|---|---|
| T-1 | 접근 비교·선택 조사 문서 (AC-1) | `docs/research/2026-10-22-docker-xcode-iphone.md`(신규) | 없음 | V-1 | done |
| T-2 | docker-ios VM 스캐폴딩 (AC-2) | `apps/loop-mobile/docker-ios/{docker-compose.yml,vm-provision.sh,vm-build.sh,README.md}`(신규) | T-1 | V-2 | done |
| T-3 | 호스트 위자드+프리플라이트 (AC-2, AC-3) | `apps/loop-mobile/scripts/build-ios-docker.sh`(신규) | T-2 | V-2, V-3 | done |
| T-4 | 정적 검증·라이브 프리플라이트·문서 정합 (AC-3, AC-4) | repo 무변경(검증) | T-3 | V-3, V-4 | done |
| T-5 | G3 리뷰와 결함 처리 (전체) | 리뷰 결과에 따름 | T-4 | V-5 | done (F-1~F-6 수정 완료) |

## 검증 계획과 결과

| ID | 방법 | cwd·환경 | 기대 결과 | 실제 결과 | 판정 |
|---|---|---|---|---|---|
| V-1 | 조사 문서 대조: 각 접근의 출처 URL·핵심 제약이 실제 검색/문서 근거와 일치하는지 | docs/research | 근거 있는 비교·선택 | dockur/xtool/클라우드 각 README·발급 문서 인증 완료, RN-SwiftPM 미지원 근거 포함 | PASS |
| V-2 | `bash -n` (전도 유닛): 신규 sh 3종 + `docker compose config`는 docker 부재로 불가 → YAML 구조 점검은 compose 스키마 키 대조로 대체 | apps/loop-mobile | syntax error 없음 | bash -n 3종 통과, compose 키 대조 통과(아래 실행 기록) | PASS |
| V-3 | `bash scripts/build-ios-docker.sh --preflight-only` 라이브 실행 | apps/loop-mobile (WSL2, Docker 미설치 상태) | 항목별 현재 상태 출력 + 설치 명령 안내 + exit 1(BLOCKED) | docker 미설치를 감지, wsl 설치 명령 안내, exit 1 확인 | PASS |
| V-4 | 문서 대조: E2E 절차의 각 명령이 기존 문서/위자드와 모순 없는지 + 라이브 E2E는 사용자 설치 전까지 불가를 명시 | docs/docker-ios | 절차 일관, BLOCKED 명시 | 절차 일관. 라이브 E2E = BLOCKED (Docker·usbipd·Apple ID 사용자 설치 필요) | PASS (E2E BLOCKED 명시) |
| V-5 | review-changes 루브릭으로 **self-review**(위임 에이전트 도구가 이 세션에 없어 독립성 한계 명시) — 원 요청·AC·diff·검증 기록 대조 | docs + apps/loop-mobile | P0/P1 없음 | F-1(P1, macOS bash 3.2 빈 배열 확장 크래시)·F-2(P2, preflight 상태 미초기화)·F-3(P2, .env 키 불일치)·F-4(P2, SSH 개인키의 VM 복사)·F-5(P2, SSH 전달 불발 시 대체 경로 부재)·F-6(P3, runfirstlaunch 치명적 종료) 발견 → 전부 수정, `bash -n`·프리플라이트 재검증 | PASS (self-review) |
| V-6 | `bun run test:architecture` + loop-mobile bun test (경계 무변경 회귀 확인) | repo 루트 | 기존 녹색 유지 | PASS — 신규 파일은 셸/문서뿐, 경계 위반 없음 | PASS |
| V-7 | **라이브 VM 기동 검증** (사용자 Docker 설치 후 2026-10-22 수행): compose up → 컨테이너/포트, 복구 이미지 854MB 다운로드(첫 토큰 403 → dockur 자동 재시도로 회복), `accel=kvm` 확인, `HANDOFF TO XNU` 부팅, 웹뷰어 8006·브라우저 안내. **라이브 결함 → 수정:** ① dockur DHCP 브리지 모드가 발행 포트(2222→22)를 게스트로 전달하지 않음(F-5 실발) → `ssh-relay` socat 사이드카 추가. ② 빈 `data.img`는 설치 프로그램에 안 보임 → 디스크 유틸리티 "모든 기기 표시" 후 QEMU HARDDISK 지우기(APFS·GUID) 선행(사용자 수행, 설치 완료). ③ 밤사이 게스트 커널 행걸림(16코어 점유·네트워크 사망, 10h+) → VM 재시작으로 복구, 설치 재개. ④ VM 계정명 `loopy` — 공개키 등록은 VNC 붙여넣기 깨짐 회피 위해 컨테이너 내 파일서버(`http://172.30.0.1:8000/k`)에서 curl로 받도록 제공. **남은 사용자 1줄:** 위 curl로 authorized_keys 등록 → 이후 자동(동기화→vm-provision(Apple ID 2FA)→Xcode 로그인→vm-build --install). 재개 절차: 토글 ON → `bash /tmp/ios-vm-bootstrap.sh`(세션 접착제; rsync→tar 폴백 동기화+vm 스크립트 배치) → `ssh -tt … vm-provision.sh`(사용자 터미널, Apple ID 2FA) → Xcode 로그인 → `vm-build.sh --install` | 라이브 (docker, WSL2) | VM 부팅+SSH 경로 성립 | 부팅·가속·뷰어·릴레이 PASS, SSH는 사용자 토글 대기 | PASS (SSH 대기) |
