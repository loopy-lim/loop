# apps/loop-mobile/docker-ios — Mac 없이 iPhone에 설치 (macOS VM in Docker)

[dockur/macos](https://github.com/dockur/macos)로 이 머신(WSL2)의 Docker 안에 macOS VM을 띄우고,
그 안의 Xcode로 `apps/loop-mobile/ios/` 워크스페이스를 빌드해 iPhone에 설치한다.
조사 근거와 설계: `docs/research/2026-10-22-docker-xcode-iphone.md`.

## 전제 (사용자 1회 설치)

```bash
# WSL 안 (Docker + compose v2)
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# Windows에서 `wsl --shutdown` → WSL 재시작 (그룹 적용)
```

iPhone USB 페어링을 쓰면(권장, 1회 페어링 후 무선): Windows 관리자 PowerShell에서
`winget install usbipd` → `usbipd bind --busid <BUSID>`.

## 매일 쓰는 흐름

```bash
cd apps/loop-mobile
bash scripts/build-ios-docker.sh
```

위자드가 프리플라이트 → VM 기동 → (첫 실행 시) macOS 설정·도구체인·Xcode 설치 안내 →
Release 빌드 → 설치까지 진행한다. 사람 단계(VM 화면이 필요한 것)는 브라우저
`http://localhost:8006`에서 하고, Apple ID 2FA 같은 터미널 프롬프트는 그대로 이
터미널로 온다.

## iPhone USB 페어링 (1회)

1. Windows에서 iPhone을 연결하고: `usbipd list` → `usbipd attach --wsl --busid <BUSID>`
2. WSL에서 버스 경로 확인: `lsusb | grep -i apple` (예: `Bus 002 Device 003`)
3. `docker-compose.yml`의 `devices`에 `/dev/bus/usb/002/003`을, 환경에
   `QEMU_EXTRA_ARGS='-device usb-host,hostbus=2,hostport=3'`를 넣고 재기동:
   ```bash
   docker compose -p loop-ios down
   QEMU_EXTRA_ARGS='-device usb-host,hostbus=2,hostport=3' docker compose -p loop-ios up -d
   ```
4. 브라우저(8006)의 macOS에서 iPhone을 신뢰하고, Xcode에서 1회 페어링.
   이후 iPhone 설정 → 개발자 → "네트워크로 연결"을 켜면 USB 없이 설치 가능.

USB 패스스루가 어려우면 대안: VM에서 서명된 `.app`을 호스트로 복사해 `.ipa`로
패키징한 뒤 Windows의 Sideloadly로 설치한다(위자드가 경로를 안내).

## 구성 파일

| 파일 | 역할 |
|---|---|
| `docker-compose.yml` | macOS 15 VM 정의 (kvm·tun 디바이스, 8006 웹뷰어/5900 VNC/2222 SSH) |
| `docker-compose.yml`의 `ssh-relay` | dockur DHCP 브리지 모드는 발행 포트를 게스트로 자동 전달하지 않아, socat 사이드카가 컨테이너 22 → 게스트(172.30.0.2) sshd로 릴레이한다 |
| `vm-provision.sh` | VM 내부 1회 도구체인 설치 (Homebrew·node·CocoaPods·bun·xcodes→Xcode). 멱등 |
| `vm-build.sh` | VM 내부 빌드+설치 (bun install → pod install → xcodebuild → devicectl) |
| `.gitignore` | VM 접속 키·known hosts 제외 |

## SSH가 안 열릴 때 (수동 모드)

이미지·버전 조합에 따라 게스트 22포트 전달이 안 될 수 있다(첫 실행에서 확인).
그때는 브라우저(8006)의 **VM 터미널에서 직접** 진행한다 — 위자드 없이도 흐름은 같다:

1. VM 터미널에서 도구체인 설치(스크립트 없이):
   `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
   → `brew install node cocoapods xcodesorg/made/xcodes` → `curl -fsSL https://bun.sh/install | bash`
2. 저장소 코드는 웹에서 macOS로 전송(공유 폴더/클라우드)하거나, VM 안에서 git clone.
   `bun install` → `cd ios && pod install`.
3. Xcode(xcodes로 설치·또는 개발자 사이트에서 .xip) 설치 → Apple ID 로그인 →
   `xcodebuild -workspace LoopMobile.xcworkspace -scheme LoopMobile -configuration Release
   -destination 'generic/platform=iOS' DEVELOPMENT_TEAM=<TEAM_ID>
   CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates build` → `xcrun devicectl device install app`.
   (기존 수동 절차 `docs/research/app-device-install.md` §6과 동일한 계약을 VM 안에서 도는 것.)

## 주의

- VM 디스크는 Docker 볼륨 `loop-ios-vm`에 저장된다. `docker compose -p loop-ios down -v`는
  VM을 **삭제**한다(Xcode 포함 수십 GB 재설치).
- Apple EULA상 macOS는 Apple 하드웨어에서만 구동이 허용된다. 비 Apple 하드웨어 구동의
  책임은 사용자에게 있다 — 보유 Apple 실리콘 Mac에서 같은 compose를 돌리면 정합적이다.
- 리소스: VM에 16코어·32GB RAM·256GB 디스크를 배정한다(여유 있으면 compose에서 조정).
