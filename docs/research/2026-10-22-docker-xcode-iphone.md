# Docker로 Xcode 없이(또는 안에서) iPhone에 설치하기 — 조사와 loop-mobile 적용

- **작성일:** 2026-10-22
- **요청:** "Docker를 이용해서 Xcode를 가지고 iPhone에 설치할 수 있도록 했다고 하는데 그거 연구하고 여기에 적용할 수 있게 해줘."
- **결론(요약):** 들은 소식의 원판은 **Docker가 QEMU/KVM으로 macOS 가상머신을 띄우고 그 안의 Xcode로 빌드·설치하는 방식**(dockur/macos 계열)이다. 이 머신(WSL2, `/dev/kvm`+AVX2, 32코어/58GB)은 물리적으로 실행 가능하며, 본 문서의 설계대로 `apps/loop-mobile/docker-ios/` 스캐폴딩으로 적용했다. 단, **Docker·usbipd-win 설치와 Apple ID 세션이 사용자 1회 작업으로 필요**하고, 최초 VM/빌드는 느리다(수십 분~수 시간). xtool 방식은 React Native 미지원으로 기각했다.

---

## 1. "Docker + Xcode → iPhone"의 실체

Xcode는 macOS 전용 앱이라 리눅스 컨테이너 안에 직접 설치할 수 없다(Apple EULA도 macOS를 Apple 하드웨어로 한정). 그래서 "Docker로 Xcode"는 실제로는 다음 셋 중 하나다:

1. **Docker가 관리하는 macOS 가상머신** — [dockur/macos](https://github.com/dockur/macos)가 Docker만으로 macOS VM(KVM 가속)을 부팅하고 웹 브라우저(포트 8006)로 화면을 보여준다. VM 안에 Xcode를 설치해 기존 Xcode 워크스페이스를 그대로 빌드하고, `xcrun devicectl`로 실기기에 설치한다. Windows/Linux에서 Mac 없이 iOS 실기기 빌드를 하는 대표적 오픈소스 경로다(가이드: [dev.to 2024-11](https://dev.to/cabraljv/how-to-build-and-test-ios-applications-on-windowslinux-using-docker-4jfh), 유사 선배: [Docker-OSX](https://github.com/sickcodes/Docker-OSX), [Baeldung QEMU+KVM 튜토리얼](https://www.baeldung.com/linux/xcode)).
2. **macOS 없는 네이티브 도구 체인** — [xtool](https://github.com/xtool-org/xtool)([Swift Forums 발표](https://forums.swift.org/t/xtool-cross-platform-xcode-replacement-build-ios-apps-on-linux-and-more/79803), 소개: [xtool.sh](https://xtool.sh))가 Linux/WSL에서 SwiftPM 패키지를 iOS 앱으로 빌드·서명·설치한다. Docker가 아니어도 되고 빠르지만, **SwiftPM 프로젝트 전용이라 Xcode 프로젝트+CocoaPods 기반인 React Native 앱은 빌드할 수 없다**(README 워크플로 확인). 이번 대상인 loop-mobile(RN 0.88, vision-camera·nitro 등 네이티브 pod)은 이 길이 아니다.
3. **클라우드 Mac** — EAS Build, Codemagic, GitHub Actions macOS 러너 등이 원격 Mac에서 빌드([예: Capawesome "build without Mac"](https://capawesome.io/solutions/build-without-mac)). 로컬 Docker와 무관하며 비용/큐/계정 요건이 있다. 대안으로 유효.

참고(오해 방지): Apple이 2025년에 발표한 자체 컨테이너 프레임워크는 **macOS에서 OCI 컨테이너를 돌리는 기능**이라 방향이 반대다(Mac이 필요). "Docker Desktop의 macOS 컨테이너" 역시 Apple 실리콘 Mac에서만 유효한 이야기다.

## 2. 경로 비교 (loop-mobile 기준)

| 경로 | Mac 필요 | 이 머신에서 | RN 0.88 지원 | 채택 |
|---|---|---|---|---|
| dockur/macos (Docker+QEMU/KVM) | 불필요 | 가능 (kvm·AVX2·tun 충족, Docker 설치만 필요) | 완전 (실제 Xcode) | **채택** |
| Docker-OSX (sickcodes) | 불필요 | 가능하나 수동 구성·유지보수 둔화 | 완전 | 보류 (dockur가 더 자동화) |
| xtool (Linux 네이티브) | 불필요 | 가능 | **불가 (SwiftPM 전용)** | 기각 |
| 클라우드 Mac CI | 불필요 | 가능 (계정/비용/네트워크) | 완전 | 대안 (문서화) |
| 기존 Mac 유지 | 필요 | — (과거 방식: `app-device-install.md` §6) | 완전 | 현상 유지 대안 |

## 3. 이 머신 적합성 (2026-10-22 실측)

- WSL2 3.0.3.0, 커널 6.18, **`/dev/kvm` 존재**(kvm 그룹에 loopy 등록됨 — 새 세션부터 유효, Docker 데몬은 root라 영향 없음), **AVX2 확인**, `/dev/net/tun` 존재 → dockur/macos의 선행 조건 충족.
- 32코어 / RAM 58GB / 디스크 921GB 여유 → VM에 16코어·32GB·256GB 디스크 배정 여유 있음.
- 미설치(사용자 1회 설치 필요): **Docker**(WSL 내 `docker.io`+`docker-compose-v2` 또는 Docker Desktop for Windows), **usbipd-win**(iPhone USB 페어링을 Windows→WSL로 넘길 때).
- 이 저장소의 자산과 정합: `apps/loop-mobile/ios/`(RN 0.88 워크스페이스, 커밋됨), `scripts/device-build-wizard.sh`(Mac 전제 서명 위자드 — 팀 ID·UDID 이력 제공), `docs/research/app-device-install.md` §6(수동 설치 절차). VM 경로는 이 계약을 그대로 따라간다: 사람이 Apple ID/서명 팀을 준비하면, 스크립트가 Release 빌드 → `xcrun devicectl device install app` → 실행까지 한다.

## 4. 적용 설계 (`apps/loop-mobile/docker-ios/`)

```text
Windows(브라우저 localhost:8006) ─ VNC ┐
WSL2 ─ docker compose up → dockurr/macos VM (macOS 15, Xcode)
  └─ ssh(2222) → vm-provision.sh (1회: Homebrew·node·CocoaPods·bun·xcodes로 Xcode)
              → vm-build.sh    (반복: bun install → pod install → xcodebuild Release
                                 → xcrun devicectl device install app → launch)
iPhone ─ 1회 USB 페어링(usbipd-win → QEMU usb-host) 후 네트워크 설치 가능
```

- 사람이만 가능한 단계(기존 위자드 관례와 동일): VM 첫 부팅 macOS 설정, 원격로그인+SSH 키 등록, Xcode의 Apple ID 로그인(자동 서명 세션), iPhone 신뢰/페어링, 무료 팀의 7일 재서명.
- 파일: `docker-compose.yml`(VM 정의), `vm-provision.sh`(VM 내부, 멱등), `vm-build.sh`(VM 내부, 빌드+설치), `README.md`(운영 절차), 호스트 진입점 `scripts/build-ios-docker.sh`(프리플라이트→기동→대기→위 스크립트 실행).
- **한계와 리스크(명시):** (a) Apple EULA상 macOS는 Apple 하드웨어에서만 구동 허용 — 비 Apple 하드웨어(WSL2)에서의 구동 적법성은 사용자 책임이며, 동일한 스캐폴딩은 보유 Apple 실리콘 Mac에서 Docker로 돌리면 정합적이다. (b) QEMU 가상화 성능 — 최초 macOS 설치 + Xcode 다운로드(~8GB)+RN pod/build는 수십 분~수 시간, 이후 DerivedData 캐시로 개선. (c) `-allowProvisioningUpdates` 자동 서명은 VM Xcode에 1회 Apple ID 로그인 세션이 필요하다(무료 팀은 7일 만료마다 재로그인/재서명). (d) Xcode 버전-RN 0.88 요구 버전은 첫 설치 시 `xcodes`로 최신 안정판을 받아 확인한다(버전 행렬은 첫 실행 증거로 확정).

## 5. iPhone 설치의 두 경로

1. **VM 안 devicectl(기본):** usbipd-win으로 iPhone을 Windows에서 WSL 버스로 attach → compose의 `ARGUMENTS`에 `-device usb-host,hostbus=<bus>,hostport=<port>`와 `/dev/bus/usb` 디바이스 추가로 VM에 패스스루 → macOS에서 신뢰·페어링 1회 → 이후 "네트워크로 연결"이 켜지면 무선 설치. 정확한 명령은 `docker-ios/README.md`와 위자드가 출력한다.
2. **IPA 꺼내 Windows에서 설치(대안):** VM에서 서명된 `.app`을 호스트로 복사 → zip으로 `.ipa` 패키징 → Windows의 Sideloadly 등으로 USB 설치. USB 패스스루가 어려울 때 쓴다.

## 6. 사용자 1회 설치 명령 (현재 머신 기준, sudo 필요)

```bash
# WSL 안에 Docker 설치(권장 경로 — 가볍고 /dev/kvm 전달이 단순)
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# → Windows에서 `wsl --shutdown` 후 WSL 재시작(그룹 적용)

# iPhone USB 페어링을 쓸 경우(Windows 관리자 PowerShell)
winget install usbipd
usbipd list                        # iPhone BUSID 확인
usbipd bind --busid <BUSID>        # 1회
usbipd attach --wsl --busid <BUSID>  # 사용 시마다
```

## 7. 출처

- dockur/macos (이미지·요구사항·USB 패스스루): https://github.com/dockur/macos
- Docker로 Windows/Linux에서 iOS 빌드 가이드(dockur 계열): https://dev.to/cabraljv/how-to-build-and-test-ios-applications-on-windowslinux-using-docker-4jfh
- iOS on Linux 이른 사례(QEMU+Xcode): https://dev.to/ianito/how-to-emulate-ios-on-linux-with-docker-4gj3
- Docker-OSX: https://github.com/sickcodes/Docker-OSX
- xtool (SwiftPM 전용 확인): https://github.com/xtool-org/xtool , https://forums.swift.org/t/xtool-cross-platform-xcode-replacement-build-ios-apps-on-linux-and-more/79803 , https://xtool.sh
- Baeldung Linux에서 Xcode(QEMU+KVM): https://www.baeldung.com/linux/xcode
- 클라우드 Mac 빌드 예: https://capawesome.io/solutions/build-without-mac
- 내부 문서: `docs/research/app-device-install.md`(기존 Mac 수동 설치 절차), `docs/plans/2026-10-22-docker-ios-device-install.md`(본 적용의 계획·검증)
